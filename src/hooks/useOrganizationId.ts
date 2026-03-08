import { useAuth } from '@/contexts/AuthContext';

export const useOrganizationId = (): string => {
  const { profile } = useAuth();
  if (!profile?.organization_id) throw new Error('No organization_id');
  return profile.organization_id;
};
