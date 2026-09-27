import { creatorStatus, creatorTaskStatus } from './status'
export function StatusBadge({ status, official = false, task = false }: { status: string; official?: boolean; task?: boolean }) {
  const label = task ? creatorTaskStatus(status) : creatorStatus(status, official)
  return <span className="creator-status" data-status={label}>{label}</span>
}
