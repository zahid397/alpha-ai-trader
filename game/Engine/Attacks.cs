namespace CrimsonArena;

public enum AttackKind
{
    None = 0,
    Light1 = 1,
    Light2 = 2,
    Heavy = 3,
    Special = 4,
    KnightSlash = 5,
    KnightOverhead = 6,
    KnightLunge = 7,
    RogueThrow = 8,
    WarlordCleave = 9,
    WarlordSlam = 10,
}

/// <summary>
/// Frame data for one attack: windup (telegraph) -> active (hitbox live) ->
/// recovery. Everything is in seconds and pixels, measured from the
/// attacker's feet in the direction it faces.
/// </summary>
public sealed record AttackDef(
    AttackKind Kind,
    double Windup,
    double Active,
    double Recovery,
    double Reach,
    double Height,
    double Damage,
    double KnockX,
    double KnockY,
    double Hitstop,
    double Stagger,
    double Lunge = 0,
    double CancelAfter = double.MaxValue,
    double StaminaCost = 0,
    bool SpawnsProjectile = false)
{
    public double Duration => Windup + Active + Recovery;
    public bool IsActive(double t) => t >= Windup && t < Windup + Active;
}

public static class Attacks
{
    public static readonly AttackDef Light1 = new(AttackKind.Light1, 0.09, 0.10, 0.22, 80, 72, 10, 180, 60, 0.05, 22, Lunge: 110, CancelAfter: 0.24);
    public static readonly AttackDef Light2 = new(AttackKind.Light2, 0.10, 0.12, 0.26, 88, 76, 13, 230, 80, 0.06, 28, Lunge: 140, CancelAfter: 0.27);
    public static readonly AttackDef Heavy = new(AttackKind.Heavy, 0.26, 0.14, 0.34, 108, 92, 28, 430, 330, 0.11, 75, Lunge: 180, CancelAfter: 0.62, StaminaCost: 30);
    public static readonly AttackDef Special = new(AttackKind.Special, 0.16, 0.06, 0.24, 0, 0, 0, 0, 0, 0, 0, SpawnsProjectile: true);

    public static readonly AttackDef KnightSlash = new(AttackKind.KnightSlash, 0.42, 0.12, 0.45, 92, 80, 12, 260, 90, 0.07, 0);
    public static readonly AttackDef KnightOverhead = new(AttackKind.KnightOverhead, 0.66, 0.14, 0.62, 100, 110, 20, 360, 240, 0.1, 0);
    public static readonly AttackDef KnightLunge = new(AttackKind.KnightLunge, 0.36, 0.22, 0.52, 76, 80, 15, 300, 120, 0.08, 0, Lunge: 540);
    public static readonly AttackDef RogueThrow = new(AttackKind.RogueThrow, 0.38, 0.05, 0.4, 0, 0, 9, 160, 60, 0.04, 0, SpawnsProjectile: true);

    // Main Boss: a huge greatsword sweep, and a slam that sends a shockwave along the floor (jump it).
    public static readonly AttackDef WarlordCleave = new(AttackKind.WarlordCleave, 0.62, 0.2, 0.55, 150, 150, 24, 460, 280, 0.12, 0);
    public static readonly AttackDef WarlordSlam = new(AttackKind.WarlordSlam, 0.78, 0.12, 0.7, 96, 120, 18, 300, 380, 0.1, 0, SpawnsProjectile: true);

    public static AttackDef Get(AttackKind kind) => kind switch
    {
        AttackKind.Light1 => Light1,
        AttackKind.Light2 => Light2,
        AttackKind.Heavy => Heavy,
        AttackKind.Special => Special,
        AttackKind.KnightSlash => KnightSlash,
        AttackKind.KnightOverhead => KnightOverhead,
        AttackKind.KnightLunge => KnightLunge,
        AttackKind.RogueThrow => RogueThrow,
        AttackKind.WarlordCleave => WarlordCleave,
        AttackKind.WarlordSlam => WarlordSlam,
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };
}
