import { engine } from '../../game/engine'
import { nextUnlock } from '../../game/progress/economy'
import { useGameStore } from '../../store'
import { DailyPanel } from '../DailyPanel'
import { WantedBar } from '../WantedBar'

const TITLES = { escaped: 'ESCAPED', busted: 'BUSTED', wrecked: 'WRECKED' } as const

const money = (n: number) => '$' + Math.floor(n).toLocaleString()

export function ResultScreen() {
  const result = useGameStore((s) => s.result)
  const save = useGameStore((s) => s.save)
  if (!result) return null
  const { kind, stats } = result
  const mins = Math.floor(stats.time / 60)
  const secs = Math.floor(stats.time % 60)
    .toString()
    .padStart(2, '0')
  const escaped = kind === 'escaped'
  const next = nextUnlock(save)

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
          {(stats.bestMult ?? 1) > 1 && (
            <div>
              <span>Best combo</span>
              <b>x{stats.bestMult}</b>
            </div>
          )}
          <div>
            <span>{escaped ? 'Banked' : 'Bounty lost'}</span>
            <b className={escaped ? 'good' : 'bad'}>
              {escaped ? '+' : ''}
              {money(stats.bounty)}
            </b>
          </div>
          <div>
            <span>Wallet</span>
            <b>{money(save.cash)}</b>
          </div>
          <div>
            <span>Best bounty</span>
            <b>{money(stats.best)}</b>
          </div>
        </div>
        {!escaped && <div className="sub">Only an escape banks the bounty. Get away next time.</div>}
        {next && (
          <div className="sub">
            {save.cash >= next.price ? `You can afford the ${next.name}: ${money(next.price)}` : `${money(next.price - save.cash)} to unlock the ${next.name}`}
          </div>
        )}
        {stats.skillAfter !== undefined && <WantedBar rating={stats.skillAfter} before={stats.skillBefore} />}
        <DailyPanel />
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
          <button onClick={() => engine.toCarSelect()}>Garage</button>
        </div>
      </div>
    </div>
  )
}
