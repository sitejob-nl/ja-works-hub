import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Loader2, Building2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export interface KvkProfile {
  name: string;
  kvk_number: string;
  address_street?: string;
  address_postal?: string;
  address_city?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelect: (profile: KvkProfile) => void;
  placeholder?: string;
  className?: string;
}

const KvkNameSearchInput = ({ value, onChange, onSelect, placeholder, className }: Props) => {
  const [results, setResults] = useState<any[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState(false);
  const skipNextRef = useRef(false);
  const userTouchedRef = useRef(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userTouchedRef.current) return;
    if (skipNextRef.current) {
      skipNextRef.current = false;
      return;
    }
    const term = value.trim();
    if (term.length < 3) {
      setResults([]);
      setShowResults(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const { data, error } = await supabase.functions.invoke('kvk-lookup', { body: { name: term } });
        if (cancelled) return;
        if (error) {
          let detail = error.message || 'KVK-zoek mislukt';
          try {
            const ctx = (error as any).context;
            if (ctx && typeof ctx.json === 'function') {
              const body = await ctx.json();
              if (body?.error) detail = body.details ? `${body.error}: ${body.details}` : body.error;
            }
          } catch { /* ignore */ }
          console.error('[kvk-lookup] error:', error, 'detail:', detail);
          toast.error(`KVK-zoek mislukt: ${detail}`);
          return;
        }
        const list: any[] = data?.resultaten || data?._embedded?.resultaten || [];
        setResults(list.slice(0, 8));
        setShowResults(list.length > 0);
        if (list.length === 0) {
          toast.info(`Geen KVK-resultaten voor "${term}"`);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 600);
    return () => { cancelled = true; clearTimeout(t); };
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSelect = async (r: any) => {
    setShowResults(false);
    setResults([]);
    setApplying(true);
    const fallbackName = r.handelsnaam || r.naam || r.eersteHandelsnaam || value;
    skipNextRef.current = true;
    try {
      const { data, error } = await supabase.functions.invoke('kvk-lookup', { body: { kvk_number: r.kvkNummer } });
      if (error) throw error;
      onSelect({
        name: data?.name || fallbackName,
        kvk_number: data?.kvk_number || r.kvkNummer,
        address_street: data?.visit_address?.street || undefined,
        address_postal: data?.visit_address?.postal || undefined,
        address_city: data?.visit_address?.city || undefined,
      });
      toast.success('KVK-gegevens overgenomen');
    } catch (e: any) {
      onSelect({ name: fallbackName, kvk_number: r.kvkNummer });
      toast.error(e.message || 'Volledige KVK-gegevens konden niet worden opgehaald');
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className={cn('relative', className)} ref={wrapperRef}>
      <Input
        value={value}
        onChange={(e) => {
          userTouchedRef.current = true;
          onChange(e.target.value);
        }}
        onFocus={() => { if (results.length > 0) setShowResults(true); }}
        placeholder={placeholder}
      />
      {(searching || applying) && (
        <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
      )}
      {showResults && results.length > 0 && (
        <div className="absolute z-20 mt-1 w-full bg-popover border rounded-md shadow-md max-h-72 overflow-auto">
          {results.map((r, i) => {
            const naam = r.handelsnaam || r.naam || r.eersteHandelsnaam || '(onbekend)';
            const plaats = r.plaats || r.adres?.binnenlandsAdres?.plaats || '';
            return (
              <button
                type="button"
                key={`${r.kvkNummer}-${r.vestigingsnummer || i}`}
                onClick={() => handleSelect(r)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-start gap-2 border-b last:border-b-0"
              >
                <Building2 className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{naam}</div>
                  <div className="text-xs text-muted-foreground">
                    KVK {r.kvkNummer}{plaats ? ` · ${plaats}` : ''}{r.type ? ` · ${r.type}` : ''}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default KvkNameSearchInput;
