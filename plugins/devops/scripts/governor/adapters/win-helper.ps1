# dotclaude governor - Windows OS helper (benign, reversible scheduling controls).
# One long-lived Windows PowerShell process per watcher, JSON lines over
# stdin/stdout: {"id":1,"op":"apply","key":"k","level":1,"pids":[{"pid":123,"startMs":...}]}.
# The watcher names a KEY per throttled job; the helper keeps
#   $throttles[key] = @{ pid -> @{ startMs; suspended; capped } }
# and reverts BY KEY. apply() merges pid lists; release(key) resumes+uncaps all
# pids under that key. Reads foreign processes only through the normal process
# list and counters (no handles into foreign processes - anti-cheat safe);
# writes only to pids the watcher names. When stdin closes (watcher gone) it
# resumes everything it suspended and lifts every cap, then exits.
# A pid is only ever acted on when its start time still matches (never a null
# identity). All numbers are formatted InvariantCulture (German OS uses ',').
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
$inv = [Globalization.CultureInfo]::InvariantCulture

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Gov {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool IsProcessInJob(IntPtr proc, IntPtr job, out bool result);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool DuplicateHandle(IntPtr srcProc, IntPtr src, IntPtr dstProc, out IntPtr dst, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job, int cls, ref CpuRate info, int len);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetPriorityClass(IntPtr h, uint cls);
  [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
  [DllImport("ntdll.dll")] public static extern int NtSetInformationProcess(IntPtr h, int cls, ref int info, int len);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr mon, ref MONITORINFO mi);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO li);
  [StructLayout(LayoutKind.Sequential)] public struct CpuRate { public uint ControlFlags; public uint CpuRateValue; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  // JSON string escape in C# (fast, culture-independent).
  public static string J(string s) {
    if (s == null) return "null";
    var sb = new StringBuilder(s.Length + 2); sb.Append('"');
    foreach (char c in s) {
      if (c == '"') sb.Append("\\\"");
      else if (c == '\\') sb.Append("\\\\");
      else if (c < 32) sb.Append("\\u").Append(((int)c).ToString("x4"));
      else sb.Append(c);
    }
    sb.Append('"'); return sb.ToString();
  }
}
"@

$PROC_ACCESS = 0x0001 -bor 0x0040 -bor 0x0100 -bor 0x0200 -bor 0x0800 -bor 0x1000
$script:jobs = @{}        # key -> cap job handle
$script:throttles = @{}   # key -> @{ pid(int) -> @{ startMs; suspended; capped } }
$script:tick = 0
$script:listening = @()
$totalMB = [math]::Round((Get-CimInstance Win32_ComputerSystem -Property TotalPhysicalMemory).TotalPhysicalMemory / 1MB)

function N($x) { return ([double]$x).ToString($inv) }
function Esc([string]$s) { return [Gov]::J($s) }

function StartMs($pid_) {
  try { return ([DateTimeOffset][Diagnostics.Process]::GetProcessById([int]$pid_).StartTime).ToUnixTimeMilliseconds() } catch { return $null }
}
# Never act on a null identity: a pid with no startMs, or whose start no longer matches, is skipped.
function Same($p) {
  if ($null -eq $p.startMs) { return $false }
  $s = StartMs $p.pid
  return ($null -ne $s) -and ([math]::Abs($s - [double]$p.startMs) -lt 2000)
}
function OpenProc($pid_) { [Gov]::OpenProcess($PROC_ACCESS, $false, [int]$pid_) }

