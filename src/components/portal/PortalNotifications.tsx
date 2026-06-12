import { useState, useEffect } from 'react';
import { usePortal } from '@/contexts/PortalContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatDate } from '@/lib/format';

const STORAGE_KEY_PREFIX = 'portal-notifications-seen-';

const PortalNotifications = () => {
  const { employee } = usePortal();
  const employeeId = employee?.id;
  const storageKey = employeeId ? `${STORAGE_KEY_PREFIX}${employeeId}` : null;

  const [seenIds, setSeenIds] = useState<string[]>(() => {
    if (!employeeId) return [];
    try {
      return JSON.parse(localStorage.getItem(`${STORAGE_KEY_PREFIX}${employeeId}`) ?? '[]');
    } catch {
      return [];
    }
  });

  // Reload seen IDs when employee changes
  useEffect(() => {
    if (!storageKey) return;
    try {
      setSeenIds(JSON.parse(localStorage.getItem(storageKey) ?? '[]'));
    } catch {
      setSeenIds([]);
    }
  }, [storageKey]);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: notifications = [] } = useQuery({
    queryKey: ['portal-notifications', employeeId],
    queryFn: async () => {
      const { data: timesheets } = await supabase
        .from('timesheets')
        .select('id, work_date, status, approved_at')
        .eq('candidate_id', employeeId!)
        .gte('approved_at', sevenDaysAgo)
        .in('status', ['goedgekeurd', 'afgekeurd'] as any)
        .order('approved_at', { ascending: false });

      const { data: employeeNotifications } = await supabase
        .from('employee_notifications')
        .select('id, title, message, severity, created_at, type')
        .eq('candidate_id', employeeId!)
        .or('is_dismissed.is.null,is_dismissed.eq.false')
        .order('created_at', { ascending: false })
        .limit(20);

      const approvalItems = (timesheets ?? []).map((n) => ({
        id: `timesheet-${n.id}`,
        created_at: n.approved_at,
        text: n.status === 'goedgekeurd'
          ? `Je uren van ${formatDate(n.work_date)} zijn goedgekeurd \u2713`
          : `Je uren van ${formatDate(n.work_date)} zijn afgekeurd \u2717`,
        className: n.status === 'goedgekeurd' ? 'text-stat-green' : 'text-destructive',
      }));

      const portalItems = (employeeNotifications ?? []).map((n) => ({
        id: `notification-${n.id}`,
        created_at: n.created_at,
        text: n.message ? `${n.title} — ${n.message}` : n.title,
        className: n.severity === 'urgent' ? 'text-destructive' : n.type === 'verjaardag' ? 'text-stat-blue' : 'text-foreground',
      }));

      return [...approvalItems, ...portalItems]
        .filter((n) => !!n.created_at)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    },
    enabled: !!employeeId,
    refetchInterval: 30000,
  });

  const unseenCount = notifications.filter((n) => !seenIds.includes(n.id)).length;

  const markAllSeen = () => {
    if (!storageKey) return;
    const allIds = [...new Set([...seenIds, ...notifications.map(n => n.id)])];
    setSeenIds(allIds);
    localStorage.setItem(storageKey, JSON.stringify(allIds));
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8 relative" title="Meldingen">
          <Bell className="h-4 w-4" />
          {unseenCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unseenCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <span className="text-sm font-semibold">Meldingen</span>
          {unseenCount > 0 && (
            <Button variant="ghost" size="sm" className="text-xs h-auto py-1 px-2" onClick={markAllSeen}>
              Alles gelezen
            </Button>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">
              Geen meldingen
            </div>
          ) : (
            notifications.map((n) => {
              const isSeen = seenIds.includes(n.id);
              return (
                <div
                  key={n.id}
                  className={`px-4 py-2.5 border-b last:border-b-0 text-sm ${!isSeen ? 'bg-muted/50' : ''}`}
                >
                  <span className={n.className}>{n.text}</span>
                </div>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};

export default PortalNotifications;
