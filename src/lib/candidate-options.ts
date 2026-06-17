// Canonieke keuzelijsten voor kandidaatvelden: nationaliteit, taal en (voor
// buitenlandse adressen) land. Eén bron van waarheid zodat alle dropdowns dezelfde
// waarden gebruiken — belangrijk voor consistente data en matching.
//
// Waarden zijn tegelijk de opgeslagen string (value === label). Lijsten zijn bewust
// breed; de bijbehorende selects zijn doorzoekbaar en TOLERANT (een reeds opgeslagen
// waarde die niet in de lijst staat blijft zichtbaar, wordt nooit stil gewist).

export type Option = { value: string; label: string };

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
// herkomstlanden eerst, daarna een brede alfabetische set.
export const COUNTRIES: Option[] = [
  'Polen', 'Roemenië', 'Bulgarije', 'Hongarije', 'Slowakije', 'Tsjechië',
  'Litouwen', 'Letland', 'Estland', 'Oekraïne', 'Portugal', 'Spanje', 'Italië',
  'Griekenland', 'Kroatië', 'Slovenië', 'België', 'Duitsland', 'Frankrijk',
  'Verenigd Koninkrijk', 'Ierland', 'Oostenrijk', 'Denemarken', 'Zweden',
  'Finland', 'Noorwegen', 'Zwitserland', 'Luxemburg', 'Albanië',
  'Bosnië en Herzegovina', 'Servië', 'Montenegro', 'Noord-Macedonië', 'Kosovo',
  'Moldavië', 'Rusland', 'Wit-Rusland', 'Turkije', 'Marokko', 'Algerije',
  'Tunesië', 'Egypte', 'Syrië', 'Irak', 'Iran', 'Afghanistan', 'Pakistan',
  'India', 'Bangladesh', 'Filipijnen', 'Indonesië', 'Vietnam', 'China',
  'Thailand', 'Nigeria', 'Ghana', 'Eritrea', 'Somalië', 'Soedan', 'Ethiopië',
  'Zuid-Afrika', 'Kaapverdië', 'Suriname', 'Brazilië', 'Colombia', 'Venezuela',
  'Mexico', 'Verenigde Staten', 'Canada', 'Australië', 'Overig',
].map((c) => ({ value: c, label: c }));

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

export function normalizeLanguages(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out = values
    .map((v) => normalizeLanguage(typeof v === 'string' ? v : ''))
    .filter(Boolean);
  return [...new Set(out)];
}
