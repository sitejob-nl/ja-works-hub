const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be']);
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com', 'player.vimeo.com']);

const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;
const VIMEO_ID = /^\d+$/;

/**
 * Zet een YouTube- of Vimeo-link om naar een embed-URL, of geeft null bij alles wat daar
 * niet op lijkt. De bron is een vrij invulbare org-instelling die rechtstreeks in een
 * iframe-src belandt, dus we bouwen de URL zelf op uit een gevalideerd video-id in plaats
 * van de ingevoerde string door te geven. YouTube gaat via nocookie (minder tracking).
 */
export function toVideoEmbedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (YOUTUBE_HOSTS.has(host)) {
    const id = host.endsWith('youtu.be') ? segments[0] : url.searchParams.get('v') ?? segments.at(-1);
    return id && YOUTUBE_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  }

  if (VIMEO_HOSTS.has(host)) {
    const id = segments.at(-1);
    return id && VIMEO_ID.test(id) ? `https://player.vimeo.com/video/${id}` : null;
  }

  return null;
}
