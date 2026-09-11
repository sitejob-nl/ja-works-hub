/**
 * The reader for hours typed into a message now lives beside the calculation
 * kernel, so an unattended intake runs exactly the same rules as an upload.
 * This module keeps the address the browser has always used.
 */
export { readHoursFromMailText } from '../../supabase/functions/_shared/hours-mail-text';
export type { MailReadingContext } from '../../supabase/functions/_shared/hours-mail-text';
