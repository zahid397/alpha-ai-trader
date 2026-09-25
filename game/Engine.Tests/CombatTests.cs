namespace CrimsonArena.Tests;

public class CombatTests
{
    [Fact]
    public void Light_attack_hits_once_and_builds_combo_and_rage()
    {
        var w = Sim.Sandbox();
        var knight = Sim.Place(w, EnemyKind.Knight, w.Player.X + 60);
        Sim.Press(w, Buttons.Attack);
        Sim.Run(w, 0.5);
        Assert.Equal(knight.MaxHp - Attacks.Light1.Damage, knight.Hp, 3);
        Assert.Equal(1, w.Combo);
        Assert.True(w.Player.Rage > 0);
        Assert.True(Sim.Has(w, EventType.Hit));
    }

    [Fact]
    public void Missing_does_nothing()
    {
        var w = Sim.Sandbox();
        var knight = Sim.Place(w, EnemyKind.Knight, w.Player.X - 150);
        Sim.Press(w, Buttons.Attack);
        Sim.Run(w, 0.5);
        Assert.Equal(knight.MaxHp, knight.Hp);
        Assert.Equal(0, w.Combo);
    }

    [Fact]
    public void Light_attacks_chain_into_the_second_swing()
    {
        var w = Sim.Sandbox();
        Sim.Press(w, Buttons.Attack);
        Sim.Run(w, 0.1);
        Sim.Press(w, Buttons.Attack);
        Sim.Run(w, 0.3);
        var swings = w.Events.Where(e => e.Type == EventType.Swing).Select(e => (AttackKind)(int)e.Value).ToList();
        Assert.Equal([AttackKind.Light1, AttackKind.Light2], swings);
    }

    [Fact]
    public void Heavy_attack_breaks_poise_and_launches()
    {
        var w = Sim.Sandbox();
        var knight = Sim.Place(w, EnemyKind.Knight, w.Player.X + 80);
        Sim.Press(w, Buttons.Heavy);
        Assert.Equal(Tuning.StaminaMax - Attacks.Heavy.StaminaCost, w.Player.Stamina, 0);
        Sim.Run(w, 0.45);
        Assert.Equal(FighterState.Stagger, knight.State);
        Assert.False(knight.Grounded);
        Assert.True(knight.Vx > 0, "knocked away from the player");
        Assert.True(Sim.Has(w, EventType.Stagger));
    }

    [Fact]
    public void Hitstop_freezes_the_world_briefly()
    {
        var w = Sim.Sandbox();
        Sim.Place(w, EnemyKind.Knight, w.Player.X + 80);
        Sim.Press(w, Buttons.Heavy);
        var guard = 0;
        while (w.Hitstop <= 0 && guard++ < 60) w.Step(Sim.Frame, Buttons.None);
        var time = w.Time;
        w.Step(Sim.Frame, Buttons.None);
        Assert.Equal(time, w.Time);
    }

    [Fact]
    public void Special_needs_rage_and_fires_a_piercing_crescent()
    {
        var w = Sim.Sandbox();
        Sim.Press(w, Buttons.Special);
        Sim.Run(w, 0.3);
        Assert.Empty(w.Projectiles);

        var a = Sim.Place(w, EnemyKind.Rogue, w.Player.X + 150);
        var b = Sim.Place(w, EnemyKind.Rogue, w.Player.X + 260);
        w.Player.Rage = Tuning.RageMax;
        Sim.Press(w, Buttons.Special);
        Assert.Equal(Tuning.RageMax - Tuning.SpecialCost, w.Player.Rage, 0);
        Sim.Run(w, 0.25);
        Assert.Contains(w.Projectiles, p => p.FromPlayer && p.Kind == ProjectileKind.Crescent);
        Sim.Run(w, 0.4);
        Assert.True(a.Hp < a.MaxHp && b.Hp < b.MaxHp, "crescent pierces through both");
    }

