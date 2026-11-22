import type { Person } from '../films/films'
import { textOn } from '../lib/colour'

/** A person's name on their own colour, with black or white text. */
export default function Chip({ person }: { person: Person | undefined }) {
  const style = person?.colour
    ? { backgroundColor: person.colour, color: textOn(person.colour) }
    : undefined
  return (
    <span className="chip" style={style}>
      {person?.name ?? 'Unknown'}
    </span>
  )
}
