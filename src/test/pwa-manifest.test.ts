import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOrgManifest } from '@/lib/pwa-manifest';

/**
 * jsdom heeft geen canvas, dus `getContext('2d')` geeft null. Dat is precies het pad dat
 * in productie ook kan optreden (CORS-blokkade op het logo, onleesbaar bestand) en waar
 * de app moet terugvallen op de gebouwde standaard-iconen: installeerbaarheid weegt
 * zwaarder dan een merk-icoon.
 */
function readManifest(): any {
  const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  const json = (URL.createObjectURL as any).mock.calls.at(-1)?.[0]?.__json;
  expect(link?.href).toBeTruthy();
  return json;
}

beforeEach(() => {
  document.head.innerHTML =
    '<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/pwa-192x192.png">';

  // Blob-inhoud is in jsdom niet synchroon uitleesbaar; we hangen de JSON aan het object
  // zodat de test kan controleren wát er in het manifest staat.
  vi.stubGlobal('Blob', class {
    __json: any;
    constructor(parts: string[]) {
      this.__json = JSON.parse(parts.join(''));
    }
  });
  vi.stubGlobal('URL', {
    createObjectURL: vi.fn((blob: any) => {
      (URL.createObjectURL as any).mock.calls.at(-1)[0].__json = blob.__json;
      return 'blob:manifest';
    }),
    revokeObjectURL: vi.fn(),
  });
});

describe('applyOrgManifest', () => {
  it('zet de organisatienaam in het manifest', async () => {
    await applyOrgManifest({ name: 'JA Werkt' });

    const manifest = readManifest();
    expect(manifest.name).toBe('JA Werkt');
    expect(manifest.short_name).toBe('JA Werkt');
  });

  it('kort een lange naam in voor short_name, want die staat onder het app-icoon', async () => {
    await applyOrgManifest({ name: 'Uitzendbureau Van Der Berg Brabant' });

    const manifest = readManifest();
    expect(manifest.name).toBe('Uitzendbureau Van Der Berg Brabant');
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(manifest.short_name).toBe('Uitzendburea');
  });

  it('rekent de accentkleur om naar hex voor theme_color', async () => {
    await applyOrgManifest({ name: 'Klant', accentColor: '0 100% 50%' });

    expect(readManifest().theme_color).toBe('#ff0000');
  });

  it('valt terug op de standaard theme-kleur bij een onbruikbare accentwaarde', async () => {
    await applyOrgManifest({ name: 'Klant', accentColor: 'niet-hsl' });

    expect(readManifest().theme_color).toBe('#0a1628');
  });

  // Een logo-URL die noch `load` noch `error` vuurt mag het manifest niet tegenhouden;
  // zonder de timeout in loadImage blijft applyOrgManifest hier eeuwig hangen en wordt
  // het manifest nooit gezet.
  it('valt binnen de timeout terug op de gebouwde PNG-iconen bij een hangend logo', async () => {
    vi.useFakeTimers();
    const pending = applyOrgManifest({ name: 'Klant', logoUrl: 'https://example.com/logo.png' });
    await vi.advanceTimersByTimeAsync(3000);
    await pending;
    vi.useRealTimers();

    const manifest = readManifest();
    expect(manifest.icons).toEqual([
      { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
    ]);
  });

  it('zet de iOS-titel, die het manifest niet leest', async () => {
    await applyOrgManifest({ name: 'JA Werkt' });

    const meta = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    expect(meta?.content).toBe('JA Werkt');
  });

  it('doet niets zonder organisatienaam, zodat het statische manifest blijft staan', async () => {
    await applyOrgManifest({ name: '  ' });

    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    expect(link?.getAttribute('href')).toBe('/manifest.webmanifest');
  });
});
