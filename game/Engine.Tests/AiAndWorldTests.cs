using System.Text.Json;
using CrimsonArena.Ai;

namespace CrimsonArena.Tests;

public class AiAndWorldTests
{
    [Fact]
    public void Attack_tokens_limit_how_many_enemies_swing_at_once()
    {
        var w = Sim.Sandbox();
        w.Player.MaxHp = w.Player.Hp = 1_000_000;
        var knights = Enumerable.Range(0, 7).Select(i => Sim.Place(w, EnemyKind.Knight, 700 + i * 90)).ToList();
        knights.ForEach(k => k.ThinkTimer = 0);
        var peak = 0;
        Sim.Run(w, 15, Buttons.None, x =>
        {
            var holders = x.Enemies.Count(e => e.HasToken);
            Assert.Equal(holders, x.TokensInUse);
            Assert.True(holders <= x.Director.TokenCapacity(x.Wave));
            peak = Math.Max(peak, x.Enemies.Count(e => e.State == FighterState.Attack));
        });
        Assert.InRange(peak, 1, w.Director.TokenCapacity(w.Wave));
    }

    [Fact]
    public void Enemies_refuse_to_walk_into_an_armed_trap()
    {
        var w = Sim.Sandbox(traps: true);
        var trap = w.Traps[0];
        w.Player.X = trap.X + 140;
        var knight = Sim.Place(w, EnemyKind.Knight, trap.X - 140);
        knight.ThinkTimer = 0;
        trap.Phase = TrapPhase.Charge;
        trap.PhaseTime = 0;
        trap.PhaseDuration = 0.9;
        Sim.Run(w, 1.8, Buttons.None, _ =>
            Assert.True(knight.X + knight.HalfWidth < trap.X - trap.HalfWidth + 4, "knight stepped onto the trap"));
        Assert.Equal(knight.MaxHp, knight.Hp);
        Assert.Contains(knight.Intent, new[] { Intent.AvoidTrap, Intent.WaitTurn, Intent.Approach, Intent.Idle });
    }

    [Fact]
    public void Traps_hurt_enemies_too_and_trap_kills_pay_a_bonus()
    {
        var w = Sim.Sandbox(traps: true);
        var trap = w.Traps[0];
        var knight = Sim.Place(w, EnemyKind.Knight, trap.X);
        knight.Hp = 5;
        trap.Phase = TrapPhase.Charge;
        trap.PhaseTime = 0.85;
        trap.PhaseDuration = 0.9;
        Sim.Run(w, 0.4);
        Assert.False(knight.IsAlive);
        Assert.True(knight.KilledByTrap);
        Assert.True(Sim.Has(w, EventType.TrapKill));
        Assert.True(w.Score >= knight.ScoreValue + 150);
        Assert.Equal(0, w.Combo);
    }

    [Fact]
    public void Traps_cycle_through_their_phases()
    {
        var w = Sim.Sandbox(traps: true);
        var seen = new HashSet<TrapPhase>();
        Sim.Run(w, 12, Buttons.None, x => seen.Add(x.Traps[0].Phase));
        Assert.Equal(Enum.GetValues<TrapPhase>().ToHashSet(), seen);
        Assert.True(Sim.Has(w, EventType.TrapFire));
    }

    [Fact]
    public void Jumping_clears_a_firing_trap()
    {
        var w = Sim.Sandbox(traps: true);
        var trap = w.Traps[0];
        w.Player.X = trap.X;
        trap.Phase = TrapPhase.Charge;
        trap.PhaseTime = 0.8;
        trap.PhaseDuration = 0.9;
        Sim.Run(w, 0.4, Buttons.Jump);
        Assert.Equal(w.Player.MaxHp, w.Player.Hp);
    }

    [Fact]
    public void Waves_clear_heal_and_escalate()
    {
        var w = new World();
        w.Start(3);
        Assert.Equal(GameState.Playing, w.State);
        Assert.Equal(1, w.Wave);
        var cleared = 0;
        Sim.Run(w, 90, Buttons.None, x =>
        {
            foreach (var e in x.Enemies.Where(e => e.IsAlive).ToList()) x.DamageEnemy(e, 99999, 0, 0, 0, 0, 1);
            cleared += x.Events.Count(e => e.Type == EventType.WaveClear);
            x.Events.Clear();
        });
        Assert.True(w.Wave >= 6, $"reached wave {w.Wave}");
        Assert.True(cleared >= 5);
        Assert.True(w.Score > 0);
        Assert.True(w.Player.IsAlive);
    }

    [Fact]
    public void Every_fifth_wave_brings_a_boss()
    {
        var director = new Director();
        var rng = new Rng(1);
        Assert.Equal(EnemyKind.Boss, director.ComposeWave(5, rng)[0].Kind);
        Assert.Equal(EnemyKind.Boss, director.ComposeWave(10, rng)[0].Kind);
        Assert.DoesNotContain(director.ComposeWave(4, rng), o => o.Kind == EnemyKind.Boss);
        Assert.True(director.ComposeWave(8, rng).Count > director.ComposeWave(1, rng).Count);
    }

