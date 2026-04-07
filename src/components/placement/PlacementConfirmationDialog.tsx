import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Mail, AlertTriangle, Building2, User, Loader2, Home, Navigation, Users, MapPin } from 'lucide-react';
import { sendPlacementConfirmation, getHousingSuggestions, type PlacementConfirmationResult, type HousingSuggestion } from './PlacementTriggers';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { logAudit } from '@/lib/audit';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placementId: string;
  candidateId: string;
  candidateName: string;
  candidateEmail: string | null;
  candidatePhone: string | null;
  companyId: string;
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

const PlacementConfirmationDialog = ({
  open,
  onOpenChange,
  placementId,
  candidateId,
  candidateName,
  candidateEmail,
  candidatePhone,
  companyId,
  companyName,
  functionName,
  startDate,
}: Props) => {
  const orgId = useOrganizationId();
  const [sendToClient, setSendToClient] = useState(true);
  const [sendToEmployee, setSendToEmployee] = useState(true);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<PlacementConfirmationResult | null>(null);

  // Housing auto-assign state
  const [suggestions, setSuggestions] = useState<HousingSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState<string | ''>('');
  const [noHousingNeeded, setNoHousingNeeded] = useState(false);
  const [assigningHousing, setAssigningHousing] = useState(false);

  const missingEmail = !candidateEmail;
  const missingPhone = !candidatePhone;

  // Load housing suggestions when dialog opens
  useEffect(() => {
    if (!open || !companyId || !orgId) return;
    let cancelled = false;

    const load = async () => {
      setLoadingSuggestions(true);
      try {
        const { data: company } = await supabase
          .from('companies')
          .select('address_lat, address_lng')
          .eq('id', companyId)
          .single();

        const results = await getHousingSuggestions(
          orgId, companyId, company?.address_lat, company?.address_lng,
        );
        if (!cancelled) {
          setSuggestions(results);
          if (results.length > 0) setSelectedUnitId(results[0].unitId);
        }
      } catch {
        // Non-critical
      } finally {
        if (!cancelled) setLoadingSuggestions(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [open, companyId, orgId]);

  const selectedSuggestion = suggestions.find(s => s.unitId === selectedUnitId);

  const handleAssignHousing = async () => {
    if (noHousingNeeded || !selectedSuggestion) return;
    setAssigningHousing(true);
    try {
      const { data: assignment, error } = await supabase.from('housing_assignments').insert({
        organization_id: orgId,
        unit_id: selectedSuggestion.unitId,
        candidate_id: candidateId,
        check_in_date: startDate,
        status: 'ingecheckt' as any,
        deduction_amount: selectedSuggestion.weeklyCost ?? selectedSuggestion.monthlyCost,
        payment_frequency: selectedSuggestion.weeklyCost ? 'wekelijks' : 'maandelijks',
        monthly_deduction: selectedSuggestion.monthlyCost,
      }).select('id').single();
      if (error) throw error;

      await supabase.from('placements')
        .update({ housing_assignment_id: assignment.id })
        .eq('id', placementId);

      logAudit({
        action: 'create',
        tableName: 'housing_assignments',
        recordId: assignment.id,
        newValues: { unit_id: selectedSuggestion.unitId, unit_name: selectedSuggestion.unitName, candidate_id: candidateId },
      });
      toast.success(`Huisvesting toegewezen: ${selectedSuggestion.unitName}`);
    } catch (e: any) {
      toast.error(`Huisvesting toewijzen mislukt: ${e.message}`);
    } finally {
      setAssigningHousing(false);
    }
  };

  const handleSend = async () => {
    if (!sendToClient && !sendToEmployee) {
      toast.warning('Selecteer minimaal een ontvanger');
      return;
    }
    if (sendToEmployee && missingEmail) {
      toast.error('Kandidaat heeft geen e-mailadres');
      return;
    }

    // Assign housing first (if selected)
    if (!noHousingNeeded && selectedSuggestion) {
      await handleAssignHousing();
    }

    setSending(true);
    try {
      const res = await sendPlacementConfirmation(placementId, sendToClient, sendToEmployee);
      setResult(res);
      if (res.warnings?.length > 0) res.warnings.forEach((w) => toast.warning(w));
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
    setSuggestions([]);
    setSelectedUnitId('');
    setNoHousingNeeded(false);
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
          <div><span className="text-muted-foreground">Kandidaat:</span> <strong>{candidateName}</strong></div>
          <div><span className="text-muted-foreground">Opdrachtgever:</span> <strong>{companyName}</strong></div>
          <div><span className="text-muted-foreground">Functie:</span> <strong>{functionName}</strong></div>
          <div><span className="text-muted-foreground">Startdatum:</span> <strong>{startDate}</strong></div>
        </div>

        {/* Housing auto-assign section */}
        {!result && (
          <div className="rounded-md border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium flex items-center gap-1.5">
                <Home className="h-4 w-4" /> Huisvesting
              </h4>
              <div className="flex items-center gap-2">
                <Checkbox id="no-housing" checked={noHousingNeeded} onCheckedChange={(v) => setNoHousingNeeded(v === true)} />
                <label htmlFor="no-housing" className="text-xs text-muted-foreground cursor-pointer">Geen huisvesting nodig</label>
              </div>
            </div>

            {loadingSuggestions && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Suggesties laden...
              </div>
            )}

            {!loadingSuggestions && !noHousingNeeded && suggestions.length === 0 && (
              <p className="text-xs text-muted-foreground">Geen beschikbare kamers gevonden.</p>
            )}

            {!loadingSuggestions && !noHousingNeeded && suggestions.length > 0 && (
              <>
                {selectedSuggestion && (
                  <div className="rounded-md bg-primary/5 border-primary/20 border p-2.5 text-sm">
                    <div className="font-medium">{selectedSuggestion.unitName} — {selectedSuggestion.propertyName}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1 flex-wrap">
                      {selectedSuggestion.distanceKm != null && (
                        <span className="flex items-center gap-0.5 text-primary font-medium">
                          <Navigation className="h-3 w-3" /> {selectedSuggestion.distanceKm} km
                          {selectedSuggestion.durationMin != null && ` \u00b7 ${selectedSuggestion.durationMin} min`}
                        </span>
                      )}
                      <span className="flex items-center gap-0.5"><MapPin className="h-3 w-3" /> {selectedSuggestion.propertyCity}</span>
                      <span>{selectedSuggestion.currentOccupancy}/{selectedSuggestion.capacity} bezet</span>
                      {selectedSuggestion.colleagueCount > 0 && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1 gap-0.5">
                          <Users className="h-2.5 w-2.5" /> {selectedSuggestion.colleagueCount} collega{selectedSuggestion.colleagueCount > 1 ? "'s" : ''}
                        </Badge>
                      )}
                      {selectedSuggestion.weeklyCost != null ? (
                        <span>\u20ac{selectedSuggestion.weeklyCost}/week</span>
                      ) : selectedSuggestion.monthlyCost != null ? (
                        <span>\u20ac{selectedSuggestion.monthlyCost}/mnd</span>
                      ) : null}
                    </div>
                  </div>
                )}

                {suggestions.length > 1 && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Wijzig kamer</Label>
                    <Select value={selectedUnitId} onValueChange={setSelectedUnitId}>
                      <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {suggestions.map(s => (
                          <SelectItem key={s.unitId} value={s.unitId}>
                            {s.unitName} — {s.propertyName}{s.distanceKm != null ? ` (${s.distanceKm} km)` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Warnings */}
        {(missingEmail || missingPhone) && (
          <div className="flex flex-wrap gap-2">
            {missingEmail && (
              <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Geen e-mailadres kandidaat</Badge>
            )}
            {missingPhone && (
              <Badge variant="secondary" className="gap-1 border-orange-300 bg-orange-50 text-orange-700"><AlertTriangle className="h-3 w-3" />Geen telefoonnummer kandidaat</Badge>
            )}
          </div>
        )}

        {/* Recipient checkboxes */}
        {!result && (
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

        {/* Preview tabs (shown after sending) */}
        {result && (result.client_email || result.employee_email) && (
          <Tabs defaultValue={result.client_email ? 'client' : 'employee'} className="w-full">
            <TabsList className="w-full">
              {result.client_email && <TabsTrigger value="client" className="flex-1 gap-1"><Building2 className="h-3.5 w-3.5" />Opdrachtgever</TabsTrigger>}
              {result.employee_email && <TabsTrigger value="employee" className="flex-1 gap-1"><User className="h-3.5 w-3.5" />Medewerker</TabsTrigger>}
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
          <Button variant="ghost" onClick={handleClose}>{result ? 'Sluiten' : 'Overslaan'}</Button>
          {!result && (
            <Button onClick={handleSend} disabled={sending || assigningHousing || (!sendToClient && !sendToEmployee)}>
              {(sending || assigningHousing) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {sending ? 'Versturen...' : assigningHousing ? 'Toewijzen...' : 'Versturen'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default PlacementConfirmationDialog;
