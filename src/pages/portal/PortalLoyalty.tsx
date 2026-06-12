import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, History, ShoppingBag, Star } from 'lucide-react';
import { toast } from 'sonner';
import { usePortal } from '@/contexts/PortalContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format';

const redemptionStatusClass: Record<string, string> = {
  aangevraagd: 'bg-blue-100 text-blue-700 border-0',
  goedgekeurd: 'bg-green-100 text-green-700 border-0',
  uitgegeven: 'bg-primary/10 text-stat-blue border-0',
  geannuleerd: 'bg-muted text-muted-foreground border-0',
};

const PortalLoyalty = () => {
  const { employee } = usePortal();
  const candidateId = employee?.id;
  const qc = useQueryClient();

  const { data: account } = useQuery({
    queryKey: ['portal-loyalty-account', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loyalty_accounts' as any)
        .select('*')
        .eq('candidate_id', candidateId)
        .maybeSingle();
      if (error) throw error;
      return data as any | null;
    },
    enabled: !!candidateId,
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['portal-loyalty-transactions', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('loyalty_transactions' as any)
        .select('*')
        .eq('candidate_id', candidateId)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!candidateId,
  });

  const { data: rewards = [] } = useQuery({
    queryKey: ['portal-reward-catalog'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reward_catalog' as any)
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
        .order('name');
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: redemptions = [] } = useQuery({
    queryKey: ['portal-redemptions', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reward_redemptions' as any)
        .select('*, reward_catalog(name)')
        .eq('candidate_id', candidateId)
        .order('requested_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!candidateId,
  });

  const redeem = useMutation({
    mutationFn: async (rewardId: string) => {
      const { error } = await supabase.rpc('redeem_reward' as any, { p_reward_id: rewardId });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-loyalty-account'] });
      qc.invalidateQueries({ queryKey: ['portal-loyalty-transactions'] });
      qc.invalidateQueries({ queryKey: ['portal-redemptions'] });
      toast.success('Reward aangevraagd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  const balance = account?.balance_points ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Punten & rewards</h1>
        <p className="text-sm text-muted-foreground">Bekijk je saldo, geschiedenis en beschikbare rewards.</p>
      </div>

      <Card>
        <CardContent className="p-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-lg bg-primary/10 flex items-center justify-center">
              <Star className="h-5 w-5 text-stat-blue" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Beschikbaar saldo</p>
              <p className="text-3xl font-bold">{balance.toLocaleString('nl-NL')}</p>
            </div>
          </div>
          <Badge variant="secondary">punten</Badge>
        </CardContent>
      </Card>

      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-stat-blue" />
          <h2 className="font-medium">Rewards</h2>
        </div>
        <div className="grid gap-3">
          {rewards.map((reward: any) => {
            const canRedeem = balance >= reward.points_cost;
            return (
              <Card key={reward.id}>
                <CardContent className="p-4 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{reward.name}</p>
                    {reward.description && <p className="text-sm text-muted-foreground mt-1">{reward.description}</p>}
                    <p className="text-sm font-medium mt-2">{reward.points_cost.toLocaleString('nl-NL')} punten</p>
                  </div>
                  <Button
                    size="sm"
                    disabled={!canRedeem || redeem.isPending}
                    onClick={() => redeem.mutate(reward.id)}
                  >
                    Aanvragen
                  </Button>
                </CardContent>
              </Card>
            );
          })}
          {rewards.length === 0 && (
            <div className="bg-card rounded-xl border p-8 text-center text-muted-foreground">
              <Gift className="h-10 w-10 mx-auto mb-2 opacity-40" />
              <p>Er zijn nog geen rewards beschikbaar.</p>
            </div>
          )}
        </div>
      </section>

      {redemptions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Mijn aanvragen</CardTitle>
            <CardDescription>Status van aangevraagde rewards.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {redemptions.map((redemption: any) => (
              <div key={redemption.id} className="px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{redemption.reward_catalog?.name ?? 'Reward'}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(redemption.requested_at)} · {redemption.points_cost} punten</p>
                </div>
                <Badge variant="secondary" className={redemptionStatusClass[redemption.status] ?? ''}>{redemption.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" /> Geschiedenis
          </CardTitle>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {transactions.map((transaction: any) => (
            <div key={transaction.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">{transaction.description}</p>
                <p className="text-xs text-muted-foreground">{formatDate(transaction.created_at)}</p>
              </div>
              <span className={transaction.points > 0 ? 'text-stat-green font-semibold' : 'text-destructive font-semibold'}>
                {transaction.points > 0 ? '+' : ''}{transaction.points}
              </span>
            </div>
          ))}
          {transactions.length === 0 && (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Nog geen puntentransacties</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default PortalLoyalty;
