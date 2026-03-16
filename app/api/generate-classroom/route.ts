import { after, type NextRequest } from 'next/server';
import { nanoid } from 'nanoid';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { type GenerateClassroomInput } from '@/lib/server/classroom-generation';
import { runClassroomGenerationJob } from '@/lib/server/classroom-job-runner';
import { createClassroomGenerationJob } from '@/lib/server/classroom-job-store';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { billingGuard } from '@/lib/billing';

export const maxDuration = 30;

/**
 * Estimated token cost for a full classroom generation job.
 * A typical generation uses 50k–200k tokens across all sub-calls.
 * We check 50k upfront; the job runner will commit actual usage.
 */
const CLASSROOM_PREFLIGHT_TOKENS = 50_000;

export async function POST(req: NextRequest) {
  // ── Billing guard ───────────────────────────────────────────────────────
  const guard = await billingGuard(req, CLASSROOM_PREFLIGHT_TOKENS);
  if (guard.error) return guard.error;

  try {
    const rawBody = (await req.json()) as Partial<GenerateClassroomInput>;
    const body: GenerateClassroomInput = {
      requirement: rawBody.requirement || '',
      ...(rawBody.pdfContent ? { pdfContent: rawBody.pdfContent } : {}),
      ...(rawBody.language ? { language: rawBody.language } : {}),
    };
    const { requirement } = body;

    if (!requirement) {
      return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: requirement');
    }

    const baseUrl = buildRequestOrigin(req);
    const jobId = nanoid(10);
    const job = await createClassroomGenerationJob(jobId, body);
    const pollUrl = `${baseUrl}/api/generate-classroom/${jobId}`;

    // The job runs asynchronously; we commit a fixed estimated cost now.
    // For precise per-call deduction, wire guard.commit into the job runner.
    after(() => {
      runClassroomGenerationJob(jobId, body, baseUrl);
      // Deduct estimated usage (50k per job kick-off; actual LLM calls
      // inside the job will add further deductions via billingGuard wrappers
      // on individual generate/* routes if BILLING_ENABLED=true).
      guard.commit(CLASSROOM_PREFLIGHT_TOKENS, `Classroom generation job ${jobId}`, jobId);
    });

    return apiSuccess(
      {
        jobId,
        status: job.status,
        step: job.step,
        message: job.message,
        pollUrl,
        pollIntervalMs: 5000,
      },
      202,
    );
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      'Failed to create classroom generation job',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
