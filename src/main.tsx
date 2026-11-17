import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createHashRouter, RouterProvider } from 'react-router'
import './index.css'
import { routes } from './routes'

// Hash routing: GitHub Pages only ever serves index.html, so deep links such as
// /film-club/#/films/12 keep working on refresh.
const router = createHashRouter(routes)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
