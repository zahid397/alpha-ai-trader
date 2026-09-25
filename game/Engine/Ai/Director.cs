namespace CrimsonArena.Ai;

public readonly record struct SpawnOrder(EnemyKind Kind, double Delay, int Side);

/// <summary>
/// AI Director: watches how the player is doing and tunes the fight.
/// Aggression (0.7 .. 1.4) scales enemy reaction time, how many enemies may
/// attack at once and wave size; a struggling player gets breathing room and
/// more health drops, a dominant one gets a tougher fight.
/// </summary>
public sealed class Director
{
    public const double MinAggression = 0.7;
    public const double MaxAggression = 1.4;

    public double Aggression { get; private set; } = 1.0;

    private double _damageTaken;
    private double _waveTime;
    private int _hitsLanded;

    public string Mood => Aggression < 0.9 ? "calm" : Aggression > 1.15 ? "ruthless" : "balanced";

    public void OnWaveStart()
    {
        _damageTaken = 0;
        _waveTime = 0;
        _hitsLanded = 0;
    }

    public void Tick(double dt) => _waveTime += dt;

    public void OnPlayerDamaged(double amount) => _damageTaken += amount;

    public void OnHitLanded() => _hitsLanded++;

    /// <summary>Score the finished wave 0..1 and nudge aggression toward it.</summary>
    public double OnWaveCleared(Player player, int enemiesInWave)
    {
        var health = player.HpRatio;
        var untouched = 1 - Math.Clamp(_damageTaken / player.MaxHp, 0, 1);
        var expectedTime = 8 + enemiesInWave * 6.0;
        var speed = Math.Clamp(expectedTime / Math.Max(1, _waveTime), 0, 1.5) / 1.5;
        var accuracy = Math.Clamp(_hitsLanded / Math.Max(1.0, enemiesInWave * 6.0), 0, 1);
        var performance = 0.35 * health + 0.3 * untouched + 0.2 * speed + 0.15 * accuracy;
        Aggression = Math.Clamp(Aggression + (performance - 0.55) * 0.35, MinAggression, MaxAggression);
        return performance;
    }

    /// <summary>Live mercy: when the player is nearly dead, enemies hesitate.</summary>
    public double EffectiveAggression(Player player) =>
        player.HpRatio < 0.3 ? Math.Max(MinAggression, Aggression * 0.82) : Aggression;

    public int TokenCapacity(int wave) => Math.Clamp(1 + wave / 3 + (Aggression > 1.15 ? 1 : 0), 1, 4);

    public double HealthDropChance(Player player) => Math.Clamp(0.1 + (1 - player.HpRatio) * 0.4 + (1 - Aggression) * 0.2, 0.05, 0.6);

    public int MaxAlive(int wave) => Math.Min(4 + wave / 3, 8);

    /// <summary>Wave composition: bosses every 5th wave, more and deadlier foes over time.</summary>
    public List<SpawnOrder> ComposeWave(int wave, Rng rng)
    {
        var orders = new List<SpawnOrder>();
        var delay = 0.6;
        var side = rng.Chance(0.5) ? 0 : 1;
        void Add(EnemyKind kind, double gap)
        {
            orders.Add(new SpawnOrder(kind, delay, side));
            side = 1 - side;
            delay += gap * rng.Range(0.8, 1.2) / Aggression;
        }

        if (wave % 5 == 0)
        {
            Add(EnemyKind.Boss, 2.0);
            for (var i = 0; i < wave / 5; i++) Add(EnemyKind.Rogue, 4.0);
            return orders;
        }

        var knights = 1 + (wave + 1) / 2 + (Aggression > 1.15 ? 1 : 0);
        var rogues = wave >= 2 ? wave / 2 : 0;
        var total = Math.Min(knights + rogues, 10);
        for (var i = 0; i < total; i++)
        {
            var kind = rogues > 0 && (knights == 0 || rng.Chance(rogues / (double)(knights + rogues))) ? EnemyKind.Rogue : EnemyKind.Knight;
            if (kind == EnemyKind.Rogue) rogues--; else knights--;
            Add(kind, 1.3);
        }
        return orders;
    }
}
