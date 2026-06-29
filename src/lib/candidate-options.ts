// Canonieke keuzelijsten voor kandidaatvelden: nationaliteit, taal en (voor
// buitenlandse adressen) land. Eén bron van waarheid zodat alle dropdowns dezelfde
// waarden gebruiken — belangrijk voor consistente data en matching.
//
// Waarden zijn tegelijk de opgeslagen string (value === label). Lijsten zijn bewust
// breed; de bijbehorende selects zijn doorzoekbaar en TOLERANT (een reeds opgeslagen
// waarde die niet in de lijst staat blijft zichtbaar, wordt nooit stil gewist).

export type Option = { value: string; label: string };

export const CANDIDATE_SOURCES: Option[] = [
  'Website',
  'E-mail',
  'LinkedIn',
  'Referral',
  'Indeed',
  'WhatsApp',
  'Meta Ads',
  'Overig',
].map((source) => ({ value: source, label: source }));

// Nederlandse nationaliteit-benamingen (bijvoeglijk, bv. "Poolse"). Volgorde: meest
// voorkomende herkomstlanden voor arbeidsmigranten eerst, daarna alfabetisch.
export const NATIONALITIES: Option[] = [
  'Nederlandse', 'Poolse', 'Roemeense', 'Bulgaarse', 'Hongaarse', 'Slowaakse',
  'Tsjechische', 'Litouwse', 'Letse', 'Estse', 'Oekraïense', 'Portugese',
  'Spaanse', 'Italiaanse', 'Griekse', 'Kroatische', 'Sloveense',
  'Belgische', 'Duitse', 'Franse', 'Britse', 'Ierse', 'Oostenrijkse',
  'Deense', 'Zweedse', 'Finse', 'Noorse', 'Zwitserse', 'Luxemburgse',
  'Albanese', 'Bosnische', 'Servische', 'Montenegrijnse', 'Noord-Macedonische',
  'Kosovaarse', 'Moldavische', 'Russische', 'Wit-Russische', 'Turkse',
  'Marokkaanse', 'Algerijnse', 'Tunesische', 'Egyptische', 'Syrische',
  'Iraakse', 'Iraanse', 'Afghaanse', 'Pakistaanse', 'Indiase', 'Bengaalse',
  'Filipijnse', 'Indonesische', 'Vietnamese', 'Chinese', 'Thaise',
  'Nigeriaanse', 'Ghanese', 'Eritrese', 'Somalische', 'Soedanese', 'Ethiopische',
  'Zuid-Afrikaanse', 'Kaapverdische', 'Surinaamse', 'Antilliaanse', 'Arubaanse',
  'Braziliaanse', 'Colombiaanse', 'Venezolaanse', 'Mexicaanse',
  'Amerikaanse', 'Canadese', 'Australische',
  'Staatloze', 'Overige',
].map((n) => ({ value: n, label: n }));

// Talen (Nederlandse benamingen).
export const LANGUAGES: string[] = [
  'Nederlands', 'Engels', 'Duits', 'Frans', 'Spaans', 'Portugees', 'Italiaans',
  'Pools', 'Roemeens', 'Bulgaars', 'Hongaars', 'Slowaaks', 'Tsjechisch',
  'Litouws', 'Lets', 'Ests', 'Kroatisch', 'Sloveens', 'Grieks',
  'Oekraïens', 'Russisch', 'Wit-Russisch', 'Servisch', 'Bosnisch', 'Albanees',
  'Turks', 'Arabisch', 'Koerdisch', 'Perzisch', 'Pasjtoe', 'Urdu', 'Hindi',
  'Bengaals', 'Tagalog', 'Indonesisch', 'Vietnamees', 'Chinees', 'Thais',
  'Somalisch', 'Tigrinya', 'Swahili', 'Papiaments', 'Sranantongo',
];

// Landen (Nederlandse benamingen) voor buitenlandse adressen. Veelvoorkomende
// herkomstlanden eerst, daarna ISO-landen alfabetisch zodat CV-aliassen niet
// alsnog vrije tekst afdwingen.
const PRIORITY_COUNTRIES = [
  'Polen', 'Roemenië', 'Bulgarije', 'Hongarije', 'Slowakije', 'Tsjechië',
  'Litouwen', 'Letland', 'Estland', 'Oekraïne', 'Portugal', 'Spanje', 'Italië',
  'Griekenland', 'Kroatië', 'Slovenië', 'België', 'Duitsland', 'Frankrijk',
  'Verenigd Koninkrijk', 'Ierland', 'Oostenrijk', 'Denemarken', 'Zweden',
  'Finland', 'Noorwegen', 'Zwitserland', 'Luxemburg',
];

