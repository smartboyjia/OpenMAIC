// GET /api/classroom/list
// 返回当前登录用户的课堂列表
import { promises as fs } from 'fs';
import path from 'path';
import { type NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/server/api-response';
import { requireAuth } from '@/lib/billing';
import { CLASSROOMS_DIR } from '@/lib/server/classroom-storage';

export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth();
    const userId = session.sub;

    // 读取所有课堂文件
    let files: string[] = [];
    try {
      files = await fs.readdir(CLASSROOMS_DIR);
    } catch {
      return apiSuccess({ classrooms: [] });
    }

    const jsonFiles = files.filter(f => f.endsWith('.json'));
    const results = [];

    for (const file of jsonFiles) {
      try {
        const raw = await fs.readFile(path.join(CLASSROOMS_DIR, file), 'utf-8');
        const data = JSON.parse(raw);
        if (data.createdBy === userId) {
          results.push({
            id: data.id,
            name: data.stage?.name || '未命名课堂',
            createdAt: data.createdAt,
            sceneCount: data.scenes?.length ?? 0,
          });
        }
      } catch { /* skip corrupt files */ }
    }

    // 按时间倒序
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return apiSuccess({ classrooms: results });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === 'Unauthorized') return apiError('UNAUTHORIZED', 401, '请先登录');
    return apiError('INTERNAL_ERROR', 500, '获取课堂列表失败', msg);
  }
}
