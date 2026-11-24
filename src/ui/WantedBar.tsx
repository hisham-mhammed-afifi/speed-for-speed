import { ratingLabel } from '../game/ai/difficulty'

interface Props {
  rating: number
  /** rating before the run that just ended, to describe the change */
  before?: number
}

/** The player's wanted rating: how seriously the police take them. */
export function WantedBar({ rating, before }: Props) {
  const pct = Math.round(Math.max(0.04, Math.min(1, rating)) * 100)
  const delta = before === undefined ? 0 : rating - before
  const note =
    delta >= 0.015 ? 'Police are taking you more seriously' : delta <= -0.015 ? 'Police are easing off' : before === undefined ? '' : 'Police opinion unchanged'
  return (
    <div className="wanted">
      <div className="wanted-head">
        <span>Wanted rating</span>
        <b>{ratingLabel(rating)}</b>
      </div>
      <div className="bar wanted-bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Wanted rating">
        <i style={{ width: `${pct}%` }} />
      </div>
      {note && <div className="wanted-note">{note}</div>}
    </div>
  )
}
