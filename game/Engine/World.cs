using System.Runtime.CompilerServices;
using CrimsonArena.Ai;

[assembly: InternalsVisibleTo("CrimsonArena.Engine.Tests")]

namespace CrimsonArena;

/// <summary>
/// The whole game simulation. Deterministic: the same seed and the same
/// input sequence always produce the same game. The browser calls
/// <see cref="Step"/> once per animation frame; internally the world advances
/// in fixed 1/120 s ticks.
/// </summary>
public sealed class World
{
    public static readonly double[] TrapPositions = [560, 1440, 1960];
    public const double PlayerStartX = 1000;

    public GameState State { get; private set; } = GameState.Title;
    public double Time { get; private set; }
    public int Wave { get; private set; }
    public long Score { get; private set; }
    public int Combo { get; private set; }
    public int BestCombo { get; private set; }
    public int Kills { get; private set; }
    public double ComboTimer { get; private set; }
    public double TimeScale { get; private set; } = 1;
    public double Hitstop { get; private set; }
    public double StateTimer { get; private set; }
    public int TokensInUse { get; private set; }
    public int WaveEnemyCount { get; private set; }

    public Player Player { get; private set; } = new();
    public List<Enemy> Enemies { get; } = new();
    public List<Projectile> Projectiles { get; } = new();
    public List<Trap> Traps { get; } = new();
    public List<Pickup> Pickups { get; } = new();
    public List<GameEvent> Events { get; } = new();
    public Director Director { get; private set; } = new();
    public Rng Rng { get; private set; }

    public double Multiplier => 1 + Math.Min(Combo, 40) / 20.0;
    public int PendingSpawns => _pending.Count;

    private readonly List<SpawnOrder> _pending = new();
    private double _spawnClock;
    private double _accumulator;
    private double _slowmoTimer;
    private Buttons _held;
    private Buttons _pressed;
    private bool _waveDamageTaken;
    private int _nextId = 1;
    private bool _sandbox;

    public World(ulong seed = 1)
    {
        Rng = new Rng(seed);
    }

    /// <summary>Start (or restart) a run.</summary>
    public void Start(ulong seed)
    {
        Rng = new Rng(seed);
        Director = new Director();
        Player = new Player { X = PlayerStartX, Facing = 1 };
        Enemies.Clear();
        Projectiles.Clear();
        Pickups.Clear();
        Events.Clear();
        _pending.Clear();
        Traps.Clear();
        foreach (var x in TrapPositions)
        {
            Traps.Add(new Trap { X = x, PhaseDuration = Rng.Range(1.5, 4.0) });
        }
        Time = 0;
        Score = 0;
        Combo = 0;
        BestCombo = 0;
        Kills = 0;
        ComboTimer = 0;
        TimeScale = 1;
        Hitstop = 0;
        TokensInUse = 0;
        _accumulator = 0;
        _slowmoTimer = 0;
        _held = _pressed = Buttons.None;
        _sandbox = false;
        _nextId = 1;
        BeginWave(1);
    }

    /// <summary>Test arena: a run with no waves, so a test can place exactly the enemies it needs.</summary>
    internal void StartSandbox(ulong seed)
    {
        Start(seed);
        _sandbox = true;
        _pending.Clear();
        WaveEnemyCount = 0;
        Events.Clear();
    }

    public void Emit(EventType type, double x, double y, double value = 0, double aux = 0) =>
        Events.Add(new GameEvent(type, x, y, value, aux));

    // ------------------------------------------------------------------
    // Frame stepping
    // ------------------------------------------------------------------

    /// <summary>Advance by a real-time delta with the currently held buttons.</summary>
    public void Step(double realDt, Buttons held)
    {
        realDt = Math.Clamp(realDt, 0, 0.1);
        _pressed |= held & ~_held;
        _held = held;

        if (State is GameState.Title or GameState.GameOver)
        {
            Time += realDt;
            return;
        }

        if (Hitstop > 0)
        {
            Hitstop = Math.Max(0, Hitstop - realDt);
            return;
        }

        if (_slowmoTimer > 0)
        {
            _slowmoTimer -= realDt;
            if (_slowmoTimer <= 0) TimeScale = 1;
        }

        _accumulator += realDt * TimeScale;
        var ticks = 0;
        while (_accumulator >= Tuning.Tick && ticks < 16)
        {
            Tick(Tuning.Tick, _held, _pressed);
            _pressed = Buttons.None;
            _accumulator -= Tuning.Tick;
            ticks++;
            // A heavy hit freezes the world right away (hit-stop), not next frame.
            if (Hitstop > 0) break;
        }
    }

