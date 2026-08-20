import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/format';
import { Copy, Check, MessageCircle, Mail, Link2, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useDecryptedCandidate } from '@/hooks/useDecryptedCandidate';
import { usePublicUrl } from '@/hooks/usePublicUrl';
import { useOutlookAccounts } from '@/hooks/useOutlookAccounts';
import { useAuth } from '@/contexts/AuthContext';
import { logAudit } from '@/lib/audit';
import { CANDIDATE_SOURCES, includeCurrentOption, normalizeCandidateSource } from '@/lib/candidate-options';
import { normalizeCandidatePhone, toWhatsAppNumber } from '@/lib/phone';
import CustomFieldsSection from '@/components/shared/CustomFieldsSection';
import UnsavedChangesGuard from '@/components/shared/UnsavedChangesGuard';
import { InlineTextField, InlineSensitiveField, InlineBooleanField, InlineTagsField, InlineSkillsField, InlineLanguagesField, InlineNationalityField } from '@/components/shared/InlineFields';
import { CandidatePreferencesTab } from '@/components/candidates/tabs/CandidatePreferencesTab';
import EmailSendDialog from '@/components/email/EmailSendDialog';

const asObject = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

const stripGeneratedAvailabilityNotes = (notes?: string | null) =>
  String(notes ?? '')
    .split('\n')
    .filter((line) => !/^\s*(Beschikbaar vanaf|Beschikbaar tot|Aankomst\/check-in):/i.test(line))
    .join('\n')
    .trim();

const buildAvailabilityNotes = (
  availability: { available_from?: string | null; available_until?: string | null; arrival_date?: string | null },
  notes?: string | null,
) => [
  availability.available_from ? `Beschikbaar vanaf: ${availability.available_from}` : null,
  availability.available_until ? `Beschikbaar tot: ${availability.available_until}` : null,
  availability.arrival_date ? `Aankomst/check-in: ${availability.arrival_date}` : null,
  stripGeneratedAvailabilityNotes(notes),
].filter(Boolean).join('\n').trim();

