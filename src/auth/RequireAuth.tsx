import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import LoadingPage from '../pages/LoadingPage'
import ProfileErrorPage from '../pages/ProfileErrorPage'
import UnlinkedPage from '../pages/UnlinkedPage'
import { useAuth } from './authContext'
import { loginPathFor } from './redirect'

/**
 * Route guard: everything except the login page needs a session and a linked
 * profile. Logged-out visitors go to the login page and come back afterwards.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()

  switch (status) {
    case 'loading':
      return <LoadingPage />
    case 'signedOut':
      return <Navigate to={loginPathFor(location.pathname + location.search)} replace />
    case 'unlinked':
      return <UnlinkedPage />
    case 'error':
      return <ProfileErrorPage />
    case 'signedIn':
      return children
  }
}
