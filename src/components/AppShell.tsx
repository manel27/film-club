import { useState } from 'react'
import { Link, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../auth/authContext'

const ROLE_LABELS: Partial<Record<string, string>> = {
  admin: 'Admin',
  moderator: 'Moderator',
}

/** Header (club name, who's logged in, log out) around the page content. */
export default function AppShell() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [loggingOut, setLoggingOut] = useState(false)
  const roleLabel = profile ? ROLE_LABELS[profile.role] : undefined

  async function logOut() {
    setLoggingOut(true)
    try {
      await signOut()
    } finally {
      setLoggingOut(false)
    }
    navigate('/login', { replace: true })
  }

  return (
    <div className="shell">
      <header className="shell-header">
        <Link to="/" className="brand">
          Film Club
        </Link>
        {profile && (
          <div className="whoami" aria-label="Logged in as">
            <span
              className="colour-dot"
              style={profile.colour ? { backgroundColor: profile.colour } : undefined}
              aria-hidden="true"
            />
            <span className="whoami-name">{profile.display_name}</span>
            {roleLabel && <span className="badge">{roleLabel}</span>}
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={logOut}
              disabled={loggingOut}
            >
              Log out
            </button>
          </div>
        )}
      </header>
      <Outlet />
    </div>
  )
}
