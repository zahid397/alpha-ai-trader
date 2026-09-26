import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crimson_arena/src/local_game_server.dart';
import 'package:flutter_test/flutter_test.dart';

/// Checks the real game bundle in mobile/assets/game: complete, declared in
/// pubspec.yaml, in sync with public/game, free of network URLs, and served
/// correctly by the app's loopback server. (`flutter test` runs in mobile/.)
void main() {
  final bundle = Directory('assets/game');
  final web = Directory('../public/game');

  List<File> filesIn(Directory dir) => dir.listSync(recursive: true).whereType<File>().toList()..sort((a, b) => a.path.compareTo(b.path));
  String rel(File f, Directory root) => f.path.substring(root.path.length + 1).replaceAll(r'\', '/');

  test('contains the game, its sprites and the C# WebAssembly engine', () {
    for (final path in [
      'index.html',
      'game.css',
      'js/main.js',
      'js/bridge.js',
      'js/engine.js',
      'assets/sprites.json',
      'assets/warlord.webp',
      'fonts/fonts.css',
      'engine/_framework/dotnet.js',
    ]) {
      expect(File('${bundle.path}/$path').existsSync(), isTrue, reason: path);
    }
    final wasm = filesIn(Directory('${bundle.path}/engine/_framework')).where((f) => f.path.endsWith('.wasm'));
    expect(wasm.length, greaterThanOrEqualTo(3));
    expect(wasm.any((f) => rel(f, bundle).contains('CrimsonArena.Engine')), isTrue);
  });

  test('every bundled folder is declared in pubspec.yaml (Flutter does not recurse)', () {
    final pubspec = File('pubspec.yaml').readAsStringSync();
    final declared = RegExp(r'^\s+- (assets/game/\S*)$', multiLine: true).allMatches(pubspec).map((m) => m.group(1)).toSet();
    final folders = filesIn(bundle).map((f) => '${File(f.path).parent.path.replaceAll(r'\', '/')}/').toSet();
    expect(declared, containsAll(folders));
  });

  test('is identical to public/game (run `npm run mobile:assets` after changing the game)', () {
    if (!web.existsSync()) return; // app checked out on its own
    final a = {for (final f in filesIn(web)) rel(f, web): f};
    final b = {for (final f in filesIn(bundle)) rel(f, bundle): f};
    expect(b.keys.toList(), a.keys.toList());
    for (final key in a.keys) {
      expect(b[key]!.readAsBytesSync(), a[key]!.readAsBytesSync(), reason: '$key differs');
    }
  });

  test('makes no network requests: no http(s) URLs in the page, styles or scripts', () {
    final checked = filesIn(bundle).where((f) => RegExp(r'\.(html|css)$').hasMatch(f.path) || (f.path.contains('/js/') && f.path.endsWith('.js')));
    final url = RegExp(r'''(src|href)\s*=\s*["']https?://|url\(\s*["']?https?://|(import|fetch)\s*\(\s*["']https?://|from\s+["']https?://''');
    for (final file in checked) {
      expect(url.hasMatch(file.readAsStringSync()), isFalse, reason: '${rel(file, bundle)} references the network');
    }
  });

  test('the loopback server serves the real bundle byte for byte', () async {
    final server = LocalGameServer(
      preferredPort: 0,
      load: (key) async {
        final file = File(key);
        return file.existsSync() ? Uint8List.fromList(file.readAsBytesSync()) : null;
      },
    );
    final origin = await server.start();
    final client = HttpClient();
    try {
      final index = await (await client.getUrl(origin.replace(path: '/index.html'))).close();
      expect(index.statusCode, 200);
      final html = await utf8.decoder.bind(index).join();
      expect(html, contains('js/main.js'));

      for (final file in filesIn(bundle)) {
        final path = rel(file, bundle);
        final response = await (await client.getUrl(origin.replace(path: '/$path'))).close();
        final bytes = await response.fold<List<int>>(<int>[], (all, chunk) => all..addAll(chunk));
        expect(response.statusCode, 200, reason: path);
        expect(bytes.length, file.lengthSync(), reason: path);
        if (path.endsWith('.wasm')) expect(response.headers.contentType?.mimeType, 'application/wasm', reason: path);
      }
    } finally {
      client.close(force: true);
      await server.stop();
    }
  });
}
