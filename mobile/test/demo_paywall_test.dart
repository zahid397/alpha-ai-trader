import 'package:crimson_arena/src/boss_store.dart';
import 'package:crimson_arena/src/demo_paywall.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  Future<bool?> open(WidgetTester tester, Future<void> Function() act) async {
    bool? result;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () async => result = await showDemoPaywall(context),
            child: const Text('open'),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
    expect(find.text('Unlock the Main Boss'), findsOneWidget);
    await act();
    await tester.pumpAndSettle();
    return result;
  }

  testWidgets('unlock returns true', (tester) async {
    expect(await open(tester, () => tester.tap(find.byKey(const Key('demo-unlock')))), isTrue);
  });

  testWidgets('not now returns false', (tester) async {
    expect(await open(tester, () => tester.tap(find.byKey(const Key('demo-cancel')))), isFalse);
  });

  testWidgets('dismissing the sheet returns false', (tester) async {
    expect(await open(tester, () => tester.tapAt(const Offset(5, 5))), isFalse);
  });

  test('demo store unlocks once, for the session, and announces it', () async {
    var asked = 0;
    final store = DemoBossStore(confirm: () async {
      asked++;
      return asked > 1; // first time: "Not now"
    });
    final changes = <bool>[];
    store.changes.listen(changes.add);
    expect((await store.status()).unlocked, isFalse);
    expect((await store.unlockMainBoss()).result, UnlockResult.cancelled);
    expect((await store.unlockMainBoss()).result, UnlockResult.unlocked);
    expect((await store.unlockMainBoss()).result, UnlockResult.unlocked);
    expect(asked, 2);
    expect((await store.status()).unlocked, isTrue);
    expect(await store.restore(), isTrue);
    await Future<void>.delayed(Duration.zero);
    expect(changes, [true]);
  });
}
