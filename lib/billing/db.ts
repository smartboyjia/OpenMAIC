/**
 * Billing Database
 *
 * SQLite-backed persistent storage for users, token balances, and transactions.
 * Uses better-sqlite3 for synchronous, embedded operation — no external DB needed.
 *
 * Tables:
 *   users        — accounts (email + hashed password + role)
 *   token_ledger — append-only balance ledger (credits / debits)
 *   transactions — payment/recharge records
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { createLogger } from '@/lib/logger';

const log = createLogger('BillingDB');

// ---------------------------------------------------------------------------
// Database location: data/billing.db  (beside the project root)
// ---------------------------------------------------------------------------
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'billing.db');

let _db: Database.Database | null = null;

export function getBillingDB(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  migrate(_db);
  log.info(`Billing DB opened at ${DB_PATH}`);
  return _db;
}

// ---------------------------------------------------------------------------
// Schema / migration
// ---------------------------------------------------------------------------
function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      email       TEXT UNIQUE NOT NULL,
      password    TEXT NOT NULL,          -- bcrypt hash
      role        TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'admin'
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS token_ledger (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      delta       INTEGER NOT NULL,       -- positive = credit, negative = debit
      balance     INTEGER NOT NULL,       -- running balance after this entry
      kind        TEXT NOT NULL,          -- 'gift' | 'purchase' | 'usage' | 'refund' | 'admin'
      note        TEXT,                   -- human-readable description
      ref_id      TEXT,                   -- reference to transaction / API call
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_user ON token_ledger(user_id, created_at);

    CREATE TABLE IF NOT EXISTS transactions (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id),
      amount_fen    INTEGER NOT NULL,     -- amount in 分 (1 CNY = 100 fen)
      tokens        INTEGER NOT NULL,     -- tokens purchased
      status        TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'paid' | 'failed' | 'refunded'
      payment_method TEXT,               -- 'wechat' | 'alipay' | 'manual'
      payment_ref   TEXT,                -- third-party order/transaction id
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      paid_at       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at);

    CREATE TABLE IF NOT EXISTS api_keys (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id),
      key_hash    TEXT UNIQUE NOT NULL,   -- sha256(key)
      label       TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      last_used_at INTEGER,
      revoked_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_apikey_hash ON api_keys(key_hash);

    -- Referral / invite code system
    CREATE TABLE IF NOT EXISTS referral_codes (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL REFERENCES users(id),
      code          TEXT UNIQUE NOT NULL,     -- human-readable e.g. "DECK-ABC12"
      use_count     INTEGER NOT NULL DEFAULT 0,
      max_uses      INTEGER NOT NULL DEFAULT 100,
      reward_pages  INTEGER NOT NULL DEFAULT 30, -- pages given to each side per use
      expires_at    INTEGER,                  -- NULL = never expire
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_ref_code ON referral_codes(code);
    CREATE INDEX IF NOT EXISTS idx_ref_user ON referral_codes(user_id);

    CREATE TABLE IF NOT EXISTS referral_uses (
      id            TEXT PRIMARY KEY,
      code_id       TEXT NOT NULL REFERENCES referral_codes(id),
      inviter_id    TEXT NOT NULL REFERENCES users(id),
      invitee_id    TEXT NOT NULL REFERENCES users(id),
      pages_given   INTEGER NOT NULL,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_refuse_invitee ON referral_uses(invitee_id); -- 每人只能用一次
    CREATE INDEX IF NOT EXISTS idx_refuse_inviter ON referral_uses(inviter_id);
  `);
}

// ---------------------------------------------------------------------------
// Type definitions for rows
// ---------------------------------------------------------------------------
export interface UserRow {
  id: string;
  email: string;
  password: string;
  role: 'user' | 'admin';
  created_at: number;
  updated_at: number;
}

export interface LedgerRow {
  id: string;
  user_id: string;
  delta: number;
  balance: number;
  kind: 'gift' | 'purchase' | 'usage' | 'refund' | 'admin';
  note: string | null;
  ref_id: string | null;
  created_at: number;
}

export interface TransactionRow {
  id: string;
  user_id: string;
  amount_fen: number;
  tokens: number;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  payment_method: string | null;
  payment_ref: string | null;
  created_at: number;
  paid_at: number | null;
}

export interface ReferralCodeRow {
  id: string;
  user_id: string;
  code: string;
  use_count: number;
  max_uses: number;
  reward_pages: number;
  expires_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface ReferralUseRow {
  id: string;
  code_id: string;
  inviter_id: string;
  invitee_id: string;
  pages_given: number;
  created_at: number;
}
