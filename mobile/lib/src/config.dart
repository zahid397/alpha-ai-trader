import 'dart:io' show Platform;

/// Build-time settings, passed with `--dart-define` (never hard-code keys):
///
///   flutter run --dart-define=RC_GOOGLE_API_KEY=goog_xxx --dart-define=RC_APPLE_API_KEY=appl_xxx
///
/// With no key for the current platform the app uses the offline demo store.
abstract final class AppConfig {
  /// RevenueCat public SDK key for Google Play (starts with `goog_`).
  static const googleApiKey = String.fromEnvironment('RC_GOOGLE_API_KEY');

  /// RevenueCat public SDK key for the App Store (starts with `appl_`).
  static const appleApiKey = String.fromEnvironment('RC_APPLE_API_KEY');

  /// Entitlement that unlocks the Main Boss.
  static const entitlementId = String.fromEnvironment('RC_ENTITLEMENT', defaultValue: 'main_boss');

  /// Offering to sell from; empty uses the dashboard's current offering.
  static const offeringId = String.fromEnvironment('RC_OFFERING');

  /// `--dart-define=DEMO_STORE=true` forces the demo store even with keys.
  static const forceDemoStore = bool.fromEnvironment('DEMO_STORE');

  static String get revenueCatApiKey {
    if (Platform.isIOS || Platform.isMacOS) return appleApiKey;
    if (Platform.isAndroid) return googleApiKey;
    return '';
  }
}
