// @ts-check
/** 独立桥与游戏接收端的私有文件、权限及原子写，不依赖 Electron。 */
import { execFile, execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdir, lstat, chmod } from 'node:fs/promises'

// 2026-10-12：只持久化 Access，不写 Owner/Audit；Set-Acl 会在重复调用时要求审计权限。
const DIRECTORY_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User',
  '$sidType = [System.Security.Principal.SecurityIdentifier]',
  '$sections = [System.Security.AccessControl.AccessControlSections]',
  '$directory = [System.IO.DirectoryInfo]::new($env:PIGGY_WORK_PATH)',
  '$directory.Refresh()',
  'if (-not $directory.Exists -or ($directory.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { throw "work directory must be a real directory" }',
  'if (-not $directory.GetAccessControl($sections::Owner).GetOwner($sidType).Equals($sid)) { throw "work directory owner mismatch" }',
  '$acl = $directory.GetAccessControl($sections::Access)',
  '$acl.SetAccessRuleProtection($true, $false)',
  'foreach ($oldRule in $acl.GetAccessRules($true, $false, $sidType)) { $acl.RemoveAccessRuleSpecific($oldRule) }',
  '$acl.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new($sid, "FullControl", "ContainerInherit,ObjectInherit", "None", "Allow"))',
  '$directory.SetAccessControl($acl)',
  '$check = $directory.GetAccessControl($sections::Access)',
  '$rules = @($check.GetAccessRules($true, $true, $sidType))',
  'if (-not $check.AreAccessRulesProtected -or $rules.Count -ne 1) { throw "work directory DACL verification failed" }',
  '$rule = $rules[0]',
  'if (-not $rule.IdentityReference.Equals($sid) -or $rule.IsInherited -or [int]$rule.AccessControlType -ne 0 -or [int]$rule.FileSystemRights -ne 0x1f01ff -or [int]$rule.InheritanceFlags -ne 3 -or [int]$rule.PropagationFlags -ne 0) { throw "work directory DACL verification failed" }',
  'if (-not $directory.GetAccessControl($sections::Owner).GetOwner($sidType).Equals($sid)) { throw "work directory owner mismatch" }',
].join('; ')

const FILE_SCRIPT = [
  '$ErrorActionPreference = "Stop"',
  '$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User',
  '$sidType = [System.Security.Principal.SecurityIdentifier]',
  '$sections = [System.Security.AccessControl.AccessControlSections]',
  '$file = [System.IO.FileInfo]::new($env:PIGGY_WORK_PATH)',
  '$file.Refresh()',
  'if (-not $file.Exists -or ($file.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { throw "work file must be a real file" }',
  'if (-not $file.GetAccessControl($sections::Owner).GetOwner($sidType).Equals($sid)) { throw "work file owner mismatch" }',
  '$rules = @($file.GetAccessControl($sections::Access).GetAccessRules($true, $true, $sidType))',
  'if ($rules.Count -eq 0) { throw "work file DACL invalid" }',
  'foreach ($rule in $rules) { if (-not $rule.IdentityReference.Equals($sid) -or [int]$rule.AccessControlType -ne 0) { throw "work file is not private" } }',
].join('; ')

function powershellOptions(path) {
  return { env: { ...process.env, PIGGY_WORK_PATH: path }, windowsHide: true }
}

function verifyPosixOwner(stat) {
  if (process.platform !== 'win32' && stat.uid !== process.getuid()) throw new Error('work path owner mismatch')
}

async function runPowerShellAsync(script, path) {
  await new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
      powershellOptions(path), error => error ? reject(error) : resolve(undefined))
  })
}

function verifyFileStat(stat) {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('work file must be a real file')
  verifyPosixOwner(stat)
  if (process.platform !== 'win32' && (stat.mode & 0o077) !== 0) throw new Error('work file is not private')
}

function verifyDiscovery(directory) {
  try { verifyPrivateWorkFile(join(directory, 'bridge.json')) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

/** @param {string} directory @returns {void} */
export function secureWorkDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('work directory must be a real directory')
  }
  verifyPosixOwner(stat)
  if (process.platform !== 'win32') chmodSync(directory, 0o700)
  else execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DIRECTORY_SCRIPT], { ...powershellOptions(directory), stdio: 'pipe' })
  verifyDiscovery(directory)
}

/** 插件不能阻塞事件循环；与宿主使用同一份 DACL-only 脚本，不提权。 @param {string} directory @returns {Promise<void>} */
export async function secureWorkDirectoryAsync(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('work directory must be a real directory')
  verifyPosixOwner(stat)
  if (process.platform !== 'win32') await chmod(directory, 0o700)
  else await runPowerShellAsync(DIRECTORY_SCRIPT, directory)
  try { await verifyPrivateWorkFileAsync(join(directory, 'bridge.json')) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
}

/** 已有子文件的显式授权不会随父 DACL 消失；只验证，不接管或覆盖不安全文件。 @param {string} path @returns {void} */
export function verifyPrivateWorkFile(path) {
  const stat = lstatSync(path)
  verifyFileStat(stat)
  if (process.platform !== 'win32') return
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', FILE_SCRIPT], { ...powershellOptions(path), stdio: 'pipe' })
}

/** 异步发现读取也必须验证文件自身的权限，不能仅依赖目录 ACL。 @param {string} path @returns {Promise<void>} */
export async function verifyPrivateWorkFileAsync(path) {
  verifyFileStat(await lstat(path))
  if (process.platform === 'win32') await runPowerShellAsync(FILE_SCRIPT, path)
}

/** @param {string} path @returns {any|null} */
export function readWorkJson(path) {
  try {
    verifyPrivateWorkFile(path)
    const value = JSON.parse(readFileSync(path, 'utf8'))
    // 2026-10-12：损坏的 JSON null 不能冒充 ENOENT，否则 receipt 会被当成空账本。
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('work JSON must contain an object; evidence preserved')
    return value
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/** 目录同步在 POSIX 保证 rename/unlink 的目录项落盘；Windows 不支持目录 fsync。 */
function syncDirectory(directory) {
  if (process.platform === 'win32') return
  const descriptor = openSync(directory, 'r')
  try { fsyncSync(descriptor) } finally { closeSync(descriptor) }
}

/** @param {string} path @param {unknown} value @returns {void} */
export function writeWorkJson(path, value) {
  const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`
  const descriptor = openSync(temporary, 'wx', 0o600)
  try {
    writeFileSync(descriptor, JSON.stringify(value))
    fsyncSync(descriptor)
  } finally { closeSync(descriptor) }
  try {
    renameSync(temporary, path)
    syncDirectory(dirname(path))
  } catch (error) {
    // 只清理本次创建的临时文件，不动上一份可恢复数据。
    try { unlinkSync(temporary) } catch (cleanupError) {
      if (cleanupError?.code !== 'ENOENT') throw new AggregateError([error, cleanupError], 'work atomic write failed')
    }
    throw error
  }
}

/** @param {string} path @returns {void} */
export function removeWorkFile(path) {
  try { unlinkSync(path) } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  syncDirectory(dirname(path))
}
