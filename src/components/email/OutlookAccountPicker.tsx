import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useOutlookAccounts, type OutlookAccount, type OutlookCapability } from '@/hooks/useOutlookAccounts';
import { Building2, CalendarDays, Mail, ShieldAlert, User } from 'lucide-react';

interface OutlookAccountPickerProps {
  value?: string;
  onChange: (value: string) => void;
  capability?: OutlookCapability;
  className?: string;
}

function isUsable(account: OutlookAccount, capability: OutlookCapability) {
  if (!account.microsoft_access_ok) return false;
  if (capability === 'none') return true;
  if (capability === 'any') {
    return Object.values(account.capabilities).some(Boolean) && Object.values(account.ja_grants).some(Boolean);
  }
  return Boolean(account.capabilities[capability] && account.ja_grants[capability]);
}

function accountIcon(account: OutlookAccount) {
  if (account.scope === 'personal') return <User className="h-3.5 w-3.5" />;
  if (account.mode === 'shared') return <Mail className="h-3.5 w-3.5" />;
  return <Building2 className="h-3.5 w-3.5" />;
}

function titleFor(account: OutlookAccount) {
  const name = account.name || account.label;
  return account.email ? `${name} (${account.email})` : name;
}

const OutlookAccountPicker = ({ value, onChange, capability = 'any', className }: OutlookAccountPickerProps) => {
  const { accounts, isLoading } = useOutlookAccounts(capability);

  if (isLoading) {
    return (
      <Button variant="outline" disabled className={className}>
        <Mail className="mr-2 h-4 w-4" /> Outlook laden...
      </Button>
    );
  }

  if (accounts.length === 0) {
    return (
      <Button variant="outline" disabled className={className}>
        <ShieldAlert className="mr-2 h-4 w-4" /> Geen Outlook account
      </Button>
    );
  }

  return (
    <TooltipProvider>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className={className || 'w-[320px]'}>
          <div className="flex min-w-0 items-center gap-2">
            {capability.startsWith('calendar') ? <CalendarDays className="h-4 w-4 shrink-0" /> : <Mail className="h-4 w-4 shrink-0" />}
            <SelectValue placeholder="Kies Outlook account" />
          </div>
        </SelectTrigger>
        <SelectContent>
          {accounts.map((account) => {
            const usable = isUsable(account, capability);
            return (
              <SelectItem key={account.account_id} value={account.account_id} disabled={!usable}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex min-w-0 items-center gap-2">
                      {accountIcon(account)}
                      <span className="truncate">{titleFor(account)}</span>
                      {account.is_default_for_organization && <Badge variant="secondary" className="ml-1">default</Badge>}
                      {!usable && <Badge variant="outline" className="ml-1">uit</Badge>}
                    </div>
                  </TooltipTrigger>
                  {!usable && (
                    <TooltipContent>
                      {account.status_reason || 'Niet beschikbaar voor deze actie'}
                    </TooltipContent>
                  )}
                </Tooltip>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </TooltipProvider>
  );
};

export default OutlookAccountPicker;
