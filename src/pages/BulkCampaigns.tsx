import { useState, useCallback, useEffect } from "react";
import { Plus, Send, Clock, CheckCircle, XCircle, AlertCircle, Pause, Play, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useOrganizationId } from "@/hooks/useOrganizationId";
import { toast } from "sonner";
import { CampaignWizard } from "@/components/campaigns/CampaignWizard";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { nl } from "date-fns/locale";

export default function BulkCampaigns() {
  const organizationId = useOrganizationId();
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);

  const loadCampaigns = useCallback(async () => {
    if (!organizationId) return;

    const { data, error } = await supabase
      .from("bulk_campaigns")
      .select("*")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error("Fout bij laden campagnes");
      console.error(error);
    } else {
      setCampaigns(data || []);
    }
    setLoading(false);
  }, [organizationId]);

  useEffect(() => {
    loadCampaigns();

    // Subscribe to realtime updates
    if (!organizationId) return;

    const channel = supabase
      .channel("bulk_campaigns_changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bulk_campaigns",
          filter: `organization_id=eq.${organizationId}`,
        },
        () => {
          loadCampaigns();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadCampaigns, organizationId]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "draft":
        return <Badge variant="outline">Concept</Badge>;
      case "scheduled":
        return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />Gepland</Badge>;
      case "running":
        return <Badge variant="default"><Send className="w-3 h-3 mr-1" />Bezig</Badge>;
      case "completed":
        return <Badge variant="secondary" className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Voltooid</Badge>;
      case "paused":
        return <Badge variant="secondary"><AlertCircle className="w-3 h-3 mr-1" />Gepauzeerd</Badge>;
      case "cancelled":
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Geannuleerd</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getProgress = (campaign: any) => {
    if (!campaign.total_recipients || campaign.total_recipients === 0) return 0;
    const processed = (campaign.sent_count || 0) + (campaign.failed_count || 0) + (campaign.opted_out_count || 0);
    return Math.min(100, (processed / campaign.total_recipients) * 100);
  };

  const handlePause = async (e: React.MouseEvent, campaignId: string) => {
    e.stopPropagation();
    const { error } = await supabase
      .from("bulk_campaigns")
      .update({ status: "paused", paused_at: new Date().toISOString() })
      .eq("id", campaignId);
    if (error) {
      toast.error("Fout bij pauzeren campagne");
    } else {
      toast.success("Campagne gepauzeerd");
      loadCampaigns();
    }
  };

  const handleResume = async (e: React.MouseEvent, campaignId: string) => {
    e.stopPropagation();
    const { error } = await supabase
      .from("bulk_campaigns")
      .update({ status: "running", paused_at: null })
      .eq("id", campaignId);
    if (error) {
      toast.error("Fout bij hervatten campagne");
      return;
    }
    // Trigger processor to continue sending
    const { error: processError } = await supabase.functions.invoke("bulk-campaign-processor", {
      body: { campaign_id: campaignId },
    });
    if (processError) {
      toast.error("Campagne hervat maar verwerking kon niet worden gestart");
    } else {
      toast.success("Campagne hervat");
    }
    loadCampaigns();
  };

  const handleCancel = async (e: React.MouseEvent, campaignId: string) => {
    e.stopPropagation();
    if (!window.confirm("Weet je zeker dat je deze campagne wilt annuleren? Dit kan niet ongedaan worden gemaakt.")) return;
    const { error } = await supabase
      .from("bulk_campaigns")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", campaignId);
    if (error) {
      toast.error("Fout bij annuleren campagne");
    } else {
      toast.success("Campagne geannuleerd");
      loadCampaigns();
    }
  };

  if (loading) {
    return <div className="p-8">Laden...</div>;
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Bulk Campagnes</h1>
          <p className="text-muted-foreground">Verstuur berichten naar meerdere kandidaten tegelijk</p>
        </div>
        <Button onClick={() => setWizardOpen(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Nieuwe Campagne
        </Button>
      </div>

      <div className="grid gap-4">
        {campaigns.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center">
              <Send className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">Nog geen campagnes</h3>
              <p className="text-muted-foreground mb-4">
                Maak je eerste bulk campagne aan om berichten te versturen naar meerdere kandidaten.
              </p>
              <Button onClick={() => setWizardOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Nieuwe Campagne
              </Button>
            </CardContent>
          </Card>
        ) : (
          campaigns.map((campaign) => (
            <Card
              key={campaign.id}
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => navigate(`/bulk-campaigns/${campaign.id}`)}
            >
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <CardTitle>{campaign.name}</CardTitle>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>
                        {campaign.created_at &&
                          formatDistanceToNow(new Date(campaign.created_at), {
                            addSuffix: true,
                            locale: nl,
                          })}
                      </span>
                      {campaign.channel === "whatsapp" && <Badge variant="outline">WhatsApp</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(campaign.status)}
                    {campaign.status === "running" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => handlePause(e, campaign.id)}
                        >
                          <Pause className="w-3 h-3 mr-1" />
                          Pauzeren
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          onClick={(e) => handleCancel(e, campaign.id)}
                        >
                          <Ban className="w-3 h-3 mr-1" />
                          Annuleren
                        </Button>
                      </>
                    )}
                    {campaign.status === "paused" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-green-600 hover:text-green-600"
                          onClick={(e) => handleResume(e, campaign.id)}
                        >
                          <Play className="w-3 h-3 mr-1" />
                          Hervatten
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          onClick={(e) => handleCancel(e, campaign.id)}
                        >
                          <Ban className="w-3 h-3 mr-1" />
                          Annuleren
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {campaign.status !== "draft" && campaign.total_recipients > 0 && (
                  <>
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs text-muted-foreground">
                        <span>Voortgang</span>
                        <span>
                          {(campaign.sent_count || 0) + (campaign.failed_count || 0) + (campaign.opted_out_count || 0)}{" "}
                          / {campaign.total_recipients}
                        </span>
                      </div>
                      <Progress value={getProgress(campaign)} className="h-2" />
                    </div>
                    <div className="grid grid-cols-4 gap-4 text-sm">
                      <div>
                        <div className="text-muted-foreground">Totaal</div>
                        <div className="font-semibold">{campaign.total_recipients}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Verzonden</div>
                        <div className="font-semibold text-green-600">{campaign.sent_count || 0}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Mislukt</div>
                        <div className="font-semibold text-red-600">
                          {campaign.failed_count || 0}
                          {campaign.retry_count > 0 && (
                            <span className="text-xs text-muted-foreground ml-1">
                              ({campaign.retry_count} herp.)
                            </span>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Afgemeld</div>
                        <div className="font-semibold text-orange-600">{campaign.opted_out_count || 0}</div>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <CampaignWizard open={wizardOpen} onOpenChange={setWizardOpen} onComplete={loadCampaigns} />
    </div>
  );
}
