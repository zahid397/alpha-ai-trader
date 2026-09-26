import 'dart:io';

import 'package:crimson_arena/src/bridge_protocol.dart';
import 'package:flutter_test/flutter_test.dart';

/// The game (JavaScript, bundled in assets/game) and this app (Dart) must
/// agree on the channel name and every message type. Read the bundled JS and
/// check both directions.
void main() {
  final bridgeJs = File('assets/game/js/bridge.js').readAsStringSync();
  final mainJs = File('assets/game/js/main.js').readAsStringSync();

  test('the game posts to the channel this app registers', () {
    expect(bridgeJs, contains('globalThis.${Bridge.channelName}?.postMessage'));
    expect(bridgeJs, contains('export const PROTOCOL = ${Bridge.protocol};'));
    expect(bridgeJs, contains("'CrimsonNative'"));
  });

  test('every message the app handles is one the game sends', () {
    for (final type in [Bridge.ready, Bridge.unlockBoss, Bridge.haptic, Bridge.gameOver]) {
      expect(mainJs, contains("bridge.send('$type'"), reason: type);
    }
  });

  test('every message the app sends is one the game listens for', () {
    for (final type in [Bridge.entitlement, Bridge.bossUnlocked, Bridge.purchaseCancelled, Bridge.purchaseFailed, Bridge.pause]) {
      expect(mainJs, contains("bridge.on('$type'"), reason: type);
    }
  });
}
