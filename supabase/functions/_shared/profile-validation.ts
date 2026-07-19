// Validatie van de publieke profielaanvullink (/profiel/:token).
//
// Eén bron van waarheid voor client én server: de pagina gebruikt 'm om per veld een
// Nederlandse foutmelding te tonen, de edge function `candidate-profile` om het te
// hérvalideren. Een publiek endpoint zonder login mag nooit op client-validatie
// vertrouwen — een POST met een lege body komt anders gewoon binnen.
//
// GEEN Deno- of externe imports (zelfde afspraak als matching-core.ts): deze module
// wordt vanuit Vitest getest én vanuit de frontend gebundeld, dus een esm.sh-import
// zou `tsc`/Vite laten stuklopen.
//
// Het Nederlandse telefoonnummer is BEWUST optioneel: arbeidsmigranten hebben bij het
// invullen meestal nog geen NL-nummer. Wordt het wél ingevuld, dan controleren we
// alleen of het compleet oogt.

export type ProfileField =
  | 'phone'
  | 'phone_nl'
  | 'email'
  | 'emergency_contact_name'
  | 'emergency_contact_phone'
  | 'date_of_birth'
  | 'nationality'
  | 'languages'
  | 'address_street'
  | 'address_postal'
  | 'address_city'
  | 'drivers_license_expiry'
  | 'available_from'
  | 'available_until';

export interface ProfileFormValues {
  phone?: string | null;
  phone_nl?: string | null;
  email?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  date_of_birth?: string | null;
  nationality?: string | null;
  languages?: string[] | null;
  has_dutch_address?: boolean | null;
  address_street?: string | null;
  address_postal?: string | null;
  address_city?: string | null;
  address_country?: string | null;
  has_drivers_license?: boolean | null;
  drivers_license_expiry?: string | null;
  available_from?: string | null;
  available_until?: string | null;
}

export type ProfileFieldErrors = Partial<Record<ProfileField, string>>;

export interface ProfileValidationResult {
  valid: boolean;
  errors: ProfileFieldErrors;
  /** Nederlandse labels van de velden die nog fout/leeg zijn, in formuliervolgorde. */
  missingLabels: string[];
}

export interface ProfileValidationOptions {
  /** Referentiedatum voor leeftijds- en datumchecks. Expliciet meegeven maakt tests deterministisch. */
  today?: Date;
}

/** Nederlandse veldlabels — gebruikt in de "nog in te vullen"-samenvatting op de pagina. */
export const PROFILE_FIELD_LABELS: Record<ProfileField, string> = {
  phone: 'Telefoon (EU / buitenland)',
  phone_nl: 'Telefoon (Nederlands)',
  email: 'E-mail',
  emergency_contact_name: 'Naam noodcontact',
  emergency_contact_phone: 'Telefoonnummer noodcontact',
  date_of_birth: 'Geboortedatum',
  nationality: 'Nationaliteit',
  languages: 'Talen',
  // Zelfde tekst als het invoerveld in AddressAutocomplete — anders zoekt de kandidaat in de
  // samenvatting naar een label dat nergens boven een veld staat.
  address_street: 'Straat + huisnr',
  address_postal: 'Postcode',
  address_city: 'Stad',
  drivers_license_expiry: 'Verloopdatum rijbewijs',
  available_from: 'Beschikbaar vanaf',
  available_until: 'Beschikbaar tot',
};

