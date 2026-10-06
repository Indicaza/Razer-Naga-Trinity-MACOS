import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

if (process.platform !== 'darwin') {
  process.exit(0)
}

const source = resolve('native/NagaScrollHelper.swift')
const output = resolve('dist-electron/naga-scroll-helper')
mkdirSync(dirname(output), { recursive: true })

const result = spawnSync('xcrun', ['swiftc', source, '-O', '-o', output], {
  stdio: 'inherit',
})

if (result.status !== 0 || !existsSync(output)) {
  console.error('[naga] failed to build macOS scroll helper; install Xcode Command Line Tools with xcode-select --install')
  process.exit(result.status ?? 1)
}

chmodSync(output, 0o755)
