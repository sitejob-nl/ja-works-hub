import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Clipboard, Mail, RefreshCw, ShieldAlert, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { toast } from 'sonner';
import OutlookAccountPicker from '@/components/email/OutlookAccountPicker';
import UserPermissionOverridesDialog, {
  type PermissionManagedUser,
} from '@/components/settings/UserPermissionOverridesDialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useAuth } from '@/contexts/AuthContext';
import { useOutlookAccounts } from '@/hooks/useOutlookAccounts';
import { supabase } from '@/integrations/supabase/client';
import { ROLE_LABELS, type UserPermissionOverrides, type UserRole } from '@/lib/permissions';

type InternalRole = 'admin' | 'intercedent' | 'backoffice' | 'finance' | 'facility';

type InternalUser = PermissionManagedUser & {
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type InternalInviteStatus = 'created' | 'sent' | 'accepted' | 'revoked' | 'expired';

type InternalInvite = {
  id: string;
  email: string;
  full_name: string;
  role: InternalRole;
  status: InternalInviteStatus;
  sent_at: string | null;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  last_error: string | null;
  created_at: string;
};

type InviteResponse = {
  users: InternalUser[];
  invites: InternalInvite[];
};

const INTERNAL_ROLES: InternalRole[] = ['admin', 'intercedent', 'backoffice', 'finance', 'facility'];

const STATUS_LABELS: Record<InternalInviteStatus, string> = {
  created: 'Link aangemaakt',
  sent: 'Verstuurd',
  accepted: 'Geaccepteerd',
  revoked: 'Ingetrokken',
  expired: 'Verlopen',
};

const STATUS_VARIANTS: Record<InternalInviteStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  created: 'outline',
  sent: 'default',
  accepted: 'secondary',
  revoked: 'destructive',
  expired: 'outline',
};

async function functionError(error: any) {
  const fallback = error?.message || 'Actie mislukt';
  const response = error?.context;
  if (!response || typeof response.clone !== 'function') return fallback;
  try {
    const data = await response.clone().json();
    return typeof data?.error === 'string' ? data.error : fallback;
  } catch {
    return fallback;
  }
}

async function invokeInternalUsers<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('internal-user-invites', { body });
  if (error) throw new Error(await functionError(error));
  if ((data as any)?.error) throw new Error((data as any).error);
  return data as T;
}