    [Fact]
    public void Boss_enrages_at_half_health_and_calls_help()
    {
        var w = Sim.Sandbox();
        var boss = Sim.Place(w, EnemyKind.Boss, w.Player.X + 300);
        w.DamageEnemy(boss, boss.MaxHp * 0.55, 0, 0, 0, 0, 1);
        Assert.True(boss.Enraged);
        Assert.Contains(w.Enemies, e => e.Kind == EnemyKind.Rogue);
    }

    [Fact]
    public void Director_pushes_back_on_a_dominant_player_and_eases_off_a_struggling_one()
    {
        var strong = new Director();
        strong.OnWaveStart();
        for (var i = 0; i < 12; i++) strong.OnHitLanded();
        strong.Tick(6);
        strong.OnWaveCleared(new Player(), 2);
        Assert.True(strong.Aggression > 1);

        var weak = new Director();
        weak.OnWaveStart();
        weak.OnPlayerDamaged(100);
        weak.Tick(80);
        weak.OnWaveCleared(new Player { Hp = 15 }, 2);
        Assert.True(weak.Aggression < 1);
        Assert.True(weak.HealthDropChance(new Player { Hp = 15 }) > strong.HealthDropChance(new Player()));
        Assert.Equal("balanced", new Director().Mood);
    }

    [Fact]
    public void Mercy_rule_slows_enemies_when_the_player_is_nearly_dead()
    {
        var d = new Director();
        var low = new Player { Hp = 20 };
        Assert.True(d.EffectiveAggression(low) < d.EffectiveAggression(new Player()));
    }

    [Fact]
    public void Same_seed_and_inputs_replay_exactly()
    {
        static List<double[]> Play(ulong seed)
        {
            var w = new World();
            w.Start(seed);
            var snap = new Snapshot();
            var input = new Rng(99);
            var frames = new List<double[]>();
            for (var i = 0; i < 60 * 45; i++)
            {
                var held = (Buttons)(int)(input.Next() * 512);
                w.Step(Sim.Frame, held);
                if (i % 30 == 0) frames.Add(snap.Write(w));
            }
            return frames;
        }

        var a = Play(42);
        var b = Play(42);
        var c = Play(43);
        Assert.Equal(a.Count, b.Count);
        for (var i = 0; i < a.Count; i++) Assert.Equal(a[i], b[i]);
        Assert.NotEqual(a[^1], c[^1]);
    }

    [Fact]
    public void Restarting_a_world_matches_a_fresh_one()
    {
        var used = new World();
        used.Start(5);
        Sim.Run(used, 20, Buttons.Right | Buttons.Attack);
        used.Start(9);
        var fresh = new World();
        fresh.Start(9);
        Sim.Run(used, 10, Buttons.Left);
        Sim.Run(fresh, 10, Buttons.Left);
        Assert.Equal(new Snapshot().Write(fresh), new Snapshot().Write(used));
    }

    [Fact]
    public void Snapshot_matches_its_published_layout()
    {
        var w = Sim.Sandbox(traps: true);
        Sim.Place(w, EnemyKind.Knight, 400);
        Sim.Place(w, EnemyKind.Rogue, 1600);
        w.Pickups.Add(new Pickup { Id = 50, Kind = PickupKind.Rage, X = 100, Y = 14, Life = 9 });
        w.Emit(EventType.Hit, 1, 2, 3, 4);

        using var layout = JsonDocument.Parse(Snapshot.LayoutJson);
        var root = layout.RootElement;
        int Len(string key) => root.GetProperty(key).GetArrayLength();

        var events = w.Events.Count;
        var buf = new Snapshot().Write(w);
        var expected = Len("header") + Len("player")
            + 1 + 2 * Len("enemy")
            + 1 + 0 * Len("projectile")
            + 1 + 3 * Len("trap")
            + 1 + 1 * Len("pickup")
            + 1 + events * Len("event");
        Assert.Equal(expected, buf.Length);
        Assert.Empty(w.Events);
        Assert.Equal(Snapshot.Version, buf[0]);
        Assert.Equal(w.Player.X, buf[Len("header")]);
        Assert.Equal(2, buf[Len("header") + Len("player")]);
        Assert.Equal((int)EnemyKind.Knight, buf[Len("header") + Len("player") + 2]);
        Assert.Equal(1, root.GetProperty("events").GetProperty("Hit").GetInt32());
        Assert.Equal(Attacks.Heavy.Windup, root.GetProperty("attacks").GetProperty("3").GetProperty("windup").GetDouble());
        Assert.Equal(Tuning.ArenaWidth, root.GetProperty("tuning").GetProperty("arenaWidth").GetDouble());
        Assert.All(buf, v => Assert.True(double.IsFinite(v)));
    }

    [Fact]
    public void Attack_phase_reports_windup_active_recovery()
    {
        var p = new Player();
        p.StartAttack(AttackKind.Heavy);
        Assert.Equal(0, Snapshot.AttackPhase(p, 0.1).Phase);
        Assert.Equal(1, Snapshot.AttackPhase(p, 0.3).Phase);
        Assert.Equal(2, Snapshot.AttackPhase(p, 0.5).Phase);
        Assert.Equal(-1, Snapshot.AttackPhase(new Player(), 0).Phase);
    }
}
