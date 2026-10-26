// Windows-only supervisor. The kernel enforces the commit limit before test code runs.
// Child processes inherit the job; no BREAKAWAY flags are enabled.
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace AionUi {
    public sealed class GuardResult {
        public string Reason { get; set; } = "unsafe_launch";
        public int ExitCode { get; set; } = 125;
        public uint? TestExitCode { get; set; }
        public uint ProcessId { get; set; }
        public int MemoryLimitMiB { get; set; }
        public int MemoryStopThresholdMiB { get; set; }
        public int TimeoutSeconds { get; set; }
        public bool LongRunningSuite { get; set; }
        public long ElapsedMilliseconds { get; set; }
        public ulong PeakJobMemoryBytes { get; set; }
        public long OutputBytes { get; set; }
        public long OutputLimitBytes { get; set; } = 4 * 1024 * 1024;
        public uint? ActiveProcessesAfterCleanup { get; set; }
        public bool DescendantsTerminated { get; set; }
        public bool ProtectedBeforeStart { get; set; }
        public string OutputTail { get; set; } = "";
        public string Error { get; set; } = "";
    }

    public static class TestProcessGuard {
        const uint JOB_MEMORY = 0x200, KILL_ON_CLOSE = 0x2000, ACTIVE_PROCESS = 0x8;
        const uint CREATE_SUSPENDED = 4, CREATE_UNICODE_ENVIRONMENT = 0x400, CREATE_NO_WINDOW = 0x08000000;
        const uint STARTF_USESTDHANDLES = 0x100, WAIT_TIMEOUT = 258, INFINITE = 0xffffffff;
        const ulong MiB = 1024UL * 1024UL;

        [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
            public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
            public uint LimitFlags;
            public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
            public uint ActiveProcessLimit;
            public UIntPtr Affinity;
            public uint PriorityClass, SchedulingClass;
        }
        [StructLayout(LayoutKind.Sequential)] struct IoCounters {
            public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
        }
        [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit {
            public BasicLimit BasicLimitInformation;
            public IoCounters IoInfo;
            public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
        }
        [StructLayout(LayoutKind.Sequential)] struct CompletionPort { public IntPtr CompletionKey, Port; }
        [StructLayout(LayoutKind.Sequential)] struct NotificationLimit {
            public ulong IoReadBytesLimit, IoWriteBytesLimit;
            public long PerJobUserTimeLimit;
            public ulong JobMemoryLimit;
            public uint RateControlTolerance, RateControlToleranceInterval, LimitFlags;
        }
        [StructLayout(LayoutKind.Sequential)] struct Accounting {
            public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
            public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
        }
        [StructLayout(LayoutKind.Sequential)] struct SecurityAttributes {
            public int Length; public IntPtr SecurityDescriptor;
            [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle;
        }
        [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct StartupInfo {
            public uint cb; public string lpReserved, lpDesktop, lpTitle;
            public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
            public ushort wShowWindow, cbReserved2;
            public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
        }
        [StructLayout(LayoutKind.Sequential)] struct ProcessInformation {
            public IntPtr Process, Thread; public uint ProcessId, ThreadId;
        }
        [StructLayout(LayoutKind.Sequential)] struct MemoryStatus {
            public uint Length, MemoryLoad;
            public ulong TotalPhys, AvailPhys, TotalPageFile, AvailPageFile, TotalVirtual, AvailVirtual, AvailExtendedVirtual;
        }

        [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attrs, string name);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint size);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint size, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
        [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr CreateIoCompletionPort(IntPtr file, IntPtr existing, UIntPtr key, uint threads);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool GetQueuedCompletionStatus(IntPtr port, out uint message, out UIntPtr key, out IntPtr overlapped, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] [return:MarshalAs(UnmanagedType.Bool)]
        static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttrs, IntPtr threadAttrs, bool inheritHandles, uint flags, IntPtr environment, string cwd, ref StartupInfo startup, out ProcessInformation process);
        [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
        [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool TerminateProcess(IntPtr process, uint code);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SecurityAttributes attributes, uint size);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
        [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern IntPtr CreateFileW(string name, uint access, uint share, ref SecurityAttributes attrs, uint disposition, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.Bool)] static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);

        static void Check(bool ok, string operation) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), operation); }
        static void Close(ref IntPtr handle) { if (handle != IntPtr.Zero && handle != new IntPtr(-1)) { CloseHandle(handle); handle = IntPtr.Zero; } }
        static void Set<T>(IntPtr job, int cls, T value) where T:struct {
            int size=Marshal.SizeOf<T>(); IntPtr ptr=Marshal.AllocHGlobal(size);
            try { Marshal.StructureToPtr(value,ptr,false); Check(SetInformationJobObject(job,cls,ptr,(uint)size),"SetInformationJobObject("+cls+")"); }
            finally { Marshal.FreeHGlobal(ptr); }
        }
        static T Query<T>(IntPtr job, int cls) where T:struct {
            int size=Marshal.SizeOf<T>(); IntPtr ptr=Marshal.AllocHGlobal(size);
            try { Check(QueryInformationJobObject(job,cls,ptr,(uint)size,IntPtr.Zero),"QueryInformationJobObject("+cls+")"); return Marshal.PtrToStructure<T>(ptr); }
            finally { Marshal.FreeHGlobal(ptr); }
        }
        static MemoryStatus Memory() { var m=new MemoryStatus { Length=(uint)Marshal.SizeOf<MemoryStatus>() }; Check(GlobalMemoryStatusEx(ref m),"GlobalMemoryStatusEx"); return m; }

        // Quote one argv element using the documented CommandLineToArgvW/CRT convention.
        static string Quote(string value) {
            var b=new StringBuilder("\""); int slashes=0;
            foreach(char c in value) {
                if(c=='\\') { slashes++; continue; }
                if(c=='\"') { b.Append('\\',slashes*2+1); b.Append(c); slashes=0; continue; }
                b.Append('\\',slashes); slashes=0; b.Append(c);
            }
            b.Append('\\',slashes*2); return b.Append('"').ToString();
        }
        static IntPtr EnvironmentBlock(string testPath) {
            var values=new SortedDictionary<string,string>(StringComparer.OrdinalIgnoreCase);
            foreach(DictionaryEntry e in Environment.GetEnvironmentVariables()) values[(string)e.Key]=(string)e.Value;
            values.Remove("NODE_OPTIONS"); values.Remove("NODE_TEST_CONTEXT");
            values["AIONUI_TEST_RESOURCE_GUARDED"]="1";
            values["AIONUI_TEST_RESOURCE_GUARD_PATH"]=testPath;
            // Keep bounded diagnostics plain; resource enforcement is handled by the job.
            values["NODE_DISABLE_COLORS"]="1";
            var b=new StringBuilder(); foreach(var e in values) b.Append(e.Key).Append('=').Append(e.Value).Append('\0');
            b.Append('\0'); return Marshal.StringToHGlobalUni(b.ToString());
        }

        sealed class BoundedOutput {
            readonly byte[] tail=new byte[64*1024]; readonly object sync=new object();
            int position, count; long total; string failure;
            public long Total { get { lock(sync) return total; } }
            public string Failure { get { lock(sync) return failure; } }
            public void Fail(Exception error) { lock(sync) failure=error.GetType().Name; }
            public void Add(byte[] bytes,int length) {
                lock(sync) {
                    total+=length;
                    for(int i=0;i<length;i++) { tail[position]=bytes[i]; position=(position+1)%tail.Length; }
                    count=Math.Min(tail.Length,count+length);
                }
            }
            public string Tail() {
                lock(sync) {
                    var bytes=new byte[count]; int start=(position-count+tail.Length)%tail.Length;
                    for(int i=0;i<count;i++) bytes[i]=tail[(start+i)%tail.Length];
                    return Encoding.UTF8.GetString(bytes);
                }
            }
        }
        static Thread Drain(IntPtr readHandle,BoundedOutput output) {
            var thread=new Thread(()=>{
                try {
                    using(var stream=new FileStream(new SafeFileHandle(readHandle,true),FileAccess.Read,4096,false)) {
                        var bytes=new byte[4096];
                        int count; while((count=stream.Read(bytes,0,bytes.Length))>0) output.Add(bytes,count);
                    }
                } catch(IOException error) {
                    // ERROR_BROKEN_PIPE is ordinary EOF after the child closes its write handle.
                    if((error.HResult & 0xffff)!=109) output.Fail(error);
                } catch(Exception error) { output.Fail(error); }
            });
            thread.IsBackground=true; thread.Name="AionUi guarded output"; thread.Start(); return thread;
        }

        public static GuardResult Run(string nodePath,string testPath,int memoryLimitMiB,int timeoutSeconds) {
            return Run(nodePath,testPath,memoryLimitMiB,timeoutSeconds,false);
        }

        public static GuardResult Run(string nodePath,string testPath,int memoryLimitMiB,int timeoutSeconds,bool longRunningSuite) {
            var result=new GuardResult { MemoryLimitMiB=memoryLimitMiB,MemoryStopThresholdMiB=memoryLimitMiB*9/10,TimeoutSeconds=timeoutSeconds,LongRunningSuite=longRunningSuite };
            var elapsed=Stopwatch.StartNew(); var output=new BoundedOutput();
            IntPtr job=IntPtr.Zero,port=IntPtr.Zero,environment=IntPtr.Zero,stdoutRead=IntPtr.Zero,stdoutWrite=IntPtr.Zero,stderrRead=IntPtr.Zero,stderrWrite=IntPtr.Zero,input=IntPtr.Zero;
            ProcessInformation child=new ProcessInformation(); Thread stdoutThread=null,stderrThread=null;
            Mutex mutex=null; bool ownsMutex=false,assigned=false;
            string phase="validation";
            try {
                if(!RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) throw new PlatformNotSupportedException("Windows Job Objects are required; tests were not started.");
                if(memoryLimitMiB<128 || memoryLimitMiB>2048) throw new ArgumentOutOfRangeException("memoryLimitMiB","Allowed range is 128..2048 MiB.");
                int maximumTimeout=longRunningSuite?1800:300;
                if(timeoutSeconds<1 || timeoutSeconds>maximumTimeout) throw new ArgumentOutOfRangeException("timeoutSeconds","Allowed range is 1.."+maximumTimeout+" seconds. Longer budgets require explicit long-suite opt-in.");
                nodePath=Path.GetFullPath(nodePath); testPath=Path.GetFullPath(testPath);
                if(!File.Exists(nodePath) || !String.Equals(Path.GetFileName(nodePath),"node.exe",StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("An existing node.exe is required.");
                if(!File.Exists(testPath) || !String.Equals(Path.GetExtension(testPath),".cjs",StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("An existing .cjs test file is required.");

                phase="mutex"; mutex=new Mutex(false,@"Global\AionUi-TestResourceGuard-20261026");
                try { ownsMutex=mutex.WaitOne(0); } catch(AbandonedMutexException) { ownsMutex=true; }
                if(!ownsMutex) { result.Reason="another_guarded_test_running"; return result; }
                phase="memory_preflight"; var memory=Memory();
                if(memory.AvailPhys<1024*MiB || memory.AvailPageFile<((ulong)memoryLimitMiB+1024)*MiB) {
                    result.Reason="insufficient_system_memory"; return result;
                }

                phase="job_limit_setup"; job=CreateJobObjectW(IntPtr.Zero,null); Check(job!=IntPtr.Zero,"CreateJobObjectW");
                Set(job,9,new ExtendedLimit { BasicLimitInformation=new BasicLimit { LimitFlags=JOB_MEMORY|KILL_ON_CLOSE|ACTIVE_PROCESS,ActiveProcessLimit=16 },JobMemoryLimit=new UIntPtr((ulong)memoryLimitMiB*MiB) });
                port=CreateIoCompletionPort(new IntPtr(-1),IntPtr.Zero,UIntPtr.Zero,1); Check(port!=IntPtr.Zero,"CreateIoCompletionPort");
                Set(job,7,new CompletionPort { CompletionKey=new IntPtr(1),Port=port });
                // Notification-limit messages are guaranteed; the enforceable job limit remains the backstop.
                Set(job,12,new NotificationLimit { JobMemoryLimit=(ulong)result.MemoryStopThresholdMiB*MiB,LimitFlags=JOB_MEMORY });

                phase="pipe_setup"; var attrs=new SecurityAttributes { Length=Marshal.SizeOf<SecurityAttributes>(),InheritHandle=true };
                Check(CreatePipe(out stdoutRead,out stdoutWrite,ref attrs,4096),"CreatePipe(stdout)");
                Check(SetHandleInformation(stdoutRead,1,0),"Make stdout reader non-inheritable");
                Check(CreatePipe(out stderrRead,out stderrWrite,ref attrs,4096),"CreatePipe(stderr)");
                Check(SetHandleInformation(stderrRead,1,0),"Make stderr reader non-inheritable");
                input=CreateFileW("NUL",0x80000000,3,ref attrs,3,0,IntPtr.Zero); Check(input!=new IntPtr(-1),"Open NUL stdin");
                var startup=new StartupInfo { cb=(uint)Marshal.SizeOf<StartupInfo>(),dwFlags=STARTF_USESTDHANDLES,hStdInput=input,hStdOutput=stdoutWrite,hStdError=stderrWrite };
                environment=EnvironmentBlock(testPath);
                var command=new StringBuilder(Quote(nodePath)+" --max-old-space-size=512 --test --test-isolation=none --test-concurrency=1 "+Quote(testPath));
                phase="create_suspended_process";
                Check(CreateProcessW(nodePath,command,IntPtr.Zero,IntPtr.Zero,true,CREATE_SUSPENDED|CREATE_UNICODE_ENVIRONMENT|CREATE_NO_WINDOW,environment,Path.GetDirectoryName(testPath),ref startup,out child),"CreateProcessW");
                result.ProcessId=child.ProcessId;
                phase="assign_job"; Check(AssignProcessToJobObject(job,child.Process),"AssignProcessToJobObject"); assigned=true;
                Close(ref stdoutWrite); Close(ref stderrWrite); Close(ref input);
                stdoutThread=Drain(stdoutRead,output); stdoutRead=IntPtr.Zero;
                stderrThread=Drain(stderrRead,output); stderrRead=IntPtr.Zero;
                result.ProtectedBeforeStart=true;
                phase="resume_process"; Check(ResumeThread(child.Thread)!=uint.MaxValue,"ResumeThread"); Close(ref child.Thread);
                phase="monitor"; elapsed.Restart();
                while(true) {
                    uint message; UIntPtr key; IntPtr overlapped;
                    bool gotMessage=GetQueuedCompletionStatus(port,out message,out key,out overlapped,50);
                    if(!gotMessage && Marshal.GetLastWin32Error()!=(int)WAIT_TIMEOUT) Check(false,"GetQueuedCompletionStatus");
                    if(gotMessage && (message==9 || message==10 || message==11)) { result.Reason="memory_limit"; result.ExitCode=125; break; }
                    if(gotMessage && message==3) { result.Reason="process_limit"; result.ExitCode=125; break; }
                    if(output.Failure!=null) { result.Reason="output_reader_failed"; result.ExitCode=125; result.Error=output.Failure; break; }
                    var limits=Query<ExtendedLimit>(job,9);
                    result.PeakJobMemoryBytes=Math.Max(result.PeakJobMemoryBytes,limits.PeakJobMemoryUsed.ToUInt64());
                    if(result.PeakJobMemoryBytes>=(ulong)result.MemoryStopThresholdMiB*MiB) { result.Reason="memory_limit"; result.ExitCode=125; break; }
                    if(output.Total>result.OutputLimitBytes) { result.Reason="output_limit"; result.ExitCode=126; break; }
                    if(elapsed.ElapsedMilliseconds>=(long)timeoutSeconds*1000) { result.Reason="timeout"; result.ExitCode=124; break; }
                    memory=Memory();
                    if(memory.AvailPhys<256*MiB || memory.AvailPageFile<512*MiB) { result.Reason="system_memory_pressure"; result.ExitCode=125; break; }
                    uint wait=WaitForSingleObject(child.Process,0);
                    if(wait==0) {
                        uint code; Check(GetExitCodeProcess(child.Process,out code),"GetExitCodeProcess"); result.TestExitCode=code;
                        result.ExitCode=code==0?0:1; result.Reason=code==0?"completed":"test_failed";
                        result.DescendantsTerminated=Query<Accounting>(job,1).ActiveProcesses>0;
                        break;
                    }
                    if(wait!=WAIT_TIMEOUT) throw new Win32Exception(Marshal.GetLastWin32Error(),"WaitForSingleObject");
                }
            } catch(Exception error) {
                result.ExitCode=125; result.Reason=phase+"_failed"; result.Error=error.GetType().Name+": "+error.Message;
            } finally {
                // This also runs when compilation caller is cancelled normally; OS closes job on abrupt supervisor death.
                if(child.Process!=IntPtr.Zero && !assigned) { TerminateProcess(child.Process,125); WaitForSingleObject(child.Process,2000); }
                if(job!=IntPtr.Zero) {
                    if(!TerminateJobObject(job,(uint)(result.ExitCode==0?0:result.ExitCode))) { result.Error+=" Job termination failed: "+Marshal.GetLastWin32Error(); result.ExitCode=125; result.Reason="cleanup_failed"; }
                    try {
                        var cleanup=Stopwatch.StartNew();
                        uint active;
                        do { active=Query<Accounting>(job,1).ActiveProcesses; if(active==0) break; Thread.Sleep(20); } while(cleanup.ElapsedMilliseconds<3000);
                        result.ActiveProcessesAfterCleanup=active;
                        result.PeakJobMemoryBytes=Math.Max(result.PeakJobMemoryBytes,Query<ExtendedLimit>(job,9).PeakJobMemoryUsed.ToUInt64());
                        if(active!=0) { result.ExitCode=125; result.Reason="cleanup_incomplete"; }
                    } catch(Exception error) { result.ExitCode=125; result.Reason="cleanup_failed"; result.Error+=" "+error.Message; }
                }
                Close(ref job); Close(ref child.Thread); Close(ref child.Process); Close(ref port);
                Close(ref stdoutWrite); Close(ref stderrWrite); Close(ref input);
                Close(ref stdoutRead); Close(ref stderrRead);
                if(environment!=IntPtr.Zero) Marshal.FreeHGlobal(environment);
                bool drained=(stdoutThread==null || stdoutThread.Join(2000)) & (stderrThread==null || stderrThread.Join(2000));
                if(!drained) { result.ExitCode=125; result.Reason="output_cleanup_failed"; }
                result.OutputBytes=output.Total; result.OutputTail=output.Tail(); result.ElapsedMilliseconds=elapsed.ElapsedMilliseconds;
                if(output.Failure!=null && (result.ExitCode==0 || result.ExitCode==1)) { result.ExitCode=125; result.Reason="output_reader_failed"; result.Error=output.Failure; }
                // A very short test may finish before the first monitor poll; account for its final pipe bytes too.
                if(result.OutputBytes>result.OutputLimitBytes && (result.ExitCode==0 || result.ExitCode==1)) { result.ExitCode=126; result.Reason="output_limit"; }
                if(ownsMutex) mutex.ReleaseMutex(); if(mutex!=null) mutex.Dispose();
            }
            return result;
        }
    }
}
