import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { useAuth } from '../auth/authContext'
import { safeNextPath } from '../auth/redirect'
import LoadingPage from './LoadingPage'

export default function LoginPage() {
  const { status, signIn } = useAuth()
  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'loading' && !submitting) return <LoadingPage />
  if (status !== 'signedOut' && status !== 'loading') {
    return <Navigate to={safeNextPath(searchParams.get('next'))} replace />
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    const message = await signIn(email, password)
    setSubmitting(false)
    if (message) {
      setError(message)
      setPassword('')
    }
  }

  return (
    <main className="page page-narrow">
      <h1>Film Club</h1>
      <form className="card form" onSubmit={onSubmit}>
        <h2>Log in</h2>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </button>
      </form>
      <p className="muted">Invite-only. Ask Manel for an invite.</p>
    </main>
  )
}
