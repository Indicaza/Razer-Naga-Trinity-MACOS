import { useEffect, useState } from 'react'
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

let initializationPromise: Promise<void> | null = null

const initializeOnce = (init: () => Promise<void>) => {
  if (!initializationPromise) {
    initializationPromise = init()
  }
  return initializationPromise
}

function App() {
  const init = useNagaStore((state) => state.init)
  const section = useNagaStore((state) => state.section)
  const [isReady, setIsReady] = useState(false)
  const [initializationError, setInitializationError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    void initializeOnce(init)
      .then(() => {
        if (!mounted) return
        setInitializationError(null)
        setIsReady(true)
      })
      .catch((error: unknown) => {
        if (!mounted) return
        const message = error instanceof Error ? error.message : 'Unknown initialization error'
        setInitializationError(message)
      })

    return () => {
      mounted = false
    }
  }, [init])

  if (!isReady) {
    return (
      <main className="boot-shell">
        <div className="boot-card" role="status" aria-live="polite">
          <div className="boot-mark" aria-hidden />
          <strong>Naga Trinity Control</strong>
          {initializationError ? (
            <>
              <span>Could not initialize the app.</span>
              <small>{initializationError}</small>
              <button type="button" onClick={() => window.location.reload()}>
                Retry
              </button>
            </>
          ) : (
            <span>Connecting to your mouse…</span>
          )}
        </div>
      </main>
    )
  }

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
