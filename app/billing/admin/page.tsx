'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface UserWithBalance {
  id: string;
  email: string;
  role: string;
  balance: number;
  createdAt: number;
}

interface Stats {
  gmv: { total: number; month: number; week: number; today: number };
  orders: { total: number; today: number; pendingExpired: number };
  users: { total: number; week: number; today: number };
  dailyTrend: { date: string; revenue: number; orders: number }[];
  monthlyTrend: { month: string; revenue: number; orders: number }[];
  packageDist: { label: string; pages: number; count: number; revenue: number }[];
  referral: { total: number; week: number };
}

function fen2yuan(fen: number): string {
  return '¥' + (fen / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-end gap-0.5 h-8">
      <div
        className={`w-full rounded-sm ${color} opacity-80`}
        style={{ height: `${Math.max(4, pct)}%` }}
      />
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserWithBalance[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [giftTarget, setGiftTarget] = useState('');
  const [giftPages, setGiftPages] = useState('100000');
  const [giftNote, setGiftNote] = useState('');
  const [giftMsg, setGiftMsg] = useState('');
  const [giftLoading, setGiftLoading] = useState(false);
  const [tab, setTab] = useState<'stats' | 'users' | 'gift'>('stats');

  async function loadAll() {
    try {
      const [usersRes, statsRes] = await Promise.all([
        fetch('/api/billing/admin/users'),
        fetch('/api/billing/admin/stats'),
      ]);
      const usersData = await usersRes.json();
      const statsData = await statsRes.json();
      if (!usersData.success) {
        if (usersRes.status === 401 || usersRes.status === 403) { router.push('/billing/login'); return; }
        throw new Error(usersData.error);
      }
      setUsers(usersData.users);
      if (statsData.success) setStats(statsData);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadAll(); }, []);

  async function giftSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGiftLoading(true); setGiftMsg('');
    try {
      const res = await fetch('/api/billing/admin/gift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: giftTarget, pages: parseInt(giftPages), note: giftNote }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setGiftMsg(`✅ 已赠送页数 给 ${data.userId}`);
      await loadAll();
    } catch (e) {
      setGiftMsg(`❌ ${e instanceof Error ? e.message : '失败'}`);
    } finally {
      setGiftLoading(false);
    }
  }

  function fmtTokens(n: number) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
    return String(n);
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <span className="text-gray-500">加载中…</span>
    </div>
  );

  const maxDailyRevenue = stats ? Math.max(...stats.dailyTrend.map((d) => d.revenue), 1) : 1;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">🔧 DeckMind 管理后台</h1>
        <a href="/billing" className="text-sm text-blue-400 hover:underline">← 返回钱包</a>
      </div>

      <div className="max-w-5xl mx-auto p-6">
        {error && (
          <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-red-400 text-sm mb-4">{error}</div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-900 rounded-xl p-1 mb-6 w-fit">
          {([['stats', '📊 收入统计'], ['users', '👥 用户管理'], ['gift', '🎁 赠送配额']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── 收入统计 Tab ─────────────────────────────────────────── */}
        {tab === 'stats' && stats && (
          <div className="space-y-6">

            {/* KPI 卡片行 */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: '总 GMV', value: fen2yuan(stats.gmv.total), sub: `共 ${stats.orders.total} 笔`, color: 'text-yellow-400' },
                { label: '本月收入', value: fen2yuan(stats.gmv.month), sub: '近 30 天', color: 'text-blue-400' },
                { label: '本周收入', value: fen2yuan(stats.gmv.week), sub: '近 7 天', color: 'text-purple-400' },
                { label: '今日收入', value: fen2yuan(stats.gmv.today), sub: `今日 ${stats.orders.today} 笔`, color: 'text-green-400' },
              ].map((card) => (
                <div key={card.label} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                  <p className="text-xs text-gray-500 mb-1">{card.label}</p>
                  <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                  <p className="text-xs text-gray-600 mt-1">{card.sub}</p>
                </div>
              ))}
            </div>

            {/* 用户 KPI */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: '总用户', value: stats.users.total, icon: '👥' },
                { label: '本周注册', value: stats.users.week, icon: '📅' },
                { label: '今日注册', value: stats.users.today, icon: '🆕' },
              ].map((c) => (
                <div key={c.label} className="bg-gray-900 border border-gray-800 rounded-2xl p-4 flex items-center gap-3">
                  <span className="text-2xl">{c.icon}</span>
                  <div>
                    <p className="text-xs text-gray-500">{c.label}</p>
                    <p className="text-xl font-bold text-white">{c.value.toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* 日收入趋势 */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">日收入趋势（近 30 天）</h3>
              <div className="flex items-end gap-0.5 h-24">
                {stats.dailyTrend.map((d) => {
                  const pct = maxDailyRevenue > 0 ? (d.revenue / maxDailyRevenue) * 100 : 0;
                  return (
                    <div
                      key={d.date}
                      title={`${d.date}\n${fen2yuan(d.revenue)} · ${d.orders} 笔`}
                      className="flex-1 rounded-t-sm bg-blue-600 hover:bg-blue-400 transition-colors cursor-default"
                      style={{ height: `${Math.max(d.revenue > 0 ? 4 : 0, pct)}%` }}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-xs text-gray-600 mt-1">
                <span>{stats.dailyTrend[0]?.date?.slice(5)}</span>
                <span>{stats.dailyTrend[stats.dailyTrend.length - 1]?.date?.slice(5)}</span>
              </div>
            </div>

            {/* 套餐分布 */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
              <h3 className="text-sm font-semibold text-gray-300 mb-4">套餐销售分布</h3>
              {stats.packageDist.length === 0 ? (
                <p className="text-gray-600 text-sm text-center py-4">暂无已付款订单</p>
              ) : (
                <div className="space-y-3">
                  {stats.packageDist.map((p) => {
                    const totalOrders = stats.packageDist.reduce((s, d) => s + d.count, 0);
                    const pct = totalOrders > 0 ? Math.round((p.count / totalOrders) * 100) : 0;
                    return (
                      <div key={p.pages}>
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>{p.label}</span>
                          <span>{p.count} 笔 · {fen2yuan(p.revenue)}</span>
                        </div>
                        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-purple-600 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 月度趋势 */}
            {stats.monthlyTrend.length > 0 && (
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
                <h3 className="text-sm font-semibold text-gray-300 mb-3">月度收入</h3>
                <div className="space-y-2">
                  {stats.monthlyTrend.map((m) => (
                    <div key={m.month} className="flex justify-between items-center text-sm">
                      <span className="text-gray-400 w-20">{m.month}</span>
                      <div className="flex-1 mx-3 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-600 rounded-full"
                          style={{ width: `${Math.round(m.revenue / Math.max(...stats.monthlyTrend.map(x => x.revenue), 1) * 100)}%` }}
                        />
                      </div>
                      <span className="text-green-400 font-mono text-xs w-24 text-right">{fen2yuan(m.revenue)}</span>
                      <span className="text-gray-600 text-xs w-12 text-right">{m.orders} 笔</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 邀请码 + 待处理提醒 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                <p className="text-xs text-gray-500 mb-1">邀请码使用</p>
                <p className="text-2xl font-bold text-pink-400">{stats.referral.total}</p>
                <p className="text-xs text-gray-600 mt-1">本周 +{stats.referral.week}</p>
              </div>
              {stats.orders.pendingExpired > 0 && (
                <div className="bg-yellow-950 border border-yellow-800 rounded-2xl p-4">
                  <p className="text-xs text-yellow-600 mb-1">⚠️ 超时未付款订单</p>
                  <p className="text-2xl font-bold text-yellow-400">{stats.orders.pendingExpired}</p>
                  <p className="text-xs text-yellow-700 mt-1">可手动核实后确认</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── 用户管理 Tab ─────────────────────────────────────────── */}
        {tab === 'users' && (
          <section>
            <h2 className="text-base font-semibold mb-3">👥 用户列表 ({users.length})</h2>
            <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-500 text-xs">
                    <th className="text-left px-4 py-3">邮箱</th>
                    <th className="text-left px-4 py-3">角色</th>
                    <th className="text-right px-4 py-3">余额</th>
                    <th className="text-left px-4 py-3">ID</th>
                    <th className="text-left px-4 py-3 hidden md:table-cell">注册时间</th>
                    <th className="text-left px-4 py-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-4 py-3 text-white">{u.email}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          u.role === 'admin' ? 'bg-yellow-900/50 text-yellow-400' : 'bg-gray-800 text-gray-400'
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`font-mono ${u.balance > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {fmtTokens(u.balance)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 font-mono text-xs">{u.id}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs hidden md:table-cell">
                        {new Date(u.createdAt * 1000).toLocaleDateString('zh-CN')}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => { setGiftTarget(u.id); setTab('gift'); }}
                          className="text-xs text-blue-400 hover:underline"
                        >
                          赠送
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── 赠送配额 Tab ─────────────────────────────────────────── */}
        {tab === 'gift' && (
          <section>
            <h2 className="text-base font-semibold mb-3">🎁 赠送页数配额</h2>
            <form onSubmit={giftSubmit} className="bg-gray-900 rounded-2xl p-5 space-y-3 border border-gray-800 max-w-lg">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">用户 ID</label>
                  <input
                    value={giftTarget}
                    onChange={(e) => setGiftTarget(e.target.value)}
                    placeholder="粘贴用户ID"
                    required
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">页数</label>
                  <input
                    value={giftPages}
                    onChange={(e) => setGiftPages(e.target.value)}
                    type="number"
                    min="1"
                    required
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">备注（可选）</label>
                <input
                  value={giftNote}
                  onChange={(e) => setGiftNote(e.target.value)}
                  placeholder="如：测试账户赠送"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                disabled={giftLoading}
                className="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white rounded-lg px-5 py-2 text-sm font-medium"
              >
                {giftLoading ? '处理中…' : '赠送'}
              </button>
              {giftMsg && (
                <div className={`text-sm ${giftMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
                  {giftMsg}
                </div>
              )}
            </form>
          </section>
        )}
      </div>
    </div>
  );
}
