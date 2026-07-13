import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useRolePermissionMatrix } from '@/hooks/usePermissions';
import {
  effectivePermissionDecision,
  normalizeUserPermissionOverrides,
  permissionGroups,
  ROLE_LABELS,
  type PermissionKey,
  type UserPermissionOverrides,
  type UserRole,
} from '@/lib/permissions';

export type PermissionManagedUser = {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'intercedent' | 'backoffice' | 'finance';
  permission_overrides: UserPermissionOverrides;
  permission_override_count: number;
};

type OverrideChoice = 'inherit' | 'allow' | 'deny';

type Props = {
  user: PermissionManagedUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (user: PermissionManagedUser, overrides: UserPermissionOverrides) => Promise<void>;
};

const UserPermissionOverridesDialog = ({ user, open, onOpenChange, onSave }: Props) => {
  const [draft, setDraft] = useState<UserPermissionOverrides>({});
  const [isSaving, setIsSaving] = useState(false);
  const rolePermissionsQuery = useRolePermissionMatrix();
  const groups = useMemo(() => permissionGroups(), []);

  useEffect(() => {
    if (open && user) setDraft(normalizeUserPermissionOverrides(user.permission_overrides));
  }, [open, user]);

  if (!user) return null;

  const rolePermissions = rolePermissionsQuery.data?.matrix;
  const roleLabel = ROLE_LABELS[user.role as UserRole];

  const choiceFor = (permission: PermissionKey): OverrideChoice => {
    if (!Object.prototype.hasOwnProperty.call(draft, permission)) return 'inherit';
    return draft[permission] === true ? 'allow' : 'deny';
  };

  const setChoice = (permission: PermissionKey, choice: OverrideChoice) => {
    setDraft((current) => {
      const next = { ...current };
      if (choice === 'inherit') delete next[permission];
      else next[permission] = choice === 'allow';
      return next;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave(user, draft);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" /> Rechten aanpassen
          </DialogTitle>
          <DialogDescription>
            {user.full_name} heeft standaard de rechten van {roleLabel}. Kies alleen uitzonderingen die specifiek
            voor deze gebruiker moeten gelden.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-5 overflow-y-auto px-6 pb-2">
          {rolePermissionsQuery.isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">Rolrechten laden...</div>
          ) : (
            Object.entries(groups).map(([group, permissions]) => (
              <section key={group} className="space-y-2">
                <h3 className="text-sm font-semibold">{group}</h3>
                <div className="divide-y rounded-md border">
                  {permissions.map((permission) => {
                    const decision = effectivePermissionDecision(
                      user.role,
                      permission.key,
                      rolePermissions,
                      draft,
                    );
                    const inherited = decision.source === 'role';

                    return (
                      <div
                        key={permission.key}
                        className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_210px] sm:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium">{permission.label}</span>
                            <Badge
                              variant={decision.allowed ? 'secondary' : 'outline'}
                              className={decision.source === 'user_deny' ? 'border-destructive text-destructive' : ''}
                            >
                              {inherited
                                ? `${roleLabel}: ${decision.allowed ? 'toegestaan' : 'geblokkeerd'}`
                                : decision.allowed
                                  ? 'Individueel toegestaan'
                                  : 'Individueel geblokkeerd'}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{permission.description}</p>
                        </div>
                        <Select
                          value={choiceFor(permission.key)}
                          onValueChange={(value) => setChoice(permission.key, value as OverrideChoice)}
                          disabled={isSaving}
                        >
                          <SelectTrigger aria-label={`${permission.label} voor ${user.full_name}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inherit">Overnemen van rol</SelectItem>
                            <SelectItem value="allow">Individueel toestaan</SelectItem>
                            <SelectItem value="deny">Individueel blokkeren</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        <DialogFooter className="border-t px-6 py-4 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setDraft({})}
            disabled={isSaving || Object.keys(draft).length === 0}
          >
            <RotateCcw className="mr-2 h-4 w-4" /> Herstel rolstandaard
          </Button>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Annuleren
            </Button>
            <Button type="button" onClick={handleSave} disabled={isSaving || rolePermissionsQuery.isLoading}>
              {isSaving ? 'Opslaan...' : 'Rechten opslaan'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default UserPermissionOverridesDialog;