    private void Tick(double dt, Buttons held, Buttons pressed)
    {
        Time += dt;
        Director.Tick(dt);

        if (State == GameState.WaveBreak && Player.IsAlive)
        {
            StateTimer -= dt;
            if (StateTimer <= 0) BeginWave(Wave + 1);
        }

        UpdatePlayer(dt, held, pressed);
        if (State == GameState.Playing) UpdateSpawns(dt);
        for (var i = 0; i < Enemies.Count; i++) UpdateEnemy(Enemies[i], dt);
        UpdateProjectiles(dt);
        UpdateTraps(dt);
        UpdatePickups(dt);
        ResolveMelee();
        SeparateEnemies();

        if (ComboTimer > 0)
        {
            ComboTimer -= dt;
            if (ComboTimer <= 0) Combo = 0;
        }

        Enemies.RemoveAll(e => e.State == FighterState.Dead && e.DeathTimer > 1.6);

        if (!_sandbox && State == GameState.Playing && _pending.Count == 0 && !Enemies.Any(e => e.IsAlive) && Player.IsAlive)
        {
            ClearWave();
        }

        if (!Player.IsAlive && State != GameState.GameOver)
        {
            StateTimer -= dt;
            if (StateTimer <= 0)
            {
                State = GameState.GameOver;
                Emit(EventType.GameOver, Player.X, 0, Score, Wave);
            }
        }
    }

    // ------------------------------------------------------------------
    // Waves
    // ------------------------------------------------------------------

    private void BeginWave(int wave)
    {
        Wave = wave;
        State = GameState.Playing;
        _pending.Clear();
        _pending.AddRange(Director.ComposeWave(wave, Rng));
        WaveEnemyCount = _pending.Count;
        _spawnClock = 0;
        _waveDamageTaken = false;
        Director.OnWaveStart();
        Emit(EventType.WaveStart, Player.X, 0, wave, wave % 5 == 0 ? 1 : 0);
    }

    private void ClearWave()
    {
        var bonus = 200L * Wave + (_waveDamageTaken ? 0 : 500);
        Score += bonus;
        Director.OnWaveCleared(Player, WaveEnemyCount);
        Player.Hp = Math.Min(Player.MaxHp, Player.Hp + Player.MaxHp * 0.12);
        State = GameState.WaveBreak;
        StateTimer = 3.2;
        Emit(EventType.WaveClear, Player.X, 0, bonus, _waveDamageTaken ? 0 : 1);
    }

    private void UpdateSpawns(double dt)
    {
        _spawnClock += dt;
        var alive = Enemies.Count(e => e.IsAlive);
        while (_pending.Count > 0 && _pending[0].Delay <= _spawnClock && alive < Director.MaxAlive(Wave))
        {
            Spawn(_pending[0]);
            _pending.RemoveAt(0);
            alive++;
        }
        // Don't let the queue stall behind the alive cap forever.
        if (_pending.Count > 0 && alive < Director.MaxAlive(Wave) && _pending[0].Delay > _spawnClock + 3) _spawnClock = _pending[0].Delay;
    }

    public Enemy Spawn(SpawnOrder order)
    {
        var side = order.Side;
        var x = side == 0 ? Tuning.EdgeMargin + 40 : Tuning.ArenaWidth - Tuning.EdgeMargin - 40;
        if (Math.Abs(x - Player.X) < 260) x = side == 0 ? Tuning.ArenaWidth - Tuning.EdgeMargin - 40 : Tuning.EdgeMargin + 40;

        var hpScale = 1 + 0.08 * (Wave - 1);
        var e = new Enemy { Id = _nextId++, Kind = order.Kind, X = x, Facing = x < Player.X ? 1 : -1, DamageScale = 1 + 0.05 * (Wave - 1) };
        switch (order.Kind)
        {
            case EnemyKind.Knight:
                e.MaxHp = 70 * hpScale;
                e.Speed = 95;
                e.PoiseMax = 40;
                e.HalfWidth = 24;
                e.Height = 100;
                e.ScoreValue = 100;
                break;
            case EnemyKind.Rogue:
                e.MaxHp = 40 * hpScale;
                e.Speed = 165;
                e.PoiseMax = 12;
                e.HalfWidth = 17;
                e.Height = 82;
                e.ScoreValue = 80;
                break;
            default:
                e.MaxHp = 520 * (1 + 0.15 * (Wave / 5 - 1));
                e.Speed = 115;
                e.PoiseMax = 160;
                e.HalfWidth = 34;
                e.Height = 135;
                e.Scale = 1.35;
                e.ScoreValue = 1500;
                e.DamageScale *= 1.35;
                e.AttackSpeed = 1.15;
                break;
        }
        e.Hp = e.MaxHp;
        e.Poise = e.PoiseMax;
        e.SetState(FighterState.Spawn, 0.75);
        e.ThinkTimer = Rng.Range(0.2, 0.5);
        Enemies.Add(e);
        Emit(e.IsBoss ? EventType.BossSpawn : EventType.Spawn, e.X, 0, (int)e.Kind, e.Id);
        return e;
    }

