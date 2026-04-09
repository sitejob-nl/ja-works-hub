// src/components/whatsapp/MediaMessage.tsx
import { useState } from 'react';
import { FileText, Play, Download, MapPin, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';

interface MediaMessageProps {
  type: string;
  body: string;
  mediaId: string | null;
}

export function MediaMessage({ type, body, mediaId }: MediaMessageProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);

  switch (type) {
    case 'image':
      return (
        <div>
          {mediaId ? (
            <>
              <div
                className="cursor-pointer rounded-md overflow-hidden max-w-[280px] bg-muted flex items-center justify-center min-h-[100px]"
                onClick={() => setLightboxOpen(true)}
              >
                <span className="text-xs text-muted-foreground p-4">
                  [Afbeelding — klik om te laden]
                </span>
              </div>
              <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
                <DialogContent className="max-w-3xl">
                  <p className="text-center text-muted-foreground">
                    Media laden vereist download via Meta API
                  </p>
                </DialogContent>
              </Dialog>
            </>
          ) : null}
          {body && body !== '[Afbeelding]' && (
            <p className="text-sm mt-1">{body}</p>
          )}
        </div>
      );

    case 'video':
      return (
        <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md max-w-[280px]">
          <Play className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Video</p>
            <p className="text-xs text-muted-foreground">{body}</p>
          </div>
        </div>
      );

    case 'audio':
      return (
        <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md max-w-[280px]">
          <div className="w-full">
            <div className="h-8 bg-muted rounded flex items-center justify-center">
              <span className="text-xs text-muted-foreground">Spraakbericht</span>
            </div>
          </div>
        </div>
      );

    case 'document':
      return (
        <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md max-w-[280px]">
          <FileText className="h-8 w-8 text-muted-foreground flex-shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{body}</p>
          </div>
          <Button variant="ghost" size="icon" className="flex-shrink-0">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      );

    case 'sticker':
      return (
        <div className="w-24 h-24 bg-muted rounded-md flex items-center justify-center">
          <span className="text-2xl">🎨</span>
        </div>
      );

    case 'location':
      return (
        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md max-w-[280px]">
          <MapPin className="h-6 w-6 text-muted-foreground flex-shrink-0" />
          <p className="text-sm">{body}</p>
        </div>
      );

    case 'contacts':
      return (
        <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md max-w-[280px]">
          <User className="h-6 w-6 text-muted-foreground flex-shrink-0" />
          <p className="text-sm">{body}</p>
        </div>
      );

    default:
      return <p className="text-sm">{body}</p>;
  }
}
