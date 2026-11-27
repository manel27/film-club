import { useRouteError } from 'react-router'

/**
 * A page that failed to render, inside the header so the nav stays. Most often
 * a lazy chunk that is gone after a deploy (an old tab): a reload fetches the
 * new build.
 */
export default function RouteErrorPage() {
  console.error(useRouteError()) // for debugging; the visitor gets the friendly text
  return (
    <main className="page">
      <h1>Something went wrong</h1>
      <p role="alert">Couldn't load this page. The site may have been updated.</p>
      <p className="actions">
        <button type="button" className="button" onClick={() => location.reload()}>
          Reload
        </button>
      </p>
    </main>
  )
}
