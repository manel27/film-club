import { lazy, Suspense } from 'react'
import type { RouteObject } from 'react-router'
import RequireAuth from './auth/RequireAuth'
import AppShell from './components/AppShell'
import AboutPage from './pages/AboutPage'
import AdminPage from './pages/AdminPage'
import FilmFormPage from './pages/FilmFormPage'
import FilmPage from './pages/FilmPage'
import FilmsPage from './pages/FilmsPage'
import LoadingPage from './pages/LoadingPage'
import InvitePage from './pages/InvitePage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import PeoplePage from './pages/PeoplePage'
import ProfilePage from './pages/ProfilePage'
import ResetPage from './pages/ResetPage'
import RouteErrorPage from './pages/RouteErrorPage'
import RotationPage from './pages/RotationPage'
import SuggestionPage from './pages/SuggestionPage'
import SupportPage from './pages/SupportPage'

// Its own chunk: only the Stats page loads the chart library. (A route table,
// not a component module: fast refresh doesn't matter here.)
// eslint-disable-next-line react-refresh/only-export-components
const StatsPage = lazy(() => import('./pages/StatsPage'))

// Everything except the login, invite and reset pages needs a session (RequireAuth).
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/invite/:token?', element: <InvitePage /> },
  { path: '/reset/:token?', element: <ResetPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      {
        // A page that fails to render (e.g. a chunk gone after a deploy) shows
        // RouteErrorPage inside the header, not React Router's raw error.
        errorElement: <RouteErrorPage />,
        children: [
          { path: '/', element: <FilmsPage /> },
          { path: '/films/new', element: <FilmFormPage /> },
          { path: '/films/:id', element: <FilmPage /> },
          { path: '/films/:id/edit', element: <FilmFormPage /> },
          { path: '/rotation', element: <RotationPage /> },
          { path: '/people', element: <PeoplePage /> },
          { path: '/people/:id', element: <ProfilePage /> },
          {
            path: '/stats',
            element: (
              <Suspense fallback={<LoadingPage />}>
                <StatsPage />
              </Suspense>
            ),
          },
          { path: '/support', element: <SupportPage /> },
          { path: '/support/:id', element: <SuggestionPage /> },
          { path: '/admin', element: <AdminPage /> },
          { path: '/about', element: <AboutPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]
