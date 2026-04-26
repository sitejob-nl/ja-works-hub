import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSuperAdmin } from '@/contexts/SuperAdminContext';
import { Shield, Building2, AlertTriangle, Users, LogOut, LayoutDashboard, Package, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/superadmin' },
  { label: 'Organisaties', icon: Building2, path: '/superadmin/organisaties' },
  { label: 'Gebruikers', icon: Users, path: '/superadmin/gebruikers' },
  { label: 'Abonnementen', icon: Package, path: '/superadmin/abonnementen' },
  { label: 'AI CV Backfill', icon: Brain, path: '/superadmin/cv-backfill' },
  { label: 'Foutmeldingen', icon: AlertTriangle, path: '/superadmin/errors' },
];

const SuperAdminLayout = () => {
  const { isSuperAdmin, loading, signOut, user } = useSuperAdmin();
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    navigate('/superadmin/login');
    return null;
  }

  return (
    <div className="flex h-screen bg-zinc-950">
      <aside className="flex flex-col w-60 bg-zinc-900 border-r border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 px-4 h-14 border-b border-zinc-800">
          <div className="h-8 w-8 rounded-lg bg-red-600 flex items-center justify-center">
            <Shield className="h-4 w-4 text-white" />
          </div>
          <span className="text-white font-semibold text-sm">Super Admin</span>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/superadmin'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                  isActive
                    ? 'bg-zinc-800 text-white'
                    : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-zinc-800 px-2 py-3 space-y-1">
          <div className="px-3 py-1">
            <p className="text-xs text-zinc-400 truncate">{user?.email}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-zinc-400 hover:text-white hover:bg-zinc-800"
            onClick={async () => {
              await signOut();
              navigate('/superadmin/login');
            }}
          >
            <LogOut className="h-4 w-4 mr-2" />
            Uitloggen
          </Button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
};

export default SuperAdminLayout;
