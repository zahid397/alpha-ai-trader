namespace CrimsonArena.Ai;

/// <summary>
/// Per-enemy utility AI. Every "reaction time" the brain scores its options
/// (approach, attack, retreat, strafe, evade, avoid traps) from what it can
/// perceive and commits to the best one; between decisions it executes that
/// intent every tick. Attack tokens from the world stop a crowd from all
/// swinging at once, so fights stay readable and fair.
/// </summary>
public static class Brain
{
    private const double Accel = 1500;

    public static void Update(World w, Enemy e, double dt)
    {
        e.SlashCooldown -= dt;
        e.HeavyCooldown -= dt;
        e.LungeCooldown -= dt;
        e.ThrowCooldown -= dt;
        e.EvadeCooldown -= dt;
        e.ThinkTimer -= dt;

        if (e.ThinkTimer <= 0)
        {
            Think(w, e);
            var reaction = e.Kind switch
            {
                EnemyKind.Rogue => 0.24,
                EnemyKind.Boss => 0.18,
                _ => 0.3,
            };
            e.ThinkTimer = reaction / w.Director.EffectiveAggression(w.Player) * w.Rng.Range(0.8, 1.25);
        }

        Act(w, e, dt);
    }

    /// <summary>Choose an intent by scoring every option (utility AI).</summary>
    public static void Think(World w, Enemy e)
    {
        var p = w.Player;
        if (!p.IsAlive)
        {
            e.Intent = Intent.Idle;
            return;
        }

        var dx = p.X - e.X;
        var dist = Math.Abs(dx);
        var aggression = w.Director.EffectiveAggression(p);
        var threatened = p.State == FighterState.Attack && Math.Sign(e.X - p.X) == p.Facing && dist < 150;
        var noise = new Func<double>(() => w.Rng.Range(-0.08, 0.08));

        var best = Intent.Idle;
        var bestScore = 0.05;
        var bestAttack = AttackKind.None;
        void Consider(Intent intent, double score, AttackKind attack = AttackKind.None)
        {
            score += noise();
            if (score > bestScore)
            {
                bestScore = score;
                best = intent;
                bestAttack = attack;
            }
        }

        if (e.Kind == EnemyKind.Rogue)
        {
            const double min = 210;
            const double max = 360;
            if (dist < 150 && e.EvadeCooldown <= 0) Consider(Intent.Evade, 0.95);
            if (dist < min) Consider(Intent.Retreat, 0.7 + (min - dist) / min * 0.3);
            if (dist > max) Consider(Intent.Approach, 0.6 + Math.Min(0.3, (dist - max) / 600));
            if (dist is >= 150 and <= 460 && e.ThrowCooldown <= 0)
            {
                if (e.HasToken || w.TryTakeToken(e)) Consider(Intent.Attack, 0.85 * aggression, AttackKind.RogueThrow);
            }
            Consider(Intent.Strafe, 0.35);
        }
        else
        {
            var reach = Attacks.KnightSlash.Reach * e.Scale + p.HalfWidth;
            var canAttack = e.HasToken || e.IsBoss || w.TryTakeToken(e);
            if (dist > reach * 0.9) Consider(Intent.Approach, 0.55 + Math.Min(0.35, (dist - reach) / 500));
            if (canAttack)
            {
                if (dist <= reach && e.SlashCooldown <= 0) Consider(Intent.Attack, 0.9 * aggression, AttackKind.KnightSlash);
                if (dist <= reach + 8 && e.HeavyCooldown <= 0 && (p.State is FighterState.Hurt or FighterState.Attack || w.Rng.Chance(0.3)))
                    Consider(Intent.Attack, 0.8 * aggression, AttackKind.KnightOverhead);
                // Never lunge across a trap that could be armed by the time we land.
                if (dist is > 150 and < 250 && e.LungeCooldown <= 0 && w.TrapBetween(e.X, p.X, 1.2) is null)
                    Consider(Intent.Attack, 0.78 * aggression, AttackKind.KnightLunge);
            }
            else if (dist < 280)
            {
                // No token: hold a menacing distance and wait for a turn.
                Consider(Intent.WaitTurn, 0.72);
            }
            if (threatened && !e.IsBoss) Consider(Intent.Retreat, 0.5 + (1 - e.HpRatio) * 0.3);
            if (e.HpRatio < 0.25 && !e.IsBoss && dist < 170) Consider(Intent.Retreat, 0.62);
        }

        e.Intent = best;
        e.PendingAttack = bestAttack;
        if (best != Intent.Attack && e.HasToken && !e.IsBoss) w.ReleaseToken(e);
        if (w.Rng.Chance(0.25)) e.StrafeDir = -e.StrafeDir;
    }

