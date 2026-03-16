'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface UserInfo { id: string; email: string; role: string }
interface LedgerEntry {
  id: string; delta: number; balance: number;
  kind: string; note: string | null; created_at: number;
}
interface Transaction {
  id: string; amount_fen: number; tokens: number; status: string;
  payment_method: string | null; created_at: number; paid_at: number | null;
}
interface Package { id: string; label: string; amountFen: number; pages: number }

const kindLabel: Record<string, string> = {
  gift: '🎁 赠送',
  purchase: '💳 充值',
  usage: '📄 生成消耗',
  refund: '↩️ 退款',
  admin: '🔧 管理员',
};

export default function BillingPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [loading, setLoading] = useState(true);
  const [recharging, setRecharging] = useState(false);
  const [rechargeMsg, setRechargeMsg] = useState('');
  const [tab, setTab] = useState<'overview' | 'recharge' | 'history'>('overview');

  async function load() {
    try {
      const [me, pkgs, txs] = await Promise.all([
        fetch('/api/billing/me').then((r) => r.json()),
        fetch('/api/billing/recharge').then((r) => r.json()),
        fetch('/api/billing/transactions').then((r) => r.json()),
      ]);
      if (!me.success) { router.push('/billing/login'); return; }
      setUser(me.user);
      setBalance(me.balance);
      setLedger(me.ledger);
      setPackages(pkgs.packages ?? []);
      setTransactions(txs.transactions ?? []);
    } catch { router.push('/billing/login'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function logout() {
    await fetch('/api/billing/auth?action=logout', { method: 'POST' });
    router.push('/billing/login');
  }

  async function recharge(pkg: Package) {
    setRecharging(true); setRechargeMsg('');
    try {
      const res = await fetch('/api/billing/recharge?confirm=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setRechargeMsg(`✅ 充值成功！获得 ${pkg.pages} 页配额`);
      await load();
    } catch (e) {
      setRechargeMsg(`❌ ${e instanceof Error ? e.message : '充值失败'}`);
    } finally { setRecharging(false); }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <span className="text-gray-500">加载中…</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-lg">我的配额</h1>
          <p className="text-gray-500 text-sm">{user?.email}</p>
        </div>
        <div className="flex gap-4 items-center">
          {user?.role === 'admin' && (
            <a href="/billing/admin" className="text-sm text-yellow-400 hover:underline">管理后台</a>
          )}
          <button onClick={logout} className="text-sm text-gray-500 hover:text-gray-300">退出</button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-6">
        {/* Balance card */}
        <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 border border-blue-800/50 rounded-2xl p-6 mb-6">
          <p className="text-sm text-blue-300 mb-1">可生成 PPT 页数</p>
          <div className="flex items-end gap-2">
            <span className="text-5xl font-bold text-white">{balance.toLocaleString()}</span>
            <span className="text-blue-400 text-lg mb-1">页</span>
          </div>
          {balance === 0 && (
            <p className="text-yellow-400 text-sm mt-2">⚠️ 配额已用完，请充值继续使用</p>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-900 rounded-xl p-1 mb-6">
          {([['overview', '使用记录'], ['recharge', '充值'], ['history', '订单']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === key ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-gray-200'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {tab === 'overview' && (
          <div className="space-y-2">
            {ledger.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-12">暂无记录，注册赠送的页数在这里显示</p>
            ) : ledger.slice(0, 15).map((e) => (
              <div key={e.id} className="bg-gray-900 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{kindLabel[e.kind] ?? e.kind}</div>
                  {e.note && <div className="text-xs text-gray-500 mt-0.5">{e.note}</div>}
                  <div className="text-xs text-gray-600 mt-0.5">
                    {new Date(e.created_at * 1000).toLocaleString('zh-CN')}
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-semibold tabular-nums ${e.delta > 0 ? 'text-green-400' : 'text-orange-400'}`}>
                    {e.delta > 0 ? '+' : ''}{e.delta} 页
                  </div>
                  <div className="text-xs text-gray-500">余 {e.balance} 页</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Recharge */}
        {tab === 'recharge' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {packages.map((pkg) => (
                <button key={pkg.id} onClick={() => recharge(pkg)} disabled={recharging}
                  className="bg-gray-900 hover:bg-gray-800 disabled:opacity-50 border border-gray-700 hover:border-blue-500 rounded-2xl p-5 text-left transition-all group">
                  <div className="text-2xl font-bold text-white group-hover:text-blue-400 transition-colors">
                    ¥{(pkg.amountFen / 100).toFixed(pkg.amountFen % 100 === 0 ? 0 : 1)}
                  </div>
                  <div className="text-blue-400 font-semibold mt-1">{pkg.pages.toLocaleString()} 页</div>
                  <div className="text-xs text-gray-500 mt-1">{pkg.label}</div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    ≈ ¥{(pkg.amountFen / pkg.pages / 100).toFixed(3)}/页
                  </div>
                </button>
              ))}
            </div>
            {rechargeMsg && (
              <div className={`rounded-xl px-4 py-3 text-sm border ${
                rechargeMsg.startsWith('✅')
                  ? 'bg-green-950 border-green-800 text-green-400'
                  : 'bg-red-950 border-red-800 text-red-400'
              }`}>
                {rechargeMsg}
              </div>
            )}
            <div className="bg-gray-900/50 rounded-xl p-4 text-xs text-gray-500 space-y-1">
              <p>💡 页数配额永久有效，不过期</p>
              <p>💡 新用户注册赠送 20 页，用于体验</p>
              <p>💡 当前为演示模式（自动确认），生产环境接入真实支付</p>
            </div>
          </div>
        )}

        {/* Order history */}
        {tab === 'history' && (
          <div className="space-y-2">
            {transactions.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-12">暂无充值记录</p>
            ) : transactions.map((tx) => (
              <div key={tx.id} className="bg-gray-900 rounded-xl p-4 flex justify-between items-center">
                <div>
                  <div className="text-sm font-medium">
                    充值 ¥{(tx.amount_fen / 100).toFixed(tx.amount_fen % 100 === 0 ? 0 : 1)}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {tx.payment_method ?? '-'} · {new Date(tx.created_at * 1000).toLocaleDateString('zh-CN')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-green-400">+{tx.tokens.toLocaleString()} 页</div>
                  <div className={`text-xs mt-0.5 ${
                    tx.status === 'paid' ? 'text-green-600' :
                    tx.status === 'pending' ? 'text-yellow-500' : 'text-red-500'
                  }`}>
                    {tx.status === 'paid' ? '✓ 已完成' : tx.status === 'pending' ? '⏳ 待支付' : '✗ 失败'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
