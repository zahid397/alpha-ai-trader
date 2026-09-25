using System.Globalization;
using System.Text;

namespace CrimsonArena;

/// <summary>
/// Packs the world into one flat <c>double[]</c> per frame, which is the
/// cheapest thing to pass across the WebAssembly/JS boundary. The field order
/// is published once as JSON (<see cref="LayoutJson"/>) so the renderer reads
/// values by name and never hard-codes offsets.
///
/// Buffer: header | player | n, enemies | n, projectiles | n, traps | n, pickups | n, events.
/// Events are drained after each write.
/// </summary>
public sealed class Snapshot
{
    public const int Version = 1;

    public static readonly string[] Header =
    [
        "version", "state", "time", "wave", "score", "combo", "multiplier", "kills", "bestCombo",
        "stateTimer", "timeScale", "hitstop", "aggression", "enemiesLeft", "bossHp", "tokens", "comboTimer",
    ];

    public static readonly string[] PlayerFields =
    [
        "x", "y", "vx", "vy", "facing", "hp", "maxHp", "stamina", "rage", "state", "stateTime", "stateDuration",
        "attack", "attackPhase", "phaseT", "invuln", "grounded", "comboStep", "flash", "dashCooldown",
    ];

    public static readonly string[] EnemyFields =
    [
        "id", "kind", "x", "y", "vx", "facing", "hp", "maxHp", "state", "stateTime", "stateDuration",
        "attack", "attackPhase", "phaseT", "flash", "intent", "scale", "enraged", "hasToken", "poise", "deathTimer",
    ];

    public static readonly string[] ProjectileFields = ["id", "kind", "x", "y", "vx", "life", "fromPlayer"];
    public static readonly string[] TrapFields = ["x", "phase", "phaseTime", "phaseDuration", "halfWidth"];
    public static readonly string[] PickupFields = ["id", "kind", "x", "y", "life"];
    public static readonly string[] EventFields = ["type", "x", "y", "value", "aux"];

    private double[] _buffer = new double[512];
    private int _length;

    /// <summary>Everything the renderer needs to decode a frame, plus static game data.</summary>
    public static string LayoutJson { get; } = BuildLayout();

    public int Length => _length;

    /// <summary>Serialise the world into a fresh array and drain its events.</summary>
    public double[] Write(World w)
    {
        _length = 0;
        var p = w.Player;
        var boss = w.Enemies.FirstOrDefault(e => e.IsBoss && e.IsAlive);

        Push(Version);
        Push((int)w.State);
        Push(w.Time);
        Push(w.Wave);
        Push(w.Score);
        Push(w.Combo);
        Push(w.Multiplier);
        Push(w.Kills);
        Push(w.BestCombo);
        Push(w.StateTimer);
        Push(w.TimeScale);
        Push(w.Hitstop);
        Push(w.Director.Aggression);
        Push(w.Enemies.Count(e => e.IsAlive) + w.PendingSpawns);
        Push(boss?.HpRatio ?? -1);
        Push(w.TokensInUse);
        Push(w.ComboTimer);

        var (phase, phaseT) = AttackPhase(p, p.StateTime);
        Push(p.X);
        Push(p.Y);
        Push(p.Vx);
        Push(p.Vy);
        Push(p.Facing);
        Push(p.Hp);
        Push(p.MaxHp);
        Push(p.Stamina);
        Push(p.Rage);
        Push((int)p.State);
        Push(p.StateTime);
        Push(p.StateDuration);
        Push((int)p.Attack);
        Push(phase);
        Push(phaseT);
        Push(p.Invuln);
        Push(p.Grounded ? 1 : 0);
        Push(p.ComboStep);
        Push(p.Flash);
        Push(p.DashCooldown);

        Push(w.Enemies.Count);
        foreach (var e in w.Enemies)
        {
            (phase, phaseT) = AttackPhase(e, e.StateTime);
            Push(e.Id);
            Push((int)e.Kind);
            Push(e.X);
            Push(e.Y);
            Push(e.Vx);
            Push(e.Facing);
            Push(e.Hp);
            Push(e.MaxHp);
            Push((int)e.State);
            Push(e.StateTime);
            Push(e.StateDuration);
            Push((int)e.Attack);
            Push(phase);
            Push(phaseT);
            Push(e.Flash);
            Push((int)e.Intent);
            Push(e.Scale);
            Push(e.Enraged ? 1 : 0);
            Push(e.HasToken ? 1 : 0);
            Push(e.PoiseMax > 0 ? e.Poise / e.PoiseMax : 0);
            Push(e.DeathTimer);
        }

        Push(w.Projectiles.Count);
        foreach (var pr in w.Projectiles)
        {
            Push(pr.Id);
            Push((int)pr.Kind);
            Push(pr.X);
            Push(pr.Y);
            Push(pr.Vx);
            Push(pr.Life);
            Push(pr.FromPlayer ? 1 : 0);
        }

        Push(w.Traps.Count);
        foreach (var t in w.Traps)
        {
            Push(t.X);
            Push((int)t.Phase);
            Push(t.PhaseTime);
            Push(t.PhaseDuration);
            Push(t.HalfWidth);
        }

        Push(w.Pickups.Count);
        foreach (var pk in w.Pickups)
        {
            Push(pk.Id);
            Push((int)pk.Kind);
            Push(pk.X);
            Push(pk.Y);
            Push(pk.Life);
        }

        Push(w.Events.Count);
        foreach (var ev in w.Events)
        {
            Push((int)ev.Type);
            Push(ev.X);
            Push(ev.Y);
            Push(ev.Value);
            Push(ev.Aux);
        }
        w.Events.Clear();

        return _buffer.AsSpan(0, _length).ToArray();
    }

