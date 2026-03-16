#!/usr/bin/env node
/**
 * scripts/billing-admin-init.mjs
 *
 * Bootstrap script: creates the first admin user.
 * Run once after deployment:
 *
 *   node scripts/billing-admin-init.mjs
 *
 * Or with custom credentials:
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=secret123 node scripts/billing-admin-init.mjs
 */

import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'billing.db');

const email = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const password = process.env.ADMIN_PASSWORD ?? 'Admin123456!';

console.log(`\n🗄️  Billing Admin Init`);
console.log(`DB: ${DB_PATH}`);
console.log(`Email: ${email}`);

// Open DB (will be created if not exists)
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Run minimal migration (same schema as lib/billing/db.ts)
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user', created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS page_ledger (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, delta INTEGER NOT NULL,
    balance INTEGER NOT NULL, kind TEXT NOT NULL, note TEXT, ref_id TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, amount_fen INTEGER NOT NULL,
    pages INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
    payment_method TEXT, payment_ref TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()), paid_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, key_hash TEXT UNIQUE NOT NULL,
    label TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    last_used_at INTEGER, revoked_at INTEGER
  );
`);

// Check if admin already exists
const existing = db.prepare(`SELECT id, role FROM users WHERE email = ?`).get(email);
if (existing) {
  if (existing.role !== 'admin') {
    db.prepare(`UPDATE users SET role='admin', updated_at=unixepoch() WHERE email=?`).run(email);
    console.log(`✅ Promoted existing user to admin: ${email}`);
  } else {
    console.log(`ℹ️  Admin already exists: ${email}`);
  }
  db.close();
  process.exit(0);
}

// Create admin user
const id = Math.random().toString(36).slice(2, 18);
const hash = await bcrypt.hash(password, 10);
const now = Math.floor(Date.now() / 1000);
db.prepare(
  `INSERT INTO users (id, email, password, role, created_at, updated_at) VALUES (?,?,?,'admin',?,?)`
).run(id, email, hash, now, now);

// Gift welcome pages to admin too
const pagePerCny = parseInt(process.env.TOKEN_PER_CNY ?? '100000', 10);
const giftPages = parseInt(process.env.GIFT_PAGES_ON_REGISTER ?? '500000', 10);
if (giftPages > 0) {
  db.prepare(
    `INSERT INTO page_ledger (id, user_id, delta, balance, kind, note, ref_id, created_at)
     VALUES (?,?,?,?,'gift','Admin welcome gift',null,?)`
  ).run(Math.random().toString(36).slice(2), id, giftPages, giftPages, now);
}

console.log(`\n✅ Admin created!`);
console.log(`   ID:       ${id}`);
console.log(`   Email:    ${email}`);
console.log(`   Password: ${password}`);
console.log(`   Balance:  ${giftPages} pages`);
console.log(`\n⚠️  Change the default password immediately in production!\n`);

db.close();
