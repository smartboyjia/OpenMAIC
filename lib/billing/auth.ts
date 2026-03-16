/**
 * Auth Service
 *
 * Handles user registration, login, and JWT session management.
 * Uses bcryptjs for password hashing and jose for JWT signing.
 *
 * JWT is stored in an HttpOnly cookie (auth-token).
 */

import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { nanoid } from 'nanoid';
import { cookies } from 'next/headers';
import { getBillingDB } from './db';
import { giftPages, GIFT_PAGES_ON_REGISTER } from './service';
import type { UserRow } from './db';
import { createLogger } from '@/lib/logger';

const log = createLogger('AuthService');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const JWT_SECRET_RAW = process.env.BILLING_JWT_SECRET ?? 'change-me-in-production-please!!';
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_RAW);
const COOKIE_NAME = 'deckmind-auth';
const BCRYPT_ROUNDS = 10;

export interface JWTPayload {
  sub: string;   // user id
  email: string;
  role: string;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

export async function registerUser(email: string, password: string): Promise<UserRow> {
  const db = getBillingDB();
  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
  if (existing) throw new Error('Email already registered');

  const id = nanoid(16);
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const now = Math.floor(Date.now() / 1000);

  db.prepare(
    `INSERT INTO users (id, email, password, role, created_at, updated_at)
     VALUES (?, ?, ?, 'user', ?, ?)`,
  ).run(id, email, hash, now, now);

  // Gift welcome tokens
  if (GIFT_PAGES_ON_REGISTER > 0) {
    giftPages(id, GIFT_PAGES_ON_REGISTER, `Welcome gift: ${GIFT_PAGES_ON_REGISTER} tokens`);
    log.info(`Gifted ${GIFT_PAGES_ON_REGISTER} pages to new user ${id}`);
  }

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow;
  log.info(`Registered user ${email} (${id})`);
  return user;
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function loginUser(
  email: string,
  password: string,
): Promise<{ user: UserRow; token: string }> {
  const db = getBillingDB();
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as
    | UserRow
    | undefined;
  if (!user) throw new Error('Invalid credentials');

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) throw new Error('Invalid credentials');

  const token = await signJWT(user);
  log.info(`Login: ${email}`);
  return { user, token };
}

// ---------------------------------------------------------------------------
// JWT helpers
// ---------------------------------------------------------------------------

export async function signJWT(user: UserRow): Promise<string> {
  return new SignJWT({ email: user.email, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET);
}

export async function verifyJWT(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, JWT_SECRET);
  return payload as unknown as JWTPayload;
}

// ---------------------------------------------------------------------------
// Cookie session helpers (server-only, use in Route Handlers)
// ---------------------------------------------------------------------------

export async function setAuthCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
}

export async function clearAuthCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getSessionFromCookie(): Promise<JWTPayload | null> {
  try {
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    if (!token) return null;
    return await verifyJWT(token);
  } catch {
    return null;
  }
}

/**
 * Require authentication — throws if not logged in.
 * Use in API routes that need a user context.
 */
export async function requireAuth(): Promise<JWTPayload> {
  const session = await getSessionFromCookie();
  if (!session) throw new Error('Unauthorized');
  return session;
}

/**
 * Require admin role.
 */
export async function requireAdmin(): Promise<JWTPayload> {
  const session = await requireAuth();
  if (session.role !== 'admin') throw new Error('Forbidden');
  return session;
}
