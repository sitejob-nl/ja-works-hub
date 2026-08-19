import { useNavigate, useLocation } from 'react-router-dom';
import { X, User, Building2, UserCheck, Briefcase, MapPin, Home, Car } from 'lucide-react';
import { useRecentItems, type RecentItemType } from '@/contexts/RecentItemsContext';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const typeConfig: Record<RecentItemType, { icon: typeof User; color: string; activeRing: string; label: string }> = {
  kandidaat:      { icon: User,      color: 'bg-blue-50 text-blue-700 hover:bg-blue-100',     activeRing: 'ring-2 ring-blue-400',   label: 'Kandidaat' },
  opdrachtgever:  { icon: Building2, color: 'bg-green-50 text-green-700 hover:bg-green-100',   activeRing: 'ring-2 ring-green-400',  label: 'Opdrachtgever' },
  medewerker:     { icon: UserCheck, color: 'bg-purple-50 text-purple-700 hover:bg-purple-100', activeRing: 'ring-2 ring-purple-400', label: 'Medewerker' },
  vacature:       { icon: Briefcase, color: 'bg-orange-50 text-orange-700 hover:bg-orange-100', activeRing: 'ring-2 ring-orange-400', label: 'Vacature' },
  plaatsing:      { icon: MapPin,    color: 'bg-teal-50 text-teal-700 hover:bg-teal-100',       activeRing: 'ring-2 ring-teal-400',   label: 'Plaatsing' },
  pand:           { icon: Home,      color: 'bg-amber-50 text-amber-700 hover:bg-amber-100',    activeRing: 'ring-2 ring-amber-400',  label: 'Pand' },
  voertuig:       { icon: Car,       color: 'bg-sky-50 text-sky-700 hover:bg-sky-100',          activeRing: 'ring-2 ring-sky-400',    label: 'Voertuig' },
};

const RecentItemsBar = () => {
  const { items, removeItem, clearItems } = useRecentItems();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  if (items.length === 0) return null;

  return (
    <div className="h-9 border-b border-border bg-card/50 flex items-center gap-1 px-2 shrink-0 overflow-x-auto scrollbar-hide">
      <div className="flex items-center gap-1 min-w-0">
        {items.map(item => {
          const config = typeConfig[item.type];
          const Icon = config.icon;
          const isActive = pathname === item.path;

          return (
            <Tooltip key={`${item.type}-${item.id}`}>
              <TooltipTrigger asChild>
                <div
                  role="button"
                  tabIndex={0}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => navigate(item.path)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(item.path);
                    }
                  }}
                  className={`group inline-flex items-center gap-1 h-6 px-2 rounded-md text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${config.color} ${isActive ? config.activeRing : ''}`}
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  <span className="max-w-32 truncate">{item.label}</span>
                  <button
                    type="button"
                    tabIndex={0}
                    aria-label={`Verwijder ${item.label}`}
                    className="hidden group-hover:inline-flex group-focus-within:inline-flex items-center justify-center h-3.5 w-3.5 rounded-full hover:bg-black/10 shrink-0 p-0 border-0 bg-transparent cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeItem(item.id, item.type);
                    }}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                <p className="font-medium">{item.label}</p>
                {item.sublabel && <p className="text-muted-foreground">{item.sublabel}</p>}
                <p className="text-muted-foreground">{config.label}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <button
        onClick={clearItems}
        className="ml-auto text-[10px] text-muted-foreground hover:text-foreground whitespace-nowrap px-1.5 shrink-0"
      >
        Wis alles
      </button>
    </div>
  );
};

export default RecentItemsBar;
