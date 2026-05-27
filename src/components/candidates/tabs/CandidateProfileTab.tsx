import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/lib/format';
import { Copy, Check, MessageCircle, Mail, Link2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useDecryptedCandidate } from '@/hooks/useDecryptedCandidate';
import { usePublicUrl } from '@/hooks/usePublicUrl';
import SensitiveField from '@/components/ui/sensitive-field';
import CustomFieldsSection from '@/components/shared/CustomFieldsSection';

const Field = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm mt-0.5">{value || '—'}</p>
  </div>
);

const CandidateProfileTab = ({ candidate }: { candidate: any }) => {
  const qc = useQueryClient();
  const [copied, setCopied] = useState(false);
  const { buildUrl } = usePublicUrl();
  const { data: sensitive, isLoading: sensitiveLoading } = useDecryptedCandidate(candidate.id);
  const address = [candidate.address_street, candidate.address_postal, candidate.address_city].filter(Boolean).join(', ') || null;

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
    const subject = encodeURIComponent('Vul je profiel aan');
    const body = encodeURIComponent(`Hoi ${candidate.first_name},\n\nVul je profiel aan via deze link:\n${profileUrl}\n\nMet vriendelijke groet`);
    window.open(`mailto:${candidate.email ?? ''}?subject=${subject}&body=${body}`);
  };

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
      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Persoonsgegevens</h3>
        <Field label="Voornaam" value={candidate.first_name} />
        <Field label="Achternaam" value={candidate.last_name} />
        <Field label="Geboortedatum" value={formatDate(candidate.date_of_birth)} />
        <Field label="Nationaliteit" value={candidate.nationality} />
        <SensitiveField label="BSN" value={sensitive?.decrypted_bsn} loading={sensitiveLoading} />
        <SensitiveField label="IBAN" value={sensitive?.decrypted_iban} loading={sensitiveLoading} />
      </div>

      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Contactgegevens</h3>
        <Field label="E-mail" value={candidate.email} />
        <Field label="Telefoon" value={candidate.phone} />
        <Field label="Adres" value={address} />
      </div>

      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Vaardigheden & certificaten</h3>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Vaardigheden</p>
          <div className="flex flex-wrap gap-1">
            {(candidate.skills ?? []).length > 0
              ? candidate.skills.map((s: string) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)
              : <span className="text-sm text-muted-foreground">—</span>}
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Certificaten</p>
          <div className="flex flex-wrap gap-1">
            {(candidate.certifications ?? []).length > 0
              ? candidate.certifications.map((c: string) => <Badge key={c} variant="outline" className="text-xs">{c}</Badge>)
              : <span className="text-sm text-muted-foreground">—</span>}
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Talen</p>
          <div className="flex flex-wrap gap-1">
            {(candidate.languages ?? []).length > 0
              ? candidate.languages.map((l: string) => <Badge key={l} variant="outline" className="text-xs">{l}</Badge>)
              : <span className="text-sm text-muted-foreground">—</span>}
          </div>
        </div>
      </div>

      <div className="bg-card rounded-lg border p-6 space-y-4">
        <h3 className="font-medium">Beschikbaarheid</h3>
        <Field label="Beschikbaarheid notities" value={candidate.availability_notes} />
        <div>
          <p className="text-xs text-muted-foreground">Rijbewijs</p>
          <p className="text-sm mt-0.5">
            {candidate.has_drivers_license ? 'Ja' : 'Nee'}
            {candidate.has_drivers_license && candidate.drivers_license_expiry && ` — verloopt ${formatDate(candidate.drivers_license_expiry)}`}
          </p>
        </div>
        <Field label="Bron" value={candidate.source} />
        {candidate.notes && (
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground mb-1">Notities</p>
            <p className="text-sm whitespace-pre-wrap">{candidate.notes}</p>
          </div>
        )}
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
    </div>
  );
};

export default CandidateProfileTab;
