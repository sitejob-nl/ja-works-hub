/**
 * Wat er hoort te gebeuren als een match naar een volgende fase gaat.
 *
 * Een fasewissel is zelden alléén een statusveld: "Voorgesteld" betekent dat er een
 * mail naar de opdrachtgever gaat, "Gesprek gepland" betekent dat er een datum is,
 * "Geaccepteerd" betekent dat er geplaatst kan worden. Voorheen zat die kennis in de
 * knoppen op de vacaturetab en niet in de kanban, waardoor slepen wél de status
 * verzette maar het bijbehorende werk oversloeg.
 *
 * Deze module is de enige plek waar dat is vastgelegd; kanban en lijst gebruiken hem
 * allebei, zodat het gedrag niet opnieuw uit elkaar loopt.
 */

export type MatchTransitionKind =
  | 'none'
  | 'feedback'
  | 'proposal'
  | 'interview'
  | 'placement'
  | 'screening';

export type MatchTransition = {
  kind: MatchTransitionKind;
  /**
   * Schrijven we de status meteen weg (true), of pas als de dialoog is afgerond (false)?
   *
   * Gate (false) wanneer de status een gebeurtenis claimt die nog niet heeft
   * plaatsgevonden — "Voorgesteld" zonder verstuurde mail is een leugen in het dossier.
   * Meteen (true) wanneer de status een besluit is dat losstaat van de vervolgactie:
   * een klant die telefonisch akkoord geeft is geaccepteerd, ook als je de plaatsing
   * pas morgen invult.
   */
  commitFirst: boolean;
};

const NO_ACTION: MatchTransition = { kind: 'none', commitFirst: true };

const TRANSITIONS: Record<string, MatchTransition> = {
  // Afwijzen vraagt om een reden — de dialoog schrijft zelf weg (bestaand gedrag).
  afgewezen: { kind: 'feedback', commitFirst: false },
  // "Voorstel klaar" is een voorbereidingsfase: de editor is een hulpmiddel, geen eis.
  voorgesteld: { kind: 'proposal', commitFirst: true },
  // "Voorgesteld" claimt dat de klant het gezien heeft → pas na verzenden.
  voorgesteld_bij_klant: { kind: 'proposal', commitFirst: false },
  // Beide afspraakfases hebben een datum nodig, anders is de fase betekenisloos.
  afspraak_voorgesteld: { kind: 'interview', commitFirst: false },
  afspraak_op_kantoor: { kind: 'interview', commitFirst: false },
  // Acceptatie is het besluit van de klant; plaatsen is de volgende stap.
  geaccepteerd: { kind: 'placement', commitFirst: true },
  // Screening is een verwijzing, geen dialoog.
  gescreend: { kind: 'screening', commitFirst: true },
};

/**
 * Bulk kent geen dossier-dialogen: één voorstelmail of één plaatsingswizard voor
 * twintig kandidaten bestaat niet. Alleen afwijzen werkt wél in bulk, want daar is de
 * reden gedeeld. De rest valt bij een selectie van meer dan één terug op een kale
 * statuswissel.
 */
export const getMatchTransition = (toStatus: string | null | undefined, count = 1): MatchTransition => {
  const transition = TRANSITIONS[toStatus ?? ''] ?? NO_ACTION;
  if (count === 1) return transition;
  return transition.kind === 'feedback' ? transition : NO_ACTION;
};

export const matchTransitionNeedsDialog = (toStatus: string | null | undefined, count = 1) =>
  getMatchTransition(toStatus, count).kind !== 'none';
