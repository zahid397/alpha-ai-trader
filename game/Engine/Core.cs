namespace CrimsonArena;

/// <summary>Tuning constants. Units: pixels, seconds. Y points up (floor = 0).</summary>
public static class Tuning
{
    public const double Tick = 1.0 / 120.0;
    public const double ArenaWidth = 2400;
    public const double EdgeMargin = 40;
    public const double Gravity = 1750;

    public const double PlayerMaxHp = 120;
    public const double WalkSpeed = 175;
    public const double RunSpeed = 300;
    public const double GroundAccel = 2400;
    public const double AirAccel = 1500;
    public const double Friction = 2800;
    public const double JumpVelocity = 640;
    public const double JumpCutVelocity = 280;
    public const double CoyoteTime = 0.1;
    public const double JumpBuffer = 0.13;
    public const double AttackBuffer = 0.22;

    public const double DashSpeed = 660;
    public const double DashTime = 0.18;
    public const double DashCooldown = 0.5;
    public const double DashStamina = 22;
    public const double StaminaMax = 100;
    public const double StaminaRegen = 32;
    public const double RageMax = 100;
    public const double SpecialCost = 50;

    public const double HurtTime = 0.32;
    public const double InvulnTime = 0.9;
    public const double StaggerTime = 0.5;
    public const double ComboWindow = 2.4;
    public const double PerfectDodgeSlowmo = 0.55;

    public const double BodyHalfWidth = 18;
    public const double BodyHeight = 78;
}

/// <summary>Deterministic xorshift128+ RNG: same seed, same game.</summary>
public sealed class Rng
{
    private ulong _a, _b;

    public Rng(ulong seed)
    {
        _a = seed ^ 0x9E3779B97F4A7C15UL;
        _b = (seed * 0xBF58476D1CE4E5B9UL) ^ 0x94D049BB133111EBUL;
        if (_a == 0 && _b == 0) _a = 1;
        for (var i = 0; i < 8; i++) NextULong();
    }

    public ulong NextULong()
    {
        var s1 = _a;
        var s0 = _b;
        _a = s0;
        s1 ^= s1 << 23;
        _b = s1 ^ s0 ^ (s1 >> 17) ^ (s0 >> 26);
        return _b + s0;
    }

    /// <summary>Uniform in [0, 1).</summary>
    public double Next() => (NextULong() >> 11) * (1.0 / (1UL << 53));

    public double Range(double min, double max) => min + (max - min) * Next();

    public bool Chance(double p) => Next() < p;
}

[Flags]
public enum Buttons
{
    None = 0,
    Left = 1,
    Right = 2,
    Jump = 4,
    Down = 8,
    Attack = 16,
    Heavy = 32,
    Special = 64,
    Dash = 128,
    Run = 256,
}

public enum GameState
{
    Title = 0,
    Playing = 1,
    WaveBreak = 2,
    GameOver = 3,
}

public enum FighterState
{
    Idle = 0,
    Walk = 1,
    Run = 2,
    Jump = 3,
    Fall = 4,
    Attack = 5,
    Hurt = 6,
    Dead = 7,
    Dash = 8,
    Stagger = 9,
    Spawn = 10,
}

public enum EnemyKind
{
    Knight = 0,
    Rogue = 1,
    Boss = 2,
}

/// <summary>What an enemy's brain decided to do (exposed for the debug overlay).</summary>
public enum Intent
{
    Idle = 0,
    Approach = 1,
    Retreat = 2,
    Strafe = 3,
    Attack = 4,
    AvoidTrap = 5,
    WaitTurn = 6,
    Evade = 7,
}

public enum EventType
{
    Hit = 1,
    PlayerHurt = 2,
    EnemyDeath = 3,
    Swing = 4,
    Jump = 5,
    Land = 6,
    Dash = 7,
    TrapFire = 8,
    WaveStart = 9,
    WaveClear = 10,
    Pickup = 11,
    BossSpawn = 12,
    GameOver = 13,
    PerfectDodge = 14,
    Throw = 15,
    Special = 16,
    Stagger = 17,
    Spawn = 18,
    TrapKill = 19,
}

public readonly record struct GameEvent(EventType Type, double X, double Y, double Value, double Aux);
