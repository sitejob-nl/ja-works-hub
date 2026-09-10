import { z } from 'zod';

/**
 * What the office sees of the durable mail intake: which folders are followed,
 * and what came in that the intake refused to place.
 *
 * Deliberately free of the Supabase client. The control-bin screen only needs
 * these words and shapes, and importing the data layer for them would pull a
 * configured client into every test that renders it.
 */
export const hoursMailFolderSchema = z.object({
  id: z.string(), mail_account_id: z.string(), folder_id: z.string(), folder_label: z.string(),
  enabled: z.boolean(), mailbox_email: z.string().nullable(), mailbox_name: z.string().nullable(),
  has_cursor: z.boolean(), cursor_updated_at: z.string().nullable(),
  resync_count: z.number().int().nonnegative(), last_run_at: z.string().nullable(),
  last_error: z.string().nullable(),
  pending: z.number().int().nonnegative(), filed: z.number().int().nonnegative(),
});
export const hoursMailAttentionSchema = z.object({
  id: z.string(), subject: z.string().nullable(),
  from_address: z.string().nullable(), from_name: z.string().nullable(),
  received_at: z.string().nullable(), first_seen_at: z.string(),
  reason_code: z.string(), reason_note: z.string().nullable(),
  attempt_count: z.number().int().nonnegative(), folder_label: z.string(),
  has_attachments: z.boolean(),
});
export const hoursMailOverviewSchema = z.object({
  organization_id: z.string(), can_manage: z.boolean(),
  folders: z.array(hoursMailFolderSchema).default([]),
  attention: z.array(hoursMailAttentionSchema).default([]),
});

export interface HoursMailFollowed {
  id: string; mail_account_id: string; folder_id: string; folder_label: string;
  enabled: boolean; mailbox_email: string | null; mailbox_name: string | null;
  has_cursor: boolean; cursor_updated_at: string | null;
  resync_count: number; last_run_at: string | null; last_error: string | null;
  pending: number; filed: number;
}
export interface HoursMailAttention {
  id: string; subject: string | null;
  from_address: string | null; from_name: string | null;
  received_at: string | null; first_seen_at: string;
  reason_code: string; reason_note: string | null;
  attempt_count: number; folder_label: string; has_attachments: boolean;
}
export interface HoursMailOverview {
  organization_id: string; can_manage: boolean;
  folders: HoursMailFollowed[]; attention: HoursMailAttention[];
}

export function parseMailOverview(value: unknown): HoursMailOverview {
  return hoursMailOverviewSchema.parse(value) as HoursMailOverview;
}

/**
 * Why a message stopped, in the words the office needs. Every one of these is a
 * refusal to guess: the intake saw something it could not place, and says so
 * instead of putting hours on a week it is not sure about.
 */
export const HOURS_MAIL_REASONS: Record<string, string> = {
  geen_uitvraag: 'Geen uitvraagreferentie gevonden',
  onbekende_uitvraag: 'De genoemde referentie bestaat niet',
  dubbele_uitvraag: 'Twee verschillende referenties in één bericht',
  uitvraag_gesloten: 'De uitvraag is ingetrokken of verlopen',
  onbekende_afzender: 'De afzender hoort bij geen enkele contactpersoon',
  tegenstrijdige_koppeling: 'De referentie en de afzender wijzen naar verschillende opdrachtgevers',
  week_gesloten: 'De opdrachtgever of de urenmodule staat uit',
  geen_werkdagen: 'Deze week kent nog geen werkdagen',
  niet_leesbaar: 'Het bericht kon niet worden gelezen',
  te_vaak_geprobeerd: 'De verwerking is te vaak mislukt',
  verdwenen: 'Het bericht is uit de map verdwenen',
  handmatig_afgehandeld: 'Handmatig afgehandeld',
};

export function describeMailReason(code: string): string {
  return HOURS_MAIL_REASONS[code] ?? 'Onbekende reden';
}

