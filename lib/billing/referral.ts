/**
 * Referral / Invite Code Service
 *
 * - 每个用户注册后自动拥有一个专属邀请码（lazy 生成）
 * - 被邀请者注册时填写邀请码 → 双方各获得 reward_pages 页
 * - 每人只能使用一次邀请码（不能重复薅）
 * - 不能使用自己的邀请码
 */

import { nanoid } from 'nanoid';
import { getBillingDB } from './db';
import type { ReferralCodeRow, ReferralUseRow } from './db';
import { giftPages } from './service';
import { createLogger } from '@/lib/logger';

const log = createLogger('ReferralService');

// 默认奖励：邀请者 + 被邀请者 各得 30 页
const DEFAULT_REWARD_PAGES = parseInt(process.env.REFERRAL_REWARD_PAGES ?? '30', 10);

// ---------------------------------------------------------------------------
// 生成邀请码字符串：格式 DECK-XXXXX（大写字母+数字，去掉易混淆字符）
// ---------------------------------------------------------------------------
function generateCodeString(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 去掉 0/O/1/I
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return `DECK-${result}`;
}

// ---------------------------------------------------------------------------
// 获取用户的专属邀请码（不存在则自动创建）
// ---------------------------------------------------------------------------
export function getOrCreateUserReferralCode(userId: string): ReferralCodeRow {
  const db = getBillingDB();

  const existing = db
    .prepare(`SELECT * FROM referral_codes WHERE user_id = ? LIMIT 1`)
    .get(userId) as ReferralCodeRow | undefined;

  if (existing) return existing;

  // 创建新码，避免碰撞
  let code = '';
  for (let attempt = 0; attempt < 10; attempt++) {
    code = generateCodeString();
    const clash = db.prepare(`SELECT id FROM referral_codes WHERE code = ?`).get(code);
    if (!clash) break;
  }

  const id = nanoid(16);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO referral_codes (id, user_id, code, reward_pages, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, code, DEFAULT_REWARD_PAGES, now, now);

  return db.prepare(`SELECT * FROM referral_codes WHERE id = ?`).get(id) as ReferralCodeRow;
}

// ---------------------------------------------------------------------------
// 查询邀请码信息（注册页用：验证码是否有效）
// ---------------------------------------------------------------------------
export function lookupReferralCode(code: string): ReferralCodeRow | null {
  const db = getBillingDB();
  const row = db
    .prepare(`SELECT * FROM referral_codes WHERE code = ?`)
    .get(code.toUpperCase().trim()) as ReferralCodeRow | undefined;
  if (!row) return null;

  // 已达上限
  if (row.use_count >= row.max_uses) return null;

  // 已过期
  if (row.expires_at && row.expires_at < Math.floor(Date.now() / 1000)) return null;

  return row;
}

// ---------------------------------------------------------------------------
// 使用邀请码（注册完成后调用）
// ---------------------------------------------------------------------------
export interface ApplyReferralResult {
  inviterPagesGiven: number;
  inviteePagesGiven: number;
  inviterEmail: string;
}

export function applyReferralCode(
  code: string,
  inviteeId: string,
): ApplyReferralResult | null {
  const db = getBillingDB();

  const referral = lookupReferralCode(code);
  if (!referral) return null;

  // 不能使用自己的码
  if (referral.user_id === inviteeId) return null;

  // 已用过邀请码
  const alreadyUsed = db
    .prepare(`SELECT id FROM referral_uses WHERE invitee_id = ?`)
    .get(inviteeId);
  if (alreadyUsed) return null;

  const inviterId = referral.user_id;
  const pages = referral.reward_pages;
  const now = Math.floor(Date.now() / 1000);

  // 原子操作：记录使用 + 发放页数 + 更新计数
  const applyTx = db.transaction(() => {
    // 记录使用
    db.prepare(
      `INSERT INTO referral_uses (id, code_id, inviter_id, invitee_id, pages_given, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(nanoid(16), referral.id, inviterId, inviteeId, pages, now);

    // 更新计数
    db.prepare(
      `UPDATE referral_codes SET use_count = use_count + 1, updated_at = ? WHERE id = ?`,
    ).run(now, referral.id);

    // 邀请者获得奖励
    giftPages(inviterId, pages, `邀请奖励：好友注册`);

    // 被邀请者获得奖励（额外加，不影响注册赠送的20页）
    giftPages(inviteeId, pages, `邀请奖励：使用好友邀请码`);
  });

  applyTx();

  const inviter = db.prepare(`SELECT email FROM users WHERE id = ?`).get(inviterId) as
    | { email: string }
    | undefined;

  log.info(`Referral applied: code=${code}, inviter=${inviterId}, invitee=${inviteeId}, pages=${pages}`);

  return {
    inviterPagesGiven: pages,
    inviteePagesGiven: pages,
    inviterEmail: inviter?.email ?? '',
  };
}

// ---------------------------------------------------------------------------
// 查询用户的邀请统计
// ---------------------------------------------------------------------------
export interface ReferralStats {
  code: ReferralCodeRow;
  uses: (ReferralUseRow & { invitee_email: string })[];
  totalPagesEarned: number;
}

export function getUserReferralStats(userId: string): ReferralStats {
  const db = getBillingDB();
  const code = getOrCreateUserReferralCode(userId);

  const uses = db
    .prepare(
      `SELECT ru.*, u.email as invitee_email
       FROM referral_uses ru
       JOIN users u ON u.id = ru.invitee_id
       WHERE ru.inviter_id = ?
       ORDER BY ru.created_at DESC`,
    )
    .all(userId) as (ReferralUseRow & { invitee_email: string })[];

  const totalPagesEarned = uses.reduce((sum, u) => sum + u.pages_given, 0);

  return { code, uses, totalPagesEarned };
}
