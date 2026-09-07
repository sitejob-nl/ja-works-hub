import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { formatDateTime, formatDuration } from '@/lib/format';
import { extractFunctionErrorMessage } from '@/lib/functionError';
import { getErrorMessage } from '@/lib/error-message';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import SortableTableHead from '@/components/ui/sortable-table-head';
import TablePagination from '@/components/ui/table-pagination';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, MessageSquare, Mail, Phone, StickyNote, MessageCircle, Search, Loader2, Send } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';
import { useTableControls } from '@/hooks/useTableControls';
import type { SortableColumn, SortState } from '@/lib/table-sort';

const VITE_SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

type CommunicationChannel = Database['public']['Enums']['communication_channel'];

const CHANNEL_ICONS: Record<CommunicationChannel, React.ReactNode> = {
  whatsapp: <MessageSquare className="h-4 w-4 text-green-600" />,
  email: <Mail className="h-4 w-4 text-blue-600" />,
  voip: <Phone className="h-4 w-4 text-purple-600" />,
  notitie: <StickyNote className="h-4 w-4 text-yellow-600" />,
  sms: <MessageCircle className="h-4 w-4 text-muted-foreground" />,
};

const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  voip: 'VoIP',
  notitie: 'Notitie',
  sms: 'SMS',
};

// Sorteerbaar zijn de kolommen die één-op-één een communicatiekolom tonen. 'Verzender' is een
// to-one embed op profiles en daar ordent PostgREST de berichten zelf op. 'Aan/Van' niet: die
// cel valt terug van kandidaat naar bedrijf naar contactpersoon, dus één databasekolom dekt
// hem niet. Kanaal en richting zijn enums: sorteren groepeert, niet alfabetisch op label.
const SORT_COLUMNS: readonly SortableColumn[] = [
  { key: 'channel' },
  { key: 'direction' },
  { key: 'subject' },
  { key: 'sent_at', defaultDirection: 'desc' },
  { key: 'sender', orderBy: ['profiles(full_name)'] },
];
// Nieuwste bericht bovenaan, zoals de lijst altijd al opende — nu zichtbaar en omkeerbaar.
const DEFAULT_SORT: SortState = { column: 'sent_at', direction: 'desc' };

