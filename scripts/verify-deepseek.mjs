#!/usr/bin/env node
/**
 * 验证 DeepSeek API Key 是否有效
 * 用法: node scripts/verify-deepseek.mjs
 */

import 'dotenv/config';

const apiKey = process.env.DEEPSEEK_API_KEY;
const model = process.env.DEFAULT_MODEL ?? 'deepseek:deepseek-chat';

if (!apiKey || apiKey.startsWith('sk-your')) {
  console.error('❌ DEEPSEEK_API_KEY 未配置，请在 .env.local 中填写真实的 API Key');
  console.error('   申请地址: https://platform.deepseek.com/api_keys');
  process.exit(1);
}

console.log(`🔍 验证 DeepSeek API Key...`);
console.log(`   模型: ${model}`);
console.log(`   Key: ${apiKey.slice(0, 8)}****${apiKey.slice(-4)}`);

try {
  const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: '你好，请回复"OK"' }],
      max_tokens: 10,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(`❌ API 请求失败 (${res.status}): ${err.error?.message ?? res.statusText}`);
    if (res.status === 401) console.error('   → API Key 无效，请检查');
    if (res.status === 402) console.error('   → 账户余额不足，请充值: https://platform.deepseek.com/usage');
    process.exit(1);
  }

  const data = await res.json();
  const reply = data.choices?.[0]?.message?.content ?? '(无回复)';
  const usage = data.usage;

  console.log(`\n✅ API Key 有效！`);
  console.log(`   回复: ${reply}`);
  console.log(`   消耗: 输入 ${usage?.prompt_tokens ?? 0} tokens，输出 ${usage?.completion_tokens ?? 0} tokens`);
  console.log(`\n💡 .env.local 中配置已完成，pnpm dev 重启后生效`);
} catch (e) {
  console.error('❌ 网络错误:', e.message);
  process.exit(1);
}
