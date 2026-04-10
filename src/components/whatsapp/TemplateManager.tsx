import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Search, RefreshCw, Loader2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useWhatsAppQuery, useWhatsAppMutation } from '@/hooks/useWhatsAppApi';
import { TemplateCard } from './TemplateCard';
import { TemplateCreateDialog } from './TemplateCreateDialog';

type StatusFilter = 'all' | 'approved' | 'pending' | 'rejected';

const STATUS_MAP: Record<StatusFilter, string | null> = {
  all: null,
  approved: 'APPROVED',
  pending: 'PENDING',
  rejected: 'REJECTED',
};

export function TemplateManager() {
  const orgId = useOrganizationId();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const deleteMutation = useWhatsAppMutation('delete_template');

  // Fetch templates from Meta API via edge function
  const { data, isLoading } = useWhatsAppQuery('list_templates', undefined, { enabled: true });

  // Templates may be under data.data (Meta API) or data directly
  const allTemplates: any[] = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data)
    ? data
    : [];

  const filtered = allTemplates.filter((t) => {
    if (search && !t.name?.toLowerCase().includes(search.toLowerCase())) return false;
    const statusTarget = STATUS_MAP[statusFilter];
    if (statusTarget && t.status?.toUpperCase() !== statusTarget) return false;
    return true;
  });

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke('whatsapp-templates-sync', {
        body: { organization_id: orgId },
      });
      if (error) throw error;
      toast.success('Templates gesynchroniseerd');
    } catch (err: any) {
      toast.error('Synchronisatie mislukt: ' + (err?.message ?? 'Onbekende fout'));
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async (name: string, id: string) => {
    try {
      await deleteMutation.mutateAsync({ name, id });
      toast.success(`Template "${name}" verwijderd`);
    } catch {
      // error already shown by mutation's onError
    }
  };

  // Normalize template shape: Meta API uses `name`, local DB may use `template_name`
  const normalizedTemplates = filtered.map((t) => ({
    id: t.id ?? t.template_name ?? t.name,
    template_name: t.name ?? t.template_name,
    language: t.language ?? '',
    category: t.category ?? '',
    status: t.status ?? '',
    components: t.components ?? [],
  }));

  const counts = {
    all: allTemplates.length,
    approved: allTemplates.filter((t) => t.status?.toUpperCase() === 'APPROVED').length,
    pending: allTemplates.filter((t) => t.status?.toUpperCase() === 'PENDING').length,
    rejected: allTemplates.filter((t) => t.status?.toUpperCase() === 'REJECTED').length,
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold">Templates</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Synchroniseren
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            Nieuwe template
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Zoek op naam..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9"
        />
      </div>

      {/* Status filter tabs */}
      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
        <TabsList>
          <TabsTrigger value="all" className="text-xs gap-1.5">
            Alle
            {counts.all > 0 && (
              <span className="bg-muted-foreground/20 text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                {counts.all}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="approved" className="text-xs gap-1.5">
            Goedgekeurd
            {counts.approved > 0 && (
              <span className="bg-green-100 text-green-700 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                {counts.approved}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="pending" className="text-xs gap-1.5">
            In afwachting
            {counts.pending > 0 && (
              <span className="bg-yellow-100 text-yellow-700 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                {counts.pending}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="rejected" className="text-xs gap-1.5">
            Afgewezen
            {counts.rejected > 0 && (
              <span className="bg-red-100 text-red-700 rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                {counts.rejected}
              </span>
            )}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : normalizedTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium text-muted-foreground">Geen templates gevonden</p>
            {search || statusFilter !== 'all' ? (
              <p className="text-xs text-muted-foreground mt-0.5">
                Pas je zoekopdracht of filter aan.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground mt-0.5">
                Maak een nieuwe template aan of synchroniseer met Meta.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {normalizedTemplates.map((template) => (
            <TemplateCard key={template.id} template={template} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <TemplateCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
