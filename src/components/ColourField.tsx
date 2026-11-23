import type { Person } from '../films/films'
import { colourClashes } from '../lib/colour'

export const HEX = /^#[0-9a-f]{6}$/i

/**
 * A person's colour: a picker and the same value as a hex code, with a
 * warning naming anyone whose colour is too close (decision A3: warn only,
 * saving is still allowed). `value` is '' until one is chosen.
 */
export default function ColourField({
  id,
  value,
  onChange,
  people,
  exceptId,
}: {
  id: string
  value: string
  onChange: (colour: string) => void
  people: Person[]
  /** The person being edited: never a clash with themselves. */
  exceptId?: string
}) {
  const colour = HEX.test(value) ? value.toLowerCase() : null
  const clashes = colour ? colourClashes(colour, people, exceptId) : []
  return (
    <div className="field">
      <label htmlFor={id}>Colour</label>
      <span className="colour-choice">
        {/* A colour input always shows some colour: black until one is picked. */}
        <input
          id={id}
          type="color"
          value={colour ?? '#000000'}
          onChange={(e) => onChange(e.target.value)}
          aria-describedby={`${id}-clash`}
        />
        <label className="colour-hex">
          Hex code
          <input
            value={value}
            onChange={(e) => onChange(e.target.value.trim())}
            placeholder="#4a86e8"
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
          />
        </label>
        {!value && <span className="muted">Not chosen yet</span>}
      </span>
      <div id={`${id}-clash`} role="status">
        {clashes.length > 0 && (
          <div className="clash-warning">
            <p>
              Hard to tell apart from{' '}
              {clashes.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && (i === clashes.length - 1 ? ' and ' : ', ')}
                  <span className="clash-pair" aria-hidden="true">
                    <span className="colour-dot" style={{ backgroundColor: colour! }} />
                    <span className="colour-dot" style={{ backgroundColor: p.colour! }} />
                  </span>
                  {p.name}'s colour ({p.colour})
                </span>
              ))}
              . You can still save it.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
