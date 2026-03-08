import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Search, Trash2, AlertTriangle, RefreshCcw } from 'lucide-react';

const SuperAdminErrors = () => {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: orgs } = useQuery({
    queryKey: ['sa-orgs'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sa_get_organizations');
      if (error) throw error;
      return data;
    },
  });

  const { data: errors, isLoading } = useQuery({
    queryKey: ['sa-errors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_errors')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data;
    },
    refetchInterval: 30000,
  });

  const { data: auditLogs } = useQuery({
    queryKey: ['sa-audit'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sa_get_audit_log', { p_limit: 50, p_offset: 0 });
      if (error) throw error;
      return data;
    },
  });

  const deleteError = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('client_errors').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sa-errors'] });
      toast.success('Foutmelding verwijderd');
    },
  });

  const getOrgName = (orgId: string | null) => {
    if (!orgId) return '—';
    return orgs?.find(o => o.id === orgId)?.name ?? orgId.slice(0, 8);
  };

  const filtered = errors?.filter(e =>
    e.error_message.toLowerCase().includes(search.toLowerCase()) ||
    (e.url ?? '').toLowerCase().includes(search.toLowerCase()) ||
    (e.user_email ?? '').toLowerCase().includes(search.toLowerCase())
  ) ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Foutmeldingen & Audit Log</h1>
          <p className="text-zinc-400 text-sm">Client-side errors en systeemgebeurtenissen</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-zinc-400 hover:text-white"
          onClick={() => {
            queryClient.invalidateQueries({ queryKey: ['sa-errors'] });
            queryClient.invalidateQueries({ queryKey: ['sa-audit'] });
          }}
        >
          <RefreshCcw className="h-4 w-4 mr-1" /> Vernieuwen
        </Button>
      </div>

      {/* Client errors */}
      <div>
        <h2 className="text-white font-semibold mb-3">Client Errors ({filtered.length})</h2>
        <div className="relative max-w-md mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <Input
            placeholder="Zoek op foutmelding, URL of email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-zinc-900 border-zinc-700 text-white placeholder:text-zinc-500"
          />
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg divide-y divide-zinc-800 max-h-[500px] overflow-auto">
          {filtered.map((err) => (
            <div key={err.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => setExpanded(expanded === err.id ? null : err.id)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                    <p className="text-red-400 text-sm font-mono truncate">{err.error_message}</p>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-zinc-500">
                    <span>{getOrgName(err.organization_id)}</span>
                    <span>{err.user_email ?? 'onbekend'}</span>
                    <span>{err.url}</span>
                    <span>{new Date(err.created_at).toLocaleString('nl-NL')}</span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-zinc-500 hover:text-red-400 shrink-0"
                  onClick={() => deleteError.mutate(err.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
              {expanded === err.id && err.stack_trace && (
                <pre className="mt-2 text-[11px] text-zinc-500 bg-zinc-950 p-3 rounded overflow-x-auto max-h-40">
                  {err.stack_trace}
                </pre>
              )}
            </div>
          ))}
          {!isLoading && filtered.length === 0 && (
            <p className="text-zinc-500 text-sm text-center py-8">Geen foutmeldingen 🎉</p>
          )}
        </div>
      </div>

      {/* Audit log */}
      <div>
        <h2 className="text-white font-semibold mb-3">Audit Log (laatste 50)</h2>
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden max-h-[400px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-900">
              <tr className="border-b border-zinc-800 text-zinc-400 text-left">
                <th className="px-4 py-2 font-medium">Tijdstip</th>
                <th className="px-4 py-2 font-medium">Actie</th>
                <th className="px-4 py-2 font-medium">Tabel</th>
                <th className="px-4 py-2 font-medium">Organisatie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {auditLogs?.map((log) => (
                <tr key={log.id} className="hover:bg-zinc-800/50">
                  <td className="px-4 py-2 text-zinc-400 text-xs">
                    {new Date(log.created_at).toLocaleString('nl-NL')}
                  </td>
                  <td className="px-4 py-2">
                    <Badge className="bg-zinc-800 text-zinc-300 text-[10px]">{log.action}</Badge>
                  </td>
                  <td className="px-4 py-2 text-zinc-400">{log.table_name}</td>
                  <td className="px-4 py-2 text-zinc-500 text-xs">{getOrgName(log.organization_id)}</td>
                </tr>
              ))}
              {(!auditLogs || auditLogs.length === 0) && (
                <tr><td colSpan={4} className="text-zinc-500 text-center py-6">Geen audit logs</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SuperAdminErrors;
