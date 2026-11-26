import { useEffect } from 'react'
import { engine } from '../game/engine'
import { activeStreak, challengeById, dateKey, secondsToReset } from '../game/progress/daily'
import { useGameStore } from '../store'

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** Today's three challenges, the streak and the time until they change. */
export function DailyPanel() {
  const save = useGameStore((s) => s.save)

  // the page may have been open since yesterday
  useEffect(() => {
    engine.refreshDaily()
  }, [])

  const today = dateKey()
  const secs = secondsToReset()
  const reset = `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`
  const d = save.daily?.date === today ? save.daily : undefined
  if (!d) return null
  const streak = activeStreak(save, today)
  const allDone = d.done.every(Boolean)

  return (
    <div className="daily">
      <div className="daily-head">
        <b>Daily challenges</b>
        <span>
          {allDone ? 'All done' : `Resets in ${reset}`}
          {streak > 0 && <em> &middot; {streak} day streak (+{Math.min(streak, 5) * 10}% rewards)</em>}
        </span>
      </div>
      {d.ids.map((id, i) => {
        const c = challengeById(id)
        if (!c) return null
        const frac = Math.min(1, d.progress[i] / c.goal)
        return (
          <div key={id} className={d.done[i] ? 'daily-row done' : 'daily-row'}>
            <div className="daily-text">
              <span>{c.text}</span>
              <b>{d.done[i] ? 'Done' : `${fmtNum(d.progress[i])} / ${c.goal}  ·  $${c.reward.toLocaleString()}`}</b>
            </div>
            <div className="bar">
              <i style={{ width: `${Math.round(frac * 100)}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
