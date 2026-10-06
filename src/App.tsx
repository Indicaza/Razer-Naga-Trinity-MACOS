import { useEffect } from 'react'
import './App.css'
import './stability.css'
import { useNagaStore } from './store/useNagaStore'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { NoticeBar } from './components/NoticeBar'
import { LightingPanel } from './components/LightingPanel'
import { PerformancePanel } from './components/PerformancePanel'
import { ButtonsPanel } from './components/ButtonsPanel'
import { MacrosPanel } from './components/MacrosPanel'

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function App() {
  const init = useNagaStore((state) => state.init)
  const rescan = useNagaStore((state) => state.rescan)
  const section = useNagaStore((state) => state.section)

  useEffect(() => {
    let cancelled = false

    const initialize = async () => {
      await init()
      if (cancelled) return

      await wait(350)
      if (cancelled) return
      await rescan()

      if (useNagaStore.getState().device.connected) return

      await wait(750)
      if (cancelled) return
      await rescan()
    }

    void initialize()

    return () => {
      cancelled = true
    }
  }, [init, rescan])

  return (
    <main className="shell">
      <Sidebar />
      <section className="workspace">
        <Topbar />
        <NoticeBar />
        <div className="content">
          {section === 'lighting' && <LightingPanel />}
          {section === 'performance' && <PerformancePanel />}
          {section === 'buttons' && <ButtonsPanel />}
          {section === 'macros' && <MacrosPanel />}
        </div>
      </section>
    </main>
  )
}

export default App
