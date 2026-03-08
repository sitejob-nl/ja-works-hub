import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search } from 'lucide-react';

const SuperAdminUsers = () => {
  const [search, setSearch] = useState('');

  const { data: profiles, isLoading } = useQuery({
    queryKey: ['sa-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sa_get_profiles');
      if (error) throw error;
      return data;
    },
  });

  const { data: orgs } = useQuery({
    queryKey: ['sa-orgs'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sa_get_organizations');
      if (error) throw error;
      return data;
    },
  });

  const getOrgName = (orgId: string) => orgs?.find(o => o.id === orgId)?.name ?? '—';

  const filtered = profiles?.filter(p =>
    p.full_name.toLowerCase().includes(search.toLowerCase()) ||
    p.email.toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  const roleColors: Record<string, string> = {
    admin: 'bg-red-900/50 text-red-400',
    intercedent: 'bg-blue-900/50 text-blue-400',
    planner: 'bg-purple-900/50 text-purple-400',
    viewer: 'bg-zinc-700 text-zinc-300',
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Gebruikers</h1>
        <p className="text-zinc-400 text-sm">Alle gebruikers over alle organisaties</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            placeholder="Zoek op naam of email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
          />
        </div>
        <span className="text-zinc-500 text-sm">{filtered.length} gebruikers</span>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400 text-left">
              <th className="px-4 py-3 font-medium">Naam</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Organisatie</th>
              <th className="px-4 py-3 font-medium">Rol</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filtered.map((p) => (
              <tr key={p.id} className="hover:bg-zinc-800/50">
                <td className="px-4 py-3 text-white font-medium">{p.full_name}</td>
                <td className="px-4 py-3 text-zinc-400">{p.email}</td>
                <td className="px-4 py-3 text-zinc-400">{getOrgName(p.organization_id)}</td>
                <td className="px-4 py-3">
                  <Badge className={roleColors[p.role] ?? 'bg-zinc-700 text-zinc-300'}>
                    {p.role}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge className={p.is_active ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}>
                    {p.is_active ? 'Actief' : 'Inactief'}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {isLoading && <p className="text-zinc-500 text-center py-8">Laden...</p>}
        {!isLoading && filtered.length === 0 && <p className="text-zinc-500 text-center py-8">Geen gebruikers gevonden</p>}
      </div>
    </div>
  );
};

export default SuperAdminUsers;
