import { Link, Outlet } from 'react-router'
import { useAuth } from '../auth/authContext'
import { useLogOut } from '../auth/useLogOut'
import { isTheme, THEMES } from '../theme'

const ROLE_LABELS: Partial<Record<string, string>> = {
  admin: 'Admin',
  moderator: 'Moderator',
}

/** Header (club name, theme, who's logged in, log out) around the page content. */
export default function AppShell() {
  const { profile, theme, setTheme } = useAuth()
  const { logOut, busy } = useLogOut()
  const roleLabel = profile ? ROLE_LABELS[profile.role] : undefined

  return (
    <div className="shell">
      <header className="shell-header">
        <Link to="/" className="brand">
          Film Club
        </Link>
        <div className="header-tools">
          <label className="theme-picker">
            <span>Theme</span>
            <select
              value={theme}
              onChange={(e) => {
                if (isTheme(e.target.value)) setTheme(e.target.value)
              }}
            >
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
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
                disabled={busy}
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </header>
      <Outlet />
    </div>
  )
}
