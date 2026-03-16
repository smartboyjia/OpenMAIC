'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

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

// QR 码有效时长（秒）
const QR_TTL = 120;

export default function BillingPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [packages, setPackages] = useState<Package[]>([]);
  const [alipayEnabled, setAlipayEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'overview' | 'recharge' | 'history'>('overview');

  // 支付状态
  const [paying, setPaying] = useState(false);
  const [payingPkg, setPayingPkg] = useState<Package | null>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [pendingTxId, setPendingTxId] = useState<string | null>(null);
  const [qrExpiry, setQrExpiry] = useState(0); // timestamp
  const [qrSecondsLeft, setQrSecondsLeft] = useState(0);
  const [payResult, setPayResult] = useState<'success' | 'expired' | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearPayState = useCallback(() => {
    setPaying(false);
    setPayingPkg(null);
    setQrCode(null);
    setPendingTxId(null);
    setQrExpiry(0);
    setQrSecondsLeft(0);
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

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
      setAlipayEnabled(pkgs.alipayEnabled ?? false);
      setTransactions(txs.transactions ?? []);
    } catch { router.push('/billing/login'); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => () => { clearPayState(); }, [clearPayState]);

  async function logout() {
    await fetch('/api/billing/auth?action=logout', { method: 'POST' });
    router.push('/billing/login');
  }

  // 轮询支付结果
  function startPolling(txId: string, expiry: number) {
    // 倒计时
    timerRef.current = setInterval(() => {
      const left = Math.max(0, Math.round((expiry - Date.now()) / 1000));
      setQrSecondsLeft(left);
      if (left === 0) {
        setPayResult('expired');
        clearPayState();
      }
    }, 1000);

    // 每 3 秒查一次
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/billing/recharge?action=status&txId=${txId}`);
        const data = await res.json();
        if (data.paid) {
          clearPayState();
          setPayResult('success');
          await load(); // 刷新余额
        }
      } catch { /* ignore */ }
    }, 3000);
  }

  async function recharge(pkg: Package) {
    setPaying(true);
    setPayingPkg(pkg);
    setPayResult(null);

    try {
      // DEV 模式（未配置支付宝）：?confirm=1
      const devMode = !alipayEnabled;
      const url = devMode ? '/api/billing/recharge?confirm=1' : '/api/billing/recharge';

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.id }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? '充值失败');

      if (data.autoConfirmed) {
        // DEV 自动到账
        clearPayState();
        setPayResult('success');
        await load();
        return;
      }

      // 展示二维码
      setQrCode(data.qrCode);
      setPendingTxId(data.transaction.id);
      const expiry = Date.now() + QR_TTL * 1000;
      setQrExpiry(expiry);
      setQrSecondsLeft(QR_TTL);
      startPolling(data.transaction.id, expiry);
    } catch (e) {
      clearPayState();
      alert(e instanceof Error ? e.message : '充值失败');
    }
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
        {/* 成功/失败提示 */}
        {payResult === 'success' && (
          <div className="mb-4 bg-green-950 border border-green-800 rounded-xl px-4 py-3 text-green-400 text-sm flex items-center gap-2">
            <span>✅</span>
            <span>充值成功！页数配额已到账，可以继续生成课堂了。</span>
            <button onClick={() => setPayResult(null)} className="ml-auto text-green-600 hover:text-green-400">✕</button>
          </div>
        )}
        {payResult === 'expired' && (
          <div className="mb-4 bg-yellow-950 border border-yellow-800 rounded-xl px-4 py-3 text-yellow-400 text-sm flex items-center gap-2">
            <span>⏰</span>
            <span>二维码已过期，请重新发起充值。</span>
            <button onClick={() => setPayResult(null)} className="ml-auto text-yellow-600 hover:text-yellow-400">✕</button>
          </div>
        )}

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

        {/* 支付宝二维码弹层 */}
        {qrCode && payingPkg && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => { clearPayState(); }}>
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 text-center max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
              <div className="text-lg font-semibold mb-1">支付宝扫码支付</div>
              <div className="text-blue-400 text-sm mb-4">
                {payingPkg.label} · ¥{(payingPkg.amountFen / 100).toFixed(payingPkg.amountFen % 100 === 0 ? 0 : 1)} → {payingPkg.pages.toLocaleString()} 页
              </div>
              <div className="bg-white rounded-xl p-3 inline-block mx-auto mb-4">
                {/* 支付宝返回的是 https://qr.alipay.com/xxx 链接，需要转成图片 */}
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrCode)}`}
                  alt="支付宝二维码"
                  width={200}
                  height={200}
                  className="block"
                />
              </div>
              <div className="text-gray-500 text-xs mb-2">
                {qrSecondsLeft > 0
                  ? `二维码有效期 ${qrSecondsLeft} 秒 · 支付后自动到账`
                  : '正在验证…'}
              </div>
              <div className="flex items-center justify-center gap-1 text-blue-400 text-xs mb-4">
                <span className="animate-spin">⏳</span>
                <span>等待支付…</span>
              </div>
              <button onClick={() => clearPayState()} className="text-gray-600 hover:text-gray-400 text-sm">取消支付</button>
            </div>
          </div>
        )}

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
              <p className="text-gray-600 text-sm text-center py-12">暂无记录</p>
            ) : ledger.slice(0, 20).map((e) => (
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
                <button key={pkg.id} onClick={() => recharge(pkg)} disabled={paying}
                  className="bg-gray-900 hover:bg-gray-800 disabled:opacity-50 border border-gray-700 hover:border-blue-500 rounded-2xl p-5 text-left transition-all group">
                  <div className="text-2xl font-bold text-white group-hover:text-blue-400 transition-colors">
                    ¥{(pkg.amountFen / 100).toFixed(pkg.amountFen % 100 === 0 ? 0 : 1)}
                  </div>
                  <div className="text-blue-400 font-semibold mt-1">{pkg.pages.toLocaleString()} 页</div>
                  <div className="text-xs text-gray-500 mt-1">{pkg.label}</div>
                  <div className="text-xs text-gray-600 mt-0.5">
                    ¥{(pkg.amountFen / pkg.pages / 100).toFixed(3)}/页
                  </div>
                </button>
              ))}
            </div>
            <div className="bg-gray-900/50 rounded-xl p-4 text-xs text-gray-500 space-y-1">
              <p>💡 页数配额永久有效，不过期</p>
              <p>💡 新用户注册赠送 20 页，用于体验</p>
              {alipayEnabled
                ? <p>💳 支持支付宝扫码支付</p>
                : <p className="text-yellow-600">⚠️ 支付宝未配置，当前为演示模式（自动到账）</p>
              }
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
