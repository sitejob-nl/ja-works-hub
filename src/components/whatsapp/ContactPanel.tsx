// src/components/whatsapp/ContactPanel.tsx
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { X, User, Phone, Mail, ExternalLink, AlertTriangle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface ContactPanelProps {
  candidateId: string | null;
  phone: string;
  orgId: string;
  onClose: () => void;
}

const statusLabels: Record<string, string> = {
  nieuw: 'Nieuw',
  in_behandeling: 'In behandeling',
  beschikbaar: 'Beschikbaar',
  geplaatst: 'Geplaatst',
  inactief: 'Inactief',
  afgewezen: 'Afgewezen',
};

const complianceLabels: Record<string, string> = {
  compleet: 'Compleet',
  incompleet: 'Incompleet',
  verlopen: 'Verlopen',
};

export function ContactPanel({ candidateId, phone, orgId, onClose }: ContactPanelProps) {
  const { data: candidate, isLoading } = useQuery({
    queryKey: ['candidate-contact-panel', candidateId],
    queryFn: async () => {
      if (!candidateId) return null;
      const { data, error } = await supabase
        .from('candidates')
        .select('id, first_name, last_name, email, phone, status, compliance_status, employee_status, nationality')
        .eq('id', candidateId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!candidateId,
  });

  // Check communication opt-out
  const { data: optOut } = useQuery({
    queryKey: ['communication-opt-out', candidateId],
    queryFn: async () => {
      if (!candidateId) return null;
      const { data } = await supabase
        .from('communication_preferences')
        .select('opted_out')
        .eq('candidate_id', candidateId)
        .eq('channel', 'whatsapp')
        .maybeSingle();
      return data;
    },
    enabled: !!candidateId,
  });

  const displayName = candidate
    ? `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim()
    : phone;

  return (
    <div className="flex flex-col h-full w-full border-l bg-card">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <span className="text-sm font-medium">Contactgegevens</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Avatar + name */}
        <div className="flex flex-col items-center text-center gap-2 py-2">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <User className="h-8 w-8 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-base">{displayName}</p>
            {candidate && displayName !== phone && (
              <p className="text-xs text-muted-foreground">{phone}</p>
            )}
          </div>

          {/* Status badges */}
          <div className="flex flex-wrap gap-1 justify-center">
            {candidate?.status && (
              <Badge variant="secondary" className="text-xs">
                {statusLabels[candidate.status] ?? candidate.status}
              </Badge>
            )}
            {candidate?.employee_status && (
              <Badge variant="outline" className="text-xs capitalize">
                {candidate.employee_status}
              </Badge>
            )}
          </div>

          {/* Compliance */}
          {candidate?.compliance_status && (
            <Badge
              variant="outline"
              className={cn(
                'text-xs',
                candidate.compliance_status === 'compleet'
                  ? 'border-green-500 text-green-600'
                  : candidate.compliance_status === 'verlopen'
                  ? 'border-destructive text-destructive'
                  : 'border-orange-500 text-orange-600'
              )}
            >
              {complianceLabels[candidate.compliance_status] ?? candidate.compliance_status}
            </Badge>
          )}

          {/* Opt-out warning */}
          {optOut?.opted_out && (
            <div className="flex items-center gap-1.5 text-xs text-destructive bg-destructive/10 px-2 py-1 rounded">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>WhatsApp opt-out</span>
            </div>
          )}
        </div>

        <Separator />

        {/* Contact info */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Contact</p>

          <div className="flex items-center gap-2 text-sm">
            <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">{candidate?.phone ?? phone}</span>
          </div>

          {candidate?.email && (
            <div className="flex items-center gap-2 text-sm">
              <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{candidate.email}</span>
            </div>
          )}

          {candidate?.nationality && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="text-xs">Nationaliteit:</span>
              <span className="text-sm text-foreground">{candidate.nationality}</span>
            </div>
          )}
        </div>

        {/* Profile link */}
        {candidateId && (
          <>
            <Separator />
            <Link to={`/kandidaten/${candidateId}`}>
              <Button variant="outline" size="sm" className="w-full gap-2">
                <ExternalLink className="h-3.5 w-3.5" />
                Profiel openen
              </Button>
            </Link>
          </>
        )}

        {!candidateId && !isLoading && (
          <div className="text-xs text-muted-foreground text-center pt-2">
            Onbekende contactpersoon — geen kandidaatprofiel gevonden.
          </div>
        )}
      </div>
    </div>
  );
}
