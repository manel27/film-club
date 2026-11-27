import { useId } from 'react'
import { Link } from 'react-router'
import type { Person } from '../films/films'
import { textOn } from '../lib/colour'
import { ROLE_NAMES } from '../people/profile'

/**
 * A person's name on their own colour, with black or white text; links to their profile (not system profiles).
 * `peopleHref` (from useHref('/people')): a plain <a>, not a Link. Long lists pass it: every Link
 * re-renders on each URL change (a sort or filter), ~5 per film.
 */
export default function Chip({
  person,
  describedBy,
  tabIndex,
  peopleHref,
}: {
  person: Person | undefined
  describedBy?: string
  tabIndex?: number
  peopleHref?: string
}) {
  const style = person?.colour
    ? { backgroundColor: person.colour, color: textOn(person.colour) }
    : undefined
  if (person && !person.isSystem) {
    const props = {
      className: 'chip',
      style,
      'aria-describedby': describedBy,
      tabIndex,
      children: person.name,
    }
    return peopleHref ? (
      <a href={`${peopleHref}/${person.id}`} {...props} />
    ) : (
      <Link to={`/people/${person.id}`} {...props} />
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
 * reads it even while hidden. Touch: the first tap shows the tip, a second opens the profile
 * (tipsOff does both). System profiles, unknown people and a missing or unknown role get no
 * tip. Put it inside an element with ref={tipsOff}.
 * `tabbable={false}`: a mouse shortcut with no Tab stop (long film lists keep one stop
 * per film); screen readers still read it, with its role, in browse mode.
 */
export function RoleChip({
  person,
  tabbable = true,
  peopleHref,
}: {
  person: Person | undefined
  tabbable?: boolean
  peopleHref?: string
}) {
  const id = useId()
  // The role comes from the database: anything but a known role gets no tip, not "Member".
  const role = person?.role && Object.hasOwn(ROLE_NAMES, person.role) ? ROLE_NAMES[person.role] : ''
  const tabIndex = tabbable ? undefined : -1
  if (!person || person.isSystem || !role)
    return <Chip person={person} tabIndex={tabIndex} peopleHref={peopleHref} />
  return (
    <span className="role-chip">
      <Chip person={person} describedBy={id} tabIndex={tabIndex} peopleHref={peopleHref} />
      <span id={id} role="tooltip" className="role-tip">
        {role}
      </span>
    </span>
  )
}
