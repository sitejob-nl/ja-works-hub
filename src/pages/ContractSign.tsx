import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { FileText, CheckCircle2, AlertTriangle } from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const ContractSign = () => {
  const { token } = useParams<{ token: string }>();
  const [fullName, setFullName] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [signed, setSigned] = useState(false);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [signatureRequestId, setSignatureRequestId] = useState<string | null>(null);

  const { data: contract, isLoading, error } = useQuery({
    queryKey: ['contract-sign', token],
    queryFn: async () => {
      if (!token) throw new Error('Geen token');
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/contract-sign?token=${encodeURIComponent(token)}`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Contract niet gevonden');
      return body.contract;
    },
    enabled: !!token,
    retry: false,
  });

  const signContract = useMutation({
    mutationFn: async () => {
      if (!contract || !token) throw new Error('Geen contract');
      const res = await fetch(`${SUPABASE_URL}/functions/v1/contract-sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ token, full_name: fullName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.already_signed) {
          setSigned(true);
          return data;
        }
        throw new Error(data.error || 'Ondertekenen mislukt');
      }
      return data;
    },
    onSuccess: (data) => {
      setSigned(true);
      if (data?.signed_at) setSignedAt(data.signed_at);
      if (data?.signature_request_id) setSignatureRequestId(data.signature_request_id);
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Contract laden...</div>
      </div>
    );
  }

  if (error || !contract) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <div className="bg-card border rounded-xl p-8 max-w-md text-center space-y-3">
          <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
          <h1 className="text-lg font-semibold">Contract niet gevonden</h1>
          <p className="text-sm text-muted-foreground">
            Deze link is ongeldig of het contract is al verwerkt.
          </p>
        </div>
      </div>
    );
  }

  const alreadySigned = contract.status === 'getekend' || signed;

  if (alreadySigned) {
    const displayDate = signedAt || contract.signed_at;
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <div className="bg-card border rounded-xl p-8 max-w-md text-center space-y-3">
          <CheckCircle2 className="h-12 w-12 text-stat-green mx-auto" />
          <h1 className="text-lg font-semibold">Contract getekend</h1>
          <p className="text-sm text-muted-foreground">
            {contract.title} is succesvol digitaal ondertekend.
            {displayDate && (
              <> Op {new Date(displayDate).toLocaleDateString('nl-NL')}.</>
            )}
          </p>
          {(signatureRequestId || contract.signature_request_id) && (
            <p className="text-xs text-muted-foreground font-mono break-all">Bewijs-ID: {signatureRequestId || contract.signature_request_id}</p>
          )}
          <p className="text-xs text-muted-foreground">U kunt dit venster sluiten.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-card border rounded-xl p-6 flex items-center gap-4">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <FileText className="h-6 w-6 text-stat-blue" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">{contract.title}</h1>
            <p className="text-sm text-muted-foreground">
              Lees het contract hieronder door en onderteken digitaal.
            </p>
          </div>
        </div>

        {/* Contract content */}
        <div className="bg-card border rounded-xl p-6 md:p-8">
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed">
            {contract.content}
          </div>
        </div>

        {/* Signing section */}
        <div className="bg-card border rounded-xl p-6 space-y-4">
          <h2 className="font-semibold">Digitaal ondertekenen</h2>

          <div className="space-y-2">
            <Label htmlFor="fullName">Uw volledige naam</Label>
            <Input
              id="fullName"
              placeholder="Voornaam Achternaam"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="max-w-sm"
            />
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="agree"
              checked={agreed}
              onCheckedChange={(v) => setAgreed(v === true)}
              className="mt-0.5"
            />
            <Label htmlFor="agree" className="text-sm leading-snug cursor-pointer">
              Ik heb het bovenstaande contract gelezen en ga akkoord met de inhoud en voorwaarden.
            </Label>
          </div>

          <Button
            onClick={() => signContract.mutate()}
            disabled={!fullName.trim() || !agreed || signContract.isPending}
            className="w-full sm:w-auto"
          >
            {signContract.isPending ? 'Ondertekenen...' : 'Contract ondertekenen'}
          </Button>

          {signContract.isError && (
            <p className="text-sm text-destructive">
              Er is een fout opgetreden. Probeer het opnieuw.
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Door te ondertekenen bevestigt u uw identiteit en gaat u akkoord met de voorwaarden. 
            Uw naam, tijdstip en IP-adres worden vastgelegd.
          </p>
        </div>
      </div>
    </div>
  );
};

export default ContractSign;
