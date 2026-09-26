using System.Diagnostics;
using Xunit.Abstractions;

namespace CrimsonArena.Tests;

/// <summary>
/// Big-data playtest: a scripted bot plays hundreds of full runs while every
/// frame is checked against the engine's invariants. It also keeps the
/// difficulty honest: a competent bot must progress, an idle one must lose.
/// </summary>
public class SoakTests(ITestOutputHelper output)
{
    private const int Runs = 120;
    private const double RunSeconds = 150;

    [Fact]
    public void Hundreds_of_bot_runs_keep_every_invariant()
    {
        var waves = new List<int>();
        var deaths = 0;
        var events = new Dictionary<EventType, long>();
        long frames = 0;
        var watch = Stopwatch.StartNew();

        for (var seed = 1; seed <= Runs; seed++)
        {
            var w = new World();
            w.Start((ulong)seed);
            var bot = new Bot((ulong)seed * 31);
            var snap = new Snapshot();
            for (var f = 0; f < RunSeconds * 60 && w.State != GameState.GameOver; f++)
            {
                // Every fourth run summons the Main Boss 20 seconds in (the app's unlock).
                if (seed % 4 == 0 && f == 20 * 60) w.SummonWarlord();
                w.Step(Sim.Frame, bot.Decide(w));
                foreach (var e in w.Events) events[e.Type] = events.GetValueOrDefault(e.Type) + 1;
                CheckInvariants(w);
                if (f % 20 == 0) Assert.All(snap.Write(w), v => Assert.True(double.IsFinite(v)));
                else w.Events.Clear();
                frames++;
            }
            waves.Add(w.Wave);
            if (w.State == GameState.GameOver) deaths++;
        }

        watch.Stop();
        var fps = frames / watch.Elapsed.TotalSeconds;
        output.WriteLine($"{Runs} runs, {frames:N0} frames in {watch.Elapsed.TotalSeconds:F1}s ({fps:N0} frames/s, {fps / 60:N0}x real time)");
        output.WriteLine($"waves reached: avg {waves.Average():F2}, max {waves.Max()}, deaths {deaths}/{Runs}");
        foreach (var (type, count) in events.OrderBy(kv => kv.Key)) output.WriteLine($"  {type,-13} {count,9:N0}");

        Assert.True(waves.Average() >= 2.5, $"a competent bot should clear early waves (avg {waves.Average():F2})");
        Assert.True(deaths > 0, "the game must be able to kill a player");
        Assert.True(events.GetValueOrDefault(EventType.EnemyDeath) > Runs * 5);
        Assert.True(events.GetValueOrDefault(EventType.PlayerHurt) > 0);
        Assert.True(fps > 60 * 20, $"engine must run far faster than real time ({fps:N0} frames/s)");
    }

    [Fact]
    public void An_idle_player_loses()
    {
        for (ulong seed = 1; seed <= 10; seed++)
        {
            var w = new World();
            w.Start(seed);
            Sim.Run(w, 240);
            Assert.Equal(GameState.GameOver, w.State);
            Assert.True(w.Wave <= 3, $"seed {seed}: an idle player should not survive to wave {w.Wave}");
        }
    }

    private static void CheckInvariants(World w)
    {
        var p = w.Player;
        Assert.InRange(p.X, Tuning.EdgeMargin, Tuning.ArenaWidth - Tuning.EdgeMargin);
        Assert.True(p.Y >= 0 && p.Y < 400, $"player y {p.Y}");
        Assert.InRange(p.Hp, 0, p.MaxHp);
        Assert.InRange(p.Stamina, -0.001, Tuning.StaminaMax);
        Assert.InRange(p.Rage, 0, Tuning.RageMax);
        Assert.True(double.IsFinite(p.Vx) && double.IsFinite(p.Vy));
        Assert.Equal(w.Enemies.Count(e => e.HasToken), w.TokensInUse);
        Assert.True(w.Enemies.Count(e => e.IsAlive) <= w.Director.MaxAlive(w.Wave) + 2);
        Assert.InRange(w.Director.Aggression, Ai.Director.MinAggression, Ai.Director.MaxAggression);
        foreach (var e in w.Enemies)
        {
            Assert.InRange(e.X, Tuning.EdgeMargin, Tuning.ArenaWidth - Tuning.EdgeMargin);
            Assert.True(e.Y >= 0 && e.Y < 500, $"enemy y {e.Y}");
            Assert.True(e.Hp <= e.MaxHp);
            Assert.True(e.IsAlive == e.Hp > 0 || e.State == FighterState.Dead);
        }
        Assert.True(w.Projectiles.Count < 64);
    }

    /// <summary>A simple but decent player: closes in, strings attacks, dodges telegraphs, hops daggers and traps.</summary>
    private sealed class Bot(ulong seed)
    {
        private readonly Rng _rng = new(seed);
        private Buttons _last;

        public Buttons Decide(World w)
        {
            var p = w.Player;
            var held = Buttons.None;
            var target = w.Enemies.Where(e => e.IsAlive && e.State != FighterState.Spawn).MinBy(e => Math.Abs(e.X - p.X));

            // Dodge a knight swing that is about to connect.
            var threat = w.Enemies.FirstOrDefault(e => e.IsAlive && e.State == FighterState.Attack
                && Snapshot.AttackPhase(e, e.StateTime) is (0, > 0.55) && Math.Abs(e.X - p.X) < 150 * e.Scale);
            var dagger = w.Projectiles.FirstOrDefault(pr => !pr.FromPlayer && Math.Abs(pr.X - p.X) < 110 && Math.Sign(p.X - pr.X) == Math.Sign(pr.Vx));
            var trap = w.TrapAt(p.X, p.HalfWidth, 0.35);

            if (threat is not null && _rng.Chance(0.7))
            {
                held |= p.X < threat.X ? Buttons.Right : Buttons.Left; // dash through
                held |= Buttons.Dash;
            }
            else if ((dagger is not null || trap is not null) && _rng.Chance(0.85))
            {
                held |= Buttons.Jump;
                if (trap is not null) held |= p.X < trap.X ? Buttons.Left : Buttons.Right;
            }
            else if (target is not null)
            {
                var dx = target.X - p.X;
                var reach = 70 + target.HalfWidth;
                if (Math.Abs(dx) > reach)
                {
                    held |= dx > 0 ? Buttons.Right : Buttons.Left;
                    if (Math.Abs(dx) > 260) held |= Buttons.Run;
                }
                else
                {
                    if (Math.Sign(dx) != p.Facing) held |= dx > 0 ? Buttons.Right : Buttons.Left;
                    if (p.Rage >= Tuning.SpecialCost) held |= Buttons.Special;
                    else if (p.Stamina > 70 && _rng.Chance(0.25)) held |= Buttons.Heavy;
                    else held |= Buttons.Attack;
                }
            }
            else if (w.Pickups.FirstOrDefault() is { } pickup)
            {
                held |= pickup.X > p.X ? Buttons.Right : Buttons.Left;
            }

            // Buttons are edge-triggered: release every other frame so presses register.
            var edge = Buttons.Attack | Buttons.Heavy | Buttons.Special | Buttons.Dash;
            if ((_last & edge) != 0) held &= ~edge;
            if ((_last & Buttons.Jump) != 0 && p.Grounded) held &= ~Buttons.Jump;
            _last = held;
            return held;
        }
    }
}
