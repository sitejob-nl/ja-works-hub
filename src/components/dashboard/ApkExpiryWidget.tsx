import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/format';
import { Wrench } from 'lucide-react';
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';

const WINDOW_DAYS = 60;

export const ApkExpiryWidget = () => {
  const today = format(new Date(), 'yyyy-MM-dd');
  const cutoff = format(addDays(new Date(), WINDOW_DAYS), 'yyyy-MM-dd');

  const { data: vehicles = [] } = useQuery({
    queryKey: ['dashboard-apk-expiry'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, license_plate, brand, model, apk_expiry, status')
        .neq('status', 'uit_dienst' as any)
        .not('apk_expiry', 'is', null)
        .lte('apk_expiry', cutoff)
        .order('apk_expiry')
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Wrench className="h-4 w-4 text-primary" />
          APK loopt af
        </CardTitle>
      </CardHeader>
      <CardContent>
        {vehicles.length === 0 ? (
          <p className="text-sm text-muted-foreground">Geen APK-keuringen binnen 60 dagen</p>
        ) : (
          <div className="space-y-2 max-h-[250px] overflow-y-auto">
            {vehicles.map((v: any) => {
              const days = (() => { try { return differenceInCalendarDays(parseISO(v.apk_expiry), new Date()); } catch { return null; } })();
              const expired = days != null && days < 0;
              const label = [v.brand, v.model].filter(Boolean).join(' ') || v.license_plate;
              return (
                <Link
                  key={v.id}
                  to={`/transport/${v.id}`}
                  className="flex items-center justify-between p-2 rounded-md hover:bg-muted/50 text-sm"
                >
                  <span>
                    <span className="font-mono font-medium">{v.license_plate}</span>
                    <span className="text-muted-foreground ml-2">{label}</span>
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatDate(v.apk_expiry)}</span>
                    {days != null && (
                      <Badge variant={expired ? 'destructive' : days <= 14 ? 'destructive' : 'secondary'} className="text-[10px]">
                        {expired ? `${Math.abs(days)}d verlopen` : `${days}d`}
                      </Badge>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
