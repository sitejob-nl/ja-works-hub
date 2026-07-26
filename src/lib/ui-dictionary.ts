import { RECRUITER_UI_DICTIONARY_EN } from '@/lib/recruiter-ui-dictionary';

/**
 * Vaste Nederlandse UI-teksten met hun Engelse vertaling.
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
export const UI_DICTIONARY_EN: Record<string, string> = {
  ...RECRUITER_UI_DICTIONARY_EN,
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
  // --- Recruiter-omgeving: gedeelde navigatie --------------------------------------
  // De interne paginalichamen gebruiken hetzelfde woordenboek via de centrale
  // data-translate-region op AppLayout. Domeinspecifieke copy staat in
  // recruiter-ui-dictionary.ts; tenantdata staat bewust niet in een woordenboek.
  'Relaties': 'Relations',
  'Werk': 'Work',
  'Vastgoed & Fleet': 'Property & fleet',
  'Taken': 'Tasks',
  'Opdrachtgevers': 'Clients',
  'Kandidaten': 'Candidates',
  'Contacten': 'Contacts',
  'Talentpools': 'Talent pools',
  'Facturatie': 'Invoicing',
  'Uitstroom': 'Attrition',
  'Tankpas analyse': 'Fuel card analysis',
  'Kilometeranalyse': 'Mileage analysis',
  'Communicatie': 'Communication',
  'Email Templates': 'Email templates',
  'Agenda': 'Calendar',
  'Bulk Campagnes': 'Bulk campaigns',
  'Kennisbank': 'Knowledge base',
  'Vacaturebank': 'Job board',
  'Kandidaten zoeken': 'Search candidates',
  'Omzet (directie)': 'Revenue (management)',
  'Instellingen': 'Settings',
  'Mijn Outlook': 'My Outlook',
  'Zoeken...': 'Search...',
  'Inklappen': 'Collapse',
  'Uitklappen': 'Expand',

  // --- Recruiter: /kandidaten ------------------------------------------------------
  'Overzicht van alle kandidaten': 'Overview of all candidates',
  'Nieuwe kandidaat': 'New candidate',
  'Importeren': 'Import',
  'Duplicaten': 'Duplicates',
  'Alle kandidaten': 'All candidates',
  'Instroomfunnel': 'Intake funnel',
  'In dienst': 'Employed',
  'In dienst nemen': 'Hire',
  'Kandidaat in dienst nemen': 'Hire candidate',
  'Filteren op': 'Filter by',
  'Alle statussen': 'All statuses',
  'Alle compliance': 'All compliance',
  'Alle nationaliteiten': 'All nationalities',
  'Alle talen': 'All languages',
  'Alle vaardigheden': 'All skills',
  'Alle filters wissen': 'Clear all filters',
  'Wissen': 'Clear',
  'Deselecteren': 'Deselect',
  'Naam': 'Name',
  'Nationaliteit': 'Nationality',
  'Taal': 'Language',
  'Vaardigheden': 'Skills',
  'Rijbewijs': 'Driving licence',
  'Heeft rijbewijs': 'Has driving licence',
  'Geen rijbewijs': 'No driving licence',
  'Heeft eigen huisvesting': 'Has own housing',
  'Geen eigen huisvesting': 'No own housing',
  'Compleet': 'Complete',
  'Incompleet': 'Incomplete',
  'Screening bezig': 'Screening in progress',
  'Screening afgerond': 'Screening completed',
  'Niet gestart': 'Not started',
  'Nieuw': 'New',
  'Actieve plaatsing': 'Active placement',
  'Startdatum': 'Start date',
  'Medewerkernr.': 'Employee no.',
  'Portaal': 'Portal',
  'Toevoegen aan talentpool': 'Add to talent pool',
  'Verwijderen': 'Delete',
  'Nog geen kandidaten': 'No candidates yet',
  'Nog geen kandidaten in dienst': 'No employed candidates yet',
  'Voeg je eerste kandidaat toe': 'Add your first candidate',
  'Zoek op naam, stad, e-mail of telefoon...': 'Search by name, city, email or phone...',
  'Zoek op naam...': 'Search by name...',
  'Zoek in CV-tekst': 'Search CV text',
  'Zoekt met Nederlandse taalondersteuning in de volledige CV-tekst':
    'Searches the full CV text with Dutch language support',
  'bijv. lassen MIG TIG ervaring': 'e.g. welding MIG TIG experience',
  'Toont kandidaten met minstens één van de gekozen vaardigheden':
    'Shows candidates with at least one of the selected skills',

  // --- Recruiter: /vacatures -------------------------------------------------------
  'Openstaande en vervulde vacatures': 'Open and filled vacancies',
  'Nieuwe vacature': 'New vacancy',
  'Titel': 'Title',
  'Opdrachtgever': 'Client',
  'Locatie': 'Location',
  'Salaris': 'Salary',
  'Aantal': 'Number',
  'Urgentie': 'Urgency',
  'Alle urgentie': 'All urgency levels',
  'Nog geen vacatures': 'No vacancies yet',
  'Voeg je eerste vacature toe': 'Add your first vacancy',
  'Zoek op functietitel of opdrachtgever...': 'Search by job title or client...',
  'Meer filters': 'More filters',
  '1 — Laag': '1 — Low',
  '2 — Normaal': '2 — Normal',
  '3 — Hoog': '3 — High',

  // --- Recruiter: statuslabels in tabellen -----------------------------------------
  // De kandidatenlijst rendert deze uit vaste labelmaps; de compliance-badge toont de
  // ruwe enum-waarde, vandaar de kleine letters.
  'In behandeling': 'In progress',
  'Beschikbaar': 'Available',
  'Werkzoekend': 'Job seeking',
  'Geplaatst': 'Placed',
  'Inactief': 'Inactive',
  'Afgewezen': 'Rejected',
  'Niet beschikbaar': 'Not available',
  'Uitgeschreven': 'Deregistered',
  'Ziek': 'Sick',
  'Uit dienst': 'Left employment',
  'compleet': 'complete',
  'incompleet': 'incomplete',
  'verlopen': 'expired',
  'Geen link': 'No link',
  'Link aangemaakt': 'Link created',
  'Link verstuurd': 'Link sent',
  'Bezig met invullen': 'Being filled in',
  'Profiel compleet': 'Profile complete',

  // Telregels naast de filters: React zet het aantal in een eigen knoop, dus de sleutel
  // is alleen het zelfstandig naamwoord.
  'kandidaten': 'candidates',
  'vacatures': 'vacancies',

  'Selecteer alle kandidaten op deze pagina': 'Select all candidates on this page',
  'Deselecteer alle kandidaten op deze pagina': 'Deselect all candidates on this page',
};
