/**
 * Base64 for the Deno edge runtime, which has no Buffer.
 *
 * `btoa` needs a binary string, and `String.fromCharCode(...bytes)` overflows
 * the stack on anything large, so the bytes are fed through in chunks.
 *
 * Used by the scan reader and by analyze-cv. Four more hand-written copies of
 * this loop still live in analyze-cv-batch, send-regulations, whatsapp-api and
 * confirm-match-interview; moving those over means redeploying four functions
 * that this change does not otherwise touch, so it is a separate cleanup.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
