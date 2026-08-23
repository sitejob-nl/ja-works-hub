import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
// De Sentry-helper is server-side (Deno) maar heeft ZERO imports en leest env via
// globalThis — daarom hier direct testbaar, net als matching-core.ts.
import {
  parseDsn,
  scrubText,
  scrubDeep,
  buildEnvelope,
  sentryEnabled,
  captureEdgeException,
  cronCheckIn,
  withCronMonitor,
} from '../../supabase/functions/_shared/sentry.ts';

const DSN = 'https://abc123def456@o4509.ingest.de.sentry.io/4510';

/** Zet een nep-Deno.env neer zodat de env-gate aan kan in Node/vitest. */
function stubDenoEnv(vars: Record<string, string>) {
  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (k: string) => vars[k] },
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).Deno;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */

describe('parseDsn', () => {
  it('parseert een geldig DSN naar ingest-URL en auth-header', () => {
    const parsed = parseDsn(DSN);
    expect(parsed).not.toBeNull();
    expect(parsed!.publicKey).toBe('abc123def456');
    expect(parsed!.host).toBe('o4509.ingest.de.sentry.io');
    expect(parsed!.projectId).toBe('4510');
    expect(parsed!.envelopeUrl).toBe('https://o4509.ingest.de.sentry.io/api/4510/envelope/');
    expect(parsed!.authHeader).toBe(
      'Sentry sentry_version=7, sentry_key=abc123def456, sentry_client=jawerkt-edge/1.0',
    );
  });

  it('ondersteunt een pad-prefix (self-hosted) en een poort', () => {
    const parsed = parseDsn('http://key@sentry.intern:9000/pad/naar/42');
    expect(parsed!.envelopeUrl).toBe('http://sentry.intern:9000/pad/naar/api/42/envelope/');
    expect(parsed!.projectId).toBe('42');
  });

  it('weigert rommel en onvolledige DSNs', () => {
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn(null)).toBeNull();
    expect(parseDsn('')).toBeNull();
    expect(parseDsn('   ')).toBeNull();
    expect(parseDsn('geen-url-maar-tekst')).toBeNull();
    expect(parseDsn('https://sentry.io/4510')).toBeNull(); // geen public key
    expect(parseDsn('https://key@sentry.io')).toBeNull(); // geen project-id
    expect(parseDsn('https://key@sentry.io/')).toBeNull(); // leeg project-id
    expect(parseDsn('https://key@sentry.io/api/')).toBeNull(); // niet-numeriek project-id
    expect(parseDsn('ftp://key@sentry.io/4510')).toBeNull(); // ander protocol
    expect(parseDsn(42 as unknown as string)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('scrubText — AVG-maskering', () => {
  it('maskeert e-mailadressen', () => {
    expect(scrubText('mail naar jan.jansen@voorbeeld.nl aub')).toBe('mail naar [EMAIL] aub');
    expect(scrubText('J.Kowalski+werk@sub.domein.co.uk')).toBe('[EMAIL]');
  });

  it('maskeert NL telefoonnummers in alle gangbare notaties', () => {
    expect(scrubText('bel 0612345678')).toBe('bel [TELEFOON]');
    expect(scrubText('bel 06-12345678')).toBe('bel [TELEFOON]');
    expect(scrubText('bel 06 12 34 56 78')).toBe('bel [TELEFOON]');
    expect(scrubText('+31612345678')).toBe('[TELEFOON]');
    expect(scrubText('+31 6 12345678')).toBe('[TELEFOON]');
    expect(scrubText('0031612345678')).toBe('[TELEFOON]');
  });

  it('maskeert buitenlandse nummers (arbeidsmigranten: PL/RO/…)', () => {
    expect(scrubText('tel +48 123 456 789')).toBe('tel [TELEFOON]');
    expect(scrubText('tel +40721123456')).toBe('tel [TELEFOON]');
    expect(scrubText('tel +359 88 123 4567')).toBe('tel [TELEFOON]');
  });

  it('laat te korte cijferreeksen met een plus met rust', () => {
    expect(scrubText('temperatuur +12 graden')).toBe('temperatuur +12 graden');
  });

  it('maskeert kale 9-cijferige BSN-achtige reeksen (ook zonder 11-proef)', () => {
    expect(scrubText('bsn 123456782 ok')).toBe('bsn [BSN] ok');
    expect(scrubText('bsn 123456789 (11-proef fout)')).toBe('bsn [BSN] (11-proef fout)');
    expect(scrubText('order 12345678')).toBe('order 12345678'); // 8 cijfers → geen BSN
  });

  it('maskeert IBAN, met en zonder spaties, en eet het staartnummer niet als telefoon', () => {
    expect(scrubText('IBAN NL91ABNA0417164300 betaald')).toBe('IBAN [IBAN] betaald');
    expect(scrubText('NL91 ABNA 0417 1643 00')).toBe('[IBAN]');
    expect(scrubText('PL61109010140000071219812874')).toBe('[IBAN]');
  });

  it('maskeert JWT- en bearer-tokens', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(scrubText(jwt)).toBe('[TOKEN]');
    expect(scrubText(`Authorization: Bearer ${jwt}`)).not.toContain('eyJ');
    expect(scrubText('Bearer AbCdEf0123456789xyz')).toBe('Bearer [TOKEN]');
    expect(scrubText('service_role_key=sb_secret_abcdef1234567890')).not.toContain('abcdef1234567890');
    expect(scrubText('api_key: 9f8e7d6c5b4a3210')).toBe('api_key: [TOKEN]');
  });

  it('kapt extreem lange strings af en gooit nooit', () => {
    const long = 'x'.repeat(20000);
    const out = scrubText(long);
    expect(out.length).toBeLessThan(5000);
    expect(out).toContain('afgekapt');
    expect(scrubText('' as string)).toBe('');
    expect(scrubText(undefined as unknown as string)).toBeUndefined();
    expect(scrubText(7 as unknown as string)).toBe(7);
  });

  it('is idempotent: nog een keer scrubben verandert niets meer', () => {
    const once = scrubText('jan@x.nl / 0612345678 / 123456782');
    expect(scrubText(once)).toBe(once);
  });
});

describe('scrubDeep', () => {
  it('redact sensitieve sleutels en scrubt PII in waarden', () => {
    const out = scrubDeep({
      bsn: '123456782',
      notitie: 'mail jan@x.nl of bel +48123456789',
      nested: { access_token: 'geheim', ref: 'order-42' },
      aantal: 3,
    });
    expect(out.bsn).toBe('[REDACTED]');
    expect(out.notitie).toBe('mail [EMAIL] of bel [TELEFOON]');
    expect(out.nested.access_token).toBe('[REDACTED]');
    expect(out.nested.ref).toBe('order-42');
    expect(out.aantal).toBe(3);
  });

  it('begrenst diepte en arraylengte en gooit nooit op circulaire structuren', () => {
    const diep = { a: { b: { c: { d: { e: 'te diep' } } } } };
    expect(JSON.stringify(scrubDeep(diep))).toContain('DIEPTE_LIMIET');

    const lang = scrubDeep(Array.from({ length: 50 }, (_, i) => i));
    expect(lang.length).toBe(21);
    expect(lang[20]).toContain('meer');

    const circulair: Record<string, unknown> = { naam: 'x' };
    circulair.zelf = circulair;
    expect(() => scrubDeep(circulair)).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */

describe('buildEnvelope', () => {
  it('serialiseert header / item-header / payload met byte-length', () => {
    const raw = buildEnvelope('check_in', { monitor_slug: 'x', status: 'ok' }, 'abc');
    const [envHeader, itemHeader, payload, trailing] = raw.split('\n');
    expect(JSON.parse(envHeader).event_id).toBe('abc');
    expect(JSON.parse(envHeader).sent_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const ih = JSON.parse(itemHeader);
    expect(ih.type).toBe('check_in');
    expect(ih.content_type).toBe('application/json');
    expect(ih.length).toBe(new TextEncoder().encode(payload).length);
    expect(JSON.parse(payload)).toEqual({ monitor_slug: 'x', status: 'ok' });
    expect(trailing).toBe(''); // afsluitende newline
  });
});

/* -------------------------------------------------------------------------- */

describe('no-op zonder DSN', () => {
  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).Deno;
  });

  it('sentryEnabled is false en er gaat geen enkele fetch de deur uit', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(sentryEnabled()).toBe(false);
    await expect(captureEdgeException(new Error('boem'), { fn: 'x' })).resolves.toBeUndefined();
    await expect(cronCheckIn({ monitorSlug: 'x', status: 'ok' })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sentryEnabled is ook false bij een onparseerbaar DSN', () => {
    stubDenoEnv({ SENTRY_DSN_EDGE: 'rommel' });
    expect(sentryEnabled()).toBe(false);
  });

  it('withCronMonitor draait het werk gewoon door en geeft het resultaat terug', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const out = await withCronMonitor({ monitorSlug: 'x', schedule: '0 6 * * *' }, async () => 42);
    expect(out).toBe(42);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('withCronMonitor laat de originele fout ongewijzigd door', async () => {
    const boem = new Error('kapot');
    await expect(
      withCronMonitor({ monitorSlug: 'x', schedule: '0 6 * * *' }, async () => {
        throw boem;
      }),
    ).rejects.toBe(boem);
  });
});

/* -------------------------------------------------------------------------- */

describe('met DSN (fetch gemockt — geen echt netwerk)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubDenoEnv({ SENTRY_DSN_EDGE: DSN, SENTRY_ENVIRONMENT: 'test' });
    fetchMock = vi.fn(async () => ({ text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);
  });

  const lastCall = () => {
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1] as [
      string,
      { headers: Record<string, string>; body: string; method: string },
    ];
    const lines = init.body.split('\n');
    return {
      url,
      init,
      envelopeHeader: JSON.parse(lines[0]),
      itemHeader: JSON.parse(lines[1]),
      payload: JSON.parse(lines[2]),
    };
  };

  it('sentryEnabled is true', () => {
    expect(sentryEnabled()).toBe(true);
  });

  it('captureEdgeException POST een gescrubd error-event naar de envelope-URL', async () => {
    await captureEdgeException(new Error('faalde voor jan@x.nl (0612345678)'), {
      fn: 'check-vehicle-apk',
      job: 'apk-daily',
      orgId: 'org-1',
      extra: { kenteken: 'AB-12-CD', bsn: '123456782' },
    });

    const { url, init, itemHeader, payload } = lastCall();
    expect(url).toBe('https://o4509.ingest.de.sentry.io/api/4510/envelope/');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Sentry-Auth']).toContain('sentry_key=abc123def456');
    expect(init.headers['Content-Type']).toBe('application/x-sentry-envelope');
    expect(itemHeader.type).toBe('event');

    expect(payload.level).toBe('error');
    expect(payload.platform).toBe('javascript');
    expect(payload.environment).toBe('test');
    expect(payload.server_name).toBe('supabase-edge');
    expect(payload.tags).toEqual({
      fn: 'check-vehicle-apk',
      job: 'apk-daily',
      organization_id: 'org-1',
    });
    expect(payload.exception.values[0].type).toBe('Error');
    expect(payload.exception.values[0].value).toBe('faalde voor [EMAIL] ([TELEFOON])');
    expect(payload.exception.values[0].stacktrace.frames.length).toBeGreaterThan(0);
    expect(payload.extra.bsn).toBe('[REDACTED]');
    // Nergens in de hele envelope mag ruwe PII staan.
    expect(init.body).not.toContain('jan@x.nl');
    expect(init.body).not.toContain('0612345678');
    expect(init.body).not.toContain('123456782');
  });

  it('cronCheckIn stuurt monitor_config mee bij in_progress en niet bij ok', async () => {
    const id = await cronCheckIn({
      monitorSlug: 'check-vehicle-apk',
      status: 'in_progress',
      schedule: '45 2 * * *',
      maxRuntimeMinutes: 15,
      checkinMarginMinutes: 30,
    });
    expect(id).toMatch(/^[0-9a-f]{32}$/);

    let call = lastCall();
    expect(call.itemHeader.type).toBe('check_in');
    expect(call.payload.check_in_id).toBe(id);
    expect(call.payload.monitor_slug).toBe('check-vehicle-apk');
    expect(call.payload.status).toBe('in_progress');
    expect(call.payload.monitor_config).toEqual({
      schedule: { type: 'crontab', value: '45 2 * * *' },
      timezone: 'Europe/Amsterdam',
      checkin_margin: 30,
      max_runtime: 15,
    });

    await cronCheckIn({ monitorSlug: 'check-vehicle-apk', status: 'ok', checkInId: id!, duration: 1.5 });
    call = lastCall();
    expect(call.payload.monitor_config).toBeUndefined();
    expect(call.payload.check_in_id).toBe(id);
    expect(call.payload.duration).toBe(1.5);
  });

  it('withCronMonitor stuurt in_progress + ok met hetzelfde check_in_id', async () => {
    const out = await withCronMonitor(
      { monitorSlug: 'housing-reminder', schedule: '30 2 * * *', fn: 'housing-reminder-cron' },
      async () => 'klaar',
    );
    expect(out).toBe('klaar');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const payloads = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body.split('\n')[2]));
    expect(payloads[0].status).toBe('in_progress');
    expect(payloads[1].status).toBe('ok');
    expect(payloads[1].check_in_id).toBe(payloads[0].check_in_id);
    expect(typeof payloads[1].duration).toBe('number');
  });

  it('withCronMonitor stuurt error-check-in + exception en gooit de originele fout door', async () => {
    const boem = new Error('cron kapot');
    await expect(
      withCronMonitor({ monitorSlug: 'doc-expiry', schedule: '0 6 * * *', fn: 'check-document-expiry' }, async () => {
        throw boem;
      }),
    ).rejects.toBe(boem);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const types = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body.split('\n')[1]).type);
    expect(types).toEqual(['check_in', 'check_in', 'event']);
    const errorCheckIn = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body.split('\n')[2]);
    expect(errorCheckIn.status).toBe('error');
    const event = JSON.parse((fetchMock.mock.calls[2][1] as { body: string }).body.split('\n')[2]);
    expect(event.tags).toEqual({ fn: 'check-document-expiry', job: 'doc-expiry' });
  });

  it('een falende Sentry-POST breekt niets (fail-open)', async () => {
    fetchMock.mockRejectedValue(new Error('netwerk down'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(captureEdgeException(new Error('x'))).resolves.toBeUndefined();
    await expect(cronCheckIn({ monitorSlug: 'x', status: 'ok' })).resolves.toMatch(/^[0-9a-f]{32}$/);
    await expect(withCronMonitor({ monitorSlug: 'x', schedule: '* * * * *' }, async () => 1)).resolves.toBe(1);
  });
});
