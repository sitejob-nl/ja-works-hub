import type { MyFeedbackDetail } from '../_shared/feedback-contract.ts';
import { MY_FEEDBACK_COLUMNS } from './resolution.ts';

interface Admin {
  from: (table: string) => any;
  storage: { from: (bucket: string) => { createSignedUrl: (path: string, seconds: number) => PromiseLike<{ data: { signedUrl: string } | null; error: unknown }> } };
}

// User and organization must come from requireInternalProfile, never the request body.
export async function readMyFeedback(admin: Admin, userId: string, orgId: string, id: string): Promise<MyFeedbackDetail | null> {
  const { data, error } = await admin.from('feedback_reports')
    .select(`${MY_FEEDBACK_COLUMNS},has_screenshot,screenshot_path`)
    .eq('submitted_by', userId).eq('organization_id', orgId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { screenshot_path: path, ...report } = data;
  let screenshotUrl: string | null = null;
  // Only sign the stored path after ownership is verified. Storage remains private.
  if (path) {
    try {
      const signed = await admin.storage.from('feedback-screenshots').createSignedUrl(path, 300);
      if (!signed.error) screenshotUrl = signed.data?.signedUrl ?? null;
    } catch { /* A temporary storage failure must not hide the report itself. */ }
  }
  return { report, screenshotUrl };
}
