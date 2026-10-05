# dotclaude governor - Windows OS helper.
# One long-lived Windows PowerShell 5.1 process per watcher, JSON lines over
# stdin/stdout: {"id":1,"op":"sample"} -> {"id":1,"ok":true,"data":{...}}.
# Reads foreign processes only through the normal process list and counters
# (no injection, no handles into foreign processes - anti-cheat safe). Writes
# only to processes the watcher names (Claude-attributed jobs).
# When stdin closes (watcher exited or crashed) it resumes everything it
# suspended and lifts every cap it set, then exits.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class GovNative {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool IsProcessInJob(IntPtr proc, IntPtr job, out bool result);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool DuplicateHandle(IntPtr srcProc, IntPtr src, IntPtr dstProc, out IntPtr dst, uint access, bool inherit, uint options);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job, int cls, ref CpuRate info, int len);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool QueryInformationJobObject(IntPtr job, int cls, IntPtr info, int len, IntPtr ret);
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
  public static int[] JobPids(IntPtr job) {
    int cap = 4096; IntPtr buf = Marshal.AllocHGlobal(8 + IntPtr.Size * cap);
    try {
      if (!QueryInformationJobObject(job, 3, buf, 8 + IntPtr.Size * cap, IntPtr.Zero)) return new int[0];
      int n = Marshal.ReadInt32(buf, 4); int[] r = new int[n];
      for (int i = 0; i < n; i++) r[i] = (int)Marshal.ReadIntPtr(buf, 8 + i * IntPtr.Size).ToInt64();
      return r;
    } finally { Marshal.FreeHGlobal(buf); }
  }
}
"@

$PROC_ACCESS = 0x0001 -bor 0x0040 -bor 0x0100 -bor 0x0200 -bor 0x0800 -bor 0x1000  # terminate|dup_handle|set_quota|set_information|suspend_resume|query_limited
$JOB_ALL = 0x1F001F
$script:jobs = @{}        # name -> handle (session jobs and cap jobs)
$script:capped = @{}      # cap job name -> @(pid,...)
$script:suspended = @{}   # pid -> $true (suspended by this helper)
$script:signers = @{}     # path -> signer subject
$script:tick = 0
$script:listening = @()
$totalMB = [math]::Round((Get-CimInstance Win32_ComputerSystem -Property TotalPhysicalMemory).TotalPhysicalMemory / 1MB)

