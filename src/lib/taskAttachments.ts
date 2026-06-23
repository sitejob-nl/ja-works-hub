import { supabase } from '@/integrations/supabase/client';

/**
 * Uploadt bestanden naar de 'documents' bucket onder {org}/taken/{taskId}/...
 * en registreert ze in task_attachments. Hergebruikt door de create-flow
 * (na het aanmaken van de taak) én de inline upload bij bewerken.
 */
export async function uploadTaskFiles(
  orgId: string,
  taskId: string,
  files: File[],
  uploadedBy: string | null,
): Promise<void> {
  for (const file of files) {
    const ext = file.name.split('.').pop();
    const path = `${orgId}/taken/${taskId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('documents').upload(path, file);
    if (upErr) throw upErr;
    const { error } = await supabase.from('task_attachments').insert({
      organization_id: orgId,
      task_id: taskId,
      name: file.name,
      file_path: path,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: uploadedBy,
    });
    if (error) throw error;
  }
}