const CandidateProfileTab = ({ candidate }: { candidate: any }) => {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [copied, setCopied] = useState(false);
  const [profileEmailOpen, setProfileEmailOpen] = useState(false);
  const [dirtyEditors, setDirtyEditors] = useState<Record<string, boolean>>({});
  const { buildUrl } = usePublicUrl();
  const { hasUsableAccounts } = useOutlookAccounts('mail_send');
  const { data: sensitive, isLoading: sensitiveLoading } = useDecryptedCandidate(candidate.id);
  const address = [candidate.address_street, candidate.address_postal, candidate.address_city].filter(Boolean).join(', ') || null;
  const screeningData = asObject(candidate.screening_data);
  const screeningAvailability = asObject(screeningData.availability);
  const availability = {
    available_from: String(candidate.available_from ?? screeningAvailability.available_from ?? ''),
    available_until: String(candidate.available_until ?? screeningAvailability.available_until ?? ''),
    arrival_date: String(candidate.arrival_date ?? screeningAvailability.arrival_date ?? ''),
  };
  const availabilityNotes = stripGeneratedAvailabilityNotes(candidate.availability_notes);
  const sourceOptions = includeCurrentOption(CANDIDATE_SOURCES, candidate.source);
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
      if ('bsn' in variables.patch || 'iban' in variables.patch) {
        qc.invalidateQueries({ queryKey: ['candidate-decrypted', candidate.id] });
      }
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

  const saveAvailabilityField = (field: keyof typeof availability, value: string | null) => {
    const nextAvailability = { ...availability, [field]: value ?? '' };
    return saveField('Beschikbaarheid', {
      [field]: value || null,
      screening_data: {
        ...screeningData,
        availability: nextAvailability,
        updated_at: new Date().toISOString(),
      },
      availability_notes: buildAvailabilityNotes(nextAvailability, availabilityNotes) || null,
    });
  };

  const saveAvailabilityNotes = (value: string | null) =>
    saveField('Beschikbaarheid', {
      availability_notes: buildAvailabilityNotes(availability, value) || null,
    });

  const savePhoneField = (label: string, field: 'phone' | 'phone_nl', value: string | null) => {
    const normalized = normalizeCandidatePhone(value);
    if (normalized.phone_nl) {
      return saveField(label, {
        phone_nl: normalized.phone_nl,
        ...(field === 'phone' ? { phone: null } : {}),
      });
    }
    return saveField(label, {
      phone: normalized.phone || null,
      ...(field === 'phone_nl' ? { phone_nl: null } : {}),
    });
  };

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
    const phone = toWhatsAppNumber(candidate.phone_nl || candidate.phone) ?? '';
    const text = `Hoi ${candidate.first_name}, vul je profiel aan via deze link: ${profileUrl}`;
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank');
  };

  const handleEmail = () => {
    if (!candidate.email) return;
    if (!hasUsableAccounts) {
      toast.error('Geen verbonden e-mailaccount gevonden. Koppel eerst Outlook via Instellingen.');
      return;
    }
    setProfileEmailOpen(true);
  };

  const profileEmailSubject = 'Vul je profiel aan';
  const profileEmailHtml = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;color:#334155;">
      <p>Hoi ${candidate.first_name ?? ''},</p>
      <p>Vul je profiel aan via onderstaande link:</p>
      <p>
        <a href="${profileUrl}" style="display:inline-block;background:#1e293b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;">
          Profiel aanvullen
        </a>
      </p>
      <p style="color:#64748b;font-size:13px;">Lukt de knop niet? Gebruik dan deze link:<br>${profileUrl}</p>
    </div>
  `;

  const markProfileTokenSent = async () => {
    if (!activeToken?.id) return;
    const { error } = await (supabase as any)
      .from('candidate_profile_tokens')
      .update({
        sent_at: new Date().toISOString(),
        sent_channel: 'email',
        sent_by: user?.id ?? null,
      })
      .eq('id', activeToken.id);
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ['candidate-profile-token', candidate.id] });
    qc.invalidateQueries({ queryKey: ['candidate-profile-tokens-list'] });
  };

  const getTokenStatusBadge = () => {
    if (!activeToken) return null;
    if (activeToken.used_at) {
      return <Badge className="bg-stat-green/10 text-stat-green border-0">Profiel aangevuld</Badge>;
    }
    if ((activeToken as any).sent_at) {
      return <Badge className="bg-blue-100 text-blue-700 border-0">Link verstuurd</Badge>;
    }
    if (activeToken.last_accessed_at) {
      return <Badge className="bg-orange-100 text-orange-700 border-0">Link geopend, nog niet afgerond</Badge>;
    }
    return <Badge className="bg-slate-100 text-slate-700 border-0">Link aangemaakt</Badge>;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <UnsavedChangesGuard when={hasDirtyEditor} />
      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Persoonsgegevens</h3>
        <InlineTextField id="first_name" label="Voornaam" value={candidate.first_name} onSave={(value) => saveField('Voornaam', { first_name: value || '' })} onDirtyChange={setEditorDirty} />
        <InlineTextField id="last_name" label="Achternaam" value={candidate.last_name} onSave={(value) => saveField('Achternaam', { last_name: value || '' })} onDirtyChange={setEditorDirty} />
        <InlineTextField id="date_of_birth" label="Geboortedatum" value={candidate.date_of_birth} displayValue={formatDate(candidate.date_of_birth)} type="date" onSave={(value) => saveField('Geboortedatum', { date_of_birth: value })} onDirtyChange={setEditorDirty} />
        <InlineNationalityField id="nationality" label="Nationaliteit" value={candidate.nationality} onSave={(value) => saveField('Nationaliteit', { nationality: value || null })} onDirtyChange={setEditorDirty} />
        <InlineSensitiveField
          id="bsn"
          label="BSN"
          value={sensitive?.decrypted_bsn}
          loading={sensitiveLoading}
          placeholder="123456789"
          inputMode="numeric"
          onSave={(value) => saveField('BSN', { bsn: value })}
          onDirtyChange={setEditorDirty}
        />
        <InlineSensitiveField
          id="iban"
          label="IBAN"
          value={sensitive?.decrypted_iban}
          loading={sensitiveLoading}
          placeholder="NL00 BANK 0000 0000 00"
          onSave={(value) => saveField('IBAN', { iban: value })}
          onDirtyChange={setEditorDirty}
        />
      </div>

      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Contactgegevens</h3>
        <InlineTextField id="email" label="E-mail" value={candidate.email} type="email" onSave={(value) => saveField('E-mail', { email: value })} onDirtyChange={setEditorDirty} />
        <InlineTextField id="phone" label="Telefoon (EU / buitenland)" value={candidate.phone} onSave={(value) => savePhoneField('Telefoon', 'phone', value)} onDirtyChange={setEditorDirty} />
        <InlineTextField id="phone_nl" label="Telefoon (NL)" value={candidate.phone_nl} onSave={(value) => savePhoneField('Telefoon NL', 'phone_nl', value)} onDirtyChange={setEditorDirty} />
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
        <div className="border-t pt-4">
          <p className="text-xs text-muted-foreground mb-2">Buitenlands adres</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InlineTextField id="foreign_address_street" label="Straat" value={candidate.foreign_address_street} onSave={(value) => saveField('Buitenlands adres', { foreign_address_street: value })} onDirtyChange={setEditorDirty} />
            <InlineTextField id="foreign_address_postal" label="Postcode" value={candidate.foreign_address_postal} onSave={(value) => saveField('Buitenlands adres', { foreign_address_postal: value })} onDirtyChange={setEditorDirty} />
            <InlineTextField id="foreign_address_city" label="Plaats" value={candidate.foreign_address_city} onSave={(value) => saveField('Buitenlands adres', { foreign_address_city: value })} onDirtyChange={setEditorDirty} />
            <InlineTextField id="foreign_address_country" label="Land" value={candidate.foreign_address_country} onSave={(value) => saveField('Buitenlands adres', { foreign_address_country: value })} onDirtyChange={setEditorDirty} />
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Vaardigheden & certificaten</h3>
        <InlineSkillsField id="skills" label="Vaardigheden" value={candidate.skills ?? []} onSave={(value) => saveField('Vaardigheden', { skills: value.length ? value : null })} onDirtyChange={setEditorDirty} />
        <InlineTagsField id="certifications" label="Certificaten" value={candidate.certifications ?? []} onSave={(value) => saveField('Certificaten', { certifications: value.length ? value : null })} onDirtyChange={setEditorDirty} />
        <InlineLanguagesField id="languages" label="Talen" value={candidate.languages ?? []} onSave={(value) => saveField('Talen', { languages: value.length ? value : null })} onDirtyChange={setEditorDirty} />
      </div>

      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Beschikbaarheid</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <InlineTextField
            id="availability_available_from"
            label="Beschikbaar vanaf"
            value={availability.available_from}
            displayValue={formatDate(availability.available_from)}
            type="date"
            onSave={(value) => saveAvailabilityField('available_from', value)}
            onDirtyChange={setEditorDirty}
          />
          <InlineTextField
            id="availability_available_until"
            label="Beschikbaar tot"
            value={availability.available_until}
            displayValue={availability.available_until ? formatDate(availability.available_until) : 'Open'}
            type="date"
            onSave={(value) => saveAvailabilityField('available_until', value)}
            onDirtyChange={setEditorDirty}
          />
          <InlineTextField
            id="availability_arrival_date"
            label="Aankomst/check-in"
            value={availability.arrival_date}
            displayValue={formatDate(availability.arrival_date)}
            type="date"
            onSave={(value) => saveAvailabilityField('arrival_date', value)}
            onDirtyChange={setEditorDirty}
          />
        </div>
        <InlineTextField id="availability_notes" label="Beschikbaarheidsnotities" value={availabilityNotes} multiline onSave={saveAvailabilityNotes} onDirtyChange={setEditorDirty} />
        <InlineBooleanField label="Rijbewijs" value={candidate.has_drivers_license} onSave={(value) => saveField('Rijbewijs', { has_drivers_license: value })} />
        {candidate.has_drivers_license && (
          <InlineTextField id="drivers_license_expiry" label="Verloopdatum rijbewijs" value={candidate.drivers_license_expiry} displayValue={formatDate(candidate.drivers_license_expiry)} type="date" onSave={(value) => saveField('Verloopdatum rijbewijs', { drivers_license_expiry: value })} onDirtyChange={setEditorDirty} />
        )}
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Bron</p>
          <Select value={candidate.source ?? ''} onValueChange={(value) => saveField('Bron', { source: normalizeCandidateSource(value) || null })}>
            <SelectTrigger className="max-w-xs"><SelectValue placeholder="Selecteer bron" /></SelectTrigger>
            <SelectContent>
              {sourceOptions.map((source) => (
                <SelectItem key={source.value} value={source.value}>{source.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Punt 9 — notities staan uitsluitend op de Notities-tab. Dit tabblad toonde de
            geïmporteerde profieltekst eerst nog alleen-lezen mee; ook dat is weg, want
            twee plekken blijven twee plekken om te lezen. De tekst zelf is niet verdwenen:
            `candidates.notes` staat bovenaan de Notities-tab vastgezet als "Profielnotities",
            met dezelfde ontdubbeling tegen de losse notitierijen. */}
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

            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
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
                <p className="text-xs text-muted-foreground">Verstuurd</p>
                <p className="mt-0.5">{(activeToken as any).sent_at ? formatDate((activeToken as any).sent_at) : '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ingevuld op</p>
                <p className="mt-0.5">{activeToken.used_at ? formatDate(activeToken.used_at) : '—'}</p>
              </div>
            </div>

            <div className="flex gap-2 flex-wrap">
              {(candidate.phone || candidate.phone_nl) && (
                <Button variant="outline" size="sm" onClick={handleWhatsApp} className="gap-2">
                  <MessageCircle className="h-3.5 w-3.5" /> Verstuur opnieuw via WhatsApp
                </Button>
              )}
              {candidate.email && (
                <Button variant="outline" size="sm" onClick={handleEmail} className="gap-2">
                  <Mail className="h-3.5 w-3.5" /> Verstuur opnieuw via email
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
      <EmailSendDialog
        open={profileEmailOpen}
        onOpenChange={setProfileEmailOpen}
        candidateId={candidate.id}
        candidateEmail={candidate.email ?? undefined}
        candidateData={candidate}
        initialSubject={profileEmailSubject}
        initialBodyHtml={profileEmailHtml}
        onSent={markProfileTokenSent}
      />
    </div>
  );
};

export default CandidateProfileTab;
