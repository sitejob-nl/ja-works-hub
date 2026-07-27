import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Copy, Globe2, Loader2, RefreshCw, ShieldCheck, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import SendDnsInstructionsDialog from '@/components/settings/SendDnsInstructionsDialog';
import { defaultPrimaryHostname, normalizeDomainInput, type DomainType } from '@/lib/public-url';
import { invokeDomainManagement, recordLabel, type OrganizationDomain } from '@/lib/domains';

function statusBadge(domain: OrganizationDomain) {
  if (domain.status === 'verified') return <Badge className="gap-1 bg-stat-green/10 text-stat-green border-0"><CheckCircle2 className="h-3 w-3" /> Actief</Badge>;
  if (domain.status === 'misconfigured') return <Badge className="gap-1 bg-orange-100 text-orange-700 border-0"><AlertTriangle className="h-3 w-3" /> DNS controleren</Badge>;
  if (domain.status === 'error') return <Badge variant="destructive">Fout</Badge>;
  return <Badge variant="secondary">In afwachting</Badge>;
}

export default function DomainSettings() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = profile?.role === 'admin';
  const [domainType, setDomainType] = useState<DomainType>('exact');
  const [domainInput, setDomainInput] = useState('');
  const normalizedDomain = useMemo(() => normalizeDomainInput(domainInput, domainType), [domainInput, domainType]);
  const [primaryHostname, setPrimaryHostname] = useState('');

  const domainsQuery = useQuery({
    queryKey: ['organization-domains'],
    queryFn: async () => {
      const result = await invokeDomainManagement<{ domains: OrganizationDomain[] }>({ action: 'list' });
      return result.domains ?? [];
    },
    enabled: isAdmin,
  });

  const domains = domainsQuery.data ?? [];
  const suggestedPrimary = normalizedDomain ? defaultPrimaryHostname(normalizedDomain, domainType) : '';

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['organization-domains'] });
    queryClient.invalidateQueries({ queryKey: ['organization-primary-domain'] });
  };

  const addDomain = useMutation({
    mutationFn: async () => invokeDomainManagement<{ domain: OrganizationDomain }>({
      action: 'add',
      domain: normalizedDomain,
      domain_type: domainType,
      primary_hostname: primaryHostname || suggestedPrimary,
    }),
    onSuccess: () => {
      setDomainInput('');
      setPrimaryHostname('');
      invalidate();
      toast.success('Domein toegevoegd. Controleer de DNS-instructies hieronder.');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const runAction = useMutation({
    mutationFn: async ({ action, id }: { action: string; id: string }) =>
      invokeDomainManagement<{ domain: OrganizationDomain }>({ action, id }),
    onSuccess: (_, variables) => {
      invalidate();
      toast.success(variables.action === 'set_primary' ? 'Primair domein bijgewerkt' : 'Domeinstatus bijgewerkt');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const copy = (value: string) => {
    navigator.clipboard.writeText(value);
    toast.success('Gekopieerd');
  };

  if (!isAdmin) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Globe2 className="h-4 w-4" /> Domeinen</CardTitle>
          <CardDescription>Alleen organisatie-admins kunnen domeinen beheren.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Globe2 className="h-4 w-4" /> Domeinen</CardTitle>
        <CardDescription>Koppel je eigen app-domein via Vercel DNS.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-[180px_1fr_1fr_auto] gap-3 items-end">
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={domainType} onValueChange={(value) => setDomainType(value as DomainType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="exact">Exact domein</SelectItem>
                <SelectItem value="wildcard">Wildcard</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Domein</Label>
            <Input
              value={domainInput}
              onChange={(event) => setDomainInput(event.target.value)}
              placeholder={domainType === 'wildcard' ? '*.klant.nl' : 'app.klant.nl'}
            />
          </div>
          <div className="space-y-2">
            <Label>Primaire hostname</Label>
            <Input
              value={primaryHostname}
              onChange={(event) => setPrimaryHostname(event.target.value)}
              placeholder={suggestedPrimary || 'app.klant.nl'}
              disabled={domainType === 'exact'}
            />
          </div>
          <Button onClick={() => addDomain.mutate()} disabled={!domainInput || addDomain.isPending} className="gap-2">
            {addDomain.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />}
            Koppelen
          </Button>
        </div>

        {domainType === 'wildcard' && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Een wildcard vraagt de nameservers van het hele domein</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                Een wildcard-certificaat kan alleen worden uitgegeven als de nameservers van het
                domein naar Vercel wijzen. Losse CNAME-records zijn niet genoeg — daarmee komt er
                nooit een certificaat.
              </p>
              <p>
                Daarbij vervalt de huidige DNS-zone volledig. Alle bestaande records moeten eerst
                in Vercel DNS staan: MX plus SPF, DKIM en DMARC voor e-mail, bestaande subdomeinen
                en verificatie-records. Ontbreken die, dan valt e-mail op dit domein uit.
              </p>
              <p className="font-medium">
                Wil je alleen één app-adres, kies dan Exact domein. Dat vraagt één CNAME en laat de
                rest van de zone ongemoeid.
              </p>
            </AlertDescription>
          </Alert>
        )}

        {addDomain.error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Domein koppelen lukt nog niet</AlertTitle>
            <AlertDescription>{addDomain.error.message}</AlertDescription>
          </Alert>
        )}

        <Separator />

        <div className="space-y-3">
          {domainsQuery.isLoading && <p className="text-sm text-muted-foreground">Domeinen laden...</p>}
          {!domainsQuery.isLoading && domains.length === 0 && (
            <p className="text-sm text-muted-foreground">Nog geen domeinen gekoppeld.</p>
          )}

          {domains.map((domain) => {
            const instructions = domain.dns_config?.instructions;
            const records = Array.isArray(instructions?.records) ? instructions.records : [];
            const verification = Array.isArray(instructions?.verification) ? instructions.verification : [];
            const nameservers: string[] = Array.isArray(instructions?.nameservers) ? instructions.nameservers : [];
            return (
              <div key={domain.id} className="rounded-lg border p-4 space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{domain.domain}</h3>
                      {domain.is_primary && <Badge className="gap-1"><Star className="h-3 w-3" /> Primair</Badge>}
                      {statusBadge(domain)}
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      Links gebruiken {domain.primary_hostname}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => runAction.mutate({ action: 'check', id: domain.id })} disabled={runAction.isPending} className="gap-2">
                      <RefreshCw className="h-3.5 w-3.5" /> Check
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => runAction.mutate({ action: 'verify', id: domain.id })} disabled={runAction.isPending} className="gap-2">
                      <ShieldCheck className="h-3.5 w-3.5" /> Verifieer
                    </Button>
                    <SendDnsInstructionsDialog domain={domain} onSent={invalidate} />
                    {!domain.is_primary && domain.status === 'verified' && (
                      <Button variant="outline" size="sm" onClick={() => runAction.mutate({ action: 'set_primary', id: domain.id })} disabled={runAction.isPending}>
                        Maak primair
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => runAction.mutate({ action: 'remove', id: domain.id })} disabled={runAction.isPending} className="text-destructive hover:text-destructive gap-2">
                      <Trash2 className="h-3.5 w-3.5" /> Verwijder
                    </Button>
                  </div>
                </div>

                {records.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">DNS-records</p>
                    {records.map((record: any, index: number) => (
                      <div key={`${record.type}-${record.name}-${index}`} className="grid grid-cols-1 md:grid-cols-[90px_1fr_1fr_auto] gap-2 rounded-md bg-muted p-2 text-sm">
                        <span className="font-medium">{record.type}</span>
                        <span className="font-mono break-all">{record.name}</span>
                        <span className="font-mono break-all">{record.value}</span>
                        <Button type="button" variant="ghost" size="icon" onClick={() => copy(recordLabel(record))}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                {nameservers.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Nameservers — te wijzigen bij de registrar
                    </p>
                    {nameservers.map((ns) => (
                      <div key={ns} className="flex items-center justify-between gap-2 rounded-md bg-muted p-2 text-sm">
                        <span className="font-mono break-all">{ns}</span>
                        <Button type="button" variant="ghost" size="icon" onClick={() => copy(ns)}>
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">
                      Deze vervangen de huidige nameservers volledig. Zet eerst alle bestaande
                      records over naar Vercel DNS — anders valt e-mail op dit domein uit.
                    </p>
                  </div>
                )}

                {verification.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Vercel-verificatie</p>
                    {verification.map((record: any, index: number) => (
                      <div key={index} className="rounded-md bg-muted p-2 text-sm font-mono break-all">
                        {JSON.stringify(record)}
                      </div>
                    ))}
                  </div>
                )}

                {instructions?.warning && (
                  <p className="text-xs text-orange-700">{instructions.warning}</p>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
