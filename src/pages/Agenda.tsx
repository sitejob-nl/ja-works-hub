import { useState } from 'react';
import CalendarView from '@/components/calendar/CalendarView';
import MicrosoftAccountPicker, { useMicrosoftAccounts } from '@/components/email/MicrosoftAccountPicker';

const Agenda = () => {
  const { accounts } = useMicrosoftAccounts();
  const defaultAccount = accounts.find(a => a.isOrg)?.key || accounts[0]?.key || 'org';
  const [selectedAccount, setSelectedAccount] = useState(defaultAccount);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agenda</h1>
          <p className="text-muted-foreground text-sm">Beheer je Outlook agenda</p>
        </div>
        <MicrosoftAccountPicker value={selectedAccount} onChange={setSelectedAccount} />
      </div>
      <CalendarView selectedAccount={selectedAccount} />
    </div>
  );
};

export default Agenda;
