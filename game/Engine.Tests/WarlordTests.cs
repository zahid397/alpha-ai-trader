namespace CrimsonArena.Tests;

/// <summary>The Main Boss, summoned on demand after the app's unlock purchase.</summary>
public class WarlordTests
{
    private static Enemy Warlord(World w) => w.Enemies.Single(e => e.Kind == EnemyKind.Warlord);

    [Fact]
    public void Summoning_during_a_wave_brings_the_warlord_in_away_from_the_player()
    {
        var w = new World();
        w.Start(11);
        Assert.Equal(SummonResult.Summoned, w.SummonWarlord());
        var boss = Warlord(w);
        Assert.True(Math.Abs(boss.X - w.Player.X) >= 260);
        Assert.Equal(FighterState.Spawn, boss.State);
        Assert.True(boss.IsBoss);
        Assert.Contains(w.Events, e => e.Type == EventType.BossSpawn && (int)e.Value == (int)EnemyKind.Warlord);
    }

    [Fact]
    public void Only_one_warlord_at_a_time_and_only_during_a_run()
    {
        var idle = new World();
        Assert.Equal(SummonResult.NotPlaying, idle.SummonWarlord());

        var w = new World();
        w.Start(12);
        Assert.Equal(SummonResult.Summoned, w.SummonWarlord());
        Assert.Equal(SummonResult.AlreadyHere, w.SummonWarlord());
        Assert.Single(w.Enemies, e => e.Kind == EnemyKind.Warlord);
    }

    [Fact]
    public void Summoning_between_waves_opens_the_next_wave_with_the_warlord()
    {
        var w = new World();
        w.Start(13);
        var guard = 0;
        while (w.State != GameState.WaveBreak && guard++ < 60 * 60)
        {
            foreach (var e in w.Enemies.Where(e => e.IsAlive).ToList()) w.DamageEnemy(e, 9999, 0, 0, 0, 0, 1);
            w.Step(Sim.Frame, Buttons.None);
        }
        Assert.Equal(GameState.WaveBreak, w.State);
        Assert.Equal(SummonResult.Queued, w.SummonWarlord());
        Assert.True(w.WarlordQueued);
        Assert.Equal(SummonResult.AlreadyHere, w.SummonWarlord());

        Sim.Run(w, 5);
        Assert.Equal(2, w.Wave);
        Assert.False(w.WarlordQueued);
        Assert.Contains(w.Enemies, e => e.Kind == EnemyKind.Warlord);
    }

    [Fact]
    public void The_wave_cannot_clear_while_the_warlord_lives()
    {
        var w = new World();
        w.Start(14);
        w.SummonWarlord();
        w.Player.MaxHp = w.Player.Hp = 1_000_000;
        Sim.Run(w, 30, Buttons.None, x =>
        {
            foreach (var e in x.Enemies.Where(e => e.IsAlive && e.Kind != EnemyKind.Warlord).ToList()) x.DamageEnemy(e, 9999, 0, 0, 0, 0, 1);
        });
        Assert.Equal(GameState.Playing, w.State);
        Assert.Equal(1, w.Wave);
        Assert.True(Warlord(w).IsAlive);
    }

    [Fact]
    public void Warlord_cleaves_an_idle_player()
    {
        var w = Sim.Sandbox();
        var boss = Sim.Place(w, EnemyKind.Warlord, w.Player.X + 300);
        boss.ThinkTimer = 0;
        Sim.Run(w, 8);
        Assert.True(w.Player.Hp < w.Player.MaxHp);
        Assert.Contains(w.Events, e => e.Type == EventType.Swing && (int)e.Value is (int)AttackKind.WarlordCleave or (int)AttackKind.WarlordSlam);
    }

    [Fact]
    public void Slam_shockwave_hits_a_grounded_player_but_can_be_jumped()
    {
        var grounded = Sim.Sandbox();
        var boss = Sim.Place(grounded, EnemyKind.Warlord, grounded.Player.X + 360);
        boss.Facing = -1;
        boss.StartAttack(AttackKind.WarlordSlam);
        Sim.Run(grounded, 1.6);
        Assert.Contains(grounded.Events, e => e.Type == EventType.Slam);
        Assert.True(grounded.Player.Hp < grounded.Player.MaxHp, "the shockwave should reach a player standing still");

        var jumper = Sim.Sandbox();
        boss = Sim.Place(jumper, EnemyKind.Warlord, jumper.Player.X + 360);
        boss.Facing = -1;
        boss.StartAttack(AttackKind.WarlordSlam);
        var jumped = false;
        Sim.Run(jumper, 1.6, Buttons.None, x =>
        {
            var wave = x.Projectiles.FirstOrDefault(p => p.Kind == ProjectileKind.Shockwave);
            if (!jumped && wave is not null && Math.Abs(wave.X - x.Player.X) < 110)
            {
                jumped = true;
                x.Step(Sim.Frame, Buttons.Jump);
                Sim.Run(x, 0.3, Buttons.Jump);
            }
        });
        Assert.True(jumped);
        Assert.Equal(jumper.Player.MaxHp, jumper.Player.Hp);
    }

    [Fact]
    public void Heavy_hits_do_not_stagger_the_warlord_easily()
    {
        var w = Sim.Sandbox();
        var boss = Sim.Place(w, EnemyKind.Warlord, w.Player.X + 90);
        Sim.Press(w, Buttons.Heavy);
        Sim.Run(w, 0.6);
        Assert.True(boss.Hp < boss.MaxHp);
        Assert.NotEqual(FighterState.Stagger, boss.State);
    }

    [Fact]
    public void Killing_the_warlord_pays_big_drops_both_pickups_and_lingers_for_its_death_animation()
    {
        var w = Sim.Sandbox();
        var boss = Sim.Place(w, EnemyKind.Warlord, w.Player.X + 300);
        w.DamageEnemy(boss, boss.MaxHp * 0.6, 0, 0, 0, 0, 1);
        Assert.True(boss.Enraged);
        Assert.Contains(w.Enemies, e => e.Kind == EnemyKind.Knight);
        w.DamageEnemy(boss, 99999, 0, 0, 0, 0, 1);
        Assert.False(boss.IsAlive);
        Assert.True(w.Score >= 5000);
        Assert.Equal(2, w.Pickups.Count);
        Assert.Contains(w.Pickups, p => p.Kind == PickupKind.Health);
        Assert.Contains(w.Pickups, p => p.Kind == PickupKind.Rage);

        // A boss kill slows time for a moment, so allow for that in real seconds.
        Sim.Run(w, 2.0);
        Assert.Contains(w.Enemies, e => e.Kind == EnemyKind.Warlord);
        Sim.Run(w, 2.0);
        Assert.DoesNotContain(w.Enemies, e => e.Kind == EnemyKind.Warlord);
    }

    [Fact]
    public void Snapshot_reports_the_main_boss_on_the_boss_bar()
    {
        var w = Sim.Sandbox();
        Sim.Place(w, EnemyKind.Boss, 400);
        var warlord = Sim.Place(w, EnemyKind.Warlord, 1600);
        w.DamageEnemy(warlord, warlord.MaxHp * 0.25, 0, 0, 0, 0, 1);
        var buf = new Snapshot().Write(w);
        var header = Snapshot.Header.ToList();
        Assert.Equal((int)EnemyKind.Warlord, buf[header.IndexOf("bossKind")]);
        Assert.Equal(0.75, buf[header.IndexOf("bossHp")], 3);
        Assert.Equal(0, buf[header.IndexOf("warlordQueued")]);
    }
}