    [Fact]
    public void Knight_walks_up_and_hurts_an_idle_player()
    {
        var w = Sim.Sandbox();
        var knight = Sim.Place(w, EnemyKind.Knight, w.Player.X + 320);
        knight.ThinkTimer = 0;
        Sim.Run(w, 8);
        Assert.True(w.Player.Hp < w.Player.MaxHp);
        Assert.True(Sim.Has(w, EventType.PlayerHurt));
    }

    [Fact]
    public void Rogue_keeps_range_and_throws_daggers()
    {
        var w = Sim.Sandbox();
        var rogue = Sim.Place(w, EnemyKind.Rogue, w.Player.X + 300);
        rogue.ThinkTimer = 0;
        Sim.Run(w, 5);
        Assert.True(Sim.Has(w, EventType.Throw));
        Assert.True(Math.Abs(rogue.X - w.Player.X) > 120, "rogues are skirmishers, not brawlers");
    }

    [Fact]
    public void Invulnerable_dash_through_a_swing_is_a_perfect_dodge()
    {
        var w = Sim.Sandbox();
        var knight = Sim.Place(w, EnemyKind.Knight, w.Player.X + 80);
        knight.Facing = -1;
        knight.StartAttack(AttackKind.KnightSlash);
        while (knight.StateTime < Attacks.KnightSlash.Windup - 0.05) w.Step(Sim.Frame, Buttons.None);
        Sim.Press(w, Buttons.Dash);
        Sim.Run(w, 0.3);
        Assert.True(Sim.Has(w, EventType.PerfectDodge));
        Assert.Equal(w.Player.MaxHp, w.Player.Hp);
        Assert.True(w.Player.Rage > 0, "perfect dodges feed rage");
    }

    [Fact]
    public void Taking_a_hit_resets_combo_and_grants_mercy_frames()
    {
        var w = Sim.Sandbox();
        var knight = Sim.Place(w, EnemyKind.Knight, w.Player.X + 60);
        Sim.Press(w, Buttons.Attack);
        Sim.Run(w, 0.4);
        Assert.Equal(1, w.Combo);
        w.DamagePlayer(10, -1, 100, 0, 0);
        Assert.Equal(0, w.Combo);
        Assert.Equal(FighterState.Hurt, w.Player.State);
        var hp = w.Player.Hp;
        w.DamagePlayer(10, -1, 100, 0, 0);
        Assert.Equal(hp, w.Player.Hp);
        Assert.True(knight.IsAlive);
    }

    [Fact]
    public void Killing_scores_with_the_combo_multiplier()
    {
        var w = Sim.Sandbox();
        var rogue = Sim.Place(w, EnemyKind.Rogue, w.Player.X + 60);
        for (var i = 0; i < 20; i++) w.DamageEnemy(Sim.Place(w, EnemyKind.Knight, 300), 1, 0, 0, 0, 0, 1);
        Assert.Equal(20, w.Combo);
        w.DamageEnemy(rogue, 999, 100, 100, 0, 0, 1);
        Assert.False(rogue.IsAlive);
        Assert.Equal((long)Math.Round(rogue.ScoreValue * 2.05), w.Score);
        Assert.Equal(1, w.Kills);
    }

    [Fact]
    public void Dying_ends_the_run()
    {
        var w = Sim.Sandbox();
        w.DamagePlayer(9999, 1, 0, 0, 0);
        Assert.Equal(FighterState.Dead, w.Player.State);
        Sim.Run(w, 3.5);
        Assert.Equal(GameState.GameOver, w.State);
        Assert.True(Sim.Has(w, EventType.GameOver));
    }

    [Fact]
    public void Pickups_heal_and_expire()
    {
        var w = Sim.Sandbox();
        w.Player.Hp = 50;
        w.Pickups.Add(new Pickup { Id = 99, Kind = PickupKind.Health, X = w.Player.X, Y = 40, Life = 5 });
        w.Pickups.Add(new Pickup { Id = 100, Kind = PickupKind.Rage, X = 200, Y = 40, Life = 1 });
        Sim.Run(w, 1.5);
        Assert.Equal(72, w.Player.Hp, 3);
        Assert.Empty(w.Pickups);
    }
}
