import 'package:flutter/material.dart';

/// The purchase sheet shown by [DemoBossStore] when no RevenueCat key is
/// configured. It makes the whole unlock flow testable without store
/// accounts; nothing is charged.
Future<bool> showDemoPaywall(BuildContext context, {String price = r'$1.99'}) async {
  final result = await showModalBottomSheet<bool>(
    context: context,
    backgroundColor: const Color(0xFF140A12),
    showDragHandle: true,
    isScrollControlled: true,
    constraints: const BoxConstraints(maxWidth: 520),
    builder: (context) => SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
              'DEMO STORE · no RevenueCat key configured',
              style: TextStyle(color: Color(0xFFE34948), fontSize: 11, fontWeight: FontWeight.w800, letterSpacing: 1.2),
            ),
            const SizedBox(height: 8),
            const Text('Unlock the Main Boss', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.w900)),
            const SizedBox(height: 6),
            const Text(
              'Face the Crimson Warlord: a greatsword cleave, fire shockwaves and a 5,000-point bounty.',
              style: TextStyle(color: Color(0xFFCDBCC4), height: 1.4),
            ),
            const SizedBox(height: 18),
            FilledButton(
              key: const Key('demo-unlock'),
              style: FilledButton.styleFrom(backgroundColor: const Color(0xFFE34948), minimumSize: const Size.fromHeight(50)),
              onPressed: () => Navigator.of(context).pop(true),
              child: Text('Unlock for $price (demo)', style: const TextStyle(fontWeight: FontWeight.w800)),
            ),
            TextButton(
              key: const Key('demo-cancel'),
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Not now', style: TextStyle(color: Color(0xFFCDBCC4))),
            ),
          ],
        ),
      ),
    ),
  );
  return result ?? false;
}
