/**
 * Vaste Nederlandse UI-teksten van het portaal, met hun Engelse vertaling.
 *
 * De sleutels zijn de **letterlijke tekstknopen zoals ze in de DOM staan** (whitespace
 * samengevouwen), niet de JSX-broncode. React splitst `Sinds {datum}` in een los knoopje
 * "Sinds" en de datum, dus staat hier "Sinds" en blijft de datum onaangeraakt.
 *
 * Alles wat hier níét in staat blijft zoals het is. Dat is bewust: bedrijfsnamen,
 * vacaturetitels, kamernummers, plaatsnamen en alles wat een gebruiker zelf invult horen
 * in hun eigen taal te blijven. Een opzoektabel doet dat vanzelf goed — een
 * machinevertaler deed het fout en vertaalde bedrijfsnamen mee.
 *
 * **Namen en andere klantdata worden nooit vertaald.** Daar vertrouwen we niet op toeval:
 * de plekken die zulke tekst tonen (namen, bedrijven, kentekens, panden, rewards,
 * documentnamen) staan in de JSX gemarkeerd met `data-no-translate="true"`, want zonder
 * dat zou een medewerker die "Bel" heet of een inlener die "Actief" heet zijn naam
 * vertaald zien worden. Toon je nieuwe klantdata? Markeer het element dan ook.
 *
 * Twee regels voor deze tabel:
 * 1. Geen sleutel die aan zichzelf gelijk is — die vertaalt niets en vergroot alleen de
 *    kans dat hij per ongeluk op klantdata matcht.
 * 2. Wees terughoudend met korte, generieke woorden: hoe korter de sleutel, hoe groter de
 *    kans dat een naam of plaats er toevallig gelijk aan is.
 *
 * Nieuwe UI-tekst toevoegen? Zet de Nederlandse tekst er precies zo in als hij op het
 * scherm staat. Staat een tekst er niet in, dan is dat zichtbaar (hij blijft Nederlands),
 * niet stuk.
 */
