import { GameCanvas } from './ui/GameCanvas'
import { HudOverlay } from './ui/hud/HudOverlay'
import { CarSelect } from './ui/screens/CarSelect'
import { HelpScreen } from './ui/screens/HelpScreen'
import { LoadingScreen } from './ui/screens/LoadingScreen'
import { PauseMenu } from './ui/screens/PauseMenu'
import { ResultScreen } from './ui/screens/ResultScreen'
import { TitleScreen } from './ui/screens/TitleScreen'
import { TouchControls } from './ui/touch/TouchControls'
import { useTouchMode } from './ui/touch/useTouchMode'
import { useGameStore } from './store'

export default function App() {
  useTouchMode()
  const screen = useGameStore((s) => s.screen)
  const touchActive = useGameStore((s) => s.touchActive)
  const inGame = screen === 'playing' || screen === 'paused' || screen === 'result'

  return (
    <>
      <GameCanvas />
      {inGame && <HudOverlay />}
      {screen === 'playing' && touchActive && <TouchControls />}
      <div className="ui">
        {screen === 'loading' && <LoadingScreen />}
        {screen === 'title' && <TitleScreen />}
        {screen === 'help' && <HelpScreen />}
        {screen === 'select' && <CarSelect />}
        {screen === 'paused' && <PauseMenu />}
        {screen === 'result' && <ResultScreen />}
      </div>
    </>
  )
}
