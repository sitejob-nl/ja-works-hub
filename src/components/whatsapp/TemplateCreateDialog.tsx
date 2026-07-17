import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, X, Phone, Link } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWhatsAppMutation } from '@/hooks/useWhatsAppApi';

interface TemplateCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Button {
  type: 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER';
  text: string;
  url?: string;
  phone_number?: string;
}

const LANGUAGES = [
  { value: 'nl', label: 'Nederlands (NL)' },
  { value: 'en', label: 'Engels (EN)' },
  { value: 'pl', label: 'Pools (PL)' },
  { value: 'ro', label: 'Roemeens (RO)' },
  { value: 'de', label: 'Duits (DE)' },
  { value: 'fr', label: 'Frans (FR)' },
  { value: 'es', label: 'Spaans (ES)' },
  { value: 'pt_PT', label: 'Portugees (PT)' },
  { value: 'pt_BR', label: 'Braziliaans Portugees (BR)' },
  { value: 'uk', label: 'Oekraïens (UK)' },
  { value: 'ru', label: 'Russisch (RU)' },
];

function extractVariableIndices(text: string): string[] {
  const matches = text.match(/\{\{(\d+)\}\}/g) ?? [];
  const indices = matches.map((m) => m.replace(/\{\{|\}\}/g, ''));
  return [...new Set(indices)].sort((a, b) => Number(a) - Number(b));
}

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function WhatsAppPreview({
  headerType,
  headerText,
  body,
  footer,
  buttons,
  bodyExamples,
}: {
  headerType: string;
  headerText: string;
  body: string;
  footer: string;
  buttons: Button[];
  bodyExamples: Record<string, string>;
}) {
  const previewBody = body.replace(/\{\{(\d+)\}\}/g, (_, n) => bodyExamples[n] || `{{${n}}}`);

  return (
    <div className="bg-[#e5ddd5] dark:bg-[#0b141a] rounded-lg p-3 min-h-[200px]">
      <div className="max-w-[260px] ml-auto">
        {/* Message bubble */}
        <div className="bg-white dark:bg-[#202c33] rounded-lg shadow-sm overflow-hidden">
          {/* Header */}
          {headerType === 'TEXT' && headerText && (
            <div className="px-3 pt-3 pb-1">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{headerText}</p>
            </div>
          )}
          {(headerType === 'IMAGE' || headerType === 'VIDEO' || headerType === 'DOCUMENT') && (
            <div className="bg-gray-200 dark:bg-gray-700 h-24 flex items-center justify-center">
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {headerType === 'IMAGE' ? 'Afbeelding' : headerType === 'VIDEO' ? 'Video' : 'Document'}
              </span>
            </div>
          )}

          {/* Body */}
          <div className="px-3 py-2">
            {previewBody ? (
              <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{previewBody}</p>
            ) : (
              <p className="text-sm text-gray-400 italic">Bodytekst...</p>
            )}
          </div>

          {/* Footer */}
          {footer && (
            <div className="px-3 pb-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">{footer}</p>
            </div>
          )}

          {/* Timestamp placeholder */}
          <div className="px-3 pb-2 flex justify-end">
            <span className="text-[10px] text-gray-400">12:34</span>
          </div>

          {/* Buttons */}
          {buttons.length > 0 && (
            <div className="border-t border-gray-100 dark:border-gray-700">
              {buttons.map((btn, i) => (
                <div
                  key={i}
                  className="px-3 py-2 text-center border-b border-gray-100 dark:border-gray-700 last:border-0"
                >
                  <span className="text-xs text-blue-500 font-medium">{btn.text || `Knop ${i + 1}`}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function TemplateCreateDialog({ open, onOpenChange }: TemplateCreateDialogProps) {
  const queryClient = useQueryClient();

  // Form state
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [language, setLanguage] = useState('nl');
  const [headerEnabled, setHeaderEnabled] = useState(false);
  const [headerType, setHeaderType] = useState('TEXT');
  const [headerText, setHeaderText] = useState('');
  const [headerHandle, setHeaderHandle] = useState('');
  const [headerFileName, setHeaderFileName] = useState('');
  const [uploadingHeader, setUploadingHeader] = useState(false);
  const [body, setBody] = useState('');
  const [bodyExamples, setBodyExamples] = useState<Record<string, string>>({});
  const [footer, setFooter] = useState('');
  const [buttons, setButtons] = useState<Button[]>([]);

  const [nameError, setNameError] = useState('');

  const createMutation = useWhatsAppMutation('create_template');
  const uploadHeaderMutation = useWhatsAppMutation('upload_header_media');

  // Voorbeeldbestand voor een media-header uploaden → header_handle via SiteJob Connect.
  const handleHeaderFile = async (file: File) => {
    if (file.size > 30 * 1024 * 1024) {
      toast.error('Bestand is te groot (max 30MB)');
      return;
    }
    setUploadingHeader(true);
    try {
      const base64 = await fileToBase64(file);
      const res = await uploadHeaderMutation.mutateAsync({
        base64,
        mime_type: file.type,
        filename: file.name,
      });
      if (!res?.handle) {
        toast.error('Upload mislukt: geen handle ontvangen');
        return;
      }
      setHeaderHandle(res.handle);
      setHeaderFileName(file.name);
    } catch {
      // API-fout is al getoond door de mutation-onError
      setHeaderHandle('');
      setHeaderFileName('');
    } finally {
      setUploadingHeader(false);
    }
  };

  const bodyVarIndices = extractVariableIndices(body);

  const handleNameChange = (value: string) => {
    setName(value);
    if (value && !/^[a-z][a-z0-9_]*$/.test(value)) {
      setNameError('Alleen kleine letters, cijfers en underscores. Moet beginnen met een letter.');
    } else {
      setNameError('');
    }
  };

  const insertVariable = (varNum: number) => {
    setBody((prev) => prev + `{{${varNum}}}`);
  };

  const addButton = () => {
    if (buttons.length >= 3) return;
    setButtons((prev) => [...prev, { type: 'QUICK_REPLY', text: '' }]);
  };

  const removeButton = (index: number) => {
    setButtons((prev) => prev.filter((_, i) => i !== index));
  };

  const updateButton = (index: number, updates: Partial<Button>) => {
    setButtons((prev) => prev.map((b, i) => (i === index ? { ...b, ...updates } : b)));
  };

  const buildComponents = () => {
    const components: any[] = [];

    // Header. Tekst-headers direct; media-headers vereisen bij het aanmaken een
    // example.header_handle (via SiteJob Connect → Meta Resumable Upload).
    if (headerEnabled) {
      if (headerType === 'TEXT' && headerText) {
        components.push({ type: 'HEADER', format: 'TEXT', text: headerText });
      } else if (headerType !== 'TEXT' && headerHandle) {
        components.push({
          type: 'HEADER',
          format: headerType,
          example: { header_handle: [headerHandle] },
        });
      }
    }

    // Body
    if (body) {
      const bodyComponent: any = { type: 'BODY', text: body };
      if (bodyVarIndices.length > 0) {
        const exampleValues = bodyVarIndices.map((idx) => bodyExamples[idx] || `Voorbeeld ${idx}`);
        bodyComponent.example = { body_text: [exampleValues] };
      }
      components.push(bodyComponent);
    }

    // Footer
    if (footer) {
      components.push({ type: 'FOOTER', text: footer });
    }

    // Buttons
    if (buttons.length > 0) {
      const buttonComponents = buttons
        .filter((b) => b.text)
        .map((b) => {
          if (b.type === 'QUICK_REPLY') return { type: 'QUICK_REPLY', text: b.text };
          if (b.type === 'URL') return { type: 'URL', text: b.text, url: b.url ?? '' };
          if (b.type === 'PHONE_NUMBER')
            return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number ?? '' };
          return null;
        })
        .filter(Boolean);

      if (buttonComponents.length > 0) {
        components.push({ type: 'BUTTONS', buttons: buttonComponents });
      }
    }

    return components;
  };

  // Een ingeschakelde media-header vereist een geüploade handle; tekst-header niet.
  const headerValid = !headerEnabled || headerType === 'TEXT' || Boolean(headerHandle);

  const isValid =
    name &&
    !nameError &&
    category &&
    language &&
    body.trim().length > 0 &&
    bodyVarIndices.every((idx) => bodyExamples[idx]?.trim()) &&
    headerValid &&
    !uploadingHeader;

  const handleSubmit = async () => {
    if (!isValid) return;

    try {
      await createMutation.mutateAsync({
        data: {
          name,
          category,
          language,
          // Expliciet positioneel ({{1}}, {{2}}) — voorkomt afwijzing als de WABA-default
          // op NAMED staat. Body-voorbeelden worden als body_text (array-of-arrays) meegestuurd.
          parameter_format: 'POSITIONAL',
          components: buildComponents(),
          allow_category_change: true,
        },
      });

      toast.success('Template aangemaakt en ingediend bij Meta');
      queryClient.invalidateQueries({ queryKey: ['whatsapp-api', 'list_templates'] });
      queryClient.invalidateQueries({ queryKey: ['whatsapp-templates'] });
      handleClose();
    } catch (err: any) {
      // Error already shown by mutation's onError
    }
  };

  const handleClose = () => {
    setName('');
    setCategory('');
    setLanguage('nl');
    setHeaderEnabled(false);
    setHeaderType('TEXT');
    setHeaderText('');
    setHeaderHandle('');
    setHeaderFileName('');
    setUploadingHeader(false);
    setBody('');
    setBodyExamples({});
    setFooter('');
    setButtons([]);
    setNameError('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-2 shrink-0">
          <DialogTitle>Nieuwe WhatsApp template</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Form — left panel */}
          <ScrollArea className="flex-1 px-6 py-4">
            <div className="space-y-5 pr-2">
              {/* Name */}
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">
                  Template naam <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="tpl-name"
                  placeholder="bijv. welkom_nieuw_medewerker"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                />
                {nameError && <p className="text-xs text-destructive">{nameError}</p>}
                <p className="text-xs text-muted-foreground">
                  Alleen kleine letters, cijfers en underscores.
                </p>
              </div>

              {/* Category + Language */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>
                    Categorie <span className="text-destructive">*</span>
                  </Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue placeholder="Kies categorie" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MARKETING">Marketing</SelectItem>
                      <SelectItem value="UTILITY">Utility</SelectItem>
                      {/* AUTHENTICATION bewust weggelaten: Meta eist voor auth-templates een
                          vaste OTP-structuur (button + vaste body); een vrije body wordt geweigerd. */}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Taal <span className="text-destructive">*</span>
                  </Label>
                  <Select value={language} onValueChange={setLanguage}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map((l) => (
                        <SelectItem key={l.value} value={l.value}>
                          {l.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Header */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Header (optioneel)</Label>
                  <button
                    type="button"
                    onClick={() => setHeaderEnabled((v) => !v)}
                    className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                      headerEnabled
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-muted-foreground/30 text-muted-foreground hover:border-foreground'
                    }`}
                  >
                    {headerEnabled ? 'Aan' : 'Uit'}
                  </button>
                </div>

                {headerEnabled && (
                  <div className="space-y-2 pl-0">
                    <Select
                      value={headerType}
                      onValueChange={(v) => {
                        setHeaderType(v);
                        setHeaderHandle('');
                        setHeaderFileName('');
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="TEXT">Tekst</SelectItem>
                        <SelectItem value="IMAGE">Afbeelding</SelectItem>
                        <SelectItem value="VIDEO">Video</SelectItem>
                        <SelectItem value="DOCUMENT">Document</SelectItem>
                      </SelectContent>
                    </Select>

                    {headerType === 'TEXT' ? (
                      <div>
                        <Input
                          placeholder="Header tekst (max 60 tekens)"
                          maxLength={60}
                          value={headerText}
                          onChange={(e) => setHeaderText(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground mt-1 text-right">
                          {headerText.length}/60
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <input
                          type="file"
                          id="tpl-header-media"
                          className="hidden"
                          accept={
                            headerType === 'IMAGE'
                              ? 'image/jpeg,image/png'
                              : headerType === 'VIDEO'
                                ? 'video/mp4'
                                : 'application/pdf'
                          }
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleHeaderFile(file);
                            e.target.value = '';
                          }}
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={uploadingHeader}
                            onClick={() => document.getElementById('tpl-header-media')?.click()}
                          >
                            {uploadingHeader ? 'Uploaden…' : 'Voorbeeldbestand kiezen'}
                          </Button>
                          {headerHandle && !uploadingHeader && (
                            <span className="text-xs text-green-600 truncate">✓ {headerFileName}</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Voorbeeldbestand voor Meta-goedkeuring (upload via SiteJob Connect). Bij
                          het versturen kies je per bericht het echte bestand.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Body */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="tpl-body">
                    Body <span className="text-destructive">*</span>
                  </Label>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground mr-1">Variabele invoegen:</span>
                    {[1, 2, 3].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => insertVariable(n)}
                        className="text-xs px-1.5 py-0.5 rounded border border-muted-foreground/30 hover:border-foreground font-mono"
                      >
                        {`{{${n}}}`}
                      </button>
                    ))}
                  </div>
                </div>
                <Textarea
                  id="tpl-body"
                  placeholder="Hallo {{1}}, je bent uitgenodigd voor een gesprek op {{2}}."
                  maxLength={1024}
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <p className="text-xs text-muted-foreground text-right">{body.length}/1024</p>
              </div>

              {/* Body variable examples */}
              {bodyVarIndices.length > 0 && (
                <div className="space-y-2">
                  <Label>
                    Voorbeeldwaarden voor variabelen{' '}
                    <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Meta vereist voorbeeldwaarden bij templates met variabelen.
                  </p>
                  {bodyVarIndices.map((idx) => (
                    <div key={idx} className="space-y-1">
                      <Label className="text-xs text-muted-foreground">{`Voorbeeld voor {{${idx}}}`}</Label>
                      <Input
                        placeholder={`Bijv. "Jan"`}
                        value={bodyExamples[idx] ?? ''}
                        onChange={(e) =>
                          setBodyExamples((prev) => ({ ...prev, [idx]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Footer */}
              <div className="space-y-1.5">
                <Label htmlFor="tpl-footer">Footer (optioneel)</Label>
                <Input
                  id="tpl-footer"
                  placeholder="Footer tekst (max 60 tekens)"
                  maxLength={60}
                  value={footer}
                  onChange={(e) => setFooter(e.target.value)}
                />
                {footer && (
                  <p className="text-xs text-muted-foreground text-right">{footer.length}/60</p>
                )}
              </div>

              {/* Buttons */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Knoppen (optioneel, max 3)</Label>
                  {buttons.length < 3 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={addButton}
                    >
                      <Plus className="h-3 w-3" />
                      Knop toevoegen
                    </Button>
                  )}
                </div>

                {buttons.map((btn, i) => (
                  <div key={i} className="border rounded-md p-3 space-y-2 bg-muted/30">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">
                        Knop {i + 1}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => removeButton(i)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>

                    <Select
                      value={btn.type}
                      onValueChange={(v) =>
                        updateButton(i, { type: v as Button['type'], url: '', phone_number: '' })
                      }
                    >
                      <SelectTrigger className="h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="QUICK_REPLY">Snelle reactie</SelectItem>
                        <SelectItem value="URL">URL</SelectItem>
                        <SelectItem value="PHONE_NUMBER">Telefoonnummer</SelectItem>
                      </SelectContent>
                    </Select>

                    <Input
                      placeholder="Knoptekst (max 25 tekens)"
                      maxLength={25}
                      value={btn.text}
                      onChange={(e) => updateButton(i, { text: e.target.value })}
                      className="h-8"
                    />

                    {btn.type === 'URL' && (
                      <div className="relative">
                        <Link className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="https://..."
                          value={btn.url ?? ''}
                          onChange={(e) => updateButton(i, { url: e.target.value })}
                          className="h-8 pl-8"
                        />
                      </div>
                    )}

                    {btn.type === 'PHONE_NUMBER' && (
                      <div className="relative">
                        <Phone className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="+31612345678"
                          value={btn.phone_number ?? ''}
                          onChange={(e) => updateButton(i, { phone_number: e.target.value })}
                          className="h-8 pl-8"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </ScrollArea>

          {/* Preview — right panel */}
          <div className="w-64 shrink-0 border-l px-4 py-4 space-y-3 hidden md:block">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Voorbeeld
            </p>
            <WhatsAppPreview
              headerType={headerEnabled ? headerType : ''}
              headerText={headerText}
              body={body}
              footer={footer}
              buttons={buttons}
              bodyExamples={bodyExamples}
            />
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <Button variant="outline" onClick={handleClose}>
            Annuleren
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || createMutation.isPending}>
            {createMutation.isPending ? 'Aanmaken...' : 'Template aanmaken'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
