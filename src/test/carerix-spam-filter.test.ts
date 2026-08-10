import { describe, expect, it } from 'vitest';
import {
  isSpamCandidate,
  spamReason,
} from '../../supabase/functions/_shared/carerix/spam-filter.ts';

// Alle fixtures komen uit de JA Werkt-productiedata (Carerix-import 20-07-2026).
// De spamlijst bevat de 11 bot-registraties die na de opschoning van 21-07 waren
// blijven staan, plus een paar die toen wél zijn verwijderd.
const SPAM = [
  { firstName: 'kasyna_zwka', lastName: 'kasyna_zwka', email: 'xmpobmgpzka@zolon.store' },
  { firstName: 'Avtoservis_rvMr', lastName: 'Avtoservis_rvMr', email: 'qbplxofrxMr@lvdskjn.store' },
  {
    firstName: 'Pyblichnaya kadastrovaya karta_orPl',
    lastName: 'Pyblichnaya kadastrovaya karta_orPl',
    email: 'sfvtaxebiPl@zvukovoe-oborudovanie12.ru',
  },
  { firstName: 'et42cw', lastName: 'sdegvn', email: '6xgc64oc1unmm8@web-library.net' },
  { firstName: 'wo8upo', lastName: 'zea8nj', email: 'qagxzet8zxxccx@web-library.net' },
  { firstName: 'd4mmt3', lastName: '56zgna', email: 'vgvq6mvr1u7z2m@web-library.net' },
  { firstName: '4sbw2t', lastName: 'wyvaef', email: '96b0fvr6ra06pq@web-library.net' },
  { firstName: 'oxulex', lastName: 'wtv22b', email: 'q87nkuyl042z0c@web-library.net' },
  { firstName: 'a8wp5p', lastName: 'zefnqb', email: 'wpcszfllc9zoxq@web-library.net' },
  { firstName: 'fm5c74', lastName: 'm9v2dq', email: 'eb3js8i4gjep6f@web-library.net' },
  { firstName: 'jnhovrsjhi', lastName: 'kpnsmwpmds', email: 'ojphuoex@immenseignite.info' },
  // Op 21-07 handmatig verwijderd.
  { firstName: '1xbet giris_fqSt', lastName: '1xbet giris_fqSt', email: 'txkeldztwSt@zvukovoe-oborudovanie12.ru' },
  { firstName: 'kupit_ppmt', lastName: 'kupit_ppmt', email: 'lkwarupsbmt@moscowfocus.ru' },
  { firstName: 'kypit osago_zskr', lastName: 'kypit osago_zskr', email: 'zusigmipbkr@zvukovoe-oborudovanie12.ru' },
];

// Echte kandidaten — inclusief de randgevallen waarop een naïever filter stukloopt:
// korte kleine-letternamen, gelijke voor- en achternaam, en `.ru`-adressen (die
// horen bij de doelgroep en zijn dus geen spamsignaal).
const ECHT = [
  { firstName: 'hamid', lastName: 'hamid', email: 'hamid1972@live.nl' },
  { firstName: 'Дмитрий', lastName: 'Ольховский', email: 'olxovskij1986@mail.ru' },
  { firstName: 'Kristina', lastName: 'Orehhova', email: 'kristina.orehhova@mail.ru' },
  { firstName: 'Alexandru', lastName: 'Sorocinschi', email: 'alexandru19711026@mail.ru' },
  { firstName: 'Sebastian', lastName: 'Sebastian', email: 'Stahu555@gmail.com' },
  { firstName: 'Gabriel Daniel Mihai', lastName: 'Gabriel Daniel Mihai', email: 'gabrielmihai47@gmail.com' },
  { firstName: 'Piotr', lastName: 'Gębka', email: 'piotrek301994@wp.pl' },
  { firstName: 'Paweł', lastName: 'GŁÓD', email: 'pawglod149@gmail.com' },
  { firstName: 'Nikolay', lastName: 'Petkov', email: 'u3833205599@gmail.com' },
  { firstName: 'Marin', lastName: 'Valchev', email: 'marin_1995@mail.bg' },
  { firstName: 'Mart', lastName: 'van der Kruis', email: 'mart@rockit.works' },
  { firstName: 'Mihai', lastName: 'Sergiu Sandor', email: 'info@jawerkt.nl' },
  { firstName: 'Dinis', lastName: 'Bereza Khlystun', email: null },
  { firstName: 'Onbekend', lastName: 'Onbekend', email: null },
];

describe('spamReason', () => {
  it.each(SPAM)('herkent bot-registratie $firstName', (input) => {
    expect(spamReason(input)).not.toBeNull();
  });

  it.each(ECHT)('laat echte kandidaat $firstName $lastName ongemoeid', (input) => {
    expect(spamReason(input)).toBeNull();
  });

  it('benoemt de reden zodat die in de importlog terugkomt', () => {
    expect(spamReason({ firstName: 'a', lastName: 'b', email: 'x@web-library.net' }))
      .toBe('wegwerpdomein web-library.net');
    expect(spamReason({ firstName: 'kasyna_zwka', lastName: 'kasyna_zwka', email: 'x@gmail.com' }))
      .toBe('advertentie-trefwoord in naam');
    expect(spamReason({ firstName: 'Vloerbedrijf_qxTr', lastName: 'Vloerbedrijf_qxTr', email: null }))
      .toBe('bot-naamsjabloon (naam_XXXX, voor- en achternaam gelijk)');
    expect(spamReason({ firstName: 'et42cw', lastName: 'sdegvn', email: 'x@gmail.com' }))
      .toBe('willekeurige tekenreeks als naam');
  });

  it('vereist gelijke voor- en achternaam voor het naamsjabloon', () => {
    // Een echte achternaam met onderstrepingsteken mag niet afgaan.
    expect(spamReason({ firstName: 'Jan', lastName: 'de_Vries', email: 'jan@gmail.com' })).toBeNull();
  });

  it('gaat om met ontbrekende velden', () => {
    expect(isSpamCandidate({})).toBe(false);
    expect(isSpamCandidate({ firstName: null, lastName: undefined, email: '' })).toBe(false);
  });
});
