import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, PlayCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { usePortal } from '@/contexts/PortalContext';
import { Button } from '@/components/ui/button';
import { toVideoEmbedUrl } from '@/lib/video-embed';

/**
 * Welkomstvideo bovenaan het portaal (FR-41). De URL staat in
 * organizations.settings.portal_welcome_video_url en komt binnen via get_portal_org_info() —
 * medewerkers mogen de organizations-rij zelf niet lezen.
 *
 * De video wordt één keer getoond en verdwijnt daarna vanzelf; niemand hoeft hem weg te
 * klikken. "Al gezien" staat als embed-URL op de kandidaat, niet in localStorage, zodat het
 * ook geldt als iemand daarna op zijn telefoon inlogt. Zet de beheerder een andere video
 * neer, dan wijkt de opgeslagen URL af en verschijnt die eenmalig opnieuw.
 */
const PortalWelcomeVideo = () => {
  const { candidate } = usePortal();

  const { data: org } = useQuery({
    queryKey: ['portal-org-info'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_portal_org_info');
      if (error) throw error;
      return data?.[0] ?? null;
    },
    staleTime: 5 * 60 * 1000,
  });

  const embedUrl = toVideoEmbedUrl(org?.welcome_video_url);
  const candidateId = candidate?.id as string | undefined;
  const seenUrl = (candidate?.portal_welcome_video_seen_url as string | null) ?? null;

  // Het besluit valt één keer en blijft daarna staan: we markeren de video meteen als gezien,
  // en zonder deze vastlegging zou hij midden in het bezoek onder de gebruiker vandaan
  // verdwijnen zodra de kandidaat opnieuw wordt opgehaald.
  const [visible, setVisible] = useState<boolean | null>(null);

  useEffect(() => {
    if (visible !== null) return;
    if (!embedUrl || !candidateId) return;

    if (seenUrl === embedUrl) {
      setVisible(false);
      return;
    }

    setVisible(true);
    supabase
      .from('candidates')
      .update({ portal_welcome_video_seen_url: embedUrl })
      .eq('id', candidateId)
      .then(({ error }) => {
        // Lukt het opslaan niet, dan krijgt de medewerker de video de volgende keer nog
        // eens. Vervelend, maar geen reden om hem nu iets te laten zien of te onthouden.
        if (error) console.warn('Welkomstvideo markeren als gezien mislukt', error);
      });
  }, [visible, embedUrl, candidateId, seenUrl]);

  if (!embedUrl || !visible) return null;

  return (
    <div className="bg-card rounded-xl border overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-4 pb-3">
        <div className="flex items-center gap-2">
          <PlayCircle className="h-5 w-5 text-stat-blue" />
          <h2 className="font-medium">Welkom bij het portaal</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setVisible(false)}
          title="Verbergen"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="aspect-video w-full bg-muted">
        <iframe
          src={embedUrl}
          title="Welkomstvideo"
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    </div>
  );
};

export default PortalWelcomeVideo;