function Op-Sample($req) {
  $script:tick++
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $wantGpu = ($null -eq $req.gpu) -or [bool]$req.gpu
  $gpuByPid = @{}; $gpuSys = 0
  if ($wantGpu) {
    try {
      $byType = @{}
      foreach ($e in (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Property Name,UtilizationPercentage)) {
        if ($e.Name -match '^pid_(\d+)_.*_engtype_(.+)$') {
          $u = [double]$e.UtilizationPercentage; $pp = [int]$Matches[1]; $tp = $Matches[2]
          if (-not $gpuByPid.ContainsKey($pp) -or $gpuByPid[$pp] -lt $u) { $gpuByPid[$pp] = $u }
          $byType[$tp] = [double]$byType[$tp] + $u
        }
      }
      foreach ($v in $byType.Values) { if ($v -gt $gpuSys) { $gpuSys = $v } }
    } catch {}
  }
  # The full Win32_Process scan is the expensive part (WMI walks every process): the watcher asks for it
  # only every procScanMs and reuses the last list in between; system counters are read on every call.
  $wantProcs = ($null -eq $req.procs) -or [bool]$req.procs
  $sb = New-Object Text.StringBuilder 65536
  [void]$sb.Append('{"ts":').Append((N $now)).Append(',"cores":').Append($env:NUMBER_OF_PROCESSORS)
  if ($wantProcs) {
  [void]$sb.Append(',"procs":[')
  $first = $true
  foreach ($p in (Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate,KernelModeTime,UserModeTime,WorkingSetSize,ReadTransferCount,WriteTransferCount,ReadOperationCount,WriteOperationCount)) {
    $cmd = $p.CommandLine; if ($cmd -and $cmd.Length -gt 400) { $cmd = $cmd.Substring(0, 400) }
    $start = 0; if ($p.CreationDate) { $start = ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() }
    $cpuMs = ([double]$p.KernelModeTime + [double]$p.UserModeTime) / 10000
    $io = [double]$p.ReadTransferCount + [double]$p.WriteTransferCount
    $ops = [double]$p.ReadOperationCount + [double]$p.WriteOperationCount
    $g = 0; if ($gpuByPid.ContainsKey([int]$p.ProcessId)) { $g = $gpuByPid[[int]$p.ProcessId] }
    if (-not $first) { [void]$sb.Append(',') }; $first = $false
    [void]$sb.Append('{"pid":').Append($p.ProcessId).Append(',"ppid":').Append($p.ParentProcessId).Append(',"name":').Append((Esc $p.Name)).Append(',"path":').Append((Esc $p.ExecutablePath)).Append(',"cmd":').Append((Esc $cmd)).Append(',"startMs":').Append((N $start)).Append(',"cpuMs":').Append((N ([math]::Round($cpuMs)))).Append(',"ioBytes":').Append((N $io)).Append(',"ioOps":').Append((N $ops)).Append(',"memMB":').Append((N ([math]::Round([double]$p.WorkingSetSize / 1MB)))).Append(',"gpuPct":').Append((N ([math]::Round($g, 1)))).Append('}')
  }
  [void]$sb.Append(']')
  } else { [void]$sb.Append(',"procs":null') }
  $cpu = 0; try { $cpu = [double](Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'" -Property PercentProcessorUtility).PercentProcessorUtility } catch {}
  # Per physical disk: idle-time counter (active time = what Task Manager shows); _Total: latency for the log.
  $dAll = @(); try { $dAll = @(Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk -Property Name,PercentIdleTime,Timestamp_Sys100NS,AvgDisksecPerTransfer,AvgDisksecPerTransfer_Base,Frequency_PerfTime,CurrentDiskQueueLength) } catch {}
  $d = $dAll | Where-Object { $_.Name -eq '_Total' } | Select-Object -First 1
  $m = $null; try { $m = Get-CimInstance Win32_PerfRawData_PerfOS_Memory -Property AvailableMBytes,PagesInputPersec } catch {}
  [void]$sb.Append(',"sys":{"cpuPct":').Append((N ([math]::Min(100, [math]::Round($cpu, 1))))).Append(',"gpuPct":').Append((N ([math]::Min(100, [math]::Round($gpuSys, 1)))))
  if ($d) { [void]$sb.Append(',"disk":{"num":').Append((N $d.AvgDisksecPerTransfer)).Append(',"base":').Append((N $d.AvgDisksecPerTransfer_Base)).Append(',"freq":').Append((N $d.Frequency_PerfTime)).Append('},"diskQueue":').Append((N $d.CurrentDiskQueueLength)) }
  [void]$sb.Append(',"disks":[')
  $firstDisk = $true
  foreach ($x in $dAll) {
    if ($x.Name -eq '_Total') { continue }
    if (-not $firstDisk) { [void]$sb.Append(',') }; $firstDisk = $false
    [void]$sb.Append('{"name":').Append((Esc $x.Name)).Append(',"idle":').Append((N $x.PercentIdleTime)).Append(',"ts":').Append((N $x.Timestamp_Sys100NS)).Append('}')
  }
  [void]$sb.Append(']')
  if ($m) { [void]$sb.Append(',"freeMB":').Append((N $m.AvailableMBytes)).Append(',"pagesIn":').Append((N $m.PagesInputPersec)) }
  [void]$sb.Append(',"totalMB":').Append((N $totalMB)).Append('}')
  try {
    $h = [Gov]::GetForegroundWindow(); $fp = [uint32]0; [void][Gov]::GetWindowThreadProcessId($h, [ref]$fp)
    $r = New-Object Gov+RECT; [void][Gov]::GetWindowRect($h, [ref]$r)
    $mi = New-Object Gov+MONITORINFO; $mi.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($mi)
    [void][Gov]::GetMonitorInfo([Gov]::MonitorFromWindow($h, 2), [ref]$mi)
    $full = ($r.Left -le $mi.rcMonitor.Left -and $r.Top -le $mi.rcMonitor.Top -and $r.Right -ge $mi.rcMonitor.Right -and $r.Bottom -ge $mi.rcMonitor.Bottom)
    $li = New-Object Gov+LASTINPUTINFO; $li.cbSize = 8; [void][Gov]::GetLastInputInfo([ref]$li)
    $idle = ([Environment]::TickCount -band 0x7FFFFFFF) - ($li.dwTime -band 0x7FFFFFFF); if ($idle -lt 0) { $idle += 2147483648 }
    [void]$sb.Append(',"fg":{"pid":').Append($fp).Append(',"fullscreen":').Append($full.ToString().ToLower()).Append(',"idleMs":').Append((N $idle)).Append('}')
  } catch { [void]$sb.Append(',"fg":null') }
  if (($script:tick % 5) -eq 1) { try { $script:listening = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) } catch { $script:listening = @() } }
  [void]$sb.Append(',"listening":[').Append(($script:listening -join ',')).Append(']}')
  return $sb.ToString()
}

function CapJob($key) {
  if ($script:jobs.ContainsKey($key)) { return $script:jobs[$key] }
  $j = [Gov]::CreateJobObject([IntPtr]::Zero, ("Local\dotclaude-gov-cap-" + $key))
  if ($j -eq [IntPtr]::Zero) { throw "CreateJobObject failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $script:jobs[$key] = $j; return $j
}
function SetRate($job, [uint32]$flags, [uint32]$rate) {
  $c = New-Object Gov+CpuRate; $c.ControlFlags = $flags; $c.CpuRateValue = $rate
  return [Gov]::SetInformationJobObject($job, 15, [ref]$c, 8)
}

function Op-Apply($a) {
  $key = [string]$a.key
  if (-not $script:throttles.ContainsKey($key)) { $script:throttles[$key] = @{} }
  $entry = $script:throttles[$key]
  $job = CapJob $key
  $rate = [uint32][math]::Max(100, [math]::Min(10000, [int]([double]$a.cpuPct * 100)))
  [void](SetRate $job 5 $rate)   # ENABLE | HARD_CAP
  $pause = ([int]$a.level -ge 2)
  $n = 0
  foreach ($p in $a.pids) {
    if (-not (Same $p)) { continue }
    $id = [int]$p.pid
    if (-not $entry.ContainsKey($id)) { $entry[$id] = @{ startMs = [double]$p.startMs; suspended = $false; capped = $false } }
    $h = OpenProc $id
    if ($h -eq [IntPtr]::Zero) { continue }
    try {
      $in = $false; [void][Gov]::IsProcessInJob($h, $job, [ref]$in)
      if (-not $in) { [void][Gov]::AssignProcessToJobObject($job, $h) }
      if (-not $entry[$id].capped) {
        [void][Gov]::SetPriorityClass($h, 0x4000)       # BELOW_NORMAL
        $io = 0; [void][Gov]::NtSetInformationProcess($h, 33, [ref]$io, 4)  # IO priority very low
        $dup = [IntPtr]::Zero; [void][Gov]::DuplicateHandle([Gov]::GetCurrentProcess(), $job, $h, [ref]$dup, 0, $false, 2)
        $entry[$id].capped = $true
      }
      if ($pause -and -not $entry[$id].suspended) { if ([Gov]::NtSuspendProcess($h) -eq 0) { $entry[$id].suspended = $true } }
      elseif (-not $pause -and $entry[$id].suspended) { if ([Gov]::NtResumeProcess($h) -eq 0) { $entry[$id].suspended = $false } }
      $n++
    } finally { [void][Gov]::CloseHandle($h) }
  }
  return ('{"applied":' + $n + '}')
}

function RevertPid($id, $info) {
  if (-not (Same @{ pid = $id; startMs = $info.startMs })) { return }   # gone or pid reused: never touch it
  $h = OpenProc $id
  if ($h -eq [IntPtr]::Zero) { return }
  try {
    if ($info.suspended) { [void][Gov]::NtResumeProcess($h) }
    [void][Gov]::SetPriorityClass($h, 0x20)            # NORMAL
    $io = 2; [void][Gov]::NtSetInformationProcess($h, 33, [ref]$io, 4)  # IO normal
  } finally { [void][Gov]::CloseHandle($h) }
}

function Op-Release($a) {
  $key = [string]$a.key
  $entry = $null
  if ($script:throttles.ContainsKey($key)) { $entry = $script:throttles[$key] }
  # Reconstruct identities from the caller's pid list too (orphan reversal after a crash: helper has no state).
  foreach ($p in $a.pids) {
    $id = [int]$p.pid
    if ($entry -and $entry.ContainsKey($id)) { continue }
    if ($null -eq $entry) { $entry = @{} }
    $entry[$id] = @{ startMs = [double]$p.startMs; suspended = $true; capped = $true }
  }
  if ($entry) { foreach ($id in @($entry.Keys)) { RevertPid $id $entry[$id] } }
  # Always lift the CPU cap through the job's NAME - after a crash this helper never held the handle.
  # The name survives the old helper because each capped process holds a duplicated handle (Op-Apply).
  $j = [Gov]::OpenJobObject(0x1F001F, $false, ("Local\dotclaude-gov-cap-" + $key))
  if ($j -ne [IntPtr]::Zero) { [void](SetRate $j 0 0); [void][Gov]::CloseHandle($j) }
  if ($script:jobs.ContainsKey($key)) { [void][Gov]::CloseHandle($script:jobs[$key]); $script:jobs.Remove($key) }
  $script:throttles.Remove($key)
  return '{"released":true}'
}

function Op-Notify($a) {
  try {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $tn = $xml.GetElementsByTagName('text')
    [void]$tn.Item(0).AppendChild($xml.CreateTextNode([string]$a.title))
    [void]$tn.Item(1).AppendChild($xml.CreateTextNode([string]$a.text))
    $app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
    return '{"shown":true}'
  } catch { return '{"shown":false}' }
}

function Cleanup {
  foreach ($key in @($script:throttles.Keys)) {
    $entry = $script:throttles[$key]
    foreach ($id in @($entry.Keys)) { RevertPid $id $entry[$id] }
    if ($script:jobs.ContainsKey($key)) { [void](SetRate $script:jobs[$key] 0 0); [void][Gov]::CloseHandle($script:jobs[$key]) }
  }
  $script:throttles = @{}; $script:jobs = @{}
}

[Console]::Out.WriteLine('{"id":0,"ok":true,"data":{"ready":true,"pid":' + $PID + '}}'); [Console]::Out.Flush()
try {
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if (-not $line.Trim()) { continue }
    $id = 0
    try {
      $req = $line | ConvertFrom-Json
      $id = [int]$req.id
      $data = switch ($req.op) {
        'sample'  { Op-Sample $req }
        'apply'   { Op-Apply $req }
        'release' { Op-Release $req }
        'notify'  { Op-Notify $req }
        'ping'    { '{"pong":true}' }
        'exit'    { Cleanup; '{"bye":true}' }
        default   { throw "unknown op $($req.op)" }
      }
      [Console]::Out.WriteLine('{"id":' + $id + ',"ok":true,"data":' + $data + '}')
      [Console]::Out.Flush()
      if ($req.op -eq 'exit') { break }
    } catch {
      [Console]::Out.WriteLine('{"id":' + $id + ',"ok":false,"error":' + (Esc $_.Exception.Message) + '}')
      [Console]::Out.Flush()
    }
  }
} finally { Cleanup }
