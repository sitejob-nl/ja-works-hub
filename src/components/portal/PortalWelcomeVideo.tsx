import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, PlayCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toVideoEmbedUrl } from '@/lib/video-embed';

const DISMISS_PREFIX = 'jawerkt-portal-welcome-dismissed:';

/**
 * Welkomstvideo bovenaan het portaal (FR-41). De URL staat in
 * organizations.settings.portal_welcome_video_url en komt binnen via get_portal_org_info() —
 * medewerkers mogen de organizations-rij zelf niet lezen.
 *
 * Wegklikken wordt per video onthouden, zodat een nieuwe video wél weer verschijnt.
 */
const PortalWelcomeVideo = () => {
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
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!embedUrl) return;
    setDismissed(window.localStorage.getItem(`${DISMISS_PREFIX}${embedUrl}`) === '1');
  }, [embedUrl]);

  if (!embedUrl || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(`${DISMISS_PREFIX}${embedUrl}`, '1');
    } catch {
      // Alleen een voorkeur; zonder storage komt de video de volgende keer gewoon terug.
    }
  };

  return (
    <div className="bg-card rounded-xl border overflow-hidden">
      <div className="flex items-center justify-between gap-2 p-4 pb-3">
        <div className="flex items-center gap-2">
          <PlayCircle className="h-5 w-5 text-stat-blue" />
          <h2 className="font-medium">Welkom bij het portaal</h2>
        </div>
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={dismiss} title="Verbergen">
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
