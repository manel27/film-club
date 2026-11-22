import type { RouteObject } from 'react-router'
import RequireAuth from './auth/RequireAuth'
import AppShell from './components/AppShell'
import AdminPage from './pages/AdminPage'
import FilmFormPage from './pages/FilmFormPage'
import FilmPage from './pages/FilmPage'
import FilmsPage from './pages/FilmsPage'
import InvitePage from './pages/InvitePage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import PeoplePage from './pages/PeoplePage'
import ProfilePage from './pages/ProfilePage'
import ResetPage from './pages/ResetPage'
import RotationPage from './pages/RotationPage'

// Everything except the login, invite and reset pages needs a session (RequireAuth).
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  { path: '/invite/:token', element: <InvitePage /> },
  { path: '/reset/:token', element: <ResetPage /> },
  {
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { path: '/', element: <FilmsPage /> },
      { path: '/films/new', element: <FilmFormPage /> },
      { path: '/films/:id', element: <FilmPage /> },
      { path: '/films/:id/edit', element: <FilmFormPage /> },
      { path: '/rotation', element: <RotationPage /> },
      { path: '/people', element: <PeoplePage /> },
      { path: '/people/:id', element: <ProfilePage /> },
      { path: '/admin', element: <AdminPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]
