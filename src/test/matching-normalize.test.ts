import { describe, it, expect } from 'vitest';
import { normalizeSkillName } from '@/lib/matching';

describe('normalizeSkillName', () => {
  it('mapt aliassen naar de canonieke skill', () => {
    expect(normalizeSkillName('MIG')).toBe('mig mag lassen');
    expect(normalizeSkillName('Forklift')).toBe('heftruck');
    expect(normalizeSkillName('QC')).toBe('kwaliteitscontrole');
  });

  it('vangt samenstellingen en interpunctie-varianten', () => {
    expect(normalizeSkillName('mig-mag lasser')).toBe('mig mag lassen');
    expect(normalizeSkillName('heftruckchauffeur')).toBe('heftruck');
  });

  it('foldt hoofdletters en whitespace, ook zonder alias', () => {
    expect(normalizeSkillName('  Heftruck Rijden ')).toBe('heftruck');
    expect(normalizeSkillName('Lassen')).toBe('lassen');
  });
});
