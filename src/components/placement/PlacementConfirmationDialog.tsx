import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Mail, AlertTriangle, Building2, User, Loader2 } from 'lucide-react';
import { sendPlacementConfirmation, type PlacementConfirmationResult } from './PlacementTriggers';

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
 * Renders server-generated HTML preview inside an iframe to avoid XSS risks
 * from dangerouslySetInnerHTML.  The HTML is produced by our own edge function,
 * not user input, but an iframe with sandbox keeps it extra safe.
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
  const [result, setResult] = useState<PlacementConfirmationResult | null>(null);

  const missingEmail = !candidateEmail;
  const missingPhone = !candidatePhone;

  const handleSend = async () => {
    if (!sendToClient && !sendToEmployee) {
      toast.warning('Selecteer minimaal een ontvanger');
      return;
    }

    if (sendToEmployee && missingEmail) {
      toast.error('Kandidaat heeft geen e-mailadres');
      return;
    }

    setSending(true);
    try {
      const res = await sendPlacementConfirmation(placementId, sendToClient, sendToEmployee);
      setResult(res);

      if (res.warnings?.length > 0) {
        res.warnings.forEach((w) => toast.warning(w));
      }

      const count = (res.client_email ? 1 : 0) + (res.employee_email ? 1 : 0);
      toast.success(`${count} bevestigingsmail(s) opgeslagen als concept`);
    } catch (err: any) {
      toast.error(err.message ?? 'Fout bij versturen');
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setResult(null);
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
            Verstuur een bevestigingsmail naar de opdrachtgever en/of medewerker.
          </DialogDescription>
        </DialogHeader>

        {/* Placement summary */}
        <div className="rounded-md border bg-muted/50 p-3 text-sm space-y-1">
          <div>
            <span className="text-muted-foreground">Kandidaat:</span>{' '}
            <strong>{candidateName}</strong>
          </div>
          <div>
            <span className="text-muted-foreground">Opdrachtgever:</span>{' '}
            <strong>{companyName}</strong>
          </div>
          <div>
            <span className="text-muted-foreground">Functie:</span>{' '}
            <strong>{functionName}</strong>
          </div>
          <div>
            <span className="text-muted-foreground">Startdatum:</span>{' '}
            <strong>{startDate}</strong>
          </div>
        </div>

        {/* Warnings */}
        {(missingEmail || missingPhone) && (
          <div className="flex flex-wrap gap-2">
            {missingEmail && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Geen e-mailadres kandidaat
              </Badge>
            )}
            {missingPhone && (
              <Badge variant="secondary" className="gap-1 border-orange-300 bg-orange-50 text-orange-700">
                <AlertTriangle className="h-3 w-3" />
                Geen telefoonnummer kandidaat
              </Badge>
            )}
          </div>
        )}

        {/* Recipient checkboxes */}
        {!result && (
          <div className="space-y-3">
            <Label className="text-sm font-medium">Ontvangers</Label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="send-client"
                  checked={sendToClient}
                  onCheckedChange={(v) => setSendToClient(v === true)}
                />
                <label htmlFor="send-client" className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                  Email naar opdrachtgever ({companyName})
                </label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="send-employee"
                  checked={sendToEmployee && !missingEmail}
                  onCheckedChange={(v) => setSendToEmployee(v === true)}
                  disabled={missingEmail}
                />
                <label
                  htmlFor="send-employee"
                  className={`flex items-center gap-1.5 text-sm cursor-pointer ${missingEmail ? 'text-muted-foreground line-through' : ''}`}
                >
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                  Email naar medewerker ({candidateName})
                  {missingEmail && <span className="text-xs text-destructive ml-1">(geen e-mail)</span>}
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Preview tabs (shown after sending) */}
        {result && (result.client_email || result.employee_email) && (
          <Tabs defaultValue={result.client_email ? 'client' : 'employee'} className="w-full">
            <TabsList className="w-full">
              {result.client_email && (
                <TabsTrigger value="client" className="flex-1 gap-1">
                  <Building2 className="h-3.5 w-3.5" />
                  Opdrachtgever
                </TabsTrigger>
              )}
              {result.employee_email && (
                <TabsTrigger value="employee" className="flex-1 gap-1">
                  <User className="h-3.5 w-3.5" />
                  Medewerker
                </TabsTrigger>
              )}
            </TabsList>
            {result.client_email && (
              <TabsContent value="client" className="space-y-2">
                <div className="text-xs text-muted-foreground space-y-1">
                  <div><strong>Aan:</strong> {result.client_email.to}</div>
                  <div><strong>Onderwerp:</strong> {result.client_email.subject}</div>
                </div>
                <HtmlPreview html={result.client_email.html} />
              </TabsContent>
            )}
            {result.employee_email && (
              <TabsContent value="employee" className="space-y-2">
                <div className="text-xs text-muted-foreground space-y-1">
                  <div><strong>Aan:</strong> {result.employee_email.to}</div>
                  <div><strong>Onderwerp:</strong> {result.employee_email.subject}</div>
                </div>
                <HtmlPreview html={result.employee_email.html} />
              </TabsContent>
            )}
          </Tabs>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="ghost" onClick={handleClose}>
            {result ? 'Sluiten' : 'Overslaan'}
          </Button>
          {!result && (
            <Button onClick={handleSend} disabled={sending || (!sendToClient && !sendToEmployee)}>
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
