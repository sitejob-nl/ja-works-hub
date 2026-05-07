import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { invokeOutlookFunction, useOutlookAccounts, type OutlookAccount } from '@/hooks/useOutlookAccounts';
import { Building2, CalendarCheck, CheckCircle2, Loader2, Mail, Plus, RotateCcw, ShieldCheck, Trash2, User } from 'lucide-react';

type AdminUser = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
};

type Grant = {
  user_id: string;
  can_read_mail: boolean;
  can_send_mail: boolean;
  can_delete_mail: boolean;
  can_read_calendar: boolean;
  can_write_calendar: boolean;
};

type AdminAccount = OutlookAccount & {
  raw: Record<string, any>;
  grants: Grant[];
};

function accountName(account: OutlookAccount) {
  return account.name || account.email || account.label;
}

function accountEmail(account: OutlookAccount) {
  return account.email || account.name || 'Geen e-mailadres';
}

function statusBadge(account: OutlookAccount) {
  if (account.status === 'connected') {
    return <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" /> Actief</Badge>;
  }
  if (account.status === 'needs_test') return <Badge variant="outline">Test nodig</Badge>;
  if (account.status === 'needs_reconnect') return <Badge variant="outline">Herkoppelen</Badge>;
  if (account.status === 'failed') return <Badge variant="destructive">Mislukt</Badge>;
  return <Badge variant="outline">{account.status || 'Concept'}</Badge>;
}

