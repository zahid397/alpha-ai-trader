import 'dart:async';
import 'dart:convert';

import 'package:crimson_arena/src/boss_store.dart';
import 'package:crimson_arena/src/bridge_protocol.dart';
import 'package:crimson_arena/src/game_session.dart';
import 'package:flutter_test/flutter_test.dart';

/// A store whose answers the test controls.
class FakeStore implements BossStore {
  bool unlocked = false;
  String? price = r'$1.99';
  UnlockOutcome next = const UnlockOutcome.unlocked();
  Completer<void>? gate;
  int unlockCalls = 0;
  int restoreCalls = 0;
  final changeController = StreamController<bool>.broadcast();

  @override
  bool isDemo = false;

  @override
  Future<void> init() async {}

  @override
  Future<BossStatus> status() async => BossStatus(unlocked: unlocked, price: unlocked ? null : price);

  @override
  Future<UnlockOutcome> unlockMainBoss() async {
    unlockCalls++;
    await gate?.future;
    if (next.result == UnlockResult.unlocked) unlocked = true;
    return next;
  }

  @override
  Future<bool> restore() async {
    restoreCalls++;
    return unlocked;
  }

  @override
  Stream<bool> get changes => changeController.stream;
}

/// Decodes the `window.CrimsonNative.receive({...})` scripts sent to the page.
Map<String, Object?> decode(String script) {
  final start = script.indexOf('receive(') + 'receive('.length;
  final end = script.lastIndexOf(');');
  return jsonDecode(script.substring(start, end)) as Map<String, Object?>;
}

void main() {
  late FakeStore store;
  late List<Map<String, Object?>> sent;
  late List<HapticStyle> haptics;
  late GameSession session;

  setUp(() {
    store = FakeStore();
    sent = [];
    haptics = [];
    session = GameSession(
      store: store,
      runJs: (script) async => sent.add(decode(script)),
      onHaptic: haptics.add,
    );
  });

  String msg(String type, [Map<String, Object?> data = const {}]) => jsonEncode({...data, 'type': type});

  test('answers ready with the entitlement and price', () async {
    await session.handle(msg('ready', {'protocol': 1}));
    expect(session.isReady, isTrue);
    expect(sent, [
      {'unlocked': false, 'price': r'$1.99', 'type': 'entitlement'},
    ]);
  });

  test('demo stores say so', () async {
    store.isDemo = true;
    await session.handle(msg('ready'));
    expect(sent.single['demo'], isTrue);
  });

  test('a successful purchase tells the game to spawn the boss', () async {
    await session.handle(msg('unlockBoss'));
    expect(store.unlockCalls, 1);
    expect(sent.single['type'], 'bossUnlocked');
  });

  test('a cancelled paywall reports purchaseCancelled', () async {
    store.next = const UnlockOutcome.cancelled();
    await session.handle(msg('unlockBoss'));
    expect(sent.single['type'], 'purchaseCancelled');
    expect(store.unlocked, isFalse);
  });

  test('a store error reports purchaseFailed with the reason', () async {
    store.next = const UnlockOutcome.failed('No offering');
    await session.handle(msg('unlockBoss'));
    expect(sent.single, {'message': 'No offering', 'type': 'purchaseFailed'});
  });

  test('an exception from the store never escapes', () async {
    final failing = GameSession(store: _ThrowingStore(), runJs: (s) async => sent.add(decode(s)));
    await failing.handle(msg('unlockBoss'));
    expect(sent.single['type'], 'purchaseFailed');
  });

  test('ignores a second tap while the paywall is open', () async {
    store.gate = Completer<void>();
    final first = session.handle(msg('unlockBoss'));
    await Future<void>.delayed(Duration.zero);
    expect(session.isUnlocking, isTrue);
    await session.handle(msg('unlockBoss'));
    store.gate!.complete();
    await first;
    expect(store.unlockCalls, 1);
    expect(sent.map((m) => m['type']), ['bossUnlocked']);
    expect(session.isUnlocking, isFalse);
  });

  test('restore re-sends the entitlement', () async {
    store.unlocked = true;
    await session.handle(msg('restorePurchases'));
    expect(store.restoreCalls, 1);
    expect(sent.single, {'unlocked': true, 'type': 'entitlement'});
  });

  test('entitlement changes from the store reach a ready game', () async {
    store.changeController.add(true); // before ready: dropped
    await Future<void>.delayed(Duration.zero);
    expect(sent, isEmpty);
    await session.handle(msg('ready'));
    store.unlocked = true;
    store.changeController.add(true);
    await Future<void>.delayed(Duration.zero);
    expect(sent.last, {'unlocked': true, 'type': 'entitlement'});
  });

  test('haptics, pause and page resets', () async {
    await session.handle(msg('haptic', {'style': 'heavy'}));
    await session.handle(msg('haptic', {'style': 'bogus'}));
    expect(haptics, [HapticStyle.heavy, HapticStyle.medium]);

    await session.pauseGame(); // not ready yet: nothing sent
    expect(sent, isEmpty);
    await session.handle(msg('ready'));
    await session.pauseGame();
    expect(sent.last['type'], 'pause');
    session.resetPage();
    expect(session.isReady, isFalse);
  });

  test('malformed and unknown messages are ignored', () async {
    for (final raw in ['', 'nope', '[]', '{"type":1}', '{"notype":true}', msg('fromTheFuture'), 'x' * 20000]) {
      await session.handle(raw);
    }
    expect(sent, isEmpty);
    expect(store.unlockCalls, 0);
  });

  test('a failing WebView call does not throw', () async {
    final broken = GameSession(store: store, runJs: (_) async => throw StateError('page gone'));
    await broken.handle(msg('ready'));
    await broken.handle(msg('unlockBoss'));
  });

  test('gameOver is forwarded', () async {
    int? score;
    final s = GameSession(store: store, runJs: (_) async {}, onGameOver: (sc, w) => score = sc);
    await s.handle(msg('gameOver', {'score': 4200, 'wave': 3}));
    expect(score, 4200);
  });

  test('outgoing scripts are injection-safe', () {
    final script = Bridge.script('purchaseFailed', {'message': "');alert(1);//</script> "});
    expect(script, startsWith('window.CrimsonNative && window.CrimsonNative.receive({'));
    expect(decode(script)['message'], "');alert(1);//</script> ");
    // The hostile text round-trips as data: it only ever sits inside a JSON string.
    expect(script, endsWith('"type":"purchaseFailed"});'));
  });
}

class _ThrowingStore extends FakeStore {
  @override
  Future<UnlockOutcome> unlockMainBoss() async => throw StateError('billing unavailable');
}
