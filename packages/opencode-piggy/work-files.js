// @ts-check
/** 插件私有队列目录与官方发现文件的异步权限操作。 */
import { execFile } from 'node:child_process'
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

/** 异步准备当前用户的私有队列目录。 @param {string} directory @returns {Promise<void>} */
export async function secureWorkDirectoryAsync(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('work directory must be a real directory')
  verifyPosixOwner(stat)
  if (process.platform !== 'win32') await chmod(directory, 0o700)
  else await runPowerShellAsync(DIRECTORY_SCRIPT, directory)
}

/** 异步发现读取也必须验证文件自身的权限，不能仅依赖目录 ACL。 @param {string} path @returns {Promise<void>} */
export async function verifyPrivateWorkFileAsync(path) {
  verifyFileStat(await lstat(path))
  if (process.platform === 'win32') await runPowerShellAsync(FILE_SCRIPT, path)
}
