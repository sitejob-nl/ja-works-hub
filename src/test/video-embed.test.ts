import { describe, it, expect } from 'vitest';
import { toVideoEmbedUrl } from '@/lib/video-embed';

describe('toVideoEmbedUrl', () => {
  it('accepteert de gangbare YouTube-vormen', () => {
    const embed = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ';
    expect(toVideoEmbedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(embed);
    expect(toVideoEmbedUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(embed);
    expect(toVideoEmbedUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(embed);
    expect(toVideoEmbedUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(embed);
    expect(toVideoEmbedUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=30s')).toBe(embed);
  });

  it('accepteert Vimeo', () => {
    expect(toVideoEmbedUrl('https://vimeo.com/123456789')).toBe('https://player.vimeo.com/video/123456789');
    expect(toVideoEmbedUrl('https://player.vimeo.com/video/123456789')).toBe('https://player.vimeo.com/video/123456789');
  });

  it('negeert spaties eromheen', () => {
    expect(toVideoEmbedUrl('  https://youtu.be/dQw4w9WgXcQ  ')).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  });

  it('weigert andere hosts en niet-http schemas', () => {
    expect(toVideoEmbedUrl('https://evil.example.com/embed/xyz')).toBeNull();
    expect(toVideoEmbedUrl('javascript:alert(1)')).toBeNull();
    expect(toVideoEmbedUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    // Host moet exact matchen — geen suffix-truc.
    expect(toVideoEmbedUrl('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ')).toBeNull();
  });

  it('weigert lege en onzinnige waarden', () => {
    expect(toVideoEmbedUrl(null)).toBeNull();
    expect(toVideoEmbedUrl(undefined)).toBeNull();
    expect(toVideoEmbedUrl('')).toBeNull();
    expect(toVideoEmbedUrl('gewoon wat tekst')).toBeNull();
    expect(toVideoEmbedUrl('https://vimeo.com/niet-numeriek')).toBeNull();
    expect(toVideoEmbedUrl('https://www.youtube.com/watch?v=kort')).toBeNull();
  });
});
