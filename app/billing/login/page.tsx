'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

type Mode = 'login' | 'register';

function BillingAuthForm() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [referralStatus, setReferralStatus] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [referralReward, setReferralReward] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  // 支持 ?ref=DECK-XXXXX URL 参数自动填入
  useState(() => {
    const ref = searchParams.get('ref');
    if (ref) {
      setReferralCode(ref.toUpperCase());
      setMode('register');
      validateCode(ref);
    }
  });

  async function validateCode(code: string) {
    if (!code || code.length < 4) { setReferralStatus('idle'); return; }
    try {
      const res = await fetch(`/api/billing/referral?validate=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (data.success && data.valid) {
        setReferralStatus('valid');
        setReferralReward(data.rewardPages);
      } else {
        setReferralStatus('invalid');
        setReferralReward(0);
      }
    } catch {
      setReferralStatus('idle');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const body: Record<string, string> = { email, password };
      if (mode === 'register' && referralCode) {
        body.referralCode = referralCode;
      }
      const res = await fetch(`/api/billing/auth?action=${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      router.push('/billing');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-white mb-2 text-center">
          {mode === 'login' ? '登录账户' : '注册账户'}
        </h1>
        <p className="text-gray-500 text-sm text-center mb-6">DeckMind · 智课 · 配额管理</p>

        <form onSubmit={submit} className="bg-gray-900 rounded-2xl p-6 space-y-4 border border-gray-800">
          <div>
            <label className="block text-sm text-gray-400 mb-1">邮箱</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              placeholder="至少8位"
            />
          </div>

          {/* 邀请码（仅注册时显示） */}
          {mode === 'register' && (
            <div>
              <label className="block text-sm text-gray-400 mb-1">
                邀请码 <span className="text-gray-600">（可选）</span>
              </label>
              <input
                type="text"
                value={referralCode}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase();
                  setReferralCode(val);
                  if (val.length >= 8) validateCode(val);
                  else setReferralStatus('idle');
                }}
                className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none transition-colors ${
                  referralStatus === 'valid'
                    ? 'border-green-500 focus:border-green-400'
                    : referralStatus === 'invalid'
                    ? 'border-red-500 focus:border-red-400'
                    : 'border-gray-700 focus:border-blue-500'
                }`}
                placeholder="DECK-XXXXXX"
                maxLength={11}
              />
              {referralStatus === 'valid' && (
                <p className="text-green-400 text-xs mt-1">
                  ✓ 有效邀请码！注册后双方各得 {referralReward} 页额外奖励
                </p>
              )}
              {referralStatus === 'invalid' && (
                <p className="text-red-400 text-xs mt-1">✗ 邀请码无效或已失效</p>
              )}
            </div>
          )}

          {error && (
            <div className="bg-red-950 border border-red-800 rounded-lg px-3 py-2 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg py-2.5 text-sm font-medium transition-colors"
          >
            {loading ? '处理中…' : mode === 'login' ? '登录' : '注册'}
          </button>

          <div className="text-center text-sm text-gray-500">
            {mode === 'login' ? (
              <>还没有账户？{' '}
                <button type="button" onClick={() => setMode('register')} className="text-blue-400 hover:underline">
                  注册
                </button>
              </>
            ) : (
              <>已有账户？{' '}
                <button type="button" onClick={() => setMode('login')} className="text-blue-400 hover:underline">
                  登录
                </button>
              </>
            )}
          </div>
          <p className="text-center text-xs text-gray-600">忘记密码？请联系管理员重置</p>
        </form>
      </div>
    </div>
  );
}

export default function BillingAuthPage() {
  return (
    <Suspense>
      <BillingAuthForm />
    </Suspense>
  );
}