export const PORTAL_DICTIONARY_EN: Record<string, string> = {
  // --- Navigatie & chrome ---------------------------------------------------------
  'Uren': 'Hours',
  'Plaatsingen': 'Placements',
  'Documenten': 'Documents',
  'Vacatures': 'Vacancies',
  'Huisvesting': 'Housing',
  'Meer': 'More',
  'Voertuig': 'Vehicle',
  'Punten & rewards': 'Points & rewards',
  'Ziekmelding': 'Sick report',
  'Loonstroken': 'Payslips',
  'Jaaropgaven': 'Annual statements',
  'Urenbrieven': 'Hour statements',
  'Profiel': 'Profile',
  'Uitloggen': 'Log out',
  'Meldingen': 'Notifications',
  'Alles gelezen': 'Mark all as read',
  'Taal wisselen': 'Change language',

  // --- Dashboard ------------------------------------------------------------------
  'Welkom bij het portaal': 'Welcome to the portal',
  'Verbergen': 'Hide',
  'Welkom,': 'Welcome,',
  'Plaatsing bij': 'Placement at',
  'Sinds': 'Since',
  'tot': 'until',
  'Je hebt momenteel geen actieve plaatsing': 'You currently have no active placement',
  'Mijn plaatsing': 'My placement',
  'Bekijk details': 'View details',
  'Recente meldingen': 'Recent notifications',
  'Je uren van': 'Your hours for',
  'zijn goedgekeurd ✓': 'have been approved ✓',
  'zijn afgekeurd ✗': 'have been rejected ✗',
  'Mijn uren deze week': 'My hours this week',
  'goedgekeurd': 'approved',
  'in behandeling': 'pending',
  'Uren invullen': 'Enter hours',
  'Uren per week (laatste 12 weken)': 'Hours per week (last 12 weeks)',
  'Toeslagen breakdown': 'Surcharges breakdown',
  'Toeslagen': 'Surcharges',
  'Vergoedingen': 'Allowances',
  'Reiskosten': 'Travel expenses',
  'Mijn huisvesting': 'My housing',
  'Kamer:': 'Room:',
  '· Ingecheckt:': '· Checked in:',
  'Mijn auto': 'My car',
  'Openstaande acties': 'Open actions',
  'Documenten bekijken': 'View documents',
  'Verlopen': 'Expired',
  'Bijna verlopen': 'Expiring soon',

  // --- Uren -----------------------------------------------------------------------
  'Totaal deze week': 'Total this week',
  'uur': 'hours',
  'Week indienen': 'Submit week',
  'Uren opslaan': 'Save hours',
  'Overwerk uren (optioneel)': 'Overtime hours (optional)',
  'Opmerkingen (optioneel)': 'Comments (optional)',
  'Bijv. overwerk op verzoek van opdrachtgever': 'E.g. overtime at the client’s request',
  'Concept': 'Draft',
  'Ingediend': 'Submitted',
  'Goedgekeurd': 'Approved',
  'Afgekeurd': 'Rejected',
  'maa': 'mon',
  'din': 'tue',
  'woe': 'wed',
  'don': 'thu',
  'vri': 'fri',
  'zat': 'sat',
  'zon': 'sun',

  // --- Plaatsingen ----------------------------------------------------------------
  'Mijn plaatsingen': 'My placements',
  'Actief': 'Active',
  'Functie': 'Position',
  'Periode': 'Period',
  'heden': 'present',
  'Werklocatie': 'Work location',
  'Werkdagen': 'Working days',
  'Salarisindicatie': 'Salary indication',
  'Stad': 'City',
  'Actieve plaatsingen': 'Active placements',
  'Bekijk plaatsingen': 'View placements',

  // --- Documenten -----------------------------------------------------------------
  'Toevoegen': 'Add',
  'Geldig': 'Valid',
  'Bestand': 'File',
  'Beschrijving': 'Description',
  'Bijv. Paspoort': 'E.g. Passport',
  'Geen documenten gevonden': 'No documents found',

  // --- Vacatures ------------------------------------------------------------------
  'Bekijk beschikbare functies en reageer direct': 'Browse available jobs and apply directly',
  'Zoek op functie, bedrijf of locatie...': 'Search by job, company or location...',
  'Reageren': 'Apply',
  'Gesolliciteerd': 'Applied',
  'Reageren op vacature': 'Apply for this vacancy',
  'Motivatie (optioneel)': 'Motivation (optional)',
  'Waarom ben je geinteresseerd in deze functie?': 'Why are you interested in this role?',
  'Sollicitatie versturen': 'Send application',
  'Versturen...': 'Sending...',
  'Annuleren': 'Cancel',
  'Laden...': 'Loading...',
  'Er zijn momenteel geen openstaande vacatures': 'There are currently no open vacancies',
  'Geen vacatures gevonden voor je zoekopdracht': 'No vacancies found for your search',
  'Vereisten:': 'Requirements:',
  '/uur': '/hr',

  // --- Huisvesting ----------------------------------------------------------------
  'Verdieping:': 'Floor:',
  'Inhouding:': 'Deduction:',
  'Borg:': 'Deposit:',
  'Betaald': 'Paid',
  'Huur t/m:': 'Rent until:',
  'mnd': 'mo',
  'Doe je check-in': 'Complete your check-in',
  'Upload foto’s van je kamer bij aankomst zodat we de staat vastleggen.':
    'Upload photos of your room on arrival so we can record its condition.',
  "Upload foto's van je kamer bij aankomst zodat we de staat vastleggen.":
    'Upload photos of your room on arrival so we can record its condition.',
  'Onderhoud melden': 'Report maintenance',
  'Check-in inspectie': 'Check-in inspection',
  'Check-in inspectie door bewoner': 'Check-in inspection by resident',
  'Algemene staat': 'General condition',
  'Badkamer': 'Bathroom',
  'Beschrijf het probleem...': 'Describe the problem...',
  'Check-in vastgelegd, dankjewel!': 'Check-in recorded, thank you!',
  'Je hebt momenteel geen huisvesting toegewezen.': 'You currently have no housing assigned.',

  // --- Voertuig -------------------------------------------------------------------
  'Je hebt momenteel geen voertuig toegewezen.': 'You currently have no vehicle assigned.',
  'Schade melden': 'Report damage',
  'Beschrijf de schade...': 'Describe the damage...',
  'Bijv. krasje op deur, vlek op matras...': 'E.g. scratch on door, stain on mattress...',
  'Brandstof:': 'Fuel:',
  'Kenteken': 'Licence plate',

  // --- Punten & rewards -----------------------------------------------------------
  'Bekijk je saldo, geschiedenis en beschikbare rewards.': 'View your balance, history and available rewards.',
  'Beschikbaar saldo': 'Available balance',
  'punten': 'points',
  'Geschiedenis': 'History',
  'Aanvragen': 'Request',
  'Aangevraagd': 'Requested',

  // --- Ziekmelding ----------------------------------------------------------------
  'Ziek melden': 'Report sick',
  'Verwachte terugkeerdatum (optioneel)': 'Expected return date (optional)',
  'Je hoeft geen reden of medische details door te geven.':
    'You do not need to give a reason or any medical details.',
  'Ziekmelding indienen': 'Submit sick report',
  'Ziekmelding doorgegeven': 'Sick report submitted',
  'Beter melden': 'Report recovery',

  // --- Loonstroken / jaaropgaven / urenbrieven ------------------------------------
  'Mijn loonstroken': 'My payslips',
  'Mijn jaaropgaven': 'My annual statements',
  'Mijn urenbrieven': 'My hour statements',
  'Geen loonstroken gevonden': 'No payslips found',
  'Geen jaaropgaven gevonden': 'No annual statements found',
  'Geen urenbrieven gevonden': 'No hour statements found',
  'Downloaden': 'Download',

  // --- Profiel --------------------------------------------------------------------
  'Mijn profiel': 'My profile',
  'Persoonlijke gegevens': 'Personal details',
  'Voornaam': 'First name',
  'Achternaam': 'Last name',
  'Geboortedatum': 'Date of birth',
  'Personeelsnummer': 'Employee number',
  'Contactgegevens': 'Contact details',
  'Telefoon': 'Phone',
  'E-mail': 'Email',
  'Straat + huisnr': 'Street + number',
  'Postcode': 'Postal code',
  'Taal portaal': 'Portal language',
  'Opslaan': 'Save',
  'Opslaan...': 'Saving...',
  'Profiel opgeslagen': 'Profile saved',

  // --- Klantportaal ---------------------------------------------------------------
  'Mijn medewerkers': 'My employees',
  'Uren goedkeuren': 'Approve hours',
  'Goedkeuren': 'Approve',
  'Afkeuren': 'Reject',
  'Bevestigen': 'Confirm',
  'Alle': 'All',
  'Acties': 'Actions',
  'Beoordeling': 'Review',
  'Bijv. verkeerde uren, niet gewerkt op deze dag...':
    'E.g. wrong hours, did not work on this day...',

  // --- Algemeen -------------------------------------------------------------------
  'Sluiten': 'Close',
  'Opnieuw proberen': 'Try again',
  'Er ging iets mis': 'Something went wrong',
  'Bel': 'Call',
};
