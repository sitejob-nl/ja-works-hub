import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Plus, Package } from 'lucide-react';

const ALL_MODULES = [
  'opdrachtgevers', 'kandidaten', 'medewerkers', 'vacatures', 'planning',
  'uren', 'huisvesting', 'transport', 'communicatie', 'kennisbank', 'vacaturebank',
];

const SuperAdminPlans = () => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [modules, setModules] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const { data: plans, isLoading } = useQuery({
    queryKey: ['sa-plans'],
    queryFn: async () => {
      const { data, error } = await supabase.from('subscription_plans').select('*');
      if (error) throw error;
      return data;
    },
  });

  const createPlan = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('subscription_plans').insert({
        name, description, modules,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sa-plans'] });
      toast.success('Plan aangemaakt');
      setOpen(false);
      setName('');
      setDescription('');
      setModules([]);
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleModule = (mod: string) => {
    setModules(prev => prev.includes(mod) ? prev.filter(m => m !== mod) : [...prev, mod]);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Abonnementen</h1>
          <p className="text-zinc-400 text-sm">Beheer abonnementspakketten en modules</p>
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button className="bg-red-600 hover:bg-red-700 text-white">
              <Plus className="h-4 w-4 mr-2" /> Nieuw plan
            </Button>
          </SheetTrigger>
          <SheetContent className="bg-zinc-900 border-zinc-800 text-white">
            <SheetHeader>
              <SheetTitle className="text-white">Nieuw abonnement</SheetTitle>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              <div>
                <Label className="text-zinc-300">Naam</Label>
                <Input value={name} onChange={e => setName(e.target.value)} className="bg-zinc-800 border-zinc-700 text-white" />
              </div>
              <div>
                <Label className="text-zinc-300">Beschrijving</Label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} className="bg-zinc-800 border-zinc-700 text-white" />
              </div>
              <div>
                <Label className="text-zinc-300 mb-2 block">Modules</Label>
                <div className="space-y-2">
                  {ALL_MODULES.map(mod => (
                    <div key={mod} className="flex items-center justify-between py-2 px-3 bg-zinc-800 rounded-lg">
                      <span className="text-sm capitalize">{mod}</span>
                      <Switch checked={modules.includes(mod)} onCheckedChange={() => toggleModule(mod)} />
                    </div>
                  ))}
                </div>
              </div>
              <Button onClick={() => createPlan.mutate()} disabled={!name} className="w-full bg-red-600 hover:bg-red-700">
                Opslaan
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {plans?.map(plan => (
          <div key={plan.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-5">
            <div className="flex items-center gap-2 mb-2">
              <Package className="h-4 w-4 text-zinc-400" />
              <h3 className="text-white font-semibold">{plan.name}</h3>
              {plan.is_default && <Badge className="bg-blue-900/50 text-blue-400 text-[10px]">Default</Badge>}
            </div>
            <p className="text-zinc-400 text-sm mb-3">{plan.description || 'Geen beschrijving'}</p>
            <div className="flex flex-wrap gap-1.5">
              {plan.modules?.map(mod => (
                <Badge key={mod} variant="secondary" className="bg-zinc-800 text-zinc-300 text-[10px] capitalize">
                  {mod}
                </Badge>
              ))}
            </div>
          </div>
        ))}
        {isLoading && <p className="text-zinc-500 col-span-full text-center py-8">Laden...</p>}
      </div>
    </div>
  );
};

export default SuperAdminPlans;
