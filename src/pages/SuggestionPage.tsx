import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../auth/authContext'
import { RoleChip } from '../components/Chip'
import { tipsOff } from '../components/tipsOff'
import type { Person } from '../films/films'
import { parseId } from '../lib/ids'
import { fetchSuggestion, supportWrites, type Suggestion } from '../support/api'
import { canDelete, checkText, dateTime, isStaff, supportError, TEXT_MAX } from '../support/support'

const BackLink = () => (
  <Link to="/support" className="back-link">
    ← Support
  </Link>
)

/** One suggestion and its thread (#/support/:id, US11-US12). Keyed by id: nothing carries over. */
export default function SuggestionPage() {
  const { id = '' } = useParams()
  return <SuggestionView key={id} id={id} />
}

function SuggestionView({ id }: { id: string }) {
  const suggestionId = parseId(id)
  const { profile } = useAuth()
  const navigate = useNavigate()
  // undefined = loading, null = not found (or not yours: the same message)
  const [data, setData] = useState<{ suggestion: Suggestion; people: Person[] } | null>()
  const [failed, setFailed] = useState(false)
  const [error, setError] = useState<{ at: 'reply' | 'delete'; message: string }>()
  const [status, setStatus] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const statusRef = useRef<HTMLParagraphElement>(null)
  const latest = useRef(0)

  // Only the newest load may land. A failed reload keeps what is shown.
  const load = useCallback(async () => {
    if (suggestionId === null) return
    const n = ++latest.current
    return fetchSuggestion(suggestionId).then(
      (d) => {
        if (n !== latest.current) return
        setData(d)
        setFailed(false)
      },
      () => n === latest.current && setFailed(true),
    )
  }, [suggestionId])
  useEffect(() => {
    void load()
  }, [load])

  /** Runs one write at a time; reloads afterwards (a reply may have arrived meanwhile). */
  const run = async (at: 'reply' | 'delete', write: () => Promise<void>) => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setError(undefined)
    setStatus('')
    try {
      await write()
      return true
    } catch (e) {
      setError({ at, message: supportError(e) })
      await load()
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  if (suggestionId === null || data === null) {
    return (
      <main className="page">
        <h1>Suggestion not found</h1>
        <p>It may have been deleted, or it isn't yours to see.</p>
        {error && (
          <p role="alert" className="form-error">
            {error.message}
          </p>
        )}
        <p>
          <BackLink />
        </p>
      </main>
    )
  }
  if (data === undefined) {
    return (
      <main className="page">
        {failed ? (
          <>
            <p role="alert" className="form-error">
              Couldn't load the suggestion. Check your connection.
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
        ) : (
          <p role="status" className="muted">
            Loading suggestion…
          </p>
        )}
      </main>
    )
  }

  const { suggestion: s, people } = data
  const byId = new Map(people.map((p) => [p.id, p]))
  const mayReply = isStaff(profile) || s.author_id === profile?.id

  const reply = async (e: FormEvent) => {
    e.preventDefault()
    const body = checkText(draft, TEXT_MAX, 'Write a reply.')
    if ('error' in body) {
      setError({ at: 'reply', message: body.error })
      document.getElementById('reply-text')?.focus()
      return
    }
    const ok = await run('reply', async () => {
      await supportWrites.addReply(s.id, body.value)
      await load()
    })
    if (ok) {
      setDraft('')
      setStatus('Reply sent.')
      statusRef.current?.focus()
    }
  }

  const remove = async () => {
    if (!confirm(`Delete "${s.title}"? Its replies go too.`)) return
    // Not reloaded on success: the page would flash "not found" before leaving.
    await run('delete', async () => {
      await supportWrites.deleteSuggestion(s.id)
      navigate('/support', { replace: true, state: { notice: `Deleted "${s.title}".` } })
    })
  }

  return (
    <main className="page support-page" ref={tipsOff}>
      <p>
        <BackLink />
      </p>
      <h1 className="suggestion-title">{s.title}</h1>
      <p className="comment-meta">
        <RoleChip person={byId.get(s.author_id)} />{' '}
        <span className="muted">{dateTime(s.created_at)}</span>
      </p>
      <p className="comment-body">{s.body}</p>
      {canDelete(profile, s) && (
        <div className="comment-actions">
          <button
            type="button"
            className="button button-danger button-small"
            disabled={busy}
            onClick={() => void remove()}
          >
            Delete suggestion
          </button>
        </div>
      )}
      {error?.at === 'delete' && (
        <p role="alert" className="form-error">
          {error.message}
        </p>
      )}

      <section className="film-section">
        <h2>Replies</h2>
        {s.suggestion_replies.length === 0 ? (
          <p className="muted">No replies yet.</p>
        ) : (
          <ul className="comments">
            {s.suggestion_replies.map((r) => (
              <li key={r.id} className="comment">
                <p className="comment-meta">
                  <RoleChip person={byId.get(r.author_id)} />{' '}
                  <span className="muted">{dateTime(r.created_at)}</span>
                </p>
                <p className="comment-body">{r.body}</p>
              </li>
            ))}
          </ul>
        )}
        <p
          ref={statusRef}
          role="status"
          tabIndex={-1}
          className={status ? 'form-notice' : 'sr-only'}
        >
          {status}
        </p>
        {mayReply && (
          <form onSubmit={reply} className="comment-form" noValidate>
            <label htmlFor="reply-text">Reply</label>
            <textarea
              id="reply-text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-invalid={error?.at === 'reply'}
              aria-describedby={error?.at === 'reply' ? 'reply-error' : undefined}
            />
            <button type="submit" className="button button-small" disabled={busy}>
              {busy ? 'Sending…' : 'Send reply'}
            </button>
            {error?.at === 'reply' && (
              <p id="reply-error" role="alert" className="form-error">
                {error.message}
              </p>
            )}
          </form>
        )}
      </section>
    </main>
  )
}
