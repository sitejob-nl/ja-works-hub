import EmailTemplateList from '@/components/email/EmailTemplateList';
import EmailTemplateFlowOverview from '@/components/email/EmailTemplateFlowOverview';

const EmailTemplates = () => {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">E-mailtemplates</h1>
        <p className="text-muted-foreground text-sm">
          Beheer HTML templates met variabelen en zie welke automatische mails welke templatebron gebruiken.
        </p>
      </div>
      <EmailTemplateFlowOverview />
      <EmailTemplateList />
    </div>
  );
};

export default EmailTemplates;
