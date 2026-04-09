// src/components/whatsapp/ChatEmpty.tsx
import { MessageSquare } from 'lucide-react';

export function ChatEmpty() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
      <MessageSquare className="h-16 w-16 mb-4 opacity-20" />
      <h3 className="text-lg font-medium mb-1">Selecteer een gesprek</h3>
      <p className="text-sm">of start een nieuw gesprek via de zoekbalk</p>
    </div>
  );
}