/** Volgorde waarin de velden op het formulier staan — bepaalt de volgorde van de samenvatting. */
export const PROFILE_FIELD_ORDER: ProfileField[] = [
  'phone',
  'phone_nl',
  'email',
  'emergency_contact_name',
  'emergency_contact_phone',
  'date_of_birth',
  'nationality',
  'languages',
  'address_street',
  'address_postal',
  'address_city',
  'drivers_license_expiry',
  'available_from',
  'available_until',
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NL_POSTAL_PATTERN = /^\d{4}\s?[A-Za-z]{2}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Minimaal aantal cijfers voor een telefoonnummer. Bewust laag: buitenlandse nummers variëren sterk. */
const MIN_PHONE_DIGITS = 7;

const MIN_AGE_YEARS = 16;
const MAX_AGE_YEARS = 100;

/** Landwaarden die "Nederland" betekenen. Het dossier bevat zowel ISO-codes als vrije tekst. */
const DUTCH_COUNTRY_VALUES = new Set([
  'nl',
  'nld',
  'nederland',
  'netherlands',
  'the netherlands',
  'holland',
]);

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const countDigits = (value: string): number => (value.match(/\d/g) ?? []).length;

/** Heeft deze waarde de vorm van een Nederlandse postcode (1234 AB)? */
export function isDutchPostalCode(value: unknown): boolean {
  return NL_POSTAL_PATTERN.test(text(value));
}

/**
 * Staat er in het dossier werkelijk een Nederlands adres?
 *
 * `has_dutch_address` alléén is hiervoor niet betrouwbaar: de vlag komt bij honderden
 * kandidaten uit de Carerix-import van "eigen huisvesting" (`_10232`), niet uit een
 * Nederlands adres. In productie staat de vlag daardoor massaal op `true` bij een Pools,
 * Roemeens of Portugees adres. Zouden we het vinkje op de profielpagina daaruit
 * voorinvullen, dan vraagt het formulier die kandidaten om een NL-postcode die ze niet
 * hebben — en loopt de inzending vast op data die zij niet hebben ingevoerd.
 *
 * Daarom: een herkenbare NL-postcode is doorslaggevend, een expliciet buitenlands land
 * sluit het uit, en pas als het land Nederlands of onbekend is vertrouwen we op de vlag
 * (en zonder vlag op straat + woonplaats, zoals de pagina het altijd al deed).
 */
export function hasDutchAddressOnFile(values: ProfileFormValues | null | undefined): boolean {
  const current = values ?? {};
  if (isDutchPostalCode(current.address_postal)) return true;

  const country = text(current.address_country).toLowerCase();
  if (country && !DUTCH_COUNTRY_VALUES.has(country)) return false;

  if (typeof current.has_dutch_address === 'boolean') return current.has_dutch_address;
  return Boolean(text(current.address_street) && text(current.address_city));
}

/**
 * Parse een `YYYY-MM-DD`-string naar een UTC-datum. Geeft null bij een onmogelijke datum
 * (bijv. 2026-02-31), want `new Date()` rolt die stilzwijgend door naar maart.
 */
export function parseIsoDate(value: unknown): Date | null {
  const raw = text(value);
  if (!ISO_DATE_PATTERN.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

const wholeYearsBetween = (from: Date, to: Date): number => {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const monthDelta = to.getUTCMonth() - from.getUTCMonth();
  if (monthDelta < 0 || (monthDelta === 0 && to.getUTCDate() < from.getUTCDate())) years -= 1;
  return years;
};

/**
 * Valideert de ingevulde profielgegevens. Puur: geen I/O, geen globale state behalve de
 * meegegeven (of huidige) datum.
 */
export function validateProfileSubmission(
  values: ProfileFormValues,
  options: ProfileValidationOptions = {},
): ProfileValidationResult {
  const today = options.today ?? new Date();
  const errors: ProfileFieldErrors = {};

  // ── Contactgegevens ──
  const phone = text(values.phone);
  if (!phone) {
    errors.phone = 'Vul je telefoonnummer in, zodat we je kunnen bereiken.';
  } else if (countDigits(phone) < MIN_PHONE_DIGITS) {
    errors.phone = 'Dit telefoonnummer lijkt niet compleet. Vul het volledige nummer in, met landcode.';
  }

  // Nederlands nummer is optioneel (veel kandidaten hebben er nog geen); alleen als het
  // is ingevuld controleren we of het compleet oogt.
  const phoneNl = text(values.phone_nl);
  if (phoneNl && countDigits(phoneNl) < MIN_PHONE_DIGITS) {
    errors.phone_nl =
      'Dit Nederlandse nummer lijkt niet compleet. Laat het veld leeg als je nog geen Nederlands nummer hebt.';
  }

  const email = text(values.email);
  if (!email) {
    errors.email = 'Vul je e-mailadres in.';
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.email = 'Dit e-mailadres klopt niet. Controleer of je het goed hebt overgetypt.';
  }

  const iceName = text(values.emergency_contact_name);
  if (!iceName) {
    errors.emergency_contact_name = 'Vul de naam in van iemand die we kunnen bellen bij nood.';
  } else if (iceName.length < 2) {
    errors.emergency_contact_name = 'Vul de volledige naam van je noodcontact in.';
  }

  const icePhone = text(values.emergency_contact_phone);
  if (!icePhone) {
    errors.emergency_contact_phone = 'Vul het telefoonnummer van je noodcontact in.';
  } else if (countDigits(icePhone) < MIN_PHONE_DIGITS) {
    errors.emergency_contact_phone = 'Dit telefoonnummer lijkt niet compleet. Vul het volledige nummer in, met landcode.';
  }

  // ── Persoonsgegevens ──
  const birthRaw = text(values.date_of_birth);
  if (!birthRaw) {
    errors.date_of_birth = 'Vul je geboortedatum in.';
  } else {
    const birth = parseIsoDate(birthRaw);
    if (!birth) {
      errors.date_of_birth = 'Vul een geldige geboortedatum in.';
    } else {
      const age = wholeYearsBetween(birth, today);
      if (age < MIN_AGE_YEARS) {
        errors.date_of_birth = `Je moet minimaal ${MIN_AGE_YEARS} jaar zijn om via ons te werken.`;
      } else if (age > MAX_AGE_YEARS) {
        errors.date_of_birth = 'Controleer je geboortedatum, deze lijkt niet te kloppen.';
      }
    }
  }

  if (!text(values.nationality)) {
    errors.nationality = 'Kies je nationaliteit.';
  }

  const languages = Array.isArray(values.languages)
    ? values.languages.filter((entry) => text(entry).length > 0)
    : [];
  if (languages.length === 0) {
    errors.languages = 'Kies minimaal één taal die je spreekt.';
  }

  // ── Adres (alleen als de kandidaat aangeeft een NL-adres te hebben) ──
  if (values.has_dutch_address === true) {
    if (!text(values.address_street)) {
      errors.address_street = 'Vul je straat en huisnummer in.';
    }
    const postal = text(values.address_postal);
    if (!postal) {
      errors.address_postal = 'Vul je postcode in.';
    } else if (!NL_POSTAL_PATTERN.test(postal)) {
      errors.address_postal = 'Vul een geldige Nederlandse postcode in, bijvoorbeeld 5731 AB.';
    }
    if (!text(values.address_city)) {
      errors.address_city = 'Vul je woonplaats in.';
    }
  }

  // ── Werk & beschikbaarheid ──
  if (values.has_drivers_license === true) {
    const expiryRaw = text(values.drivers_license_expiry);
    if (!expiryRaw) {
      errors.drivers_license_expiry = 'Vul in tot wanneer je rijbewijs geldig is.';
    } else if (!parseIsoDate(expiryRaw)) {
      errors.drivers_license_expiry = 'Vul een geldige verloopdatum in.';
    }
  }

  const availableFromRaw = text(values.available_from);
  const availableFrom = parseIsoDate(availableFromRaw);
  if (!availableFromRaw) {
    errors.available_from = 'Vul in vanaf wanneer je kunt beginnen.';
  } else if (!availableFrom) {
    errors.available_from = 'Vul een geldige datum in.';
  }

  // Einddatum is optioneel — veel kandidaten zijn onbepaalde tijd beschikbaar.
  const availableUntilRaw = text(values.available_until);
  if (availableUntilRaw) {
    const availableUntil = parseIsoDate(availableUntilRaw);
    if (!availableUntil) {
      errors.available_until = 'Vul een geldige datum in.';
    } else if (availableFrom && availableUntil < availableFrom) {
      errors.available_until = 'Deze datum ligt vóór je startdatum. Controleer je beschikbaarheid.';
    }
  }

  const missingLabels = summarizeProfileErrors(errors);

  return { valid: missingLabels.length === 0, errors, missingLabels };
}

/** Zet veldfouten om in Nederlandse labels, in formuliervolgorde. */
export function summarizeProfileErrors(errors: ProfileFieldErrors): string[] {
  return PROFILE_FIELD_ORDER.filter((field) => errors[field]).map(
    (field) => PROFILE_FIELD_LABELS[field],
  );
}

/**
 * Bepaalt de waarde waarop de server valideert: wat de kandidaat nú instuurt, en anders
 * wat er al in het dossier staat.
 *
 * Cruciaal voor de COALESCE-afspraak van `candidate-profile`: lege waarden overschrijven
 * bestaande kandidaatgegevens nooit, dus mag een leeg veld ook geen fout opleveren als het
 * dossier de waarde al heeft. Zonder deze samenvoeging zou een oudere/gecachede
 * frontend-bundel (die het veld niet meestuurt) een compleet profiel afgekeurd krijgen.
 *
 * De samenvoeging mag alleen ontbrekende gegevens AANVULLEN, nooit extra eisen opleggen.
 * `has_dutch_address`, `has_drivers_license` en `available_until` doen daarom niet mee: die
 * sturen uitsluitend voorwaardelijke eisen aan, en een dossierwaarde die de kandidaat niet op
 * het scherm ziet mag de server nooit strenger maken dan het formulier waarop hij net
 * "opslaan" heeft gedrukt.
 */
export function mergeProfileValues(
  submitted: ProfileFormValues | null | undefined,
  existing: ProfileFormValues | null | undefined,
): ProfileFormValues {
  const incoming = submitted ?? {};
  const current = existing ?? {};

  const pickText = (key: keyof ProfileFormValues): string => {
    const next = text(incoming[key]);
    return next || text(current[key]);
  };

  const submittedLanguages = Array.isArray(incoming.languages) ? incoming.languages : [];
  const currentLanguages = Array.isArray(current.languages) ? current.languages : [];

  // Alleen wat de kandidaat NU heeft bevestigd zet een voorwaardelijke eis aan. Zonder deze
  // regel zou een opgeslagen `has_dutch_address = true` (in productie vaak overgenomen uit
  // Carerix "eigen huisvesting", bij een buitenlands adres) op de server alsnog een
  // NL-postcode eisen nadat de kandidaat het vinkje had uitgezet — de client keurt dan goed
  // wat de server weigert.
  const pickSubmittedBoolean = (key: 'has_dutch_address' | 'has_drivers_license'): boolean =>
    incoming[key] === true;

  return {
    phone: pickText('phone'),
    phone_nl: pickText('phone_nl'),
    email: pickText('email'),
    emergency_contact_name: pickText('emergency_contact_name'),
    emergency_contact_phone: pickText('emergency_contact_phone'),
    date_of_birth: pickText('date_of_birth'),
    nationality: pickText('nationality'),
    languages: submittedLanguages.length > 0 ? submittedLanguages : currentLanguages,
    has_dutch_address: pickSubmittedBoolean('has_dutch_address'),
    address_street: pickText('address_street'),
    address_postal: pickText('address_postal'),
    address_city: pickText('address_city'),
    address_country: pickText('address_country'),
    has_drivers_license: pickSubmittedBoolean('has_drivers_license'),
    drivers_license_expiry: pickText('drivers_license_expiry'),
    available_from: pickText('available_from'),
    // Einddatum is optioneel en wordt alleen gebruikt voor de check "niet vóór de startdatum".
    // Zou hij uit het dossier worden aangevuld, dan krijgt een kandidaat die het veld juist
    // heeft leeggemaakt een foutmelding over een datum die niet meer op zijn scherm staat.
    available_until: text(incoming.available_until),
  };
}
