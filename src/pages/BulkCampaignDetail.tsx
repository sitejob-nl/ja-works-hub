import { useState, useCallback, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Play, Pause, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { nl } from "date-fns/locale";

export default function BulkCampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<any>(null);
  const [recipients, setRecipients] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!id) return;

    const { data: campaignData, error: campaignError } = await supabase
      .from("bulk_campaigns")
      .select("*")
      .eq("id", id)
      .single();

    if (campaignError) {
      toast.error("Fout bij laden campagne");
      navigate("/bulk-campaigns");
      return;
    }

    const { data: recipientsData, error: recipientsError } = await supabase
      .from("campaign_recipients")
      .select(`
        *,
        candidates:candidate_id (first_name, last_name, phone)
      `)
      .eq("campaign_id", id)
      .order("created_at", { ascending: false });

    if (recipientsError) {
      console.error(recipientsError);
    }

    setCampaign(campaignData);
    setRecipients(recipientsData || []);
    setLoading(false);
  }, [id, navigate]);

  useEffect(() => {
    loadData();

    // Subscribe to realtime updates
    if (!id) return;

    const channel = supabase
      .channel(`campaign_${id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bulk_campaigns",
          filter: `id=eq.${id}`,
        },
        () => loadData()
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "campaign_recipients",
          filter: `campaign_id=eq.${id}`,
        },
        () => loadData()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, loadData]);

  const handlePause = async () => {
    const { error } = await supabase
      .from("bulk_campaigns")
      .update({ status: "paused" })
      .eq("id", id);

    if (error) {
      toast.error("Fout bij pauzeren campagne");
    } else {
      toast.success("Campagne gepauzeerd");
    }
  };

  const handleResume = async () => {
    const { error } = await supabase
      .from("bulk_campaigns")
      .update({ status: "running" })
      .eq("id", id);

    if (error) {
      toast.error("Fout bij hervatten campagne");
    } else {
      toast.success("Campagne hervat");
      
      // Trigger processor
      const { error: processError } = await supabase.functions.invoke("bulk-campaign-processor", {
        body: { campaign_id: id },
      });

      if (processError) {
        toast.error("Fout bij verzenden berichten");
      }
    }
  };

  const handleCancel = async () => {
    if (!confirm("Weet je zeker dat je deze campagne wilt annuleren?")) return;

    const { error } = await supabase
      .from("bulk_campaigns")
      .update({ status: "cancelled" })
      .eq("id", id);

    if (error) {
      toast.error("Fout bij annuleren campagne");
    } else {
      toast.success("Campagne geannuleerd");
    }
  };

  const getProgress = () => {
    if (!campaign || campaign.total_recipients === 0) return 0;
    const processed = (campaign.sent_count || 0) + (campaign.failed_count || 0) + (campaign.opted_out_count || 0);
    return (processed / campaign.total_recipients) * 100;
  };

  const getStatusBadge = (status: string) => {
    const badges: Record<string, JSX.Element> = {
      pending: <Badge variant="outline">In wachtrij</Badge>,
      sent: <Badge variant="secondary" className="bg-green-100 text-green-800">Verzonden</Badge>,
      failed: <Badge variant="destructive">Mislukt</Badge>,
      opted_out: <Badge variant="secondary" className="bg-orange-100 text-orange-800">Afgemeld</Badge>,
    };
    return badges[status] || <Badge>{status}</Badge>;
  };

  if (loading) {
    return <div className="p-8">Laden...</div>;
  }

  if (!campaign) {
    return <div className="p-8">Campagne niet gevonden</div>;
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/bulk-campaigns")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">{campaign.name}</h1>
          <p className="text-muted-foreground">
            Aangemaakt op {format(new Date(campaign.created_at), "PPP", { locale: nl })}
          </p>
        </div>
        <div className="flex gap-2">
          {campaign.status === "running" && (
            <Button variant="outline" onClick={handlePause}>
              <Pause className="w-4 h-4 mr-2" />
              Pauzeren
            </Button>
          )}
          {campaign.status === "paused" && (
            <Button onClick={handleResume}>
              <Play className="w-4 h-4 mr-2" />
              Hervatten
            </Button>
          )}
          {["running", "paused", "scheduled"].includes(campaign.status) && (
            <Button variant="destructive" onClick={handleCancel}>
              <XCircle className="w-4 h-4 mr-2" />
              Annuleren
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Totaal</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{campaign.total_recipients}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Verzonden</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{campaign.sent_count || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Mislukt</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{campaign.failed_count || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Afgemeld</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">{campaign.opted_out_count || 0}</div>
          </CardContent>
        </Card>
      </div>

      {campaign.total_recipients > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Voortgang</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={getProgress()} className="h-3" />
            <p className="text-sm text-muted-foreground mt-2">
              {Math.round(getProgress())}% voltooid
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Bericht</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 bg-muted rounded whitespace-pre-wrap">{campaign.message_template}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ontvangers ({recipients.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Naam</TableHead>
                <TableHead>Telefoon</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Verzonden op</TableHead>
                <TableHead>Foutmelding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipients.map((recipient) => (
                <TableRow key={recipient.id}>
                  <TableCell>
                    {recipient.candidates?.first_name} {recipient.candidates?.last_name}
                  </TableCell>
                  <TableCell>{recipient.candidates?.phone}</TableCell>
                  <TableCell>{getStatusBadge(recipient.status)}</TableCell>
                  <TableCell>
                    {recipient.sent_at
                      ? format(new Date(recipient.sent_at), "PPp", { locale: nl })
                      : "-"}
                  </TableCell>
                  <TableCell className="text-sm text-red-600">
                    {recipient.error_message || "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
