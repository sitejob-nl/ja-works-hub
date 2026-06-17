import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useOrganizationId } from "@/hooks/useOrganizationId";
import { toast } from "sonner";
import { MessageSquare, Mail, Phone } from "lucide-react";

interface CandidatePreferencesTabProps {
  candidateId: string;
}

export function CandidatePreferencesTab({ candidateId }: CandidatePreferencesTabProps) {
  const organizationId = useOrganizationId();
  const [preferences, setPreferences] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  const channels = [
    { id: "whatsapp", label: "WhatsApp", icon: MessageSquare },
    { id: "email", label: "E-mail", icon: Mail },
    { id: "sms", label: "SMS", icon: Phone },
  ];

  const loadPreferences = useCallback(async () => {
    if (!organizationId || !candidateId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from("communication_preferences")
      .select("*")
      .eq("organization_id", organizationId)
      .eq("candidate_id", candidateId);

    if (error) {
      console.error(error);
    } else {
      const prefs: Record<string, boolean> = {};
      data?.forEach((pref) => {
        prefs[pref.channel] = pref.opted_out;
      });
      setPreferences(prefs);
    }
    setLoading(false);
  }, [candidateId, organizationId]);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const togglePreference = async (channel: string, optedOut: boolean) => {
    if (!organizationId || !candidateId) return;

    const { error } = await supabase.from("communication_preferences").upsert(
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
    );

    if (error) {
      toast.error("Fout bij opslaan voorkeur");
      console.error(error);
    } else {
      toast.success("Voorkeur opgeslagen");
      setPreferences({ ...preferences, [channel]: optedOut });
    }
  };

  if (loading) {
    return <div>Laden...</div>;
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
                  onCheckedChange={(checked) => togglePreference(channel.id, !checked)}
                />
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