function Esc([string]$s) {
  if ($null -eq $s) { return 'null' }
  $sb = New-Object Text.StringBuilder ($s.Length + 2)
  [void]$sb.Append('"')
  foreach ($c in $s.ToCharArray()) {
    switch ($c) { '"' { [void]$sb.Append('\"') } '\' { [void]$sb.Append('\\') } default { if ([int]$c -lt 32) { [void]$sb.Append(('\u{0:x4}' -f [int]$c)) } else { [void]$sb.Append($c) } } }
  }
  [void]$sb.Append('"'); $sb.ToString()
}

function StartMs($pid_) {
  try { return ([DateTimeOffset][Diagnostics.Process]::GetProcessById([int]$pid_).StartTime).ToUnixTimeMilliseconds() } catch { return $null }
}

# A pid is acted on only when it is still the process the watcher means.
function Same($p) {
  if ($null -eq $p.startMs) { return $true }
  $s = StartMs $p.pid
  return ($null -ne $s) -and ([math]::Abs($s - [double]$p.startMs) -lt 2000)
}

function OpenProc($pid_) { [GovNative]::OpenProcess($PROC_ACCESS, $false, [int]$pid_) }

function Signer($path) {
  if (-not $path) { return $null }
  if ($script:signers.ContainsKey($path)) { return $script:signers[$path] }
  $s = $null
  try { $sig = Get-AuthenticodeSignature -FilePath $path; if ($sig.Status -eq 'Valid') { $s = $sig.SignerCertificate.Subject } } catch {}
  $script:signers[$path] = $s; return $s
}

function Op-Sample {
  $script:tick++
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $gpuByPid = @{}; $gpuByType = @{}
  try {
    foreach ($e in (Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -Property Name,UtilizationPercentage)) {
      if ($e.Name -match '^pid_(\d+)_.*_engtype_(.+)$') {
        $u = [double]$e.UtilizationPercentage; $p = [int]$Matches[1]; $t = $Matches[2]
        if (-not $gpuByPid.ContainsKey($p) -or $gpuByPid[$p] -lt $u) { $gpuByPid[$p] = $u }
        $gpuByType[$t] = [double]$gpuByType[$t] + $u
      }
    }
  } catch {}
  $gpuSys = 0; foreach ($v in $gpuByType.Values) { if ($v -gt $gpuSys) { $gpuSys = $v } }
  $sb = New-Object Text.StringBuilder 65536
  [void]$sb.Append('{"ts":').Append($now).Append(',"cores":').Append([Environment]::ProcessorCount).Append(',"procs":[')
  $first = $true
  foreach ($p in (Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate,KernelModeTime,UserModeTime,WorkingSetSize,ReadTransferCount,WriteTransferCount)) {
    $path = $p.ExecutablePath
    $cmd = $p.CommandLine; if ($cmd -and $cmd.Length -gt 400) { $cmd = $cmd.Substring(0, 400) }
    $start = 0; if ($p.CreationDate) { $start = ([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds() }
    $cpuMs = ([double]$p.KernelModeTime + [double]$p.UserModeTime) / 10000
    $io = [double]$p.ReadTransferCount + [double]$p.WriteTransferCount
    $g = 0; if ($gpuByPid.ContainsKey([int]$p.ProcessId)) { $g = $gpuByPid[[int]$p.ProcessId] }
    if (-not $first) { [void]$sb.Append(',') }; $first = $false
    [void]$sb.Append('{"pid":').Append($p.ProcessId).Append(',"ppid":').Append($p.ParentProcessId).Append(',"name":').Append((Esc $p.Name)).Append(',"path":').Append((Esc $path)).Append(',"cmd":').Append((Esc $cmd)).Append(',"startMs":').Append($start).Append(',"cpuMs":').Append([math]::Round($cpuMs)).Append(',"ioBytes":').Append($io).Append(',"memMB":').Append([math]::Round([double]$p.WorkingSetSize / 1MB)).Append(',"gpuPct":').Append([math]::Round($g, 1)).Append('}')
  }
  [void]$sb.Append(']')
  $cpu = 0; try { $cpu = [double](Get-CimInstance Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'" -Property PercentProcessorUtility).PercentProcessorUtility } catch {}
  $d = $null; try { $d = Get-CimInstance Win32_PerfRawData_PerfDisk_PhysicalDisk -Filter "Name='_Total'" -Property AvgDisksecPerTransfer,AvgDisksecPerTransfer_Base,Frequency_PerfTime,CurrentDiskQueueLength } catch {}
  $m = $null; try { $m = Get-CimInstance Win32_PerfRawData_PerfOS_Memory -Property AvailableMBytes,PagesInputPersec } catch {}
  [void]$sb.Append(',"sys":{"cpuPct":').Append([math]::Min(100, [math]::Round($cpu, 1))).Append(',"gpuPct":').Append([math]::Min(100, [math]::Round($gpuSys, 1)))
  if ($d) { [void]$sb.Append(',"disk":{"num":').Append([double]$d.AvgDisksecPerTransfer).Append(',"base":').Append([double]$d.AvgDisksecPerTransfer_Base).Append(',"freq":').Append([double]$d.Frequency_PerfTime).Append('},"diskQueue":').Append([double]$d.CurrentDiskQueueLength) }
  if ($m) { [void]$sb.Append(',"freeMB":').Append([double]$m.AvailableMBytes).Append(',"pagesIn":').Append([double]$m.PagesInputPersec) }
  [void]$sb.Append(',"totalMB":').Append($totalMB).Append('}')
  # foreground window: owner pid, fullscreen, user idle time
  try {
    $h = [GovNative]::GetForegroundWindow(); $fp = [uint32]0; [void][GovNative]::GetWindowThreadProcessId($h, [ref]$fp)
    $r = New-Object GovNative+RECT; [void][GovNative]::GetWindowRect($h, [ref]$r)
    $mi = New-Object GovNative+MONITORINFO; $mi.cbSize = [Runtime.InteropServices.Marshal]::SizeOf($mi)
    [void][GovNative]::GetMonitorInfo([GovNative]::MonitorFromWindow($h, 2), [ref]$mi)
    $full = ($r.Left -le $mi.rcMonitor.Left -and $r.Top -le $mi.rcMonitor.Top -and $r.Right -ge $mi.rcMonitor.Right -and $r.Bottom -ge $mi.rcMonitor.Bottom)
    $li = New-Object GovNative+LASTINPUTINFO; $li.cbSize = 8; [void][GovNative]::GetLastInputInfo([ref]$li)
    $idle = ([Environment]::TickCount -band 0xFFFFFFFF) - $li.dwTime; if ($idle -lt 0) { $idle += 4294967296 }
    [void]$sb.Append(',"fg":{"pid":').Append($fp).Append(',"fullscreen":').Append($full.ToString().ToLower()).Append(',"idleMs":').Append($idle).Append('}')
  } catch { [void]$sb.Append(',"fg":null') }
  if (($script:tick % 5) -eq 1) {
    try { $script:listening = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique) } catch { $script:listening = @() }
  }
  [void]$sb.Append(',"listening":[').Append(($script:listening -join ',')).Append(']')
  [void]$sb.Append(',"jobPids":{')
  $firstJ = $true
  foreach ($k in @($script:jobs.Keys)) {
    if (-not $k.StartsWith('Local\dotclaude-gov-s-')) { continue }
    if (-not $firstJ) { [void]$sb.Append(',') }; $firstJ = $false
    [void]$sb.Append((Esc $k)).Append(':[').Append(([GovNative]::JobPids($script:jobs[$k]) -join ',')).Append(']')
  }
  [void]$sb.Append('}}')
  return $sb.ToString()
}

function GetJob($name) {
  if ($script:jobs.ContainsKey($name)) { return $script:jobs[$name] }
  $j = [GovNative]::CreateJobObject([IntPtr]::Zero, $name)
  if ($j -eq [IntPtr]::Zero) { throw "CreateJobObject failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $script:jobs[$name] = $j; return $j
}

function Assign($job, $p) {
  $h = OpenProc $p.pid
  if ($h -eq [IntPtr]::Zero) { return $false }
  try {
    $in = $false; [void][GovNative]::IsProcessInJob($h, $job, [ref]$in)
    if (-not $in) { $in = [GovNative]::AssignProcessToJobObject($job, $h) }
    return $in
  } finally { [void][GovNative]::CloseHandle($h) }
}

# Session job: a named job with NO limits (never KILL_ON_JOB_CLOSE) - only for attribution.
function Op-Attach($a) {
  $job = GetJob ('Local\dotclaude-gov-s-' + $a.session)
  $n = 0; foreach ($p in $a.pids) { if ((Same $p) -and (Assign $job $p)) { $n++ } }
  return ('{"assigned":' + $n + '}')
}

function SetRate($job, [uint32]$flags, [uint32]$rate) {
  $c = New-Object GovNative+CpuRate; $c.ControlFlags = $flags; $c.CpuRateValue = $rate
  return [GovNative]::SetInformationJobObject($job, 15, [ref]$c, 8)
}

function Op-Cap($a) {
  $name = 'Local\dotclaude-gov-cap-' + $a.key
  $job = GetJob $name
  $rate = [uint32][math]::Max(100, [math]::Min(10000, [int]($a.cpuPct * 100)))
  if (-not (SetRate $job 5 $rate)) { throw "cpu rate failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  if (-not $script:capped.ContainsKey($name)) { $script:capped[$name] = @() }
  $n = 0
  foreach ($p in $a.pids) {
    if (-not (Same $p)) { continue }
    if (-not (Assign $job $p)) { continue }
    $h = OpenProc $p.pid
    if ($h -ne [IntPtr]::Zero) {
      [void][GovNative]::SetPriorityClass($h, 0x4000)   # BELOW_NORMAL
      $io = 0; [void][GovNative]::NtSetInformationProcess($h, 33, [ref]$io, 4)   # IO priority very low
      if ($script:capped[$name] -notcontains [int]$p.pid) {
        # Keep the job name alive inside the capped process itself, so a later
        # helper can still open it by name after a crash of this one.
        $dup = [IntPtr]::Zero; [void][GovNative]::DuplicateHandle([GovNative]::GetCurrentProcess(), $job, $h, [ref]$dup, 0, $false, 2)
        $script:capped[$name] += [int]$p.pid
      }
      [void][GovNative]::CloseHandle($h); $n++
    }
  }
  return ('{"capped":' + $n + '}')
}

function Uncap($name, $pids) {
  $job = [IntPtr]::Zero
  if ($script:jobs.ContainsKey($name)) { $job = $script:jobs[$name] } else { $job = [GovNative]::OpenJobObject(0x1F001F, $false, $name) }
  $ok = $false
  if ($job -ne [IntPtr]::Zero) { $ok = SetRate $job 0 0 }
  foreach ($p in $pids) {
    if (-not (Same $p)) { continue }
    $h = OpenProc $p.pid
    if ($h -ne [IntPtr]::Zero) {
      [void][GovNative]::SetPriorityClass($h, 0x20)   # NORMAL
      $io = 2; [void][GovNative]::NtSetInformationProcess($h, 33, [ref]$io, 4)
      [void][GovNative]::CloseHandle($h)
    }
  }
  if ($job -ne [IntPtr]::Zero) { [void][GovNative]::CloseHandle($job) }
  $script:jobs.Remove($name); $script:capped.Remove($name)
  return $ok
}

function Op-Uncap($a) { $ok = Uncap ('Local\dotclaude-gov-cap-' + $a.key) $a.pids; return ('{"uncapped":' + $ok.ToString().ToLower() + '}') }

function Op-Suspend($a) {
  $n = 0
  foreach ($p in $a.pids) {
    if ($script:suspended.ContainsKey([int]$p.pid) -or -not (Same $p)) { continue }
    $h = OpenProc $p.pid
    if ($h -ne [IntPtr]::Zero) { if ([GovNative]::NtSuspendProcess($h) -eq 0) { $script:suspended[[int]$p.pid] = $true; $n++ }; [void][GovNative]::CloseHandle($h) }
  }
  return ('{"suspended":' + $n + '}')
}

# force: resume even when this helper did not suspend it (orphan reversal after a crash).
function Op-Resume($a) {
  $n = 0
  foreach ($p in $a.pids) {
    $mine = $script:suspended.ContainsKey([int]$p.pid)
    if (-not $mine -and -not $a.force) { continue }
    if (-not (Same $p)) { $script:suspended.Remove([int]$p.pid); continue }
    $h = OpenProc $p.pid
    if ($h -ne [IntPtr]::Zero) { if ([GovNative]::NtResumeProcess($h) -eq 0) { $n++ }; [void][GovNative]::CloseHandle($h) }
    $script:suspended.Remove([int]$p.pid)
  }
  return ('{"resumed":' + $n + '}')
}

# Authenticode signer of the given exe paths (only asked for OS candidates with load; cached).
function Op-Sig($a) {
  $parts = @(); foreach ($p in $a.paths) { $parts += ((Esc $p) + ':' + (Esc (Signer $p))) }
  return ('{' + ($parts -join ',') + '}')
}

function Op-Notify($a) {
  try {
    [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
    $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $t = $xml.GetElementsByTagName('text')
    [void]$t.Item(0).AppendChild($xml.CreateTextNode([string]$a.title))
    [void]$t.Item(1).AppendChild($xml.CreateTextNode([string]$a.text))
    $app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))
    return '{"shown":true}'
  } catch { return '{"shown":false}' }
}

function Cleanup {
  foreach ($pid_ in @($script:suspended.Keys)) {
    $h = OpenProc $pid_
    if ($h -ne [IntPtr]::Zero) { [void][GovNative]::NtResumeProcess($h); [void][GovNative]::CloseHandle($h) }
  }
  $script:suspended = @{}
  foreach ($name in @($script:capped.Keys)) {
    $pids = @($script:capped[$name] | ForEach-Object { @{ pid = $_; startMs = $null } })
    [void](Uncap $name $pids)
  }
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
        'sample' { Op-Sample }
        'attach' { Op-Attach $req }
        'cap' { Op-Cap $req }
        'uncap' { Op-Uncap $req }
        'suspend' { Op-Suspend $req }
        'resume' { Op-Resume $req }
        'notify' { Op-Notify $req }
        'sig' { Op-Sig $req }
        'ping' { '{"pong":true}' }
        'exit' { Cleanup; '{"bye":true}' }
        default { throw "unknown op $($req.op)" }
      }
      [Console]::Out.WriteLine('{"id":' + $id + ',"ok":true,"data":' + $data + '}')
      if ($req.op -eq 'exit') { [Console]::Out.Flush(); break }
    } catch {
      [Console]::Out.WriteLine('{"id":' + $id + ',"ok":false,"error":' + (Esc $_.Exception.Message) + '}')
    }
    [Console]::Out.Flush()
  }
} finally {
  Cleanup
}