    // ------------------------------------------------------------------
    // Attack tokens (fair crowd combat)
    // ------------------------------------------------------------------

    public bool TryTakeToken(Enemy e)
    {
        if (e.HasToken) return true;
        if (TokensInUse >= Director.TokenCapacity(Wave)) return false;
        e.HasToken = true;
        TokensInUse++;
        return true;
    }

    public void ReleaseToken(Enemy e)
    {
        if (!e.HasToken) return;
        e.HasToken = false;
        TokensInUse = Math.Max(0, TokensInUse - 1);
    }

    // ------------------------------------------------------------------
    // Player controller
    // ------------------------------------------------------------------

    private void UpdatePlayer(double dt, Buttons held, Buttons pressed)
    {
        var p = Player;
        p.StateTime += dt;
        p.Flash = Math.Max(0, p.Flash - dt);
        p.Invuln = Math.Max(0, p.Invuln - dt);
        p.DashCooldown = Math.Max(0, p.DashCooldown - dt);
        p.JumpBuffer = pressed.HasFlag(Buttons.Jump) ? Tuning.JumpBuffer : Math.Max(0, p.JumpBuffer - dt);
        p.AttackBuffer = pressed.HasFlag(Buttons.Attack) ? Tuning.AttackBuffer : Math.Max(0, p.AttackBuffer - dt);
        p.HeavyBuffer = pressed.HasFlag(Buttons.Heavy) ? Tuning.AttackBuffer : Math.Max(0, p.HeavyBuffer - dt);
        p.SpecialBuffer = pressed.HasFlag(Buttons.Special) ? Tuning.AttackBuffer : Math.Max(0, p.SpecialBuffer - dt);
        p.DashBuffer = pressed.HasFlag(Buttons.Dash) ? Tuning.AttackBuffer : Math.Max(0, p.DashBuffer - dt);
        var regen = p.State == FighterState.Attack ? 0.4 : 1;
        p.Stamina = Math.Min(Tuning.StaminaMax, p.Stamina + Tuning.StaminaRegen * regen * dt);

        var dir = (held.HasFlag(Buttons.Right) ? 1 : 0) - (held.HasFlag(Buttons.Left) ? 1 : 0);
        var gravityScale = 1.0;

        switch (p.State)
        {
            case FighterState.Dead:
                p.Vx = Brain.MoveToward(p.Vx, 0, Tuning.Friction * dt);
                break;

            case FighterState.Hurt:
                if (p.StateTime >= Tuning.HurtTime) p.SetState(p.Grounded ? FighterState.Idle : FighterState.Fall);
                else if (p.Grounded) p.Vx = Brain.MoveToward(p.Vx, 0, Tuning.Friction * 0.5 * dt);
                break;

            case FighterState.Dash:
                p.Vx = p.Facing * Tuning.DashSpeed;
                p.Vy = 0;
                gravityScale = 0;
                if (p.StateTime >= Tuning.DashTime)
                {
                    p.Vx *= 0.35;
                    p.SetState(p.Grounded ? FighterState.Idle : FighterState.Fall);
                }
                break;

            case FighterState.Attack:
                UpdatePlayerAttack(p, dir, dt, ref gravityScale);
                break;

            default:
                UpdateLocomotion(p, dir, held, dt);
                TryStartActions(p, dir);
                break;
        }

        Integrate(p, dt, gravityScale);
        if (p.Grounded) p.Coyote = Tuning.CoyoteTime;
        else p.Coyote = Math.Max(0, p.Coyote - dt);
    }

