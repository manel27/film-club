/** A numeric id from the URL: a positive whole number JavaScript holds exactly, else null. */
export function parseId(text: string): number | null {
  const n = Number(text)
  return /^\d+$/.test(text) && Number.isSafeInteger(n) && n > 0 ? n : null
}
