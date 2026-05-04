// silent-shim.exe — invisible launcher for Claude Code hooks.
//
// Why this exists: hooks are wrapped in this shim so node/bash spawns
// don't flash a console window on every Pre/Post/Prompt/Stop event.
// Earlier attempts (wscript+VBS, cmd /c) failed because they either
// dropped stdin (wscript+WshShell.Run) or consumed it (cmd /c, which
// echoed Claude's JSON payload back as garbage in additional context).
// A native console app sidesteps both: CreateNoWindow=true hides the
// process, RedirectStandardInput=true lets us pipe Claude's stdin
// straight through to the child, RedirectStandardOutput passes the
// hook's stdout (additional context, curator injections) back up.
//
// Usage: silent-shim.exe "<full command line including args>"
//
// The whole command must be in one quoted argument. silence-all-hooks.ps1
// builds it that way. The first whitespace-split token is the exe
// (or the contents of leading quotes if quoted); the rest is forwarded
// as ProcessStartInfo.Arguments verbatim, which is what every shell
// would have done anyway.

using System.Diagnostics;

if (args.Length == 0)
{
    Console.Error.WriteLine("silent-shim: no command given");
    return 2;
}

string fullCmd = args[0];
string exe;
string remainder;

if (fullCmd.StartsWith("\""))
{
    // Quoted exe path: "C:\path with spaces\foo.exe" arg1 arg2
    int closeQuote = fullCmd.IndexOf('"', 1);
    if (closeQuote < 0)
    {
        Console.Error.WriteLine("silent-shim: unterminated quoted exe");
        return 3;
    }
    exe = fullCmd.Substring(1, closeQuote - 1);
    remainder = closeQuote + 1 < fullCmd.Length
        ? fullCmd.Substring(closeQuote + 1).TrimStart()
        : string.Empty;
}
else
{
    int sp = fullCmd.IndexOf(' ');
    exe = sp < 0 ? fullCmd : fullCmd.Substring(0, sp);
    remainder = sp < 0 ? string.Empty : fullCmd.Substring(sp + 1);
}

var psi = new ProcessStartInfo
{
    FileName = exe,
    Arguments = remainder,
    UseShellExecute = false,
    CreateNoWindow = true,
    WindowStyle = ProcessWindowStyle.Hidden,
    RedirectStandardInput = true,
    RedirectStandardOutput = true,
    RedirectStandardError = true,
};

Process? proc;
try
{
    proc = Process.Start(psi);
}
catch (Exception ex)
{
    Console.Error.WriteLine($"silent-shim: failed to start '{exe}': {ex.Message}");
    return 4;
}
if (proc is null)
{
    Console.Error.WriteLine($"silent-shim: Process.Start returned null for '{exe}'");
    return 5;
}

// Pump stdin from this process into the child. Hooks like
// devneural-skill-tracker.js, caveman-mode-tracker.js, gsd-prompt-guard.js,
// and deck-hook.sh read Claude's JSON payload from stdin; without this
// they bail on empty input and silently no-op.
var stdinTask = Task.Run(async () =>
{
    try
    {
        using var inStream = Console.OpenStandardInput();
        await inStream.CopyToAsync(proc.StandardInput.BaseStream);
    }
    catch
    {
        // Pipe close races on hook timeout are harmless; ignore.
    }
    finally
    {
        try { proc.StandardInput.Close(); } catch { }
    }
});

// Forward stdout to our stdout. Claude Code reads hook stdout as
// additional context, so anything the hook wrote (e.g. the curator
// injection block) must reach us.
var stdoutTask = Task.Run(async () =>
{
    try
    {
        using var outStream = Console.OpenStandardOutput();
        await proc.StandardOutput.BaseStream.CopyToAsync(outStream);
    }
    catch { /* ignore */ }
});

var stderrTask = Task.Run(async () =>
{
    try
    {
        using var errStream = Console.OpenStandardError();
        await proc.StandardError.BaseStream.CopyToAsync(errStream);
    }
    catch { /* ignore */ }
});

proc.WaitForExit();
try { Task.WaitAll(new[] { stdinTask, stdoutTask, stderrTask }, 2000); } catch { }
return proc.ExitCode;
