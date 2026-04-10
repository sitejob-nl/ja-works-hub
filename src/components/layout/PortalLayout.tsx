import { NavLink, Outlet } from 'react-router-dom';
import { usePortal } from '@/contexts/PortalContext';
import { Home, Clock, FileText, Building, MoreHorizontal, LogOut, Globe, MapPin, Briefcase } from 'lucide-react';
import PortalNotifications from '@/components/portal/PortalNotifications';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

const mainTabs = [
  { label: 'Dashboard', icon: Home, path: '/portaal' },
  { label: 'Uren', icon: Clock, path: '/portaal/uren' },
  { label: 'Plaatsingen', icon: MapPin, path: '/portaal/plaatsingen' },
  { label: 'Documenten', icon: FileText, path: '/portaal/documenten' },
  { label: 'Vacatures', icon: Briefcase, path: '/portaal/vacatures' },
  { label: 'Huisvesting', icon: Building, path: '/portaal/huisvesting' },
];

const moreTabs = [
  { label: 'Voertuig', path: '/portaal/voertuig' },
  { label: 'Ziekmelding', path: '/portaal/ziekmelding' },
  { label: 'Loonstroken', path: '/portaal/loonstroken' },
  { label: 'Jaaropgaven', path: '/portaal/jaaropgaven' },
  { label: 'Urenbrieven', path: '/portaal/urenbrieven' },
  { label: 'Profiel', path: '/portaal/profiel' },
];

const PortalLayout = () => {
  const { profile, candidate, signOut, employee } = usePortal();
  const firstName = candidate?.first_name ?? profile?.full_name?.split(' ')[0] ?? '';
  const initials = firstName.charAt(0).toUpperCase();

  const toggleLanguage = async () => {
    if (!employee) return;
    const newLang = employee.portal_language === 'en' ? 'nl' : 'en';
    await supabase.from('candidates').update({ portal_language: newLang }).eq('id', employee.id);
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="bg-card border-b px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-xs">JA</span>
          </div>
          <span className="font-semibold text-sm hidden sm:inline">{profile?.full_name ?? 'Portaal'}</span>
        </div>

        <div className="flex items-center gap-2">
          <PortalNotifications />

          <Button variant="ghost" size="icon" onClick={toggleLanguage} className="h-8 w-8" title="Taal wisselen">
            <Globe className="h-4 w-4" />
          </Button>

          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
              {initials}
            </div>
            <span className="text-sm font-medium hidden sm:inline">{firstName}</span>
          </div>

          <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8 text-muted-foreground" title="Uitloggen">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Desktop horizontal tabs */}
      <nav className="hidden md:flex bg-card border-b px-4 gap-1">
        {mainTabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.path === '/portaal'}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )
            }
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </NavLink>
        ))}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-foreground transition-colors">
              <MoreHorizontal className="h-4 w-4" />
              Meer
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {moreTabs.map((tab) => (
              <DropdownMenuItem key={tab.path} asChild>
                <NavLink to={tab.path}>{tab.label}</NavLink>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      {/* Content */}
      <main className="flex-1 p-4 pb-20 md:pb-4 max-w-3xl w-full mx-auto">
        <Outlet />
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-card border-t flex justify-around py-1 z-50">
        {mainTabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.path === '/portaal'}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-0.5 py-1.5 px-3 text-[10px] font-medium transition-colors min-w-0',
                isActive ? 'text-primary' : 'text-muted-foreground'
              )
            }
          >
            <tab.icon className="h-5 w-5" />
            <span className="truncate">{tab.label}</span>
          </NavLink>
        ))}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex flex-col items-center gap-0.5 py-1.5 px-3 text-[10px] font-medium text-muted-foreground min-w-0">
              <MoreHorizontal className="h-5 w-5" />
              <span>Meer</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            {moreTabs.map((tab) => (
              <DropdownMenuItem key={tab.path} asChild>
                <NavLink to={tab.path}>{tab.label}</NavLink>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </div>
  );
};

export default PortalLayout;
