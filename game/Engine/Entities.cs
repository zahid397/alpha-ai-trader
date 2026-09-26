namespace CrimsonArena;

/// <summary>Anything with a body that can move, attack and take damage.</summary>
public abstract class Fighter
{
    public int Id;
    public double X;
    public double Y;
    public double Vx;
    public double Vy;
    public int Facing = 1;
    public double Hp;
    public double MaxHp;
    public FighterState State = FighterState.Idle;
    public double StateTime;
    public double StateDuration;
    public AttackKind Attack = AttackKind.None;
    public bool Grounded = true;
    public double Flash;
    public double HalfWidth = Tuning.BodyHalfWidth;
    public double Height = Tuning.BodyHeight;
    public double Scale = 1;

    /// <summary>Targets already hit by the current attack swing (one hit per swing).</summary>
    public readonly HashSet<int> HitThisSwing = new();

    public bool IsAlive => State != FighterState.Dead;
    public double HpRatio => MaxHp > 0 ? Hp / MaxHp : 0;
    public AttackDef? CurrentAttack => State == FighterState.Attack && Attack != AttackKind.None ? Attacks.Get(Attack) : null;

    public void SetState(FighterState state, double duration = 0)
    {
        State = state;
        StateTime = 0;
        StateDuration = duration;
        if (state != FighterState.Attack) Attack = AttackKind.None;
    }

    public void StartAttack(AttackKind kind)
    {
        var def = Attacks.Get(kind);
        State = FighterState.Attack;
        Attack = kind;
        StateTime = 0;
        StateDuration = def.Duration;
        HitThisSwing.Clear();
    }

    public bool Overlaps(double left, double right, double bottom, double top) =>
        X + HalfWidth > left && X - HalfWidth < right && Y + Height > bottom && Y < top;
}

public sealed class Player : Fighter
{
    public double Stamina = Tuning.StaminaMax;
    public double Rage;
    public double Invuln;
    public double DashCooldown;
    public double Coyote;
    public double JumpBuffer;
    public double AttackBuffer;
    public double HeavyBuffer;
    public double SpecialBuffer;
    public double DashBuffer;
    public bool AirDashUsed;
    public int ComboStep;

    public Player()
    {
        Id = 0;
        MaxHp = Hp = Tuning.PlayerMaxHp;
    }
}

public sealed class Enemy : Fighter
{
    public EnemyKind Kind;
    public bool IsBoss => Kind is EnemyKind.Boss or EnemyKind.Warlord;
    public double Speed;
    public double Poise;
    public double PoiseMax;
    public double PoiseRegenDelay;
    public double DamageScale = 1;
    public double AttackSpeed = 1;
    public int ScoreValue;

    // Brain state.
    public Intent Intent = Intent.Idle;
    public double ThinkTimer;
    public double StrafeDir = 1;
    public bool HasToken;
    public double SlashCooldown;
    public double HeavyCooldown;
    public double LungeCooldown;
    public double ThrowCooldown;
    public double EvadeCooldown;
    public AttackKind PendingAttack = AttackKind.None;
    public bool Enraged;
    public bool KilledByTrap;
    public double DeathTimer;
}

public enum ProjectileKind
{
    Crescent = 0,
    Dagger = 1,
    Shockwave = 2,
}

public sealed class Projectile
{
    public int Id;
    public ProjectileKind Kind;
    public double X;
    public double Y;
    public double Vx;
    public double Life;
    public bool FromPlayer;
    public double Damage;
    public double HalfWidth;
    public double HalfHeight;
    public bool Pierce;
    public readonly HashSet<int> Hit = new();
}

public enum TrapPhase
{
    Idle = 0,
    Charge = 1,
    Rise = 2,
    Full = 3,
    Retract = 4,
}

public sealed class Trap
{
    public double X;
    public double HalfWidth = 46;
    public TrapPhase Phase = TrapPhase.Idle;
    public double PhaseTime;
    public double PhaseDuration;
    public readonly HashSet<int> HitThisCycle = new();

    /// <summary>True while stepping on it hurts, or is about to.</summary>
    public bool IsDangerous(double lookahead) => Phase switch
    {
        TrapPhase.Charge or TrapPhase.Rise or TrapPhase.Full => true,
        TrapPhase.Idle => PhaseDuration - PhaseTime < lookahead,
        _ => false,
    };

    public bool IsLethal => Phase is TrapPhase.Rise or TrapPhase.Full;
}

public enum PickupKind
{
    Health = 0,
    Rage = 1,
}

public sealed class Pickup
{
    public int Id;
    public PickupKind Kind;
    public double X;
    public double Y;
    public double Vy;
    public double Life;
}
