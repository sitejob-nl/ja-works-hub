import { useState } from 'react';
import EmailInbox from '@/components/email/EmailInbox';
import MicrosoftAccountPicker, { useMicrosoftAccounts } from '@/components/email/MicrosoftAccountPicker';

const Email = () => {
  const { accounts } = useMicrosoftAccounts();
  const defaultAccount = accounts.find(a => a.isOrg)?.key || accounts[0]?.key || 'org';
  const [selectedAccount, setSelectedAccount] = useState(defaultAccount);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">E-mail</h1>
          <p className="text-muted-foreground text-sm">Lees en verstuur e-mails via Microsoft Outlook</p>
        </div>
        <MicrosoftAccountPicker value={selectedAccount} onChange={setSelectedAccount} />
      </div>
      <EmailInbox selectedAccount={selectedAccount} />
    </div>
  );
};

export default Email;
