import 'dart:convert';

/// The message protocol between the web game and this app. It mirrors
/// `public/game/js/bridge.js`:
///
///   game -> app : `CrimsonBridge.postMessage(JSON)` (a webview_flutter JavaScriptChannel)
///   app  -> game: `window.CrimsonNative.receive({type, ...})` (runJavaScript)
abstract final class Bridge {
  /// Name of the JavaScriptChannel the game posts to.
  static const channelName = 'CrimsonBridge';

  /// Protocol version this app speaks (the game sends its own in `ready`).
  static const protocol = 1;

  // game -> app
  static const ready = 'ready';
  static const unlockBoss = 'unlockBoss';
  static const restorePurchases = 'restorePurchases';
  static const haptic = 'haptic';
  static const gameOver = 'gameOver';

  // app -> game
  static const entitlement = 'entitlement';
  static const bossUnlocked = 'bossUnlocked';
  static const purchaseCancelled = 'purchaseCancelled';
  static const purchaseFailed = 'purchaseFailed';
  static const pause = 'pause';

  /// The JavaScript that delivers one message to the game. `jsonEncode`
  /// produces a valid JS object literal with every string escaped, so no
  /// value can break out of it.
  static String script(String type, [Map<String, Object?> data = const {}]) {
    final payload = jsonEncode(<String, Object?>{...data, 'type': type});
    return 'window.CrimsonNative && window.CrimsonNative.receive($payload);';
  }
}

/// One message from the game.
class BridgeMessage {
  const BridgeMessage(this.type, this.data);

  final String type;
  final Map<String, Object?> data;

  /// Parses a raw channel message; returns null for anything malformed.
  static BridgeMessage? tryParse(String raw) {
    if (raw.length > 16 * 1024) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, Object?>) return null;
      final type = decoded['type'];
      if (type is! String || type.isEmpty) return null;
      return BridgeMessage(type, decoded);
    } on FormatException {
      return null;
    }
  }

  String? string(String key) {
    final value = data[key];
    return value is String ? value : null;
  }

  num? number(String key) {
    final value = data[key];
    return value is num ? value : null;
  }
}

enum HapticStyle {
  light,
  medium,
  heavy;

  static HapticStyle parse(String? value) => switch (value) {
    'light' => HapticStyle.light,
    'heavy' => HapticStyle.heavy,
    _ => HapticStyle.medium,
  };
}
