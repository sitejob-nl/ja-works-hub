import { describe, expect, it } from 'vitest';
// De scoring-kern is server-side en gedeeld; we testen 'm hier rechtstreeks (pure module).
import {
  scoreMatch,
  passesShortlist,
  normalizeSkillName,
  haversineKm,
} from '../../supabase/functions/_shared/matching-core.ts';

describe('matching-v3 core', () => {
  it('scoort een sterke kandidaat hoog (skills + cert + rijbewijs + dichtbij) zonder blokkers', () => {
    const score = scoreMatch(
      {
        skills: ['MIG-MAG lassen', 'Heftruck'],
        certifications: ['VCA'],
        has_drivers_license: true,
        availability_notes: 'Per direct beschikbaar',
        languages: ['Nederlands'],
        has_dutch_address: true,
      },
      {
        title: 'MIG-MAG lasser',
        required_skills: ['MIG-MAG lassen', 'Heftruck'],
        required_certifications: ['VCA'],
        requires_drivers_license: true,
      },
      { km: 8, durationMin: 24, status: 'ok' },
    );
    expect(score.hardBlocks).toEqual([]);
    expect(score.label).toBe('groen');
    expect(score.matchPercent).toBeGreaterThanOrEqual(90);
    expect(score.skillMatches).toEqual(['MIG-MAG lassen', 'Heftruck']);
    expect(score.certificationMatches).toEqual(['VCA']);
    expect(score.bonuses).toContain('Spreekt Nederlands');
    expect(score.bonuses).toContain('Eigen accommodatie in NL');
  });

  it('prefereert de canonieke skill-catalogus boven losse tekst-arrays', () => {
    const score = scoreMatch(
      { skills: ['iets anders'], canonical_skills: ['MIG-MAG lassen'] },
      { title: 'Lasser', required_skills: ['MIG-MAG lassen'] },
    );
    expect(score.skillMatches).toEqual(['MIG-MAG lassen']);
    expect(score.hardBlocks).toEqual([]);
  });

  it('blokkeert NIET als de afstand volledig ontbreekt (telt dan niet mee)', () => {
    const score = scoreMatch(
      { skills: ['productie'], availability_notes: 'beschikbaar' },
      { title: 'Productiemedewerker', required_skills: ['productie'] },
      undefined,
    );
    expect(score.hardBlocks).toEqual([]);
    expect(score.componentScores.distance).toBeUndefined();
    expect(score.missing.some((m) => m.toLowerCase().includes('afstand'))).toBe(true);
  });

  it('laat dichtbij boven onbekende locatie ranken (afstand telt alleen mee als bekend)', () => {
    const vacancy = { title: 'Productiemedewerker', required_skills: ['productie'] };
    const dichtbij = scoreMatch({ skills: ['productie'] }, vacancy, { km: 5, status: 'estimated' });
    const onbekend = scoreMatch({ skills: ['productie'] }, vacancy, { status: 'missing_coords' });
    // Onbekende locatie wordt NIET gestraft (afstand telt niet mee), maar een bekend dichtbij-adres
    // levert een positieve bijdrage → dichtbij rankt hoger, zonder de onbekende omlaag te trekken.
    expect(onbekend.componentScores.distance).toBeUndefined();
    expect(dichtbij.matchPercent).toBeGreaterThan(onbekend.matchPercent);
  });

  it('maakt een eisloze vacature nooit vals "groen" zonder gematchte harde eis', () => {
    const score = scoreMatch(
      { ai_function_group: 'productie', availability_notes: 'beschikbaar' },
      { title: 'Productiemedewerker', required_skills: [], required_certifications: [] },
    );
    // Functie-signaal + beschikbaarheid kunnen het % opdrijven, maar zonder gematchte harde eis
    // mag het label niet groen worden.
    expect(score.label).not.toBe('groen');
  });

  it('normaliseert veelvoorkomende blue-collar aliassen', () => {
    expect(normalizeSkillName('MIG/MAG')).toBe('mig mag lassen');
    expect(normalizeSkillName('VCA Basis')).toBe('vca');
    expect(normalizeSkillName('Forklift driver')).toBe('heftruck');
    expect(normalizeSkillName('Reachtruck chauffeur')).toBe('reachtruck');
    expect(normalizeSkillName('Quality Control')).toBe('kwaliteitscontrole');
    expect(normalizeSkillName('Schoonmaker')).toBe('schoonmaken');
  });

  it('matcht org-aliassen die als argument worden meegegeven', () => {
    const score = scoreMatch(
      { skills: ['poetsen'] },
      { title: 'Schoonmaak', required_skills: ['schoonmaken'] },
      undefined,
      { poetsen: 'schoonmaken' },
    );
    expect(score.skillMatches).toEqual(['schoonmaken']);
  });

  it('hard-blokt + verbergt kandidaten zonder skill-match en met ontbrekend certificaat', () => {
    const score = scoreMatch(
      { skills: ['administratie'] },
      { title: 'Lasser', required_skills: ['MIG-MAG lassen'], required_certifications: ['VCA'] },
    );
    expect(score.label).toBe('rood');
    expect(score.matchPercent).toBeLessThanOrEqual(30);
    expect(score.hardBlocks).toContain('Geen match op verplichte vaardigheden');
    expect(score.hardBlocks.some((b) => b.includes('VCA'))).toBe(true);
    expect(passesShortlist(score)).toBe(false);
    expect(passesShortlist(score, true)).toBe(true);
  });

  it('blaast scores NIET op bij een vacature zonder eisen (geen gratis punten)', () => {
    const score = scoreMatch(
      { skills: ['lassen'] }, // geen functie-signaal, geen coords, geen beschikbaarheid
      { title: 'Magazijnmedewerker', required_skills: [], required_certifications: [] },
    );
    // Oud model gaf hier ~55% gratis (skills 35 + certs 20). Nu laag.
    expect(score.matchPercent).toBeLessThan(45);
  });

  it('Nederlands spreken is een pluspunt (hogere score, geen straf bij afwezigheid)', () => {
    const base = { skills: ['productie'] };
    const vacancy = { title: 'Productiemedewerker', required_skills: ['productie'] };
    const zonder = scoreMatch({ ...base, languages: ['Pools'] }, vacancy);
    const met = scoreMatch({ ...base, languages: ['Pools', 'Nederlands'] }, vacancy);
    expect(met.matchPercent).toBeGreaterThan(zonder.matchPercent);
  });

  it('herkent Nederlands ook met niveau-suffix ("Nederlands - B1")', () => {
    const score = scoreMatch(
      { skills: ['productie'], languages: ['Pools - Native', 'Nederlands - B1'] },
      { title: 'Productiemedewerker', required_skills: ['productie'] },
    );
    expect(score.bonuses).toContain('Spreekt Nederlands');
  });

  it('eigen accommodatie (has_dutch_address) is een pluspunt', () => {
    const base = { skills: ['productie'] };
    const vacancy = { title: 'Productiemedewerker', required_skills: ['productie'] };
    const zonder = scoreMatch({ ...base }, vacancy);
    const met = scoreMatch({ ...base, has_dutch_address: true }, vacancy);
    expect(met.matchPercent).toBeGreaterThan(zonder.matchPercent);
  });

  it('weegt beschikbaarheidsdatum positief als kandidaat voor de startdatum beschikbaar is', () => {
    const score = scoreMatch(
      { skills: ['productie'], available_from: '2026-06-01' },
      { title: 'Productiemedewerker', required_skills: ['productie'], start_date: '2026-06-15' },
    );
    expect(score.componentScores.availability).toBeGreaterThan(0);
    expect(score.positives.some((p) => p.includes('2026-06-01'))).toBe(true);
    expect(score.missing.some((m) => m.toLowerCase().includes('beschikbaar'))).toBe(false);
  });

  it('markeert beschikbaarheid als twijfel wanneer de kandidaat kort na de startdatum kan beginnen', () => {
    const score = scoreMatch(
      { skills: ['productie'], available_from: '2026-06-20' },
      { title: 'Productiemedewerker', required_skills: ['productie'], start_date: '2026-06-15' },
    );
    expect(score.componentScores.availability).toBeGreaterThan(0);
    expect(score.componentScores.availability).toBeLessThan(5);
    expect(score.missing.some((m) => m.includes('na startdatum'))).toBe(true);
  });

  it('blokkeert een match als de beschikbaarheidsperiode voor de startdatum eindigt', () => {
    const score = scoreMatch(
      { skills: ['productie'], available_from: '2026-05-01', available_until: '2026-06-01' },
      { title: 'Productiemedewerker', required_skills: ['productie'], start_date: '2026-06-15' },
    );
    expect(score.hardBlocks).toContain('Beschikbaarheidsperiode eindigt voor startdatum');
    expect(score.label).toBe('rood');
    expect(passesShortlist(score)).toBe(false);
  });

  it('blijft oude beschikbaarheidsnotities als fallback accepteren', () => {
    const score = scoreMatch(
      { skills: ['productie'], availability_notes: 'Per direct beschikbaar' },
      { title: 'Productiemedewerker', required_skills: ['productie'], start_date: '2026-06-15' },
    );
    expect(score.componentScores.availability).toBeGreaterThan(0);
    expect(score.positives).toContain('Beschikbaarheid ingevuld');
  });

  it('houdt kandidaatkwaliteit LOS van de matchscore', () => {
    const vacancy = { title: 'Productiemedewerker', required_skills: ['productie'] };
    const laag = scoreMatch({ skills: ['productie'], ai_reliability_score: 3 }, vacancy);
    const hoog = scoreMatch({ skills: ['productie'], ai_reliability_score: 9 }, vacancy);
    // Matchscore identiek (kwaliteit telt niet mee), maar candidateQuality verschilt.
    expect(hoog.matchPercent).toBe(laag.matchPercent);
    expect(hoog.candidateQuality).toBe(90);
    expect(laag.candidateQuality).toBe(30);
  });

  it('rijbewijs is GEEN harde blokker: skill-matcher zonder rijbewijs blijft zichtbaar', () => {
    const vacancy = { title: 'TIG Lasser', required_skills: ['lassen'], requires_drivers_license: true };
    const zonder = scoreMatch({ skills: ['lassen'], has_drivers_license: false }, vacancy);
    const met = scoreMatch({ skills: ['lassen'], has_drivers_license: true }, vacancy);
    expect(zonder.hardBlocks).toEqual([]);
    expect(zonder.missing.some((m) => m.toLowerCase().includes('rijbewijs'))).toBe(true);
    expect(passesShortlist(zonder)).toBe(true);
    expect(met.bonuses).toContain('Rijbewijs aanwezig');
    expect(met.matchPercent).toBeGreaterThan(zonder.matchPercent);
  });

  it('functie-groep-guard: specialist zonder vak-match op een generieke rol wordt gecapt', () => {
    // Generieke productievacature zonder skill-eisen; kandidaat woont dichtbij (zou anders hoog scoren).
    const vacancy = { title: 'Productiemedewerker verwerking', required_skills: [] as string[] };
    const dichtbij = { km: 5, status: 'estimated' as const };
    const specialist = scoreMatch(
      { ai_classification: 'specialist', skills: ['Naval Shipyards', 'elektromechanica'], availability_notes: 'direct', has_dutch_address: true },
      vacancy,
      dichtbij,
    );
    expect(specialist.matchPercent).toBeLessThanOrEqual(40); // gecapt ondanks dichtbij
    expect(specialist.missing.some((m) => m.toLowerCase().includes('specialist'))).toBe(true);
    expect(passesShortlist(specialist)).toBe(false);
  });

  it('functie-groep-guard raakt GEEN productie-kandidaat (geen vals-negatief, blijft hoog)', () => {
    const vacancy = { title: 'Productiemedewerker verwerking', required_skills: [] as string[] };
    const dichtbij = { km: 5, status: 'estimated' as const };
    const productie = scoreMatch(
      { ai_classification: 'productie', skills: ['inpakken'], availability_notes: 'direct', has_dutch_address: true },
      vacancy,
      dichtbij,
    );
    expect(productie.missing.some((m) => m.toLowerCase().includes('specialist'))).toBe(false);
    expect(productie.matchPercent).toBeGreaterThan(40); // niet gecapt → blijft normaal scoren
  });

  it('functie-groep-guard raakt GEEN specialist mét skill-match', () => {
    const vacancy = { title: 'TIG Lasser', required_skills: ['lassen'] };
    const specialist = scoreMatch(
      { ai_classification: 'specialist', skills: ['lassen'], availability_notes: 'direct' },
      vacancy,
    );
    expect(specialist.missing.some((m) => m.toLowerCase().includes('specialist'))).toBe(false);
    expect(specialist.matchPercent).toBeGreaterThan(40);
  });

  it('functie-concept: CE/truck-driver-signaal matcht een vrachtwagenchauffeur-vacature (specialist niet gecapt)', () => {
    const vacancy = { title: 'Vrachtwagenchauffeur CE distributie', required_skills: [] as string[] };
    const dichtbij = { km: 5, status: 'estimated' as const };
    const chauffeur = scoreMatch(
      { ai_classification: 'specialist', ai_target_functions: ['Internationaal chauffeur'], skills: ['Code 95'], availability_notes: 'direct' },
      vacancy,
      dichtbij,
    );
    expect(chauffeur.componentScores.functionGroup).toBeGreaterThan(0); // truck-driver-concept herkend
    expect(chauffeur.missing.some((m) => m.toLowerCase().includes('specialist'))).toBe(false); // niet gecapt
    expect(chauffeur.matchPercent).toBeGreaterThan(40);
  });

  it('functie-concept: heftruck-kandidaat matcht NIET als vrachtwagenchauffeur (geen vals-positief)', () => {
    const vacancy = { title: 'Vrachtwagenchauffeur CE distributie', required_skills: [] as string[] };
    const heftruck = scoreMatch(
      { ai_target_functions: ['Heftruckchauffeur'], skills: ['Heftruck'] },
      vacancy,
    );
    expect(heftruck.componentScores.functionGroup).toBe(0);
  });

  it('rijbewijsklasse: een C/CE-rijbewijs matcht een chauffeursvacature, óók zonder expliciet doelfunctie-signaal', () => {
    const vacancy = { title: 'Vrachtwagenchauffeur CE distributie', required_skills: [] as string[] };
    const ceChauffeur = scoreMatch(
      { skills: ['magazijnwerk'], drivers_license_categories: ['CE'], availability_notes: 'direct' },
      vacancy,
      { km: 5, status: 'estimated' as const },
    );
    expect(ceChauffeur.componentScores.functionGroup).toBeGreaterThan(0); // zwaar rijbewijs = chauffeurssignaal
    expect(ceChauffeur.bonuses).toContain('Rijbewijs CE');
    expect(ceChauffeur.componentScores.licenseBonus).toBeGreaterThan(0);
  });

  it('rijbewijsklasse: alleen een B/BE-rijbewijs is GEEN chauffeurssignaal (geen vals-positief)', () => {
    const vacancy = { title: 'Vrachtwagenchauffeur CE distributie', required_skills: [] as string[] };
    const bRijbewijs = scoreMatch(
      { skills: ['magazijnwerk'], drivers_license_categories: ['B', 'BE'] },
      vacancy,
    );
    expect(bRijbewijs.componentScores.functionGroup).toBe(0);
    expect(bRijbewijs.bonuses.some((b) => b.toLowerCase().includes('rijbewijs'))).toBe(false);
  });

  it('rijbewijsklasse: een gecombineerde "C/CE"-waarde wordt gesplitst en als zwaar herkend', () => {
    const vacancy = { title: 'Internationaal chauffeur', required_skills: [] as string[] };
    const score = scoreMatch(
      { skills: ['magazijnwerk'], drivers_license_categories: ['B', 'C/CE'] },
      vacancy,
    );
    expect(score.componentScores.functionGroup).toBeGreaterThan(0);
    expect(score.bonuses).toContain('Rijbewijs C/CE');
  });

  it('recency (GAP2): recente relevante rol krijgt een pluspunt, oude relevante rol niet', () => {
    const vacancy = { title: 'Lasser MIG/MAG', required_skills: ['lassen'] };
    const cand = { skills: ['lassen'], most_recent_role: 'Lasser MIG MAG' };
    const recent = scoreMatch({ ...cand, most_recent_role_year: 2025 }, vacancy, undefined, undefined, { nowYear: 2026 });
    const oud = scoreMatch({ ...cand, most_recent_role_year: 2008 }, vacancy, undefined, undefined, { nowYear: 2026 });
    expect(recent.componentScores.recencyBonus).toBeGreaterThan(0);
    expect(recent.bonuses.some((b) => b.toLowerCase().includes('recent relevante ervaring'))).toBe(true);
    expect(oud.componentScores.recencyBonus).toBe(0); // oude ervaring: geen bonus, maar ook geen straf
    expect(recent.matchPercent).toBeGreaterThan(oud.matchPercent);
  });

  it('recency (GAP2): recente maar NIET-relevante rol krijgt geen pluspunt', () => {
    const vacancy = { title: 'Lasser MIG/MAG', required_skills: ['lassen'] };
    const score = scoreMatch(
      { skills: ['lassen'], most_recent_role: 'Kok', most_recent_role_year: 2025 },
      vacancy, undefined, undefined, { nowYear: 2026 },
    );
    expect(score.componentScores.recencyBonus).toBe(0);
  });

  it('recency (GAP2): zonder nowYear blijft de score deterministisch (bonus uit)', () => {
    const vacancy = { title: 'Lasser MIG/MAG', required_skills: ['lassen'] };
    const cand = { skills: ['lassen'], most_recent_role: 'Lasser MIG MAG', most_recent_role_year: 2025 };
    expect(scoreMatch(cand, vacancy).componentScores.recencyBonus).toBe(0);
  });

  it('gebruikt de volledige vacaturetekst als extra functiematch-context', () => {
    const metOmschrijving = scoreMatch(
      { skills: ['lassen'] },
      {
        title: 'Metaalmedewerker',
        description: 'Je gaat MIG/MAG lassen en constructies samenstellen.',
        required_skills: [],
      },
    );
    const zonderOmschrijving = scoreMatch(
      { skills: ['lassen'] },
      { title: 'Metaalmedewerker', required_skills: [] },
    );
    expect(metOmschrijving.matchPercent).toBeGreaterThan(zonderOmschrijving.matchPercent);
    expect(metOmschrijving.label).not.toBe('groen');
  });

  it('past shortlistcriteria toe op minimumscore, skill-signaal en bekende afstand', () => {
    const score = scoreMatch(
      { skills: ['productie'] },
      { title: 'Productiemedewerker', required_skills: ['productie'] },
      { status: 'missing_coords' },
    );
    expect(passesShortlist(score, false, { minScore: 90 })).toBe(false);
    expect(passesShortlist(score, false, { minScore: 40, requireSkillSignal: true })).toBe(true);
    expect(passesShortlist(score, false, { minScore: 40, requireKnownDistance: true })).toBe(false);
  });

  it('laat criteria-options de weging van afstand aanpassen', () => {
    const candidate = { skills: ['productie'] };
    const vacancy = { title: 'Productiemedewerker', required_skills: ['productie'] };
    const ver = scoreMatch(candidate, vacancy, { km: 95, status: 'estimated' });
    const afstandUit = scoreMatch(candidate, vacancy, { km: 95, status: 'estimated' }, undefined, { weights: { distance: 0 } });
    expect(afstandUit.matchPercent).toBeGreaterThan(ver.matchPercent);
  });

  it('geeft geen recency-pluspunt op een relevante rol van één maand, maar wel een aandachtspunt', () => {
    const vacancy = { title: 'TIG lasser', required_skills: ['TIG lassen'] };
    const distance = { km: 10, status: 'estimated' as const };
    const basis = { skills: ['TIG lassen'], most_recent_role: 'TIG lasser', most_recent_role_year: 2026 };

    const lang = scoreMatch({ ...basis, most_recent_role_months: 30 }, vacancy, distance, undefined, { nowYear: 2026 });
    const kort = scoreMatch({ ...basis, most_recent_role_months: 1 }, vacancy, distance, undefined, { nowYear: 2026 });
    const onbekend = scoreMatch(basis, vacancy, distance, undefined, { nowYear: 2026 });

    expect(lang.bonuses.some((b) => b.startsWith('Recent relevante ervaring'))).toBe(true);
    expect(kort.bonuses.some((b) => b.startsWith('Recent relevante ervaring'))).toBe(false);
    expect(kort.missing.some((m) => m.includes('duurde kort'))).toBe(true);
    expect(kort.matchPercent).toBeLessThan(lang.matchPercent);

    // Onbekende duur is geen bewijs van kort: gedrag blijft zoals het was.
    expect(onbekend.matchPercent).toBe(lang.matchPercent);
  });

  it('blokkeert een geblacklviste kandidaat, ook bij een verder perfecte match', () => {
    const candidate = {
      skills: ['MIG-MAG lassen'],
      certifications: ['VCA'],
      languages: ['Nederlands'],
      has_dutch_address: true,
    };
    const vacancy = {
      title: 'MIG-MAG lasser',
      required_skills: ['MIG-MAG lassen'],
      required_certifications: ['VCA'],
    };
    const distance = { km: 8, durationMin: 24, status: 'ok' as const };

    const zonder = scoreMatch(candidate, vacancy, distance);
    expect(zonder.hardBlocks).toEqual([]);
    expect(passesShortlist(zonder)).toBe(true);

    const geblacklist = scoreMatch({ ...candidate, is_blacklisted: true }, vacancy, distance);
    expect(geblacklist.hardBlocks).toContain('Kandidaat staat op de blacklist');
    expect(geblacklist.label).toBe('rood');
    expect(geblacklist.matchPercent).toBeLessThanOrEqual(30);
    expect(passesShortlist(geblacklist)).toBe(false);
  });

  it('haversineKm berekent een plausibele afstand en is null bij ontbrekende coords', () => {
    const eindhovenToTilburg = haversineKm(51.44, 5.47, 51.56, 5.09);
    expect(eindhovenToTilburg).toBeGreaterThan(20);
    expect(eindhovenToTilburg).toBeLessThan(45);
    expect(haversineKm(null, 5, 51, 5)).toBeNull();
  });
});
