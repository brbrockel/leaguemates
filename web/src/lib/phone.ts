/** "+18605551234" -> "(860) 555-1234"; other countries are shown as stored. */
export function formatPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}

export const mapsUrl = (address: string) =>
  `https://maps.google.com/?q=${encodeURIComponent(address)}`;