    private void UpdateLocomotion(Player p, int dir, Buttons held, double dt)
    {
        if (dir != 0) p.Facing = dir;
        var target = dir * (held.HasFlag(Buttons.Run) ? Tuning.RunSpeed : Tuning.WalkSpeed);
        var accel = p.Grounded ? (dir == 0 ? Tuning.Friction : Tuning.GroundAccel) : Tuning.AirAccel;
        p.Vx = Brain.MoveToward(p.Vx, target, accel * dt);

        if (p.JumpBuffer > 0 && (p.Grounded || p.Coyote > 0))
        {
            p.Vy = Tuning.JumpVelocity;
            p.Grounded = false;
            p.Coyote = 0;
            p.JumpBuffer = 0;
            Emit(EventType.Jump, p.X, p.Y);
        }
        // Variable jump height: releasing jump early cuts the rise.
        if (!held.HasFlag(Buttons.Jump) && !p.Grounded && p.Vy > Tuning.JumpCutVelocity) p.Vy = Tuning.JumpCutVelocity;

        var next = p.Grounded
            ? Math.Abs(p.Vx) > Tuning.WalkSpeed + 20 ? FighterState.Run : Math.Abs(p.Vx) > 12 ? FighterState.Walk : FighterState.Idle
            : p.Vy > 0 ? FighterState.Jump : FighterState.Fall;
        if (next != p.State)
        {
            var keepTime = (p.State is FighterState.Walk or FighterState.Run) && (next is FighterState.Walk or FighterState.Run);
            var t = p.StateTime;
            p.SetState(next);
            if (keepTime) p.StateTime = t;
        }
    }

    /// <summary>Dash / attack / heavy / special from a neutral state or a cancel window.</summary>
    private bool TryStartActions(Player p, int dir)
    {
        if (p.DashBuffer > 0 && p.DashCooldown <= 0 && p.Stamina >= Tuning.DashStamina && (p.Grounded || !p.AirDashUsed))
        {
            if (dir != 0) p.Facing = dir;
            p.SetState(FighterState.Dash, Tuning.DashTime);
            p.Stamina -= Tuning.DashStamina;
            p.DashCooldown = Tuning.DashCooldown;
            p.Invuln = Math.Max(p.Invuln, Tuning.DashTime + 0.06);
            p.DashBuffer = 0;
            if (!p.Grounded) p.AirDashUsed = true;
            Emit(EventType.Dash, p.X, p.Y, 0, -1);
            return true;
        }
        if (p.SpecialBuffer > 0 && p.Rage >= Tuning.SpecialCost)
        {
            if (dir != 0) p.Facing = dir;
            p.Rage -= Tuning.SpecialCost;
            p.SpecialBuffer = 0;
            p.StartAttack(AttackKind.Special);
            Emit(EventType.Special, p.X, p.Y + 40, 0, p.Facing);
            return true;
        }
        if (p.HeavyBuffer > 0 && p.Stamina >= Attacks.Heavy.StaminaCost)
        {
            if (dir != 0) p.Facing = dir;
            p.Stamina -= Attacks.Heavy.StaminaCost;
            p.HeavyBuffer = 0;
            p.ComboStep = 0;
            p.StartAttack(AttackKind.Heavy);
            Emit(EventType.Swing, p.X, p.Y, (int)AttackKind.Heavy, 0);
            return true;
        }
        if (p.AttackBuffer > 0)
        {
            if (dir != 0) p.Facing = dir;
            var kind = p.ComboStep % 2 == 0 ? AttackKind.Light1 : AttackKind.Light2;
            p.ComboStep++;
            p.AttackBuffer = 0;
            p.StartAttack(kind);
            Emit(EventType.Swing, p.X, p.Y, (int)kind, 0);
            return true;
        }
        return false;
    }

    private void UpdatePlayerAttack(Player p, int dir, double dt, ref double gravityScale)
    {
        var def = Attacks.Get(p.Attack);
        var driveEnd = def.Windup + def.Active;
        if (p.Grounded)
        {
            p.Vx = p.StateTime < driveEnd && def.Lunge > 0
                ? p.Facing * def.Lunge * (1 - p.StateTime / driveEnd)
                : Brain.MoveToward(p.Vx, 0, Tuning.Friction * dt);
        }
        else
        {
            // Air attacks hang briefly for style.
            gravityScale = p.StateTime < driveEnd ? 0.35 : 1;
            p.Vx = Brain.MoveToward(p.Vx, dir * Tuning.WalkSpeed, Tuning.AirAccel * 0.5 * dt);
        }

        if (def.SpawnsProjectile && !p.HitThisSwing.Contains(-1) && p.StateTime >= def.Windup)
        {
            p.HitThisSwing.Add(-1);
            Projectiles.Add(new Projectile
            {
                Id = _nextId++,
                Kind = ProjectileKind.Crescent,
                X = p.X + p.Facing * 30,
                Y = p.Y + 42,
                Vx = p.Facing * 760,
                Life = 0.8,
                FromPlayer = true,
                Damage = 26,
                HalfWidth = 32,
                HalfHeight = 44,
                Pierce = true,
            });
        }

        if (p.StateTime >= def.CancelAfter && TryStartActions(p, dir)) return;
        if (p.StateTime >= def.Duration)
        {
            p.SetState(p.Grounded ? FighterState.Idle : FighterState.Fall);
            p.ComboStep = 0;
        }
    }

