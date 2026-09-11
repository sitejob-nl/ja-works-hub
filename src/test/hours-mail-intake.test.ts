import { describe, expect, it } from 'vitest';
import {
  createHoursMailIntakeHandler, type HoursMailPorts,
} from '../../supabase/functions/_shared/hours-mail-intake';

/**
 * The whole boundary of the unattended intake, without a mailbox, a bucket or a
 * session. Everything that decides sits behind a port, so what these tests
 * exercise is the real handler: which requests it makes, in which order, what it
 * refuses to do, and what it never touches.
 */

const FOLDER = {
  id: 'f1', organization_id: 'org-1', mail_account_id: 'acc-1',
  folder_id: 'AAMkFolder', folder_label: 'Uren', delta_link: null as string | null,
};
const DELTA = 'https://graph.microsoft.com/v1.0/me/mailFolders/AAMkFolder/messages/delta?$deltatoken=x';

function mail(body: string, extra: Record<string, string> = {}, parts?: string): string {
  const headers = {
    From: 'Planner <planner@klant.invalid>',
    Subject: 'RE: Uren week 37 [UR-7K3M-2XQ9]',
    'Message-ID': '<reply-1@klant.invalid>',
    'MIME-Version': '1.0',
    ...extra,
  };
  const head = Object.entries(headers).map(([name, value]) => `${name}: ${value}`).join('\r\n');
  return parts ?? `${head}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`;
}

interface Recorded { graph: string[]; uploads: { path: string; type: string }[]; rpc: [string, any][] }

function ports(overrides: Partial<HoursMailPorts> & { recorded?: Recorded } = {}) {
  const recorded: Recorded = overrides.recorded ?? { graph: [], uploads: [], rpc: [] };
  const week = {
    ok: true, week_id: 'week-1', company_id: 'company-1', week_start: '2026-09-07',
    request_id: 'req-1',
    context: {
      members: [{ id: 'mem-1', name: 'Jan Kowalski' }],
      days: [
        { id: 'day-1', member_id: 'mem-1', work_date: '2026-09-07' },
        { id: 'day-2', member_id: 'mem-1', work_date: '2026-09-08' },
      ],
    },
  };
  const base: HoursMailPorts = {
    authorize: async () => ({ mode: 'cron' }),
    serviceRpc: async (name, args) => {
      recorded.rpc.push([name, args]);
      switch (name) {
        case 'hours_mail_due_folders': return { data: [FOLDER], error: null };
        case 'hours_mail_record_messages': return { data: { ok: true, added: 1 }, error: null };
        case 'hours_mail_claim_messages': return {
          data: {
            ok: true, claim_token: 'token-1',
            messages: recorded.rpc.filter(([n]) => n === 'hours_mail_claim_messages').length > 1 ? []
              : [{ id: 'msg-1', graph_message_id: 'AAMkMsg1', message_key: '<reply-1@klant.invalid>',
                   subject: 'RE: Uren week 37 [UR-7K3M-2XQ9]', from_address: 'planner@klant.invalid',
                   conversation_id: 'AAQkConversation',
                   has_attachments: false, assigned_week_id: null, organization_id: 'org-1' }],
          }, error: null,
        };
        case 'hours_mail_match_message': return { data: week, error: null };
        case 'hours_mail_file_message': return { data: { ok: true, source_id: 'src-1', proposals: 1 }, error: null };
        default: return { data: { ok: true }, error: null };
      }
    },
    graphJson: async (_account, url) => {
      recorded.graph.push(url);
      return { status: 200, body: { value: [{ id: 'AAMkMsg1', internetMessageId: '<reply-1@klant.invalid>',
        conversationId: 'AAQkConversation',
        subject: 'RE: Uren week 37 [UR-7K3M-2XQ9]', from: { emailAddress: { address: 'planner@klant.invalid', name: 'Planner' } },
        receivedDateTime: '2026-09-14T08:00:00Z', hasAttachments: false }], '@odata.deltaLink': DELTA } };
    },
    graphBytes: async (_account, url) => {
      recorded.graph.push(url);
      return { status: 200, bytes: new TextEncoder().encode(mail('Jan Kowalski\nmaandag 8 uur')) };
    },
    upload: async (path, _bytes, type) => { recorded.uploads.push({ path, type }); },
    digest: async bytes => `sha-${bytes.byteLength}`.padEnd(64, '0'),
  };
  return { ports: { ...base, ...overrides } as HoursMailPorts, recorded, week };
}

