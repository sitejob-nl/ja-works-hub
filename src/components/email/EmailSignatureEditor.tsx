import { useCallback, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import TextAlign from '@tiptap/extension-text-align';
import { AlignCenter, AlignLeft, AlignRight, Bold, Code, Eye, Image as ImageIcon, Italic, Link as LinkIcon, List, ListOrdered, Redo, Strikethrough, Underline as UnderlineIcon, Undo, Upload, Variable } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { sanitizeHtml } from '@/lib/sanitize-html';
import { cn } from '@/lib/utils';

const SIGNATURE_VARIABLES = [
  { label: 'Afzendernaam', value: '{{afzender_naam}}' },
  { label: 'Afzender e-mail', value: '{{afzender_email}}' },
  { label: 'Mailbox e-mail', value: '{{mailbox_email}}' },
  { label: 'Organisatie', value: '{{organisatie_naam}}' },
];

const PREVIEW_VALUES: Record<string, string> = {
  '{{afzender_naam}}': 'Sanne Janssen',
  '{{afzender_email}}': 'sanne@jawerkt.nl',
  '{{mailbox_email}}': 'planning@jawerkt.nl',
  '{{organisatie_naam}}': 'JA Werkt',
};

function parseContent(html: string, json?: string | null) {
  if (!json) return html || '';
  try {
    return JSON.parse(json);
  } catch {
    return html || '';
  }
}

function replacePreviewVariables(html: string) {
  let result = html;
  for (const [key, value] of Object.entries(PREVIEW_VALUES)) {
    result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), `<span class="text-primary font-medium">${value}</span>`);
  }
  return result;
}

const ToolbarButton = ({ active, onClick, children, title }: { active?: boolean; onClick: () => void; children: React.ReactNode; title: string }) => (
  <Button
    type="button"
    variant="ghost"
    size="icon"
    className={cn('h-8 w-8', active && 'bg-muted')}
    onClick={onClick}
    title={title}
  >
    {children}
  </Button>
);

interface EmailSignatureEditorProps {
  enabled: boolean;
  html: string;
  json?: string | null;
  onEnabledChange: (enabled: boolean) => void;
  onChange: (html: string, json: string) => void;
  onUploadImage: (file: File) => Promise<string>;
}

const EmailSignatureEditor = ({
  enabled,
  html,
  json,
  onEnabledChange,
  onChange,
  onUploadImage,
}: EmailSignatureEditorProps) => {
  const [activeTab, setActiveTab] = useState('edit');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Image.configure({
        HTMLAttributes: {
          style: 'max-width:180px;height:auto;',
        },
      }),
      Placeholder.configure({ placeholder: 'Plak of bouw hier de Outlook-handtekening...' }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: parseContent(html, json),
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML(), JSON.stringify(editor.getJSON()));
    },
  });

  const insertVariable = useCallback((variable: string) => {
    editor?.chain().focus().insertContent(variable).run();
  }, [editor]);

  const addLink = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('URL:');
    if (url) editor.chain().focus().setLink({ href: url }).run();
  }, [editor]);

  const addImageUrl = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('Afbeelding URL:');
    if (url) editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  const handleImageUpload = async (file: File) => {
    if (!editor) return;
    setUploading(true);
    try {
      const url = await onUploadImage(file);
      editor.chain().focus().setImage({ src: url, alt: file.name }).run();
    } catch {
      // Parent handles the toast; keep the editor responsive.
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!editor) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
        <div>
          <Label className="text-sm font-medium">Handtekening gebruiken</Label>
          <p className="text-xs text-muted-foreground">Wordt automatisch toegevoegd aan mails vanuit deze mailbox.</p>
        </div>
        <Switch checked={enabled} onCheckedChange={onEnabledChange} />
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="edit">Editor</TabsTrigger>
          <TabsTrigger value="preview" className="gap-1"><Eye className="h-3 w-3" /> Preview</TabsTrigger>
          <TabsTrigger value="html" className="gap-1"><Code className="h-3 w-3" /> HTML</TabsTrigger>
        </TabsList>

        <TabsContent value="edit" className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-0.5 rounded-md border bg-muted/30 p-1">
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

            <Separator orientation="vertical" className="mx-1 h-6" />

            <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Opsomming">
              <List className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Genummerd">
              <ListOrdered className="h-4 w-4" />
            </ToolbarButton>

            <Separator orientation="vertical" className="mx-1 h-6" />

            <ToolbarButton active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()} title="Links">
              <AlignLeft className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()} title="Midden">
              <AlignCenter className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()} title="Rechts">
              <AlignRight className="h-4 w-4" />
            </ToolbarButton>

            <Separator orientation="vertical" className="mx-1 h-6" />

            <ToolbarButton active={editor.isActive('link')} onClick={addLink} title="Link">
              <LinkIcon className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton onClick={() => fileInputRef.current?.click()} title="Afbeelding uploaden">
              {uploading ? <Upload className="h-4 w-4 animate-pulse" /> : <ImageIcon className="h-4 w-4" />}
            </ToolbarButton>
            <ToolbarButton onClick={addImageUrl} title="Afbeelding via URL">
              <ImageIcon className="h-4 w-4" />
            </ToolbarButton>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImageUpload(file);
              }}
            />

            <Separator orientation="vertical" className="mx-1 h-6" />

            <ToolbarButton onClick={() => editor.chain().focus().undo().run()} title="Ongedaan maken">
              <Undo className="h-4 w-4" />
            </ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().redo().run()} title="Opnieuw">
              <Redo className="h-4 w-4" />
            </ToolbarButton>

            <div className="flex-1" />

            <Popover>
              <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-8 gap-1 text-xs">
                  <Variable className="h-3 w-3" /> Variabele
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="end">
                <ScrollArea className="max-h-64">
                  {SIGNATURE_VARIABLES.map((variable) => (
                    <button
                      key={variable.value}
                      type="button"
                      onClick={() => insertVariable(variable.value)}
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                    >
                      <span>{variable.label}</span>
                      <Badge variant="secondary" className="font-mono text-[10px]">{variable.value}</Badge>
                    </button>
                  ))}
                </ScrollArea>
              </PopoverContent>
            </Popover>
          </div>

          <div className="min-h-[220px] rounded-md border p-4 prose prose-sm max-w-none focus-within:ring-2 focus-within:ring-ring dark:prose-invert [&_.ProseMirror]:min-h-[190px] [&_.ProseMirror]:outline-none [&_.ProseMirror_img]:max-w-[180px]">
            <EditorContent editor={editor} />
          </div>
        </TabsContent>

        <TabsContent value="preview" className="mt-3">
          <div className="rounded-md border bg-white p-4 dark:bg-zinc-950">
            <div
              className="prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(replacePreviewVariables(editor.getHTML())) }}
            />
          </div>
        </TabsContent>

        <TabsContent value="html" className="mt-3">
          <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-4 font-mono text-xs">
            {editor.getHTML()}
          </pre>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default EmailSignatureEditor;
