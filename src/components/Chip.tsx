import { useId } from 'react'
import { Link } from 'react-router'
import type { Person } from '../films/films'
import { textOn } from '../lib/colour'
import { ROLE_NAMES } from '../people/profile'

/** A person's name on their own colour, with black or white text; links to their profile (not system profiles). */
export default function Chip({
  person,
  describedBy,
}: {
  person: Person | undefined
  describedBy?: string
}) {
  const style = person?.colour
    ? { backgroundColor: person.colour, color: textOn(person.colour) }
    : undefined
  if (person && !person.isSystem) {
    return (
      <Link
        to={`/people/${person.id}`}
        className="chip"
        style={style}
        aria-describedby={describedBy}
      >
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

/** A person's plain name, linking to their profile like Chip does (not system profiles). */
export function PersonName({ person }: { person: Person | undefined }) {
  if (person && !person.isSystem) return <Link to={`/people/${person.id}`}>{person.name}</Link>
  return <>{person?.name ?? 'Unknown'}</>
}

/**
 * A Chip whose role shows on hover (pointer devices) and keyboard focus. aria-describedby
 * reads it even while hidden. Touch: no tip (the profile shows the role). System profiles
 * and unknown people get no tip. Put it inside an element spread with useTipsOff().
 */
export function RoleChip({ person }: { person: Person | undefined }) {
  const id = useId()
  if (!person || person.isSystem) return <Chip person={person} />
  return (
    <span className="role-chip">
      <Chip person={person} describedBy={id} />
      <span id={id} role="tooltip" className="role-tip">
        {ROLE_NAMES[person.role ?? 'member']}
      </span>
    </span>
  )
}
