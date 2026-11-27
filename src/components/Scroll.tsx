import type { ReactNode } from 'react'

/** A table that scrolls sideways on its own on a narrow screen, keyboard-reachable. */
export default function Scroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="table-scroll" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  )
}
