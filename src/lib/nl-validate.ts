// Client-side validatie voor Nederlandse identificatienummers.
// Vangt typefouten vroeg af; de server blijft leidend.

/** BSN-elfproef: 9 cijfers, gewogen som (laatste cijfer telt -1) deelbaar door 11. */
export function isValidBsn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 9) return false;
  const sum = digits
    .split('')
    .reduce((acc, d, i) => acc + Number(d) * (i === 8 ? -1 : 9 - i), 0);
  return sum % 11 === 0;
}

/** IBAN mod-97 checksum (ISO 13616), voor NL en buitenlandse rekeningen. */
export function isValidIban(value: string): boolean {
  const iban = value.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));
  // mod 97 in stukken (getal is te groot voor Number)
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(`${remainder}${numeric.slice(i, i + 7)}`) % 97;
  }
  return remainder === 1;
}
