export type CommunicationRecipient = {
  id: string;
  label: string;
  email?: string | null;
  phone?: string | null;
  companyContactId?: string | null;
};

export type CommunicationEntityType = 'candidate' | 'company' | 'contact';
