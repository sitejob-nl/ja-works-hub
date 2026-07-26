import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Link, useNavigate } from 'react-router-dom';
import { UserRound, Search, Plus, Pencil, Trash2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { PhoneLink } from '@/components/ui/contact-links';
import { MailButton } from '@/components/ui/mail-button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination, PaginationContent, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import ContactDialog from '@/components/contacts/ContactDialog';
import { useAuth } from '@/contexts/AuthContext';
import { unwrap, unwrapList } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { toFriendlyError } from '@/lib/errorMessages';
import { toast } from 'sonner';

const PAGE_SIZE = 20;

const Contacts = () => {
  const orgId = useOrganizationId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { role } = useAuth();
  const canDelete = role === 'admin';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<any>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);

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
  const allOnPageSelected = contacts.length > 0 && contacts.every((contact: any) => selected.has(contact.id));

  const toggleOne = (id: string) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (allOnPageSelected) contacts.forEach((contact: any) => next.delete(contact.id));
      else contacts.forEach((contact: any) => next.add(contact.id));
      return next;
    });
  };

  const bulkDelete = useMutation({
    mutationFn: async (ids: string[]) => {
      // Communicatiegeschiedenis hoort bij de opdrachtgever en blokkeert daarom het
      // verwijderen van een contactpersoon. Deze contacten worden veilig overgeslagen.
      const communicationRows = await unwrapList(
        supabase
          .from('communications')
          .select('company_contact_id')
          .in('company_contact_id', ids),
      );
      const blocked = new Set(
        communicationRows
          .map((row) => row.company_contact_id)
          .filter((id): id is string => Boolean(id)),
      );
      const deletable = ids.filter((id) => !blocked.has(id));

      if (deletable.length > 0) {
        await unwrap(supabase.from('company_contacts').delete().in('id', deletable));
        const names = new Map(contacts.map((contact: any) => [contact.id, contact.full_name]));
        await Promise.all(deletable.map((id) => logAudit({
          action: 'delete',
          tableName: 'company_contacts',
          recordId: id,
          oldValues: names.has(id) ? { full_name: names.get(id) } : undefined,
          reason: 'bulk-delete',
        })));
      }

      return { deleted: deletable, blockedCount: blocked.size };
    },
    onSuccess: ({ deleted, blockedCount }) => {
      setSelected((previous) => {
        const next = new Set(previous);
        deleted.forEach((id) => next.delete(id));
        return next;
      });
      setDeleteOpen(false);
      qc.invalidateQueries({ queryKey: ['all-contacts'] });
      qc.invalidateQueries({ queryKey: ['contacts'] });
      qc.invalidateQueries({ queryKey: ['company-contacts'] });
      if (blockedCount > 0) {
        toast.warning(`${deleted.length} verwijderd, ${blockedCount} overgeslagen (gekoppelde communicatie)`);
      } else {
        toast.success(deleted.length === 1 ? '1 contactpersoon verwijderd' : `${deleted.length} contactpersonen verwijderd`);
      }
    },
    onError: (error) => toast.error(toFriendlyError(error, 'Verwijderen mislukt')),
  });

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

      {canDelete && selected.size > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-sm font-medium">{selected.size} geselecteerd</span>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" onClick={() => setDeleteOpen(true)} className="gap-1.5">
              <Trash2 className="h-4 w-4" /> Verwijderen
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Deselecteren
            </Button>
          </div>
        </div>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selected.size === 1 ? '1 contactpersoon verwijderen?' : `${selected.size} contactpersonen verwijderen?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Portaaluitnodigingen van deze contactpersonen worden mee verwijderd. Contactpersonen met
              gekoppelde communicatiegeschiedenis worden veilig overgeslagen. Dit kan niet ongedaan worden gemaakt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDelete.isPending}>Annuleer</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => { event.preventDefault(); bulkDelete.mutate(Array.from(selected)); }}
              disabled={bulkDelete.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDelete.isPending ? 'Bezig…' : 'Verwijderen'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                  {canDelete && (
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allOnPageSelected}
                        onCheckedChange={toggleAll}
                        aria-label={allOnPageSelected ? 'Deselecteer alle contactpersonen op deze pagina' : 'Selecteer alle contactpersonen op deze pagina'}
                      />
                    </TableHead>
                  )}
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
                    {canDelete && (
                      <TableCell onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(c.id)}
                          onCheckedChange={() => toggleOne(c.id)}
                          aria-label={`Selecteer contactpersoon ${c.full_name}`}
                        />
                      </TableCell>
                    )}
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
