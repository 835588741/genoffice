import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const shellDir = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(shellDir, 'native', 'auth-session.swift')
const output = join(shellDir, 'native', 'auth-session')
const masEntitlements = join(shellDir, 'build', 'entitlements.mas.inherit.plist')

if (process.platform !== 'darwin') process.exit(0)
if (!existsSync(source)) throw new Error(`Authentication helper source not found: ${source}`)

mkdirSync(dirname(output), { recursive: true })
const architectures = (process.env.AIOFFICE_AUTH_SESSION_ARCHS || 'arm64,x86_64')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const slices = architectures.map((arch) => `${output}.${arch}`)
try {
  for (let index = 0; index < architectures.length; index++) {
    execFileSync(
      'swiftc',
      [
        '-O',
        '-target',
        `${architectures[index]}-apple-macos12`,
        '-framework',
        'AuthenticationServices',
        '-framework',
        'AppKit',
        source,
        '-o',
        slices[index],
      ],
      { stdio: 'inherit' },
    )
  }
  if (slices.length === 1) {
    rmSync(output, { force: true })
    renameSync(slices[0], output)
  } else execFileSync('lipo', ['-create', ...slices, '-output', output], { stdio: 'inherit' })

  // electron-builder does not code-sign arbitrary executables copied through
  // extraResources. A MAS app cannot spawn an unsigned child from its sandbox,
  // so sign the helper before the parent app is assembled. The identity is
  // supplied by the same CSC_NAME used by electron-builder.
  if (process.env.AIOFFICE_BUILD_MAS === '1') {
    const identity = process.env.AIOFFICE_AUTH_SESSION_SIGN_IDENTITY || process.env.CSC_NAME
    if (!identity) {
      throw new Error(
        'AIOFFICE_AUTH_SESSION_SIGN_IDENTITY or CSC_NAME is required for MAS authentication helper signing',
      )
    }
    execFileSync(
      'codesign',
      ['--force', '--sign', identity, '--entitlements', masEntitlements, '--timestamp=none', output],
      { stdio: 'inherit' },
    )
  }
} finally {
  for (const slice of slices) rmSync(slice, { force: true })
}
chmodSync(output, 0o755)
