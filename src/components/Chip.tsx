import { Link } from 'react-router'
import type { Person } from '../films/films'
import { textOn } from '../lib/colour'

/** A person's name on their own colour, with black or white text; links to their profile (not system profiles). */
export default function Chip({ person }: { person: Person | undefined }) {
  const style = person?.colour
    ? { backgroundColor: person.colour, color: textOn(person.colour) }
    : undefined
  if (person && !person.isSystem) {
    return (
      <Link to={`/people/${person.id}`} className="chip" style={style}>
        {person.name}
      </Link>
    )
  }
  return (
    <span className="chip" style={style}>
      {person?.name ?? 'Unknown'}
    </span>
  )
}
