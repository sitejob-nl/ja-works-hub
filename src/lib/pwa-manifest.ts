/**
 * Per-organisatie PWA-manifest.
 *
 * Het manifest dat vite-plugin-pwa bouwt is build-time en dus voor iedereen gelijk:
 * elke organisatie installeert de app als "SiteJob — Uitzend Software". Op een eigen
 * klantdomein is dat het laatste zichtbare gat in de white-labeling — de runtime-branding
 * in `branding.ts` dekt alleen CSS.
 *
 * Deze module vervangt het manifest op basis van de ingelogde organisatie. Naam,
 * theme-kleur en (waar mogelijk) het icoon komen uit de org-instellingen.
 *
 * Iconen: een manifest-icoon moet een PNG op een bekende maat zijn, anders weigert de
 * browser de install-prompt. Een org-logo is willekeurig van formaat, dus we schalen het
 * client-side naar 192 en 512 via canvas. Lukt dat niet — geen logo, CORS-blokkade,
 * onleesbaar bestand — dan blijven de gebouwde standaard-iconen staan. Installeerbaarheid
 * weegt zwaarder dan een merk-icoon.
 */

import { hslTripletToHex } from '@/lib/email-brand-preview';

const STATIC_ICONS = [
  { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
  { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
];

const ICON_SIZES = [192, 512];
const DEFAULT_THEME_COLOR = '#0a1628';
const DEFAULT_BACKGROUND_COLOR = '#f5f7fa';

/** Object-URL van het vorige manifest, zodat we die kunnen vrijgeven bij een wissel. */
let activeManifestUrl: string | null = null;

export type OrgManifestInput = {
  name?: string | null;
  logoUrl?: string | null;
  accentColor?: string | null;
};

/**
 * Schaalt een afbeelding naar een vierkant PNG van `size` px, met de afbeelding
 * ingepast (contain) op een transparante achtergrond. Geeft null bij elke fout —
 * inclusief een tainted canvas doordat het logo zonder CORS-headers wordt geserveerd.
 */
async function renderIcon(image: HTMLImageElement, size: number): Promise<string | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);

    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

/** Een logo dat blijft hangen mag het manifest niet tegenhouden. */
const LOGO_LOAD_TIMEOUT_MS = 3000;

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    // Een URL die nooit `load` of `error` vuurt zou deze promise anders eeuwig open
    // houden, waardoor het manifest nooit gezet wordt en de app als het standaardmerk
    // blijft installeren. Falen moet hier snel en zichtbaar in de fallback landen.
    const timer = setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      resolve(null);
    }, LOGO_LOAD_TIMEOUT_MS);

    const finish = (result: HTMLImageElement | null) => {
      clearTimeout(timer);
      resolve(result);
    };

    // Zonder crossOrigin blijft het canvas tainted en gooit toDataURL een SecurityError.
    image.crossOrigin = 'anonymous';
    image.onload = () => finish(image);
    image.onerror = () => finish(null);
    image.src = url;
  });
}

async function iconsForLogo(logoUrl?: string | null) {
  if (!logoUrl) return STATIC_ICONS;

  const image = await loadImage(logoUrl);
  if (!image?.naturalWidth) return STATIC_ICONS;

  const rendered = await Promise.all(
    ICON_SIZES.map(async (size) => {
      const dataUrl = await renderIcon(image, size);
      return dataUrl ? { src: dataUrl, sizes: `${size}x${size}`, type: 'image/png' } : null;
    }),
  );

  const usable = rendered.filter((icon): icon is NonNullable<typeof icon> => icon !== null);
  return usable.length === ICON_SIZES.length ? usable : STATIC_ICONS;
}

function setMeta(name: string, content: string) {
  let tag = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!tag) {
    tag = document.createElement('meta');
    tag.name = name;
    document.head.appendChild(tag);
  }
  tag.content = content;
}

/**
 * Vervangt het document-manifest door een variant voor deze organisatie.
 * Veilig om herhaald aan te roepen; doet niets zonder organisatienaam.
 */
export async function applyOrgManifest(org: OrgManifestInput): Promise<void> {
  const name = org.name?.trim();
  if (!name || typeof document === 'undefined') return;

  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  if (!link) return;

  const themeColor = hslTripletToHex(org.accentColor ?? null) ?? DEFAULT_THEME_COLOR;
  const icons = await iconsForLogo(org.logoUrl);

  const manifest = {
    name,
    short_name: name.length > 12 ? name.slice(0, 12).trim() : name,
    description: `${name} — personeelssoftware`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    lang: 'nl',
    theme_color: themeColor,
    background_color: DEFAULT_BACKGROUND_COLOR,
    icons,
  };

  const blobUrl = URL.createObjectURL(
    new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }),
  );

  link.href = blobUrl;
  if (activeManifestUrl) URL.revokeObjectURL(activeManifestUrl);
  activeManifestUrl = blobUrl;

  // iOS leest het manifest niet voor "Zet op beginscherm" — die gebruikt deze meta
  // plus de apple-touch-icon link.
  setMeta('apple-mobile-web-app-title', manifest.short_name);
  setMeta('theme-color', themeColor);

  const appleIcon = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
  const icon192 = icons.find((candidate) => candidate.sizes === '192x192');
  if (appleIcon && icon192) appleIcon.href = icon192.src;
}