const Communications = () => {
  const organizationId = useOrganizationId();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('all');
  const [directionFilter, setDirectionFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const table = useTableControls({
    columns: SORT_COLUMNS,
    defaultSort: DEFAULT_SORT,
    // Deze lijst stond al op 20 rijen; dat blijft de default.
    defaultPageSize: 20,
    // Kanaal, richting en verzender zijn niet uniek; zonder vaste volgorde daarbinnen kan
    // .range() een bericht op twee pagina's tegelijk zetten.
    tiebreak: ['id'],
  });
  const { page, pageSize, applySort, resetPage } = table;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<any>(null);

  // Form state
  const [formType, setFormType] = useState<'candidate' | 'company'>('candidate');
  const [formCandidateId, setFormCandidateId] = useState('');
  const [formCompanyId, setFormCompanyId] = useState('');
  const [formContactId, setFormContactId] = useState('');
  const [formChannel, setFormChannel] = useState<CommunicationChannel>('notitie');
  const [formDirection, setFormDirection] = useState('outbound');
  const [formSubject, setFormSubject] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formDuration, setFormDuration] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['communications', organizationId, search, channelFilter, directionFilter, typeFilter, page, pageSize, table.sort.column, table.sort.direction],
    queryFn: async () => {
      let query = supabase
        .from('communications')
        .select(`
          *,
          candidates!communications_candidate_id_fkey(id, first_name, last_name),
          companies!communications_company_id_fkey(id, name),
          company_contacts!communications_company_contact_id_fkey(full_name),
          profiles!communications_sent_by_fkey(full_name)
        `, { count: 'exact' })
        .eq('organization_id', organizationId);

      if (search.trim()) {
        query = query.or(`subject.ilike.%${search}%,body.ilike.%${search}%`);
      }
      if (channelFilter !== 'all') {
        query = query.eq('channel', channelFilter as CommunicationChannel);
      }
      if (directionFilter !== 'all') {
        query = query.eq('direction', directionFilter);
      }
      if (typeFilter === 'candidate') {
        query = query.not('candidate_id', 'is', null);
      } else if (typeFilter === 'company') {
        query = query.not('company_id', 'is', null);
      }

      // Sorteren gebeurt in de database, dus over de héle set — niet over de zichtbare pagina.
      query = applySort(query).range(table.from, table.to);

      const { data, error, count } = await query;
      if (error) throw error;
      return { items: data, count: count || 0 };
    },
  });

  // Candidates for dropdown
  const { data: candidates } = useQuery({
    queryKey: ['candidates-list', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select('id, first_name, last_name')
        .eq('organization_id', organizationId)
        .order('first_name');
      if (error) throw error;
      return data;
    },
    enabled: sheetOpen,
  });

  // Companies for dropdown
  const { data: companies } = useQuery({
    queryKey: ['companies-list', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('companies')
        .select('id, name')
        .eq('organization_id', organizationId)
        .order('name');
      if (error) throw error;
      return data;
    },
    enabled: sheetOpen,
  });

  // Contacts for selected company
  const { data: contacts } = useQuery({
    queryKey: ['company-contacts', formCompanyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('company_contacts')
        .select('id, full_name')
        .eq('company_id', formCompanyId)
        .order('full_name');
      if (error) throw error;
      return data;
    },
    enabled: !!formCompanyId,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        organization_id: organizationId,
        channel: formChannel,
        direction: formDirection,
        subject: formSubject || null,
        body: formBody || null,
        sent_by: user?.id || null,
        candidate_id: formType === 'candidate' && formCandidateId ? formCandidateId : null,
        company_id: formType === 'company' && formCompanyId ? formCompanyId : null,
        company_contact_id: formType === 'company' && formContactId ? formContactId : null,
        call_duration_seconds: formChannel === 'voip' && formDuration ? parseInt(formDuration) : null,
      };
      const { error } = await supabase.from('communications').insert(payload);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Communicatie vastgelegd');
      queryClient.invalidateQueries({ queryKey: ['communications'] });
      resetForm();
      setSheetOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const resetForm = () => {
    setFormType('candidate');
    setFormCandidateId('');
    setFormCompanyId('');
    setFormContactId('');
    setFormChannel('notitie');
    setFormDirection('outbound');
    setFormSubject('');
    setFormBody('');
    setFormDuration('');
    setFormPhone('');
  };

  const handleSendWhatsApp = async () => {
    if (!formPhone || !formBody) {
      toast.error('Vul telefoonnummer en bericht in');
      return;
    }
    setSendingWhatsApp(true);
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-send', {
        body: {
          to: formPhone,
          type: 'text',
          text: { body: formBody },
          candidate_id: formType === 'candidate' && formCandidateId ? formCandidateId : undefined,
          company_id: formType === 'company' && formCompanyId ? formCompanyId : undefined,
        },
      });
      if (error) throw new Error(await extractFunctionErrorMessage(error, 'Versturen mislukt'));
      // Kill-switch: whatsapp-send geeft HTTP 200 met { paused:true } terug — dan is het
      // bericht NIET verzonden maar als concept gelogd. Geen valse succesmelding tonen.
      if (data?.paused) {
        toast.warning('WhatsApp staat op pauze — het bericht is als concept opgeslagen, niet verzonden.');
        queryClient.invalidateQueries({ queryKey: ['communications'] });
        resetForm();
        setSheetOpen(false);
        return;
      }
      if (data?.error) throw new Error(getErrorMessage(data.error));
      toast.success('WhatsApp bericht verstuurd');
      queryClient.invalidateQueries({ queryKey: ['communications'] });
      resetForm();
      setSheetOpen(false);
    } catch (err: any) {
      toast.error(getErrorMessage(err));
    } finally {
      setSendingWhatsApp(false);
    }
  };

  const items = data?.items || [];
  const totalCount = data?.count || 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  const getRecipientName = (item: any) => {
    if (item.candidates) {
      return `${item.candidates.first_name} ${item.candidates.last_name}`;
    }
    if (item.companies) {
      const contact = item.company_contacts?.full_name;
      return contact ? `${item.companies.name} (${contact})` : item.companies.name;
    }
    return '—';
  };

  const getRecipientLink = (item: any) => {
    if (item.candidates?.id) return `/kandidaten/${item.candidates.id}`;
    if (item.companies?.id) return `/opdrachtgevers/${item.companies.id}`;
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Communicatie</h1>
          <p className="text-muted-foreground mt-1">Alle berichten en communicatiehistorie</p>
        </div>
        <Button onClick={() => { resetForm(); setSheetOpen(true); }}>
          <Plus className="h-4 w-4 mr-2" /> Nieuw bericht
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Zoek op onderwerp of tekst..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); resetPage(); }}
              className="pl-9"
            />
          </div>
        </div>
        <Select value={channelFilter} onValueChange={(v) => { setChannelFilter(v); resetPage(); }}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle kanalen</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="email">E-mail</SelectItem>
            <SelectItem value="voip">VoIP</SelectItem>
            <SelectItem value="notitie">Notitie</SelectItem>
            <SelectItem value="sms">SMS</SelectItem>
          </SelectContent>
        </Select>
        <Select value={directionFilter} onValueChange={(v) => { setDirectionFilter(v); resetPage(); }}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle richtingen</SelectItem>
            <SelectItem value="inbound">Inkomend</SelectItem>
            <SelectItem value="outbound">Uitgaand</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); resetPage(); }}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle types</SelectItem>
            <SelectItem value="candidate">Kandidaat</SelectItem>
            <SelectItem value="company">Opdrachtgever</SelectItem>
          </SelectContent>
        </Select>
        <Badge variant="secondary">{totalCount} resultaten</Badge>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <MessageSquare className="h-12 w-12 mx-auto text-muted-foreground/40" />
          <p className="text-muted-foreground">Nog geen communicatie vastgelegd</p>
        </div>
      ) : (
        <>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableTableHead column="channel" sort={table.sort} onSort={table.toggleSort} className="w-[60px]">Kanaal</SortableTableHead>
                  <SortableTableHead column="direction" sort={table.sort} onSort={table.toggleSort} className="w-[100px]">Richting</SortableTableHead>
                  {/* Aan/Van valt terug van kandidaat naar bedrijf naar contact — zie SORT_COLUMNS. */}
                  <TableHead>Aan/Van</TableHead>
                  <SortableTableHead column="subject" sort={table.sort} onSort={table.toggleSort}>Onderwerp</SortableTableHead>
                  <SortableTableHead column="sent_at" sort={table.sort} onSort={table.toggleSort} className="w-[160px]">Datum/tijd</SortableTableHead>
                  <SortableTableHead column="sender" sort={table.sort} onSort={table.toggleSort} className="w-[140px]">Verzender</SortableTableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item: any) => {
                  const link = getRecipientLink(item);
                  return (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setDetailItem(item)}
                    >
                      <TableCell>{CHANNEL_ICONS[item.channel as CommunicationChannel]}</TableCell>
                      <TableCell>
                        <Badge variant={item.direction === 'inbound' ? 'default' : 'secondary'} className="text-xs">
                          {item.direction === 'inbound' ? 'Inkomend' : 'Uitgaand'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {link ? (
                          <a
                            href={link}
                            className="hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {getRecipientName(item)}
                          </a>
                        ) : (
                          getRecipientName(item)
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">{item.subject || '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDateTime(item.sent_at)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.profiles?.full_name || '—'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <TablePagination
            page={page}
            totalPages={totalPages}
            onPageChange={table.setPage}
            pageSize={pageSize}
            onPageSizeChange={table.setPageSize}
          />
        </>
      )}

      {/* Detail dialog */}
      <Dialog open={!!detailItem} onOpenChange={(open) => { if (!open) setDetailItem(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{detailItem?.subject || 'Communicatie detail'}</DialogTitle>
          </DialogHeader>
          {detailItem && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="outline">{CHANNEL_LABELS[detailItem.channel as CommunicationChannel]}</Badge>
                <Badge variant={detailItem.direction === 'inbound' ? 'default' : 'secondary'}>
                  {detailItem.direction === 'inbound' ? 'Inkomend' : 'Uitgaand'}
                </Badge>
                <span className="text-muted-foreground">{formatDateTime(detailItem.sent_at)}</span>
              </div>
              <div className="text-sm text-muted-foreground">
                <strong>Aan/Van:</strong> {getRecipientName(detailItem)}
              </div>
              {detailItem.profiles?.full_name && (
                <div className="text-sm text-muted-foreground">
                  <strong>Verzender:</strong> {detailItem.profiles.full_name}
                </div>
              )}
              {detailItem.body && (
                <div className="border rounded-md p-3 text-sm whitespace-pre-wrap bg-muted/30">
                  {detailItem.body}
                </div>
              )}
              {detailItem.channel === 'voip' && (
                <div className="space-y-2 text-sm">
                  <p><strong>Gespreksduur:</strong> {formatDuration(detailItem.call_duration_seconds)}</p>
                  {detailItem.transcription && (
                    <div>
                      <strong>Transcriptie:</strong>
                      <div className="border rounded-md p-3 mt-1 whitespace-pre-wrap bg-muted/30">{detailItem.transcription}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* New message sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Nieuw bericht</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div className="space-y-2">
              <Label>Type</Label>
              <div className="flex gap-2">
                <Button
                  variant={formType === 'candidate' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setFormType('candidate'); setFormCompanyId(''); setFormContactId(''); }}
                >
                  Kandidaat
                </Button>
                <Button
                  variant={formType === 'company' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setFormType('company'); setFormCandidateId(''); }}
                >
                  Opdrachtgever
                </Button>
              </div>
            </div>

            {formType === 'candidate' && (
              <div className="space-y-2">
                <Label>Kandidaat</Label>
                <Select value={formCandidateId} onValueChange={setFormCandidateId}>
                  <SelectTrigger><SelectValue placeholder="Selecteer kandidaat..." /></SelectTrigger>
                  <SelectContent>
                    {candidates?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.first_name} {c.last_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {formType === 'company' && (
              <>
                <div className="space-y-2">
                  <Label>Bedrijf</Label>
                  <Select value={formCompanyId} onValueChange={(v) => { setFormCompanyId(v); setFormContactId(''); }}>
                    <SelectTrigger><SelectValue placeholder="Selecteer bedrijf..." /></SelectTrigger>
                    <SelectContent>
                      {companies?.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {formCompanyId && contacts && contacts.length > 0 && (
                  <div className="space-y-2">
                    <Label>Contactpersoon (optioneel)</Label>
                    <Select value={formContactId} onValueChange={setFormContactId}>
                      <SelectTrigger><SelectValue placeholder="Selecteer contactpersoon..." /></SelectTrigger>
                      <SelectContent>
                        {contacts.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}

            <div className="space-y-2">
              <Label>Kanaal</Label>
              <Select value={formChannel} onValueChange={(v) => setFormChannel(v as CommunicationChannel)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="notitie">Notitie</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="voip">VoIP</SelectItem>
                  <SelectItem value="sms">SMS</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Richting</Label>
              <div className="flex gap-2">
                <Button
                  variant={formDirection === 'outbound' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFormDirection('outbound')}
                >
                  Uitgaand
                </Button>
                <Button
                  variant={formDirection === 'inbound' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setFormDirection('inbound')}
                >
                  Inkomend
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Onderwerp</Label>
              <Input value={formSubject} onChange={(e) => setFormSubject(e.target.value)} placeholder="Onderwerp..." />
            </div>

            <div className="space-y-2">
              <Label>Bericht</Label>
              <Textarea
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
                placeholder="Typ je bericht..."
                className="min-h-[120px]"
              />
            </div>

            {formChannel === 'voip' && (
              <div className="space-y-2">
                <Label>Gespreksduur (seconden)</Label>
                <Input type="number" value={formDuration} onChange={(e) => setFormDuration(e.target.value)} placeholder="bijv. 180" />
              </div>
            )}

            {formChannel === 'whatsapp' && formDirection === 'outbound' && (
              <div className="space-y-2">
                <Label>Telefoonnummer ontvanger</Label>
                <Input
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  placeholder="bijv. 31612345678"
                />
                <p className="text-xs text-muted-foreground">Internationaal formaat zonder + teken</p>
              </div>
            )}

            <div className="flex gap-2">
              {formChannel === 'whatsapp' && formDirection === 'outbound' && (
                <Button
                  className="flex-1 gap-2"
                  variant="default"
                  onClick={handleSendWhatsApp}
                  disabled={sendingWhatsApp}
                >
                  {sendingWhatsApp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Verstuur via WhatsApp
                </Button>
              )}
              <Button
                className="flex-1"
                variant={formChannel === 'whatsapp' && formDirection === 'outbound' ? 'outline' : 'default'}
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {formChannel === 'whatsapp' && formDirection === 'outbound' ? 'Alleen loggen' : 'Opslaan'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Communications;
