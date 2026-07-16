import { Copy, ExternalLink, Eye, Loader2, RefreshCw } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  PROPOSAL_PAGE_SECTION_META,
  type ProposalPageConfig,
  type ProposalPageSectionKey,
} from '@/lib/proposal-page';

type ProposalPageEditorProps = {
  config: ProposalPageConfig;
  responseUrl: string;
  previewRevision: number;
  loading: boolean;
  dirty: boolean;
  onChange: (config: ProposalPageConfig) => void;
  onRefresh: () => void;
  onCopyLink: () => void;
};

const ProposalPageEditor = ({
  config,
  responseUrl,
  previewRevision,
  loading,
  dirty,
  onChange,
  onRefresh,
  onCopyLink,
}: ProposalPageEditorProps) => {
  const updateSectionEnabled = (key: ProposalPageSectionKey, enabled: boolean) => {
    onChange({ ...config, sections: { ...config.sections, [key]: enabled } });
  };

  const updateSectionContent = (
    key: ProposalPageSectionKey,
    field: 'title' | 'body',
    value: string,
  ) => {
    onChange({
      ...config,
      content: {
        ...config.content,
        [key]: { ...config.content[key], [field]: value },
      },
    });
  };

  const previewUrl = responseUrl
    ? `${responseUrl}${responseUrl.includes('?') ? '&' : '?'}preview=${previewRevision}`
    : '';

  return (
    <div className="grid min-h-[680px] gap-4 xl:grid-cols-[minmax(360px,0.8fr)_minmax(520px,1.2fr)]">
      <div className="space-y-4 rounded-lg border bg-muted/15 p-4">
        <div>
          <h3 className="text-sm font-semibold">Inhoud klantpagina</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Kies wat de opdrachtgever ziet. De reactieknoppen blijven altijd beschikbaar.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="proposal-page-title">Paginatitel</Label>
          <Input
            id="proposal-page-title"
            value={config.title}
            maxLength={120}
            onChange={(event) => onChange({ ...config, title: event.target.value })}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="proposal-page-intro">Introductie</Label>
          <Textarea
            id="proposal-page-intro"
            value={config.intro}
            maxLength={1000}
            rows={3}
            onChange={(event) => onChange({ ...config, intro: event.target.value })}
          />
        </div>

        <Accordion type="multiple" className="rounded-md border bg-background px-3">
          {PROPOSAL_PAGE_SECTION_META.map((section) => {
            const enabled = config.sections[section.key];
            const content = config.content[section.key];
            return (
              <AccordionItem key={section.key} value={section.key}>
                <div className="flex items-center gap-3">
                  <Checkbox
                    id={`proposal-section-${section.key}`}
                    checked={enabled}
                    onCheckedChange={(value) => updateSectionEnabled(section.key, value === true)}
                    aria-label={`${section.label} tonen`}
                  />
                  <AccordionTrigger className="min-w-0 flex-1 py-3 text-left hover:no-underline">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{section.label}</span>
                      <span className="mt-0.5 block text-xs font-normal leading-4 text-muted-foreground">
                        {enabled ? 'Zichtbaar' : 'Verborgen'} · {section.description}
                      </span>
                    </span>
                  </AccordionTrigger>
                </div>
                <AccordionContent className="space-y-3 pb-4 pl-7">
                  <div className="space-y-1.5">
                    <Label htmlFor={`proposal-section-title-${section.key}`} className="text-xs">Koptekst</Label>
                    <Input
                      id={`proposal-section-title-${section.key}`}
                      value={content.title}
                      maxLength={100}
                      onChange={(event) => updateSectionContent(section.key, 'title', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`proposal-section-body-${section.key}`} className="text-xs">
                      {section.contentKind === 'list' ? 'Inhoud — één item per regel' : 'Inhoud'}
                    </Label>
                    <Textarea
                      id={`proposal-section-body-${section.key}`}
                      value={content.body}
                      maxLength={section.contentKind === 'list' ? 2500 : 4000}
                      rows={section.contentKind === 'text' ? 5 : 4}
                      placeholder={section.contentKind === 'supporting'
                        ? 'Optionele toelichting; de vastgelegde gegevens blijven eronder staan.'
                        : 'Vul de inhoud in die de opdrachtgever mag zien.'}
                      onChange={(event) => updateSectionContent(section.key, 'body', event.target.value)}
                    />
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>

        <Button type="button" onClick={onRefresh} disabled={loading} className="w-full gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {dirty ? 'Voorbeeld bijwerken' : 'Voorbeeld verversen'}
        </Button>
      </div>

      <div className="flex min-h-[680px] flex-col overflow-hidden rounded-lg border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Eye className="h-4 w-4 text-muted-foreground" />
            Preview klantpagina
            {dirty && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">Niet bijgewerkt</span>}
          </div>
          {responseUrl && (
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="icon" onClick={onCopyLink} title="Kopieer klantlink">
                <Copy className="h-4 w-4" />
              </Button>
              <Button type="button" variant="ghost" size="icon" asChild title="Open veilige preview">
                <a href={previewUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
              </Button>
            </div>
          )}
        </div>
        {previewUrl ? (
          <iframe
            key={previewRevision}
            title="klantpagina-preview"
            src={previewUrl}
            className="min-h-[640px] flex-1 bg-slate-50"
          />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : 'Preview wordt voorbereid...'}
          </div>
        )}
      </div>
    </div>
  );
};

export default ProposalPageEditor;