    /// <summary>Execute the current intent for one tick.</summary>
    public static void Act(World w, Enemy e, double dt)
    {
        var p = w.Player;
        var dx = p.X - e.X;
        var dir = dx >= 0 ? 1 : -1;
        var dist = Math.Abs(dx);
        var target = 0.0;

        switch (e.Intent)
        {
            case Intent.Approach:
                target = dir * e.Speed * (dist > 420 ? 1.35 : 1);
                break;
            case Intent.Retreat:
                target = -dir * e.Speed * 0.85;
                break;
            case Intent.Strafe:
                target = e.StrafeDir * e.Speed * 0.35;
                break;
            case Intent.WaitTurn:
                var hold = 200.0;
                target = dist < hold - 25 ? -dir * e.Speed * 0.6 : dist > hold + 40 ? dir * e.Speed * 0.6 : e.StrafeDir * e.Speed * 0.2;
                break;
            case Intent.Evade:
                if (e.Grounded)
                {
                    e.Vx = -dir * 430;
                    e.Vy = 380;
                    e.Grounded = false;
                    e.EvadeCooldown = 2.2;
                    w.Emit(EventType.Dash, e.X, e.Y, 0, (int)e.Kind);
                }
                e.Intent = Intent.Retreat;
                break;
            case Intent.Attack when e.PendingAttack == AttackKind.None:
                // The swing already happened; wait for the next decision.
                e.Intent = Intent.Idle;
                break;
            case Intent.Attack:
                var def = Attacks.Get(e.PendingAttack);
                var inRange = e.PendingAttack switch
                {
                    AttackKind.RogueThrow => dist <= 480,
                    AttackKind.KnightLunge => dist <= 260,
                    _ => dist <= def.Reach * e.Scale + p.HalfWidth + 6,
                };
                if (inRange && e.Grounded)
                {
                    e.Facing = dir;
                    e.Vx = 0;
                    e.StartAttack(e.PendingAttack);
                    w.Emit(EventType.Swing, e.X, e.Y, (int)e.PendingAttack, 1);
                    e.PendingAttack = AttackKind.None;
                    e.Intent = Intent.Idle;
                    return;
                }
                target = dir * e.Speed;
                break;
        }

        // Trap awareness: never walk into a trap that is (about to be) armed.
        var standingIn = w.TrapAt(e.X, e.HalfWidth, 0.5);
        if (standingIn is not null)
        {
            target = (e.X < standingIn.X ? -1 : 1) * e.Speed * 1.2;
            e.Intent = Intent.AvoidTrap;
        }
        else if (target != 0 && w.TrapAt(e.X + Math.Sign(target) * (e.HalfWidth + 30), e.HalfWidth, 0.7) is not null)
        {
            target = 0;
            e.Intent = Intent.AvoidTrap;
        }

        if (e.Grounded)
        {
            e.Vx = MoveToward(e.Vx, target, Accel * dt);
            e.Facing = e.Intent == Intent.Retreat && e.Kind == EnemyKind.Rogue ? -dir : dir;
        }
        e.State = Math.Abs(e.Vx) > 12 && e.Grounded ? FighterState.Walk : e.Grounded ? FighterState.Idle : FighterState.Fall;
    }

    public static double MoveToward(double value, double target, double maxDelta) =>
        Math.Abs(target - value) <= maxDelta ? target : value + Math.Sign(target - value) * maxDelta;
}
