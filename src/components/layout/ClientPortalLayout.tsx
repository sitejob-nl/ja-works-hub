import { NavLink, Outlet } from 'react-router-dom';
import { useClientPortal } from '@/contexts/ClientPortalContext';
import { Home, Clock, MapPin, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LanguageToggle } from '@/components/translation/LanguageToggle';
import { TranslationProvider } from '@/contexts/TranslationContext';

const tabs = [
  { label: 'Dashboard', icon: Home, path: '/klantportaal' },
  { label: 'Uren', icon: Clock, path: '/klantportaal/uren' },
  { label: 'Plaatsingen', icon: MapPin, path: '/klantportaal/plaatsingen' },
];

const ClientPortalLayout = () => {
  const { profile, contact, company, signOut } = useClientPortal();
  const contactName = contact?.full_name ?? contact?.first_name ?? profile?.full_name ?? '';
  const companyName = company?.name ?? '';
  const initials = (companyName || contactName).slice(0, 2).toUpperCase();

  return (
    <TranslationProvider>
      <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <header className="bg-card border-b px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-xs">{initials}</span>
          </div>
          <div className="hidden sm:block">
            <p className="font-semibold text-sm leading-tight">{companyName}</p>
            <p className="text-xs text-muted-foreground">{contactName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="sm:hidden flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
              {contactName.charAt(0).toUpperCase()}
            </div>
          </div>
          <LanguageToggle compact />
          <Button variant="ghost" size="icon" onClick={signOut} className="h-8 w-8 text-muted-foreground" title="Uitloggen">
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Desktop horizontal tabs */}
      <nav className="hidden md:flex bg-card border-b px-4 gap-1">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.path === '/klantportaal'}
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
      </nav>

      {/* Content */}
      <main className="flex-1 p-4 pb-20 md:pb-4 max-w-4xl w-full mx-auto">
        <Outlet />
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-card border-t flex justify-around py-1 z-50">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            end={tab.path === '/klantportaal'}
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
      </nav>
      </div>
    </TranslationProvider>
  );
};

export default ClientPortalLayout;
