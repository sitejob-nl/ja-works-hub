/**
 * Base64 for the Deno edge runtime, which has no Buffer.
 *
 * `btoa` needs a binary string, and `String.fromCharCode(...bytes)` overflows
 * the stack on anything large, so the bytes are fed through in chunks. One
 * implementation on purpose: this is the code whose failure mode on a big file
 * is a stack overflow, and it should not be fixed in one place and not another.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
