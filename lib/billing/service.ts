/**
 * Billing Service
 *
 * Core business logic for token balance management.
 * All mutations are wrapped in SQLite transactions — atomic & consistent.
 *
 * Token pricing model:
 *   1 CNY = TOKEN_PER_CNY tokens  (configurable via env TOKEN_PER_CNY)
 *   Default: 1 CNY = 100,000 tokens  (i.e. 10 yuan = 1,000,000 tokens)
 *
 * LLM usage deduction:
 *   Actual token usage from AI SDK is mapped 1:1 to billing tokens.
 */

import { nanoid } from 'nanoid';
import { getBillingDB } from './db';
import type { LedgerRow, TransactionRow, UserRow } from './db';
import { createLogger } from '@/lib/logger';

const log = createLogger('BillingService');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
/** How many billing tokens per 1 CNY */
export const TOKEN_PER_CNY = parseInt(process.env.TOKEN_PER_CNY ?? '100000', 10);

/** Initial free tokens granted to every new user */
export const GIFT_TOKENS_ON_REGISTER = parseInt(
  process.env.GIFT_TOKENS_ON_REGISTER ?? '500000',
  10,
);

// ---------------------------------------------------------------------------
// Balance queries
// ---------------------------------------------------------------------------

/** Get the current token balance for a user (0 if no ledger entries yet) */
export function getBalance(userId: string): number {
  const db = getBillingDB();
  const row = db
    .prepare(`SELECT balance FROM token_ledger WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .get(userId) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

/** Get full ledger history for a user */
export function getLedger(userId: string, limit = 50): LedgerRow[] {
  const db = getBillingDB();
  return db
    .prepare(
      `SELECT * FROM token_ledger WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(userId, limit) as LedgerRow[];
}

// ---------------------------------------------------------------------------
// Credit / Debit (internal, always inside a transaction)
// ---------------------------------------------------------------------------

function _addLedgerEntry(
  userId: string,
  delta: number,
  kind: LedgerRow['kind'],
  note?: string,
  refId?: string,
): LedgerRow {
  const db = getBillingDB();
  const currentBalance = getBalance(userId);
  const newBalance = currentBalance + delta;

  if (newBalance < 0) {
    throw new InsufficientTokensError(currentBalance, Math.abs(delta));
  }

  const entry: LedgerRow = {
    id: nanoid(16),
    user_id: userId,
    delta,
    balance: newBalance,
    kind,
    note: note ?? null,
    ref_id: refId ?? null,
    created_at: Math.floor(Date.now() / 1000),
  };

  db.prepare(
    `INSERT INTO token_ledger (id, user_id, delta, balance, kind, note, ref_id, created_at)
     VALUES (@id, @user_id, @delta, @balance, @kind, @note, @ref_id, @created_at)`,
  ).run(entry);

  return entry;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Gift tokens to a user (admin action or new-user welcome bonus).
 * Never throws InsufficientTokensError.
 */
export function giftTokens(
  userId: string,
  tokens: number,
  note?: string,
  adminId?: string,
): LedgerRow {
  log.info(`Gift ${tokens} tokens to user ${userId} by ${adminId ?? 'system'}`);
  const db = getBillingDB();
  return db.transaction(() =>
    _addLedgerEntry(userId, tokens, 'gift', note ?? `Gift from ${adminId ?? 'system'}`, adminId),
  )();
}

/**
 * Deduct tokens for LLM usage.
 * Throws InsufficientTokensError if balance is too low.
 */
export function deductTokens(
  userId: string,
  tokens: number,
  note?: string,
  refId?: string,
): LedgerRow {
  const db = getBillingDB();
  return db.transaction(() =>
    _addLedgerEntry(userId, -tokens, 'usage', note ?? 'LLM usage', refId),
  )();
}

/**
 * Check if user has enough tokens without deducting.
 * Use this as a lightweight pre-flight guard before calling LLM.
 */
export function hasEnoughTokens(userId: string, required: number): boolean {
  return getBalance(userId) >= required;
}

/**
 * Create a pending recharge transaction.
 * Call markTransactionPaid() when payment is confirmed.
 */
export function createRechargeTransaction(
  userId: string,
  amountFen: number,         // e.g. 1000 = 10.00 CNY
  paymentMethod: string,
): TransactionRow {
  const db = getBillingDB();
  const tokens = Math.floor((amountFen / 100) * TOKEN_PER_CNY);
  const tx: TransactionRow = {
    id: nanoid(16),
    user_id: userId,
    amount_fen: amountFen,
    tokens,
    status: 'pending',
    payment_method: paymentMethod,
    payment_ref: null,
    created_at: Math.floor(Date.now() / 1000),
    paid_at: null,
  };
  db.prepare(
    `INSERT INTO transactions (id, user_id, amount_fen, tokens, status, payment_method, payment_ref, created_at)
     VALUES (@id, @user_id, @amount_fen, @tokens, @status, @payment_method, @payment_ref, @created_at)`,
  ).run(tx);
  log.info(`Created recharge tx ${tx.id}: ${amountFen}分 → ${tokens} tokens for user ${userId}`);
  return tx;
}

/**
 * Mark a transaction as paid and credit the tokens.
 * Idempotent — safe to call multiple times (won't double-credit).
 */
export function markTransactionPaid(txId: string, paymentRef?: string): TransactionRow {
  const db = getBillingDB();
  return db.transaction(() => {
    const tx = db
      .prepare(`SELECT * FROM transactions WHERE id = ?`)
      .get(txId) as TransactionRow | undefined;
    if (!tx) throw new Error(`Transaction ${txId} not found`);
    if (tx.status === 'paid') return tx; // already paid — idempotent

    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `UPDATE transactions SET status='paid', payment_ref=?, paid_at=? WHERE id=?`,
    ).run(paymentRef ?? null, now, txId);

    _addLedgerEntry(
      tx.user_id,
      tx.tokens,
      'purchase',
      `Recharge ${(tx.amount_fen / 100).toFixed(2)} CNY → ${tx.tokens} tokens`,
      txId,
    );
    log.info(`Transaction ${txId} paid: +${tx.tokens} tokens to user ${tx.user_id}`);
    return { ...tx, status: 'paid' as const, paid_at: now };
  })();
}

/**
 * Get transaction history for a user.
 */
export function getTransactions(userId: string, limit = 20): TransactionRow[] {
  const db = getBillingDB();
  return db
    .prepare(`SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(userId, limit) as TransactionRow[];
}

// ---------------------------------------------------------------------------
// User helpers
// ---------------------------------------------------------------------------

export function getUserById(id: string): UserRow | undefined {
  return getBillingDB()
    .prepare(`SELECT * FROM users WHERE id = ?`)
    .get(id) as UserRow | undefined;
}

export function getUserByEmail(email: string): UserRow | undefined {
  return getBillingDB()
    .prepare(`SELECT * FROM users WHERE email = ?`)
    .get(email) as UserRow | undefined;
}

export function listUsers(limit = 100, offset = 0): UserRow[] {
  return getBillingDB()
    .prepare(`SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(limit, offset) as UserRow[];
}

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

export class InsufficientTokensError extends Error {
  constructor(
    public readonly balance: number,
    public readonly required: number,
  ) {
    super(`Insufficient tokens: balance=${balance}, required=${required}`);
    this.name = 'InsufficientTokensError';
  }
}
