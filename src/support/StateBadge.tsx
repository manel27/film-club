/** "Open" or "Closed" for a suggestion. */
export default function StateBadge({ closedAt }: { closedAt: string | null }) {
  return closedAt ? (
    <span className="badge badge-muted">Closed</span>
  ) : (
    <span className="badge">Open</span>
  )
}
