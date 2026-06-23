import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Link, useNavigate } from 'react-router-dom';
import { UserRound, Search, Plus, Pencil } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PhoneLink } from '@/components/ui/contact-links';
import { MailButton } from '@/components/ui/mail-button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import ContactDialog from '@/components/contacts/ContactDialog';

const PAGE_SIZE = 20;

const Contacts = () => {
  const orgId = useOrganizationId();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<any>(null);

  const openNew = () => { setEditingContact(null); setDialogOpen(true); };
  const openEdit = (contact: any) => { setEditingContact(contact); setDialogOpen(true); };

  const { data, isLoading } = useQuery({
    queryKey: ['all-contacts', orgId, search, page],
    queryFn: async () => {
      let query = supabase
        .from('company_contacts')
        .select(`
          *,
          companies!company_contacts_company_id_fkey(id, name)
        `, { count: 'exact' })
        .eq('organization_id', orgId);

      if (search) {
        query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,function_title.ilike.%${search}%`);
      }

      query = query.order('full_name').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const { data, count, error } = await query;
      if (error) throw error;
      return { contacts: data ?? [], total: count ?? 0 };
    },
  });

  const contacts = data?.contacts ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contactpersonen</h1>
          <p className="text-muted-foreground text-sm mt-1">Alle contactpersonen van opdrachtgevers</p>
        </div>
        <Button size="sm" onClick={openNew} className="gap-1.5 shrink-0">
          <Plus className="h-4 w-4" />Nieuw contact
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Zoek op naam, e-mail of functie..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            className="pl-9"
          />
        </div>
        <span className="text-sm text-muted-foreground">{total} contactpersonen</span>
      </div>

      {!isLoading && contacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <UserRound className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-lg font-medium text-muted-foreground">Geen contactpersonen gevonden</p>
          <p className="text-sm text-muted-foreground mt-1">Maak een nieuw contact aan of voeg er een toe vanuit een opdrachtgever.</p>
          <Button size="sm" onClick={openNew} className="gap-1.5 mt-4">
            <Plus className="h-4 w-4" />Nieuw contact
          </Button>
        </div>
      ) : (
        <>
          <div className="bg-card rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Naam</TableHead>
                  <TableHead>Functie</TableHead>
                  <TableHead>Bedrijf</TableHead>
                  <TableHead>Telefoon</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Primair</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.map((c: any, i: number) => (
                  <TableRow
                    key={c.id}
                    className={`cursor-pointer ${i % 2 === 1 ? 'bg-background' : ''}`}
                    onClick={() => navigate(`/contacten/${c.id}`)}
                  >
                    <TableCell>
                      <Link
                        to={`/contacten/${c.id}`}
                        className="font-medium text-foreground hover:text-stat-blue transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.full_name}
                      </Link>
                    </TableCell>
                    <TableCell>{c.function_title ?? '—'}</TableCell>
                    <TableCell>
                      {c.companies ? (
                        <Link
                          to={`/opdrachtgevers/${c.companies.id}`}
                          className="text-foreground hover:text-stat-blue transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {c.companies.name}
                        </Link>
                      ) : '—'}
                    </TableCell>
                    <TableCell><PhoneLink phone={c.phone} /></TableCell>
                    <TableCell><MailButton email={c.email} asText /></TableCell>
                    <TableCell>
                      {c.is_primary && (
                        <Badge variant="default" className="bg-stat-green/10 text-stat-green border-0">Primair</Badge>
                      )}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Bewerken"
                        onClick={() => openEdit(c)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious onClick={() => setPage(Math.max(0, page - 1))} className={page === 0 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
                </PaginationItem>
                {Array.from({ length: totalPages }, (_, i) => (
                  <PaginationItem key={i}>
                    <PaginationLink isActive={i === page} onClick={() => setPage(i)} className="cursor-pointer">{i + 1}</PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext onClick={() => setPage(Math.min(totalPages - 1, page + 1))} className={page >= totalPages - 1 ? 'pointer-events-none opacity-50' : 'cursor-pointer'} />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </>
      )}

      <ContactDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        contact={editingContact ?? undefined}
      />
    </div>
  );
};

export default Contacts;
