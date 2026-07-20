// Pure logica achter "ontbrekende gegevens aanvullen tijdens plaatsen".
// Vertaalt een compliance-probleem naar de actie die de gebruiker in de wizard krijgt,
// en valideert wat er wordt ingevuld of geüpload. Geen React, geen Supabase — bewust
// testbaar los van de UI.

import { isValidBsn, isValidIban } from '@/lib/nl-validate';
import type { ComplianceItem } from '@/hooks/useComplianceCheck';

/**
 * Documenttypen die de `document_type`-enum in de database kent. Compliance-regels
 * bewaren `required_documents` als vrije tekst, dus een regel kan best een type
 * eisen dat de enum niet heeft (bijv. 'vca'). Zo'n document valt niet te uploaden —
 * de insert zou stuklopen — en wordt daarom als niet-oplosbaar getoond.
 */
export const UPLOADABLE_DOCUMENT_TYPES = [
  'id_bewijs', 'rijbewijs', 'certificaat', 'contract', 'reglement', 'overig',
  'bankbewijs', 'loonstrook', 'jaaropgave', 'urenbrief', 'cv',
  'onboarding_formulier', 'diploma', 'werkfoto', 'pasfoto',
] as const;

export type UploadableDocumentType = (typeof UPLOADABLE_DOCUMENT_TYPES)[number];

export const isUploadableDocumentType = (docType?: string): docType is UploadableDocumentType =>
  Boolean(docType) && (UPLOADABLE_DOCUMENT_TYPES as readonly string[]).includes(docType as string);

/** Documenttypen waarbij een vervaldatum betekenisvol is; daar vragen we 'Geldig tot' bij. */
const DOCUMENT_TYPES_WITH_EXPIRY = new Set<string>(['id_bewijs', 'rijbewijs', 'certificaat', 'diploma']);

export const documentHasExpiry = (docType: string) => DOCUMENT_TYPES_WITH_EXPIRY.has(docType);

type FieldInputType = 'text' | 'date' | 'email' | 'tel';

interface EditableFieldSpec {
  inputType: FieldInputType;
  placeholder?: string;
  /** Toelichting onder het veld; alleen waar de gebruiker houvast nodig heeft. */
  hint?: string;
}

/**
 * Kandidaatvelden die we vanuit de wizard mogen schrijven. Net als bij documenten geldt:
 * `required_fields` is vrije tekst, dus alles wat hier niet in staat tonen we zonder
 * invoerveld in plaats van blind een onbekende kolom te updaten.
 */
export const EDITABLE_COMPLIANCE_FIELDS: Record<string, EditableFieldSpec> = {
  bsn: { inputType: 'text', placeholder: '123456789', hint: '9 cijfers' },
  iban: { inputType: 'text', placeholder: 'NL00 BANK 0000 0000 00' },
  date_of_birth: { inputType: 'date' },
  nationality: { inputType: 'text', placeholder: 'Nederlandse' },
  address_street: { inputType: 'text', placeholder: 'Straatnaam 1' },
  phone: { inputType: 'tel', placeholder: '+31 6 12345678' },
  email: { inputType: 'email', placeholder: 'naam@voorbeeld.nl' },
};

export type ComplianceAction =
  | { type: 'upload'; docType: UploadableDocumentType; withExpiry: boolean }
  | { type: 'field'; field: string; inputType: FieldInputType; sensitive: boolean; placeholder?: string; hint?: string }
  | { type: 'none'; reason: string };

/**
 * Bepaalt of en hoe een compliance-probleem in de wizard opgelost kan worden.
 * Alles wat niet ter plekke op te lossen is krijgt `type: 'none'` met een reden
 * in gewone taal, zodat de gebruiker weet waar hij het wél kan aanpassen.
 */
