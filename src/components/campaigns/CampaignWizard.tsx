import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useOrganizationId } from "@/hooks/useOrganizationId";
import { toast } from "sonner";
import { SegmentBuilder } from "./SegmentBuilder";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { CalendarIcon, AlertTriangle } from "lucide-react";

const EXAMPLE_VALUES: Record<string, string> = {
  first_name: "Jan",
  last_name: "de Vries",
  full_name: "Jan de Vries",
};

function getMergeFieldWarnings(message: string): string[] {
  const warnings: string[] = [];
  // Detect malformed merge fields: single braces, or missing closing braces
  const singleBrace = message.match(/\{(?!\{)[^}]*\}/g);
  if (singleBrace) {
    warnings.push(`Mogelijk fout samenvoegveld (gebruik {{ en }}): ${singleBrace.join(", ")}`);
  }
  const unclosed = message.match(/\{\{(?![^}]*\}\})[^}]*/g);
  if (unclosed) {
    warnings.push(`Niet afgesloten samenvoegveld: ${unclosed.join(", ")}`);
  }
  // Warn about unknown merge fields
  const allFields = message.match(/\{\{(\w+)\}\}/g) || [];
  const known = Object.keys(EXAMPLE_VALUES).map((k) => `{{${k}}}`);
  const unknown = allFields.filter((f) => !known.includes(f));
  if (unknown.length > 0) {
    warnings.push(`Onbekende samenvoegvelden (worden niet vervangen): ${unknown.join(", ")}`);
  }
  return warnings;
}

function renderPreview(message: string): string {
  let preview = message;
  for (const [key, val] of Object.entries(EXAMPLE_VALUES)) {
    preview = preview.replaceAll(`{{${key}}}`, val);
  }
  // Append STOP footer preview if not already present
  if (!preview.includes("STOP")) {
    preview += "\n\nWil je geen berichten meer ontvangen? Antwoord met STOP.";
  }
  return preview;
}

interface CampaignWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}

