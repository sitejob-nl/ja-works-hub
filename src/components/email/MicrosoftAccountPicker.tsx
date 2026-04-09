import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Building2, User, Mail } from 'lucide-react';

interface MicrosoftAccountPickerProps {
  value: string; // 'org' | user_id
  onChange: (value: string) => void;
}

export interface MicrosoftAccount {
  id: string;
  key: string; // 'org' or user_id
  label: string;
  email: string;
  isOrg: boolean;
  userId: string | null;
}

export function useMicrosoftAccounts() {
  const { user, profile } = useAuth();
  const orgId = profile?.organization_id;

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['microsoft-configs-all', orgId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('microsoft_config' as any)
        .select('*')
        .eq('organization_id', orgId!)
        .eq('is_active', true);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!orgId,
  });

  const accounts: MicrosoftAccount[] = configs
    .filter((c: any) => c.microsoft_email)
    .map((c: any) => ({
      id: c.id,
      key: c.user_id ? c.user_id : 'org',
      label: c.user_id ? 'Persoonlijk' : 'Organisatie',
      email: c.microsoft_email,
      isOrg: !c.user_id,
      userId: c.user_id || null,
    }));

  return { accounts, isLoading, hasAccounts: accounts.length > 0 };
}

const MicrosoftAccountPicker = ({ value, onChange }: MicrosoftAccountPickerProps) => {
  const { accounts, isLoading } = useMicrosoftAccounts();

  if (isLoading || accounts.length <= 1) return null;

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[280px]">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4" />
          <SelectValue placeholder="Kies account" />
        </div>
      </SelectTrigger>
      <SelectContent>
        {accounts.map(acc => (
          <SelectItem key={acc.key} value={acc.key}>
            <div className="flex items-center gap-2">
              {acc.isOrg ? <Building2 className="h-3 w-3" /> : <User className="h-3 w-3" />}
              <span>{acc.label}</span>
              <span className="text-muted-foreground text-xs">({acc.email})</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default MicrosoftAccountPicker;
