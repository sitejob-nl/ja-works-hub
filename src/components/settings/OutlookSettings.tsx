import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { usePublicUrl } from '@/hooks/usePublicUrl';
import { invokeOutlookFunction, useOutlookAccounts, type OutlookAccount } from '@/hooks/useOutlookAccounts';
import EmailSignatureEditor from '@/components/email/EmailSignatureEditor';
import { AlertTriangle, Building2, CalendarCheck, CheckCircle2, Loader2, Mail, PenLine, Plus, RotateCcw, ShieldCheck, Trash2, User } from 'lucide-react';

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

type SignatureDraft = {
  enabled: boolean;
  html: string;
  json: string;
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
  if (account.status === 'needs_reconnect') return <Badge variant="outline">Consent/herkoppelen</Badge>;
  if (account.status === 'failed') return <Badge variant="destructive">Mislukt</Badge>;
  return <Badge variant="outline">{account.status || 'Concept'}</Badge>;
}

function needsMicrosoftConsent(account?: OutlookAccount | null) {
  return Boolean(account && /consent|AADSTS65001|toestemming/i.test(`${account.status} ${account.status_reason ?? ''}`));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const OutlookSettings = () => {
  const { profile } = useAuth();
  const { buildUrl } = usePublicUrl();
  const isAdmin = profile?.role === 'admin';
  const orgId = profile?.organization_id;
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sharedName, setSharedName] = useState('');
  const [sharedEmail, setSharedEmail] = useState('');
  const [connectingKey, setConnectingKey] = useState<string | null>(null);
  const [signatureAccount, setSignatureAccount] = useState<OutlookAccount | null>(null);
  const [signatureDraft, setSignatureDraft] = useState<SignatureDraft>({ enabled: true, html: '', json: '' });

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
    if (searchParams.get('outlook_admin_consent') === '1') {
      toast.success('Microsoft admin consent is gegeven. Koppel nu het hoofdaccount opnieuw om nieuwe tokens op te slaan.');
      queryClient.invalidateQueries({ queryKey: ['outlook-accounts-visible'] });
      queryClient.invalidateQueries({ queryKey: ['outlook-accounts-admin'] });
      searchParams.delete('outlook_admin_consent');
      searchParams.delete('outlook_scope');
      setSearchParams(searchParams, { replace: true });
    }
    if (searchParams.get('outlook_error')) {
      toast.error(searchParams.get('outlook_error_description') || 'Outlook koppelen mislukt');
      searchParams.delete('outlook_error');
      searchParams.delete('outlook_error_description');
      setSearchParams(searchParams, { replace: true });
    }
  }, [queryClient, searchParams, setSearchParams]);

  const connect = useMutation({
    mutationFn: async ({ scope, targetUserId, forceConsent, adminConsent, loginHint }: {
      scope: 'organization' | 'personal';
      targetUserId?: string;
      forceConsent?: boolean;
      adminConsent?: boolean;
      loginHint?: string | null;
    }) => {
      const key = adminConsent ? 'organization:admin-consent' : targetUserId ? `${scope}:${targetUserId}` : scope;
      setConnectingKey(key);
      const returnTo = buildUrl('/instellingen');
      return invokeOutlookFunction<{ authorization_url: string }>('outlook-start', {
        scope,
        target_user_id: targetUserId,
        return_to: returnTo,
        force_consent: forceConsent,
        consent_flow: adminConsent ? 'admin' : undefined,
        login_hint: loginHint || undefined,
      });
    },
    onSuccess: (data) => {
      window.location.href = data.authorization_url;
    },
    onError: (error: Error) => {
      setConnectingKey(null);
      toast.error(`Outlook koppelen mislukt: ${error.message}`);
    },
  });

  const action = useMutation({
    mutationFn: (body: Record<string, unknown>) => invokeOutlookFunction('outlook-accounts', body),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['outlook-accounts-visible'] });
      queryClient.invalidateQueries({ queryKey: ['outlook-accounts-admin'] });
      const actionName = variables.action;
      if (actionName === 'test_mail') toast.success('Mailtoegang getest');
      if (actionName === 'test_calendar') toast.success('Agendatoegang getest');
      if (actionName === 'set_default') toast.success('Standaard mailbox bijgewerkt');
      if (actionName === 'delete_account') toast.success('Mailbox verwijderd');
      if (actionName === 'update_signature') toast.success('Handtekening opgeslagen');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const adminAccounts = adminList.data?.accounts;
  const visibleAccounts = visible.data;
  const accounts = useMemo(
    () => (isAdmin ? (adminAccounts ?? []) : (visibleAccounts ?? [])),
    [adminAccounts, isAdmin, visibleAccounts],
  );
  const users = adminList.data?.users || [];
  const orgCredential = accounts.find((account) => account.scope === 'organization' && account.mode === 'user');
  const personalAccount = visible.accounts.find((account) => account.scope === 'personal');
  const personalAccounts = accounts.filter((account) => account.scope === 'personal');
  const sharedAccounts = accounts.filter((account) => account.scope === 'organization' && account.mode === 'shared');
  const failedAccounts = accounts.filter((account) => ['failed', 'needs_reconnect'].includes(account.status));
  const connectedSharedAccounts = sharedAccounts.filter((account) => account.status === 'connected');
  const grantCount = (accounts as AdminAccount[]).reduce((sum, account) => sum + (account.grants?.length ?? 0), 0);
  const deleteGrantCount = (accounts as AdminAccount[]).reduce(
    (sum, account) => sum + (account.grants?.filter((grant) => grant.can_delete_mail).length ?? 0),
    0,
  );
  const outlookAcceptanceOk = Boolean(orgCredential?.status === 'connected')
    && sharedAccounts.length > 0
    && connectedSharedAccounts.length === sharedAccounts.length
    && failedAccounts.length === 0;
  const personalByUser = useMemo(() => {
    const map = new Map<string, AdminAccount>();
    for (const account of personalAccounts as AdminAccount[]) {
      const ownerId = account.raw?.owner_user_id;
      if (ownerId) map.set(ownerId, account);
    }
    return map;
  }, [personalAccounts]);

  const defaultSignatureHtml = (account: OutlookAccount) => {
    const name = account.name || '{{afzender_naam}}';
    const email = account.email || '{{mailbox_email}}';
    return `<p>Met vriendelijke groet,</p><p><strong>${escapeHtml(name)}</strong></p><p>${escapeHtml(email)}</p>`;
  };

  const accountSignatureJson = (account: OutlookAccount) => {
    if (!account.signature_json) return '';
    return typeof account.signature_json === 'string'
      ? account.signature_json
      : JSON.stringify(account.signature_json);
  };

  const openSignatureEditor = (account: OutlookAccount) => {
    setSignatureAccount(account);
    setSignatureDraft({
      enabled: account.signature_enabled !== false,
      html: account.signature_html || defaultSignatureHtml(account),
      json: accountSignatureJson(account),
    });
  };

  const saveSignature = async () => {
    if (!signatureAccount) return;
    await action.mutateAsync({
      action: 'update_signature',
      account_id: signatureAccount.account_id,
      signature_enabled: signatureDraft.enabled,
      signature_html: signatureDraft.html,
      signature_json: signatureDraft.json,
    });
    setSignatureAccount(null);
  };

  const uploadSignatureImage = async (file: File) => {
    if (!orgId) throw new Error('Organisatie ontbreekt');
    if (!file.type.startsWith('image/')) {
      toast.error('Kies een afbeelding');
      throw new Error('invalid_image');
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Afbeelding is te groot. Maximaal 2 MB.');
      throw new Error('image_too_large');
    }

    const extByType: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    const ext = extByType[file.type] || file.name.split('.').pop()?.toLowerCase() || 'png';
    const path = `${orgId}/signatures/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage
      .from('organization-logos')
      .upload(path, file, { upsert: false, contentType: file.type });
    if (error) {
      toast.error('Afbeelding uploaden mislukt: ' + error.message);
      throw error;
    }
    return supabase.storage.from('organization-logos').getPublicUrl(path).data.publicUrl;
  };

  const renderSignatureButton = (account: OutlookAccount) => (
    <Button variant="outline" size="sm" onClick={() => openSignatureEditor(account)} className="gap-2">
      <PenLine className="h-4 w-4" /> Handtekening
    </Button>
  );

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
              <th className="py-2 text-center font-medium">Mail verwijderen</th>
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
                    <Checkbox checked={Boolean(grant?.can_delete_mail)} onCheckedChange={(checked) => setGrant(account, user, 'can_delete_mail', checked === true)} />
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
    <>
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
            {isAdmin && (
              <section className={`rounded-md border p-3 ${outlookAcceptanceOk ? 'border-green-200 bg-green-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
                <div className="flex items-start gap-3">
                  {outlookAcceptanceOk ? (
                    <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-700" />
                  ) : (
                    <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" />
                  )}
                  <div className="space-y-2">
                    <div>
                      <p className="text-sm font-semibold">Outlook acceptatiecheck</p>
                      <p className="text-xs text-muted-foreground">
                        Hoofdaccount, gedeelde mailboxen, rechtenmatrix en delete-rechten voor de go-live-test.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant={orgCredential?.status === 'connected' ? 'default' : 'outline'}>
                        Hoofdaccount {orgCredential?.status === 'connected' ? 'OK' : 'niet klaar'}
                      </Badge>
                      <Badge variant={sharedAccounts.length > 0 && connectedSharedAccounts.length === sharedAccounts.length ? 'default' : 'outline'}>
                        Gedeeld {connectedSharedAccounts.length}/{sharedAccounts.length}
                      </Badge>
                      <Badge variant={grantCount > 0 ? 'default' : 'outline'}>{grantCount} rechten</Badge>
                      <Badge variant={deleteGrantCount > 0 ? 'secondary' : 'outline'}>{deleteGrantCount} delete-rechten</Badge>
                      {failedAccounts.length > 0 && <Badge variant="destructive">{failedAccounts.length} mislukt/herkoppelen</Badge>}
                    </div>
                  </div>
                </div>
              </section>
            )}

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
                  <div className="flex flex-wrap gap-2">
                    {needsMicrosoftConsent(orgCredential) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => connect.mutate({ scope: 'organization', adminConsent: true })}
                        disabled={connectingKey === 'organization:admin-consent'}
                        className="gap-2"
                      >
                        {connectingKey === 'organization:admin-consent' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        Admin consent geven
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => connect.mutate({ scope: 'organization', forceConsent: true, loginHint: orgCredential?.email })}
                      disabled={connectingKey === 'organization'}
                      className="gap-2"
                    >
                      {connectingKey === 'organization' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      {orgCredential ? 'Hoofdaccount herkoppelen' : 'Hoofdaccount koppelen'}
                    </Button>
                  </div>
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
                        {needsMicrosoftConsent(orgCredential) && (
                          <Button variant="outline" size="sm" onClick={() => connect.mutate({ scope: 'organization', adminConsent: true })}>Admin consent</Button>
                        )}
                        <Button variant="outline" size="sm" onClick={() => action.mutate({ action: 'test_mail', account_id: orgCredential.account_id })}>Test mail</Button>
                        <Button variant="outline" size="sm" onClick={() => action.mutate({ action: 'test_calendar', account_id: orgCredential.account_id })}>Test agenda</Button>
                        {renderSignatureButton(orgCredential)}
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
                          {renderSignatureButton(account)}
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
                    <User className="h-4 w-4 text-muted-foreground" /> {isAdmin ? 'Persoonlijke mailboxen' : 'Mijn mailbox'}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isAdmin
                      ? 'Koppel een persoonlijke Outlook mailbox aan de juiste JA-medewerker.'
                      : 'Koppel je eigen Outlook inbox en agenda voor persoonlijk gebruik.'}
                  </p>
                </div>
                {!isAdmin && (
                  <Button size="sm" variant="outline" onClick={() => connect.mutate({ scope: 'personal' })} disabled={connectingKey === 'personal'} className="gap-2">
                    {connectingKey === 'personal' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                    {personalAccount ? 'Mijn mailbox herkoppelen' : 'Mijn mailbox koppelen'}
                  </Button>
                )}
              </div>

              {isAdmin ? (
                <div className="space-y-2">
                  {users.map((user) => {
                    const account = personalByUser.get(user.id);
                    const key = `personal:${user.id}`;
                    return (
                      <div key={user.id} className="rounded-md border p-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium">{user.full_name || user.email || 'Gebruiker'}</span>
                              {account && statusBadge(account)}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {account ? accountEmail(account) : user.email || 'Nog niet gekoppeld'}
                            </p>
                            {account?.status_reason && <p className="mt-1 text-xs text-destructive">{account.status_reason}</p>}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {account && renderSignatureButton(account)}
                            <Button size="sm" variant="outline" onClick={() => connect.mutate({ scope: 'personal', targetUserId: user.id })} disabled={connectingKey === key} className="gap-2">
                              {connectingKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                              {account ? 'Herkoppelen' : 'Koppelen'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : personalAccount ? (
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
                  <div className="mt-3">
                    {renderSignatureButton(personalAccount)}
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

    <Dialog open={Boolean(signatureAccount)} onOpenChange={(open) => !open && setSignatureAccount(null)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Handtekening instellen</DialogTitle>
        </DialogHeader>
        {signatureAccount && (
          <EmailSignatureEditor
            key={signatureAccount.account_id}
            enabled={signatureDraft.enabled}
            html={signatureDraft.html}
            json={signatureDraft.json}
            onEnabledChange={(enabled) => setSignatureDraft((current) => ({ ...current, enabled }))}
            onChange={(html, json) => setSignatureDraft((current) => ({ ...current, html, json }))}
            onUploadImage={uploadSignatureImage}
          />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setSignatureAccount(null)}>Annuleren</Button>
          <Button onClick={saveSignature} disabled={action.isPending} className="gap-2">
            {action.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Opslaan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
};

export default OutlookSettings;
