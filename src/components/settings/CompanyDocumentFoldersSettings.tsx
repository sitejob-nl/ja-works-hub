import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Folder, Lock, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { unwrap, unwrapDeleted, unwrapList } from '@/lib/db';
import { qk } from '@/lib/query-keys';
import { slugify } from '@/lib/slugify';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  CONFIGURABLE_FOLDER_ROLES,
  FINANCE_PERMISSION,
  FOLDER_ROLE_LABELS,
  describeFolderAccess,
  isRestrictedFolder,
  toggleFolderRole,
  type CompanyDocumentFolder,
} from '@/lib/company-document-folders';

type FolderPatch = Partial<Pick<CompanyDocumentFolder, 'label' | 'allowed_roles' | 'required_permission'>>;

const friendlyError = (error: Error): string => {
  const message = error.message ?? '';
  // FK vanaf documents: de map is niet leeg.
  if (message.includes('foreign key') || message.includes('23503')) {
    return 'Deze map bevat nog documenten — verplaats die eerst naar een andere map';
  }
  if (message.includes('duplicate key') || message.includes('23505')) {
    return 'Er bestaat al een map met deze naam';
  }
  return message || 'Er ging iets mis';
};

/** Naam van een map, inline te wijzigen; slaat op bij Enter of als het veld de focus verliest. */
const FolderLabel = ({ value, onSave }: { value: string; onSave: (label: string) => void }) => {
  const [draft, setDraft] = useState(value);
  const commit = () => {
    const next = draft.trim();
    if (!next) {
      setDraft(value);
      return;
    }
    if (next !== value) onSave(next);
  };
  return (
    <Input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') setDraft(value);
      }}
      className="h-8 max-w-xs"
      aria-label="Naam van de map"
    />
  );
};

const CompanyDocumentFoldersSettings = () => {
  const orgId = useOrganizationId();
  const queryClient = useQueryClient();
  const [newLabel, setNewLabel] = useState('');

  const { data: folders = [], isLoading } = useQuery({
    queryKey: qk.companyDocuments.folders(orgId),
    queryFn: () => unwrapList<CompanyDocumentFolder>(
      supabase
        .from('company_document_folders')
        .select('id, key, label, sort_order, is_default, allowed_roles, required_permission')
        .eq('organization_id', orgId)
        .order('sort_order'),
    ),
    enabled: !!orgId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['company-document-folders'] });
  };

  const addMutation = useMutation({
    mutationFn: async () => {
      const label = newLabel.trim();
      if (!label) throw new Error('Vul een mapnaam in');
      const key = slugify(label);
      if (!key) throw new Error('Deze naam levert geen geldige sleutel op');
      const maxSort = folders.reduce((max, item) => Math.max(max, item.sort_order ?? 0), 0);
      await unwrap(supabase.from('company_document_folders').insert({
        organization_id: orgId,
        key,
        label,
        sort_order: maxSort + 10,
      }).select('id').single());
    },
    onSuccess: () => {
      setNewLabel('');
      invalidate();
      toast.success('Map toegevoegd');
    },
    onError: (error: Error) => toast.error(friendlyError(error)),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: FolderPatch }) =>
      unwrap(supabase.from('company_document_folders').update(patch).eq('id', id).select('id').single()),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(friendlyError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => unwrapDeleted(supabase.from('company_document_folders').delete().eq('id', id)),
    onSuccess: () => {
      invalidate();
      toast.success('Map verwijderd');
    },
    onError: (error: Error) => toast.error(friendlyError(error)),
  });

  if (isLoading) return <div className="text-sm text-muted-foreground">Laden...</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Folder className="h-4 w-4" /> Documentmappen opdrachtgevers
        </CardTitle>
        <CardDescription>
          Documenten bij een opdrachtgever staan per map bij elkaar. Per map bepaal je welke rollen hem zien;
          wie geen toegang heeft ziet de map niet en kan het bestand ook niet openen. Beheerders zien altijd alles.
          &ldquo;Alleen met recht Finance bekijken&rdquo; volgt de rechtenmatrix onder Rechten.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addMutation.mutate();
            }}
            placeholder="Nieuwe map, bijv. Veiligheid"
          />
          <Button onClick={() => addMutation.mutate()} disabled={!newLabel.trim() || addMutation.isPending} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Toevoegen
          </Button>
        </div>

        <div className="space-y-3">
          {folders.map((folder) => (
            <div key={folder.id} className="rounded-md border p-3 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                <FolderLabel value={folder.label} onSave={(label) => updateMutation.mutate({ id: folder.id, patch: { label } })} />
                {folder.is_default && <Badge variant="secondary" className="text-xs">Standaardmap</Badge>}
                {isRestrictedFolder(folder) && (
                  <Badge variant="outline" className="text-xs gap-1">
                    <Lock className="h-3 w-3" /> Afgeschermd
                  </Badge>
                )}
                <div className="flex-1" />
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-red-600"
                  disabled={folder.is_default || deleteMutation.isPending}
                  title={folder.is_default ? 'De standaardmap kan niet worden verwijderd' : 'Map verwijderen'}
                  aria-label={`Map ${folder.label} verwijderen`}
                  onClick={() => deleteMutation.mutate(folder.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                <span className="text-muted-foreground">Zichtbaar voor</span>
                <label className="flex items-center gap-2">
                  <Checkbox checked disabled aria-label="Admin (altijd)" />
                  {FOLDER_ROLE_LABELS.admin}
                </label>
                {CONFIGURABLE_FOLDER_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-2">
                    <Checkbox
                      checked={folder.allowed_roles.includes(role)}
                      disabled={folder.is_default || updateMutation.isPending}
                      onCheckedChange={(checked) => updateMutation.mutate({
                        id: folder.id,
                        patch: { allowed_roles: toggleFolderRole(folder.allowed_roles, role, checked === true) },
                      })}
                    />
                    {FOLDER_ROLE_LABELS[role]}
                  </label>
                ))}
                <label className="flex items-center gap-2">
                  <Switch
                    checked={folder.required_permission === FINANCE_PERMISSION}
                    disabled={folder.is_default || updateMutation.isPending}
                    onCheckedChange={(checked) => updateMutation.mutate({
                      id: folder.id,
                      patch: { required_permission: checked ? FINANCE_PERMISSION : null },
                    })}
                  />
                  Alleen met recht Finance bekijken
                </label>
              </div>

              <p className="text-xs text-muted-foreground">
                {folder.is_default
                  ? 'Altijd zichtbaar voor alle interne rollen; documenten zonder map landen hier.'
                  : `Zichtbaar voor: ${describeFolderAccess(folder)}`}
              </p>
            </div>
          ))}
          {folders.length === 0 && <p className="text-sm text-muted-foreground">Nog geen mappen</p>}
        </div>
      </CardContent>
    </Card>
  );
};

export default CompanyDocumentFoldersSettings;
