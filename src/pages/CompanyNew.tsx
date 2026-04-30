import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useExactActive } from '@/hooks/useExactActive';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ChevronRight, Loader2, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';

const CompanyNew = () => {
  const orgId = useOrganizationId();
  const exactActive = useExactActive();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: '', kvk_number: '', btw_number: '',
    address_street: '', address_postal: '', address_city: '',
    phone: '', email: '', website: '', notes: '',
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // KVK naam-zoek (debounced)
  const [kvkResults, setKvkResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [kvkSearching, setKvkSearching] = useState(false);
  const [kvkApplying, setKvkApplying] = useState(false);
  const skipNextSearchRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false;
      return;
    }
    if (form.kvk_number) return;
    const term = form.name.trim();
    if (term.length < 3) {
      setKvkResults([]);
      setShowResults(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setKvkSearching(true);
      try {
        const { data, error } = await supabase.functions.invoke('kvk-lookup', { body: { name: term } });
        if (cancelled) return;
        if (error) {
          // FunctionsHttpError bevat de response — probeer die uit te lezen
          let detail = error.message || 'KVK-zoek mislukt';
          try {
            const ctx = (error as any).context;
            if (ctx && typeof ctx.json === 'function') {
              const body = await ctx.json();
              if (body?.error) detail = body.error;
            }
          } catch { /* ignore */ }
          console.error('[kvk-lookup] error:', error, 'detail:', detail);
          toast.error(`KVK-zoek mislukt: ${detail}`);
          return;
        }
        console.log('[kvk-lookup] response:', data);
        const list: any[] = data?.resultaten || data?._embedded?.resultaten || [];
        setKvkResults(list.slice(0, 8));
        setShowResults(list.length > 0);
        if (list.length === 0) {
          toast.info(`Geen KVK-resultaten voor "${term}"`);
        }
      } finally {
        if (!cancelled) setKvkSearching(false);
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
  }, [form.name, form.kvk_number]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectKvkResult = async (r: any) => {
    setShowResults(false);
    setKvkResults([]);
    setKvkApplying(true);
    const fallbackName = r.handelsnaam || r.naam || r.eersteHandelsnaam || form.name;
    skipNextSearchRef.current = true;
    setForm((f) => ({ ...f, name: fallbackName, kvk_number: r.kvkNummer }));
    try {
      const { data, error } = await supabase.functions.invoke('kvk-lookup', { body: { kvk_number: r.kvkNummer } });
      if (error) throw error;
      setForm((f) => ({
        ...f,
        name: data?.name || fallbackName,
        kvk_number: data?.kvk_number || r.kvkNummer,
        address_street: data?.visit_address?.street || f.address_street,
        address_postal: data?.visit_address?.postal || f.address_postal,
        address_city: data?.visit_address?.city || f.address_city,
      }));
      toast.success('KVK-gegevens overgenomen');
    } catch (e: any) {
      toast.error(e.message || 'Volledige KVK-gegevens konden niet worden opgehaald');
    } finally {
      setKvkApplying(false);
    }
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.from('companies').insert({ ...form, organization_id: orgId }).select('id').single();
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      logAudit({ action: 'create', tableName: 'companies', recordId: data.id, newValues: form });
      toast.success('Opdrachtgever aangemaakt');
      // Auto-sync naar Exact Online als koppeling actief is
      if (exactActive) {
        supabase.functions.invoke('exact-sync-account', { body: { company_id: data.id } })
          .then(({ data: res }) => { if (res?.success) toast.success('Relatie gesynchroniseerd naar Exact'); })
          .catch(() => {}); // silent fail
      }
      navigate(`/opdrachtgevers/${data.id}`);
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 text-sm text-muted-foreground">
        <Link to="/opdrachtgevers" className="hover:text-foreground transition-colors">Opdrachtgevers</Link>
        <ChevronRight className="h-3 w-3" />
        <span className="text-foreground">Nieuwe opdrachtgever</span>
      </div>

      <h1 className="text-2xl font-semibold">Nieuwe opdrachtgever</h1>

      <div className="bg-card rounded-lg border p-6 max-w-3xl">
        <div className="space-y-5">
          <div className="space-y-1.5">
            <Label>Bedrijfsnaam *</Label>
            <div className="relative" ref={wrapperRef}>
              <Input
                value={form.name}
                onChange={(e) => {
                  set('name', e.target.value);
                  if (form.kvk_number) set('kvk_number', '');
                }}
                onFocus={() => { if (kvkResults.length > 0) setShowResults(true); }}
                placeholder="Begin te typen om te zoeken in KVK..."
              />
              {(kvkSearching || kvkApplying) && (
                <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {showResults && kvkResults.length > 0 && (
                <div className="absolute z-20 mt-1 w-full bg-popover border rounded-md shadow-md max-h-72 overflow-auto">
                  {kvkResults.map((r, i) => {
                    const naam = r.handelsnaam || r.naam || r.eersteHandelsnaam || '(onbekend)';
                    const plaats = r.plaats || r.adres?.binnenlandsAdres?.plaats || '';
                    return (
                      <button
                        type="button"
                        key={`${r.kvkNummer}-${r.vestigingsnummer || i}`}
                        onClick={() => selectKvkResult(r)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-start gap-2 border-b last:border-b-0"
                      >
                        <Building2 className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{naam}</div>
                          <div className="text-xs text-muted-foreground">
                            KVK {r.kvkNummer}{plaats ? ` · ${plaats}` : ''}{r.type ? ` · ${r.type}` : ''}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>KVK-nummer</Label><Input value={form.kvk_number} onChange={(e) => set('kvk_number', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>BTW-nummer</Label><Input value={form.btw_number} onChange={(e) => set('btw_number', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5"><Label>Straat</Label><Input value={form.address_street} onChange={(e) => set('address_street', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Postcode</Label><Input value={form.address_postal} onChange={(e) => set('address_postal', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Stad</Label><Input value={form.address_city} onChange={(e) => set('address_city', e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Telefoon</Label><Input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></div>
            <div className="space-y-1.5"><Label>E-mail</Label><Input value={form.email} onChange={(e) => set('email', e.target.value)} /></div>
          </div>
          <div className="space-y-1.5"><Label>Website</Label><Input value={form.website} onChange={(e) => set('website', e.target.value)} /></div>
          <div className="space-y-1.5"><Label>Notities</Label><Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} /></div>

          <div className="flex justify-end gap-3 pt-4 border-t">
            <Button variant="ghost" onClick={() => navigate('/opdrachtgevers')}>Annuleren</Button>
            <Button onClick={() => mutation.mutate()} disabled={!form.name || mutation.isPending}>
              {mutation.isPending ? 'Opslaan...' : 'Opdrachtgever aanmaken'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CompanyNew;
