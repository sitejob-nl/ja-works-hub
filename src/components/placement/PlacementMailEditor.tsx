import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Building2, Loader2, User } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOutlookAccounts } from '@/hooks/useOutlookAccounts';
import {
  previewPlacementConfirmation,
  type PlacementConfirmationResult,
  type PlacementMailEdits,
} from './PlacementTriggers';

/** HTML-preview van de server-gegenereerde mail in een sandboxed iframe (defense-in-depth). */
function HtmlPreview({ html }: { html: string }) {
  return (
    <iframe
      sandbox=""
      srcDoc={html}
      className="border rounded-md w-full bg-white"
      style={{ height: 320 }}
      title="E-mailvoorbeeld"
    />
  );
}

const splitEmails = (value: string): string[] =>
  value.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);

interface Props {
  /** Wizard-modus: plaatsing bestaat nog niet. */
  placementData?: Record<string, unknown>;
  /** Detailmodus: bestaande plaatsing opnieuw versturen. */
  placementId?: string;
  active: boolean;
  candidateName: string;
  companyName: string;
  missingEmail: boolean;
  missingPhone?: boolean;
  sendToClient: boolean;
  sendToEmployee: boolean;
  onSendToClientChange: (v: boolean) => void;
  onSendToEmployeeChange: (v: boolean) => void;
  edits: PlacementMailEdits;
  onEditsChange: (edits: PlacementMailEdits) => void;
}

/**
 * Bewerkbare bevestigingsmails vóór het plaatsen — dezelfde vrijheid als bij een voorstel:
 * afzender, ontvangers, onderwerp en tekst.
 *
 * De gebruiker bewerkt platte tékst; de server rendert die in de huisstijl-frame. Zo kan er
 * geen ruwe HTML uit de UI in de mail belanden en blijft de opmaak altijd consistent.
 */
