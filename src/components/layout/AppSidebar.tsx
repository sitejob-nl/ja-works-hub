import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth, useHasRole } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { applyBranding, type BrandingSettings } from '@/lib/branding';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Building2, Users, UserCheck, UserRound, Home, Briefcase,
  Calendar, Clock, Car, MessageSquare, BookOpen, Settings, Mail,
  ChevronLeft, ChevronRight, ChevronDown, Search, UserSearch, Calculator, ClipboardList, Fuel, FileText, BarChart3, CheckSquare, BarChart2, FolderHeart, GitCompareArrows,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

interface AppSidebarProps {
  onNavigate?: () => void;
}

// roles: null = visible for all roles (admin always sees everything)
type NavItem = { label: string; icon: any; path: string; moduleKey: string | null; roles: string[] | null };
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
      { label: 'Kandidaten', icon: Users, path: '/kandidaten', moduleKey: 'kandidaten', roles: ['intercedent', 'backoffice'] },
      { label: 'Contacten', icon: UserRound, path: '/contacten', moduleKey: 'contacten', roles: ['intercedent', 'backoffice'] },
      { label: 'Talentpools', icon: FolderHeart, path: '/talentpools', moduleKey: 'talentpools', roles: ['intercedent'] },
    ],
  },
  {
    label: 'Werk',
    items: [
      { label: 'Vacatures', icon: Briefcase, path: '/vacatures', moduleKey: 'vacatures', roles: ['intercedent'] },
      { label: 'Match Pipeline', icon: GitCompareArrows, path: '/match-pipeline', moduleKey: 'vacatures', roles: ['intercedent'] },
      { label: 'Plaatsingen', icon: UserCheck, path: '/plaatsingen', moduleKey: 'plaatsingen', roles: ['intercedent', 'backoffice'] },
      { label: 'Planning', icon: Calendar, path: '/planning', moduleKey: 'planning', roles: ['intercedent', 'backoffice'] },
      { label: 'Uren', icon: Clock, path: '/uren', moduleKey: 'uren', roles: ['intercedent', 'backoffice', 'finance'] },
      { label: 'Facturatie', icon: FileText, path: '/facturatie', moduleKey: 'facturatie', roles: ['finance', 'backoffice'] },
      { label: 'Uitstroom', icon: BarChart3, path: '/uitstroom-analyse', moduleKey: 'uitstroom-analyse', roles: ['intercedent', 'backoffice'] },
    ],
  },
  {
    label: 'Vastgoed & Fleet',
    items: [
      { label: 'Huisvesting', icon: Home, path: '/huisvesting', moduleKey: 'huisvesting', roles: ['intercedent', 'backoffice'] },
      { label: 'Transport', icon: Car, path: '/transport', moduleKey: 'transport', roles: ['intercedent', 'backoffice'] },
      { label: 'Tankpas analyse', icon: Fuel, path: '/tankpas-analyse', moduleKey: 'tankpas-analyse', roles: ['finance', 'backoffice'] },
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
      { label: 'Exact Online', icon: Calculator, path: '/exact-online', moduleKey: 'exact-online', roles: ['finance', 'backoffice'] },
    ],
  },
];

const AppSidebar = ({ onNavigate }: AppSidebarProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const { profile } = useAuth();
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

  const filteredGroups = navGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => isModuleEnabled(item.moduleKey) && isRoleAllowed(item.roles)),
    }))
    .filter(group => group.items.length > 0);

  // Apply accent color from settings
  useEffect(() => {
    if (!org) return;
    const s = (org.settings as Record<string, string> | null) ?? {};
    applyBranding(s as BrandingSettings);
  }, [org]);

  const orgInitials = (org?.name ?? 'JA').slice(0, 2).toUpperCase();

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
      <div className="flex items-center gap-2 px-4 h-14 border-b border-sidebar-border">
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shrink-0 overflow-hidden">
          {org?.logo_url ? (
            <img src={org.logo_url} alt="Logo" className="h-full w-full object-contain" />
          ) : (
            <span className="text-primary-foreground font-bold text-xs">{orgInitials}</span>
          )}
        </div>
        {!collapsed && <span className="text-sidebar-active font-semibold text-sm">{org?.name ?? 'SiteJob'}</span>}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto">
        {filteredGroups.map((group, gi) => {
          const hasActiveItem = group.items.some(item => location.pathname === item.path);

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

          return (
            <Collapsible key={gi} defaultOpen={hasActiveItem || gi <= 2} className="mt-3">
              <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-1 group cursor-pointer">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50 group-hover:text-sidebar-foreground/70 transition-colors">
                  {group.label}
                </span>
                <ChevronDown className="h-3 w-3 text-sidebar-foreground/40 transition-transform duration-200 group-data-[state=closed]:-rotate-90" />
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-0.5 mt-0.5">
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
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="border-t border-sidebar-border px-2 py-3 space-y-0.5">
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
