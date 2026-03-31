/**
 * GET /api/billing/admin/stats
 *
 * 收入与用户统计面板数据（仅 admin）
 *
 * 返回：
 * - 总收入/本月/本周/今日 GMV（已付款交易）
 * - 总用户数、本周新注册
 * - 日/月收入趋势（过去 30 天 / 12 个月）
 * - 套餐销售分布
 * - 邀请码使用统计
 */

import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin, getBillingDB } from '@/lib/billing';

export async function GET() {
  try {
    await requireAdmin();
    const db = getBillingDB();
    const now = Math.floor(Date.now() / 1000);
    const dayS = 86400;

    // ── 时间边界 ─────────────────────────────────────────────────────
    const todayStart   = now - (now % dayS);
    const weekStart    = todayStart - 6 * dayS;
    const monthStart   = todayStart - 29 * dayS;
    const yearStart    = todayStart - 364 * dayS;

    // ── GMV（已付款交易合计）────────────────────────────────────────
    function sumRevenue(since: number): number {
      const row = db.prepare(
        `SELECT COALESCE(SUM(amount_fen), 0) as total
         FROM transactions WHERE status = 'paid' AND paid_at >= ?`
      ).get(since) as { total: number };
      return row.total;
    }
    const revenueTotal = (db.prepare(
      `SELECT COALESCE(SUM(amount_fen), 0) as total FROM transactions WHERE status = 'paid'`
    ).get() as { total: number }).total;
    const revenueMonth = sumRevenue(monthStart);
    const revenueWeek  = sumRevenue(weekStart);
    const revenueToday = sumRevenue(todayStart);

    // ── 订单数 ───────────────────────────────────────────────────────
    const orderTotal = (db.prepare(
      `SELECT COUNT(*) as c FROM transactions WHERE status = 'paid'`
    ).get() as { c: number }).c;
    const orderToday = (db.prepare(
      `SELECT COUNT(*) as c FROM transactions WHERE status = 'paid' AND paid_at >= ?`
    ).get(todayStart) as { c: number }).c;

    // ── 用户数 ───────────────────────────────────────────────────────
    const userTotal = (db.prepare(`SELECT COUNT(*) as c FROM users`).get() as { c: number }).c;
    const userWeek  = (db.prepare(
      `SELECT COUNT(*) as c FROM users WHERE created_at >= ?`
    ).get(weekStart) as { c: number }).c;
    const userToday = (db.prepare(
      `SELECT COUNT(*) as c FROM users WHERE created_at >= ?`
    ).get(todayStart) as { c: number }).c;

    // ── 日收入趋势（过去 30 天，按天聚合）──────────────────────────
    const dailyRows = db.prepare(`
      SELECT
        (paid_at / 86400 * 86400) as day_ts,
        SUM(amount_fen) as revenue,
        COUNT(*) as orders
      FROM transactions
      WHERE status = 'paid' AND paid_at >= ?
      GROUP BY day_ts
      ORDER BY day_ts ASC
    `).all(monthStart) as { day_ts: number; revenue: number; orders: number }[];

    // 填充缺失的天（没有收入的天设为 0）
    const dailyTrend: { date: string; revenue: number; orders: number }[] = [];
    for (let i = 0; i < 30; i++) {
      const ts = monthStart + i * dayS;
      const found = dailyRows.find((r) => r.day_ts === ts);
      dailyTrend.push({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        revenue: found?.revenue ?? 0,
        orders: found?.orders ?? 0,
      });
    }

    // ── 月收入趋势（过去 12 个月，按月聚合）────────────────────────
    const monthlyRows = db.prepare(`
      SELECT
        strftime('%Y-%m', datetime(paid_at, 'unixepoch')) as month,
        SUM(amount_fen) as revenue,
        COUNT(*) as orders
      FROM transactions
      WHERE status = 'paid' AND paid_at >= ?
      GROUP BY month
      ORDER BY month ASC
    `).all(yearStart) as { month: string; revenue: number; orders: number }[];

    // ── 套餐销售分布 ─────────────────────────────────────────────────
    // 套餐通过 tokens 字段区分
    const packageDistRows = db.prepare(`
      SELECT tokens, COUNT(*) as count, SUM(amount_fen) as revenue
      FROM transactions
      WHERE status = 'paid'
      GROUP BY tokens
      ORDER BY tokens ASC
    `).all() as { tokens: number; count: number; revenue: number }[];

    const PACKAGE_NAMES: Record<number, string> = {
      200: '入门版 ¥9.9',
      800: '标准版 ¥29',
      3000: '专业版 ¥79',
      10000: '团队版 ¥199',
    };

    const packageDist = packageDistRows.map((r) => ({
      label: PACKAGE_NAMES[r.tokens] ?? `${r.tokens}页 自定义`,
      pages: r.tokens,
      count: r.count,
      revenue: r.revenue,
    }));

    // ── 邀请码统计 ───────────────────────────────────────────────────
    const referralTotal = (db.prepare(
      `SELECT COUNT(*) as c FROM referral_uses`
    ).get() as { c: number }).c;
    const referralWeek = (db.prepare(
      `SELECT COUNT(*) as c FROM referral_uses WHERE created_at >= ?`
    ).get(weekStart) as { c: number }).c;

    // ── 待处理（pending 超过 10 分钟） ──────────────────────────────
    const pendingExpired = (db.prepare(
      `SELECT COUNT(*) as c FROM transactions WHERE status = 'pending' AND created_at < ?`
    ).get(now - 600) as { c: number }).c;

    return apiSuccess({
      gmv: {
        total: revenueTotal,
        month: revenueMonth,
        week: revenueWeek,
        today: revenueToday,
      },
      orders: {
        total: orderTotal,
        today: orderToday,
        pendingExpired,
      },
      users: {
        total: userTotal,
        week: userWeek,
        today: userToday,
      },
      dailyTrend,
      monthlyTrend: monthlyRows,
      packageDist,
      referral: {
        total: referralTotal,
        week: referralWeek,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    if (msg === 'Unauthorized') return apiError('UNAUTHORIZED', 401, 'Unauthorized');
    if (msg === 'Forbidden') return apiError('FORBIDDEN', 403, 'Forbidden');
    return apiError('INTERNAL_ERROR', 500, 'Stats failed', msg);
  }
}