    private void Integrate(Fighter f, double dt, double gravityScale = 1)
    {
        var wasGrounded = f.Grounded;
        if (!f.Grounded) f.Vy -= Tuning.Gravity * gravityScale * dt;
        f.X += f.Vx * dt;
        f.Y += f.Vy * dt;
        if (f.Y <= 0)
        {
            f.Y = 0;
            if (!wasGrounded)
            {
                f.Grounded = true;
                f.Vy = 0;
                if (f is Player pl)
                {
                    pl.AirDashUsed = false;
                    if (pl.IsAlive) Emit(EventType.Land, f.X, 0);
                }
            }
        }
        else if (f.Y > 0.5)
        {
            f.Grounded = false;
        }
        f.X = Math.Clamp(f.X, Tuning.EdgeMargin, Tuning.ArenaWidth - Tuning.EdgeMargin);
    }

    // ------------------------------------------------------------------
    // Enemies
    // ------------------------------------------------------------------

    private void UpdateEnemy(Enemy e, double dt)
    {
        e.Flash = Math.Max(0, e.Flash - dt);
        e.PoiseRegenDelay -= dt;
        if (e.PoiseRegenDelay <= 0) e.Poise = e.PoiseMax;

        switch (e.State)
        {
            case FighterState.Dead:
                e.DeathTimer += dt;
                e.StateTime += dt;
                if (e.Grounded) e.Vx = Brain.MoveToward(e.Vx, 0, Tuning.Friction * dt);
                break;
            case FighterState.Spawn:
                e.StateTime += dt;
                if (e.StateTime >= e.StateDuration) e.SetState(FighterState.Idle);
                break;
            case FighterState.Hurt:
            case FighterState.Stagger:
                e.StateTime += dt;
                if (e.Grounded) e.Vx = Brain.MoveToward(e.Vx, 0, Tuning.Friction * 0.6 * dt);
                if (e.StateTime >= e.StateDuration && e.Grounded) e.SetState(FighterState.Idle);
                break;
            case FighterState.Attack:
                UpdateEnemyAttack(e, dt);
                break;
            default:
                e.StateTime += dt;
                Brain.Update(this, e, dt);
                break;
        }
        Integrate(e, dt);
    }

    private void UpdateEnemyAttack(Enemy e, double dt)
    {
        var def = Attacks.Get(e.Attack);
        e.StateTime += dt * e.AttackSpeed * (e.Enraged ? 1.2 : 1);
        if (e.Attack == AttackKind.KnightLunge && def.IsActive(e.StateTime)) e.Vx = e.Facing * def.Lunge * e.Scale;
        else if (e.Grounded) e.Vx = Brain.MoveToward(e.Vx, 0, Tuning.Friction * dt);

        if (def.SpawnsProjectile && !e.HitThisSwing.Contains(-1) && e.StateTime >= def.Windup)
        {
            e.HitThisSwing.Add(-1);
            Projectiles.Add(new Projectile
            {
                Id = _nextId++,
                Kind = ProjectileKind.Dagger,
                X = e.X + e.Facing * 26,
                Y = e.Y + 52 * e.Scale,
                Vx = e.Facing * 540,
                Life = 1.5,
                FromPlayer = false,
                Damage = def.Damage * e.DamageScale,
                HalfWidth = 16,
                HalfHeight = 7,
            });
            Emit(EventType.Throw, e.X, e.Y + 52, 0, e.Facing);
        }

        if (e.StateTime >= def.Duration)
        {
            var finished = e.Attack;
            e.SetState(FighterState.Idle);
            switch (finished)
            {
                case AttackKind.KnightSlash:
                    e.SlashCooldown = 1.1 / Director.Aggression;
                    // Bosses chain straight into an overhead half the time.
                    if (e.IsBoss && Rng.Chance(e.Enraged ? 0.7 : 0.45))
                    {
                        e.StartAttack(AttackKind.KnightOverhead);
                        Emit(EventType.Swing, e.X, e.Y, (int)AttackKind.KnightOverhead, 1);
                        return;
                    }
                    break;
                case AttackKind.KnightOverhead:
                    e.HeavyCooldown = 2.6 / Director.Aggression;
                    break;
                case AttackKind.KnightLunge:
                    e.LungeCooldown = 3.2 / Director.Aggression;
                    break;
                case AttackKind.RogueThrow:
                    e.ThrowCooldown = 1.7 / Director.Aggression;
                    break;
            }
            if (!e.IsBoss) ReleaseToken(e);
            e.ThinkTimer = 0.15;
        }
    }