const run = async (given: ReturnType<typeof ports>) =>
  createHoursMailIntakeHandler(given.ports)(new Request('https://x/hours-mail-intake', { method: 'POST' }));

describe('de onbeheerde mailinname', () => {
  it('haalt één antwoord op en legt het vast als bron met voorstel', async () => {
    const given = ports();
    const response = await run(given);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.folders).toBe(1);
    expect(body.filed).toBe(1);

    const filed = given.recorded.rpc.find(([name]) => name === 'hours_mail_file_message')![1];
    expect(filed.p_message_id).toBe('msg-1');
    expect(filed.p_source.content_type).toBe('message/rfc822');
    expect(filed.p_proposals).toHaveLength(1);
    expect(filed.p_proposals[0]).toMatchObject({ day_id: 'day-1', minutes: 480 });
  });

  it('vraagt de postbus nooit iets anders dan ophalen', async () => {
    const given = ports();
    await run(given);
    for (const url of given.recorded.graph) {
      expect(url).not.toMatch(/\/move$|\/copy$|\/send$/);
    }
    // The only two ports that touch the mailbox can only read; there is no
    // method parameter to pass and no other mailbox port to call.
    expect(Object.keys(given.ports).filter(name => name.startsWith('graph')).sort())
      .toEqual(['graphBytes', 'graphJson']);
  });

  it('bewaart het bericht op zijn eigen digest', async () => {
    const given = ports();
    await run(given);
    expect(given.recorded.uploads).toHaveLength(1);
    expect(given.recorded.uploads[0].path).toMatch(/^org-1\/week-1\/sha-\d+0*\.eml$/);
    expect(given.recorded.uploads[0].type).toBe('message/rfc822');
  });
});

describe('de duurzame cursor', () => {
  it('schrijft de cursor pas weg als de doorloop het einde haalde', async () => {
    const given = ports();
    await run(given);
    const cursor = given.recorded.rpc.find(([name]) => name === 'hours_mail_set_cursor')![1];
    expect(cursor.p_delta_link).toBe(DELTA);
    expect(cursor.p_resynced).toBe(false);
  });

  it('laat de cursor staan wanneer de doorloop halverwege omvalt', async () => {
    const given = ports({ graphJson: async () => ({ status: 503, body: {} }) });
    const response = await run(given);
    expect((await response.json()).errors).toEqual(['graph_503']);
    const cursor = given.recorded.rpc.find(([name]) => name === 'hours_mail_set_cursor')![1];
    expect(cursor.p_delta_link).toBeNull();
    expect(cursor.p_error).toBe('graph_503');
    expect(given.recorded.rpc.some(([name]) => name === 'hours_mail_claim_messages')).toBe(false);
  });

  it('hersynchroniseert volledig na een verlopen cursor, zonder tweede bron', async () => {
    let call = 0;
    const given = ports({
      graphJson: async (_account, url) => {
        call += 1;
        if (call === 1) {
          expect(url).toBe(DELTA);
          return { status: 410, body: { error: { code: 'SyncStateNotFound' } } };
        }
        expect(url).toContain('/messages/delta');
        return { status: 200, body: { value: [], '@odata.deltaLink': DELTA } };
      },
    });
    given.ports.serviceRpc = ((original) => async (name: string, args: any) => {
      if (name === 'hours_mail_due_folders') {
        given.recorded.rpc.push([name, args]);
        return { data: [{ ...FOLDER, delta_link: DELTA }], error: null };
      }
      return original(name, args);
    })(given.ports.serviceRpc.bind(given.ports)) as any;

    await run(given);
    const names = given.recorded.rpc.map(([name]) => name);
    expect(names).toContain('hours_mail_clear_cursor');
    const cursor = given.recorded.rpc.find(([name]) => name === 'hours_mail_set_cursor')![1];
    expect(cursor.p_resynced).toBe(true);
    expect(cursor.p_delta_link).toBe(DELTA);
  });

  it('volgt geen vervolglink die niet van Graph komt', async () => {
    const given = ports({
      graphJson: async () => ({ status: 200,
        body: { value: [], '@odata.nextLink': 'https://elders.invalid/next' } }),
    });
    await run(given);
    expect(given.recorded.graph).toHaveLength(1);
  });
});

