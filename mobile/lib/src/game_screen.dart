import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import 'boss_store.dart';
import 'bridge_protocol.dart';
import 'game_session.dart';
import 'local_game_server.dart';

const _background = Color(0xFF07050B);

/// Full-screen WebView running the bundled Crimson Arena build, offline.
class GameScreen extends StatefulWidget {
  const GameScreen({super.key, required this.store});

  final BossStore store;

  @override
  State<GameScreen> createState() => _GameScreenState();
}

class _GameScreenState extends State<GameScreen> with WidgetsBindingObserver {
  final _server = LocalGameServer(load: loadBundledAsset);
  late final WebViewController _controller;
  late final GameSession _session;
  bool _loading = true;
  String? _error;
  DateTime? _lastBack;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _controller = _createController();
    _session = GameSession(store: widget.store, runJs: _controller.runJavaScript, onHaptic: _haptic);
    unawaited(_boot());
  }

  WebViewController _createController() {
    var params = const PlatformWebViewControllerCreationParams();
    if (WebViewPlatform.instance is WebKitWebViewPlatform) {
      // Let the game's WebAudio play without an extra gesture, inline.
      params = WebKitWebViewControllerCreationParams(
        allowsInlineMediaPlayback: true,
        mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
      );
    }
    return WebViewController.fromPlatformCreationParams(params);
  }

  /// Every setting (and the JavaScriptChannel) must be in place before the
  /// first page loads, so each call is awaited.
  Future<void> _configure() async {
    final controller = _controller;
    await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    await controller.setBackgroundColor(_background);
    await controller.enableZoom(false);
    await controller.setVerticalScrollBarEnabled(false);
    await controller.setHorizontalScrollBarEnabled(false);
    // game -> app messages: CrimsonBridge.postMessage(JSON)
    await controller.addJavaScriptChannel(Bridge.channelName, onMessageReceived: (message) => _session.handle(message.message));
    await controller.setNavigationDelegate(
      NavigationDelegate(
        onNavigationRequest: _onNavigationRequest,
        onPageStarted: (_) => _session.resetPage(),
        onPageFinished: (_) {
          if (mounted) setState(() => _loading = false);
        },
        onWebResourceError: _onWebResourceError,
      ),
    );

    final platform = controller.platform;
    if (platform is AndroidWebViewController) {
      await AndroidWebViewController.enableDebugging(kDebugMode); // chrome://inspect in debug builds
      await platform.setMediaPlaybackRequiresUserGesture(false);
    } else if (platform is WebKitWebViewController) {
      await platform.setInspectable(kDebugMode); // Safari > Develop in debug builds
    }
  }

  Future<void> _boot() async {
    try {
      await _configure();
      final origin = await _server.start();
      await _controller.loadRequest(origin.replace(path: '/index.html'));
    } on Object catch (e) {
      if (mounted) setState(() => _error = 'Could not start the game: $e');
    }
  }

  /// Only our own bundled pages may load; everything else is blocked, so no
  /// outside page can ever reach the purchase bridge.
  NavigationDecision _onNavigationRequest(NavigationRequest request) {
    final uri = Uri.tryParse(request.url);
    if (uri == null) return NavigationDecision.prevent;
    if (uri.scheme == 'about') return NavigationDecision.navigate;
    final local = _server.isRunning && uri.scheme == 'http' && uri.host == '127.0.0.1' && uri.port == _server.origin.port;
    return local ? NavigationDecision.navigate : NavigationDecision.prevent;
  }

  void _onWebResourceError(WebResourceError error) {
    if (error.errorType == WebResourceErrorType.webContentProcessTerminated) {
      // iOS killed the page's process (memory pressure): start it again.
      unawaited(_reload());
      return;
    }
    if (error.isForMainFrame ?? false) {
      if (mounted) setState(() => _error = error.description);
    }
  }

  Future<void> _reload() async {
    _session.resetPage();
    final origin = await _server.ensureRunning();
    await _controller.loadRequest(origin.replace(path: '/index.html'));
  }

  Future<void> _retry() async {
    setState(() {
      _error = null;
      _loading = true;
    });
    await _reload();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    switch (state) {
      case AppLifecycleState.paused:
      case AppLifecycleState.hidden:
        // Keep the fight paused while the store sheet is up too.
        unawaited(_session.pauseGame());
      case AppLifecycleState.resumed:
        unawaited(_onResume());
      case AppLifecycleState.inactive:
      case AppLifecycleState.detached:
        break;
    }
  }

  Future<void> _onResume() async {
    final before = _server.isRunning ? _server.origin : null;
    final origin = await _server.ensureRunning();
    if (origin != before || !await _pageAlive()) {
      _session.resetPage();
      await _controller.loadRequest(origin.replace(path: '/index.html'));
    }
  }

  Future<bool> _pageAlive() async {
    try {
      final result = await _controller.runJavaScriptReturningResult('typeof window.crimsonArena');
      return result.toString().contains('object');
    } on Object {
      return false;
    }
  }

  void _haptic(HapticStyle style) {
    switch (style) {
      case HapticStyle.light:
        HapticFeedback.lightImpact();
      case HapticStyle.medium:
        HapticFeedback.mediumImpact();
      case HapticStyle.heavy:
        HapticFeedback.heavyImpact();
    }
  }

  /// Android back: first press pauses the fight, a second one within 2 s exits.
  void _onBack(bool didPop, Object? result) {
    if (didPop) return;
    final now = DateTime.now();
    if (_lastBack != null && now.difference(_lastBack!) < const Duration(seconds: 2)) {
      SystemNavigator.pop();
      return;
    }
    _lastBack = now;
    unawaited(_session.pauseGame());
    ScaffoldMessenger.of(context)
      ..hideCurrentSnackBar()
      ..showSnackBar(const SnackBar(content: Text('Press back again to leave the arena'), duration: Duration(seconds: 2)));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_session.dispose());
    unawaited(_server.stop());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: _onBack,
      child: Scaffold(
        backgroundColor: _background,
        body: Stack(
          children: [
            // Keep the arena clear of notches and camera cut-outs.
            Positioned.fill(
              child: SafeArea(top: false, bottom: false, child: WebViewWidget(controller: _controller)),
            ),
            if (_loading && _error == null) const _Splash(),
            if (_error != null) _ErrorPanel(message: _error!, onRetry: _retry),
          ],
        ),
      ),
    );
  }
}

/// Reads one asset bundled with the app (see `flutter: assets:` in pubspec.yaml).
Future<Uint8List?> loadBundledAsset(String key) async {
  try {
    final data = await rootBundle.load(key);
    return data.buffer.asUint8List(data.offsetInBytes, data.lengthInBytes);
  } on Object {
    return null;
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) {
    return const ColoredBox(
      color: _background,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              'CRIMSON ARENA',
              style: TextStyle(color: Color(0xFFFFC2C5), fontSize: 28, fontWeight: FontWeight.w900, letterSpacing: 4),
            ),
            SizedBox(height: 18),
            SizedBox(width: 160, child: LinearProgressIndicator(color: Color(0xFFE34948), backgroundColor: Color(0x22FFFFFF))),
          ],
        ),
      ),
    );
  }
}

class _ErrorPanel extends StatelessWidget {
  const _ErrorPanel({required this.message, required this.onRetry});

  final String message;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: _background,
      child: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('The arena failed to load', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Color(0xFFCDBCC4))),
              const SizedBox(height: 16),
              FilledButton(onPressed: onRetry, child: const Text('Try again')),
            ],
          ),
        ),
      ),
    );
  }
}
