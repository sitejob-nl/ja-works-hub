import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { applyBranding, type BrandingSettings } from '@/lib/branding';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Building2, Users, UserCheck, UserRound, Home, Briefcase,
  Calendar, Clock, Car, MessageSquare, BookOpen, Settings, Mail,
  ChevronLeft, ChevronRight, Search, UserSearch, Calculator, ClipboardList, Fuel, FileText, BarChart3, CheckSquare, BarChart2, FolderHeart, GitCompareArrows, Database, TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PermissionKey } from '@/lib/permissions';
import { useEffectivePermissions } from '@/hooks/usePermissions';
import { useEffect } from 'react';

interface AppSidebarProps {
  onNavigate?: () => void;
}

// roles: null = visible for all roles (admin always sees everything)
type NavItem = {
  label: string;
  icon: any;
  path: string;
  moduleKey: string | null;
  roles: string[] | null;
  permission?: PermissionKey;
};
type NavGroup = { label: string | null; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: null,
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, path: '/', moduleKey: null, roles: null },
      { label: 'Workbench', icon: ClipboardList, path: '/workbench', moduleKey: 'workbench', roles: ['intercedent', 'backoffice'] },
      { label: 'Taken', icon: CheckSquare, path: '/taken', moduleKey: 'taken', roles: null },
      { label: 'Dashboards', icon: BarChart2, path: '/dashboards', moduleKey: 'dashboards', roles: null },
    ],
  },
  {
    label: 'Relaties',
    items: [
      { label: 'Opdrachtgevers', icon: Building2, path: '/opdrachtgevers', moduleKey: 'opdrachtgevers', roles: ['intercedent', 'backoffice'] },
      { label: 'Kandidaten', icon: Users, path: '/kandidaten', moduleKey: 'kandidaten', roles: null, permission: 'candidates.view' },
      { label: 'Contacten', icon: UserRound, path: '/contacten', moduleKey: 'contacten', roles: ['intercedent', 'backoffice'] },
      { label: 'Talentpools', icon: FolderHeart, path: '/talentpools', moduleKey: 'talentpools', roles: ['intercedent'] },
    ],
  },
  {
    label: 'Werk',
    items: [
      { label: 'Vacatures', icon: Briefcase, path: '/vacatures', moduleKey: 'vacatures', roles: null, permission: 'vacancies.view' },
      { label: 'Match Pipeline', icon: GitCompareArrows, path: '/match-pipeline', moduleKey: 'vacatures', roles: null, permission: 'matching.pipeline.view' },
      { label: 'Plaatsingen', icon: UserCheck, path: '/plaatsingen', moduleKey: 'plaatsingen', roles: null, permission: 'placements.view' },
      { label: 'Planning', icon: Calendar, path: '/planning', moduleKey: 'planning', roles: ['intercedent', 'backoffice'] },
      { label: 'Uren', icon: Clock, path: '/uren', moduleKey: 'uren', roles: null, permission: 'finance.view' },
      { label: 'Facturatie', icon: FileText, path: '/facturatie', moduleKey: 'facturatie', roles: null, permission: 'finance.view' },
      { label: 'Uitstroom', icon: BarChart3, path: '/uitstroom-analyse', moduleKey: 'uitstroom-analyse', roles: ['intercedent', 'backoffice'] },
    ],
  },
  {
    label: 'Vastgoed & Fleet',
    items: [
      { label: 'Huisvesting', icon: Home, path: '/huisvesting', moduleKey: 'huisvesting', roles: ['intercedent', 'backoffice', 'facility'] },
      { label: 'Transport', icon: Car, path: '/transport', moduleKey: 'transport', roles: ['intercedent', 'backoffice', 'facility'] },
      { label: 'Tankpas analyse', icon: Fuel, path: '/tankpas-analyse', moduleKey: 'tankpas-analyse', roles: null, permission: 'finance.view' },
      { label: 'Kilometeranalyse', icon: Calculator, path: '/kilometeranalyse', moduleKey: 'tankpas-analyse', roles: null, permission: 'finance.view' },
    ],
  },
  {
    label: 'Communicatie',
    items: [
      { label: 'Communicatie', icon: MessageSquare, path: '/communicatie', moduleKey: 'communicatie', roles: ['intercedent', 'backoffice'] },
      { label: 'E-mail', icon: Mail, path: '/email', moduleKey: 'email', roles: ['intercedent', 'backoffice'] },
      { label: 'Email Templates', icon: FileText, path: '/email/templates', moduleKey: 'email', roles: ['intercedent', 'backoffice'] },
      { label: 'Agenda', icon: Calendar, path: '/agenda', moduleKey: 'agenda', roles: ['intercedent', 'backoffice'] },
      { label: 'WhatsApp', icon: MessageSquare, path: '/whatsapp', moduleKey: 'whatsapp', roles: ['intercedent', 'backoffice'] },
      { label: 'Bulk Campagnes', icon: Users, path: '/bulk-campaigns', moduleKey: 'bulk-campaigns', roles: ['intercedent'] },
    ],
  },
  {
    label: 'Tools',
    items: [
      { label: 'Kennisbank', icon: BookOpen, path: '/kennisbank', moduleKey: 'kennisbank', roles: null },
      { label: 'Vacaturebank', icon: Search, path: '/vacaturebank', moduleKey: 'vacaturebank', roles: ['intercedent'] },
      { label: 'Kandidaten zoeken', icon: UserSearch, path: '/kandidaten-zoeken', moduleKey: 'kandidaten-zoeken', roles: ['intercedent'] },
      { label: 'Exact Online', icon: Calculator, path: '/exact-online', moduleKey: 'exact-online', roles: null, permission: 'finance.view' },
      { label: 'Omzet (directie)', icon: TrendingUp, path: '/omzet', moduleKey: 'exact-online', roles: null, permission: 'finance.view' },
      { label: 'Carerix import', icon: Database, path: '/carerix-import', moduleKey: 'carerix-import', roles: ['admin'] },
    ],
  },
];

