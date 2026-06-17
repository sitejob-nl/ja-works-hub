import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useOutlookAccounts, useOutlookInvoke } from '@/hooks/useOutlookAccounts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChevronLeft, ChevronRight, Plus, Calendar as CalendarIcon, Clock, MapPin, Users, Loader2, AlertCircle,
  LayoutGrid, List,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import CalendarEventForm from './CalendarEventForm';
import {
  startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval,
  format, addWeeks, subWeeks, addMonths, subMonths, isSameDay, isSameMonth,
  parseISO, isToday, addDays,
} from 'date-fns';
import { nl } from 'date-fns/locale';

interface CalendarEvent {
  id: string;
  subject: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  location?: { displayName: string };
  isAllDay?: boolean;
  showAs?: string;
  organizer?: { emailAddress: { name: string; address: string } };
  attendees?: any[];
  body?: { content: string; contentType: string };
  importance?: string;
}

type ViewMode = 'week' | 'month' | 'list';

const showAsColors: Record<string, string> = {
  busy: 'bg-blue-500',
  tentative: 'bg-blue-300',
  free: 'bg-green-500',
  oof: 'bg-purple-500',
  workingElsewhere: 'bg-yellow-500',
};

function eventTime(evt: CalendarEvent) {
  if (evt.isAllDay) return 'Hele dag';
  return format(parseISO(evt.start.dateTime), 'HH:mm') + ' - ' + format(parseISO(evt.end.dateTime), 'HH:mm');
}