const OutlookSettings = () => {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sharedName, setSharedName] = useState('');
  const [sharedEmail, setSharedEmail] = useState('');
  const [connectingScope, setConnectingScope] = useState<'organization' | 'personal' | null>(null);

  const visible = useOutlookAccounts('any');
  const adminList = useQuery({
    queryKey: ['outlook-accounts-admin'],
    queryFn: () => invokeOutlookFunction<{ users: AdminUser[]; accounts: AdminAccount[] }>('outlook-accounts', { action: 'admin_list' }),
    enabled: isAdmin,
  });

  useEffect(() => {
    if (searchParams.get('outlook_connected') === '1') {
      toast.success('Outlook gekoppeld');
      queryClient.invalidateQueries({ queryKey: ['outlook-accounts-visible'] });
      queryClient.invalidateQueries({ queryKey: ['outlook-accounts-admin'] });
      searchParams.delete('outlook_connected');
      searchParams.delete('outlook_scope');
      setSearchParams(searchParams, { replace: true });
    }
  }, [queryClient, searchParams, setSearchParams]);

  const connect = useMutation({
    mutationFn: async (scope: 'organization' | 'personal') => {
      setConnectingScope(scope);
      const returnTo = `${window.location.origin}${window.location.pathname}`;
      return invokeOutlookFunction<{ authorization_url: string }>('outlook-start', { scope, return_to: returnTo });
    },
    onSuccess: (data) => {
      window.location.href = data.authorization_url;
    },
    onError: (error: Error) => {
      setConnectingScope(null);
      toast.error(`Outlook koppelen mislukt: ${error.message}`);
    },
  });

  const action = useMutation({
    mutationFn: (body: Record<string, unknown>) => invokeOutlookFunction('outlook-accounts', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['outlook-accounts-visible'] });
      queryClient.invalidateQueries({ queryKey: ['outlook-accounts-admin'] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const accounts = (isAdmin ? adminList.data?.accounts : visible.accounts) || [];
  const users = adminList.data?.users || [];
  const orgCredential = accounts.find((account) => account.scope === 'organization' && account.mode === 'user');
  const personalAccount = visible.accounts.find((account) => account.scope === 'personal');
  const sharedAccounts = accounts.filter((account) => account.scope === 'organization' && account.mode === 'shared');

  const grantByAccount = useMemo(() => {
    const map = new Map<string, Map<string, Grant>>();
    for (const account of accounts as AdminAccount[]) {
      const grants = new Map<string, Grant>();
      for (const grant of account.grants || []) grants.set(grant.user_id, grant);
      map.set(account.account_id, grants);
    }
    return map;
  }, [accounts]);

  const createShared = async () => {
    if (!sharedEmail.trim()) {
      toast.error('Vul een mailbox e-mailadres in');
      return;
    }
    await action.mutateAsync({
      action: 'create_shared',
      display_name: sharedName || sharedEmail,
      mailbox_email: sharedEmail,
    });
    setSharedName('');
    setSharedEmail('');
    toast.success('Gedeelde mailbox toegevoegd. Test mail en agenda om rechten te bevestigen.');
  };

  const setGrant = async (account: AdminAccount, user: AdminUser, field: keyof Grant, value: boolean) => {
    const current = grantByAccount.get(account.account_id) || new Map<string, Grant>();
    const next = new Map(current);
    const existing = next.get(user.id) || {
      user_id: user.id,
      can_read_mail: false,
      can_send_mail: false,
      can_delete_mail: false,
      can_read_calendar: false,
      can_write_calendar: false,
    };
    next.set(user.id, { ...existing, [field]: value });
    await action.mutateAsync({
      action: 'set_grants',
      account_id: account.account_id,
      grants: Array.from(next.values()),
    });
  };

  const renderPermissions = (account: AdminAccount) => {
    if (!isAdmin || users.length === 0) return null;
    const grants = grantByAccount.get(account.account_id);

    return (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left font-medium">Medewerker</th>
              <th className="py-2 text-center font-medium">Mail lezen</th>
              <th className="py-2 text-center font-medium">Mail sturen</th>
              <th className="py-2 text-center font-medium">Agenda lezen</th>
              <th className="py-2 text-center font-medium">Agenda beheren</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const grant = grants?.get(user.id);
              return (
                <tr key={user.id} className="border-b last:border-b-0">
                  <td className="py-2">
                    <div className="font-medium">{user.full_name || user.email || 'Gebruiker'}</div>
                    <div className="text-xs text-muted-foreground">{user.role}</div>
                  </td>
                  <td className="py-2 text-center">
                    <Checkbox checked={Boolean(grant?.can_read_mail)} onCheckedChange={(checked) => setGrant(account, user, 'can_read_mail', checked === true)} />
                  </td>
                  <td className="py-2 text-center">
                    <Checkbox checked={Boolean(grant?.can_send_mail)} onCheckedChange={(checked) => setGrant(account, user, 'can_send_mail', checked === true)} />
                  </td>
                  <td className="py-2 text-center">
                    <Checkbox checked={Boolean(grant?.can_read_calendar)} onCheckedChange={(checked) => setGrant(account, user, 'can_read_calendar', checked === true)} />
                  </td>
                  <td className="py-2 text-center">
                    <Checkbox checked={Boolean(grant?.can_write_calendar)} onCheckedChange={(checked) => setGrant(account, user, 'can_write_calendar', checked === true)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const loading = visible.isLoading || (isAdmin && adminList.isLoading);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Mail className="h-4 w-4" /> Outlook mail & agenda
        </CardTitle>
        <CardDescription>
          Beheer hoofdaccount, bedrijfsmail, gedeelde mailboxen en je persoonlijke mailbox.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : (
          <>
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Building2 className="h-4 w-4 text-muted-foreground" /> Hoofdaccount en bedrijfsmail
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Dit account bewaart de tokens. De standaard afzender wordt gebruikt voor systeemmails.
                  </p>
                </div>
                {isAdmin && (
                  <Button size="sm" onClick={() => connect.mutate('organization')} disabled={connectingScope === 'organization'} className="gap-2">
                    {connectingScope === 'organization' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                    {orgCredential ? 'Hoofdaccount herkoppelen' : 'Hoofdaccount koppelen'}
                  </Button>
                )}
              </div>

              {orgCredential ? (
                <div className="rounded-md border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{accountName(orgCredential)}</span>
                        {statusBadge(orgCredential)}
                        {orgCredential.is_default_for_organization && <Badge variant="secondary">org-default</Badge>}
                      </div>
                      <p className="text-sm text-muted-foreground">{accountEmail(orgCredential)}</p>
                      {orgCredential.status_reason && <p className="mt-1 text-xs text-destructive">{orgCredential.status_reason}</p>}
                    </div>
                    {isAdmin && (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => action.mutate({ action: 'test_mail', account_id: orgCredential.account_id })}>Test mail</Button>
                        <Button variant="outline" size="sm" onClick={() => action.mutate({ action: 'test_calendar', account_id: orgCredential.account_id })}>Test agenda</Button>
                        <Button variant="outline" size="sm" onClick={() => action.mutate({ action: 'set_default', account_id: orgCredential.account_id })}>Maak default</Button>
                      </div>
                    )}
                  </div>
                  {renderPermissions(orgCredential as AdminAccount)}
                </div>
              ) : (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  Nog geen hoofdaccount gekoppeld.
                </p>
              )}
            </section>

            <Separator />

            {isAdmin && (
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" /> Gedeelde mailboxen en agenda's
                </div>
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <div className="space-y-1">
                    <Label>Naam</Label>
                    <Input value={sharedName} onChange={(event) => setSharedName(event.target.value)} placeholder="Planning" />
                  </div>
                  <div className="space-y-1">
                    <Label>Mailbox</Label>
                    <Input value={sharedEmail} onChange={(event) => setSharedEmail(event.target.value)} placeholder="planning@bedrijf.nl" />
                  </div>
                  <Button className="self-end gap-2" onClick={createShared} disabled={action.isPending || !orgCredential}>
                    <Plus className="h-4 w-4" /> Toevoegen
                  </Button>
                </div>

                <div className="space-y-3">
                  {sharedAccounts.length === 0 ? (
                    <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Geen gedeelde mailboxen toegevoegd.</p>
                  ) : sharedAccounts.map((account) => (
                    <div key={account.account_id} className="rounded-md border p-3 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{accountName(account)}</span>
                            {statusBadge(account)}
                            {account.is_default_for_organization && <Badge variant="secondary">org-default</Badge>}
                          </div>
                          <p className="text-sm text-muted-foreground">{accountEmail(account)}</p>
                          {account.status_reason && <p className="mt-1 text-xs text-destructive">{account.status_reason}</p>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={() => action.mutate({ action: 'test_mail', account_id: account.account_id })}>Test mail</Button>
                          <Button variant="outline" size="sm" onClick={() => action.mutate({ action: 'test_calendar', account_id: account.account_id })}>Test agenda</Button>
                          <Button variant="outline" size="sm" onClick={() => action.mutate({ action: 'set_default', account_id: account.account_id })}>Default</Button>
                          <Button variant="ghost" size="icon" className="text-destructive" onClick={() => action.mutate({ action: 'delete_account', account_id: account.account_id })}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {renderPermissions(account as AdminAccount)}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <Separator />

            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <User className="h-4 w-4 text-muted-foreground" /> Mijn mailbox
                  </div>
                  <p className="text-xs text-muted-foreground">Koppel je eigen Outlook inbox en agenda voor persoonlijk gebruik.</p>
                </div>
                <Button size="sm" variant="outline" onClick={() => connect.mutate('personal')} disabled={connectingScope === 'personal'} className="gap-2">
                  {connectingScope === 'personal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  {personalAccount ? 'Mijn mailbox herkoppelen' : 'Mijn mailbox koppelen'}
                </Button>
              </div>

              {personalAccount ? (
                <div className="rounded-md border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{accountName(personalAccount)}</span>
                    {statusBadge(personalAccount)}
                  </div>
                  <p className="text-sm text-muted-foreground">{accountEmail(personalAccount)}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {personalAccount.capabilities.mail_read && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> Mail</span>}
                    {personalAccount.capabilities.calendar_read && <span className="inline-flex items-center gap-1"><CalendarCheck className="h-3 w-3" /> Agenda</span>}
                  </div>
                </div>
              ) : (
                <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">Je persoonlijke mailbox is nog niet gekoppeld.</p>
              )}
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default OutlookSettings;
