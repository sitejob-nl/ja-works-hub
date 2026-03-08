import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { useAuth } from '@/contexts/AuthContext';
import { formatDateTime, formatDuration } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Plus, MessageSquare, Mail, Phone, StickyNote, MessageCircle, Search, Loader2, Send } from 'lucide-react';
import type { Database } from '@/integrations/supabase/types';

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

const PAGE_SIZE = 20;

const Communications = () => {
  const organizationId = useOrganizationId();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('all');
  const [directionFilter, setDirectionFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [page, setPage] = useState(0);
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
    queryKey: ['communications', organizationId, search, channelFilter, directionFilter, typeFilter, page],
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
        .eq('organization_id', organizationId)
        .order('sent_at', { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

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
  };

  const items = data?.items || [];
  const totalCount = data?.count || 0;
  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

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
              onChange={(e) => { setSearch(e.target.value); setPage(0); }}
              className="pl-9"
            />
          </div>
        </div>
        <Select value={channelFilter} onValueChange={(v) => { setChannelFilter(v); setPage(0); }}>
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
        <Select value={directionFilter} onValueChange={(v) => { setDirectionFilter(v); setPage(0); }}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle richtingen</SelectItem>
            <SelectItem value="inbound">Inkomend</SelectItem>
            <SelectItem value="outbound">Uitgaand</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setPage(0); }}>
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
                  <TableHead className="w-[60px]">Kanaal</TableHead>
                  <TableHead className="w-[100px]">Richting</TableHead>
                  <TableHead>Aan/Van</TableHead>
                  <TableHead>Onderwerp</TableHead>
                  <TableHead className="w-[160px]">Datum/tijd</TableHead>
                  <TableHead className="w-[140px]">Verzender</TableHead>
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
                            className="text-primary hover:underline"
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

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Vorige</Button>
              <span className="text-sm text-muted-foreground self-center">Pagina {page + 1} van {totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Volgende</Button>
            </div>
          )}
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

            <Button
              className="w-full"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Opslaan
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Communications;
