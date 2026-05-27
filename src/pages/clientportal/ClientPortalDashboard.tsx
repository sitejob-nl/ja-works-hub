import { useClientPortal } from '@/contexts/ClientPortalContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Clock, MapPin, ArrowRight } from 'lucide-react';

const ClientPortalDashboard = () => {
  const { contact, company } = useClientPortal();
  const companyId = company?.id;

  const { data: stats } = useQuery({
    queryKey: ['client-portal-stats', companyId, company?.timesheet_entry_flow],
    queryFn: async () => {
      const entryFlow = company?.timesheet_entry_flow ?? 'medewerker';
      const canClientEnter = entryFlow === 'opdrachtgever' || entryFlow === 'kloksysteem';
      const sourceForFlow = entryFlow === 'kloksysteem' ? 'kloksysteem' : 'klantportaal';

      // Active placements count
      const { count: placementsCount } = await supabase
        .from('placements')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId!)
        .eq('status', 'actief');

      // Timesheets awaiting client action, or employee confirmation when client enters hours.
      let pendingQuery = supabase
        .from('timesheets')
        .select('id, placements!inner(company_id)', { count: 'exact', head: true })
        .eq('placements.company_id', companyId!);

      if (canClientEnter) {
        pendingQuery = pendingQuery.eq('source', sourceForFlow as any).eq('client_approved', true).eq('employee_confirmed', false);
      } else {
        pendingQuery = pendingQuery.in('status', ['groen', 'oranje', 'rood'] as any).is('client_approved', null);
      }

      const { count: pendingCount } = await pendingQuery;

      return {
        activePlacements: placementsCount ?? 0,
        pendingTimesheets: pendingCount ?? 0,
        canClientEnter,
      };
    },
    enabled: !!companyId,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Welkom{contact?.first_name ? `, ${contact.first_name}` : ''}</h1>
        {company?.name && <p className="text-muted-foreground mt-1">{company.name}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Actieve plaatsingen</p>
              <p className="text-3xl font-bold mt-2">{stats?.activePlacements ?? '-'}</p>
            </div>
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <MapPin className="h-5 w-5 text-primary" />
            </div>
          </div>
          <Button variant="link" asChild className="px-0 mt-3">
            <Link to="/klantportaal/plaatsingen" className="text-sm gap-1">Bekijk plaatsingen <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Button>
        </Card>

        <Card className="p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{stats?.canClientEnter ? 'Uren wachten op medewerker' : 'Uren te beoordelen'}</p>
              <p className="text-3xl font-bold mt-2">{stats?.pendingTimesheets ?? '-'}</p>
            </div>
            <div className="h-10 w-10 rounded-lg bg-orange-100 flex items-center justify-center">
              <Clock className="h-5 w-5 text-orange-600" />
            </div>
          </div>
          <Button variant="link" asChild className="px-0 mt-3">
            <Link to="/klantportaal/uren" className="text-sm gap-1">{stats?.canClientEnter ? 'Geef uren door' : 'Beoordeel uren'} <ArrowRight className="h-3.5 w-3.5" /></Link>
          </Button>
        </Card>
      </div>
    </div>
  );
};

export default ClientPortalDashboard;