    /// <summary>0 windup, 1 active, 2 recovery (-1 when not attacking) and progress 0..1 within that phase.</summary>
    public static (int Phase, double T) AttackPhase(Fighter f, double time)
    {
        var def = f.CurrentAttack;
        if (def is null) return (-1, 0);
        if (time < def.Windup) return (0, def.Windup > 0 ? time / def.Windup : 1);
        if (time < def.Windup + def.Active) return (1, (time - def.Windup) / def.Active);
        return (2, def.Recovery > 0 ? Math.Min(1, (time - def.Windup - def.Active) / def.Recovery) : 1);
    }

    private void Push(double value)
    {
        if (_length == _buffer.Length) Array.Resize(ref _buffer, _buffer.Length * 2);
        _buffer[_length++] = value;
    }

    private static string BuildLayout()
    {
        var sb = new StringBuilder();
        sb.Append('{');
        Field(sb, "version", Version);
        Names(sb, "header", Header);
        Names(sb, "player", PlayerFields);
        Names(sb, "enemy", EnemyFields);
        Names(sb, "projectile", ProjectileFields);
        Names(sb, "trap", TrapFields);
        Names(sb, "pickup", PickupFields);
        Names(sb, "event", EventFields);

        sb.Append("\"tuning\":{");
        Field(sb, "tick", Tuning.Tick);
        Field(sb, "arenaWidth", Tuning.ArenaWidth);
        Field(sb, "edgeMargin", Tuning.EdgeMargin);
        Field(sb, "staminaMax", Tuning.StaminaMax);
        Field(sb, "rageMax", Tuning.RageMax);
        Field(sb, "specialCost", Tuning.SpecialCost);
        Field(sb, "heavyCost", Attacks.Heavy.StaminaCost);
        Field(sb, "dashCost", Tuning.DashStamina);
        Field(sb, "comboWindow", Tuning.ComboWindow, last: true);
        sb.Append("},");

        sb.Append("\"attacks\":{");
        var kinds = Enum.GetValues<AttackKind>().Where(k => k != AttackKind.None).ToArray();
        for (var i = 0; i < kinds.Length; i++)
        {
            var d = Attacks.Get(kinds[i]);
            sb.Append('"').Append((int)d.Kind).Append("\":{");
            Field(sb, "name", d.Kind.ToString());
            Field(sb, "windup", d.Windup);
            Field(sb, "active", d.Active);
            Field(sb, "recovery", d.Recovery);
            Field(sb, "reach", d.Reach);
            Field(sb, "damage", d.Damage, last: true);
            sb.Append('}');
            if (i < kinds.Length - 1) sb.Append(',');
        }
        sb.Append("},");

        EnumMap(sb, "states", Enum.GetValues<GameState>());
        EnumMap(sb, "fighterStates", Enum.GetValues<FighterState>());
        EnumMap(sb, "enemyKinds", Enum.GetValues<EnemyKind>());
        EnumMap(sb, "intents", Enum.GetValues<Intent>());
        EnumMap(sb, "events", Enum.GetValues<EventType>());
        EnumMap(sb, "trapPhases", Enum.GetValues<TrapPhase>());
        EnumMap(sb, "attackKinds", Enum.GetValues<AttackKind>());
        EnumMap(sb, "buttons", Enum.GetValues<Buttons>(), last: true);
        sb.Append('}');
        return sb.ToString();
    }

    private static void Names(StringBuilder sb, string key, string[] names)
    {
        sb.Append('"').Append(key).Append("\":[");
        sb.AppendJoin(',', names.Select(n => $"\"{n}\""));
        sb.Append("],");
    }

    private static void EnumMap<T>(StringBuilder sb, string key, T[] values, bool last = false) where T : struct, System.Enum
    {
        sb.Append('"').Append(key).Append("\":{");
        sb.AppendJoin(',', values.Select(v => $"\"{v}\":{Convert.ToInt32(v, CultureInfo.InvariantCulture)}"));
        sb.Append('}');
        if (!last) sb.Append(',');
    }

    private static void Field(StringBuilder sb, string key, double value, bool last = false)
    {
        sb.Append('"').Append(key).Append("\":").Append(value.ToString("R", CultureInfo.InvariantCulture));
        if (!last) sb.Append(',');
    }

    private static void Field(StringBuilder sb, string key, string value, bool last = false)
    {
        sb.Append('"').Append(key).Append("\":\"").Append(value).Append('"');
        if (!last) sb.Append(',');
    }
}
