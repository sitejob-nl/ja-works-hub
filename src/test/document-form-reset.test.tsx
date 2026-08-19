import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * De documentschermen delen één `form`-state tussen "Nieuw document" en "Bewerken".
 * Zonder reset opende "Nieuw document" ná een bewerksessie met de soort en naam van het
 * zojuist bewerkte document — waarna een upload onder de verkeerde naam werd opgeslagen.
 *
 * Een render-test zou hier fijner zijn, maar deze schermen hangen aan Supabase, storage
 * en TanStack Query. Daarom pinnen we het op de plek waar het misging: de knop die het
 * paneel opent moet de state eerst leegmaken.
 */
const bestanden = [
  'src/components/candidates/tabs/CandidateDocumentsTab.tsx',
  'src/components/companies/tabs/CompanyDocumentsTab.tsx',
];

describe('documentpaneel begint leeg', () => {
  it.each(bestanden)('%s reset het formulier bij "Nieuw document"', (relatief) => {
    const bron = fs.readFileSync(path.resolve(process.cwd(), relatief), 'utf8');

    // de klikafhandelaar van de knop die het toevoegpaneel opent
    const knop = bron.match(/onClick=\{\(\) =>[^}]*setAdding\(true\)[^}]*\}/);
    expect(knop, 'knop "Nieuw document" niet gevonden').not.toBeNull();

    expect(knop![0], 'setAdding(true) zonder het formulier te resetten').toContain('setForm(emptyForm)');
    expect(knop![0], 'een eerder gekozen bestand blijft hangen').toContain('setFile(null)');
  });

  it.each(bestanden)('%s heeft één gedeelde lege begintoestand', (relatief) => {
    const bron = fs.readFileSync(path.resolve(process.cwd(), relatief), 'utf8');
    expect(bron).toMatch(/const emptyForm = \{/);
    expect(bron, 'begintoestand los uitgeschreven i.p.v. via emptyForm').toContain('useState(emptyForm)');
  });
});
