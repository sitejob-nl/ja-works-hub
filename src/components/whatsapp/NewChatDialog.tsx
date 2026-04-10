// src/components/whatsapp/NewChatDialog.tsx
import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, User, Phone, MessageSquare, Loader2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  onStartChat: (phone: string, candidateId: string | null) => void;
}

interface CandidateResult {
  id: string;
  first_name: string;
  last_name: string;
  phone: string | null;
}

export function NewChatDialog({ open, onOpenChange, orgId, onStartChat }: NewChatDialogProps) {
  const [phone, setPhone] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedCandidate, setSelectedCandidate] = useState<CandidateResult | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input 300ms
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      setPhone('');
      setSearchQuery('');
      setDebouncedQuery('');
      setSelectedCandidate(null);
    }
  }, [open]);

  const { data: candidates = [], isLoading: searchLoading } = useQuery({
    queryKey: ['candidate-search-newchat', orgId, debouncedQuery],
    queryFn: async (): Promise<CandidateResult[]> => {
      if (!debouncedQuery.trim() || debouncedQuery.trim().length < 2) return [];
      const q = `%${debouncedQuery.trim()}%`;
      const { data, error } = await supabase
        .from('candidates')
        .select('id, first_name, last_name, phone')
        .eq('organization_id', orgId)
        .or(`first_name.ilike.${q},last_name.ilike.${q},phone.ilike.${q}`)
        .limit(20);
      if (error) throw error;
      return (data ?? []) as CandidateResult[];
    },
    enabled: !!orgId && debouncedQuery.trim().length >= 2,
  });

  const handleSelectCandidate = (candidate: CandidateResult) => {
    setSelectedCandidate(candidate);
    if (candidate.phone) {
      setPhone(candidate.phone);
    }
    setSearchQuery('');
    setDebouncedQuery('');
  };

  const handleSubmit = () => {
    const trimmed = phone.trim();
    if (!trimmed) return;
    onStartChat(trimmed, selectedCandidate?.id ?? null);
  };

  const showResults = debouncedQuery.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Nieuw gesprek starten
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Candidate search */}
          <div className="space-y-2">
            <Label className="text-sm">Zoek kandidaat (optioneel)</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Naam of telefoonnummer..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (selectedCandidate) setSelectedCandidate(null);
                }}
                className="pl-8"
              />
            </div>

            {/* Search results */}
            {showResults && (
              <div className="border rounded-md overflow-hidden">
                {searchLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="text-center py-4 text-sm text-muted-foreground">
                    Geen kandidaten gevonden
                  </div>
                ) : (
                  <ScrollArea className="max-h-48">
                    {candidates.map((candidate) => (
                      <button
                        key={candidate.id}
                        onClick={() => handleSelectCandidate(candidate)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors border-b last:border-b-0"
                      >
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <User className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {candidate.first_name} {candidate.last_name}
                          </div>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            <span>{candidate.phone ?? 'Geen telefoonnummer'}</span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </ScrollArea>
                )}
              </div>
            )}

            {/* Selected candidate badge */}
            {selectedCandidate && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted/50 border">
                <User className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="text-sm flex-1">
                  {selectedCandidate.first_name} {selectedCandidate.last_name} geselecteerd
                </span>
                <button
                  onClick={() => {
                    setSelectedCandidate(null);
                    setPhone('');
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Wissen
                </button>
              </div>
            )}
          </div>

          {/* Phone number input */}
          <div className="space-y-2">
            <Label className="text-sm">Telefoonnummer</Label>
            <div className="relative">
              <Phone className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="+31612345678 of 0612345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="pl-8"
                type="tel"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Accepteert Nederlandse formaten: 06-, +316-, 0031-
            </p>
          </div>

          {/* Template warning */}
          <div className="flex items-start gap-2 p-3 rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700 dark:text-amber-300">
              <strong>Let op:</strong> voor het eerste bericht aan een nieuw contact is een template bericht vereist (buiten het 24-uurs venster).
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuleren
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!phone.trim()}
            className="gap-2"
          >
            <MessageSquare className="h-4 w-4" />
            Start gesprek
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
