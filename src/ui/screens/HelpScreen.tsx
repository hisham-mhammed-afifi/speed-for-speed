import { useGameStore } from '../../store'

const KEYS: [string, string, string, string][] = [
  ['W / Up', 'Throttle', 'S / Down', 'Brake, then reverse'],
  ['A D / Left Right', 'Steer', 'Space', 'Handbrake (drift)'],
  ['Shift', 'Nitro', 'C', 'Camera: north / heading up'],
  ['R', 'Reset car onto the road', 'H', 'Start a pursuit'],
  ['Esc / P', 'Pause and options', 'F3', 'Physics debug overlay'],
]

export function HelpScreen() {
  const setScreen = useGameStore((s) => s.setScreen)
  return (
    <div className="screen">
      <div className="panel wide">
        <h2>How to play</h2>
        <p>
          Cruise the city. Speed past a patrol car, ram a cop, or press <b>H</b> to start a pursuit. Survive, wreck cops for bounty, then break line of
          sight and stay hidden to escape. Stay slow near cops and you get busted.
        </p>
        <table className="keys">
          <tbody>
            {KEYS.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, i) => (
                  <td key={i}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="tips">
          <li>Heat rises the longer you run and the more cops you wreck: roadblocks at 3, spike strips at 4, a helicopter at 5.</li>
          <li>Brake before corners. Grass slows you down, and heavy hits damage your car.</li>
          <li>
            Phone: drag your left thumb to steer; right thumb has GAS, BRAKE (hold to reverse), DRIFT and NITRO. The top-left buttons pause and reset your
            car.
          </li>
          <li>Gamepad: left stick steer, triggers throttle/brake, A handbrake, X nitro.</li>
        </ul>
        <button className="primary" onClick={() => setScreen('title')}>
          Back
        </button>
      </div>
    </div>
  )
}
