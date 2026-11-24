import { Link, NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/authContext'
import { exportDate, exportOverdue, useLastExport } from '../admin/lastExport'
import { useLogOut } from '../auth/useLogOut'
import ThemePicker from './ThemePicker'

const ROLE_LABELS: Partial<Record<string, string>> = {
  admin: 'Admin',
  moderator: 'Moderator',
}

/** Header (club name, theme, who's logged in, log out) around the page content. */
export default function AppShell() {
  const { profile } = useAuth()
  const { logOut, busy } = useLogOut()
  const roleLabel = profile ? ROLE_LABELS[profile.role] : undefined

  return (
    <div className="shell">
      <header className="shell-header">
        <Link to="/" className="brand">
          Film Club
        </Link>
        <nav className="main-nav" aria-label="Main">
          <NavLink to="/" end>
            Films
          </NavLink>
          <NavLink to="/rotation">Rotation</NavLink>
          <NavLink to="/people">People</NavLink>
          {profile?.role === 'admin' && <NavLink to="/admin">Admin</NavLink>}
          <NavLink to="/about">About</NavLink>
        </nav>
        <div className="header-tools">
          <ThemePicker />
          {profile && (
            <div className="whoami" aria-label="Logged in as">
              <span
                className="colour-dot"
                style={profile.colour ? { backgroundColor: profile.colour } : undefined}
                aria-hidden="true"
              />
              <Link to={`/people/${profile.id}`} className="whoami-name">
                {profile.display_name}
              </Link>
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
      {profile?.role === 'admin' && <ExportReminder />}
      <Outlet />
    </div>
  )
}

/** Admins only: a nudge to export the data when the last export is 30+ days old, or never. */
function ExportReminder() {
  const last = useLastExport()
  if (!last || !exportOverdue(last.at)) return null
  return (
    <p role="status" className="export-reminder">
      No data export in the last 30 days (last: {last.at ? exportDate(last.at) : 'never'}).{' '}
      <Link to="/admin">Export it from the Admin page</Link>
    </p>
  )
}