export function CampaignWizard({ open, onOpenChange, onComplete }: CampaignWizardProps) {
  const organizationId = useOrganizationId();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [segmentFilter, setSegmentFilter] = useState<any>({});
  const [recipientCount, setRecipientCount] = useState(0);
  const [message, setMessage] = useState("");
  const [scheduledAt, setScheduledAt] = useState<Date>();
  const [saving, setSaving] = useState(false);

  const mergeFields = [
    { label: "Voornaam", value: "{{first_name}}" },
    { label: "Achternaam", value: "{{last_name}}" },
    { label: "Volledige naam", value: "{{full_name}}" },
  ];

  const insertMergeField = (field: string) => {
    setMessage((prev) => prev + field);
  };

  const handleComplete = async () => {
    if (!organizationId || !name || !message) {
      toast.error("Vul alle verplichte velden in");
      return;
    }

    setSaving(true);

    try {
      // Add opt-out footer if not present
      let finalMessage = message;
      if (!finalMessage.includes("STOP")) {
        finalMessage += "\n\nWil je geen berichten meer ontvangen? Antwoord met STOP.";
      }

      const { data, error } = await supabase
        .from("bulk_campaigns")
        .insert({
          organization_id: organizationId,
          name,
          channel: "whatsapp",
          segment_filter: segmentFilter,
          message_template: finalMessage,
          status: scheduledAt ? "scheduled" : "draft",
          scheduled_at: scheduledAt?.toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      toast.success("Campagne aangemaakt");
      
      // Reset form
      setStep(1);
      setName("");
      setSegmentFilter({});
      setMessage("");
      setScheduledAt(undefined);
      
      onOpenChange(false);
      onComplete();

      // If not scheduled, ask if they want to send now
      if (!scheduledAt) {
        const confirm = window.confirm("Wil je deze campagne nu verzenden?");
        if (confirm && data) {
          const { error: processError } = await supabase.functions.invoke("bulk-campaign-processor", {
            body: { campaign_id: data.id },
          });

          if (processError) {
            toast.error("Fout bij verzenden campagne");
          } else {
            toast.success("Campagne wordt verzonden");
          }
        }
      }
    } catch (error: any) {
      toast.error(error.message || "Fout bij aanmaken campagne");
    } finally {
      setSaving(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Campagne naam *</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Bijv: Zomer vacatures 2024"
              />
            </div>
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            <SegmentBuilder
              filter={segmentFilter}
              onChange={(filter, count) => {
                setSegmentFilter(filter);
                setRecipientCount(count);
              }}
            />
            <div className="p-4 bg-muted rounded-lg">
              <div className="text-sm font-medium">Aantal ontvangers</div>
              <div className="text-2xl font-bold">{recipientCount}</div>
            </div>
          </div>
        );

      case 3: {
        const warnings = getMergeFieldWarnings(message);
        return (
          <div className="space-y-4">
            <div>
              <Label>Merge velden</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {mergeFields.map((field) => (
                  <Badge
                    key={field.value}
                    variant="outline"
                    className="cursor-pointer"
                    onClick={() => insertMergeField(field.value)}
                  >
                    {field.label}
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="message">Bericht *</Label>
              <Textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Hoi {{first_name}}, ..."
                rows={6}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Gebruik merge velden om berichten te personaliseren
              </p>
            </div>
            {warnings.length > 0 && (
              <div className="space-y-1">
                {warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-800">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
            {message && (
              <div>
                <Label className="text-xs text-muted-foreground">Voorbeeld bericht (met testwaarden)</Label>
                <div className="mt-1 p-3 bg-muted rounded text-sm whitespace-pre-wrap border">
                  {renderPreview(message)}
                </div>
              </div>
            )}
            <div className="p-3 bg-muted rounded text-sm">
              <strong>Opt-out footer:</strong> Er wordt automatisch een "Antwoord met STOP" footer toegevoegd
            </div>
          </div>
        );
      }

      case 4:
        return (
          <div className="space-y-4">
            <div>
              <Label>Wanneer verzenden?</Label>
              <div className="space-y-2 mt-2">
                <Button
                  variant={!scheduledAt ? "default" : "outline"}
                  onClick={() => setScheduledAt(undefined)}
                  className="w-full"
                >
                  Nu verzenden
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant={scheduledAt ? "default" : "outline"} className="w-full">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {scheduledAt ? format(scheduledAt, "PPP", { locale: nl }) : "Later inplannen"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={scheduledAt}
                      onSelect={setScheduledAt}
                      initialFocus
                      disabled={(date) => date < new Date()}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
        );

      case 5:
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <div>
                <div className="text-sm text-muted-foreground">Campagne naam</div>
                <div className="font-medium">{name}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Ontvangers</div>
                <div className="font-medium">{recipientCount} kandidaten</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Bericht</div>
                <div className="p-3 bg-muted rounded text-sm whitespace-pre-wrap">{message}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Planning</div>
                <div className="font-medium">
                  {scheduledAt ? format(scheduledAt, "PPP", { locale: nl }) : "Direct verzenden"}
                </div>
              </div>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nieuwe Bulk Campagne</DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between mb-4">
          {[1, 2, 3, 4, 5].map((s) => (
            <div key={s} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  s === step
                    ? "bg-primary text-primary-foreground"
                    : s < step
                    ? "bg-green-500 text-white"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {s}
              </div>
              {s < 5 && <div className="w-12 h-0.5 bg-muted" />}
            </div>
          ))}
        </div>

        {renderStep()}

        <div className="flex justify-between mt-6">
          <Button variant="outline" onClick={() => setStep(Math.max(1, step - 1))} disabled={step === 1}>
            Vorige
          </Button>
          {step < 5 ? (
            <Button onClick={() => setStep(step + 1)} disabled={step === 1 && !name}>
              Volgende
            </Button>
          ) : (
            <Button onClick={handleComplete} disabled={saving}>
              {saving ? "Bezig..." : scheduledAt ? "Inplannen" : "Aanmaken"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
