import { formatDate, formatEUR } from '@/lib/format';

/**
 * Een boete zoals de twee boetes-schermen hem uit `vehicle_fines` halen: de
 * eigen kolommen plus (op het transportoverzicht) de gejoinde `vehicles`-rij.
 * Bewust ruim getypeerd — beide tabs werken met `any`.
 */
export interface FineLike {
  id?: string;
  vehicle_id?: string | null;
  employee_id?: string | null;
  candidate_id?: string | null;
  fine_date?: string | null;
  due_date?: string | null;
  amount?: number | null;
  reference_number?: string | null;
  description?: string | null;
  notes?: string | null;
  paid?: boolean | null;
  paid_at?: string | null;
  photos?: string[] | null;
  vehicles?: { license_plate?: string | null } | null;
}

/** Kenteken uit de gejoinde `vehicles`-rij, of de fallback van het voertuig-tabblad. */
export const fineLicensePlate = (fine: FineLike, fallback?: string | null): string | null =>
  fine.vehicles?.license_plate ?? fallback ?? null;

/** "de boete van 12-05-2026 op AB-123-C (€ 95,00)" — de drie feiten waarop je een boete herkent. */
export const describeFine = (fine: FineLike, licensePlate?: string | null): string => {
  const plate = fineLicensePlate(fine, licensePlate);
  return `de boete van ${formatDate(fine.fine_date)}${plate ? ` op ${plate}` : ''} (${formatEUR(fine.amount)})`;
};

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Uitleg in de verwijder-bevestiging; noemt de bijlagen, want die gaan mee uit de opslag. */
export const deleteFineDescription = (fine: FineLike, licensePlate?: string | null): string => {
  const photoCount = fine.photos?.length ?? 0;
  const attachments = photoCount > 0 ? `, inclusief ${photoCount} ${photoCount === 1 ? 'bijlage' : 'bijlagen'}` : '';
  return `Verwijdert ${describeFine(fine, licensePlate)}${attachments}. Deze actie kan niet ongedaan worden gemaakt.`;
};

/** Titel, uitleg en knoplabel voor het omzetten van de betaalstatus. */
export const paidToggleCopy = (fine: FineLike, licensePlate?: string | null) => {
  const subject = capitalize(describeFine(fine, licensePlate));
  return fine.paid
    ? {
        title: 'Markeren als niet betaald?',
        description: `${subject} wordt weer als niet betaald gemarkeerd; de betaaldatum wordt gewist.`,
        confirmLabel: 'Markeren als niet betaald',
      }
    : {
        title: 'Markeren als betaald?',
        description: `${subject} wordt als betaald gemarkeerd, met vandaag als betaaldatum.`,
        confirmLabel: 'Markeren als betaald',
      };
};

/**
 * De oude waarden voor de auditregel bij verwijderen: de eigen kolommen van de
 * boete, zonder de gejoinde relaties, plus het kenteken zodat de regel leesbaar
 * blijft als het voertuig later zelf verdwijnt.
 */
export const fineAuditValues = (fine: FineLike, licensePlate?: string | null) => ({
  vehicle_id: fine.vehicle_id ?? null,
  license_plate: fineLicensePlate(fine, licensePlate),
  employee_id: fine.employee_id ?? null,
  candidate_id: fine.candidate_id ?? null,
  fine_date: fine.fine_date ?? null,
  due_date: fine.due_date ?? null,
  amount: fine.amount ?? null,
  reference_number: fine.reference_number ?? null,
  description: fine.description ?? null,
  notes: fine.notes ?? null,
  paid: fine.paid ?? false,
  paid_at: fine.paid_at ?? null,
  photos: fine.photos ?? [],
});
