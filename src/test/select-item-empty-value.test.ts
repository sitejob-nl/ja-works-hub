import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/**
 * Radix Select (@radix-ui/react-select v2) gooit een runtime-error zodra een <SelectItem> een lege
 * string als value krijgt: de lege string is gereserveerd om de selectie te wissen en de placeholder
 * te tonen. De items renderen pas wanneer de dropdown opengaat, dus zo'n fout is onzichtbaar tot een
 * gebruiker klikt — en crasht dan het hele scherm.
 *
 * Dit is precies wat er gebeurde met "Heel pand" bij het aanmaken van een huisvestingsinspectie en
 * met de sector-/contracttype-filters in de compliance-instellingen. Gebruik een sentinel-waarde
 * (zoals `__whole_property__` of `__any__`) en vertaal die bij opslaan terug naar '' of null.
 */
function findEmptySelectItemValues(): string[] {
  const offenders: string[] = [];
  const sourceRoot = path.resolve(process.cwd(), 'src');

  const visitFile = (filePath: string) => {
    const source = ts.createSourceFile(
      filePath,
      fs.readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );

    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (node.tagName.getText(source) === 'SelectItem') {
          for (const prop of node.attributes.properties) {
            if (!ts.isJsxAttribute(prop) || prop.name.getText(source) !== 'value') continue;
            const init = prop.initializer;
            const isEmptyString =
              (init && ts.isStringLiteral(init) && init.text === '') ||
              (init &&
                ts.isJsxExpression(init) &&
                init.expression &&
                (ts.isStringLiteral(init.expression) || ts.isNoSubstitutionTemplateLiteral(init.expression)) &&
                init.expression.text === '');
            if (isEmptyString) {
              const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
              offenders.push(`${path.relative(sourceRoot, filePath)}:${line + 1}`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  };

  const walk = (directory: string) => {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.name.endsWith('.tsx')) visitFile(fullPath);
    });
  };

  walk(sourceRoot);
  return offenders;
}

describe('Radix SelectItem', () => {
  it('gebruikt nergens een lege string als value (crasht de dropdown bij openen)', () => {
    expect(findEmptySelectItemValues()).toEqual([]);
  });
});
