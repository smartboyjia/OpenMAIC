'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface UserInfo {
  id: string;
  email: string;
  role: string;
}

interface LedgerEntry {
  id: string;
  delta: number;
  balance: number;
  kind: string;
  note: string | null;
  created_at: number;
}

interface Transaction {
  id: string;
  amount_fen: number;
  tokens: number;
  status: string;
  payment_method: string | null;
  created_at: number;
  paid_at: number | null;
}

interface Package {
  id: string;
  label: string;
  amountFen: number;
  tokens: number;
}

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
  const [tab, setTab] = useState<'overview' | 'ledger' | 'recharge'>('overview');

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
    } catch {
      router.push('/billing/login');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function logout() {
    await fetch('/api/billing/auth?action=logout', { method: 'POST' });
    router.push('/billing/login');
  }

  async function recharge(pkg: Package) {
    setRecharging(true);
    setRechargeMsg('');
    try {
      // In dev mode, auto-confirm; in prod remove ?confirm=1
      const res = await fetch('/api/billing/recharge?confirm=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.id, paymentMethod: 'manual' }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setRechargeMsg(`✅ 充值成功！获得 ${pkg.tokens.toLocaleString()} Tokens`);
      await load();
    } catch (e) {
      setRechargeMsg(`❌ ${e instanceof Error ? e.message : '充值失败'}`);
    } finally {
      setRecharging(false);
    }
  }

  function fmtTime(ts: number) {
    return new Date(ts * 1000).toLocaleString('zh-CN');
  }

  function fmtTokens(n: number) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
    return String(n);
  }

  const kindLabel: Record<string, string> = {
    gift: '🎁 赠送',
    purchase: '💳 充值',
    usage: '🤖 消耗',
    refund: '↩️ 退款',
    admin: '🔧 管理员',
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-gray-500">加载中…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-lg">Token 钱包</h1>
          <p className="text-gray-500 text-sm">{user?.email}</p>
        </div>
        <div className="flex gap-3 items-center">
          {user?.role === 'admin' && (
            <a href="/billing/admin" className="text-sm text-yellow-400 hover:underline">
              管理后台
            </a>
          )}
          <button onClick={logout} className="text-sm text-gray-500 hover:text-gray-300">
            退出
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-6">
        {/* Balance card */}
        <div className="bg-gradient-to-br from-blue-900/40 to-purple-900/40 border border-blue-800/50 rounded-2xl p-6 mb-6">
          <p className="text-sm text-blue-300 mb-1">当前余额</p>
          <div className="text-5xl font-bold text-white mb-1">
            {fmtTokens(balance)}
          </div>
          <p className="text-sm text-blue-400">Tokens</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-900 rounded-xl p-1 mb-6">
          {([['overview', '概览'], ['recharge', '充值'], ['ledger', '账单']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                tab === key
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Overview */}
        {tab === 'overview' && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-gray-400">最近消费</h3>
            {ledger.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-8">暂无记录</p>
            ) : (
              ledger.slice(0, 10).map((e) => (
                <div key={e.id} className="bg-gray-900 rounded-xl p-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{kindLabel[e.kind] ?? e.kind}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{e.note ?? ''}</div>
                    <div className="text-xs text-gray-600 mt-0.5">{fmtTime(e.created_at)}</div>
                  </div>
                  <div className="text-right">
                    <div className={`font-semibold ${e.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {e.delta > 0 ? '+' : ''}{fmtTokens(e.delta)}
                    </div>
                    <div className="text-xs text-gray-500">余额 {fmtTokens(e.balance)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* Recharge */}
        {tab === 'recharge' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              {packages.map((pkg) => (
                <button
                  key={pkg.id}
                  onClick={() => recharge(pkg)}
                  disabled={recharging}
                  className="bg-gray-900 hover:bg-gray-800 disabled:opacity-50 border border-gray-700 hover:border-blue-600 rounded-xl p-4 text-center transition-all"
                >
                  <div className="text-xl font-bold text-white">{pkg.label}</div>
                  <div className="text-sm text-blue-400 mt-1">{fmtTokens(pkg.tokens)} Tokens</div>
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
            <p className="text-xs text-gray-600 text-center">
              * 当前为演示模式（自动确认）。生产环境需接入微信支付/支付宝。
            </p>
          </div>
        )}

        {/* Ledger */}
        {tab === 'ledger' && (
          <div className="space-y-2">
            {transactions.length === 0 ? (
              <p className="text-gray-600 text-sm text-center py-8">暂无充值记录</p>
            ) : (
              transactions.map((tx) => (
                <div key={tx.id} className="bg-gray-900 rounded-xl p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="text-sm font-medium">
                        充值 {(tx.amount_fen / 100).toFixed(2)} 元
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {tx.payment_method ?? '-'} · {fmtTime(tx.created_at)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-green-400">+{fmtTokens(tx.tokens)}</div>
                      <div className={`text-xs mt-0.5 ${
                        tx.status === 'paid' ? 'text-green-600' :
                        tx.status === 'pending' ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {tx.status === 'paid' ? '✓ 已付款' : tx.status === 'pending' ? '⏳ 待付款' : '✗ 失败'}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
