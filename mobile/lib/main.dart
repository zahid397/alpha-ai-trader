import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'src/boss_store.dart';
import 'src/config.dart';
import 'src/demo_paywall.dart';
import 'src/game_screen.dart';
import 'src/revenuecat_boss_store.dart';

final _navigatorKey = GlobalKey<NavigatorState>();

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await SystemChrome.setPreferredOrientations([DeviceOrientation.landscapeLeft, DeviceOrientation.landscapeRight]);
  await SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  final store = await createBossStore();
  runApp(CrimsonArenaApp(store: store));
}

/// RevenueCat when an API key is configured for this platform, otherwise
/// the offline demo store.
Future<BossStore> createBossStore() async {
  final apiKey = AppConfig.revenueCatApiKey;
  if (AppConfig.forceDemoStore || apiKey.isEmpty) {
    debugPrint('Crimson Arena: no RevenueCat key for this platform, using the demo store.');
    final demo = DemoBossStore(confirm: () async {
      final context = _navigatorKey.currentContext;
      return context != null && context.mounted && await showDemoPaywall(context);
    });
    await demo.init();
    return demo;
  }
  final store = RevenueCatBossStore(
    apiKey: apiKey,
    entitlementId: AppConfig.entitlementId,
    offeringId: AppConfig.offeringId.isEmpty ? null : AppConfig.offeringId,
  );
  try {
    await store.init();
  } on Object catch (e) {
    // The game still runs; unlock attempts report the store error in-game.
    debugPrint('Crimson Arena: RevenueCat setup failed: $e');
  }
  return store;
}

class CrimsonArenaApp extends StatelessWidget {
  const CrimsonArenaApp({super.key, required this.store});

  final BossStore store;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Crimson Arena',
      navigatorKey: _navigatorKey,
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        brightness: Brightness.dark,
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFFE34948), brightness: Brightness.dark),
        scaffoldBackgroundColor: const Color(0xFF07050B),
      ),
      home: GameScreen(store: store),
    );
  }
}
