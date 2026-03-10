import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { Copy, Check } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employeeId: string;
  candidateEmail?: string | null;
}

const PortalActivateSheet = ({ open, onOpenChange, employeeId, candidateEmail }: Props) => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [email, setEmail] = useState(candidateEmail ?? '');
  const [language, setLanguage] = useState('nl');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activate = useMutation({
    mutationFn: async () => {
      // 1. Update employee
      const { error: empError } = await supabase
        .from('employees')
        .update({
          portal_enabled: true,
          portal_activated_at: new Date().toISOString(),
          portal_language: language,
        })
        .eq('id', employeeId);
      if (empError) throw empError;

      // 2. Insert portal invite
      const { data: invite, error: inviteError } = await supabase
        .from('portal_invites')
        .insert({
          organization_id: orgId,
          employee_id: employeeId,
          email,
        })
        .select('token')
        .single();
      if (inviteError) throw inviteError;

      return invite.token;
    },
    onSuccess: (token) => {
      const link = `${window.location.origin}/portaal/activeren/${token}`;
      setInviteLink(link);
      qc.invalidateQueries({ queryKey: ['employee', employeeId] });
      qc.invalidateQueries({ queryKey: ['employees'] });
      toast.success('Portaal geactiveerd en uitnodiging aangemaakt');
    },
    onError: () => {
      toast.error('Er ging iets mis bij het activeren');
    },
  });

  const sendNewInvite = useMutation({
    mutationFn: async () => {
      const { data: invite, error } = await supabase
        .from('portal_invites')
        .insert({
          organization_id: orgId,
          employee_id: employeeId,
          email,
        })
        .select('token')
        .single();
      if (error) throw error;
      return invite.token;
    },
    onSuccess: (token) => {
      const link = `${window.location.origin}/portaal/activeren/${token}`;
      setInviteLink(link);
      toast.success('Nieuwe uitnodiging aangemaakt');
    },
  });

  const copyLink = () => {
    if (!inviteLink) return;
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success('Link gekopieerd');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setInviteLink(null);
      setCopied(false);
    }
    onOpenChange(v);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Portaal activeren</SheetTitle>
          <SheetDescription>Activeer het medewerkerportaal en verstuur een uitnodigingslink.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-6">
          <div className="space-y-2">
            <Label htmlFor="portal-email">E-mailadres</Label>
            <Input
              id="portal-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="medewerker@email.com"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="portal-lang">Portaaltaal</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id="portal-lang">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="nl">Nederlands</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!inviteLink ? (
            <Button
              onClick={() => activate.mutate()}
              disabled={!email || activate.isPending}
              className="w-full"
            >
              {activate.isPending ? 'Bezig...' : 'Activeren & uitnodiging versturen'}
            </Button>
          ) : (
            <div className="space-y-3">
              <div className="bg-muted rounded-md p-3">
                <p className="text-xs text-muted-foreground mb-1">Uitnodigingslink</p>
                <p className="text-sm font-mono break-all">{inviteLink}</p>
              </div>
              <Button onClick={copyLink} variant="outline" className="w-full gap-2">
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Gekopieerd!' : 'Link kopiëren'}
              </Button>
              <p className="text-xs text-muted-foreground">
                Stuur deze link handmatig via WhatsApp of email naar de medewerker. De link is 7 dagen geldig.
              </p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default PortalActivateSheet;