const AppSidebar = ({ onNavigate }: AppSidebarProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const { profile } = useAuth();
  const { hasPermission } = useEffectivePermissions();
  const location = useLocation();

  const firstName = profile?.full_name?.split(' ')[0] ?? '';
  const roleLabel = profile?.role ?? '';

  const { data: org } = useQuery({
    queryKey: ['organization', profile?.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organizations')
        .select('name, logo_url, settings, plan_id')
        .eq('id', profile!.organization_id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!profile?.organization_id,
  });

  const { data: moduleOverrides } = useQuery({
    queryKey: ['org-modules', profile?.organization_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_modules')
        .select('module_name, enabled')
        .eq('organization_id', profile!.organization_id);
      if (error) throw error;
      return data;
    },
    enabled: !!profile?.organization_id,
  });

  const { data: plan } = useQuery({
    queryKey: ['subscription-plan', org?.plan_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('modules')
        .eq('id', org!.plan_id!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!org?.plan_id,
  });

  const { data: openTaskCount } = useQuery({
    queryKey: ['open-task-count', profile?.id],
    queryFn: async () => {
      const { count } = await supabase
        .from('recruiter_tasks' as any)
        .select('id', { count: 'exact', head: true })
        .eq('assigned_to', profile!.id)
        .not('status', 'in', '(done,dismissed)');
      return count ?? 0;
    },
    enabled: !!profile?.id,
    staleTime: 60_000,
  });

  const userRole = profile?.role as string | undefined;

  const isModuleEnabled = (moduleKey: string | null): boolean => {
    if (!moduleKey) return true;
    const override = moduleOverrides?.find(m => m.module_name === moduleKey);
    if (override) return override.enabled;
    if (plan?.modules) return plan.modules.includes(moduleKey);
    return true;
  };

  const isRoleAllowed = (roles: string[] | null): boolean => {
    if (!roles) return true; // null = visible for all
    if (userRole === 'admin') return true; // admin sees everything
    return !!userRole && roles.includes(userRole);
  };

  const isPermissionAllowed = (permission?: PermissionKey): boolean => {
    if (!permission) return true;
    return hasPermission(permission);
  };

  const filteredGroups = navGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item =>
        isModuleEnabled(item.moduleKey) && isRoleAllowed(item.roles) && isPermissionAllowed(item.permission)
      ),
    }))
    .filter(group => group.items.length > 0);

  // Apply accent color from settings
  useEffect(() => {
    if (!org) return;
    const s = (org.settings as Record<string, string> | null) ?? {};
    applyBranding(s as BrandingSettings);
  }, [org]);

  const handleNavClick = () => {
    onNavigate?.();
  };

  return (
    <aside
      className={cn(
        'flex flex-col h-screen bg-sidebar text-sidebar-foreground transition-all duration-200 shrink-0',
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      {/* Logo */}
      <div className={cn(
        'flex items-center border-b border-sidebar-border',
        collapsed ? 'h-16 justify-center px-2' : 'h-20 px-5'
      )}>
        {org?.logo_url ? (
          <img
            src={org.logo_url}
            alt={org?.name ? `${org.name} logo` : 'Logo'}
            className={cn(
              'object-contain',
              collapsed ? 'max-h-10 max-w-10' : 'max-h-14 w-full object-left'
            )}
          />
        ) : (
          <span className={cn(
            'font-semibold text-sidebar-active truncate',
            collapsed ? 'text-sm' : 'text-xl'
          )}>
            {collapsed ? (org?.name ?? 'JA').slice(0, 2).toUpperCase() : (org?.name ?? 'SiteJob')}
          </span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto">
        {filteredGroups.map((group, gi) => {
          if (!group.label || collapsed) {
            return (
              <div key={gi} className={cn(group.label && 'mt-4')}>
                {group.label && collapsed && (
                  <div className="mx-auto my-2 w-6 border-t border-sidebar-border" />
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = location.pathname === item.path;
                    return (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        onClick={handleNavClick}
                        className={cn(
                          'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                          isActive
                            ? 'bg-sidebar-hover text-sidebar-active'
                            : 'text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-active'
                        )}
                      >
                        <item.icon className="h-4 w-4 shrink-0" />
                        {!collapsed && <span className="flex-1">{item.label}</span>}
                        {!collapsed && item.path === '/taken' && (openTaskCount ?? 0) > 0 && (
                          <span className="ml-auto text-[10px] font-semibold bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                            {openTaskCount! > 99 ? '99+' : openTaskCount}
                          </span>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            );
          }

          // Groepen staan altijd open en zijn niet inklapbaar (klant-wens review 27-05).
          return (
            <div key={gi} className="mt-3">
              <div className="px-3 py-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                  {group.label}
                </span>
              </div>
              <div className="space-y-0.5 mt-0.5">
                {group.items.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={handleNavClick}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                        isActive
                          ? 'bg-sidebar-hover text-sidebar-active'
                          : 'text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-active'
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="flex-1">{item.label}</span>
                      {item.path === '/taken' && (openTaskCount ?? 0) > 0 && (
                        <span className="ml-auto text-[10px] font-semibold bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
                          {openTaskCount! > 99 ? '99+' : openTaskCount}
                        </span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-sidebar-border px-2 py-3 space-y-0.5">
        <NavLink
          to="/mijn-outlook"
          onClick={handleNavClick}
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
            location.pathname === '/mijn-outlook'
              ? 'bg-sidebar-hover text-sidebar-active'
              : 'text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-active'
          )}
        >
          <Mail className="h-4 w-4 shrink-0" />
          {!collapsed && <span>Mijn Outlook</span>}
        </NavLink>

        {isPermissionAllowed('settings.manage') && (
          <NavLink
            to="/instellingen"
            onClick={handleNavClick}
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
        )}

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

        {/* Collapse toggle - hidden on mobile */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden md:flex items-center gap-3 px-3 py-2 rounded-md text-sm text-sidebar-foreground hover:bg-sidebar-hover hover:text-sidebar-active w-full transition-colors"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          {!collapsed && <span>Inklappen</span>}
        </button>
      </div>
    </aside>
  );
};

export default AppSidebar;
