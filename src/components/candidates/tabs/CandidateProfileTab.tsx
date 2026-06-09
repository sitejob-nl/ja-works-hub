import { useEffect, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDate } from '@/lib/format';
import { Copy, Check, MessageCircle, Mail, Link2, RefreshCw, Pencil, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useDecryptedCandidate } from '@/hooks/useDecryptedCandidate';
import { usePublicUrl } from '@/hooks/usePublicUrl';
import { useOutlookAccounts, useOutlookInvoke } from '@/hooks/useOutlookAccounts';
import { logAudit } from '@/lib/audit';
import SensitiveField from '@/components/ui/sensitive-field';
import TagInput from '@/components/ui/tag-input';
import CustomFieldsSection from '@/components/shared/CustomFieldsSection';
import UnsavedChangesGuard from '@/components/shared/UnsavedChangesGuard';
import { CandidatePreferencesTab } from '@/components/candidates/tabs/CandidatePreferencesTab';

const emptyToNull = (value: string) => value.trim() || null;

const InlineTextField = ({
  id,
  label,
  value,
  displayValue,
  type = 'text',
  multiline = false,
  onSave,
  onDirtyChange,
}: {
  id: string;
  label: string;
  value: string | null | undefined;
  displayValue?: string | null;
  type?: string;
  multiline?: boolean;
  onSave: (value: string | null) => Promise<void>;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saved, setSaved] = useState(value ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) return;
    setDraft(value ?? '');
    setSaved(value ?? '');
  }, [editing, value]);

  const dirty = draft !== saved;
  const updateDraft = (next: string) => {
    setDraft(next);
    onDirtyChange(id, next !== saved);
  };

  const commit = async () => {
    if (!editing) return;
    if (!dirty) {
      setEditing(false);
      onDirtyChange(id, false);
      return;
    }
    setSaving(true);
    try {
      await onSave(emptyToNull(draft));
      setSaved(draft);
      setEditing(false);
      onDirtyChange(id, false);
    } catch {
      onDirtyChange(id, true);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(saved);
    setEditing(false);
    onDirtyChange(id, false);
  };

  if (editing) {
    const commonProps = {
      value: draft,
      autoFocus: true,
      onBlur: commit,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => updateDraft(event.target.value),
      onKeyDown: (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancel();
        }
        if (!multiline && event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (multiline && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          commit();
        }
      },
      className: 'mt-1',
    };

    return (
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        {multiline ? (
          <Textarea {...commonProps} rows={3} />
        ) : (
          <Input {...commonProps} type={type} />
        )}
        {saving && <p className="text-xs text-muted-foreground mt-1">Opslaan...</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group w-full rounded-md text-left -mx-2 px-2 py-1 transition-colors hover:bg-muted/60"
    >
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="block text-sm mt-0.5 whitespace-pre-wrap">{displayValue || value || '—'}</span>
    </button>
  );
};

const InlineBooleanField = ({
  label,
  value,
  onSave,
}: {
  label: string;
  value: boolean | null | undefined;
  onSave: (value: boolean) => Promise<void>;
}) => {
  const [saving, setSaving] = useState(false);
  const save = async (next: boolean) => {
    setSaving(true);
    try {
      await onSave(next);
    } finally {
      setSaving(false);
    }
  };

  return (
    <label className="flex items-center justify-between gap-3 rounded-md -mx-2 px-2 py-1 hover:bg-muted/60 cursor-pointer">
      <span>
        <span className="block text-xs text-muted-foreground">{label}</span>
        <span className="block text-sm mt-0.5">{value == null ? 'Onbekend' : value ? 'Ja' : 'Nee'}</span>
      </span>
      <span className="flex items-center gap-2">
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        <Checkbox checked={value === true} onCheckedChange={(checked) => save(checked === true)} />
      </span>
    </label>
  );
};

const InlineTagsField = ({
  id,
  label,
  value,
  onSave,
  onDirtyChange,
}: {
  id: string;
  label: string;
  value: string[];
  onSave: (value: string[]) => Promise<void>;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(value ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) return;
    setDraft(value ?? []);
  }, [editing, value]);

  const save = async (next: string[]) => {
    setDraft(next);
    onDirtyChange(id, true);
    setSaving(true);
    try {
      await onSave(next);
      onDirtyChange(id, false);
    } catch {
      onDirtyChange(id, true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-md -mx-2 px-2 py-1 hover:bg-muted/60">
      <button type="button" onClick={() => setEditing(true)} className="group flex items-center gap-1.5 text-xs text-muted-foreground">
        {label}
        <Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
      {editing ? (
        <div className="mt-1">
          <TagInput value={draft} onChange={save} placeholder="Typ + Enter om op te slaan" />
          {saving && <p className="text-xs text-muted-foreground mt-1">Opslaan...</p>}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1 mt-1">
          {value.length > 0
            ? value.map((tag) => <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>)
            : <span className="text-sm text-muted-foreground">—</span>}
        </div>
      )}
    </div>
  );
};

const CandidateProfileTab = ({ candidate }: { candidate: any }) => {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [dirtyEditors, setDirtyEditors] = useState<Record<string, boolean>>({});
  const { buildUrl } = usePublicUrl();
  const callOutlook = useOutlookInvoke();
  const { hasUsableAccounts } = useOutlookAccounts('mail_send');
  const { data: sensitive, isLoading: sensitiveLoading } = useDecryptedCandidate(candidate.id);
  const address = [candidate.address_street, candidate.address_postal, candidate.address_city].filter(Boolean).join(', ') || null;
  const hasDirtyEditor = Object.values(dirtyEditors).some(Boolean);
  const setEditorDirty = (id: string, dirty: boolean) => {
    setDirtyEditors((current) => ({ ...current, [id]: dirty }));
  };

  const updateCandidate = useMutation({
    mutationFn: async ({ patch }: { patch: Record<string, any>; label: string }) => {
      const { error } = await supabase.from('candidates').update(patch as any).eq('id', candidate.id);
      if (error) throw error;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: ['candidate', candidate.id] });
      qc.invalidateQueries({ queryKey: ['candidates'] });
      logAudit({
        action: 'update',
        tableName: 'candidates',
        recordId: candidate.id,
        newValues: variables.patch,
      });
      toast.success(`${variables.label} opgeslagen`);
    },
    onError: (error: any) => toast.error(error.message || 'Opslaan mislukt'),
  });

  const saveField = (label: string, patch: Record<string, any>) =>
    updateCandidate.mutateAsync({ label, patch });

  // Fetch active profile token
  const { data: activeToken, isLoading: tokenLoading } = useQuery({
    queryKey: ['candidate-profile-token', candidate.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidate_profile_tokens')
        .select('*')
        .eq('candidate_id', candidate.id)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const generateToken = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from('candidate_profile_tokens')
        .insert({ organization_id: candidate.organization_id, candidate_id: candidate.id })
        .select('*')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate-profile-token', candidate.id] });
      toast.success('Profiellink aangemaakt');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const profileUrl = activeToken ? buildUrl(`/profiel/${activeToken.token}`) : '';

  const handleCopy = () => {
    navigator.clipboard.writeText(profileUrl);
    setCopied(true);
    toast.success('Link gekopieerd');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleWhatsApp = () => {
    const phone = candidate.phone?.replace(/[^0-9+]/g, '') ?? '';
    const text = `Hoi ${candidate.first_name}, vul je profiel aan via deze link: ${profileUrl}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleEmail = () => {
    if (!candidate.email) return;
    if (!hasUsableAccounts) {
      toast.error('Geen verbonden e-mailaccount gevonden. Koppel eerst Outlook via Instellingen.');
      return;
    }
    sendProfileLinkMutation.mutate();
  };

  const sendProfileLinkMutation = useMutation({
    mutationFn: async () => {
      if (!candidate.email) throw new Error('Geen e-mailadres bekend');
      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#334155;">
          <p>Hoi ${candidate.first_name},</p>
          <p>Vul je profiel aan via onderstaande link:</p>
          <p>
            <a href="${profileUrl}" style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">
              Profiel aanvullen
            </a>
          </p>
          <p style="color:#64748b;font-size:13px;">Lukt de knop niet? Gebruik dan deze link:<br>${profileUrl}</p>
        </div>
      `;
      return callOutlook('outlook-send-mail', {
        to: [candidate.email],
        subject: 'Vul je profiel aan',
        html,
        candidate_id: candidate.id,
      });
    },
    onSuccess: () => toast.success('Uitnodiging verstuurd via het verbonden e-mailaccount'),
    onError: (error: Error) => toast.error(`E-mail versturen mislukt: ${error.message}`),
  });

  const getTokenStatusBadge = () => {
    if (!activeToken) return null;
    if (activeToken.used_at) {
      return <Badge className="bg-stat-green/10 text-stat-green border-0">Profiel aangevuld</Badge>;
    }
    if (activeToken.last_accessed_at) {
      return <Badge className="bg-orange-100 text-orange-700 border-0">Link geopend, nog niet afgerond</Badge>;
    }
    return <Badge className="bg-blue-100 text-blue-700 border-0">Link verstuurd</Badge>;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <UnsavedChangesGuard when={hasDirtyEditor} />
      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Persoonsgegevens</h3>
        <InlineTextField id="first_name" label="Voornaam" value={candidate.first_name} onSave={(value) => saveField('Voornaam', { first_name: value || '' })} onDirtyChange={setEditorDirty} />
        <InlineTextField id="last_name" label="Achternaam" value={candidate.last_name} onSave={(value) => saveField('Achternaam', { last_name: value || '' })} onDirtyChange={setEditorDirty} />
        <InlineTextField id="date_of_birth" label="Geboortedatum" value={candidate.date_of_birth} displayValue={formatDate(candidate.date_of_birth)} type="date" onSave={(value) => saveField('Geboortedatum', { date_of_birth: value })} onDirtyChange={setEditorDirty} />
        <InlineTextField id="nationality" label="Nationaliteit" value={candidate.nationality} onSave={(value) => saveField('Nationaliteit', { nationality: value })} onDirtyChange={setEditorDirty} />
        <SensitiveField label="BSN" value={sensitive?.decrypted_bsn} loading={sensitiveLoading} />
        <SensitiveField label="IBAN" value={sensitive?.decrypted_iban} loading={sensitiveLoading} />
      </div>

      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Contactgegevens</h3>
        <InlineTextField id="email" label="E-mail" value={candidate.email} type="email" onSave={(value) => saveField('E-mail', { email: value })} onDirtyChange={setEditorDirty} />
        <InlineTextField id="phone" label="Telefoon (EU / buitenland)" value={candidate.phone} onSave={(value) => saveField('Telefoon', { phone: value })} onDirtyChange={setEditorDirty} />
        <InlineTextField id="phone_nl" label="Telefoon (NL)" value={candidate.phone_nl} onSave={(value) => saveField('Telefoon NL', { phone_nl: value })} onDirtyChange={setEditorDirty} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <InlineTextField id="emergency_contact_name" label="ICE naam" value={candidate.emergency_contact_name} onSave={(value) => saveField('Noodcontact naam', { emergency_contact_name: value })} onDirtyChange={setEditorDirty} />
          <InlineTextField id="emergency_contact_phone" label="ICE telefoon" value={candidate.emergency_contact_phone} onSave={(value) => saveField('Noodcontact telefoon', { emergency_contact_phone: value })} onDirtyChange={setEditorDirty} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Adres</p>
          <p className="text-sm mb-2">{address || '—'}</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <InlineTextField id="address_street" label="Straat" value={candidate.address_street} onSave={(value) => saveField('Straat', { address_street: value })} onDirtyChange={setEditorDirty} />
            <InlineTextField id="address_postal" label="Postcode" value={candidate.address_postal} onSave={(value) => saveField('Postcode', { address_postal: value })} onDirtyChange={setEditorDirty} />
            <InlineTextField id="address_city" label="Woonplaats" value={candidate.address_city} onSave={(value) => saveField('Woonplaats', { address_city: value })} onDirtyChange={setEditorDirty} />
          </div>
        </div>
        <InlineBooleanField label="Nederlands adres bekend" value={candidate.has_dutch_address} onSave={(value) => saveField('Nederlands adres', { has_dutch_address: value })} />
      </div>

      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Vaardigheden & certificaten</h3>
        <InlineTagsField id="skills" label="Vaardigheden" value={candidate.skills ?? []} onSave={(value) => saveField('Vaardigheden', { skills: value.length ? value : null })} onDirtyChange={setEditorDirty} />
        <InlineTagsField id="certifications" label="Certificaten" value={candidate.certifications ?? []} onSave={(value) => saveField('Certificaten', { certifications: value.length ? value : null })} onDirtyChange={setEditorDirty} />
        <InlineTagsField id="languages" label="Talen" value={candidate.languages ?? []} onSave={(value) => saveField('Talen', { languages: value.length ? value : null })} onDirtyChange={setEditorDirty} />
      </div>

      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Beschikbaarheid</h3>
        <InlineTextField id="availability_notes" label="Beschikbaarheid notities" value={candidate.availability_notes} multiline onSave={(value) => saveField('Beschikbaarheid', { availability_notes: value })} onDirtyChange={setEditorDirty} />
        <InlineBooleanField label="Rijbewijs" value={candidate.has_drivers_license} onSave={(value) => saveField('Rijbewijs', { has_drivers_license: value })} />
        {candidate.has_drivers_license && (
          <InlineTextField id="drivers_license_expiry" label="Verloopdatum rijbewijs" value={candidate.drivers_license_expiry} displayValue={formatDate(candidate.drivers_license_expiry)} type="date" onSave={(value) => saveField('Verloopdatum rijbewijs', { drivers_license_expiry: value })} onDirtyChange={setEditorDirty} />
        )}
        <InlineTextField id="source" label="Bron" value={candidate.source} onSave={(value) => saveField('Bron', { source: value })} onDirtyChange={setEditorDirty} />
        <div className="pt-2 border-t">
          <InlineTextField id="notes" label="Notities" value={candidate.notes} multiline onSave={(value) => saveField('Notities', { notes: value })} onDirtyChange={setEditorDirty} />
        </div>
        {updateCandidate.isPending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Wijziging opslaan...
          </div>
        )}
      </div>

      <div className="md:col-span-2">
        <CandidatePreferencesTab candidateId={candidate.id} />
      </div>

      {/* Profile Link Section - spans full width */}
      <div className="md:col-span-2 bg-card rounded-lg border p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">Profiellink</h3>
          {getTokenStatusBadge()}
        </div>

        {tokenLoading ? (
          <p className="text-sm text-muted-foreground">Laden...</p>
        ) : activeToken ? (
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input value={profileUrl} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4 text-stat-green" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Aangemaakt</p>
                <p className="mt-0.5">{formatDate(activeToken.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Verloopt</p>
                <p className="mt-0.5">{formatDate(activeToken.expires_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Laatst geopend</p>
                <p className="mt-0.5">{activeToken.last_accessed_at ? formatDate(activeToken.last_accessed_at) : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ingevuld op</p>
                <p className="mt-0.5">{activeToken.used_at ? formatDate(activeToken.used_at) : '—'}</p>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              {candidate.phone && (
                <Button variant="outline" size="sm" onClick={handleWhatsApp} className="gap-2">
                  <MessageCircle className="h-3.5 w-3.5" /> Verstuur opnieuw via WhatsApp
                </Button>
              )}
              {candidate.email && (
                <Button variant="outline" size="sm" onClick={handleEmail} disabled={sendProfileLinkMutation.isPending} className="gap-2">
                  <Mail className="h-3.5 w-3.5" /> {sendProfileLinkMutation.isPending ? 'Versturen...' : 'Verstuur opnieuw via email'}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => generateToken.mutate()} disabled={generateToken.isPending} className="gap-2">
                <RefreshCw className="h-3.5 w-3.5" /> Nieuwe link genereren
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Geen actieve profiellink. Genereer een link zodat de kandidaat zelf het profiel kan aanvullen.</p>
            <Button variant="outline" onClick={() => generateToken.mutate()} disabled={generateToken.isPending} className="gap-2">
              <Link2 className="h-4 w-4" /> Profiellink genereren
            </Button>
          </div>
        )}
      </div>

      {/* Custom fields */}
      <CustomFieldsSection entityType="candidate" entityId={candidate.id} />
    </div>
  );
};

export default CandidateProfileTab;
