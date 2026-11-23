/** A #rrggbb channel (0, 1, 2) as linear-light sRGB, 0–1. */
const linear = (hex: string, channel: number) => {
  const c = parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16) / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/**
 * Black or white, whichever reads better on the given #rrggbb background
 * (WCAG relative luminance; 0.179 is where both give the same contrast).
 */
export function textOn(hex: string): '#000000' | '#ffffff' {
  const [r, g, b] = [0, 1, 2].map((i) => linear(hex, i))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000000' : '#ffffff'
}

/** CIE L*a*b* (D65 white) of a #rrggbb colour. */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = [0, 1, 2].map((i) => linear(hex, i))
  const xyz = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
  ]
  const [fx, fy, fz] = xyz.map((t) =>
    t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116,
  )
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** Perceptual distance between two #rrggbb colours: CIE76 ΔE, the straight line in Lab. */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a)
  const [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/**
 * Below this ΔE two person colours are too alike (decision A3). ΔE ≈ 2.3 is
 * just noticeable side by side on big patches, but people tell each other
 * apart by small dots and chips, often not side by side, so the bar is much
 * higher: below 20, two blues like #3d85c6 / #6d9eeb (≈ 13) or a salmon and
 * a red like #dd7e6b / #e06666 (≈ 14) are flagged, while orange vs yellow
 * (#ff9900 / #f1c232, ≈ 28) is not.
 */
export const CLASH_DELTA_E = 20

/** People whose colour is too close to `colour`, closest first (system profiles and `exceptId` left out). */
export function colourClashes<P extends { id: string; colour: string | null; isSystem: boolean }>(
  colour: string,
  people: P[],
  exceptId?: string,
): P[] {
  return people
    .filter((p) => p.colour && !p.isSystem && p.id !== exceptId)
    .map((p) => ({ p, d: deltaE(colour, p.colour!) }))
    .filter(({ d }) => d < CLASH_DELTA_E)
    .sort((x, y) => x.d - y.d)
    .map(({ p }) => p)
}
