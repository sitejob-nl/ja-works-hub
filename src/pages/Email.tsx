import EmailInbox from '@/components/email/EmailInbox';

const Email = () => {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">E-mail</h1>
        <p className="text-muted-foreground text-sm">Lees en verstuur e-mails via Microsoft Outlook</p>
      </div>
      <EmailInbox />
    </div>
  );
};

export default Email;
