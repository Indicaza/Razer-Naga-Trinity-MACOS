import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

let helper: ChildProcess | null = null

const helperPath = () => join(__dirname, 'naga-scroll-helper')

export const setMouseScrollReversed = (enabled: boolean) => {
  if (process.platform !== 'darwin') return

  if (!enabled) {
    helper?.kill('SIGTERM')
    helper = null
    return
  }

  if (helper && !helper.killed) return

  const executable = helperPath()
  if (!existsSync(executable)) {
    console.warn('[naga] scroll helper is missing:', executable)
    return
  }

  helper = spawn(executable, [], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })

  helper.stderr?.on('data', (chunk) => {
    const message = chunk.toString().trim()
    if (message) console.warn('[naga] scroll helper:', message)
  })

  helper.on('exit', (code, signal) => {
    console.log('[naga] scroll helper exited:', code, signal)
    helper = null
  })

  helper.on('error', (error) => {
    console.warn('[naga] scroll helper error:', error.message)
    helper = null
  })
}

export const stopMouseScrollHelper = () => {
  helper?.kill('SIGTERM')
  helper = null
}
