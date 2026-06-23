import { useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Paperclip, FileText, Image as ImageIcon, Download, Trash2, X } from 'lucide-react';
import { formatDate } from '@/lib/format';
import { uploadTaskFiles } from '@/lib/taskAttachments';
import { toast } from 'sonner';

const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic'];
const isImage = (name: string) => {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext ? IMAGE_EXT.includes(ext) : false;
};

const formatSize = (bytes?: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface TaskAttachmentsProps {
  /** Bestaat de taak al? Dan persisted-modus (direct uploaden/verwijderen). */
  taskId?: string | null;
  /** Lokaal gestagede bestanden (create-modus, vóór de taak bestaat). */
  staged: File[];
  setStaged: (files: File[]) => void;
}

const TaskAttachments = ({ taskId, staged, setStaged }: TaskAttachmentsProps) => {
  const orgId = useOrganizationId();
  const { user } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: attachments = [] } = useQuery({
    queryKey: ['task-attachments', taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('task_attachments')
        .select('*')
        .eq('task_id', taskId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!taskId,
  });

  const uploadNow = useMutation({
    mutationFn: async (files: File[]) => {
      if (!taskId) return;
      await uploadTaskFiles(orgId, taskId, files, user?.id ?? null);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-attachments', taskId] });
      toast.success('Bijlage(n) toegevoegd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (att: any) => {
      await supabase.storage.from('documents').remove([att.file_path]);
      const { error } = await supabase.from('task_attachments').delete().eq('id', att.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['task-attachments', taskId] });
      toast.success('Bijlage verwijderd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const openAttachment = async (filePath: string) => {
    const { data, error } = await supabase.storage.from('documents').createSignedUrl(filePath, 300);
    if (error || !data?.signedUrl) {
      toast.error(`Openen mislukt: ${error?.message ?? 'onbekend'}`);
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (picked.length === 0) return;
    if (taskId) {
      uploadNow.mutate(picked);
    } else {
      setStaged([...staged, ...picked]);
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const Icon = (name: string) => (isImage(name) ? ImageIcon : FileText);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium flex items-center gap-1.5">
          <Paperclip className="h-3.5 w-3.5" /> Bijlagen
        </span>
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploadNow.isPending}>
          {uploadNow.isPending ? 'Uploaden…' : 'Bestand toevoegen'}
        </Button>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={onPick} />
      </div>

      {/* Persisted bijlagen (bewerken) */}
      {attachments.map((att: any) => {
        const FileIcon = Icon(att.name);
        return (
          <div key={att.id} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
            <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{att.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {[formatSize(att.size_bytes), formatDate(att.created_at)].filter(Boolean).join(' · ')}
              </p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => openAttachment(att.file_path)} title="Openen">
              <Download className="h-3.5 w-3.5" />
            </Button>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove.mutate(att)} title="Verwijderen">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}

      {/* Gestagede bijlagen (aanmaken) */}
      {staged.map((file, i) => {
        const FileIcon = Icon(file.name);
        return (
          <div key={`${file.name}-${i}`} className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 px-3 py-2">
            <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{file.name}</p>
              <p className="text-[11px] text-muted-foreground">{formatSize(file.size)} · wordt geüpload bij opslaan</p>
            </div>
            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setStaged(staged.filter((_, idx) => idx !== i))} title="Verwijderen">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      })}

      {attachments.length === 0 && staged.length === 0 && (
        <p className="text-xs text-muted-foreground">Nog geen bijlagen. Pdf, foto, Word, etc.</p>
      )}
    </div>
  );
};

export default TaskAttachments;