const ISO_COUNTRIES_NL = [
  'Afghanistan', 'Albanië', 'Algerije', 'Amerikaanse Maagdeneilanden',
  'Amerikaans-Samoa', 'Andorra', 'Angola', 'Anguilla', 'Antarctica',
  'Antigua en Barbuda', 'Argentinië', 'Armenië', 'Aruba', 'Australië',
  'Azerbeidzjan', 'Bahama’s', 'Bahrein', 'Bangladesh', 'Barbados', 'Belarus',
  'België', 'Belize', 'Benin', 'Bermuda', 'Bhutan', 'Bolivia',
  'Bonaire, Sint Eustatius en Saba', 'Bosnië en Herzegovina', 'Botswana',
  'Bouvet', 'Brazilië', 'Brits Indische Oceaanterritorium',
  'Britse Maagdeneilanden', 'Brunei', 'Bulgarije', 'Burkina Faso', 'Burundi',
  'Cambodja', 'Canada', 'Centraal-Afrikaanse Republiek', 'Chili', 'China',
  'Christmaseiland', 'Cocoseilanden', 'Colombia', 'Comoren', 'Congo-Brazzaville',
  'Congo-Kinshasa', 'Cookeilanden', 'Costa Rica', 'Cuba', 'Curaçao', 'Cyprus',
  'Denemarken', 'Djibouti', 'Dominica', 'Dominicaanse Republiek', 'Duitsland',
  'Ecuador', 'Egypte', 'El Salvador', 'Equatoriaal-Guinea', 'Eritrea',
  'Estland', 'Eswatini', 'Ethiopië', 'Faeröer', 'Falklandeilanden',
  'Fiji', 'Filipijnen', 'Finland', 'Frankrijk', 'Frans-Guyana',
  'Frans-Polynesië', 'Franse Zuidelijke Gebieden', 'Gabon', 'Gambia',
  'Georgië', 'Ghana', 'Gibraltar', 'Grenada', 'Griekenland', 'Groenland',
  'Guadeloupe', 'Guam', 'Guatemala', 'Guernsey', 'Guinee', 'Guinee-Bissau',
  'Guyana', 'Haïti', 'Heard en McDonaldeilanden', 'Honduras', 'Hongarije',
  'Hongkong', 'Ierland', 'IJsland', 'India', 'Indonesië', 'Irak', 'Iran',
  'Israël', 'Italië', 'Ivoorkust', 'Jamaica', 'Japan', 'Jemen', 'Jersey',
  'Jordanië', 'Kaaimaneilanden', 'Kaapverdië', 'Kameroen', 'Kazachstan',
  'Kenia', 'Kirgizië', 'Kiribati', 'Koeweit', 'Kosovo', 'Kroatië', 'Laos',
  'Lesotho', 'Letland', 'Libanon', 'Liberia', 'Libië', 'Liechtenstein',
  'Litouwen', 'Luxemburg', 'Macau', 'Madagaskar', 'Malawi', 'Maldiven',
  'Maleisië', 'Mali', 'Malta', 'Marokko', 'Marshalleilanden', 'Martinique',
  'Mauritanië', 'Mauritius', 'Mayotte', 'Mexico', 'Micronesia', 'Moldavië',
  'Monaco', 'Mongolië', 'Montenegro', 'Montserrat', 'Mozambique', 'Myanmar',
  'Namibië', 'Nauru', 'Nederland', 'Nepal', 'Nicaragua', 'Nieuw-Caledonië',
  'Nieuw-Zeeland', 'Niger', 'Nigeria', 'Niue', 'Noord-Korea',
  'Noord-Macedonië', 'Noordelijke Marianen', 'Noorwegen', 'Norfolk',
  'Oeganda', 'Oekraïne', 'Oezbekistan', 'Oman', 'Oost-Timor', 'Oostenrijk',
  'Pakistan', 'Palau', 'Palestina', 'Panama', 'Papoea-Nieuw-Guinea',
  'Paraguay', 'Peru', 'Pitcairneilanden', 'Polen', 'Portugal', 'Puerto Rico',
  'Qatar', 'Réunion', 'Roemenië', 'Rusland', 'Rwanda', 'Saint Barthélemy',
  'Saint Kitts en Nevis', 'Saint Lucia', 'Saint Martin', 'Saint Pierre en Miquelon',
  'Saint Vincent en de Grenadines', 'Salomonseilanden', 'Samoa', 'San Marino',
  'Sao Tomé en Principe', 'Saoedi-Arabië', 'Senegal', 'Servië', 'Seychellen',
  'Sierra Leone', 'Singapore', 'Sint-Helena, Ascension en Tristan da Cunha',
  'Sint Maarten', 'Slovenië', 'Slowakije', 'Soedan', 'Somalië', 'Spanje',
  'Spitsbergen en Jan Mayen', 'Sri Lanka', 'Suriname', 'Syrië', 'Tadzjikistan',
  'Taiwan', 'Tanzania', 'Thailand', 'Togo', 'Tokelau', 'Tonga', 'Trinidad en Tobago',
  'Tsjaad', 'Tsjechië', 'Tunesië', 'Turkije', 'Turkmenistan',
  'Turks- en Caicoseilanden', 'Tuvalu', 'Uruguay', 'Vanuatu',
  'Vaticaanstad', 'Venezuela', 'Verenigde Arabische Emiraten',
  'Verenigde Staten', 'Verenigd Koninkrijk', 'Vietnam', 'Wallis en Futuna',
  'Westelijke Sahara', 'Wit-Rusland', 'Zambia', 'Zimbabwe', 'Zuid-Afrika',
  'Zuid-Georgia en de Zuidelijke Sandwicheilanden', 'Zuid-Korea', 'Zuid-Soedan',
  'Zweden', 'Zwitserland', 'Overig',
];

