import 'dart:async';

import 'boss_store.dart';
import 'bridge_protocol.dart';

/// Runs a script in the game's WebView.
typedef JsRunner = Future<void> Function(String script);

/// The app side of the bridge: reacts to the game's messages and answers
/// through [runJs]. Kept free of WebView and Flutter types so it can be
/// unit-tested with a fake store and a fake runner.
class GameSession {
  GameSession({required this.store, required this.runJs, this.onHaptic, this.onGameOver}) {
    _changes = store.changes.listen((_) {
      if (_ready) unawaited(pushEntitlement());
    });
  }

  final BossStore store;
  final JsRunner runJs;
  final void Function(HapticStyle style)? onHaptic;
  final void Function(int score, int wave)? onGameOver;

  late final StreamSubscription<bool> _changes;
  bool _ready = false;
  bool _unlocking = false;

  /// True once the game has booted and said `ready`.
  bool get isReady => _ready;

  /// True while a purchase flow is on screen.
  bool get isUnlocking => _unlocking;

  /// Entry point for every JavaScriptChannel message.
  Future<void> handle(String raw) async {
    final message = BridgeMessage.tryParse(raw);
    if (message == null) return;
    switch (message.type) {
      case Bridge.ready:
        _ready = true;
        await pushEntitlement();
      case Bridge.unlockBoss:
        await _unlockBoss();
      case Bridge.restorePurchases:
        await store.restore();
        await pushEntitlement();
      case Bridge.haptic:
        onHaptic?.call(HapticStyle.parse(message.string('style')));
      case Bridge.gameOver:
        onGameOver?.call(message.number('score')?.toInt() ?? 0, message.number('wave')?.toInt() ?? 0);
      default:
        break; // Unknown messages are ignored (newer game, older app).
    }
  }

  /// Tell the game whether the Main Boss is unlocked (and its price).
  Future<void> pushEntitlement() async {
    final status = await store.status();
    await _send(Bridge.entitlement, {
      'unlocked': status.unlocked,
      if (status.price != null) 'price': status.price,
      if (store.isDemo) 'demo': true,
    });
  }

  Future<void> _unlockBoss() async {
    if (_unlocking) return; // a second tap while the paywall is up
    _unlocking = true;
    try {
      final outcome = await store.unlockMainBoss();
      switch (outcome.result) {
        case UnlockResult.unlocked:
          // The game marks the boss unlocked and spawns him right away.
          await _send(Bridge.bossUnlocked);
        case UnlockResult.cancelled:
          await _send(Bridge.purchaseCancelled);
        case UnlockResult.failed:
          await _send(Bridge.purchaseFailed, {'message': outcome.message ?? 'Purchase failed'});
      }
    } on Object catch (e) {
      await _send(Bridge.purchaseFailed, {'message': 'Purchase failed: $e'});
    } finally {
      _unlocking = false;
    }
  }

  /// The app went to the background: pause the fight.
  Future<void> pauseGame() => _ready ? _send(Bridge.pause) : Future.value();

  /// The page reloaded (e.g. the WebView process was killed): wait for a new `ready`.
  void resetPage() => _ready = false;

  Future<void> _send(String type, [Map<String, Object?> data = const {}]) async {
    try {
      await runJs(Bridge.script(type, data));
    } on Object {
      // The page may be reloading; it will ask again with `ready`.
    }
  }

  Future<void> dispose() => _changes.cancel();
}
