# Crimson Arena: mobile app (Flutter)

A standalone Android / iOS app for the Crimson Arena game. Everything the game needs ships inside the app: the HTML, JS, CSS, sprites, fonts and the C# engine compiled to WebAssembly. It runs **100% offline**: no Vercel, no server, no CDN. The **Main Boss** (the Crimson Warlord) is unlocked with an in-app purchase through **RevenueCat**.

```
┌──────────────────────── Flutter app ─────────────────────────┐
│  assets/game/  (the web game, bundled)                         │
│      │ rootBundle                                              │
│  LocalGameServer  http://127.0.0.1:47631  (loopback only)     │
│      │                                                         │
│  WebView ── game ──► CrimsonBridge.postMessage('unlockBoss')   │
│      ▲                        │ JavaScriptChannel              │
│      │                  GameSession ──► BossStore              │
│      │                        │         ├ RevenueCatBossStore  │
│      │                        │         │   (paywall/purchase) │
│      │                        │         └ DemoBossStore        │
│      └── runJavaScript: CrimsonNative.receive({bossUnlocked}) │
│          → the game spawns the Main Boss                       │
└──────────────────────────────────────────────────────────────┘
```

## Quick start (no store accounts needed)

Requirements: Flutter 3.47+ (Dart 3.13). For Android: Android Studio and a device or emulator on Android 7.0+. For iOS: Xcode 16+ and a device or simulator on iOS 16.4+.

```bash
cd mobile
flutter pub get
flutter run            # pick your device
```

With no RevenueCat key, the app uses the **demo store**. Tapping *Unlock Main Boss* opens a demo purchase sheet (nothing is charged), then the boss spawns. That is enough to demo the whole flow at a hackathon.

## How the game is loaded offline

The game is copied into `assets/game/` and listed in `pubspec.yaml`, so Flutter packs it into the APK/IPA. After changing the game, re-sync it from the repo root:

```bash
npm run game:build      # only if you changed the C# engine (needs the .NET 10 SDK)
npm run mobile:assets   # copies public/game -> mobile/assets/game and updates pubspec.yaml
```

**Why not `file://`?** A WebView treats `file://` pages as an opaque origin. It won't allow `fetch()` for `file:` URLs, blocks ES modules (CORS), and can't stream WebAssembly. The .NET WebAssembly runtime needs all three, so a plain `loadFlutterAsset()` shows a blank screen.

Instead, `lib/src/local_game_server.dart` serves the bundled assets over HTTP on the **loopback interface only** (`127.0.0.1`). The bytes come straight from the app bundle (`rootBundle`), and nothing leaves the device or is downloaded. Details:

- **Not reachable from the network:** it binds to 127.0.0.1 only, and serves GET/HEAD for files under `assets/game/`. Path traversal and hidden files are refused.
- **Correct MIME types:** it sends `application/wasm` for the .NET runtime.
- **Stable origin:** a fixed port (47631) keeps the page origin, and so the saved high score, the same across launches. If another app holds the port, it falls back to any free port.
- **Locked navigation:** the WebView may only load pages from that local origin, so no outside page can reach the purchase bridge.
- **Lifecycle recovery:** iOS can reclaim sockets while the app is suspended. On resume the server is revived and the page reloaded if needed. A killed WebView process is reloaded too.

Android needs `INTERNET` (even for loopback) and a network-security rule allowing cleartext **only** to `127.0.0.1`/`localhost` (`android/app/src/main/res/xml/network_security_config.xml`). iOS gets `NSAllowsLocalNetworking` in `Info.plist`. Internet traffic, such as RevenueCat and the stores, stays HTTPS-only.

## The JavaScript bridge

| Direction | How | Messages |
| --- | --- | --- |
| game → app | JavaScriptChannel `CrimsonBridge`: `CrimsonBridge.postMessage(JSON)` | `ready`, `unlockBoss`, `restorePurchases`, `haptic {style}`, `gameOver {score, wave, kills}` |
| app → game | `controller.runJavaScript("window.CrimsonNative.receive({...})")` | `entitlement {unlocked, price, demo}`, `bossUnlocked`, `purchaseCancelled`, `purchaseFailed {message}`, `pause` |

Flow for **Unlock Main Boss**:

