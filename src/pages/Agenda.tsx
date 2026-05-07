import { useEffect, useState } from 'react';
import CalendarView from '@/components/calendar/CalendarView';
import OutlookAccountPicker from '@/components/email/OutlookAccountPicker';
import { useOutlookAccounts } from '@/hooks/useOutlookAccounts';

const Agenda = () => {
  const { accounts, defaultAccountId } = useOutlookAccounts('calendar_read');
  const [selectedAccount, setSelectedAccount] = useState<string | undefined>();

  useEffect(() => {
    if (!selectedAccount && defaultAccountId) {
      setSelectedAccount(defaultAccountId);
      return;
    }
    if (selectedAccount && accounts.length > 0 && !accounts.some((account) => account.account_id === selectedAccount)) {
      setSelectedAccount(defaultAccountId);
    }
  }, [accounts, defaultAccountId, selectedAccount]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Agenda</h1>
          <p className="text-muted-foreground text-sm">Beheer je Outlook agenda</p>
        </div>
        <OutlookAccountPicker value={selectedAccount} onChange={setSelectedAccount} capability="calendar_read" />
      </div>
      <CalendarView selectedAccount={selectedAccount} />
    </div>
  );
};

export default Agenda;
