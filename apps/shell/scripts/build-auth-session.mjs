import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const shellDir = dirname(dirname(fileURLToPath(import.meta.url)))
const source = join(shellDir, 'native', 'auth-session.swift')
const bundle = join(shellDir, 'native', 'AiOffice.app')
const output = join(bundle, 'Contents', 'MacOS', 'auth-session')
const infoPlist = join(bundle, 'Contents', 'Info.plist')
const masEntitlements = join(shellDir, 'build', 'entitlements.mas.inherit.plist')

if (process.platform !== 'darwin') process.exit(0)
if (!existsSync(source)) throw new Error(`Authentication helper source not found: ${source}`)

rmSync(bundle, { recursive: true, force: true })
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

  // ASWebAuthenticationSession uses the host bundle's display name in its
  // system confirmation dialog. A bare Mach-O has no Info.plist, so macOS
  // displays "(null)". Keep the helper as a real app bundle and launch its
  // nested executable from the Electron main process.
  writeFileSync(
    infoPlist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>AiOffice</string>
  <key>CFBundleExecutable</key>
  <string>auth-session</string>
  <key>CFBundleIdentifier</key>
  <string>net.luanqing.aioffice.auth-session</string>
  <key>CFBundleName</key>
  <string>AiOffice</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
</dict>
</plist>
`,
    'utf8',
  )

  // electron-builder does not code-sign arbitrary executables copied through
  // extraResources. A MAS app cannot spawn unsigned nested code from its
  // sandbox, so sign both the executable and its containing app bundle before
  // the parent app is assembled. The identity is supplied by the same CSC_NAME
  // used by electron-builder.
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
    execFileSync(
      'codesign',
      ['--force', '--sign', identity, '--entitlements', masEntitlements, '--timestamp=none', bundle],
      { stdio: 'inherit' },
    )
  }
} finally {
  for (const slice of slices) rmSync(slice, { force: true })
}
chmodSync(output, 0o755)
