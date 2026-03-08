import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Building2, Users, AlertTriangle, Activity } from 'lucide-react';

const SuperAdminDashboard = () => {
  const { data: orgs } = useQuery({
    queryKey: ['sa-orgs'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sa_get_organizations');
      if (error) throw error;
      return data;
    },
  });

  const { data: profiles } = useQuery({
    queryKey: ['sa-profiles'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sa_get_profiles');
      if (error) throw error;
      return data;
    },
  });

  const { data: errors } = useQuery({
    queryKey: ['sa-errors-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('client_errors')
        .select('*', { count: 'exact', head: true });
      if (error) throw error;
      return count ?? 0;
    },
  });

  const { data: recentErrors } = useQuery({
    queryKey: ['sa-recent-errors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_errors')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data;
    },
  });

  const stats = [
    { label: 'Organisaties', value: orgs?.length ?? 0, icon: Building2, color: 'text-blue-400' },
    { label: 'Gebruikers', value: profiles?.length ?? 0, icon: Users, color: 'text-green-400' },
    { label: 'Actieve orgs', value: orgs?.filter(o => o.is_active).length ?? 0, icon: Activity, color: 'text-emerald-400' },
    { label: 'Foutmeldingen', value: errors ?? 0, icon: AlertTriangle, color: 'text-red-400' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Super Admin Dashboard</h1>
        <p className="text-zinc-400 text-sm">Overzicht van alle organisaties en systeemstatus</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-zinc-400 text-sm">{s.label}</span>
              <s.icon className={`h-4 w-4 ${s.color}`} />
            </div>
            <p className="text-2xl font-bold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent organizations */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg">
          <div className="p-4 border-b border-zinc-800">
            <h2 className="text-white font-semibold">Organisaties</h2>
          </div>
          <div className="divide-y divide-zinc-800">
            {orgs?.slice(0, 5).map((org) => (
              <div key={org.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-white text-sm font-medium">{org.name}</p>
                  <p className="text-zinc-500 text-xs">{org.slug} · {org.email || 'Geen email'}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full ${org.is_active ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                  {org.is_active ? 'Actief' : 'Inactief'}
                </span>
              </div>
            ))}
            {(!orgs || orgs.length === 0) && (
              <p className="px-4 py-6 text-zinc-500 text-sm text-center">Geen organisaties</p>
            )}
          </div>
        </div>

        {/* Recent errors */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg">
          <div className="p-4 border-b border-zinc-800">
            <h2 className="text-white font-semibold">Recente foutmeldingen</h2>
          </div>
          <div className="divide-y divide-zinc-800">
            {recentErrors?.map((err) => (
              <div key={err.id} className="px-4 py-3">
                <p className="text-red-400 text-sm font-mono truncate">{err.error_message}</p>
                <p className="text-zinc-500 text-xs mt-1">
                  {err.url} · {new Date(err.created_at).toLocaleString('nl-NL')}
                </p>
              </div>
            ))}
            {(!recentErrors || recentErrors.length === 0) && (
              <p className="px-4 py-6 text-zinc-500 text-sm text-center">Geen foutmeldingen 🎉</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SuperAdminDashboard;
