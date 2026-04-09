// src/components/whatsapp/ChatInput.tsx
import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Loader2, FileText as TemplateIcon } from 'lucide-react';
import { AttachmentPicker } from './AttachmentPicker';
import { toast } from 'sonner';

interface ChatInputProps {
  onSendText: (text: string) => void;
  onSendMedia: (file: File, type: string) => void;
  onOpenTemplates: () => void;
  isSending: boolean;
}

export function ChatInput({ onSendText, onSendMedia, onOpenTemplates, isSending }: ChatInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;
    onSendText(trimmed);
    setText('');
    textareaRef.current?.focus();
  }, [text, isSending, onSendText]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileSelect = (file: File, type: 'image' | 'video' | 'audio' | 'document') => {
    // Max 100MB
    if (file.size > 100 * 1024 * 1024) {
      toast.error('Bestand is te groot (max 100MB)');
      return;
    }
    onSendMedia(file, type);
  };

  return (
    <div className="border-t p-3 bg-card">
      <div className="flex items-end gap-2">
        <AttachmentPicker onFileSelect={handleFileSelect} disabled={isSending} />

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          onClick={onOpenTemplates}
          disabled={isSending}
          title="Template bericht"
        >
          <TemplateIcon className="h-4 w-4" />
        </Button>

        <Textarea
          ref={textareaRef}
          placeholder="Typ een bericht..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 min-h-[36px] max-h-[120px] resize-none"
          rows={1}
          disabled={isSending}
        />

        <Button
          size="icon"
          className="h-9 w-9"
          onClick={handleSend}
          disabled={!text.trim() || isSending}
        >
          {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
