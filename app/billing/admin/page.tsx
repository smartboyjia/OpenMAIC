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

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState<UserWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [giftTarget, setGiftTarget] = useState('');
  const [giftTokens, setGiftTokens] = useState('100000');
  const [giftNote, setGiftNote] = useState('');
  const [giftMsg, setGiftMsg] = useState('');
  const [giftLoading, setGiftLoading] = useState(false);

  async function loadUsers() {
    try {
      const res = await fetch('/api/billing/admin/users');
      const data = await res.json();
      if (!data.success) {
        if (res.status === 401 || res.status === 403) { router.push('/billing/login'); return; }
        throw new Error(data.error);
      }
      setUsers(data.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadUsers(); }, []);

  async function giftSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGiftLoading(true); setGiftMsg('');
    try {
      const res = await fetch('/api/billing/admin/gift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: giftTarget, tokens: parseInt(giftTokens), note: giftNote }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setGiftMsg(`✅ 已赠送 ${parseInt(giftTokens).toLocaleString()} Tokens 给 ${data.userId}`);
      await loadUsers();
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

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <div className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">🔧 管理后台</h1>
        <a href="/billing" className="text-sm text-blue-400 hover:underline">← 返回钱包</a>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-8">
        {error && (
          <div className="bg-red-950 border border-red-800 rounded-xl px-4 py-3 text-red-400 text-sm">{error}</div>
        )}

        {/* Gift Tokens */}
        <section>
          <h2 className="text-base font-semibold mb-3">🎁 赠送 Tokens</h2>
          <form onSubmit={giftSubmit} className="bg-gray-900 rounded-2xl p-5 space-y-3 border border-gray-800">
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
                <label className="block text-xs text-gray-500 mb-1">Tokens 数量</label>
                <input
                  value={giftTokens}
                  onChange={(e) => setGiftTokens(e.target.value)}
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

        {/* User list */}
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
                        onClick={() => setGiftTarget(u.id)}
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
      </div>
    </div>
  );
}
