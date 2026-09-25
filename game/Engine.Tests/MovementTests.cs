namespace CrimsonArena.Tests;

public class MovementTests
{
    [Fact]
    public void Walking_accelerates_to_walk_speed()
    {
        var w = Sim.Sandbox();
        var start = w.Player.X;
        Sim.Run(w, 1, Buttons.Right);
        Assert.InRange(w.Player.X - start, 150, Tuning.WalkSpeed);
        Assert.Equal(Tuning.WalkSpeed, w.Player.Vx, 3);
        Assert.Equal(FighterState.Walk, w.Player.State);
    }

    [Fact]
    public void Running_is_faster_than_walking()
    {
        var w = Sim.Sandbox();
        var start = w.Player.X;
        Sim.Run(w, 1, Buttons.Left | Buttons.Run);
        Assert.InRange(start - w.Player.X, 270, Tuning.RunSpeed);
        Assert.Equal(FighterState.Run, w.Player.State);
        Assert.Equal(-1, w.Player.Facing);
    }

    [Fact]
    public void Friction_stops_the_player_quickly()
    {
        var w = Sim.Sandbox();
        Sim.Run(w, 0.5, Buttons.Right);
        Sim.Run(w, 0.2);
        Assert.Equal(0, w.Player.Vx);
        Assert.Equal(FighterState.Idle, w.Player.State);
    }

    [Fact]
    public void Arena_edges_hold_the_player()
    {
        var w = Sim.Sandbox();
        Sim.Run(w, 8, Buttons.Left | Buttons.Run);
        Assert.Equal(Tuning.EdgeMargin, w.Player.X);
    }

    [Fact]
    public void Full_jump_reaches_the_expected_apex_and_lands()
    {
        var w = Sim.Sandbox();
        var apex = 0.0;
        Sim.Run(w, 1.2, Buttons.Jump, x => apex = Math.Max(apex, x.Player.Y));
        var expected = Tuning.JumpVelocity * Tuning.JumpVelocity / (2 * Tuning.Gravity);
        Assert.InRange(apex, expected * 0.95, expected * 1.02);
        Assert.True(w.Player.Grounded);
        Assert.True(Sim.Has(w, EventType.Jump));
        Assert.True(Sim.Has(w, EventType.Land));
    }

    [Fact]
    public void Releasing_jump_early_gives_a_short_hop()
    {
        var w = Sim.Sandbox();
        var apex = 0.0;
        Sim.Press(w, Buttons.Jump);
        Sim.Run(w, 1, Buttons.None, x => apex = Math.Max(apex, x.Player.Y));
        Assert.InRange(apex, 10, 50);
    }

    [Fact]
    public void Jump_pressed_just_before_landing_is_buffered()
    {
        var w = Sim.Sandbox();
        Sim.Run(w, 0.3, Buttons.Jump);
        Sim.Run(w, 0.05);
        // Falling now; press jump a few frames before touching down.
        while (w.Player.Y > 25) w.Step(Sim.Frame, Buttons.None);
        Sim.Press(w, Buttons.Jump);
        Sim.Run(w, 0.15, Buttons.Jump);
        Assert.True(w.Player.Y > 30, "buffered jump should fire on landing");
    }

    [Fact]
    public void Dash_costs_stamina_and_grants_iframes()
    {
        var w = Sim.Sandbox();
        var start = w.Player.X;
        w.Step(Sim.Frame, Buttons.Dash);
        Assert.Equal(FighterState.Dash, w.Player.State);
        Assert.True(w.Player.Invuln > 0);
        Assert.InRange(w.Player.Stamina, Tuning.StaminaMax - Tuning.DashStamina, Tuning.StaminaMax - Tuning.DashStamina + 2);
        Sim.Run(w, 0.3);
        Assert.InRange(w.Player.X - start, 100, 160);
        Assert.NotEqual(FighterState.Dash, w.Player.State);
    }

    [Fact]
    public void Dash_has_a_cooldown()
    {
        var w = Sim.Sandbox();
        Sim.Press(w, Buttons.Dash);
        Sim.Run(w, 0.2);
        var stamina = w.Player.Stamina;
        Sim.Press(w, Buttons.Dash);
        Assert.NotEqual(FighterState.Dash, w.Player.State);
        Assert.True(w.Player.Stamina >= stamina, "no stamina spent while on cooldown");
    }
}
