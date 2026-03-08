import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { Building2, FileText, Package, Plus, RefreshCw, Search, ExternalLink } from 'lucide-react';

// Helper to call the exact-api proxy
async function exactApi(endpoint: string, method = 'GET', payload?: unknown) {
  const { data, error } = await supabase.functions.invoke('exact-api', {
    body: { endpoint, method, payload },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

function extractResults(data: unknown): unknown[] {
  if (!data) return [];
  const d = (data as Record<string, unknown>).d;
  if (!d) return Array.isArray(data) ? data : [];
  if (Array.isArray(d)) return d;
  const results = (d as Record<string, unknown>).results;
  return Array.isArray(results) ? results : [];
}

// ─── Accounts Tab ───
function AccountsTab() {
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['exact-accounts', search],
    queryFn: () => {
      const filter = search
        ? `?$filter=substringof('${search}',Name)&$select=ID,Code,Name,City,Email,Phone,Status&$top=50`
        : '?$select=ID,Code,Name,City,Email,Phone,Status&$top=50';
      return exactApi(`crm/Accounts${filter}`);
    },
  });

  const accounts = extractResults(data) as Record<string, unknown>[];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Zoek relatie..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Vernieuwen
        </Button>
        <CreateAccountDialog open={showCreate} onOpenChange={setShowCreate} onSuccess={() => { refetch(); setShowCreate(false); }} />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Naam</TableHead>
                  <TableHead>Plaats</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Telefoon</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Geen relaties gevonden</TableCell></TableRow>
                ) : accounts.map((a) => (
                  <TableRow key={String(a.ID)}>
                    <TableCell className="font-mono text-xs">{String(a.Code ?? '-')}</TableCell>
                    <TableCell className="font-medium">{String(a.Name ?? '')}</TableCell>
                    <TableCell>{String(a.City ?? '-')}</TableCell>
                    <TableCell>{String(a.Email ?? '-')}</TableCell>
                    <TableCell>{String(a.Phone ?? '-')}</TableCell>
                    <TableCell>
                      <Badge variant={a.Status === 'C' ? 'default' : 'secondary'}>
                        {a.Status === 'C' ? 'Klant' : a.Status === 'S' ? 'Suspect' : a.Status === 'P' ? 'Prospect' : String(a.Status ?? '-')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateAccountDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ Name: '', Email: '', Phone: '', City: '', Status: 'C' });

  const mutation = useMutation({
    mutationFn: () => exactApi('crm/Accounts', 'POST', form),
    onSuccess: () => { toast.success('Relatie aangemaakt in Exact'); onSuccess(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nieuwe relatie</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nieuwe relatie aanmaken</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Bedrijfsnaam *</Label><Input value={form.Name} onChange={e => setForm(p => ({ ...p, Name: e.target.value }))} /></div>
          <div><Label>E-mail</Label><Input value={form.Email} onChange={e => setForm(p => ({ ...p, Email: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Telefoon</Label><Input value={form.Phone} onChange={e => setForm(p => ({ ...p, Phone: e.target.value }))} /></div>
            <div><Label>Plaats</Label><Input value={form.City} onChange={e => setForm(p => ({ ...p, City: e.target.value }))} /></div>
          </div>
          <Button onClick={() => mutation.mutate()} disabled={!form.Name || mutation.isPending} className="w-full">
            {mutation.isPending ? 'Bezig...' : 'Aanmaken'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Invoices Tab ───
function InvoicesTab() {
  const [search, setSearch] = useState('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['exact-invoices'],
    queryFn: () => exactApi('salesinvoice/SalesInvoices?$select=InvoiceID,InvoiceNumber,AmountDC,Currency,Description,InvoiceDate,OrderDate,Status,YourRef&$top=50&$orderby=InvoiceDate desc'),
  });

  const invoices = extractResults(data) as Record<string, unknown>[];

  const statusLabel = (s: unknown) => {
    const map: Record<number, string> = { 10: 'Concept', 20: 'Open', 50: 'Verwerkt' };
    return map[Number(s)] ?? String(s ?? '-');
  };

  const formatDate = (d: unknown) => {
    if (!d) return '-';
    const str = String(d);
    const match = str.match(/Date\((\d+)\)/);
    if (match) return new Date(Number(match[1])).toLocaleDateString('nl-NL');
    return new Date(str).toLocaleDateString('nl-NL');
  };

  const formatAmount = (a: unknown) => {
    if (a == null) return '-';
    return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(Number(a));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Vernieuwen
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nummer</TableHead>
                  <TableHead>Omschrijving</TableHead>
                  <TableHead>Datum</TableHead>
                  <TableHead>Referentie</TableHead>
                  <TableHead className="text-right">Bedrag</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">Geen facturen gevonden</TableCell></TableRow>
                ) : invoices.map((inv) => (
                  <TableRow key={String(inv.InvoiceID)}>
                    <TableCell className="font-mono text-xs">{String(inv.InvoiceNumber ?? '-')}</TableCell>
                    <TableCell className="font-medium">{String(inv.Description ?? '-')}</TableCell>
                    <TableCell>{formatDate(inv.InvoiceDate)}</TableCell>
                    <TableCell>{String(inv.YourRef ?? '-')}</TableCell>
                    <TableCell className="text-right font-mono">{formatAmount(inv.AmountDC)}</TableCell>
                    <TableCell>
                      <Badge variant={Number(inv.Status) === 50 ? 'default' : 'secondary'}>
                        {statusLabel(inv.Status)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Items Tab ───
function ItemsTab() {
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['exact-items', search],
    queryFn: () => {
      const filter = search
        ? `?$filter=substringof('${search}',Description)&$select=ID,Code,Description,IsSalesItem,IsPurchaseItem,IsStockItem&$top=50`
        : '?$select=ID,Code,Description,IsSalesItem,IsPurchaseItem,IsStockItem&$top=50';
      return exactApi(`logistics/Items${filter}`);
    },
  });

  const items = extractResults(data) as Record<string, unknown>[];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Zoek artikel..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" /> Vernieuwen
        </Button>
        <CreateItemDialog open={showCreate} onOpenChange={setShowCreate} onSuccess={() => { refetch(); setShowCreate(false); }} />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Omschrijving</TableHead>
                  <TableHead>Verkoop</TableHead>
                  <TableHead>Inkoop</TableHead>
                  <TableHead>Voorraad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">Geen artikelen gevonden</TableCell></TableRow>
                ) : items.map((it) => (
                  <TableRow key={String(it.ID)}>
                    <TableCell className="font-mono text-xs">{String(it.Code ?? '-')}</TableCell>
                    <TableCell className="font-medium">{String(it.Description ?? '')}</TableCell>
                    <TableCell>{it.IsSalesItem ? <Badge>Ja</Badge> : <Badge variant="secondary">Nee</Badge>}</TableCell>
                    <TableCell>{it.IsPurchaseItem ? <Badge>Ja</Badge> : <Badge variant="secondary">Nee</Badge>}</TableCell>
                    <TableCell>{it.IsStockItem ? <Badge>Ja</Badge> : <Badge variant="secondary">Nee</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateItemDialog({ open, onOpenChange, onSuccess }: { open: boolean; onOpenChange: (o: boolean) => void; onSuccess: () => void }) {
  const [form, setForm] = useState({ Code: '', Description: '', IsSalesItem: true });

  const mutation = useMutation({
    mutationFn: () => exactApi('logistics/Items', 'POST', form),
    onSuccess: () => { toast.success('Artikel aangemaakt in Exact'); onSuccess(); },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nieuw artikel</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Nieuw artikel aanmaken</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Artikelcode *</Label><Input value={form.Code} onChange={e => setForm(p => ({ ...p, Code: e.target.value }))} /></div>
          <div><Label>Omschrijving *</Label><Input value={form.Description} onChange={e => setForm(p => ({ ...p, Description: e.target.value }))} /></div>
          <Button onClick={() => mutation.mutate()} disabled={!form.Code || !form.Description || mutation.isPending} className="w-full">
            {mutation.isPending ? 'Bezig...' : 'Aanmaken'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Page ───
export default function ExactOnlinePage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold mb-1">Exact Online</h1>
      <p className="text-sm text-muted-foreground mb-6">Beheer relaties, facturen en artikelen</p>

      <Tabs defaultValue="accounts" className="space-y-4">
        <TabsList>
          <TabsTrigger value="accounts" className="gap-1.5">
            <Building2 className="h-4 w-4" /> Relaties
          </TabsTrigger>
          <TabsTrigger value="invoices" className="gap-1.5">
            <FileText className="h-4 w-4" /> Facturen
          </TabsTrigger>
          <TabsTrigger value="items" className="gap-1.5">
            <Package className="h-4 w-4" /> Artikelen
          </TabsTrigger>
        </TabsList>

        <TabsContent value="accounts"><AccountsTab /></TabsContent>
        <TabsContent value="invoices"><InvoicesTab /></TabsContent>
        <TabsContent value="items"><ItemsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
