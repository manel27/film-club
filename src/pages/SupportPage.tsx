import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/authContext'
import { RoleChip } from '../components/Chip'
import { tipsOff } from '../components/tipsOff'
import { dayLabel } from '../invites/links'
import { fetchSuggestions, supportWrites, type SuggestionSummary } from '../support/api'
import { useNotice } from '../components/useNotice'
import {
  checkText,
  isStaff,
  savedLength,
  supportError,
  TEXT_MAX,
  TITLE_MAX,
} from '../support/support'
import type { Person } from '../films/films'

/** Support (#/support, US9-US11): the suggestion box. */
export default function SupportPage() {
  const { profile } = useAuth()
  const staff = isStaff(profile)
  const [data, setData] = useState<{ suggestions: SuggestionSummary[]; people: Person[] }>()
  const [failed, setFailed] = useState(false)
  // "Deleted …" after a delete, then "Sent …" after sending.
  const [notice, statusRef] = useNotice<HTMLParagraphElement>()
  const [status, setStatus] = useState(notice ?? '')
  const latest = useRef(0)

  // Only the newest load may land: a slow earlier one never overwrites it.
  const load = useCallback(() => {
    const n = ++latest.current
    return fetchSuggestions().then(
      (d) => {
        if (n !== latest.current) return
        setData(d)
        setFailed(false)
      },
      () => n === latest.current && setFailed(true),
    )
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const sent = (title: string) => {
    setStatus(`Sent "${title}".`)
    statusRef.current?.focus()
    void load()
  }

  const byId = new Map(data?.people.map((p) => [p.id, p]))
  return (
    <main className="page support-page" ref={tipsOff}>
      <h1>Support</h1>
      <p>
        Ideas for the club or the site? Only you, the moderators and the admin can see what you
        write here.
      </p>
      <p ref={statusRef} role="status" tabIndex={-1} className={status ? 'form-notice' : 'sr-only'}>
        {status}
      </p>
      <NewSuggestion onSent={sent} onInvalid={() => setStatus('')} />

      <h2>{staff ? 'All suggestions' : 'Your suggestions'}</h2>
      {/* Only the first load can fail the list; a failed reload keeps what is shown. */}
      {!data && failed ? (
        <>
          <p role="alert" className="form-error">
            Couldn't load the suggestions. Check your connection.
          </p>
          <button
            type="button"
            className="button"
            onClick={() => {
              setFailed(false)
              void load()
            }}
          >
            Try again
          </button>
        </>
      ) : !data ? (
        <p role="status" className="muted">
          Loading suggestions…
        </p>
      ) : data.suggestions.length === 0 ? (
        <p className="muted">
          {staff ? 'No suggestions yet.' : "You haven't written any suggestions yet."}
        </p>
      ) : (
        <ul className="comments">
          {data.suggestions.map((s) => (
            <li key={s.id} className="comment">
              <Link to={`/support/${s.id}`} className="suggestion-title">
                {s.title}
              </Link>
              <p className="comment-meta">
                {staff && (
                  <>
                    <RoleChip person={byId.get(s.author_id)} />{' '}
                  </>
                )}
                <span className="muted">
                  {dayLabel(s.created_at)} · {s.replies} {s.replies === 1 ? 'reply' : 'replies'}
                </span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

/** The title and text form. Double submits are ignored while one is being sent. */
function NewSuggestion({
  onSent,
  onInvalid,
}: {
  onSent: (title: string) => void
  /** A stale "Sent …" must not sit next to a new error. */
  onInvalid: () => void
}) {
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState<{ field: 'title' | 'text' | 'form'; message: string }>()
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busyRef.current) return
    const t = checkText(title, TITLE_MAX, 'Give your suggestion a title.')
    if ('error' in t) {
      onInvalid()
      setError({ field: 'title', message: t.error })
      document.getElementById('suggestion-title')?.focus()
      return
    }
    const b = checkText(text, TEXT_MAX, 'Write your suggestion.', true)
    if ('error' in b) {
      onInvalid()
      setError({ field: 'text', message: b.error })
      document.getElementById('suggestion-text')?.focus()
      return
    }
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    try {
      await supportWrites.addSuggestion(t.value, b.value)
      setTitle('')
      setText('')
      onSent(t.value)
    } catch (err) {
      setError({ field: 'form', message: supportError(err) })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const fieldError = (field: 'title' | 'text') =>
    error?.field === field ? `suggestion-${field}-error` : undefined
  return (
    <form className="comment-form" onSubmit={submit} noValidate aria-labelledby="new-heading">
      <h2 id="new-heading">Write a suggestion</h2>
      <label htmlFor="suggestion-title">Title</label>
      {/* No maxLength: it counts UTF-16 units and cuts a paste before it is normalised. */}
      <input
        id="suggestion-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-invalid={error?.field === 'title'}
        aria-describedby={`suggestion-title-count ${fieldError('title') ?? ''}`.trim()}
      />
      <span id="suggestion-title-count" className="muted">
        {savedLength(title)}/{TITLE_MAX}
      </span>
      <FieldError id={fieldError('title')} message={error?.message} />
      <label htmlFor="suggestion-text">Your suggestion</label>
      <textarea
        id="suggestion-text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        aria-invalid={error?.field === 'text'}
        aria-describedby={`suggestion-text-count ${fieldError('text') ?? ''}`.trim()}
      />
      <span id="suggestion-text-count" className="muted">
        {savedLength(text, true)}/{TEXT_MAX}
      </span>
      <FieldError id={fieldError('text')} message={error?.message} />
      {error?.field === 'form' && <FieldError id="suggestion-error" message={error.message} />}
      <button type="submit" className="button button-small" disabled={busy}>
        {busy ? 'Sending…' : 'Send'}
      </button>
    </form>
  )
}

function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!id || !message) return null
  return (
    <p id={id} role="alert" className="form-error">
      {message}
    </p>
  )
}
