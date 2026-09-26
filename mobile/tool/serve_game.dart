// Serves mobile/assets/game with the app's own LocalGameServer, from disk,
// so the exact offline setup can be opened in a desktop browser:
//
//   cd mobile && dart run tool/serve_game.dart [port]
import 'dart:io';
import 'dart:typed_data';

import 'package:crimson_arena/src/local_game_server.dart';

Future<void> main(List<String> args) async {
  final root = Directory.current.path;
  Future<Uint8List?> fromDisk(String key) async {
    final file = File('$root/$key');
    return await file.exists() ? file.readAsBytes() : null;
  }

  final server = LocalGameServer(load: fromDisk, preferredPort: args.isEmpty ? 47631 : int.parse(args.first));
  final origin = await server.start();
  stdout.writeln('Crimson Arena (bundled assets) at ${origin.replace(path: '/index.html')}');
}
