import { useEffect, useState } from 'react';
import EmailInbox from '@/components/email/EmailInbox';
import OutlookAccountPicker from '@/components/email/OutlookAccountPicker';
import { useOutlookAccounts } from '@/hooks/useOutlookAccounts';

const Email = () => {
  const { accounts, defaultAccountId } = useOutlookAccounts('mail_read');
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
          <h1 className="text-2xl font-bold">E-mail</h1>
          <p className="text-muted-foreground text-sm">Lees en verstuur e-mails via Microsoft Outlook</p>
        </div>
        <OutlookAccountPicker value={selectedAccount} onChange={setSelectedAccount} capability="mail_read" />
      </div>
      <EmailInbox selectedAccount={selectedAccount} />
    </div>
  );
};

export default Email;