    private void SeparateEnemies()
    {
        for (var i = 0; i < Enemies.Count; i++)
        {
            var a = Enemies[i];
            if (!a.IsAlive) continue;
            for (var j = i + 1; j < Enemies.Count; j++)
            {
                var b = Enemies[j];
                if (!b.IsAlive) continue;
                var dx = b.X - a.X;
                var min = (a.HalfWidth + b.HalfWidth) * 0.8;
                if (Math.Abs(dx) < min)
                {
                    var push = (min - Math.Abs(dx)) / 2 * (dx >= 0 ? 1 : -1);
                    a.X = Math.Clamp(a.X - push, Tuning.EdgeMargin, Tuning.ArenaWidth - Tuning.EdgeMargin);
                    b.X = Math.Clamp(b.X + push, Tuning.EdgeMargin, Tuning.ArenaWidth - Tuning.EdgeMargin);
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Combat
    // ------------------------------------------------------------------

    private void ResolveMelee()
    {
        var p = Player;
        var pd = p.CurrentAttack;
        if (pd is not null && pd.Reach > 0 && pd.IsActive(p.StateTime))
        {
            var (left, right) = p.Facing > 0 ? (p.X - 12, p.X + pd.Reach) : (p.X - pd.Reach, p.X + 12);
            for (var i = 0; i < Enemies.Count; i++)
            {
                var e = Enemies[i];
                if (!e.IsAlive || e.State == FighterState.Spawn || p.HitThisSwing.Contains(e.Id)) continue;
                if (!e.Overlaps(left, right, p.Y - 10, p.Y + pd.Height)) continue;
                p.HitThisSwing.Add(e.Id);
                DamageEnemy(e, pd.Damage, pd.KnockX, pd.KnockY, pd.Stagger, pd.Hitstop, p.Facing, heavy: pd.Kind == AttackKind.Heavy);
            }
        }

        for (var i = 0; i < Enemies.Count; i++)
        {
            var e = Enemies[i];
            var ed = e.CurrentAttack;
            if (ed is null || ed.Reach <= 0 || !ed.IsActive(e.StateTime) || e.HitThisSwing.Contains(p.Id)) continue;
            var reach = ed.Reach * e.Scale;
            var (left, right) = e.Facing > 0 ? (e.X - 10, e.X + reach) : (e.X - reach, e.X + 10);
            if (!p.Overlaps(left, right, e.Y - 10, e.Y + ed.Height * e.Scale)) continue;
            e.HitThisSwing.Add(p.Id);
            DamagePlayer(ed.Damage * e.DamageScale, e.Facing, ed.KnockX, ed.KnockY, ed.Hitstop);
        }
    }

    public void DamageEnemy(Enemy e, double damage, double knockX, double knockY, double stagger, double hitstop, int dir, bool heavy = false, bool fromTrap = false)
    {
        if (!e.IsAlive) return;
        e.Hp -= damage;
        e.Flash = 0.12;
        Hitstop = Math.Max(Hitstop, hitstop);

        if (!fromTrap)
        {
            Combo++;
            BestCombo = Math.Max(BestCombo, Combo);
            ComboTimer = Tuning.ComboWindow;
            Player.Rage = Math.Min(Tuning.RageMax, Player.Rage + damage * 0.7);
            Director.OnHitLanded();
        }
        Emit(EventType.Hit, e.X, e.Y + e.Height * 0.6, Math.Round(damage), heavy ? 1 : 0);

        if (e.IsBoss && !e.Enraged && e.HpRatio < 0.5)
        {
            e.Enraged = true;
            e.Speed *= 1.25;
            Emit(EventType.BossSpawn, e.X, 0, (int)e.Kind, -1);
            Spawn(new SpawnOrder(EnemyKind.Rogue, 0, e.X < Tuning.ArenaWidth / 2 ? 1 : 0));
        }

        if (e.Hp <= 0)
        {
            e.Vx = dir * knockX * 0.8;
            e.Vy = Math.Max(knockY, 180);
            e.Grounded = false;
            e.KilledByTrap = fromTrap;
            Kill(e);
            return;
        }

        e.Poise -= stagger;
        e.PoiseRegenDelay = 1.4;
        if (e.Poise <= 0)
        {
            e.Poise = e.PoiseMax;
            e.SetState(FighterState.Stagger, Tuning.StaggerTime);
            e.Vx = dir * knockX / e.Scale;
            if (knockY > 150)
            {
                e.Vy = knockY / e.Scale;
                e.Grounded = false;
            }
            if (!e.IsBoss) ReleaseToken(e);
            Emit(EventType.Stagger, e.X, e.Y + e.Height, 0, e.Id);
        }
        else
        {
            e.Vx += dir * knockX * 0.2 / e.Scale;
        }
    }

    private void Kill(Enemy e)
    {
        e.SetState(FighterState.Dead);
        e.DeathTimer = 0;
        ReleaseToken(e);
        Kills++;
        var gained = (long)Math.Round(e.ScoreValue * Multiplier) + (e.KilledByTrap ? 150 : 0);
        Score += gained;
        Emit(EventType.EnemyDeath, e.X, e.Y + e.Height * 0.5, gained, (int)e.Kind);
        if (e.KilledByTrap) Emit(EventType.TrapKill, e.X, e.Y + e.Height, 150, (int)e.Kind);

        if (e.IsBoss)
        {
            TimeScale = 0.3;
            _slowmoTimer = 1.2;
        }

        if (Rng.Chance(Director.HealthDropChance(Player))) DropPickup(PickupKind.Health, e.X);
        else if (Rng.Chance(0.3)) DropPickup(PickupKind.Rage, e.X);
    }

    private void DropPickup(PickupKind kind, double x) =>
        Pickups.Add(new Pickup { Id = _nextId++, Kind = kind, X = x, Y = 40, Vy = 300, Life = 10 });

    public void DamagePlayer(double damage, int dir, double knockX, double knockY, double hitstop)
    {
        var p = Player;
        if (!p.IsAlive) return;
        if (p.Invuln > 0)
        {
            if (p.State == FighterState.Dash)
            {
                // Perfect dodge: slow time and reward the read.
                TimeScale = 0.35;
                _slowmoTimer = Tuning.PerfectDodgeSlowmo;
                p.Rage = Math.Min(Tuning.RageMax, p.Rage + 12);
                Emit(EventType.PerfectDodge, p.X, p.Y + 60);
            }
            return;
        }

        p.Hp = Math.Max(0, p.Hp - damage);
        p.Flash = 0.2;
        Combo = 0;
        ComboTimer = 0;
        _waveDamageTaken = true;
        Director.OnPlayerDamaged(damage);
        Hitstop = Math.Max(Hitstop, hitstop);
        p.Vx = dir * knockX * 0.7;
        if (knockY > 0)
        {
            p.Vy = knockY * 0.6;
            p.Grounded = false;
        }
        Emit(EventType.PlayerHurt, p.X, p.Y + 50, Math.Round(damage), p.Hp);

        if (p.Hp <= 0)
        {
            p.SetState(FighterState.Dead);
            p.Invuln = 99;
            StateTimer = 1.8;
            TimeScale = 0.4;
            _slowmoTimer = 1.0;
        }
        else
        {
            p.SetState(FighterState.Hurt, Tuning.HurtTime);
            p.Invuln = Tuning.InvulnTime;
        }
    }

    // ------------------------------------------------------------------
    // Projectiles, traps, pickups
    // ------------------------------------------------------------------

    private void UpdateProjectiles(double dt)
    {
        for (var i = Projectiles.Count - 1; i >= 0; i--)
        {
            var pr = Projectiles[i];
            pr.X += pr.Vx * dt;
            pr.Life -= dt;
            var remove = pr.Life <= 0 || pr.X < 0 || pr.X > Tuning.ArenaWidth;
            var left = pr.X - pr.HalfWidth;
            var right = pr.X + pr.HalfWidth;
            var bottom = pr.Y - pr.HalfHeight;
            var top = pr.Y + pr.HalfHeight;
            var dir = pr.Vx >= 0 ? 1 : -1;

            if (!remove && pr.FromPlayer)
            {
                for (var j = 0; j < Enemies.Count; j++)
                {
                    var e = Enemies[j];
                    if (!e.IsAlive || e.State == FighterState.Spawn || pr.Hit.Contains(e.Id) || !e.Overlaps(left, right, bottom, top)) continue;
                    pr.Hit.Add(e.Id);
                    DamageEnemy(e, pr.Damage, 320, 160, 60, 0.05, dir);
                    if (!pr.Pierce)
                    {
                        remove = true;
                        break;
                    }
                }
            }
            else if (!remove && Player.IsAlive && Player.Overlaps(left, right, bottom, top) && !pr.Hit.Contains(Player.Id))
            {
                pr.Hit.Add(Player.Id);
                var dodged = Player.Invuln > 0;
                DamagePlayer(pr.Damage, dir, 160, 60, 0.04);
                remove = !dodged;
            }

            if (remove) Projectiles.RemoveAt(i);
        }
    }

    private void UpdateTraps(double dt)
    {
        foreach (var t in Traps)
        {
            t.PhaseTime += dt;
            if (t.PhaseTime >= t.PhaseDuration)
            {
                t.PhaseTime = 0;
                (t.Phase, t.PhaseDuration) = t.Phase switch
                {
                    TrapPhase.Idle => (TrapPhase.Charge, 0.9),
                    TrapPhase.Charge => (TrapPhase.Rise, 0.22),
                    TrapPhase.Rise => (TrapPhase.Full, 0.6),
                    TrapPhase.Full => (TrapPhase.Retract, 0.5),
                    _ => (TrapPhase.Idle, Rng.Range(2.2, 3.8)),
                };
                if (t.Phase == TrapPhase.Charge) t.HitThisCycle.Clear();
                if (t.Phase == TrapPhase.Rise) Emit(EventType.TrapFire, t.X, 0);
            }
            if (!t.IsLethal) continue;

            var left = t.X - t.HalfWidth;
            var right = t.X + t.HalfWidth;
            if (Player.IsAlive && !t.HitThisCycle.Contains(Player.Id) && Player.Overlaps(left, right, 0, 30))
            {
                t.HitThisCycle.Add(Player.Id);
                DamagePlayer(18, Player.X < t.X ? -1 : 1, 220, 420, 0.06);
            }
            for (var i = 0; i < Enemies.Count; i++)
            {
                var e = Enemies[i];
                if (!e.IsAlive || e.State == FighterState.Spawn || t.HitThisCycle.Contains(e.Id) || !e.Overlaps(left, right, 0, 30)) continue;
                t.HitThisCycle.Add(e.Id);
                DamageEnemy(e, e.IsBoss ? 40 : 30, 220, 420, 999, 0.05, e.X < t.X ? -1 : 1, fromTrap: true);
            }
        }
    }

    /// <summary>A trap overlapping [x - halfWidth, x + halfWidth] that is dangerous within `lookahead` seconds.</summary>
    public Trap? TrapAt(double x, double halfWidth, double lookahead)
    {
        foreach (var t in Traps)
        {
            if (Math.Abs(t.X - x) < t.HalfWidth + halfWidth && t.IsDangerous(lookahead)) return t;
        }
        return null;
    }

    /// <summary>A trap dangerous within `lookahead` seconds anywhere on the path from a to b.</summary>
    public Trap? TrapBetween(double a, double b, double lookahead)
    {
        var lo = Math.Min(a, b);
        var hi = Math.Max(a, b);
        foreach (var t in Traps)
        {
            if (t.X + t.HalfWidth > lo && t.X - t.HalfWidth < hi && t.IsDangerous(lookahead)) return t;
        }
        return null;
    }

    private void UpdatePickups(double dt)
    {
        var p = Player;
        for (var i = Pickups.Count - 1; i >= 0; i--)
        {
            var pk = Pickups[i];
            pk.Life -= dt;
            pk.Vy -= Tuning.Gravity * 0.7 * dt;
            pk.Y = Math.Max(14, pk.Y + pk.Vy * dt);
            if (pk.Y <= 14) pk.Vy = 0;

            if (p.IsAlive && Math.Abs(pk.X - p.X) < 38 && pk.Y < p.Y + p.Height)
            {
                if (pk.Kind == PickupKind.Health) p.Hp = Math.Min(p.MaxHp, p.Hp + 22);
                else p.Rage = Math.Min(Tuning.RageMax, p.Rage + 30);
                Emit(EventType.Pickup, pk.X, pk.Y, (int)pk.Kind);
                Pickups.RemoveAt(i);
            }
            else if (pk.Life <= 0)
            {
                Pickups.RemoveAt(i);
            }
        }
    }
}
