import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

/// Loads one bundled asset by its key (for example `assets/game/index.html`).
/// Returns null when the asset does not exist.
typedef AssetLoader = Future<Uint8List?> Function(String assetKey);

/// Serves the game bundled inside the app to the WebView, fully offline.
///
/// Why not `file://`? WebViews treat `file://` pages as an opaque origin:
/// `fetch()` refuses the `file:` scheme, ES modules are blocked by CORS and
/// WebAssembly cannot be streamed. The .NET WebAssembly runtime needs all
/// three. So the app serves its own bundled asset files over HTTP on the
/// loopback interface (127.0.0.1): nothing leaves the device, nothing is
/// downloaded, and the page gets a normal same-origin context.
///
/// Pure `dart:io` (no Flutter import), so it also runs under plain `dart` for
/// tests and `tool/serve_game.dart`.
class LocalGameServer {
  LocalGameServer({
    required this.load,
    this.assetRoot = 'assets/game',
    this.preferredPort = 47631,
  });

  final AssetLoader load;

  /// Asset key prefix that maps to the web root.
  final String assetRoot;

  /// A fixed port keeps the page origin (and its localStorage, e.g. the high
  /// score) stable across launches. If it is taken, any free port is used.
  final int preferredPort;

  HttpServer? _server;

  bool get isRunning => _server != null;

  /// `http://127.0.0.1:<port>` of the running server.
  Uri get origin {
    final server = _server;
    if (server == null) throw StateError('LocalGameServer is not running');
    return Uri(scheme: 'http', host: '127.0.0.1', port: server.port);
  }

  Uri get indexUrl => origin.replace(path: '/index.html');

  Future<Uri> start() async {
    if (_server != null) return origin;
    HttpServer server;
    try {
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, preferredPort);
    } on SocketException {
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    }
    server.autoCompress = false;
    server.idleTimeout = const Duration(seconds: 30);
    _server = server;
    server.listen(
      _handle,
      onError: (Object _) {},
      onDone: () {
        if (identical(_server, server)) _server = null;
      },
    );
    return origin;
  }

  /// iOS may reclaim the listening socket while the app is suspended. Call
  /// this when the app resumes; it restarts the server if it stopped
  /// answering and returns the (possibly new) origin.
  Future<Uri> ensureRunning() async {
    final server = _server;
    if (server != null && await _answers(server.port)) return origin;
    await stop();
    return start();
  }

  Future<void> stop() async {
    final server = _server;
    _server = null;
    await server?.close(force: true);
  }

  Future<bool> _answers(int port) async {
    try {
      final socket = await Socket.connect(InternetAddress.loopbackIPv4, port, timeout: const Duration(milliseconds: 600));
      socket.destroy();
      return true;
    } on Object {
      return false;
    }
  }

  Future<void> _handle(HttpRequest request) async {
    final response = request.response;
    try {
      if (request.method != 'GET' && request.method != 'HEAD') {
        response.statusCode = HttpStatus.methodNotAllowed;
        response.headers.set(HttpHeaders.allowHeader, 'GET, HEAD');
        return;
      }
      final key = assetKeyFor(request.uri);
      final bytes = key == null ? null : await load(key);
      if (key == null || bytes == null) {
        response.statusCode = HttpStatus.notFound;
        return;
      }
      response.headers.contentType = ContentType.parse(contentTypeFor(key));
      response.headers.set(HttpHeaders.cacheControlHeader, 'no-cache');
      response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
      response.contentLength = bytes.length;
      if (request.method == 'GET') response.add(bytes);
    } on Object {
      try {
        response.statusCode = HttpStatus.internalServerError;
      } on Object {
        // Headers already sent.
      }
    } finally {
      await response.close();
    }
  }

  /// Maps a request path to an asset key, or null if the path is not allowed.
  /// `/` and folder paths serve `index.html`; `..`, hidden files and
  /// backslashes are rejected.
  String? assetKeyFor(Uri uri) {
    final segments = List<String>.of(uri.pathSegments);
    if (segments.isEmpty || segments.last.isEmpty) {
      if (segments.isNotEmpty) segments.removeLast();
      segments.add('index.html');
    }
    for (final segment in segments) {
      if (segment.isEmpty || segment.startsWith('.') || segment.contains('\\') || segment.contains('/')) return null;
    }
    return '$assetRoot/${segments.join('/')}';
  }

  static const _types = <String, String>{
    'html': 'text/html; charset=utf-8',
    'js': 'text/javascript; charset=utf-8',
    'mjs': 'text/javascript; charset=utf-8',
    'css': 'text/css; charset=utf-8',
    'json': 'application/json; charset=utf-8',
    'wasm': 'application/wasm',
    'webp': 'image/webp',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'svg': 'image/svg+xml',
    'ico': 'image/x-icon',
    'woff2': 'font/woff2',
    'txt': 'text/plain; charset=utf-8',
  };

  static String contentTypeFor(String key) {
    final dot = key.lastIndexOf('.');
    final ext = dot < 0 ? '' : key.substring(dot + 1).toLowerCase();
    return _types[ext] ?? 'application/octet-stream';
  }
}
