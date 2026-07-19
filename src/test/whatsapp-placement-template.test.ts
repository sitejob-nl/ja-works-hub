import { describe, it, expect } from 'vitest';
import {
  buildTemplatePayload,
  extractTemplateBodyText,
  renderTemplatePreview,
  sanitizeTemplateParam,
  templateVariableNumbers,
} from '../../supabase/functions/_shared/whatsapp-template.ts';
import {
  DEFAULT_WHATSAPP_AUTOMATION_SETTINGS,
  normalizeWhatsAppAutomationSettings,
} from '@/lib/whatsapp-automation';

// Template zoals Meta hem teruggeeft na goedkeuring.
const template = {
  template_name: 'plaatsing_bevestiging',
  language: 'nl',
  components: [
    { type: 'HEADER', format: 'TEXT', text: 'Plaatsingsbevestiging' },
    {
      type: 'BODY',
      text: 'Hoi {{1}}, je plaatsing als {{2}} bij {{3}} is bevestigd. Startdatum: {{4}}.',
    },
    { type: 'FOOTER', text: 'JA Werkt' },
  ],
};

describe('whatsapp-template helpers', () => {
  it('leest de body-tekst uit de componenten', () => {
    expect(extractTemplateBodyText(template.components)).toContain('je plaatsing als');
    expect(extractTemplateBodyText(null)).toBe('');
  });

  it('vindt variabelenummers oplopend en zonder duplicaten', () => {
    expect(templateVariableNumbers('{{2}} en {{1}} en nog eens {{2}}')).toEqual([1, 2]);
    expect(templateVariableNumbers('geen variabelen')).toEqual([]);
  });

  it('maakt parameters plat — Meta weigert newlines en dubbele spaties', () => {
    expect(sanitizeTemplateParam('Lasser\n  MIG/MAG')).toBe('Lasser MIG/MAG');
    expect(sanitizeTemplateParam('')).toBe('-');
    expect(sanitizeTemplateParam(null)).toBe('-');
  });

  it('vult body-parameters positioneel in de volgorde van de variabelen', () => {
    const payload = buildTemplatePayload(template, ['Jan', 'CNC-operator', 'Acme BV', '10-08-2026']);
    expect(payload.name).toBe('plaatsing_bevestiging');
    expect(payload.language).toBe('nl');
    const body = payload.components.find((c: any) => c.type === 'body');
    expect(body.parameters.map((p: any) => p.text)).toEqual([
      'Jan',
      'CNC-operator',
      'Acme BV',
      '10-08-2026',
    ]);
  });

  it('vult ontbrekende waarden met "-" zodat het aantal parameters blijft kloppen', () => {
    // Meta weigert de hele payload als het aantal parameters afwijkt van de goedkeuring.
    const payload = buildTemplatePayload(template, ['Jan']);
    const body = payload.components.find((c: any) => c.type === 'body');
    expect(body.parameters).toHaveLength(4);
    expect(body.parameters.slice(1).map((p: any) => p.text)).toEqual(['-', '-', '-']);
  });

  it('laat de body-component weg als de template geen variabelen heeft', () => {
    const zonderVars = { ...template, components: [{ type: 'BODY', text: 'Vaste tekst' }] };
    expect(buildTemplatePayload(zonderVars, [])).toMatchObject({ components: [] });
  });

  it('valt terug op taal nl als de template er geen heeft', () => {
    expect(buildTemplatePayload({ ...template, language: '' }, []).language).toBe('nl');
  });

  it('rendert een leesbare preview', () => {
    expect(renderTemplatePreview(template.components, ['Jan', 'CNC-operator', 'Acme BV', '10-08-2026']))
      .toBe('Hoi Jan, je plaatsing als CNC-operator bij Acme BV is bevestigd. Startdatum: 10-08-2026.');
  });
});

describe('automation-instellingen voor de plaatsingstemplate', () => {
  it('heeft standaard géén template — buiten 24u wordt er dan niets gestuurd', () => {
    expect(DEFAULT_WHATSAPP_AUTOMATION_SETTINGS.placement_employee_template_name).toBe('');
    expect(DEFAULT_WHATSAPP_AUTOMATION_SETTINGS.placement_client_template_name).toBe('');
  });

  it('behoudt een lege templatenaam i.p.v. terug te vallen op een default', () => {
    const s = normalizeWhatsAppAutomationSettings({ placement_employee_template_name: '   ' });
    expect(s.placement_employee_template_name).toBe('');
  });

  it('neemt een ingestelde template en variabelevolgorde over', () => {
    const s = normalizeWhatsAppAutomationSettings({
      placement_employee_template_name: 'plaatsing_bevestiging',
      placement_employee_template_vars: ['first_name', 'company_name'],
    });
    expect(s.placement_employee_template_name).toBe('plaatsing_bevestiging');
    expect(s.placement_employee_template_vars).toEqual(['first_name', 'company_name']);
  });

  it('valt terug op de standaardvolgorde bij rommelige invoer', () => {
    const s = normalizeWhatsAppAutomationSettings({ placement_client_template_vars: [null, '', 42] });
    expect(s.placement_client_template_vars).toEqual(
      DEFAULT_WHATSAPP_AUTOMATION_SETTINGS.placement_client_template_vars,
    );
  });
});
