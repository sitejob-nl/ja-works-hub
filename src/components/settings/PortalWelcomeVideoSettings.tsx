import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganizationId } from '@/hooks/useOrganizationId';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toVideoEmbedUrl } from '@/lib/video-embed';
import { unwrap } from '@/lib/db';

const PortalWelcomeVideoSettings = () => {
  const orgId = useOrganizationId();
  const qc = useQueryClient();
  const [url, setUrl] = useState('');

  const { data: org } = useQuery({
    queryKey: ['portal-welcome-video-settings', orgId],
    queryFn: () => unwrap(supabase.from('organizations').select('settings').eq('id', orgId).single()),
    enabled: !!orgId,
  });

  const savedUrl = ((org?.settings as any)?.portal_welcome_video_url as string) ?? '';

  useEffect(() => {
    setUrl(savedUrl);
  }, [savedUrl]);

  const trimmed = url.trim();
  const embedUrl = toVideoEmbedUrl(trimmed);
  const isInvalid = trimmed.length > 0 && !embedUrl;

  const save = useMutation({
    mutationFn: async () => {
      const nextSettings = {
        ...((org?.settings as any) ?? {}),
        portal_welcome_video_url: trimmed || null,
      };
      await unwrap(supabase.from('organizations').update({ settings: nextSettings }).eq('id', orgId));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['portal-welcome-video-settings', orgId] });
      toast.success(trimmed ? 'Welkomstvideo opgeslagen' : 'Welkomstvideo verwijderd');
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <PlayCircle className="h-4 w-4" /> Welkomstvideo medewerkersportaal
        </CardTitle>
        <CardDescription>
          Wordt bovenaan het dashboard van het medewerkersportaal getoond, en verdwijnt daarna vanzelf —
          iedere medewerker krijgt hem één keer te zien. Zet je hier later een andere video neer, dan
          verschijnt die eenmalig opnieuw. Laat leeg om geen video te tonen. Alleen YouTube- en
          Vimeo-links.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="portal-welcome-video">Video-URL</Label>
          <Input
            id="portal-welcome-video"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
          />
          {isInvalid && (
            <p className="text-xs text-destructive">
              Dit lijkt geen YouTube- of Vimeo-link. Plak de link uit de adresbalk van de video.
            </p>
          )}
        </div>

        {embedUrl && (
          <div className="space-y-1.5">
            <Label>Voorbeeld</Label>
            <div className="aspect-video w-full max-w-md overflow-hidden rounded-md border bg-muted">
              <iframe
                src={embedUrl}
                title="Voorbeeld welkomstvideo"
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          </div>
        )}

        <Button onClick={() => save.mutate()} disabled={save.isPending || isInvalid || trimmed === savedUrl}>
          {save.isPending ? 'Opslaan...' : 'Opslaan'}
        </Button>
      </CardContent>
    </Card>
  );
};

export default PortalWelcomeVideoSettings;