describe('een bericht dat verdwijnt of niet te lezen is', () => {
  it('laat niets achter als het bericht tussen zien en ophalen weg is', async () => {
    const given = ports({ graphBytes: async () => ({ status: 404, bytes: new Uint8Array() }) });
    const body = await (await run(given)).json();
    expect(body.filed).toBe(0);
    const failed = given.recorded.rpc.find(([name]) => name === 'hours_mail_fail_message')![1];
    expect(failed.p_status).toBe('dismissed');
    expect(failed.p_reason_code).toBe('verdwenen');
    expect(given.recorded.uploads).toEqual([]);
    expect(given.recorded.rpc.some(([name]) => name === 'hours_mail_file_message')).toBe(false);
  });

  it('geeft de claim terug bij een tijdelijke storing, zonder de bak te vullen', async () => {
    const given = ports({ graphBytes: async () => ({ status: 503, bytes: new Uint8Array() }) });
    const body = await (await run(given)).json();
    expect(body.attention).toBe(0);
    expect(given.recorded.rpc.some(([name]) => name === 'hours_mail_release_message')).toBe(true);
    expect(given.recorded.rpc.some(([name]) => name === 'hours_mail_fail_message')).toBe(false);
  });

  it('meldt een onleesbaar bericht bij naam', async () => {
    const given = ports({
      graphBytes: async () => ({ status: 200, bytes: new TextEncoder().encode('dit is geen mail') }),
    });
    await run(given);
    const failed = given.recorded.rpc.find(([name]) => name === 'hours_mail_fail_message')![1];
    expect(failed.p_reason_code).toBe('niet_leesbaar');
    expect(given.recorded.uploads).toEqual([]);
  });
});

describe('de controlebak', () => {
  it('neemt de reden van de kern letterlijk over', async () => {
    const given = ports();
    given.ports.serviceRpc = ((original) => async (name: string, args: any) => {
      if (name === 'hours_mail_match_message') {
        given.recorded.rpc.push([name, args]);
        return { data: { ok: false, reason_code: 'onbekende_afzender' }, error: null };
      }
      return original(name, args);
    })(given.ports.serviceRpc.bind(given.ports)) as any;

    const body = await (await run(given)).json();
    expect(body.attention).toBe(1);
    const failed = given.recorded.rpc.find(([name]) => name === 'hours_mail_fail_message')![1];
    expect(failed.p_reason_code).toBe('onbekende_afzender');
    expect(given.recorded.uploads).toEqual([]);
    expect(given.recorded.rpc.some(([name]) => name === 'hours_mail_file_message')).toBe(false);
  });

  it('stuurt de code uit het onderwerp mee, en niets uit de geciteerde geschiedenis', async () => {
    const quoted = 'maandag 8 uur\n\n> Van: JA Werkt\n> Onderwerp: Uren week 36 [UR-9999-8888]';
    const given = ports({
      graphBytes: async () => ({ status: 200, bytes: new TextEncoder().encode(mail(`Jan Kowalski\n${quoted}`)) }),
    });
    await run(given);
    const matched = given.recorded.rpc.find(([name]) => name === 'hours_mail_match_message')![1];
    expect(matched.p_codes).toEqual(['UR-7K3M-2XQ9']);
  });
});

const withAttachment = (fileName: string, type: string, base64: string, inline = false) => {
  const boundary = 'grens42';
  const head = [
    'From: Planner <planner@klant.invalid>',
    'Subject: RE: Uren week 37 [UR-7K3M-2XQ9]',
    'Message-ID: <reply-1@klant.invalid>',
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ].join('\r\n');
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Jan Kowalski',
    'maandag 8 uur',
    `--${boundary}`,
    `Content-Type: ${type}; name="${fileName}"`,
    'Content-Transfer-Encoding: base64',
    inline ? 'Content-Disposition: inline' : `Content-Disposition: attachment; filename="${fileName}"`,
    ...(inline ? ['Content-ID: <logo@klant.invalid>'] : []),
    '',
    base64,
    `--${boundary}--`,
  ].join('\r\n');
  return `${head}\r\n\r\n${body}\r\n`;
};

