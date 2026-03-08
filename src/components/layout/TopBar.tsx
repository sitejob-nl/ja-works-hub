import { Bell, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const TopBar = () => {
  const { profile, signOut } = useAuth();
  const firstName = profile?.full_name?.split(' ')[0] ?? '';

  return (
    <header className="h-14 border-b border-border bg-card flex items-center justify-between px-6 shrink-0">
      {/* Search */}
      <div className="relative max-w-md w-full">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Zoeken..."
          className="w-full h-9 pl-9 pr-4 rounded-md bg-secondary border-0 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {/* Right */}
      <div className="flex items-center gap-4">
        <button className="relative p-2 rounded-md hover:bg-secondary transition-colors">
          <Bell className="h-4 w-4 text-muted-foreground" />
        </button>

        <div className="flex items-center gap-2 cursor-pointer" onClick={signOut}>
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-medium text-primary">
            {firstName.charAt(0).toUpperCase()}
          </div>
          <div className="hidden sm:block">
            <p className="text-sm font-medium leading-tight">{profile?.full_name}</p>
            <p className="text-[11px] text-muted-foreground capitalize">{profile?.role}</p>
          </div>
        </div>
      </div>
    </header>
  );
};

export default TopBar;
