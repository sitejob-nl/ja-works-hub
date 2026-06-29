// src/components/whatsapp/AttachmentPicker.tsx
import { useRef } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Paperclip, Image, Video, FileText, Mic } from 'lucide-react';
import { noFileDropInputProps } from '@/lib/file-input';

interface AttachmentPickerProps {
  onFileSelect: (file: File, type: 'image' | 'video' | 'audio' | 'document') => void;
  disabled?: boolean;
}

export function AttachmentPicker({ onFileSelect, disabled }: AttachmentPickerProps) {
  const imageRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  const handleFile = (type: 'image' | 'video' | 'audio' | 'document') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onFileSelect(file, type);
      e.target.value = '';
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9" disabled={disabled}>
          <Paperclip className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" side="top" align="start">
        <div className="flex flex-col gap-1">
          <Button variant="ghost" size="sm" className="justify-start gap-2" onClick={() => imageRef.current?.click()}>
            <Image className="h-4 w-4 text-blue-500" /> Afbeelding
          </Button>
          <Button variant="ghost" size="sm" className="justify-start gap-2" onClick={() => videoRef.current?.click()}>
            <Video className="h-4 w-4 text-purple-500" /> Video
          </Button>
          <Button variant="ghost" size="sm" className="justify-start gap-2" onClick={() => audioRef.current?.click()}>
            <Mic className="h-4 w-4 text-green-500" /> Audio
          </Button>
          <Button variant="ghost" size="sm" className="justify-start gap-2" onClick={() => docRef.current?.click()}>
            <FileText className="h-4 w-4 text-orange-500" /> Document
          </Button>
        </div>

        <input ref={imageRef} type="file" accept="image/*" className="hidden" {...noFileDropInputProps} onChange={handleFile('image')} />
        <input ref={videoRef} type="file" accept="video/*" className="hidden" {...noFileDropInputProps} onChange={handleFile('video')} />
        <input ref={audioRef} type="file" accept="audio/*" className="hidden" {...noFileDropInputProps} onChange={handleFile('audio')} />
        <input ref={docRef} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" className="hidden" {...noFileDropInputProps} onChange={handleFile('document')} />
      </PopoverContent>
    </Popover>
  );
}
