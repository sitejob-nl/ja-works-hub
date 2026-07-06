import { describe, expect, it } from 'vitest';
import {
  extractContractTemplateVariables,
  getUnknownContractTemplateVariables,
  hasPlaceholderContractTemplateContent,
  renderContractTemplate,
  validateContractTemplateDefinition,
} from '@/lib/contract-templates';

describe('contract template variables', () => {
  it('haalt mergevelden uniek uit content', () => {
    expect(extractContractTemplateVariables('Hoi {{ employee_name }}, {{employee_name}} start op {{start_date}}')).toEqual([
      'employee_name',
      'start_date',
    ]);
  });

  it('detecteert onbekende variabelen', () => {
    expect(getUnknownContractTemplateVariables('Beste {{employee_name}} {{foo_bar}}')).toEqual(['foo_bar']);
  });

  it('rendert bekende waarden en markeert ontbrekende data', () => {
    const rendered = renderContractTemplate('Beste {{employee_name}}, start {{start_date}} als {{function_name}}.', {
      employee_name: 'Jan Jansen',
      start_date: '06-07-2026',
      function_name: '',
    });

    expect(rendered.content).toContain('Jan Jansen');
    expect(rendered.content).toContain('[ontbreekt: Functie]');
    expect(rendered.missingVariables).toEqual(['function_name']);
    expect(rendered.unknownVariables).toEqual([]);
  });

  it('laat onbekende velden staan zodat contractaanmaak ze kan blokkeren', () => {
    const rendered = renderContractTemplate('Ref {{onbekend_veld}}', {});

    expect(rendered.content).toBe('Ref {{onbekend_veld}}');
    expect(rendered.unknownVariables).toEqual(['onbekend_veld']);
  });

  it('blokkeert actieve templates met placeholders of onbekende velden', () => {
    expect(validateContractTemplateDefinition('Arbeidsovereenkomst {{employee_name}}').canActivate).toBe(true);
    expect(validateContractTemplateDefinition('TODO {{employee_name}}').canActivate).toBe(false);
    expect(validateContractTemplateDefinition('Contract {{verkeerd}}').canActivate).toBe(false);
    expect(hasPlaceholderContractTemplateContent('Artikel 1 [invullen door administratie]')).toBe(true);
  });
});