export const COUNTRIES: Option[] = [...new Set([...PRIORITY_COUNTRIES, ...ISO_COUNTRIES_NL])]
  .map((c) => ({ value: c, label: c }));

const strip = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Alias → canonieke nationaliteit. Vangt CV-/vrije-tekstvarianten af (NL-stam,
// Engelse demonym, landnaam). Niet uitputtend; onbekende waarden blijven ongewijzigd.
const NATIONALITY_ALIASES: Record<string, string> = {
  nederlands: 'Nederlandse', dutch: 'Nederlandse', nederland: 'Nederlandse', holland: 'Nederlandse', nl: 'Nederlandse',
  pools: 'Poolse', polish: 'Poolse', polen: 'Poolse', poland: 'Poolse',
  roemeens: 'Roemeense', romanian: 'Roemeense', roemenie: 'Roemeense', romania: 'Roemeense',
  bulgaars: 'Bulgaarse', bulgarian: 'Bulgaarse', bulgarije: 'Bulgaarse', bulgaria: 'Bulgaarse',
  hongaars: 'Hongaarse', hungarian: 'Hongaarse', hongarije: 'Hongaarse', hungary: 'Hongaarse',
  slowaaks: 'Slowaakse', slovak: 'Slowaakse', slowakije: 'Slowaakse', slovakia: 'Slowaakse',
  tsjechisch: 'Tsjechische', czech: 'Tsjechische', tsjechie: 'Tsjechische',
  litouws: 'Litouwse', lithuanian: 'Litouwse', litouwen: 'Litouwse',
  lets: 'Letse', latvian: 'Letse', letland: 'Letse',
  ests: 'Estse', estonian: 'Estse', estland: 'Estse',
  oekraiens: 'Oekraïense', ukrainian: 'Oekraïense', oekraine: 'Oekraïense', ukraine: 'Oekraïense',
  portugees: 'Portugese', portuguese: 'Portugese', portugal: 'Portugese',
  spaans: 'Spaanse', spanish: 'Spaanse', spanje: 'Spaanse', spain: 'Spaanse',
  italiaans: 'Italiaanse', italian: 'Italiaanse', italie: 'Italiaanse', italy: 'Italiaanse',
  belgisch: 'Belgische', belgian: 'Belgische', belgie: 'Belgische',
  duits: 'Duitse', german: 'Duitse', duitsland: 'Duitse', germany: 'Duitse',
  frans: 'Franse', french: 'Franse', frankrijk: 'Franse', france: 'Franse',
  brits: 'Britse', british: 'Britse', english: 'Britse', engels: 'Britse', uk: 'Britse',
  turks: 'Turkse', turkish: 'Turkse', turkije: 'Turkse', turkey: 'Turkse',
  marokkaans: 'Marokkaanse', moroccan: 'Marokkaanse', marokko: 'Marokkaanse',
  syrisch: 'Syrische', syrian: 'Syrische', syrie: 'Syrische',
  surinaams: 'Surinaamse', surinamese: 'Surinaamse', suriname: 'Surinaamse',
};

const LANGUAGE_ALIASES: Record<string, string> = {
  dutch: 'Nederlands', nederlands: 'Nederlands',
  english: 'Engels', engels: 'Engels',
  german: 'Duits', deutsch: 'Duits', duits: 'Duits',
  french: 'Frans', francais: 'Frans', frans: 'Frans',
  spanish: 'Spaans', espanol: 'Spaans', spaans: 'Spaans',
  portuguese: 'Portugees', portugees: 'Portugees',
  italian: 'Italiaans', italiaans: 'Italiaans',
  polish: 'Pools', pools: 'Pools',
  romanian: 'Roemeens', roemeens: 'Roemeens',
  bulgarian: 'Bulgaars', bulgaars: 'Bulgaars',
  hungarian: 'Hongaars', hongaars: 'Hongaars',
  ukrainian: 'Oekraïens', oekraiens: 'Oekraïens',
  russian: 'Russisch', russisch: 'Russisch',
  arabic: 'Arabisch', arabisch: 'Arabisch',
  turkish: 'Turks', turks: 'Turks',
};

const NATIONALITY_BY_STRIP = new Map(NATIONALITIES.map((o) => [strip(o.value), o.value]));
const LANGUAGE_BY_STRIP = new Map(LANGUAGES.map((l) => [strip(l), l]));
const COUNTRY_BY_STRIP = new Map(COUNTRIES.map((o) => [strip(o.value), o.value]));
const SOURCE_BY_STRIP = new Map(CANDIDATE_SOURCES.map((o) => [strip(o.value), o.value]));

const COUNTRY_ALIASES: Record<string, string> = {
  belarus: 'Wit-Rusland',
  bielarus: 'Wit-Rusland',
  'wit rusland': 'Wit-Rusland',
  witrusland: 'Wit-Rusland',
  latvia: 'Letland',
  latvian: 'Letland',
  letland: 'Letland',
  holland: 'Nederland',
  netherlands: 'Nederland',
  nederland: 'Nederland',
  uk: 'Verenigd Koninkrijk',
  'united kingdom': 'Verenigd Koninkrijk',
  'great britain': 'Verenigd Koninkrijk',
  england: 'Verenigd Koninkrijk',
  usa: 'Verenigde Staten',
  us: 'Verenigde Staten',
  'united states': 'Verenigde Staten',
  america: 'Verenigde Staten',
  'czech republic': 'Tsjechië',
  czechia: 'Tsjechië',
  romania: 'Roemenië',
  bulgaria: 'Bulgarije',
  poland: 'Polen',
  germany: 'Duitsland',
  france: 'Frankrijk',
  italy: 'Italië',
  spain: 'Spanje',
  portugal: 'Portugal',
  ukraine: 'Oekraïne',
  moldova: 'Moldavië',
  lithuania: 'Litouwen',
  slovakia: 'Slowakije',
  slovenia: 'Slovenië',
  croatia: 'Kroatië',
};

// Map een vrije/CV-waarde naar de canonieke nationaliteit; geeft de input terug
// (getrimd) als er geen match is — zodat niets verloren gaat.
export function normalizeNationality(input: string | null | undefined): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';
  const key = strip(raw);
  return NATIONALITY_BY_STRIP.get(key) ?? NATIONALITY_ALIASES[key] ?? raw;
}

export function normalizeLanguage(input: string | null | undefined): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';
  const key = strip(raw);
  return LANGUAGE_BY_STRIP.get(key) ?? LANGUAGE_ALIASES[key] ?? raw;
}

export function normalizeCountry(input: string | null | undefined): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';
  const key = strip(raw);
  return COUNTRY_ALIASES[key] ?? COUNTRY_BY_STRIP.get(key) ?? raw;
}

export function normalizeCandidateSource(input: string | null | undefined): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';
  const key = strip(raw);
  return SOURCE_BY_STRIP.get(key) ?? raw;
}

export function includeCurrentOption(options: Option[], current: string | null | undefined): Option[] {
  const raw = (current ?? '').trim();
  if (!raw) return options;
  const exists = options.some((option) => strip(option.value) === strip(raw));
  return exists ? options : [{ value: raw, label: `${raw} (legacy)` }, ...options];
}

export function normalizeLanguages(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out = values
    .map((v) => normalizeLanguage(typeof v === 'string' ? v : ''))
    .filter(Boolean);
  return [...new Set(out)];
}
