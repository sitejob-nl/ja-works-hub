// src/components/whatsapp/ChatHeader.tsx
import { Button } from '@/components/ui/button';
import { ArrowLeft, User, PanelRight, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';

interface ChatHeaderProps {
  candidateName: string | null;
  phone: string;
  candidateId: string | null;
  showBackButton: boolean;
  onBack: () => void;
  onToggleContact: () => void;
  showContactButton?: boolean;
}

export function ChatHeader({
  candidateName,
  phone,
  candidateId,
  showBackButton,
  onBack,
  onToggleContact,
  showContactButton = true,
}: ChatHeaderProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b bg-card">
      {showBackButton && (
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
      )}

      <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
        <User className="h-5 w-5 text-muted-foreground" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          {candidateId ? (
            <Link
              to={`/kandidaten/${candidateId}`}
              className="text-sm font-medium hover:underline truncate"
            >
              {candidateName || phone}
            </Link>
          ) : (
            <span className="text-sm font-medium truncate">{candidateName || phone}</span>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Phone className="h-3 w-3" />
          <span>{phone}</span>
        </div>
      </div>

      {showContactButton && (
        <Button variant="ghost" size="icon" onClick={onToggleContact} className="h-8 w-8">
          <PanelRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
