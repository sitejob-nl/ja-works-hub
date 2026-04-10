// src/components/whatsapp/InteractiveMessageBuilder.tsx
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Loader2, Plus, Trash2, Send } from 'lucide-react';
import { toast } from 'sonner';

export interface InteractivePayload {
  type: 'button' | 'list';
  body: string;
  footer?: string;
  // For buttons:
  buttons?: Array<{ id: string; title: string }>;
  // For lists:
  button_text?: string;
  sections?: Array<{
    title: string;
    rows: Array<{ id: string; title: string; description?: string }>;
  }>;
}

interface InteractiveMessageBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (payload: InteractivePayload) => void;
  isSending: boolean;
}

function ButtonMode({
  body, setBody,
  footer, setFooter,
  buttons, setButtons,
}: {
  body: string; setBody: (v: string) => void;
  footer: string; setFooter: (v: string) => void;
  buttons: Array<{ id: string; title: string }>;
  setButtons: (v: Array<{ id: string; title: string }>) => void;
}) {
  const addButton = () => {
    if (buttons.length >= 3) return;
    const next = buttons.length + 1;
    setButtons([...buttons, { id: `btn_${next}`, title: '' }]);
  };

  const removeButton = (idx: number) => {
    const updated = buttons.filter((_, i) => i !== idx);
    // Re-assign ids in order
    setButtons(updated.map((b, i) => ({ ...b, id: `btn_${i + 1}` })));
  };

  const updateTitle = (idx: number, title: string) => {
    setButtons(buttons.map((b, i) => i === idx ? { ...b, title: title.slice(0, 20) } : b));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Berichttekst <span className="text-destructive">*</span></Label>
        <Textarea
          placeholder="Typ de berichttekst..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label>Footer (optioneel)</Label>
        <Input
          placeholder="Voettekst onder het bericht"
          value={footer}
          onChange={(e) => setFooter(e.target.value)}
          maxLength={60}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Knoppen (max 3)</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addButton}
            disabled={buttons.length >= 3}
          >
            <Plus className="h-3 w-3 mr-1" />
            Knop toevoegen
          </Button>
        </div>
        <div className="space-y-2">
          {buttons.map((btn, idx) => (
            <div key={btn.id} className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-10 shrink-0">{btn.id}</span>
              <Input
                placeholder={`Knoptekst (max 20)`}
                value={btn.title}
                onChange={(e) => updateTitle(idx, e.target.value)}
                maxLength={20}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-8 text-right shrink-0">
                {btn.title.length}/20
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => removeButton(idx)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>
          ))}
          {buttons.length === 0 && (
            <p className="text-xs text-muted-foreground">Voeg minimaal 1 knop toe.</p>
          )}
        </div>
      </div>
    </div>
  );
}

interface ListSection {
  title: string;
  rows: Array<{ id: string; title: string; description: string }>;
}

