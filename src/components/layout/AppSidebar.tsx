import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  LayoutDashboard, Building2, Users, UserCheck, Home, Briefcase,
  Calendar, Clock, Car, MessageSquare, BookOpen, Settings,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/' },
  { label: 'Opdrachtgevers', icon: Building2, path: '/opdrachtgevers' },
  { label: 'Kandidaten', icon: Users, path: '/kandidaten' },
  { label: 'Medewerkers', icon: UserCheck, path: '/medewerkers' },
  { label: 'Huisvesting', icon: Home, path: '/huisvesting' },
  { label: 'Vacatures', icon: Briefcase, path: '/vacatures' },
  { label: 'Planning', icon: Calendar, path: '/planning' },
  { label: 'Uren', icon: Clock, path: '/uren' },
  { label: 'Transport', icon: Car, path: '/transport' },
  { label: 'Communicatie', icon: MessageSquare, path: '/communicatie' },
  { label: 'Kennisbank', icon: BookOpen, path: '/kennisbank' },
];

const AppSidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const { profile } = useAuth();
  const location = useLocation();

  const firstName = profile?.full_name?.split(' ')[0] ?? '';
  const roleLabel = profile?.role ?? '';

  return (
    <aside
      className={cn(
        'flex flex-col h-screen bg-sidebar text-sidebar-foreground transition-all duration-200 shrink-0',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 h-14 border-b border-sidebar-border">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
          <span className="text-primary-foreground font-bold text-xs">JA</span>
        </div>
        {!collapsed && <span className="text-sidebar-active font-semibold text-sm">JA Werkt</span>}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-sidebar-hover text-sidebar-active'
                  : 'text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-active'
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-sidebar-border px-2 py-3 space-y-0.5">
        <NavLink
          to="/instellingen"
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
            location.pathname === '/instellingen'
              ? 'bg-sidebar-hover text-sidebar-active'
              : 'text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-active'
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Instellingen</span>}
        </NavLink>

        {/* User profile */}
        {!collapsed && profile && (
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="h-7 w-7 rounded-full bg-sidebar-hover flex items-center justify-center text-xs font-medium text-sidebar-active shrink-0">
              {firstName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-sidebar-active truncate">{profile.full_name}</p>
              <p className="text-[10px] text-sidebar-foreground capitalize">{roleLabel}</p>
            </div>
          </div>
        )}

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-active w-full transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          {!collapsed && <span>Inklappen</span>}
        </button>
      </div>
    </aside>
  );
};

export default AppSidebar;
