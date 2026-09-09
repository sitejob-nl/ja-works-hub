import { z } from 'zod';
import type { ClientLinkStatus } from '../../supabase/functions/_shared/hours-client-entries.ts';

/**
 * The client week page reads its whole world through this boundary.
 *
 * Unknown keys are dropped rather than refused. The page renders only what this
 * schema names, so a field the server grows can never be shown — and refusing
 * outright would break every live link the moment a migration reaches
 * production ahead of the frontend, which is the usual order in this repo.
 * A payload whose *shape* is wrong is still a hard failure.
 */
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const clientDeliverySchema = z.object({
  minutes: z.number().int().min(0).max(1440),
  no_hours_reason: z.string().nullable(),
  note: z.string().nullable(),
  status: z.enum(['open', 'applied', 'discarded']),
  created_at: z.string(),
});

export const clientWeekSchema = z.object({
  week: z.object({
    id: uuid, company_name: z.string(), week_start: date,
    submission_deadline_at: z.string().nullable(),
  }),
  expires_at: z.string(),
  report: z.object({
    kind: z.enum(['later', 'complete']), note: z.string().nullable(), created_at: z.string(),
  }).nullable(),
  members: z.array(z.object({
    id: uuid, candidate_name: z.string(),
    days: z.array(z.object({
      id: uuid, work_date: date, delivered: clientDeliverySchema.nullable(),
    })),
  })),
  expected_days: z.number().int().nonnegative(),
  provided_days: z.number().int().nonnegative(),
  outstanding_days: z.number().int().nonnegative(),
  complete: z.boolean(),
});

/**
 * Declared rather than inferred: the relaxed compiler settings widen a Zod
 * inference into all-optional fields, which loses the guarantees the schema
 * actually checks at the boundary.
 */
export interface ClientDelivery {
  minutes: number; no_hours_reason: string | null; note: string | null;
  status: 'open' | 'applied' | 'discarded'; created_at: string;
}
export interface ClientWeekDay { id: string; work_date: string; delivered: ClientDelivery | null }
export interface ClientWeekMember { id: string; candidate_name: string; days: ClientWeekDay[] }
export interface ClientWeek {
  week: { id: string; company_name: string; week_start: string; submission_deadline_at: string | null };
  expires_at: string;
  report: { kind: 'later' | 'complete'; note: string | null; created_at: string } | null;
  members: ClientWeekMember[];
  expected_days: number;
  provided_days: number;
  outstanding_days: number;
  complete: boolean;
}

export function parseClientWeek(value: unknown): ClientWeek {
  return clientWeekSchema.parse(value) as ClientWeek;
}

/** What the visitor is told, in their own terms, when the link does not open. */
export const CLIENT_LINK_MESSAGES: Record<ClientLinkStatus, string> = {
  expired: 'Deze link is verlopen. Vraag uw contactpersoon om een nieuwe link.',
  revoked: 'Deze link is ingetrokken. Vraag uw contactpersoon om een nieuwe link.',
  invalid: 'Deze link werkt niet. Controleer of u de volledige link uit de e-mail heeft geopend.',
  unavailable: 'Deze urenweek is op dit moment niet beschikbaar. Neem contact op met uw contactpersoon.',
};

/** Minutes back to the notation the client typed, so the page reads its own input. */
export function formatClientHours(minutes: number): string {
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

export type { ClientLinkStatus };
