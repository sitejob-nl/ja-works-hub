import { useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Link as LinkIcon,
  Image as ImageIcon, List, ListOrdered, AlignLeft, AlignCenter, AlignRight,
  Heading1, Heading2, Heading3, Undo, Redo, Eye, Variable, Code,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const TEMPLATE_VARIABLES = [
  { group: 'Persoon', items: [
    { label: 'Voornaam', value: '{{voornaam}}' },
    { label: 'Achternaam', value: '{{achternaam}}' },
    { label: 'Volledige naam', value: '{{volledige_naam}}' },
    { label: 'E-mail', value: '{{email}}' },
    { label: 'Telefoon', value: '{{telefoon}}' },
    { label: 'Geboortedatum', value: '{{geboortedatum}}' },
    { label: 'Nationaliteit', value: '{{nationaliteit}}' },
  ]},
  { group: 'Werk', items: [
    { label: 'Medewerker nummer', value: '{{medewerker_nummer}}' },
    { label: 'Status', value: '{{status}}' },
    { label: 'BSN', value: '{{bsn}}' },
  ]},
  { group: 'Adres', items: [
    { label: 'Straat', value: '{{straat}}' },
    { label: 'Postcode', value: '{{postcode}}' },
    { label: 'Stad', value: '{{stad}}' },
  ]},
  { group: 'Organisatie', items: [
    { label: 'Organisatie naam', value: '{{organisatie_naam}}' },
    { label: 'Datum vandaag', value: '{{datum_vandaag}}' },
  ]},
];

const DUMMY_DATA: Record<string, string> = {
  '{{voornaam}}': 'Jan',
  '{{achternaam}}': 'de Vries',
  '{{volledige_naam}}': 'Jan de Vries',
  '{{email}}': 'jan@voorbeeld.nl',
  '{{telefoon}}': '06-12345678',
  '{{geboortedatum}}': '15-03-1990',
  '{{nationaliteit}}': 'Nederlands',
  '{{medewerker_nummer}}': 'MW-001',
  '{{status}}': 'actief',
  '{{bsn}}': '123456789',
  '{{straat}}': 'Hoofdstraat 1',
  '{{postcode}}': '5701 AB',
  '{{stad}}': 'Helmond',
  '{{organisatie_naam}}': 'JA Werkt',
  '{{datum_vandaag}}': new Date().toLocaleDateString('nl-NL'),
};

function replaceVariables(html: string): string {
  let result = html;
  Object.entries(DUMMY_DATA).forEach(([key, val]) => {
    result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), `<span class="text-primary font-medium">${val}</span>`);
  });
  return result;
}

const CATEGORIES = [
  { value: 'general', label: 'Algemeen' },
  { value: 'onboarding', label: 'Onboarding' },
  { value: 'invitation', label: 'Uitnodiging' },
  { value: 'notification', label: 'Notificatie' },
  { value: 'campaign', label: 'Campagne' },
  { value: 'placement', label: 'Plaatsing' },
];

interface EmailTemplateEditorProps {
  name: string;
  subject: string;
  bodyHtml: string;
  bodyJson: string;
  category: string;
  onNameChange: (v: string) => void;
  onSubjectChange: (v: string) => void;
  onBodyChange: (html: string, json: string) => void;
  onCategoryChange: (v: string) => void;
}

const ToolbarButton = ({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title: string }) => (
  <Button
    variant="ghost"
    size="icon"
    className={cn('h-8 w-8', active && 'bg-muted')}
    onClick={onClick}
    title={title}
    type="button"
  >
    {children}
  </Button>
);

