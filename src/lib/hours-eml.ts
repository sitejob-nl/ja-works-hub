/**
 * The e-mail reader now lives beside the calculation kernel.
 *
 * A message that somebody drags into the week screen and a message that arrives
 * by itself must be read by one set of rules, and a Deno edge function cannot
 * import from the browser bundle. This module keeps the address the browser has
 * always used.
 */
export {
  decodeEmailMessage, splitQuotedHistory,
} from '../../supabase/functions/_shared/hours-eml';
export type {
  EmailAttachment, EmailMessage, EmailDecoding,
} from '../../supabase/functions/_shared/hours-eml';
