import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Send } from 'lucide-react';
import PortalActivateSheet from '@/components/employees/PortalActivateSheet';
import { formatDate } from '@/lib/format';

const Field = ({ label, value }: { label: string; value: string | null | undefined }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm mt-0.5">{value || '—'}</p>
  </div>
);

const EmployeePortalTab = ({ employee }: { employee: any }) => {
  const [sheetOpen, setSheetOpen] = useState(false);
  const c = employee.candidates;
  const portalEnabled = employee.portal_enabled === true;

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg border p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Medewerkerportaal</h3>
          <Badge variant="secondary" className={portalEnabled ? 'bg-stat-green/10 text-stat-green border-0' : 'bg-muted text-muted-foreground border-0'}>
            {portalEnabled ? 'Portaal actief' : 'Portaal niet actief'}
          </Badge>
        </div>
        {portalEnabled ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Geactiveerd op" value={formatDate(employee.portal_activated_at)} />
              <Field label="Taal" value={employee.portal_language === 'en' ? 'English' : 'Nederlands'} />
              <Field label="Laatste login" value={formatDate(employee.portal_last_login) || 'Nog niet ingelogd'} />
            </div>
            <Button variant="outline" size="sm" className="gap-2" onClick={() => setSheetOpen(true)}>
              <Send className="h-4 w-4" /> Nieuwe uitnodiging versturen
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Het portaal is nog niet geactiveerd voor deze medewerker. Activeer het portaal zodat de medewerker zelf uren kan registreren, documenten kan inzien en ziekmeldingen kan doorgeven.</p>
            <Button size="sm" onClick={() => setSheetOpen(true)}>
              Portaal activeren
            </Button>
          </div>
        )}
      </div>

      <PortalActivateSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        employeeId={employee.id}
        candidateEmail={c?.email}
      />
    </div>
  );
};

export default EmployeePortalTab;
