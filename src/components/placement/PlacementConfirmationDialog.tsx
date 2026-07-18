import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Mail, AlertTriangle, Building2, User, Loader2 } from 'lucide-react';
import { previewPlacementConfirmation, sendPlacementConfirmation, type PlacementConfirmationResult } from './PlacementTriggers';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placementId: string;
  candidateName: string;
  candidateEmail: string | null;
  candidatePhone: string | null;
  companyName: string;
  functionName: string;
  startDate: string;
}

/**
 * Renders server-generated HTML preview inside a sandboxed iframe.
 * The HTML is produced by our own edge function (not user input),
 * but the sandbox attribute provides defense-in-depth against XSS.
 */
function HtmlPreview({ html }: { html: string }) {
  return (
    <iframe
      sandbox=""
      srcDoc={html}
      className="border rounded-md w-full bg-white"
      style={{ height: 300 }}
      title="Email preview"
    />
  );
}

// (Opnieuw) versturen van de plaatsingsbevestiging vanaf de plaatsing-detailpagina.
// Toont de mails als preview vóórdat er iets verstuurd wordt; huisvesting-toewijzing
// zit niet meer in deze dialog maar in de PlacementWizard.
const PlacementConfirmationDialog = ({
  open,
  onOpenChange,
  placementId,
  candidateName,
  candidateEmail,
  candidatePhone,
  companyName,
  functionName,
  startDate,
}: Props) => {
  const [sendToClient, setSendToClient] = useState(true);
  const [sendToEmployee, setSendToEmployee] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [preview, setPreview] = useState<PlacementConfirmationResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const missingEmail = !candidateEmail;
  const missingPhone = !candidatePhone;

  useEffect(() => {
    if (!open || sent) return;
    if (!sendToClient && !sendToEmployee) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    previewPlacementConfirmation({ placementId, sendToClient, sendToEmployee: sendToEmployee && !missingEmail })
      .then((res) => { if (!cancelled) setPreview(res); })
      .catch((e: any) => { if (!cancelled) { setPreview(null); setPreviewError(e.message); } })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [open, sent, placementId, sendToClient, sendToEmployee, missingEmail]);

  const handleSend = async () => {
    if (!sendToClient && !sendToEmployee) {
      toast.warning('Selecteer minimaal een ontvanger');
      return;
    }
    if (sendToEmployee && missingEmail && !sendToClient) {
      toast.error('Kandidaat heeft geen e-mailadres');
      return;
    }

    setSending(true);
    try {
      const res = await sendPlacementConfirmation(placementId, sendToClient, sendToEmployee && !missingEmail);
      setPreview(res);
      setSent(true);
      if (res.warnings?.length > 0) res.warnings.forEach((w) => toast.warning(w));
      const count = (res.client_email ? 1 : 0) + (res.employee_email ? 1 : 0);
      toast.success(`${count} bevestigingsmail(s) verstuurd of als concept opgeslagen`);
    } catch (err: any) {
      toast.error(err.message ?? 'Fout bij versturen');
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setSent(false);
    setPreview(null);
    setPreviewError(null);
    setSendToClient(true);
    setSendToEmployee(true);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Plaatsingsbevestiging versturen
          </DialogTitle>
          <DialogDescription>
            Controleer het voorbeeld en verstuur de bevestigingsmail naar de opdrachtgever en/of medewerker.
          </DialogDescription>
        </DialogHeader>

        {/* Placement summary */}
        <div className="rounded-md border bg-muted/50 p-3 text-sm space-y-1">
          <div><span className="text-muted-foreground">Kandidaat:</span> <strong>{candidateName}</strong></div>
          <div><span className="text-muted-foreground">Opdrachtgever:</span> <strong>{companyName}</strong></div>
          <div><span className="text-muted-foreground">Functie:</span> <strong>{functionName}</strong></div>
          <div><span className="text-muted-foreground">Startdatum:</span> <strong>{startDate}</strong></div>
        </div>

        {/* Warnings */}
        {(missingEmail || missingPhone) && (
          <div className="flex flex-wrap gap-2">
            {missingEmail && (
              <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Geen e-mailadres kandidaat</Badge>
            )}
            {missingPhone && (
              <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Telefoonnummer kandidaat ontbreekt</Badge>
            )}
          </div>
        )}

        {/* Recipient checkboxes */}
        {!sent && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">Ontvangers</Label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox id="send-client" checked={sendToClient} onCheckedChange={(v) => setSendToClient(v === true)} />
                <label htmlFor="send-client" className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />Email naar opdrachtgever ({companyName})
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="send-employee" checked={sendToEmployee && !missingEmail} onCheckedChange={(v) => setSendToEmployee(v === true)} disabled={missingEmail} />
                <label htmlFor="send-employee" className={`flex items-center gap-1.5 text-sm cursor-pointer ${missingEmail ? 'text-muted-foreground line-through' : ''}`}>
                  <User className="h-3.5 w-3.5 text-muted-foreground" />Email naar medewerker ({candidateName})
                  {missingEmail && <span className="text-xs text-destructive ml-1">(geen e-mail)</span>}
                </label>
              </div>
            </div>
          </div>
        )}

        {previewLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Voorbeeld genereren...
          </div>
        )}

        {previewError && !sent && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive"><AlertTriangle className="h-4 w-4" /> Voorbeeld niet beschikbaar</div>
            <p className="mt-1 text-xs text-muted-foreground">{previewError}</p>
            <p className="mt-1 text-xs text-muted-foreground">Controleer de e-mailtemplates onder Instellingen → HR &amp; documenten.</p>
          </div>
        )}

        {/* Preview tabs (vóór en na versturen) */}
        {!previewLoading && preview && (preview.client_email || preview.employee_email) && (
          <Tabs defaultValue={preview.client_email ? 'client' : 'employee'} className="w-full">
            <TabsList className="w-full">
              {preview.client_email && <TabsTrigger value="client" className="flex-1 gap-1"><Building2 className="h-3.5 w-3.5" />Opdrachtgever</TabsTrigger>}
              {preview.employee_email && <TabsTrigger value="employee" className="flex-1 gap-1"><User className="h-3.5 w-3.5" />Medewerker</TabsTrigger>}
            </TabsList>
            {preview.client_email && (
              <TabsContent value="client" className="space-y-2">
                <div className="text-xs text-muted-foreground space-y-1">
                  <div><strong>Aan:</strong> {preview.client_email.to}</div>
                  <div><strong>Onderwerp:</strong> {preview.client_email.subject}</div>
                </div>
                <HtmlPreview html={preview.client_email.html} />
              </TabsContent>
            )}
            {preview.employee_email && (
              <TabsContent value="employee" className="space-y-2">
                <div className="text-xs text-muted-foreground space-y-1">
                  <div><strong>Aan:</strong> {preview.employee_email.to}</div>
                  <div><strong>Onderwerp:</strong> {preview.employee_email.subject}</div>
                </div>
                <HtmlPreview html={preview.employee_email.html} />
              </TabsContent>
            )}
          </Tabs>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={handleClose}>{sent ? 'Sluiten' : 'Annuleren'}</Button>
          {!sent && (
            <Button
              onClick={handleSend}
              disabled={sending || previewLoading || (!sendToClient && !sendToEmployee)}
            >
              {sending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {sending ? 'Versturen...' : 'Versturen'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PlacementConfirmationDialog;
