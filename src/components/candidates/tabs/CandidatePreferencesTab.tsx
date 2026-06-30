import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useOrganizationId } from "@/hooks/useOrganizationId";
import { toast } from "sonner";
import { MessageSquare, Mail, Phone } from "lucide-react";
import ErrorState from "@/components/shared/ErrorState";
import { unwrap, unwrapList } from "@/lib/db";

interface CandidatePreferencesTabProps {
  candidateId: string;
}

export function CandidatePreferencesTab({ candidateId }: CandidatePreferencesTabProps) {
  const organizationId = useOrganizationId();
  const qc = useQueryClient();
  const queryKey = ["candidate-communication-preferences", organizationId, candidateId] as const;

  const channels = [
    { id: "whatsapp", label: "WhatsApp", icon: MessageSquare },
    { id: "email", label: "E-mail", icon: Mail },
    { id: "sms", label: "SMS", icon: Phone },
  ];

  const preferencesQuery = useQuery({
    queryKey,
    enabled: !!organizationId && !!candidateId,
    retry: 1,
    queryFn: async () => unwrapList(
      supabase
        .from("communication_preferences")
        .select("channel, opted_out")
        .eq("organization_id", organizationId!)
        .eq("candidate_id", candidateId)
    ),
  });

  const preferences = useMemo(() => {
    const prefs: Record<string, boolean> = {};
    preferencesQuery.data?.forEach((pref) => {
      prefs[pref.channel] = pref.opted_out === true;
    });
    return prefs;
  }, [preferencesQuery.data]);

  const savePreference = useMutation({
    mutationFn: async ({ channel, optedOut }: { channel: string; optedOut: boolean }) => {
      if (!organizationId || !candidateId) throw new Error("Kandidaat of organisatie ontbreekt");
      await unwrap(
        supabase.from("communication_preferences").upsert(
          {
            organization_id: organizationId,
            candidate_id: candidateId,
            channel: channel as any,
            opted_out: optedOut,
            opted_out_at: optedOut ? new Date().toISOString() : null,
            opted_out_reason: optedOut ? "Manual opt-out" : null,
          },
          {
            onConflict: "organization_id,candidate_id,channel",
          }
        )
      );
      return { channel, optedOut };
    },
    onSuccess: ({ channel, optedOut }) => {
      qc.setQueryData(queryKey, (current: Array<{ channel: string; opted_out: boolean }> | undefined) => {
        const rows = current ?? [];
        const exists = rows.some((row) => row.channel === channel);
        if (!exists) return [...rows, { channel, opted_out: optedOut }];
        return rows.map((row) => row.channel === channel ? { ...row, opted_out: optedOut } : row);
      });
      toast.success("Voorkeur opgeslagen");
    },
    onError: () => toast.error("Fout bij opslaan voorkeur"),
  });

  if (preferencesQuery.isLoading || !organizationId) {
    return <div>Laden...</div>;
  }

  if (preferencesQuery.isError) {
    return (
      <ErrorState
        title="Communicatievoorkeuren niet geladen"
        error={preferencesQuery.error}
        onRetry={() => preferencesQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Communicatie voorkeuren</CardTitle>
          <CardDescription>
            Beheer de kanalen waarop deze kandidaat berichten wil ontvangen
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {channels.map((channel) => {
            const Icon = channel.icon;
            const isOptedOut = preferences[channel.id] || false;

            return (
              <div key={channel.id} className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <Icon className="w-5 h-5 text-muted-foreground" />
                  <div>
                    <Label htmlFor={channel.id} className="text-base">
                      {channel.label}
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      {isOptedOut
                        ? "Kandidaat ontvangt geen berichten via dit kanaal"
                        : "Kandidaat kan berichten ontvangen via dit kanaal"}
                    </p>
                  </div>
                </div>
                <Switch
                  id={channel.id}
                  checked={!isOptedOut}
                  disabled={savePreference.isPending}
                  onCheckedChange={(checked) => savePreference.mutate({ channel: channel.id, optedOut: !checked })}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