const EmailTemplateEditor = ({
  name, subject, bodyHtml, bodyJson, category,
  onNameChange, onSubjectChange, onBodyChange, onCategoryChange,
}: EmailTemplateEditorProps) => {
  const [activeTab, setActiveTab] = useState<string>('edit');

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image,
      Placeholder.configure({ placeholder: 'Begin met het schrijven van je template...' }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: bodyJson ? JSON.parse(bodyJson) : bodyHtml || '',
    onUpdate: ({ editor }) => {
      onBodyChange(editor.getHTML(), JSON.stringify(editor.getJSON()));
    },
  });

  const insertVariable = useCallback((variable: string) => {
    if (!editor) return;
    editor.chain().focus().insertContent(variable).run();
  }, [editor]);

  const insertVariableInSubject = useCallback((variable: string) => {
    onSubjectChange(subject + variable);
  }, [subject, onSubjectChange]);

  const addLink = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('URL:');
    if (url) {
      editor.chain().focus().setLink({ href: url }).run();
    }
  }, [editor]);

  const addImage = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('Afbeelding URL:');
    if (url) {
      editor.chain().focus().setImage({ src: url }).run();
    }
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="space-y-4">
      {/* Name + Category */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2 space-y-1">
          <Label>Template naam *</Label>
          <Input value={name} onChange={e => onNameChange(e.target.value)} placeholder="Bijv. Welkomstmail nieuwe medewerker" />
        </div>
        <div className="space-y-1">
          <Label>Categorie</Label>
          <Select value={category} onValueChange={onCategoryChange}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Subject with variable picker */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label>Onderwerp *</Label>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 text-xs gap-1">
                <Variable className="h-3 w-3" /> Variabele invoegen
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2" align="end">
              <ScrollArea className="max-h-48">
                {TEMPLATE_VARIABLES.flatMap(g => g.items).map(v => (
                  <button
                    key={v.value}
                    onClick={() => insertVariableInSubject(v.value)}
                    className="w-full text-left px-2 py-1 text-sm hover:bg-muted rounded"
                  >
                    {v.label} <span className="text-muted-foreground text-xs">{v.value}</span>
                  </button>
                ))}
              </ScrollArea>
            </PopoverContent>
          </Popover>
        </div>
        <Input value={subject} onChange={e => onSubjectChange(e.target.value)} placeholder="Onderwerp met {{voornaam}} variabelen" />
      </div>

      {/* Editor / Preview tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="edit">Editor</TabsTrigger>
            <TabsTrigger value="preview" className="gap-1"><Eye className="h-3 w-3" /> Preview</TabsTrigger>
            <TabsTrigger value="html" className="gap-1"><Code className="h-3 w-3" /> HTML</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="edit" className="mt-2 space-y-2">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-0.5 border rounded-md p-1 bg-muted/30">
            <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Vet">
              <Bold className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Cursief">
              <Italic className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Onderstrepen">
              <UnderlineIcon className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Doorhalen">
              <Strikethrough className="h-4 w-4" />
            </ToolbarButton>

            <Separator orientation="vertical" className="h-6 mx-1" />

            <ToolbarButton active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Kop 1">
              <Heading1 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Kop 2">
              <Heading2 className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Kop 3">
              <Heading3 className="h-4 w-4" />
            </ToolbarButton>

            <Separator orientation="vertical" className="h-6 mx-1" />

            <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Opsomming">
              <List className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Genummerd">
              <ListOrdered className="h-4 w-4" />
            </ToolbarButton>

            <Separator orientation="vertical" className="h-6 mx-1" />

            <ToolbarButton active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Links">
              <AlignLeft className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Midden">
              <AlignCenter className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Rechts">
              <AlignRight className="h-4 w-4" />
            </ToolbarButton>

            <Separator orientation="vertical" className="h-6 mx-1" />

            <ToolbarButton active={editor.isActive('link')} onClick={addLink} title="Link">
              <LinkIcon className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton onClick={addImage} title="Afbeelding">
              <ImageIcon className="h-4 w-4" />
            </ToolbarButton>

            <Separator orientation="vertical" className="h-6 mx-1" />

            <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Ongedaan maken">
              <Undo className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Opnieuw">
              <Redo className="h-4 w-4" />
            </ToolbarButton>

            <div className="flex-1" />

            {/* Variable picker */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                  <Variable className="h-3 w-3" /> Variabele
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="end">
                <ScrollArea className="max-h-64">
                  {TEMPLATE_VARIABLES.map(group => (
                    <div key={group.group} className="mb-2">
                      <p className="text-[10px] font-semibold uppercase text-muted-foreground px-2 mb-1">{group.group}</p>
                      {group.items.map(v => (
                        <button
                          key={v.value}
                          onClick={() => insertVariable(v.value)}
                          className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted rounded flex items-center justify-between"
                        >
                          <span>{v.label}</span>
                          <Badge variant="secondary" className="text-[10px] font-mono">{v.value}</Badge>
                        </button>
                      ))}
                    </div>
                  ))}
                </ScrollArea>
              </PopoverContent>
            </Popover>
          </div>

          {/* Editor */}
          <div className="border rounded-md min-h-[300px] prose prose-sm dark:prose-invert max-w-none p-4 focus-within:ring-2 focus-within:ring-ring">
            <EditorContent editor={editor} />
          </div>
        </TabsContent>

        <TabsContent value="preview" className="mt-2">
          <div className="border rounded-md p-4 bg-white dark:bg-zinc-950">
            <div className="mb-3 pb-3 border-b">
              <p className="text-xs text-muted-foreground">Onderwerp</p>
              <p className="font-medium" dangerouslySetInnerHTML={{
                __html: replaceVariables(subject || '(Geen onderwerp)')
              }} />
            </div>
            <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{
              __html: replaceVariables(editor.getHTML())
            }} />
          </div>
          <p className="text-xs text-muted-foreground mt-2">Preview met voorbeelddata. Variabelen worden bij verzending vervangen door echte waarden.</p>
        </TabsContent>

        <TabsContent value="html" className="mt-2">
          <pre className="border rounded-md p-4 bg-muted/30 text-xs overflow-auto max-h-[400px] whitespace-pre-wrap font-mono">
            {editor.getHTML()}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default EmailTemplateEditor;
export { TEMPLATE_VARIABLES, DUMMY_DATA, replaceVariables };
