import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Building2, Users, UserCheck, Home, Briefcase,
  Calendar, Clock, Car, MessageSquare, BookOpen, Settings,
  ChevronLeft, ChevronRight, ChevronDown, Search, UserSearch, Calculator, ClipboardList, Fuel,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const navGroups = [
  {
    label: null,
    items: [
      { label: 'Dashboard', icon: LayoutDashboard, path: '/', moduleKey: null },
      { label: 'Workbench', icon: ClipboardList, path: '/workbench', moduleKey: 'workbench' },
    ],
  },
  {
    label: 'Relaties',
    items: [
      { label: 'Opdrachtgevers', icon: Building2, path: '/opdrachtgevers', moduleKey: 'opdrachtgevers' },
      { label: 'Kandidaten', icon: Users, path: '/kandidaten', moduleKey: 'kandidaten' },
      { label: 'Medewerkers', icon: UserCheck, path: '/medewerkers', moduleKey: 'medewerkers' },
    ],
  },
  {
    label: 'Werk',
    items: [
      { label: 'Vacatures', icon: Briefcase, path: '/vacatures', moduleKey: 'vacatures' },
      { label: 'Planning', icon: Calendar, path: '/planning', moduleKey: 'planning' },
      { label: 'Uren', icon: Clock, path: '/uren', moduleKey: 'uren' },
    ],
  },
  {
    label: 'Vastgoed & Fleet',
    items: [
      { label: 'Huisvesting', icon: Home, path: '/huisvesting', moduleKey: 'huisvesting' },
      { label: 'Transport', icon: Car, path: '/transport', moduleKey: 'transport' },
      { label: 'Tankpas analyse', icon: Fuel, path: '/tankpas-analyse', moduleKey: 'transport' },
    ],
  },
  {
    label: 'Communicatie',
    items: [
      { label: 'Communicatie', icon: MessageSquare, path: '/communicatie', moduleKey: 'communicatie' },
      { label: 'WhatsApp', icon: MessageSquare, path: '/whatsapp', moduleKey: 'whatsapp' },
      { label: 'Bulk Campagnes', icon: Users, path: '/bulk-campaigns', moduleKey: 'whatsapp' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { label: 'Kennisbank', icon: BookOpen, path: '/kennisbank', moduleKey: 'kennisbank' },
      { label: 'Vacaturebank', icon: Search, path: '/vacaturebank', moduleKey: 'vacaturebank' },
      { label: 'Kandidaten zoeken', icon: UserSearch, path: '/kandidaten-zoeken', moduleKey: 'kandidaten-zoeken' },
      { label: 'Exact Online', icon: Calculator, path: '/exact-online', moduleKey: 'exact-online' },
    ],
  },
];

const AppSidebar = () => {
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

  const isModuleEnabled = (moduleKey: string | null): boolean => {
    if (!moduleKey) return true;
    const override = moduleOverrides?.find(m => m.module_name === moduleKey);
    if (override) return override.enabled;
    if (plan?.modules) return plan.modules.includes(moduleKey);
    return true;
  };

  const filteredGroups = navGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => isModuleEnabled(item.moduleKey)),
    }))
    .filter(group => group.items.length > 0);

  // Apply accent color from settings
  useEffect(() => {
    if (!org) return;
    const s = (org.settings as Record<string, string> | null) ?? {};
    if (s.accent_color) {
      document.documentElement.style.setProperty('--primary', s.accent_color);
      document.documentElement.style.setProperty('--ring', s.accent_color);
      document.documentElement.style.setProperty('--accent-blue', s.accent_color);
      document.documentElement.style.setProperty('--stat-blue', s.accent_color);
    }
  }, [org]);

  const orgInitials = (org?.name ?? 'JA').slice(0, 2).toUpperCase();

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
          return (
            <div key={gi} className={cn(group.label && 'mt-4')}>
              {group.label && !collapsed && (
                <p className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
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
              </div>
            </div>
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
