import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

let helper: ChildProcess | null = null

const helperPath = () => {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      'app.asar.unpacked',
      'dist-electron',
      'autoscroll-helper',
    )
  }
  return join(__dirname, 'autoscroll-helper')
}

export const startBrowserAutoscroll = () => {
  if (process.platform !== 'darwin' || helper) return

  const executable = helperPath()
  if (!existsSync(executable)) {
    console.log('[naga] browser autoscroll helper not found:', executable)
    return
  }

  const child = spawn(executable, [], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout?.on('data', (chunk) => {
    const message = chunk.toString().trim()
    if (message) console.log('[naga] autoscroll:', message)
  })

  child.stderr?.on('data', (chunk) => {
    const message = chunk.toString().trim()
    if (message) console.log('[naga] autoscroll:', message)
  })

  child.on('exit', (code, signal) => {
    if (helper === child) helper = null
    console.log('[naga] browser autoscroll helper exited:', { code, signal })
  })

  child.on('error', (error) => {
    if (helper === child) helper = null
    console.log('[naga] browser autoscroll helper failed:', error.message)
  })

  helper = child
}

export const stopBrowserAutoscroll = () => {
  const child = helper
  helper = null
  if (!child || child.killed) return
  child.kill('SIGTERM')
}
