import { cpSync, existsSync, mkdirSync, readlinkSync, rmSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const shellDir = dirname(dirname(fileURLToPath(import.meta.url)))
const electronApp = join(shellDir, '..', '..', 'node_modules', 'electron', 'dist', 'Electron.app')
const iconPath = join(shellDir, 'build', 'icon.icns')
const devApp = join(tmpdir(), 'aioffice-electron', 'AiOffice.app')
const devInfo = join(devApp, 'Contents', 'Info.plist')
const devIcon = join(devApp, 'Contents', 'Resources', 'app-icon.icns')
const executable = join(devApp, 'Contents', 'MacOS', 'Electron')
const frameworkCurrent = join(
  devApp,
  'Contents',
  'Frameworks',
  'Electron Framework.framework',
  'Versions',
  'Current',
)

if (process.platform !== 'darwin') {
  const child = spawn(join(shellDir, 'node_modules', '.bin', 'electron'), ['.'], {
    cwd: shellDir,
    stdio: 'inherit',
  })
  child.on('exit', (code) => process.exit(code ?? 1))
} else {
  if (!existsSync(electronApp)) throw new Error(`Electron runtime not found: ${electronApp}`)

  const sourceStamp = statSync(join(electronApp, 'Contents', 'Info.plist')).mtimeMs
  const needsRefresh =
    !existsSync(executable) ||
    statSync(devInfo).mtimeMs < sourceStamp ||
    (() => {
      try {
        return readlinkSync(frameworkCurrent) !== 'A'
      } catch {
        return true
      }
    })()
  if (needsRefresh) {
    mkdirSync(dirname(devApp), { recursive: true })
    rmSync(devApp, { recursive: true, force: true })
    cpSync(electronApp, devApp, { recursive: true, verbatimSymlinks: true })
  }

  cpSync(iconPath, devIcon, { force: true })
  const plistBuddy = '/usr/libexec/PlistBuddy'
  for (const [key, value] of [
    ['CFBundleDisplayName', 'AiOffice'],
    ['CFBundleName', 'AiOffice'],
    ['CFBundleIdentifier', 'net.luanqing.aioffice.dev'],
    ['CFBundleIconFile', 'app-icon.icns'],
  ]) {
    const child = spawn(plistBuddy, ['-c', `Set :${key} ${value}`, devInfo], { stdio: 'inherit' })
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Unable to set ${key}`))))
    })
  }
  // Keep the source timestamp as the refresh sentinel after updating Info.plist.
  utimesSync(devInfo, new Date(), new Date(Math.max(Date.now(), sourceStamp)))

  // LaunchServices must open the bundle (rather than its nested executable),
  // otherwise macOS still registers the process as Electron in the Dock and
  // native About panel.
  const child = spawn('open', ['-W', '-n', devApp, '--args', shellDir], {
    cwd: shellDir,
    stdio: 'inherit',
  })
  child.on('exit', (code) => process.exit(code ?? 1))
}
