import { validateFeedbackResolution } from '../_shared/feedback-contract.ts';

interface Admin { from: (table: string) => any }
export const MY_FEEDBACK_COLUMNS = 'id,number,kind,title,description,steps,expected,created_at,status,resolution,resolved_at,resolution_revision,resolution_read_at,resolution_dismissed_at';

// Caller is authenticated as a superadmin before entering this boundary.
export async function changeFeedbackStatus(admin: Admin, actorId: string, body: Record<string, unknown>) {
  const input = validateFeedbackResolution(body);
  const now = new Date().toISOString();
  const result = await admin.from('feedback_reports').update({
    status: input.status, resolution: input.resolution,
    resolved_at: input.status === 'resolved' ? now : null,
    resolved_by: input.status === 'resolved' ? actorId : null,
    resolution_revision: input.revision + 1, resolution_read_at: null, resolution_dismissed_at: null,
    updated_at: now,
  }).eq('id', input.id).eq('resolution_revision', input.revision).neq('status', input.status).select('*').maybeSingle();
  if (result.error) throw result.error;
  if (result.data) return { report: result.data, changed: true };
  const latest = await admin.from('feedback_reports').select('*').eq('id', input.id).maybeSingle();
  if (latest.error) throw latest.error;
  if (!latest.data) return null;
  // A lost response may be retried. Never change the date, reset read state or
  // resurrect a notification when another operator has since changed the report.
  if (latest.data.status === input.status && latest.data.resolution === input.resolution &&
      [input.revision, input.revision + 1].includes(latest.data.resolution_revision)) {
    return { report: latest.data, changed: false };
  }
  return { conflict: true };
}

// The session supplies organization/user; the client can only acknowledge one
// particular resolution revision, never someone else's or a newer notification.
export async function acknowledgeFeedback(admin: Admin, userId: string, orgId: string, id: string, revision: number, dismiss: boolean) {
  const column = dismiss ? 'resolution_dismissed_at' : 'resolution_read_at';
  const result = await admin.from('feedback_reports').update({ [column]: new Date().toISOString() })
    .eq('id', id).eq('organization_id', orgId).eq('submitted_by', userId)
    .eq('status', 'resolved').eq('resolution_revision', revision).is(column, null).select('id');
  if (result.error) throw result.error;
  return { updated: !!result.data?.length };
}