function ListMode({
  body, setBody,
  buttonText, setButtonText,
  footer, setFooter,
  sections, setSections,
}: {
  body: string; setBody: (v: string) => void;
  buttonText: string; setButtonText: (v: string) => void;
  footer: string; setFooter: (v: string) => void;
  sections: ListSection[];
  setSections: (v: ListSection[]) => void;
}) {
  const addSection = () => {
    setSections([...sections, { title: '', rows: [] }]);
  };

  const removeSection = (si: number) => {
    setSections(sections.filter((_, i) => i !== si));
  };

  const updateSectionTitle = (si: number, title: string) => {
    setSections(sections.map((s, i) => i === si ? { ...s, title } : s));
  };

  const addRow = (si: number) => {
    const rowCount = sections[si].rows.length + 1;
    const newRow = { id: `row_${si + 1}_${rowCount}`, title: '', description: '' };
    setSections(sections.map((s, i) => i === si ? { ...s, rows: [...s.rows, newRow] } : s));
  };

  const removeRow = (si: number, ri: number) => {
    setSections(sections.map((s, i) => {
      if (i !== si) return s;
      const updated = s.rows.filter((_, j) => j !== ri);
      // Re-assign ids
      return { ...s, rows: updated.map((r, j) => ({ ...r, id: `row_${i + 1}_${j + 1}` })) };
    }));
  };

  const updateRow = (si: number, ri: number, field: 'title' | 'description', value: string) => {
    const maxLen = field === 'title' ? 24 : 72;
    setSections(sections.map((s, i) => {
      if (i !== si) return s;
      return {
        ...s,
        rows: s.rows.map((r, j) => j === ri ? { ...r, [field]: value.slice(0, maxLen) } : r),
      };
    }));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Berichttekst <span className="text-destructive">*</span></Label>
        <Textarea
          placeholder="Typ de berichttekst..."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
        />
      </div>

      <div className="space-y-2">
        <Label>Lijsttekst (knoptekst) <span className="text-destructive">*</span></Label>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Bijv. 'Bekijk opties'"
            value={buttonText}
            onChange={(e) => setButtonText(e.target.value.slice(0, 20))}
            maxLength={20}
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground w-10 text-right shrink-0">
            {buttonText.length}/20
          </span>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Footer (optioneel)</Label>
        <Input
          placeholder="Voettekst onder het bericht"
          value={footer}
          onChange={(e) => setFooter(e.target.value)}
          maxLength={60}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Secties</Label>
          <Button type="button" variant="outline" size="sm" onClick={addSection}>
            <Plus className="h-3 w-3 mr-1" />
            Sectie toevoegen
          </Button>
        </div>

        {sections.length === 0 && (
          <p className="text-xs text-muted-foreground">Voeg minimaal 1 sectie toe.</p>
        )}

        {sections.map((section, si) => (
          <div key={si} className="border rounded-md p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Input
                placeholder={`Sectietitel ${si + 1}`}
                value={section.title}
                onChange={(e) => updateSectionTitle(si, e.target.value)}
                className="flex-1 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => removeSection(si)}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </Button>
            </div>

            <div className="space-y-2 pl-2">
              {section.rows.map((row, ri) => (
                <div key={row.id} className="space-y-1 border-l-2 pl-2">
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Rij titel (max 24)"
                      value={row.title}
                      onChange={(e) => updateRow(si, ri, 'title', e.target.value)}
                      maxLength={24}
                      className="flex-1 text-sm h-8"
                    />
                    <span className="text-xs text-muted-foreground w-10 text-right shrink-0">
                      {row.title.length}/24
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => removeRow(si, ri)}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      placeholder="Beschrijving (optioneel, max 72)"
                      value={row.description}
                      onChange={(e) => updateRow(si, ri, 'description', e.target.value)}
                      maxLength={72}
                      className="flex-1 text-sm h-8"
                    />
                    <span className="text-xs text-muted-foreground w-10 text-right shrink-0">
                      {row.description.length}/72
                    </span>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => addRow(si)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Rij toevoegen
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ButtonPreview({ body, footer, buttons }: {
  body: string;
  footer?: string;
  buttons: Array<{ id: string; title: string }>;
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 max-w-xs space-y-2 text-sm">
      {body ? (
        <p className="whitespace-pre-wrap text-sm">{body}</p>
      ) : (
        <p className="text-muted-foreground italic text-xs">Berichttekst...</p>
      )}
      {footer && <p className="text-xs text-muted-foreground">{footer}</p>}
      {buttons.length > 0 && (
        <>
          <Separator />
          <div className="space-y-1">
            {buttons.map((btn) => (
              <div
                key={btn.id}
                className="rounded border bg-background px-2 py-1 text-center text-xs font-medium text-primary"
              >
                {btn.title || <span className="text-muted-foreground italic">Knoptekst...</span>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ListPreview({ body, footer, buttonText, sections }: {
  body: string;
  footer?: string;
  buttonText: string;
  sections: ListSection[];
}) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3 max-w-xs space-y-2 text-sm">
      {body ? (
        <p className="whitespace-pre-wrap text-sm">{body}</p>
      ) : (
        <p className="text-muted-foreground italic text-xs">Berichttekst...</p>
      )}
      {footer && <p className="text-xs text-muted-foreground">{footer}</p>}
      <Separator />
      <div className="rounded border bg-background px-2 py-1 text-center text-xs font-medium text-primary flex items-center justify-center gap-1">
        <span>&#9776;</span>
        <span>{buttonText || <span className="text-muted-foreground italic">Lijsttekst...</span>}</span>
      </div>
      {sections.map((s, si) => (
        <div key={si} className="space-y-1">
          {s.title && <p className="text-xs font-semibold text-muted-foreground uppercase">{s.title}</p>}
          {s.rows.map((r) => (
            <div key={r.id} className="rounded bg-background border px-2 py-1">
              <p className="text-xs font-medium">{r.title || <span className="italic text-muted-foreground">Rij titel...</span>}</p>
              {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function InteractiveMessageBuilder({
  open,
  onOpenChange,
  onSend,
  isSending,
}: InteractiveMessageBuilderProps) {
  const [mode, setMode] = useState<'button' | 'list'>('button');

  // Button mode state
  const [btnBody, setBtnBody] = useState('');
  const [btnFooter, setBtnFooter] = useState('');
  const [buttons, setButtons] = useState<Array<{ id: string; title: string }>>([
    { id: 'btn_1', title: '' },
  ]);

  // List mode state
  const [listBody, setListBody] = useState('');
  const [listButtonText, setListButtonText] = useState('');
  const [listFooter, setListFooter] = useState('');
  const [sections, setSections] = useState<ListSection[]>([
    { title: '', rows: [] },
  ]);

  const handleReset = () => {
    setBtnBody(''); setBtnFooter('');
    setButtons([{ id: 'btn_1', title: '' }]);
    setListBody(''); setListButtonText(''); setListFooter('');
    setSections([{ title: '', rows: [] }]);
  };

  const handleClose = (v: boolean) => {
    if (!v) handleReset();
    onOpenChange(v);
  };

  const handleSend = () => {
    if (mode === 'button') {
      if (!btnBody.trim()) {
        toast.error('Vul de berichttekst in');
        return;
      }
      const validButtons = buttons.filter((b) => b.title.trim());
      if (validButtons.length === 0) {
        toast.error('Voeg minimaal 1 knop toe met tekst');
        return;
      }
      onSend({
        type: 'button',
        body: btnBody.trim(),
        footer: btnFooter.trim() || undefined,
        buttons: validButtons,
      });
    } else {
      if (!listBody.trim()) {
        toast.error('Vul de berichttekst in');
        return;
      }
      if (!listButtonText.trim()) {
        toast.error('Vul de lijsttekst in');
        return;
      }
      if (sections.length === 0) {
        toast.error('Voeg minimaal 1 sectie toe');
        return;
      }
      const validSections = sections
        .map((s) => ({
          ...s,
          rows: s.rows.filter((r) => r.title.trim()),
        }))
        .filter((s) => s.rows.length > 0);

      if (validSections.length === 0) {
        toast.error('Voeg minimaal 1 rij met titel toe aan een sectie');
        return;
      }
      onSend({
        type: 'list',
        body: listBody.trim(),
        footer: listFooter.trim() || undefined,
        button_text: listButtonText.trim(),
        sections: validSections.map((s) => ({
          title: s.title,
          rows: s.rows.map((r) => ({
            id: r.id,
            title: r.title,
            description: r.description.trim() || undefined,
          })),
        })),
      });
    }
    handleReset();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl w-full p-0 gap-0">
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle>Interactief bericht</DialogTitle>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(v) => setMode(v as 'button' | 'list')}
          className="flex flex-col flex-1 min-h-0"
        >
          <div className="px-6">
            <TabsList className="w-full">
              <TabsTrigger value="button" className="flex-1">Knoppen</TabsTrigger>
              <TabsTrigger value="list" className="flex-1">Lijst</TabsTrigger>
            </TabsList>
          </div>

          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left: form */}
            <ScrollArea className="flex-1 min-w-0">
              <div className="px-6 py-4">
                <TabsContent value="button" className="mt-0">
                  <ButtonMode
                    body={btnBody} setBody={setBtnBody}
                    footer={btnFooter} setFooter={setBtnFooter}
                    buttons={buttons} setButtons={setButtons}
                  />
                </TabsContent>
                <TabsContent value="list" className="mt-0">
                  <ListMode
                    body={listBody} setBody={setListBody}
                    buttonText={listButtonText} setButtonText={setListButtonText}
                    footer={listFooter} setFooter={setListFooter}
                    sections={sections} setSections={setSections}
                  />
                </TabsContent>
              </div>
            </ScrollArea>

            {/* Right: preview */}
            <div className="w-56 shrink-0 border-l bg-muted/20 p-4 flex flex-col gap-3 hidden sm:flex">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Voorbeeld
              </p>
              {mode === 'button' ? (
                <ButtonPreview body={btnBody} footer={btnFooter} buttons={buttons} />
              ) : (
                <ListPreview
                  body={listBody}
                  footer={listFooter}
                  buttonText={listButtonText}
                  sections={sections}
                />
              )}
            </div>
          </div>
        </Tabs>

        <DialogFooter className="px-6 py-4 border-t">
          <Button variant="outline" onClick={() => handleClose(false)} disabled={isSending}>
            Annuleren
          </Button>
          <Button onClick={handleSend} disabled={isSending}>
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Versturen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