function formatDate(value: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('nl-NL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function roleLabel(role: InternalRole | UserRole) {
  return ROLE_LABELS[role as UserRole] ?? role;
}

const UserManagementSettings = () => {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const { defaultAccountId, hasUsableAccounts, isLoading: outlookLoading } = useOutlookAccounts('mail_send');
  const [accountId, setAccountId] = useState<string>('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InternalRole>('intercedent');
  const [lastActivationUrl, setLastActivationUrl] = useState<string | null>(null);
  const [permissionUser, setPermissionUser] = useState<InternalUser | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<{ user: InternalUser; role: InternalRole } | null>(null);

  const canManage = profile?.role === 'admin';

  useEffect(() => {
    if (!accountId && defaultAccountId) setAccountId(defaultAccountId);
  }, [accountId, defaultAccountId]);

  const query = useQuery({
    queryKey: ['internal-user-invites'],
    queryFn: () => invokeInternalUsers<InviteResponse>({ action: 'list' }),
    enabled: canManage,
  });

  const users = query.data?.users ?? [];
  const invites = query.data?.invites ?? [];
  const openInvites = useMemo(
    () => invites.filter((invite) => !invite.used_at && !invite.revoked_at),
    [invites],
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['internal-user-invites'] });

  const createMutation = useMutation({
    mutationFn: () => invokeInternalUsers<any>({
      action: 'create',
      full_name: fullName,
      email,
      role,
      account_id: accountId || null,
    }),
    onSuccess: (data) => {
      setLastActivationUrl(data.activation_url ?? null);
      setFullName('');
      setEmail('');
      setRole('intercedent');
      refresh();
      if (data.sent) {
        toast.success('Uitnodiging verstuurd');
      } else {
        toast.warning(data.send_error || 'Uitnodiging aangemaakt, maar niet verstuurd');
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const resendMutation = useMutation({
    mutationFn: (id: string) => invokeInternalUsers<any>({ action: 'resend', id, account_id: accountId || null }),
    onSuccess: (data) => {
      setLastActivationUrl(data.activation_url ?? null);
      refresh();
      if (data.sent) toast.success('Uitnodiging opnieuw verstuurd');
      else toast.warning(data.send_error || 'Nieuwe link aangemaakt, maar niet verstuurd');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => invokeInternalUsers({ action: 'revoke', id }),
    onSuccess: () => {
      refresh();
      toast.success('Uitnodiging ingetrokken');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updateUserMutation = useMutation({
    mutationFn: (payload: { profile_id: string; role?: InternalRole; is_active?: boolean }) =>
      invokeInternalUsers({ action: 'update_user', ...payload }),
    onSuccess: () => {
      refresh();
      toast.success('Gebruiker bijgewerkt');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const updatePermissionsMutation = useMutation({
    mutationFn: (payload: { profile_id: string; permission_overrides: UserPermissionOverrides }) =>
      invokeInternalUsers({ action: 'update_permissions', ...payload }),
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['user-permission-overrides'] });
      toast.success('Individuele rechten bijgewerkt');
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const savePermissions = async (user: PermissionManagedUser, permissionOverrides: UserPermissionOverrides) => {
    await updatePermissionsMutation.mutateAsync({
      profile_id: user.id,
      permission_overrides: permissionOverrides,
    });
  };

  const requestRoleChange = (user: InternalUser, nextRole: InternalRole) => {
    if (nextRole === user.role) return;
    if (user.permission_override_count > 0) {
      setPendingRoleChange({ user, role: nextRole });
      return;
    }
    updateUserMutation.mutate({ profile_id: user.id, role: nextRole });
  };

  const copyActivationUrl = async (url?: string | null) => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success('Activatielink gekopieerd');
  };

  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Gebruikers
          </CardTitle>
          <CardDescription>Alleen admins kunnen gebruikers beheren.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <UserPlus className="h-4 w-4" /> Personeel uitnodigen
              </CardTitle>
              <CardDescription>Nieuwe interne gebruikers ontvangen hun activatielink via Outlook.</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => query.refetch()} disabled={query.isFetching}>
              <RefreshCw className="mr-2 h-3.5 w-3.5" /> Verversen
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!outlookLoading && !hasUsableAccounts && (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertDescription>
                Er is geen Outlook-mailbox met verzendrecht beschikbaar. De uitnodiging kan wel worden aangemaakt, maar niet automatisch worden gemaild.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="internal-user-name">Naam</Label>
              <Input
                id="internal-user-name"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Naam medewerker"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="internal-user-email">E-mail</Label>
              <Input
                id="internal-user-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="naam@bedrijf.nl"
              />
            </div>
            <div className="space-y-2">
              <Label>Rol</Label>
              <Select value={role} onValueChange={(value) => setRole(value as InternalRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERNAL_ROLES.map((item) => (
                    <SelectItem key={item} value={item}>{roleLabel(item)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Outlook-afzender</Label>
              <OutlookAccountPicker value={accountId} onChange={setAccountId} capability="mail_send" className="w-full" />
            </div>
          </div>

          {lastActivationUrl && (
            <div className="flex flex-col gap-2 rounded-md border bg-muted/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0 truncate text-muted-foreground">{lastActivationUrl}</span>
              <Button type="button" size="sm" variant="outline" onClick={() => copyActivationUrl(lastActivationUrl)}>
                <Clipboard className="mr-2 h-3.5 w-3.5" /> Kopieer link
              </Button>
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={!fullName.trim() || !email.trim() || createMutation.isPending}
            >
              <Mail className="mr-2 h-4 w-4" /> Uitnodigen via Outlook
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" /> Actieve gebruikers
          </CardTitle>
          <CardDescription>Beheer rollen en toegang voor interne medewerkers.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Gebruiker</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Individuele rechten</TableHead>
                  <TableHead>Laatst gewijzigd</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Gebruikers laden...</TableCell>
                  </TableRow>
                ) : users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Geen interne gebruikers gevonden.</TableCell>
                  </TableRow>
                ) : (
                  users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <div className="font-medium">{user.full_name}</div>
                        <div className="text-xs text-muted-foreground">{user.email}</div>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={user.role}
                          onValueChange={(value) => requestRoleChange(user, value as InternalRole)}
                          disabled={updateUserMutation.isPending}
                        >
                          <SelectTrigger className="w-[180px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {INTERNAL_ROLES.map((item) => (
                              <SelectItem key={item} value={item}>{roleLabel(item)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={user.is_active}
                            disabled={updateUserMutation.isPending || user.id === profile?.id}
                            onCheckedChange={(enabled) => updateUserMutation.mutate({ profile_id: user.id, is_active: enabled })}
                            aria-label={`Account ${user.is_active ? 'deactiveren' : 'activeren'} voor ${user.full_name}`}
                          />
                          <span className="text-sm">{user.is_active ? 'Actief' : 'Uitgeschakeld'}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {user.role === 'admin' || user.role === 'facility' ? (
                          <Badge variant="secondary">
                            {user.role === 'admin' ? 'Altijd volledig' : 'Vaste operationele rechten'}
                          </Badge>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setPermissionUser(user)}
                          >
                            <ShieldCheck className="mr-2 h-3.5 w-3.5" />
                            {user.permission_override_count > 0
                              ? `${user.permission_override_count} uitzondering${user.permission_override_count === 1 ? '' : 'en'}`
                              : 'Rolstandaard'}
                          </Button>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(user.updated_at)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uitnodigingen</CardTitle>
          <CardDescription>Open en recente uitnodigingen voor interne gebruikers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{openInvites.length}</Badge>
            open uitnodigingen
          </div>
          <Separator />
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Uitnodiging</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Verloopt</TableHead>
                  <TableHead className="text-right">Acties</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">Nog geen uitnodigingen.</TableCell>
                  </TableRow>
                ) : (
                  invites.map((invite) => {
                    const isOpen = !invite.used_at && !invite.revoked_at;
                    return (
                      <TableRow key={invite.id}>
                        <TableCell>
                          <div className="font-medium">{invite.full_name}</div>
                          <div className="text-xs text-muted-foreground">{invite.email}</div>
                          {invite.last_error && <div className="mt-1 text-xs text-destructive">{invite.last_error}</div>}
                        </TableCell>
                        <TableCell>{roleLabel(invite.role)}</TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANTS[invite.status]}>{STATUS_LABELS[invite.status]}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatDate(invite.expires_at)}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={!isOpen || resendMutation.isPending}
                              onClick={() => resendMutation.mutate(invite.id)}
                              aria-label={`Uitnodiging opnieuw versturen naar ${invite.full_name}`}
                              title="Opnieuw versturen"
                            >
                              <RefreshCw className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={!isOpen || revokeMutation.isPending}
                              onClick={() => revokeMutation.mutate(invite.id)}
                              aria-label={`Uitnodiging intrekken voor ${invite.full_name}`}
                              title="Intrekken"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <UserPermissionOverridesDialog
        user={permissionUser}
        open={!!permissionUser}
        onOpenChange={(open) => !open && setPermissionUser(null)}
        onSave={savePermissions}
      />

      <AlertDialog open={!!pendingRoleChange} onOpenChange={(open) => !open && setPendingRoleChange(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rol wijzigen en uitzonderingen verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingRoleChange?.user.full_name} heeft {pendingRoleChange?.user.permission_override_count ?? 0}
              {' '}individuele rechten. Bij de wijziging naar{' '}
              {pendingRoleChange ? roleLabel(pendingRoleChange.role) : 'de nieuwe rol'} worden deze veilig gereset.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRoleChange) {
                  updateUserMutation.mutate({
                    profile_id: pendingRoleChange.user.id,
                    role: pendingRoleChange.role,
                  });
                }
                setPendingRoleChange(null);
              }}
            >
              Rol wijzigen en resetten
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default UserManagementSettings;
