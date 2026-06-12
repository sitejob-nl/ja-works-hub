import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { AddressValue, lookupPdokAddress, PdokSuggestion, suggestPdokAddresses } from '@/lib/pdok';

type AddressAutocompleteProps = {
  value: AddressValue;
  onChange: (value: AddressValue) => void;
  className?: string;
  gridClassName?: string;
  streetClassName?: string;
  postalClassName?: string;
  cityClassName?: string;
  countryClassName?: string;
  streetLabel?: string;
  postalLabel?: string;
  cityLabel?: string;
  countryLabel?: string;
  showCountry?: boolean;
  required?: boolean;
  inputClassName?: string;
};

const normalizeValue = (value: AddressValue): AddressValue => ({
  street: value.street ?? '',
  postal: value.postal ?? '',
  city: value.city ?? '',
  country: value.country ?? '',
  lat: value.lat ?? null,
  lng: value.lng ?? null,
});

const AddressAutocomplete = ({
  value,
  onChange,
  className,
  gridClassName,
  streetClassName,
  postalClassName,
  cityClassName,
  countryClassName,
  streetLabel = 'Straat + huisnr',
  postalLabel = 'Postcode',
  cityLabel = 'Stad',
  countryLabel = 'Land',
  showCountry = false,
  required = false,
  inputClassName,
}: AddressAutocompleteProps) => {
  const address = normalizeValue(value);
  const [suggestions, setSuggestions] = useState<PdokSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const query = useMemo(
    () => [address.street, address.postal, address.city].filter(Boolean).join(' ').trim(),
    [address.street, address.postal, address.city]
  );

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, []);

  useEffect(() => {
    if (query.length < 3) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      const results = await suggestPdokAddresses(query);
      if (cancelled) return;
      setSuggestions(results);
      setOpen(results.length > 0);
      setLoading(false);
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const update = (patch: Partial<AddressValue>, clearCoordinates = true) => {
    onChange({
      ...address,
      ...patch,
      lat: clearCoordinates ? null : (patch.lat ?? address.lat ?? null),
      lng: clearCoordinates ? null : (patch.lng ?? address.lng ?? null),
    });
  };

  const selectSuggestion = async (suggestion: PdokSuggestion) => {
    setSelectingId(suggestion.id);
    const selected = await lookupPdokAddress(suggestion.id);
    setSelectingId(null);
    setOpen(false);
    if (!selected) return;

    onChange({
      street: selected.street,
      postal: selected.postal,
      city: selected.city,
      country: selected.country ?? address.country,
      lat: selected.lat ?? null,
      lng: selected.lng ?? null,
    });
  };

  return (
    <div ref={rootRef} className={cn('space-y-3', className)}>
      <div className={cn('grid grid-cols-1 gap-3', gridClassName)}>
        <div className={cn('relative', streetClassName)}>
          <Label>{streetLabel}{required && ' *'}</Label>
          <Input
            value={address.street}
            onChange={(event) => update({ street: event.target.value })}
            onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
            className={inputClassName}
          />
          {(loading || address.lat != null) && (
            <div className="pointer-events-none absolute right-3 top-9 text-muted-foreground">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4 text-stat-blue" />}
            </div>
          )}
          {open && suggestions.length > 0 && (
            <div className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.id}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(suggestion)}
                >
                  {selectingId === suggestion.id ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                  ) : (
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span>{suggestion.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className={postalClassName}>
          <Label>{postalLabel}{required && ' *'}</Label>
          <Input value={address.postal} onChange={(event) => update({ postal: event.target.value })} className={inputClassName} />
        </div>

        <div className={cityClassName}>
          <Label>{cityLabel}{required && ' *'}</Label>
          <Input value={address.city} onChange={(event) => update({ city: event.target.value })} className={inputClassName} />
        </div>

        {showCountry && (
          <div className={countryClassName}>
            <Label>{countryLabel}</Label>
            <Input value={address.country ?? ''} onChange={(event) => update({ country: event.target.value })} className={inputClassName} />
          </div>
        )}
      </div>
    </div>
  );
};

export default AddressAutocomplete;
