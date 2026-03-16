/**
 * Billing Service (PPT Page Quota Edition)
 *
 * Unit: 1 quota = 1 PPT page (scene)
 *
 * Pricing packages (¥ → pages):
 *   ¥9.9  → 200  pages
 *   ¥29   → 800  pages
 *   ¥79   → 3000 pages
 *   ¥199  → 10000 pages
 *
 * New user gift: 20 free pages (GIFT_PAGES_ON_REGISTER)
 */

import { nanoid } from 'nanoid';
import { getBillingDB } from './db';
import type { LedgerRow, TransactionRow, UserRow } from './db';
import { createLogger } from '@/lib/logger';

const log = createLogger('BillingService');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Pricing packages — amount in 分 (1 CNY = 100 fen) */
export const PACKAGES = [
  { id: 'pkg_starter',  label: '入门版', amountFen: 990,   pages: 200   },
  { id: 'pkg_standard', label: '标准版', amountFen: 2900,  pages: 800   },
  { id: 'pkg_pro',      label: '专业版', amountFen: 7900,  pages: 3000  },
  { id: 'pkg_team',     label: '团队版', amountFen: 19900, pages: 10000 },
] as const;

export type PackageId = (typeof PACKAGES)[number]['id'];

/** Free pages given to every new user on registration */
export const GIFT_PAGES_ON_REGISTER = parseInt(
  process.env.GIFT_PAGES_ON_REGISTER ?? '20',
  10,
);

// ---------------------------------------------------------------------------
// Balance queries
// ---------------------------------------------------------------------------

/** Get current page quota balance for a user (0 if none) */
export function getBalance(userId: string): number {
  const db = getBillingDB();
  const row = db
    .prepare(
      `SELECT balance FROM token_ledger WHERE user_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .get(userId) as { balance: number } | undefined;
  return row?.balance ?? 0;
}

/** Get full ledger history for a user */
export function getLedger(userId: string, limit = 50): LedgerRow[] {
  const db = getBillingDB();
  return db
    .prepare(
      `SELECT * FROM token_ledger WHERE user_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(userId, limit) as LedgerRow[];
}

// ---------------------------------------------------------------------------
// Internal ledger write
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
    throw new InsufficientPagesError(currentBalance, Math.abs(delta));
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
 * Gift pages to a user (admin action or new-user welcome bonus).
 */
export function giftPages(
  userId: string,
  pages: number,
  note?: string,
  adminId?: string,
): LedgerRow {
  log.info(`Gift ${pages} pages to user ${userId} by ${adminId ?? 'system'}`);
  const db = getBillingDB();
  return db.transaction(() =>
    _addLedgerEntry(userId, pages, 'gift', note ?? `Gift from ${adminId ?? 'system'}`, adminId),
  )();
}

/**
 * Deduct pages after a successful generation.
 * `pages` = actual number of scenes/slides generated.
 * Throws InsufficientPagesError if balance is too low.
 */
export function deductPages(
  userId: string,
  pages: number,
  note?: string,
  refId?: string,
): LedgerRow {
  const db = getBillingDB();
  return db.transaction(() =>
    _addLedgerEntry(userId, -pages, 'usage', note ?? `Generated ${pages} pages`, refId),
  )();
}

/**
 * Check if user has enough page quota without deducting.
 */
export function hasEnoughPages(userId: string, required = 1): boolean {
  return getBalance(userId) >= required;
}

/**
 * Create a pending recharge transaction.
 * Call markTransactionPaid() when payment is confirmed.
 */
export function createRechargeTransaction(
  userId: string,
  amountFen: number,
  paymentMethod: string,
): TransactionRow {
  const db = getBillingDB();
  const pkg = PACKAGES.find((p) => p.amountFen === amountFen);
  const pages = pkg?.pages ?? Math.floor((amountFen / 990) * 200); // fallback: scale from starter

  const tx: TransactionRow = {
    id: nanoid(16),
    user_id: userId,
    amount_fen: amountFen,
    tokens: pages, // "tokens" field stores page count in our DB
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

  log.info(
    `Created recharge tx ${tx.id}: ${amountFen}分 → ${pages} pages for user ${userId}`,
  );
  return tx;
}

/**
 * Mark a transaction as paid and credit the pages.
 * Idempotent — safe to call multiple times.
 */
export function markTransactionPaid(txId: string, paymentRef?: string): TransactionRow {
  const db = getBillingDB();
  return db.transaction(() => {
    const tx = db
      .prepare(`SELECT * FROM transactions WHERE id = ?`)
      .get(txId) as TransactionRow | undefined;
    if (!tx) throw new Error(`Transaction ${txId} not found`);
    if (tx.status === 'paid') return tx;

    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `UPDATE transactions SET status='paid', payment_ref=?, paid_at=? WHERE id=?`,
    ).run(paymentRef ?? null, now, txId);

    const pages = tx.tokens; // tokens field = page count
    _addLedgerEntry(
      tx.user_id,
      pages,
      'purchase',
      `充值 ${(tx.amount_fen / 100).toFixed(2)} 元 → ${pages} 页`,
      txId,
    );

    log.info(`Transaction ${txId} paid: +${pages} pages to user ${tx.user_id}`);
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
// Custom error
// ---------------------------------------------------------------------------

export class InsufficientPagesError extends Error {
  constructor(
    public readonly balance: number,
    public readonly required: number,
  ) {
    super(`页数配额不足：当前 ${balance} 页，需要 ${required} 页`);
    this.name = 'InsufficientPagesError';
  }
}

// Keep old name as alias for guard.ts compatibility
export { InsufficientPagesError as InsufficientTokensError };
