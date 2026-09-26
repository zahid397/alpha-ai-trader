import 'dart:async';

/// What the store knows about the Main Boss for this player.
class BossStatus {
  const BossStatus({required this.unlocked, this.price});

  final bool unlocked;

  /// Localised price from the store (e.g. `$1.99`), when known.
  final String? price;
}

enum UnlockResult { unlocked, cancelled, failed }

class UnlockOutcome {
  const UnlockOutcome._(this.result, [this.message]);

  const UnlockOutcome.unlocked() : this._(UnlockResult.unlocked);
  const UnlockOutcome.cancelled() : this._(UnlockResult.cancelled);
  const UnlockOutcome.failed(String message) : this._(UnlockResult.failed, message);

  final UnlockResult result;
  final String? message;
}

/// Sells (or grants) the Main Boss. The game only ever talks to this
/// interface, so RevenueCat, a demo store or a rewarded-ad unlock are
/// interchangeable.
abstract class BossStore {
  /// True for the offline demo store (no real purchase).
  bool get isDemo;

  Future<void> init();

  Future<BossStatus> status();

  /// Show the paywall (or purchase flow) and report what happened.
  Future<UnlockOutcome> unlockMainBoss();

  /// Restore earlier purchases; returns whether the boss is now unlocked.
  Future<bool> restore();

  /// Emits when the entitlement changes outside a purchase (restore on
  /// another device, refund, family sharing...).
  Stream<bool> get changes;
}

/// Used when no RevenueCat API key is configured (hackathon demos, CI): the
/// app still runs end to end. [confirm] shows the app's own demo purchase
/// sheet. Nothing is charged and the unlock lasts for the session.
class DemoBossStore implements BossStore {
  DemoBossStore({required this.confirm, this.price = r'$1.99'});

  final Future<bool> Function() confirm;
  final String price;
  final _changes = StreamController<bool>.broadcast();
  bool _unlocked = false;

  @override
  bool get isDemo => true;

  @override
  Future<void> init() async {}

  @override
  Future<BossStatus> status() async => BossStatus(unlocked: _unlocked, price: _unlocked ? null : price);

  @override
  Future<UnlockOutcome> unlockMainBoss() async {
    if (_unlocked) return const UnlockOutcome.unlocked();
    if (!await confirm()) return const UnlockOutcome.cancelled();
    _unlocked = true;
    _changes.add(true);
    return const UnlockOutcome.unlocked();
  }

  @override
  Future<bool> restore() async => _unlocked;

  @override
  Stream<bool> get changes => _changes.stream;
}