/** A zip container: the first two bytes are what decides an .xlsx. */
const XLSX_BASE64 = btoa('PKsynthetische werkmap');
const PNG_BASE64 = btoa('\x89PNG synthetisch logo');

describe('een bericht met bijlagen is een ontvangst', () => {
  it('bewaart een werkmap als bron naast het bericht', async () => {
    const given = ports({
      graphBytes: async () => ({ status: 200,
        bytes: new TextEncoder().encode(withAttachment('week37.xlsx', 'application/octet-stream', XLSX_BASE64)) }),
    });
    await run(given);
    const filed = given.recorded.rpc.find(([name]) => name === 'hours_mail_file_message')![1];
    expect(filed.p_attachments).toHaveLength(1);
    expect(filed.p_attachments[0]).toMatchObject({
      file_name: 'week37.xlsx', page_count: null,
      content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    expect(given.recorded.uploads.map((upload: { type: string }) => upload.type).sort())
      .toEqual(['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'message/rfc822']);
  });

  it('bewaart een handtekeningafbeelding niet als bron', async () => {
    const given = ports({
      graphBytes: async () => ({ status: 200,
        bytes: new TextEncoder().encode(withAttachment('logo.png', 'image/png', PNG_BASE64, true)) }),
    });
    await run(given);
    const filed = given.recorded.rpc.find(([name]) => name === 'hours_mail_file_message')![1];
    expect(filed.p_attachments).toEqual([]);
  });

  it('bewaart een bijlage waarvan de bytes niet bij het type passen niet', async () => {
    const given = ports({
      graphBytes: async () => ({ status: 200,
        bytes: new TextEncoder().encode(withAttachment('week37.xlsx', 'application/vnd.ms-excel', btoa('gewoon tekst'))) }),
    });
    await run(given);
    const filed = given.recorded.rpc.find(([name]) => name === 'hours_mail_file_message')![1];
    expect(filed.p_attachments).toEqual([]);
  });

  it('roept nooit een betaalde uitlezer aan voor een bijlage', async () => {
    const given = ports({
      graphBytes: async () => ({ status: 200,
        bytes: new TextEncoder().encode(withAttachment('week37.xlsx', 'application/octet-stream', XLSX_BASE64)) }),
    });
    await run(given);
    expect(given.recorded.rpc.map(([name]) => name).filter((name: string) => /reading|scan|ai_usage|credits/i.test(name))).toEqual([]);
  });
});

describe('wie de inname mag draaien', () => {
  it('draait in gebruikersmodus alleen over de eigen organisatie', async () => {
    const given = ports({ authorize: async () => ({ mode: 'user', organizationId: 'org-2' }) });
    given.ports.serviceRpc = ((original: any) => async (name: string, args: any) => {
      if (name === 'hours_mail_due_folders') {
        given.recorded.rpc.push([name, args]);
        return { data: [FOLDER, { ...FOLDER, id: 'f2', organization_id: 'org-2' }], error: null };
      }
      return original(name, args);
    })(given.ports.serviceRpc.bind(given.ports)) as any;

    const body = await (await run(given)).json();
    expect(body.folders).toBe(1);
    expect(given.recorded.rpc.filter(([name]) => name === 'hours_mail_set_cursor')
      .every(([, args]) => args.p_folder_row_id === 'f2')).toBe(true);
  });

  it('geeft het antwoord van de poort ongewijzigd terug', async () => {
    const refusal = new Response('nee', { status: 403 });
    const given = ports({ authorize: async () => refusal });
    expect(await run(given)).toBe(refusal);
    expect(given.recorded.rpc).toEqual([]);
  });

  it('accepteert alleen POST', async () => {
    const given = ports();
    const response = await createHoursMailIntakeHandler(given.ports)(
      new Request('https://x/hours-mail-intake', { method: 'GET' }));
    expect(response.status).toBe(405);
    expect(given.recorded.rpc).toEqual([]);
  });

  it('lekt niets wanneer er onderweg iets omvalt', async () => {
    const given = ports({ serviceRpc: async () => { throw new Error('geheime databasefout op tabel X'); } });
    const response = await run(given);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('geheime');
  });
});

describe('de bestandsnaam van een binnengehaald bericht', () => {
  it('houdt de schuine streep uit het onderwerp buiten de bestandsnaam', async () => {
    const given = ports({
      graphBytes: async () => ({ status: 200, bytes: new TextEncoder().encode(
        mail('Jan Kowalski\nmaandag 8 uur', { Subject: 'RE: uren 37/2026 [UR-7K3M-2XQ9]' })) }),
    });
    await run(given);
    const filed = given.recorded.rpc.find(([name]) => name === 'hours_mail_file_message')![1];
    expect(filed.p_source.file_name).toBe('RE: uren 37 2026 [UR-7K3M-2XQ9].eml');
  });

  it('valt terug op een naam wanneer het onderwerp leeg is', async () => {
    const given = ports({
      graphBytes: async () => ({ status: 200, bytes: new TextEncoder().encode(
        mail('Jan Kowalski\nmaandag 8 uur', { Subject: '' })) }),
    });
    await run(given);
    const filed = given.recorded.rpc.find(([name]) => name === 'hours_mail_file_message')![1];
    expect(filed.p_source.file_name).toBe('Bericht.eml');
  });
});


describe('bevindingen uit de eerste codereviewronde', () => {
  it('verzint geen notitie bij een correctie, want een notitie wordt letterlijk toegepast', async () => {
    const correction = 'Jan Kowalski\nmaandag 8 uur\nmaandag was geen 8 maar 6 uur';
    const given = ports({
      graphBytes: async () => ({ status: 200, bytes: new TextEncoder().encode(mail(correction)) }),
    });
    await run(given);
    const filed = given.recorded.rpc.find(([name]) => name === 'hours_mail_file_message')![1];
    expect(filed.p_proposals).toHaveLength(1);
    expect(filed.p_proposals[0].minutes).toBe(360);
    expect(filed.p_proposals[0].note).toBeNull();
  });

  it('laat de cursor staan wanneer het vastleggen van wat is gezien mislukt', async () => {
    const given = ports();
    given.ports.serviceRpc = ((original: any) => async (name: string, args: any) => {
      if (name === 'hours_mail_record_messages') {
        given.recorded.rpc.push([name, args]);
        return { data: null, error: { code: '22007', message: 'ongeldige datum' } };
      }
      return original(name, args);
    })(given.ports.serviceRpc.bind(given.ports)) as any;

    await run(given);
    const cursor = given.recorded.rpc.find(([name]) => name === 'hours_mail_set_cursor')![1];
    expect(cursor.p_delta_link).toBeNull();
    expect(cursor.p_error).toBeTruthy();
    // Nothing was claimed either: what was not recorded cannot be worked on.
    expect(given.recorded.rpc.some(([name]) => name === 'hours_mail_claim_messages')).toBe(false);
  });

  it('zet een te groot bericht meteen in de controlebak in plaats van het eeuwig te herhalen', async () => {
    const given = ports({ graphBytes: async () => ({ status: 413, bytes: new Uint8Array() }) });
    await run(given);
    const failed = given.recorded.rpc.find(([name]) => name === 'hours_mail_fail_message')![1];
    expect(failed.p_status).toBe('needs_attention');
    expect(failed.p_reason_code).toBe('niet_leesbaar');
    expect(given.recorded.rpc.some(([name]) => name === 'hours_mail_release_message')).toBe(false);
  });

  it('vraagt de database alleen om de eigen mappen bij een handmatige run', async () => {
    const given = ports({ authorize: async () => ({ mode: 'user', organizationId: 'org-2' }) });
    await run(given);
    const due = given.recorded.rpc.find(([name]) => name === 'hours_mail_due_folders')![1];
    expect(due.p_organization_id).toBe('org-2');
  });

  it('vraagt de database om alle organisaties bij een onbeheerde run', async () => {
    const given = ports();
    await run(given);
    const due = given.recorded.rpc.find(([name]) => name === 'hours_mail_due_folders')![1];
    expect(due.p_organization_id).toBeNull();
  });

  it('geeft de twijfel van de lezer mee, zodat een tegenspraak niet blind toepasbaar is', async () => {
    const given = ports();
    await run(given);
    const filed = given.recorded.rpc.find(([name]) => name === 'hours_mail_file_message')![1];
    expect(filed.p_proposals[0]).toHaveProperty('uncertain_fields');
  });
});


describe('bevindingen uit de tweede codereviewronde', () => {
  const many = (count: number, page: number) => ({
    status: 200,
    body: {
      value: Array.from({ length: count }, (_, index) => ({
        id: `AAMk${page}-${index}`,
        internetMessageId: `<p${page}-${index}@klant.invalid>`,
        subject: 'RE: uren [UR-7K3M-2XQ9]',
        from: { emailAddress: { address: 'planner@klant.invalid', name: 'Planner' } },
        receivedDateTime: '2026-09-14T08:00:00Z', hasAttachments: false,
      })),
      '@odata.nextLink': `https://graph.microsoft.com/v1.0/me/messages/delta?$skiptoken=p${page + 1}`,
    },
  });

  it('legt een grote map in stukken vast in plaats van in één te grote hap', async () => {
    let page = 0;
    const given = ports({
      graphJson: async () => {
        page += 1;
        return page < 3 ? many(300, page)
          : { status: 200, body: { value: [], '@odata.deltaLink': DELTA } };
      },
    });
    await run(given);
    const records = given.recorded.rpc.filter(([name]) => name === 'hours_mail_record_messages');
    expect(records.length).toBeGreaterThan(1);
    for (const [, args] of records) expect(args.p_messages.length).toBeLessThanOrEqual(200);
    expect(records.reduce((total, [, args]) => total + args.p_messages.length, 0)).toBe(600);
  });

  it('onthoudt waar een te lange doorloop gebleven was', async () => {
    const given = ports({ graphJson: async () => many(1, 1) });
    await run(given);
    const cursor = given.recorded.rpc.find(([name]) => name === 'hours_mail_set_cursor')![1];
    expect(cursor.p_delta_link).toMatch(/^https:\/\/graph\.microsoft\.com\//);
    expect(cursor.p_delta_link).toContain('skiptoken');
  });

  it('kapt een onmogelijk lange bericht-id af in plaats van de hele doorloop te laten vallen', async () => {
    const given = ports({
      graphJson: async () => ({ status: 200, body: {
        value: [{ id: 'A'.repeat(4000), internetMessageId: '<lang@klant.invalid>',
          subject: 'RE: uren', from: { emailAddress: { address: 'planner@klant.invalid' } },
          receivedDateTime: '2026-09-14T08:00:00Z', hasAttachments: false }],
        '@odata.deltaLink': DELTA } }),
    });
    await run(given);
    const record = given.recorded.rpc.find(([name]) => name === 'hours_mail_record_messages')![1];
    expect(record.p_messages[0].graph_message_id.length).toBeLessThanOrEqual(2048);
  });

  it('laat een onleesbare datum de hele doorloop niet meeslepen', async () => {
    const given = ports({
      graphJson: async () => ({ status: 200, body: {
        value: [{ id: 'AAMk1', internetMessageId: '<a@klant.invalid>', subject: 'RE: uren',
          from: { emailAddress: { address: 'planner@klant.invalid' } },
          receivedDateTime: 'geen datum', hasAttachments: false }],
        '@odata.deltaLink': DELTA } }),
    });
    await run(given);
    const record = given.recorded.rpc.find(([name]) => name === 'hours_mail_record_messages')![1];
    expect(record.p_messages[0].received_at).toBeNull();
  });

  it('verlengt de claim wanneer het ophalen lang duurde', async () => {
    const given = ports({
      graphBytes: async (_account: string, url: string) => {
        given.recorded.graph.push(url);
        return { status: 200,
          bytes: new TextEncoder().encode(mail('Jan Kowalski\nmaandag 8 uur')) };
      },
      now: (() => { let call = 0; return () => (call++ === 0 ? 0 : 200_000); })(),
    });
    await run(given);
    expect(given.recorded.rpc.some(([name]) => name === 'hours_mail_renew_lease')).toBe(true);
  });
});


describe('bevindingen uit de vierde codereviewronde', () => {
  const twoFolders = { data: [FOLDER, { ...FOLDER, id: 'f2', mail_account_id: 'acc-2' }], error: null };

  it('laat één kapotte postbus de andere niet meeslepen', async () => {
    const given = ports({
      graphJson: async (accountId: string, url: string) => {
        given.recorded.graph.push(url);
        if (accountId === 'acc-1') throw new Error('mail_account_not_found');
        return { status: 200, body: { value: [], '@odata.deltaLink': DELTA } };
      },
    });
    given.ports.serviceRpc = ((original: any) => async (name: string, args: any) => {
      if (name === 'hours_mail_due_folders') {
        given.recorded.rpc.push([name, args]);
        return twoFolders;
      }
      return original(name, args);
    })(given.ports.serviceRpc.bind(given.ports)) as any;

    const response = await run(given);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.folders).toBe(2);
    expect(body.errors).toContain('folder_failed');
    // The healthy mailbox was still read to its end.
    const cursors = given.recorded.rpc.filter(([name]) => name === 'hours_mail_set_cursor');
    expect(cursors.some(([, args]) => args.p_folder_row_id === 'f2' && args.p_delta_link === DELTA))
      .toBe(true);
  });

  it('laat één onverwacht kapot bericht de rest van de map niet blokkeren', async () => {
    let call = 0;
    const given = ports({
      graphBytes: async () => {
        call += 1;
        if (call === 1) throw new Error('netwerk viel weg');
        return { status: 200, bytes: new TextEncoder().encode(mail('Jan Kowalski\nmaandag 8 uur')) };
      },
    });
    given.ports.serviceRpc = ((original: any) => async (name: string, args: any) => {
      if (name === 'hours_mail_claim_messages') {
        given.recorded.rpc.push([name, args]);
        const round = given.recorded.rpc.filter(([n]) => n === 'hours_mail_claim_messages').length;
        return round > 2 ? { data: { ok: true, claim_token: 't', messages: [] }, error: null }
          : { data: { ok: true, claim_token: `token-${round}`, messages: [{
              id: `msg-${round}`, graph_message_id: `AAMk${round}`, message_key: `<m${round}@k.invalid>`,
              subject: 'RE: uren [UR-7K3M-2XQ9]', from_address: 'planner@klant.invalid',
              has_attachments: false, assigned_week_id: null, organization_id: 'org-1' }] }, error: null };
      }
      return original(name, args);
    })(given.ports.serviceRpc.bind(given.ports)) as any;

    const body = await (await run(given)).json();
    expect(body.filed).toBe(1);
    // The one that fell over handed its claim back instead of staying held.
    expect(given.recorded.rpc.some(([name, args]) =>
      name === 'hours_mail_release_message' && args.p_message_id === 'msg-1')).toBe(true);
  });
});


describe('bevindingen uit de zesde codereviewronde', () => {
  it('stuurt het gesprek-id mee, anders is het vierde vangnet dood', async () => {
    const given = ports();
    await run(given);
    const recorded = given.recorded.rpc.find(([name]) => name === 'hours_mail_record_messages')![1];
    expect(recorded.p_messages[0].conversation_id).toBe('AAQkConversation');
    const matched = given.recorded.rpc.find(([name]) => name === 'hours_mail_match_message')![1];
    expect(matched.p_conversation_id).toBe('AAQkConversation');
  });

  it('verlengt de claim niet voor een bericht dat toch al weg is', async () => {
    const given = ports({
      graphBytes: async () => ({ status: 404, bytes: new Uint8Array() }),
      now: (() => { let call = 0; return () => (call++ === 0 ? 0 : 200_000); })(),
    });
    await run(given);
    expect(given.recorded.rpc.some(([name]) => name === 'hours_mail_renew_lease')).toBe(false);
  });
});
