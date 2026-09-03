import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderCog, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { unwrap, unwrapDeleted, unwrapList } from '@/lib/db';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';

type CompanyDocumentType = {
  id: string;
  key: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

// eslint-disable-next-line no-misleading-character-class -- combining-diacritics range (NFD-strip), niet mis te lezen als losse tekens
const DIACRITICS_RE = /[̀-ͯ]/g;

const slugify = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_RE, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const CompanyDocumentTypesSettings = () => {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();
  const [newLabel, setNewLabel] = useState('');

  const { data: types = [], isLoading } = useQuery({
    queryKey: ['company-document-types-settings', orgId],
    queryFn: () => unwrapList<CompanyDocumentType>(
      supabase
        .from('company_document_types')
        .select('id, key, label, sort_order, is_active')
        .eq('organization_id', orgId)
        .order('sort_order'),
    ),
    enabled: !!orgId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company-document-types-settings'] });
    queryClient.invalidateQueries({ queryKey: ['company-document-types'] });
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      const label = newLabel.trim();
      if (!label) throw new Error('Vul een documenttype in');
      const key = slugify(label);
      if (!key) throw new Error('Deze naam levert geen geldige sleutel op');
      const maxSort = types.reduce((max, item) => Math.max(max, item.sort_order ?? 0), 0);
      await unwrap(supabase.from('company_document_types').insert({
        organization_id: orgId,
        key,
        label,
        sort_order: maxSort + 10,
        is_active: true,
      }).select('id').single());
    },
    onSuccess: () => {
      setNewLabel('');
      invalidate();
      toast.success('Documenttype toegevoegd');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      unwrap(supabase.from('company_document_types').update({ is_active: isActive }).eq('id', id).select('id').single()),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => unwrapDeleted(supabase.from('company_document_types').delete().eq('id', id)),
    onSuccess: () => {
      invalidate();
      toast.success('Documenttype verwijderd');
    },
    onError: (error: Error) => {
      // FK on delete restrict: het type hangt nog aan bestaande documenten.
      toast.error(
        error.message.includes('foreign key')
          ? 'Dit type is nog in gebruik bij documenten — deactiveer het in plaats van verwijderen'
          : error.message,
      );
    },
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Laden...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <FolderCog className="h-4 w-4" /> Documenttypen opdrachtgevers
        </CardTitle>
        <CardDescription>Beheer welke documenttypen te kiezen zijn bij een opdrachtgever</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addMutation.mutate();
            }}
            placeholder="Nieuw documenttype, bijv. Vergunning"
          />
          <Button onClick={() => addMutation.mutate()} disabled={!newLabel.trim() || addMutation.isPending} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Toevoegen
          </Button>
        </div>

        <div className="space-y-2">
          {types.map((type) => (
            <div key={type.id} className="flex items-center gap-2 rounded-md border p-2">
              <span className="text-sm flex-1">{type.label}</span>
              <Switch checked={type.is_active} onCheckedChange={(checked) => toggleMutation.mutate({ id: type.id, isActive: checked })} />
              <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" onClick={() => deleteMutation.mutate(type.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {types.length === 0 && <p className="text-sm text-muted-foreground">Nog geen documenttypen</p>}
        </div>
      </CardContent>
    </Card>
  );
};

export default CompanyDocumentTypesSettings;
