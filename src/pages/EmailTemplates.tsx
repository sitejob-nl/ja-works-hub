import EmailTemplateList from '@/components/email/EmailTemplateList';

const EmailTemplates = () => {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Email Templates</h1>
        <p className="text-muted-foreground text-sm">
          Maak HTML templates met variabelen voor geautomatiseerde emails, uitnodigingen en campagnes
        </p>
      </div>
      <EmailTemplateList />
    </div>
  );
};

export default EmailTemplates;
