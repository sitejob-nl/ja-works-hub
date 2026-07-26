import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { UI_DICTIONARY_EN } from '@/lib/ui-dictionary';
import { RECRUITER_UI_DICTIONARY_EN } from '@/lib/recruiter-ui-dictionary';

/** Zelfde normalisatie als TranslationContext toepast vóór het opzoeken. */
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();

function collectSourceLiterals(): Set<string> {
  const literals = new Set<string>();
  const sourceRoot = path.resolve(process.cwd(), 'src');

  const visitFile = (filePath: string) => {
    if (filePath.endsWith('ui-dictionary.ts')) return;
    const source = ts.createSourceFile(
      filePath,
      fs.readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const value = normalize(node.text);
        if (value) literals.add(value);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  };

  const walk = (directory: string) => {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) visitFile(fullPath);
    });
  };

  walk(sourceRoot);
  return literals;
}

describe('portaal-woordenboek', () => {
  it('heeft sleutels die exact matchen op de genormaliseerde DOM-tekst', () => {
    // Een sleutel met dubbele spaties of randspaties wordt nooit gevonden, want de
    // vertaler zoekt op de genormaliseerde tekst. Die fout is anders onzichtbaar.
    const kapot = Object.keys(UI_DICTIONARY_EN).filter((k) => k !== normalize(k));
    expect(kapot).toEqual([]);
  });

  it('heeft voor elke sleutel een niet-lege vertaling', () => {
    const leeg = Object.entries(UI_DICTIONARY_EN)
      .filter(([, v]) => !v || !v.trim())
      .map(([k]) => k);
    expect(leeg).toEqual([]);
  });

  it('bevat geen sleutel die aan zichzelf gelijk is', () => {
    // Zo'n regel vertaalt niets, maar kan wél per ongeluk op klantdata matchen.
    const noops = Object.entries(UI_DICTIONARY_EN)
      .filter(([k, v]) => k === v)
      .map(([k]) => k);
    expect(noops).toEqual([]);
  });

  it('bevat de kernnavigatie van het portaal', () => {
    expect(UI_DICTIONARY_EN['Uren']).toBe('Hours');
    expect(UI_DICTIONARY_EN['Huisvesting']).toBe('Housing');
    expect(UI_DICTIONARY_EN['Mijn uren deze week']).toBe('My hours this week');
  });

  it('bevat in de recruiteromgeving alleen hardcoded UI-brontekst', () => {
    const sourceLiterals = collectSourceLiterals();
    const nietHardcoded = Object.keys(RECRUITER_UI_DICTIONARY_EN)
      .filter((key) => !sourceLiterals.has(key));

    expect(nietHardcoded).toEqual([]);
  }, 15_000);

  it('laat bestaande vertalingen niet ongemerkt overschrijven', () => {
    const conflicten = Object.entries(RECRUITER_UI_DICTIONARY_EN)
      .filter(([key, value]) => UI_DICTIONARY_EN[key] !== value)
      .map(([key]) => key);

    expect(conflicten).toEqual([]);
  });
});
