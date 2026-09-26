import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crimson_arena/src/local_game_server.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final files = <String, String>{
    'assets/game/index.html': '<!doctype html><title>Crimson Arena</title>',
    'assets/game/js/main.js': 'console.log(1)',
    'assets/game/engine/_framework/dotnet.native.wasm': '\u0000asm',
    'assets/game/assets/heroine.webp': 'RIFF',
    'assets/game/fonts/inter-latin.woff2': 'wOF2',
  };
  final requested = <String>[];

  Future<Uint8List?> load(String key) async {
    requested.add(key);
    final text = files[key];
    return text == null ? null : Uint8List.fromList(utf8.encode(text));
  }

  late LocalGameServer server;
  late HttpClient client;

  setUp(() async {
    requested.clear();
    server = LocalGameServer(load: load, preferredPort: 0);
    await server.start();
    client = HttpClient();
  });

  tearDown(() async {
    client.close(force: true);
    await server.stop();
  });

  Future<HttpClientResponse> get(String path, {String method = 'GET'}) async {
    final request = await client.openUrl(method, server.origin.replace(path: path));
    return request.close();
  }

  Future<HttpClientResponse> getRaw(String rawPath) async {
    // Bypass Uri normalisation to send a hostile path as-is.
    final socket = await Socket.connect(InternetAddress.loopbackIPv4, server.origin.port);
    socket.write('GET $rawPath HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
    await socket.flush();
    final reply = await utf8.decoder.bind(socket).join();
    socket.destroy();
    final status = int.parse(reply.split(' ')[1]);
    return _FakeStatus(status);
  }

  test('binds to the loopback interface only', () {
    expect(server.origin.host, '127.0.0.1');
    expect(server.indexUrl.path, '/index.html');
  });

  test('serves index.html for / and folder paths', () async {
    final root = await get('/');
    expect(root.statusCode, 200);
    expect(root.headers.contentType?.mimeType, 'text/html');
    expect(await utf8.decoder.bind(root).join(), contains('Crimson Arena'));
    expect(requested.last, 'assets/game/index.html');
  });

  test('sends the right content types (WebAssembly needs application/wasm)', () async {
    final cases = {
      '/js/main.js': 'text/javascript',
      '/engine/_framework/dotnet.native.wasm': 'application/wasm',
      '/assets/heroine.webp': 'image/webp',
      '/fonts/inter-latin.woff2': 'font/woff2',
    };
    for (final MapEntry(key: path, value: type) in cases.entries) {
      final response = await get(path);
      await response.drain<void>();
      expect(response.statusCode, 200, reason: path);
      expect(response.headers.contentType?.mimeType, type, reason: path);
      expect(response.headers.value('cache-control'), 'no-cache');
    }
  });

  test('HEAD returns headers without a body', () async {
    final response = await get('/js/main.js', method: 'HEAD');
    expect(response.statusCode, 200);
    expect(response.contentLength, 'console.log(1)'.length);
    expect(await response.fold<int>(0, (n, chunk) => n + chunk.length), 0);
  });

  test('404 for missing files, 405 for writes', () async {
    final missing = await get('/nope.js');
    await missing.drain<void>();
    expect(missing.statusCode, 404);
    final post = await get('/index.html', method: 'POST');
    await post.drain<void>();
    expect(post.statusCode, 405);
  });

  test('never escapes the asset root', () async {
    for (final path in ['/../pubspec.yaml', '/js/%2e%2e/%2e%2e/pubspec.yaml', '/.env', '/js/..%5c..%5csecret', '/%2Fetc%2Fpasswd']) {
      final response = await getRaw(path);
      expect(response.statusCode, 404, reason: path);
    }
    expect(requested.where((k) => !k.startsWith('assets/game/') || k.contains('..')), isEmpty);
  });

  test('maps paths to asset keys', () {
    expect(server.assetKeyFor(Uri.parse('http://x/')), 'assets/game/index.html');
    expect(server.assetKeyFor(Uri.parse('http://x/js/')), 'assets/game/js/index.html');
    expect(server.assetKeyFor(Uri.parse('http://x/engine/_framework/dotnet.js')), 'assets/game/engine/_framework/dotnet.js');
    expect(server.assetKeyFor(Uri.parse('http://x/a/../b')), 'assets/game/b'); // Uri already normalised it
    // Dart removes dot segments (even percent-encoded ones) while parsing, so
    // they can only ever resolve inside the asset root.
    expect(server.assetKeyFor(Uri.parse('http://x/%2e%2e/x')), 'assets/game/x');
    expect(server.assetKeyFor(Uri.parse('http://x/js/%2E%2E/%2E%2E/pubspec.yaml')), 'assets/game/pubspec.yaml');
    // Encoded separators and hidden files are refused outright.
    expect(server.assetKeyFor(Uri.parse('http://x/a%2Fb')), isNull);
    expect(server.assetKeyFor(Uri.parse(r'http://x/a%5Cb')), isNull);
    expect(server.assetKeyFor(Uri.parse('http://x/.git/config')), isNull);
  });

  test('keeps the same origin across restarts when the port is free', () async {
    final fixed = LocalGameServer(load: load, preferredPort: 0);
    final first = await fixed.start();
    await fixed.stop();
    final again = LocalGameServer(load: load, preferredPort: first.port);
    expect(await again.start(), first);
    await again.stop();
  });

  test('falls back to a free port if the preferred one is taken', () async {
    final squatter = await ServerSocket.bind(InternetAddress.loopbackIPv4, 0);
    final other = LocalGameServer(load: load, preferredPort: squatter.port);
    final origin = await other.start();
    expect(origin.port, isNot(squatter.port));
    await other.stop();
    await squatter.close();
  });

  test('ensureRunning restarts a server whose socket went away', () async {
    final origin = server.origin;
    expect(await server.ensureRunning(), origin);
    await server.stop();
    expect(server.isRunning, isFalse);
    final restarted = await server.ensureRunning();
    expect(server.isRunning, isTrue);
    final response = await get('/');
    await response.drain<void>();
    expect(response.statusCode, 200);
    expect(restarted.host, '127.0.0.1');
  });
}

class _FakeStatus implements HttpClientResponse {
  _FakeStatus(this.statusCode);

  @override
  final int statusCode;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