export function resolveComplianceAction(item: ComplianceItem): ComplianceAction {
  if (item.kind === 'blocked') {
    return {
      type: 'none',
      reason: item.code === 'blocked:no_dutch_address'
        ? 'Pas het adres aan op het kandidaatdossier.'
        : 'Werk het rijbewijs bij op het kandidaatdossier.',
    };
  }

  if (item.kind === 'document') {
    if (!isUploadableDocumentType(item.docType)) {
      return { type: 'none', reason: 'Dit documenttype kan hier niet geüpload worden. Pas de compliance-regel aan.' };
    }
    return { type: 'upload', docType: item.docType, withExpiry: documentHasExpiry(item.docType) };
  }

  const field = item.field ?? '';
  const spec = EDITABLE_COMPLIANCE_FIELDS[field];
  if (!spec) {
    return { type: 'none', reason: 'Dit gegeven kan hier niet ingevuld worden. Vul het aan op het kandidaatdossier.' };
  }
  return {
    type: 'field',
    field,
    inputType: spec.inputType,
    sensitive: item.kind === 'sensitive',
    placeholder: spec.placeholder,
    hint: spec.hint,
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Plausibiliteitscheck op een ingevulde waarde. Geeft een Nederlandse melding terug,
 * of `null` als de waarde er goed uitziet. De server blijft leidend.
 */
export function validateComplianceField(field: string, rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) return 'Vul een waarde in.';

  switch (field) {
    case 'bsn':
      return isValidBsn(value)
        ? null
        : 'Dit lijkt geen geldig BSN. Een BSN bestaat uit 9 cijfers en moet kloppen met de elfproef.';

    case 'iban':
      return isValidIban(value)
        ? null
        : 'Dit lijkt geen geldig IBAN. Controleer het rekeningnummer, bijvoorbeeld NL91 ABNA 0417 1643 00.';

    case 'date_of_birth': {
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return 'Vul een geldige datum in.';
      if (parsed.getTime() > Date.now()) return 'De geboortedatum kan niet in de toekomst liggen.';
      if (parsed.getFullYear() < 1900) return 'Controleer de geboortedatum, dit jaartal lijkt niet te kloppen.';
      return null;
    }

    case 'email':
      return EMAIL_RE.test(value) ? null : 'Dit lijkt geen geldig e-mailadres.';

    case 'phone':
      return value.replace(/\D/g, '').length >= 8
        ? null
        : 'Vul een volledig telefoonnummer in, inclusief netnummer of landcode.';

    default:
      return value.length >= 2 ? null : 'Vul minimaal 2 tekens in.';
  }
}

/**
 * Zet een ingevulde waarde om naar de vorm waarin we hem willen bewaren.
 * BSN en IBAN worden versleuteld opgeslagen en zijn daarna niet meer te normaliseren,
 * dus dat gebeurt hier: spaties en streepjes eruit, IBAN in hoofdletters.
 */
export function normalizeComplianceField(field: string, rawValue: string): string {
  const value = rawValue.trim();
  if (field === 'bsn') return value.replace(/\D/g, '');
  if (field === 'iban') return value.replace(/[\s-]/g, '').toUpperCase();
  return value;
}

/** Bestandsformaten die we bij een compliance-upload accepteren. */
export const ACCEPTED_UPLOAD_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png'] as const;
export const ACCEPTED_UPLOAD_ATTRIBUTE = '.pdf,.jpg,.jpeg,.png';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const fileExtension = (fileName: string) => {
  const parts = fileName.split('.');
  return parts.length > 1 ? (parts.pop() as string).toLowerCase() : '';
};

/** Geeft een Nederlandse melding terug, of `null` als het bestand bruikbaar is. */
export function validateUploadFile(file: { name: string; size: number }): string | null {
  const ext = fileExtension(file.name);
  if (!(ACCEPTED_UPLOAD_EXTENSIONS as readonly string[]).includes(ext)) {
    return 'Kies een PDF, JPG of PNG.';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `Het bestand is te groot (maximaal ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB).`;
  }
  if (file.size === 0) return 'Het bestand is leeg.';
  return null;
}

/**
 * Opslagpad in de `documents`-bucket. Identiek aan het pad dat het documententabblad
 * op het kandidaatdossier gebruikt, zodat een hier geüpload bestand niet afwijkt.
 */
export function buildDocumentStoragePath(orgId: string, candidateId: string, fileName: string, uuid: string) {
  const ext = fileExtension(fileName);
  return ext ? `${orgId}/${candidateId}/${uuid}.${ext}` : `${orgId}/${candidateId}/${uuid}`;
}
