import { engine } from '../../game/engine'
import { useGameStore } from '../../store'

const TITLES = { escaped: 'ESCAPED', busted: 'BUSTED', wrecked: 'WRECKED' } as const

const money = (n: number) => '$' + Math.floor(n).toLocaleString()

export function ResultScreen() {
  const result = useGameStore((s) => s.result)
  if (!result) return null
  const { kind, stats } = result
  const mins = Math.floor(stats.time / 60)
  const secs = Math.floor(stats.time % 60)
    .toString()
    .padStart(2, '0')
  const escaped = kind === 'escaped'

  return (
    <div className="screen dim">
      <div className="panel">
        <h2 className={`res-title ${kind}`}>{TITLES[kind]}</h2>
        <div className="res-stats">
          <div>
            <span>Pursuit time</span>
            <b>
              {mins}:{secs}
            </b>
          </div>
          <div>
            <span>Heat level reached</span>
            <b>{stats.level}</b>
          </div>
          <div>
            <span>Cops wrecked</span>
            <b>{stats.copsDown}</b>
          </div>
          <div>
            <span>Bounty</span>
            <b>
              {escaped ? '+' : 'lost '}
              {money(stats.bounty)}
            </b>
          </div>
          <div>
            <span>Best bounty</span>
            <b>{money(stats.best)}</b>
          </div>
        </div>
        <div className="menu row">
          {escaped ? (
            <button className="primary" onClick={() => engine.continueAfterEscape()}>
              Keep driving
            </button>
          ) : (
            <button className="primary" onClick={() => engine.restart()}>
              Try again
            </button>
          )}
          <button onClick={() => engine.toCarSelect()}>Change car</button>
        </div>
      </div>
    </div>
  )
}