const PlacementMailEditor = ({
  placementData, placementId, active, candidateName, companyName,
  missingEmail, missingPhone, sendToClient, sendToEmployee,
  onSendToClientChange, onSendToEmployeeChange, edits, onEditsChange,
}: Props) => {
  const { usableAccounts, defaultAccountId } = useOutlookAccounts('mail_send');
  const personalAccounts = usableAccounts.filter((a) => a.scope === 'personal');
  const orgAccounts = usableAccounts.filter((a) => a.scope === 'organization');

  const [preview, setPreview] = useState<PlacementConfirmationResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [dataChangedWhileEditing, setDataChangedWhileEditing] = useState(false);
  const [showCc, setShowCc] = useState(false);

  // Welke velden de gebruiker zelf heeft aangeraakt — die overschrijven we nooit
  // met een verse servertekst.
  const dirty = useRef<Set<string>>(new Set());

  const editsRef = useRef(edits);
  editsRef.current = edits;
  const onEditsChangeRef = useRef(onEditsChange);
  onEditsChangeRef.current = onEditsChange;

  // Verandert de plaatsing zelf (tarief, locatie, datum), dan moet het voorbeeld opnieuw —
  // eerder bleef een verouderd voorbeeld staan omdat alleen [step] in de deps zat.
  const baselineKey = useMemo(
    () => JSON.stringify({ placementData, placementId, sendToClient, sendToEmployee }),
    [placementData, placementId, sendToClient, sendToEmployee],
  );

  const markDirty = (field: string) => dirty.current.add(field);

  const patch = useCallback((next: Partial<PlacementMailEdits>) => {
    onEditsChangeRef.current({ ...editsRef.current, ...next });
  }, []);

  useEffect(() => {
    if (!active || !defaultAccountId) return;
    if (!editsRef.current.accountId) patch({ accountId: defaultAccountId });
  }, [active, defaultAccountId, patch]);

  // ── Basisvoorbeeld: zonder bewerkingen, om de begintekst op te halen ──
  useEffect(() => {
    if (!active) return;
    if (!sendToClient && !sendToEmployee) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    previewPlacementConfirmation({ placementId, placementData, sendToClient, sendToEmployee })
      .then((res) => {
        if (cancelled) return;
        setPreview(res);
        const next: Partial<PlacementMailEdits> = {};
        let discarded = false;
        const seed = (field: keyof PlacementMailEdits, value: string | undefined) => {
          if (value === undefined) return;
          if (dirty.current.has(field)) discarded = true;
          else next[field] = value as never;
        };
        seed('clientSubject', res.client_email?.subject);
        seed('clientBody', res.client_email?.body_text);
        seed('employeeSubject', res.employee_email?.subject);
        seed('employeeBody', res.employee_email?.body_text);
        if (Object.keys(next).length > 0) patch(next);
        setDataChangedWhileEditing(discarded);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(e.message);
      })
      .finally(() => { if (!cancelled) setPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [active, baselineKey, patch]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Voorbeeld verversen ná bewerking (debounced) ──
  const editSignature = JSON.stringify({
    cs: edits.clientSubject, cb: edits.clientBody,
    es: edits.employeeSubject, eb: edits.employeeBody,
    to: edits.clientTo, cc: edits.clientCc, bcc: edits.clientBcc,
  });

  useEffect(() => {
    if (!active || dirty.current.size === 0) return;
    if (!sendToClient && !sendToEmployee) return;
    const handle = setTimeout(() => {
      previewPlacementConfirmation({
        placementId, placementData, sendToClient, sendToEmployee, edits: editsRef.current,
      })
        .then((res) => {
          // Alleen de weergave bijwerken — nooit de tekst die de gebruiker aan het typen is.
          setPreview(res);
          setPreviewError(null);
        })
        .catch((e: any) => setPreviewError(e.message));
    }, 600);
    return () => clearTimeout(handle);
  }, [active, editSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!active) return null;

  return (
    <div className="space-y-4">
      {(missingEmail || missingPhone) && (
        <div className="flex flex-wrap gap-2">
          {missingEmail && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Geen e-mailadres kandidaat</Badge>}
          {missingPhone && <Badge variant="destructive" className="gap-1"><AlertTriangle className="h-3 w-3" />Telefoonnummer kandidaat ontbreekt</Badge>}
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-sm font-medium">Bevestigingsmails</Label>
        <div className="flex items-center gap-2">
          <Checkbox id="send-client" checked={sendToClient} onCheckedChange={(v) => onSendToClientChange(v === true)} />
          <label htmlFor="send-client" className="flex items-center gap-1.5 text-sm cursor-pointer">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />E-mail naar opdrachtgever ({companyName})
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="send-employee" checked={sendToEmployee && !missingEmail} onCheckedChange={(v) => onSendToEmployeeChange(v === true)} disabled={missingEmail} />
          <label htmlFor="send-employee" className={`flex items-center gap-1.5 text-sm cursor-pointer ${missingEmail ? 'text-muted-foreground line-through' : ''}`}>
            <User className="h-3.5 w-3.5 text-muted-foreground" />E-mail naar medewerker ({candidateName})
            {missingEmail && <span className="text-xs text-destructive ml-1">(geen e-mail)</span>}
          </label>
        </div>
      </div>

      {usableAccounts.length > 1 && (sendToClient || sendToEmployee) && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Afzender</Label>
          <Select value={edits.accountId ?? undefined} onValueChange={(v) => patch({ accountId: v })}>
            <SelectTrigger><SelectValue placeholder="Kies afzender-mailbox" /></SelectTrigger>
            <SelectContent>
              {personalAccounts.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Persoonlijk</SelectLabel>
                  {personalAccounts.map((a) => (
                    <SelectItem key={a.account_id} value={a.account_id}>{a.label || a.email || 'Persoonlijke mailbox'}</SelectItem>
                  ))}
                </SelectGroup>
              )}
              {orgAccounts.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Bedrijf</SelectLabel>
                  {orgAccounts.map((a) => (
                    <SelectItem key={a.account_id} value={a.account_id}>{a.label || a.email || 'Bedrijfsmailbox'}</SelectItem>
                  ))}
                </SelectGroup>
              )}
            </SelectContent>
          </Select>
        </div>
      )}

      {dataChangedWhileEditing && (
        <div className="rounded-md border border-orange-200 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-900 p-2.5 text-xs text-orange-800 dark:text-orange-300 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            Je hebt gegevens van de plaatsing aangepast. Je eigen mailtekst is bewaard gebleven — controleer of die nog klopt.
          </span>
        </div>
      )}

      {previewLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2"><Loader2 className="h-4 w-4 animate-spin" /> Voorbeeld genereren...</div>
      )}

      {previewError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-destructive"><AlertTriangle className="h-4 w-4" /> Voorbeeld niet beschikbaar</div>
          <p className="mt-1 text-xs text-muted-foreground">{previewError}</p>
          <p className="mt-1 text-xs text-muted-foreground">Controleer de e-mailtemplates onder Instellingen → HR &amp; documenten.</p>
        </div>
      )}

      {!previewLoading && preview && (preview.client_email || preview.employee_email) && (
        <Tabs defaultValue={preview.client_email ? 'client' : 'employee'} className="w-full">
          <TabsList className="w-full">
            {preview.client_email && <TabsTrigger value="client" className="flex-1 gap-1"><Building2 className="h-3.5 w-3.5" />Opdrachtgever</TabsTrigger>}
            {preview.employee_email && <TabsTrigger value="employee" className="flex-1 gap-1"><User className="h-3.5 w-3.5" />Medewerker</TabsTrigger>}
          </TabsList>

          {preview.client_email && (
            <TabsContent value="client" className="space-y-3 pt-2">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Aan</Label>
                  <Input
                    className="mt-1"
                    value={edits.clientTo ?? preview.client_email.to}
                    onChange={(e) => { markDirty('clientTo'); patch({ clientTo: e.target.value }); }}
                  />
                </div>
                <div className="flex items-end">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowCc((v) => !v)}>
                    {showCc ? 'CC/BCC verbergen' : 'CC/BCC toevoegen'}
                  </Button>
                </div>
              </div>
              {showCc && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">CC</Label>
                    <Input className="mt-1" placeholder="naam@bedrijf.nl, ..." value={(edits.clientCc ?? []).join(', ')}
                      onChange={(e) => { markDirty('clientCc'); patch({ clientCc: splitEmails(e.target.value) }); }} />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">BCC</Label>
                    <Input className="mt-1" placeholder="naam@bedrijf.nl, ..." value={(edits.clientBcc ?? []).join(', ')}
                      onChange={(e) => { markDirty('clientBcc'); patch({ clientBcc: splitEmails(e.target.value) }); }} />
                  </div>
                </div>
              )}
              <div>
                <Label className="text-xs text-muted-foreground">Onderwerp</Label>
                <Input className="mt-1" value={edits.clientSubject ?? ''}
                  onChange={(e) => { markDirty('clientSubject'); patch({ clientSubject: e.target.value }); }} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Tekst</Label>
                <Textarea className="mt-1 font-mono text-xs" rows={10} value={edits.clientBody ?? ''}
                  onChange={(e) => { markDirty('clientBody'); patch({ clientBody: e.target.value }); }} />
                <p className="mt-1 text-xs text-muted-foreground">
                  Regels als “Functie: Lasser” worden als gegevenstabel opgemaakt. Lege waarden vallen weg.
                </p>
              </div>
              <HtmlPreview html={preview.client_email.html} />
            </TabsContent>
          )}

          {preview.employee_email && (
            <TabsContent value="employee" className="space-y-3 pt-2">
              <div className="text-xs text-muted-foreground"><strong>Aan:</strong> {preview.employee_email.to}</div>
              <div>
                <Label className="text-xs text-muted-foreground">Onderwerp</Label>
                <Input className="mt-1" value={edits.employeeSubject ?? ''}
                  onChange={(e) => { markDirty('employeeSubject'); patch({ employeeSubject: e.target.value }); }} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Tekst</Label>
                <Textarea className="mt-1 font-mono text-xs" rows={10} value={edits.employeeBody ?? ''}
                  onChange={(e) => { markDirty('employeeBody'); patch({ employeeBody: e.target.value }); }} />
              </div>
              <HtmlPreview html={preview.employee_email.html} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </div>
  );
};

export default PlacementMailEditor;
