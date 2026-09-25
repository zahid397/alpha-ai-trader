namespace CrimsonArena.Tests;

/// <summary>Helpers that drive the world the way the browser does: one Step per 60 Hz frame.</summary>
internal static class Sim
{
    public const double Frame = 1.0 / 60;

    public static World Sandbox(ulong seed = 7, bool traps = false)
    {
        var w = new World();
        w.StartSandbox(seed);
        if (!traps) w.Traps.Clear();
        return w;
    }

    public static void Run(World w, double seconds, Buttons held = Buttons.None, Action<World>? each = null)
    {
        var frames = (int)Math.Round(seconds / Frame);
        for (var i = 0; i < frames; i++)
        {
            w.Step(Frame, held);
            each?.Invoke(w);
        }
    }

    /// <summary>Press a button for one frame, then release it.</summary>
    public static void Press(World w, Buttons button, Buttons held = Buttons.None)
    {
        w.Step(Frame, held | button);
        w.Step(Frame, held);
    }

    /// <summary>Put an enemy at an exact spot, already past its spawn animation.</summary>
    public static Enemy Place(World w, EnemyKind kind, double x)
    {
        var e = w.Spawn(new Ai.SpawnOrder(kind, 0, 0));
        e.X = x;
        e.SetState(FighterState.Idle);
        e.Facing = x < w.Player.X ? 1 : -1;
        e.ThinkTimer = 10; // hold still until a test lets the brain run
        return e;
    }

    public static bool Has(World w, EventType type) => w.Events.Any(e => e.Type == type);
}
