import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { entityPath, type EntityType } from '@/lib/entity-routes';
import { Bell, Check, X, Info, AlertTriangle, AlertOctagon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { formatRelativeTime } from '@/lib/format';
import { toast } from 'sonner';

const severityConfig: Record<string, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: 'text-stat-blue bg-stat-blue/10' },
  warning: { icon: AlertTriangle, className: 'text-stat-orange bg-orange-100' },
  urgent: { icon: AlertOctagon, className: 'text-destructive bg-destructive/10' },
};

const filterTabs = [
  { value: 'alle', label: 'Alle' },
  { value: 'contract', label: 'Contracten' },
  { value: 'document', label: 'Documenten' },
  { value: 'uren', label: 'Uren' },
  { value: 'overig', label: 'Overig' },
];

const typeToCategory: Record<string, string> = {
  contract_aflopend: 'contract',
  contract_verlenging: 'contract',
  document_ontbrekend: 'document',
  document_verlopen: 'document',
  id_verlopen: 'document',
  rijbewijs_verlopen: 'document',
  uren_openstaand: 'uren',
  proeftijd_einde: 'contract',
  verzuim_langdurig: 'overig',
  verjaardag: 'overig',
  overig: 'overig',
};

// Map een notificatie naar de detailpagina van de betrokken entiteit.
const REFERENCE_TABLE_TO_ENTITY: Record<string, EntityType> = {
  candidates: 'candidate',
  companies: 'company',
  placements: 'placement',
  vacancies: 'vacancy',
  vehicles: 'vehicle',
  properties: 'property',
};

function notificationLink(n: {
  type?: string | null;
  reference_table?: string | null;
  reference_id?: string | null;
  company_id?: string | null;
  candidate_id?: string | null;
  employee_id?: string | null;
}): string | null {
  if (n.type === 'uren_openstaand') return '/uren';
  if (n.reference_table && n.reference_id) {
    const entity = REFERENCE_TABLE_TO_ENTITY[n.reference_table];
    if (entity) return entityPath(entity, n.reference_id) || null;
  }
  if (n.company_id) return entityPath('company', n.company_id) || null;
  if (n.candidate_id) return entityPath('candidate', n.candidate_id) || null;
  if (n.employee_id) return entityPath('employee', n.employee_id) || null;
  return null;
}

const NotificationBell = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('alle');

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('employee_notifications')
        .select('*')
        .eq('is_dismissed', false)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 60000,
  });

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const filtered = filter === 'alle'
    ? notifications
    : notifications.filter((n) => typeToCategory[n.type] === filter);

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('employee_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const dismiss = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('employee_notifications')
        .update({ is_dismissed: true })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast.success('Notificatie verwijderd');
    },
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative p-2 rounded-md hover:bg-secondary transition-colors">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-[16px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="end">
        <div className="p-3 border-b">
          <h3 className="font-semibold text-sm">Notificaties</h3>
        </div>

        <Tabs value={filter} onValueChange={setFilter} className="px-3 pt-2">
          <TabsList className="h-8 w-full">
            {filterTabs.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="text-xs flex-1">
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <ScrollArea className="h-[350px]">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Geen notificaties
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((n) => {
                const sev = severityConfig[n.severity ?? 'info'] ?? severityConfig.info;
                const SevIcon = sev.icon;
                const link = notificationLink(n);
                const openNotification = () => {
                  if (!n.is_read) markRead.mutate(n.id);
                  if (link) {
                    setOpen(false);
                    navigate(link);
                  }
                };
                return (
                  <div
                    key={n.id}
                    className={`p-3 flex gap-3 ${!n.is_read ? 'bg-muted/30' : ''}`}
                  >
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${sev.className}`}>
                      <SevIcon className="h-4 w-4" />
                    </div>
                    <button
                      type="button"
                      onClick={openNotification}
                      className={`flex-1 min-w-0 text-left ${link ? 'cursor-pointer' : 'cursor-default'}`}
                      title={link ? 'Open' : undefined}
                    >
                      <p className={`text-sm leading-tight ${!n.is_read ? 'font-medium' : ''}`}>
                        {n.title}
                      </p>
                      {n.message && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {formatRelativeTime(n.created_at)}
                      </p>
                    </button>
                    <div className="flex flex-col gap-1 shrink-0">
                      {!n.is_read && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => markRead.mutate(n.id)}
                          title="Markeer als gelezen"
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground"
                        onClick={() => dismiss.mutate(n.id)}
                        title="Verwijderen"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
};

export default NotificationBell;
