import { describe, it, expect } from 'vitest';
import {
  buildInterestTemplatePayload,
  isInterestTemplate,
  previewInterestTemplate,
  quickReplyIndexes,
  sanitizeTemplateParam,
  type WhatsAppTemplateRow,
} from '@/lib/whatsapp-template';

const template = (components: any[], status = 'APPROVED'): WhatsAppTemplateRow => ({
  id: 't1',
  template_name: 'vacature_interesse',
  language: 'nl',
  category: 'UTILITY',
  status,
  components,
});

const INTEREST_TEMPLATE = template([
  { type: 'BODY', text: 'Hoi {{1}}, we hebben een baan voor je: {{2}}. Interesse?' },
  {
    type: 'BUTTONS',
    buttons: [
      { type: 'QUICK_REPLY', text: 'Ja, interesse' },
      { type: 'QUICK_REPLY', text: 'Nee, bedankt' },
    ],
  },
]);

describe('whatsapp-template helpers', () => {
  it('herkent een geschikte interesse-template (approved + ≥2 quick replies)', () => {
    expect(isInterestTemplate(INTEREST_TEMPLATE)).toBe(true);
    expect(isInterestTemplate(template([{ type: 'BODY', text: 'x' }]))).toBe(false);
    expect(isInterestTemplate({ ...INTEREST_TEMPLATE, status: 'PENDING' })).toBe(false);
  });

  it('bepaalt quick-reply-indexes over álle knoppen (Meta-indexering)', () => {
    const mixed = template([
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Site' },
          { type: 'QUICK_REPLY', text: 'Ja' },
          { type: 'QUICK_REPLY', text: 'Nee' },
        ],
      },
    ]);
    expect(quickReplyIndexes(mixed.components)).toEqual([1, 2]);
  });

  it('bouwt de payload met body-params en per-match button-payloads', () => {
    const p = buildInterestTemplatePayload(INTEREST_TEMPLATE, {
      firstName: 'Tomasz',
      vacancyTitle: 'CNC Frezer',
      matchId: 'match-123',
    });
    expect(p.name).toBe('vacature_interesse');
    expect(p.language).toBe('nl');
    const body = p.components!.find((c: any) => c.type === 'body');
    expect(body.parameters.map((x: any) => x.text)).toEqual(['Tomasz', 'CNC Frezer']);
    const buttons = p.components!.filter((c: any) => c.type === 'button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toMatchObject({ sub_type: 'quick_reply', index: '0' });
    expect(buttons[0].parameters[0].payload).toBe('match_ja:match-123');
    expect(buttons[1].parameters[0].payload).toBe('match_nee:match-123');
  });

  it('laat de body-component weg als de template geen variabelen heeft', () => {
    const noVars = template([
      { type: 'BODY', text: 'Vaste tekst zonder variabelen.' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Ja' }, { type: 'QUICK_REPLY', text: 'Nee' }] },
    ]);
    const p = buildInterestTemplatePayload(noVars, { firstName: 'A', vacancyTitle: 'B', matchId: 'm' });
    expect(p.components!.some((c: any) => c.type === 'body')).toBe(false);
    expect(p.components!.filter((c: any) => c.type === 'button')).toHaveLength(2);
  });

  it('sanitizet parameters (geen newlines/dubbele spaties, nooit leeg)', () => {
    expect(sanitizeTemplateParam('regel1\nregel2\t x')).toBe('regel1 regel2 x');
    expect(sanitizeTemplateParam('')).toBe('-');
    // Extra variabele ({{3}}) zonder pitch → '-'
    const withThree = template([
      { type: 'BODY', text: '{{1}} {{2}} {{3}}' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'Ja' }, { type: 'QUICK_REPLY', text: 'Nee' }] },
    ]);
    const p = buildInterestTemplatePayload(withThree, { firstName: 'A', vacancyTitle: 'B', matchId: 'm' });
    const body = p.components!.find((c: any) => c.type === 'body');
    expect(body.parameters.map((x: any) => x.text)).toEqual(['A', 'B', '-']);
  });

  it('previewt de body met ingevulde variabelen', () => {
    expect(previewInterestTemplate(INTEREST_TEMPLATE, { firstName: 'Tomasz', vacancyTitle: 'CNC Frezer' }))
      .toBe('Hoi Tomasz, we hebben een baan voor je: CNC Frezer. Interesse?');
  });
});
