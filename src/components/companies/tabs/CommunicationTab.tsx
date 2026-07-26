import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import CandidateCommunicationTab from '@/components/candidates/tabs/CandidateCommunicationTab';
import type { CommunicationRecipient } from '@/components/communications/types';
import type { Database } from '@/integrations/supabase/types';
import { unwrapList } from '@/lib/db';

type Company = Pick<
  Database['public']['Tables']['companies']['Row'],
  'id' | 'name' | 'email' | 'invoice_email' | 'invoice_cc' | 'phone'
>;

const CommunicationTab = ({ company }: { company: Company }) => {
  const { data: contacts = [], isLoading } = useQuery({
    queryKey: ['company-communication-contacts', company.id],
    queryFn: () => unwrapList(
      supabase
        .from('company_contacts')
        .select('id, full_name, email, phone')
        .eq('company_id', company.id)
        .order('is_primary', { ascending: false })
        .order('full_name'),
    ),
  });

  const companyEmails = [company.email, company.invoice_email, company.invoice_cc]
    .flatMap((value) => String(value ?? '').split(/[,;]/))
    .map((value) => value.trim())
    .filter(Boolean);

  const recipients: CommunicationRecipient[] = [
    ...companyEmails.map((email, index) => ({
      id: `company-email:${index}:${email}`,
      label: index === 0 ? company.name : `${company.name} (facturatie)`,
      email,
      phone: index === 0 ? company.phone : null,
    })),
    ...(!companyEmails.length && company.phone ? [{
      id: `company-phone:${company.id}`,
      label: company.name,
      email: null,
      phone: company.phone,
    }] : []),
    ...contacts.map((contact) => ({
      id: `contact:${contact.id}`,
      label: contact.full_name,
      email: contact.email,
      phone: contact.phone,
      companyContactId: contact.id,
    })),
  ];

  if (isLoading) return <div className="py-8 text-sm text-muted-foreground">Communicatie laden...</div>;

  return (
    <CandidateCommunicationTab
      entityType="company"
      entityId={company.id}
      companyId={company.id}
      recipients={recipients}
    />
  );
};

export default CommunicationTab;