1. The player taps *Unlock Main Boss* (title screen, pause menu or the in-game crown button). The game pauses and sends `unlockBoss`.
2. `GameSession` (`lib/src/game_session.dart`) asks the `BossStore` to unlock. `RevenueCatBossStore` shows **RevenueCat's paywall** (`RevenueCatUI.presentPaywallIfNeeded('main_boss')`). If no paywall is configured, it falls back to buying the offering's package directly (`Purchases.purchase(PurchaseParams.package(...))`).
3. On success Flutter sends `bossUnlocked`, and the game resumes and **spawns the Main Boss** through the C# engine (`SummonBoss()`). Cancel and error are reported back and shown as a toast.
4. On launch, `ready` → `entitlement` tells the game whether the boss is already owned and shows the store price. After that the button reads *Summon Main Boss* and never charges again. A second tap while the paywall is open is ignored.

Every value sent to the page goes through `jsonEncode`, so no text can break out of the script. Malformed or unknown messages are ignored.

## RevenueCat setup

1. **Store products:** create a one-time purchase called `crimson_main_boss`.
   - *App Store Connect:* a non-consumable in-app purchase for bundle id `com.crimsonarena.crimsonArena`. In Xcode, add the **In-App Purchase** capability to the Runner target.
   - *Google Play Console:* an in-app product for package `com.crimsonarena.crimson_arena`. Play Billing only works after the app is uploaded to a testing track (internal testing is enough). Add yourself as a license tester.
2. **RevenueCat dashboard:**
   - Create a project with an iOS app and an Android app, then import both products.
   - Create the entitlement **`main_boss`** and attach both products to it.
   - Make an offering (for example `default`) the current offering, with one package containing the product.
   - Design a **paywall** for that offering.
3. **Run with your public SDK keys.** They are passed at build time, never committed:

```bash
flutter run \
  --dart-define=RC_GOOGLE_API_KEY=goog_xxxxxxxx \
  --dart-define=RC_APPLE_API_KEY=appl_xxxxxxxx
# optional: --dart-define=RC_ENTITLEMENT=main_boss --dart-define=RC_OFFERING=default
# optional: --dart-define=DEMO_STORE=true  (force the demo store)
```

4. **Release builds:**

```bash
flutter build appbundle --dart-define=RC_GOOGLE_API_KEY=goog_xxxxxxxx
flutter build ipa       --dart-define=RC_APPLE_API_KEY=appl_xxxxxxxx
```

Before publishing, set your own application id / bundle id and Android release signing (`android/app/build.gradle.kts`). A build without a key for its platform uses the demo store, which gives the boss away for free, so always pass the keys for store builds.

What was changed from the `flutter create` template, and why:

- `MainActivity` extends **`FlutterFragmentActivity`**, because RevenueCat paywalls are Fragments.
- Android `minSdk = 24` (paywalls). Landscape only (`sensorLandscape`).
- iOS deployment target **16.4**: the .NET WebAssembly runtime needs WASM SIMD (Safari 16.4). Paywalls need iOS 15.
- Landscape only on iOS too, with the status bar hidden.

Rewarded ads are not part of RevenueCat. To unlock the boss by watching an ad instead, implement `BossStore` with an ad SDK (for example `google_mobile_ads`). The game and the bridge stay the same.

## Tests

```bash
flutter analyze
flutter test
```

- **Loopback server:** loopback-only binding, MIME types (including `application/wasm`), HEAD, 404/405, path traversal, port fallback, restart after the socket dies.
- **Purchase flow** (`GameSession` with a fake store): ready → entitlement, purchase / cancel / error / exception, double taps, restore, entitlement changes, pause, malformed messages, injection-safe scripts.
- **Bundled game:** complete, declared in `pubspec.yaml`, byte-identical to `public/game`, no network URLs, and served byte for byte by the loopback server.
- **Bridge contract:** every message type the Dart side handles exists in the bundled JavaScript, and the other way round.
- **Demo paywall:** widget tests.

To open the exact bundled build in a desktop browser through the same server: `dart run tool/serve_game.dart`, then visit the printed URL. Debug builds also enable `chrome://inspect` (Android) and the Safari Web Inspector (iOS) for the WebView.

## Troubleshooting

- **Blank or black screen:** the assets are missing or stale. Run `npm run mobile:assets`; `flutter test` also catches this.
- **"doesn't support WASM SIMD" on iOS:** the device is older than iOS 16.4.
- **"Paywalls require your activity to subclass FlutterFragmentActivity":** `MainActivity` was reverted to `FlutterActivity`.
- **Purchase fails with "not for sale yet":** there is no current offering, or the package is empty in RevenueCat.
- **Purchase works but the boss stays locked:** the product is not attached to the `main_boss` entitlement.
