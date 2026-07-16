// Standaard-uitlegteksten voor onboardingvelden (B1-niveau, doelgroep arbeidsmigranten).
// Resolutie op maps_to_column / document_type / label-heuristiek, zodat ook
// org-specifieke dynamische formulieren automatisch uitleg krijgen.

export interface FieldHelp {
  title: string;
  text: string;
}

const BY_COLUMN: Record<string, FieldHelp> = {
  bsn: {
    title: 'Wat is een BSN?',
    text: 'Je burgerservicenummer (BSN) is een nummer van 9 cijfers. Het staat op je Nederlandse ID-kaart, je paspoort of de brief van de gemeente. Wij hebben het nodig voor je loonadministratie. Het wordt versleuteld en veilig opgeslagen.',
  },
  iban: {
    title: 'Wat is een IBAN?',
    text: 'Dit is je bankrekeningnummer. In Nederland begint het met NL. Je vindt het in je bank-app of op je bankpas. Op deze rekening ontvang je straks je salaris.',
  },
  nationality: {
    title: 'Nationaliteit',
    text: 'Het land van je paspoort of ID-kaart. Heb je twee nationaliteiten? Kies dan de nationaliteit van het document dat je hier uploadt.',
  },
  phone: {
    title: 'Telefoonnummer',
    text: 'Het nummer waarop we je kunnen bereiken, ook via WhatsApp. Buitenlands nummer? Zet de landcode ervoor, bijvoorbeeld +48 voor Polen.',
  },
  email: {
    title: 'E-mailadres',
    text: 'Hierop ontvang je belangrijke documenten zoals je contract en loonstroken. Gebruik een e-mailadres dat je zelf regelmatig bekijkt.',
  },
  date_of_birth: {
    title: 'Geboortedatum',
    text: 'Vul je geboortedatum precies zo in als op je paspoort of ID-kaart.',
  },
  address_street: {
    title: 'Adres',
    text: 'Het adres waar je nu woont in Nederland. Begin met typen en kies je adres uit de lijst — dan wordt de rest automatisch ingevuld.',
  },
};

const BY_DOCUMENT_TYPE: Record<string, FieldHelp> = {
  id_bewijs: {
    title: 'ID-bewijs uploaden',
    text: 'Maak een duidelijke foto van je paspoort of ID-kaart. Is het een kaart? Fotografeer dan de voor- én achterkant. Zorg dat alle tekst goed leesbaar is en er geen vingers voor de tekst zitten. Let op: een rijbewijs is géén geldig ID-bewijs om te mogen werken.',
  },
  rijbewijs: {
    title: 'Rijbewijs uploaden',
    text: 'Alleen invullen als je een rijbewijs hebt. Maak een duidelijke foto van de voorkant. Dit helpt ons om werk te vinden waar een rijbewijs voor nodig is.',
  },
  certificaat: {
    title: 'Certificaat uploaden',
    text: 'Bijvoorbeeld een VCA-diploma, heftruckcertificaat of lascertificaat. Heb je meer certificaten? Upload de belangrijkste en geef de rest later aan je contactpersoon.',
  },
};

const BY_LABEL: Array<{ match: RegExp; help: FieldHelp }> = [
  { match: /\bbsn\b|burgerservice/i, help: BY_COLUMN.bsn },
  { match: /\biban\b|rekeningnummer|bankrekening/i, help: BY_COLUMN.iban },
  { match: /nationaliteit/i, help: BY_COLUMN.nationality },
  { match: /telefoon/i, help: BY_COLUMN.phone },
  { match: /geboortedatum/i, help: BY_COLUMN.date_of_birth },
  { match: /paspoort|id[- ]?(bewijs|kaart)|identiteit/i, help: BY_DOCUMENT_TYPE.id_bewijs },
  { match: /rijbewijs/i, help: BY_DOCUMENT_TYPE.rijbewijs },
  { match: /certificaat|diploma|vca/i, help: BY_DOCUMENT_TYPE.certificaat },
  { match: /noodcontact|ice\b/i, help: { title: 'Noodcontact', text: 'Iemand die we mogen bellen als er iets met jou gebeurt op het werk. Bijvoorbeeld je partner, een familielid of een goede vriend(in).' } },
  { match: /zorgverzeker/i, help: { title: 'Zorgverzekering', text: 'In Nederland is een zorgverzekering verplicht als je hier werkt. Heb je er nog geen? Bespreek dit met je contactpersoon — die kan je helpen.' } },
];

export function resolveFieldHelp(field: {
  label: string;
  maps_to_column?: string | null;
  document_type?: string | null;
}): FieldHelp | null {
  if (field.maps_to_column && BY_COLUMN[field.maps_to_column]) return BY_COLUMN[field.maps_to_column];
  if (field.document_type && BY_DOCUMENT_TYPE[field.document_type]) return BY_DOCUMENT_TYPE[field.document_type];
  const byLabel = BY_LABEL.find(entry => entry.match.test(field.label));
  return byLabel?.help ?? null;
}
