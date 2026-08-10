// Herkenning van bot-registraties in de Carerix-bron.
//
// Carerix' publieke sollicitatieformulier wordt door SEO-spambots gebruikt: die
// zetten hun advertentietekst in de naamvelden en een wegwerpadres in het
// e-mailveld. Bij de import van 20-07-2026 was ~1 op de 3 nieuwe kandidaten zo'n
// registratie. Ze opruimen achteraf werkt, maar elke sync sleept een verse batch
// mee, dus filteren we ze bij de bron van de import.
//
// Regels zijn opzettelijk conservatief: een gemiste bot is hooguit hinderlijk,
// een geblokkeerde echte kandidaat is een gemiste plaatsing. Alle vier de regels
// zijn getoetst tegen de volledige productie-kandidatentabel (2.093 rijen) en
// raken daar uitsluitend bekende spamrijen.

export interface SpamCheckInput {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}

// Wegwerpdomeinen die in de JA Werkt-data zijn waargenomen. Bewust géén hele
// TLD's: `.ru`-adressen (mail.ru) horen bij echte kandidaten uit de doelgroep.
const SPAM_EMAIL_DOMAINS = new Set([
  'web-library.net',
  'immenseignite.info',
  'zolon.store',
  'lvdskjn.store',
  'zvukovoe-oborudovanie12.ru',
  'moscowfocus.ru',
]);

// Advertentietrefwoorden die de bots in de naamvelden plakken.
const SPAM_NAME_KEYWORDS =
  /(1xbet|kupit|kypit|osago|kasyn|casino|avtoservis|kadastrov|mostbet|melbet|pin[- ]?up|viagra|cialis|bookmaker)/i;

// Bot-sjabloon `<trefwoord>_<willekeurig achtervoegsel>`, met identieke voor- en
// achternaam — bv. `kasyna_zwka`, `Avtoservis_rvMr`, `1xbet giris_fqSt`.
const BOT_NAME_SUFFIX = /_[A-Za-z0-9]{3,6}$/;

// Volledig willekeurige tekenreeks als naam — bv. `et42cw sdegvn`,
// `jnhovrsjhi kpnsmwpmds`. Alleen kleine letters/cijfers; echte namen komen uit
// Carerix met hoofdletter.
const RANDOM_NAME_TOKEN = /^[a-z0-9]{5,10}$/;
const HAS_DIGIT = /[0-9]/;
const HAS_VOWEL = /[aeiouy]/;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at === -1 ? '' : email.slice(at + 1).toLowerCase();
}

/**
 * Geeft de reden terug waarom dit een bot-registratie is, of `null` wanneer de
 * kandidaat gewoon geïmporteerd moet worden.
 */
export function spamReason(input: SpamCheckInput): string | null {
  const first = clean(input.firstName);
  const last = clean(input.lastName);
  const email = clean(input.email);

  if (email && SPAM_EMAIL_DOMAINS.has(emailDomain(email))) {
    return `wegwerpdomein ${emailDomain(email)}`;
  }

  if (SPAM_NAME_KEYWORDS.test(first) || SPAM_NAME_KEYWORDS.test(last)) {
    return 'advertentie-trefwoord in naam';
  }

  if (first !== '' && first === last && BOT_NAME_SUFFIX.test(first)) {
    return 'bot-naamsjabloon (naam_XXXX, voor- en achternaam gelijk)';
  }

  if (RANDOM_NAME_TOKEN.test(first) && RANDOM_NAME_TOKEN.test(last)) {
    // Cijfers of een klinkerloze reeks onderscheiden `et42cw sdegvn` van een
    // echte korte naam als `hamid hamid`.
    const random =
      HAS_DIGIT.test(first) || HAS_DIGIT.test(last) ||
      !HAS_VOWEL.test(first) || !HAS_VOWEL.test(last);
    if (random) return 'willekeurige tekenreeks als naam';
  }

  return null;
}

export function isSpamCandidate(input: SpamCheckInput): boolean {
  return spamReason(input) !== null;
}
