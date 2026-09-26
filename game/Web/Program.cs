using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;

[assembly: SupportedOSPlatform("browser")]

namespace CrimsonArena.Web;

public static class Program
{
    // The JS host calls exports directly; nothing to do at startup.
    public static void Main()
    {
    }
}

/// <summary>The engine's JavaScript surface. One world per page.</summary>
public static partial class GameExports
{
    private static readonly World World = new();
    private static readonly Snapshot Snapshot = new();

    /// <summary>Field layout + static game data as JSON (call once).</summary>
    [JSExport]
    public static string Layout() => Snapshot.LayoutJson;

    /// <summary>Start a new run. The seed makes it reproducible.</summary>
    [JSExport]
    public static void Start(double seed) => World.Start((ulong)Math.Abs(seed));

    /// <summary>Advance the simulation by real time with the held buttons and return the frame.</summary>
    [JSExport]
    public static double[] Step(double dt, int buttons)
    {
        World.Step(dt, (Buttons)buttons);
        return Snapshot.Write(World);
    }

    /// <summary>
    /// Bring in the Main Boss (after the app's "Unlock Main Boss" purchase).
    /// Returns a SummonResult: 0 not playing, 1 summoned, 2 queued for next wave, 3 already here.
    /// </summary>
    [JSExport]
    public static int SummonBoss() => (int)World.SummonWarlord();

    /// <summary>How the AI Director currently reads the player: calm, balanced or ruthless.</summary>
    [JSExport]
    public static string Mood() => World.Director.Mood;
}
