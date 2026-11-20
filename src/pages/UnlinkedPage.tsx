import { useAuth } from '../auth/authContext'
import { useLogOut } from '../auth/useLogOut'

/** Logged in, but the login isn't linked to a club profile (yet). */
export default function UnlinkedPage() {
  const { session } = useAuth()
  const { logOut, busy } = useLogOut()

  return (
    <main className="page">
      <h1>Your account isn't linked yet</h1>
      <p>
        You're logged in{session?.user.email ? ` as ${session.user.email}` : ''}, but this login
        isn't connected to a Film Club profile. Ask Manel to link it.
      </p>
      <p>
        <button type="button" className="button" onClick={logOut} disabled={busy}>
          Log out
        </button>
      </p>
    </main>
  )
}