const CalendarView = ({ selectedAccount }: { selectedAccount?: string }) => {
  const callOutlook = useOutlookInvoke();
  const { accounts } = useOutlookAccounts('calendar_read');
  const activeAccount = accounts.find((account) => account.account_id === selectedAccount);
  const canRead = Boolean(
    selectedAccount &&
      activeAccount?.microsoft_access_ok &&
      activeAccount?.capabilities.calendar_read &&
      activeAccount?.ja_grants.calendar_read,
  );
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [formOpen, setFormOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [defaultDate, setDefaultDate] = useState<string | undefined>();

  // Calculate date range based on view
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (viewMode === 'week') {
      const start = startOfWeek(currentDate, { weekStartsOn: 1 });
      const end = endOfWeek(currentDate, { weekStartsOn: 1 });
      return { rangeStart: start, rangeEnd: end };
    }
    if (viewMode === 'month') {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const start = startOfWeek(monthStart, { weekStartsOn: 1 });
      const end = endOfWeek(monthEnd, { weekStartsOn: 1 });
      return { rangeStart: start, rangeEnd: end };
    }
    // list: next 14 days
    return { rangeStart: new Date(), rangeEnd: addDays(new Date(), 14) };
  }, [currentDate, viewMode]);

  const { data: eventsData, isLoading, isFetching } = useQuery({
    queryKey: ['outlook-calendar', rangeStart.toISOString(), rangeEnd.toISOString(), selectedAccount],
    queryFn: () => callOutlook('outlook-calendar', {
      action: 'list',
      account_id: selectedAccount,
      startDateTime: rangeStart.toISOString(),
      endDateTime: rangeEnd.toISOString(),
      top: 100,
    }),
    enabled: canRead,
    refetchInterval: 60_000,
  });

  const events: CalendarEvent[] = useMemo(() => eventsData?.value || [], [eventsData]);

  // Group events by day for list view — declared before any early return to keep hook order stable
  const groupedByDay = useMemo(() => {
    const groups: Record<string, CalendarEvent[]> = {};
    events.forEach(e => {
      const dayKey = format(parseISO(e.start.dateTime), 'yyyy-MM-dd');
      if (!groups[dayKey]) groups[dayKey] = [];
      groups[dayKey].push(e);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  const navigate = (dir: 'prev' | 'next' | 'today') => {
    if (dir === 'today') { setCurrentDate(new Date()); return; }
    if (viewMode === 'week') setCurrentDate(d => dir === 'next' ? addWeeks(d, 1) : subWeeks(d, 1));
    if (viewMode === 'month') setCurrentDate(d => dir === 'next' ? addMonths(d, 1) : subMonths(d, 1));
    if (viewMode === 'list') setCurrentDate(d => dir === 'next' ? addWeeks(d, 2) : subWeeks(d, 2));
  };

  const eventsForDay = (day: Date) =>
    events.filter(e => isSameDay(parseISO(e.start.dateTime), day));

  const handleNewEvent = (date?: string) => {
    setSelectedEvent(null);
    setDefaultDate(date);
    setFormOpen(true);
  };

  const handleEditEvent = (evt: CalendarEvent) => {
    setSelectedEvent(evt);
    setDefaultDate(undefined);
    setFormOpen(true);
  };

  if (!canRead) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4 text-muted-foreground">
        <AlertCircle className="h-12 w-12" />
        <p className="text-lg">Geen leesbare Outlook agenda geselecteerd</p>
        <p className="text-sm">{activeAccount?.status_reason || 'Ga naar Instellingen om agenda accounts en rechten te beheren'}</p>
        <Button variant="outline" onClick={() => window.location.href = '/instellingen'}>
          Naar Instellingen
        </Button>
      </div>
    );
  }

  const weekDays = viewMode === 'week'
    ? eachDayOfInterval({ start: rangeStart, end: rangeEnd })
    : [];

  const monthDays = viewMode === 'month'
    ? eachDayOfInterval({ start: rangeStart, end: rangeEnd })
    : [];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('today')}>Vandaag</Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('prev')} aria-label="Vorige periode">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigate('next')} aria-label="Volgende periode">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold">
            {viewMode === 'month'
              ? format(currentDate, 'MMMM yyyy', { locale: nl })
              : `${format(rangeStart, 'd MMM', { locale: nl })} - ${format(rangeEnd, 'd MMM yyyy', { locale: nl })}`
            }
          </h2>
          {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex border rounded-md">
            <Button variant={viewMode === 'week' ? 'default' : 'ghost'} size="sm" className="rounded-r-none" onClick={() => setViewMode('week')}>
              <LayoutGrid className="h-4 w-4 mr-1" /> Week
            </Button>
            <Button variant={viewMode === 'month' ? 'default' : 'ghost'} size="sm" className="rounded-none border-x" onClick={() => setViewMode('month')}>
              <CalendarIcon className="h-4 w-4 mr-1" /> Maand
            </Button>
            <Button variant={viewMode === 'list' ? 'default' : 'ghost'} size="sm" className="rounded-l-none" onClick={() => setViewMode('list')}>
              <List className="h-4 w-4 mr-1" /> Lijst
            </Button>
          </div>
          <Button onClick={() => handleNewEvent()} className="gap-2" size="sm">
            <Plus className="h-4 w-4" /> Nieuwe afspraak
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : viewMode === 'list' ? (
        /* LIST VIEW */
        <div className="space-y-4">
          {groupedByDay.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CalendarIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
              <p>Geen afspraken in deze periode</p>
            </div>
          ) : groupedByDay.map(([dayKey, dayEvents]) => (
            <div key={dayKey}>
              <h3 className={cn(
                'text-sm font-semibold mb-2 sticky top-0 bg-background py-1',
                isToday(parseISO(dayKey)) && 'text-stat-blue'
              )}>
                {isToday(parseISO(dayKey)) ? 'Vandaag' : format(parseISO(dayKey), 'EEEE d MMMM', { locale: nl })}
              </h3>
              <div className="space-y-1">
                {dayEvents.map(evt => (
                  <Card key={evt.id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => handleEditEvent(evt)}>
                    <CardContent className="p-3 flex items-start gap-3">
                      <div className={cn('w-1 h-full min-h-[2rem] rounded-full shrink-0', showAsColors[evt.showAs || 'busy'] || 'bg-blue-500')} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{evt.subject}</p>
                        <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {eventTime(evt)}
                          </span>
                          {evt.location?.displayName && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {evt.location.displayName}
                            </span>
                          )}
                          {(evt.attendees?.length || 0) > 0 && (
                            <span className="flex items-center gap-1">
                              <Users className="h-3 w-3" /> {evt.attendees!.length} deelnemers
                            </span>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : viewMode === 'week' ? (
        /* WEEK VIEW */
        <div className="grid grid-cols-7 gap-px bg-border rounded-lg overflow-hidden border">
          {/* Day headers */}
          {weekDays.map(day => (
            <div key={day.toISOString()} className={cn(
              'bg-muted/30 p-2 text-center',
              isToday(day) && 'bg-primary/10'
            )}>
              <p className="text-xs text-muted-foreground">{format(day, 'EEE', { locale: nl })}</p>
              <p className={cn(
                'text-lg font-semibold',
                isToday(day) && 'text-stat-blue'
              )}>
                {format(day, 'd')}
              </p>
            </div>
          ))}
          {/* Day cells */}
          {weekDays.map(day => {
            const dayEvts = eventsForDay(day);
            return (
              <div
                key={day.toISOString() + '-cell'}
                className={cn(
                  'bg-background min-h-[120px] p-1 cursor-pointer hover:bg-muted/30 transition-colors',
                  isToday(day) && 'bg-primary/5'
                )}
                onClick={() => handleNewEvent(format(day, 'yyyy-MM-dd'))}
              >
                <div className="space-y-0.5">
                  {dayEvts.slice(0, 4).map(evt => (
                    <button
                      key={evt.id}
                      onClick={(e) => { e.stopPropagation(); handleEditEvent(evt); }}
                      className={cn(
                        'w-full text-left px-1.5 py-0.5 rounded text-xs truncate',
                        showAsColors[evt.showAs || 'busy'] || 'bg-blue-500',
                        'text-white'
                      )}
                    >
                      {!evt.isAllDay && format(parseISO(evt.start.dateTime), 'HH:mm') + ' '}
                      {evt.subject}
                    </button>
                  ))}
                  {dayEvts.length > 4 && (
                    <p className="text-xs text-muted-foreground px-1">+{dayEvts.length - 4} meer</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* MONTH VIEW */
        <div className="border rounded-lg overflow-hidden">
          {/* Day headers */}
          <div className="grid grid-cols-7 bg-muted/30">
            {['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].map(d => (
              <div key={d} className="p-2 text-center text-xs font-medium text-muted-foreground border-b">{d}</div>
            ))}
          </div>
          {/* Weeks */}
          <div className="grid grid-cols-7 gap-px bg-border">
            {monthDays.map(day => {
              const dayEvts = eventsForDay(day);
              const inMonth = isSameMonth(day, currentDate);
              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    'bg-background min-h-[80px] p-1 cursor-pointer hover:bg-muted/30 transition-colors',
                    !inMonth && 'opacity-40',
                    isToday(day) && 'bg-primary/5'
                  )}
                  onClick={() => handleNewEvent(format(day, 'yyyy-MM-dd'))}
                >
                  <p className={cn(
                    'text-xs font-medium mb-0.5',
                    isToday(day) ? 'text-stat-blue font-bold' : 'text-muted-foreground'
                  )}>
                    {format(day, 'd')}
                  </p>
                  {dayEvts.slice(0, 2).map(evt => (
                    <button
                      key={evt.id}
                      onClick={(e) => { e.stopPropagation(); handleEditEvent(evt); }}
                      className={cn(
                        'w-full text-left px-1 py-0.5 rounded text-[10px] truncate mb-0.5',
                        showAsColors[evt.showAs || 'busy'] || 'bg-blue-500',
                        'text-white'
                      )}
                    >
                      {evt.subject}
                    </button>
                  ))}
                  {dayEvts.length > 2 && (
                    <p className="text-[10px] text-muted-foreground px-1">+{dayEvts.length - 2}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <CalendarEventForm
        open={formOpen}
        onOpenChange={setFormOpen}
        event={selectedEvent}
        defaultDate={defaultDate}
        selectedAccount={selectedAccount}
      />
    </div>
  );
};

export default CalendarView;
