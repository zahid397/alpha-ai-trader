import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:purchases_flutter/purchases_flutter.dart';
import 'package:purchases_ui_flutter/purchases_ui_flutter.dart';

import 'boss_store.dart';

/// Sells the Main Boss through RevenueCat.
///
/// Dashboard setup (see mobile/README.md): a one-time product (e.g.
/// `crimson_main_boss`) attached to the entitlement [entitlementId], inside
/// the current offering, with a paywall designed in RevenueCat.
class RevenueCatBossStore implements BossStore {
  RevenueCatBossStore({required this.apiKey, required this.entitlementId, this.offeringId});

  final String apiKey;
  final String entitlementId;

  /// Offering to sell from; null uses the dashboard's current offering.
  final String? offeringId;

  final _changes = StreamController<bool>.broadcast();
  bool? _lastUnlocked;

  @override
  bool get isDemo => false;

  @override
  Future<void> init() async {
    await Purchases.setLogLevel(kDebugMode ? LogLevel.debug : LogLevel.warn);
    await Purchases.configure(PurchasesConfiguration(apiKey));
    Purchases.addCustomerInfoUpdateListener((info) {
      final unlocked = _entitled(info);
      if (_lastUnlocked != null && unlocked != _lastUnlocked) _changes.add(unlocked);
      _lastUnlocked = unlocked;
    });
  }

  bool _entitled(CustomerInfo info) => info.entitlements.active.containsKey(entitlementId);

  Future<Package?> _package() async {
    try {
      final offerings = await Purchases.getOfferings();
      final offering = offeringId == null ? offerings.current : offerings.getOffering(offeringId!);
      final packages = offering?.availablePackages ?? const <Package>[];
      return packages.isEmpty ? null : packages.first;
    } on PlatformException {
      return null;
    }
  }

  @override
  Future<BossStatus> status() async {
    try {
      final info = await Purchases.getCustomerInfo();
      final unlocked = _entitled(info);
      _lastUnlocked = unlocked;
      final price = unlocked ? null : (await _package())?.storeProduct.priceString;
      return BossStatus(unlocked: unlocked, price: price);
    } on PlatformException {
      // Offline and nothing cached yet: show the button, just without a price.
      return const BossStatus(unlocked: false);
    }
  }

  @override
  Future<UnlockOutcome> unlockMainBoss() async {
    try {
      // Already owned (bought earlier, or on another device)?
      if (_entitled(await Purchases.getCustomerInfo())) return const UnlockOutcome.unlocked();

      // 1. RevenueCat's paywall, designed in the dashboard.
      final result = await RevenueCatUI.presentPaywallIfNeeded(entitlementId, displayCloseButton: true);
      switch (result) {
        case PaywallResult.purchased:
        case PaywallResult.restored:
        case PaywallResult.notPresented: // the entitlement is already active
          return await _confirmEntitlement();
        case PaywallResult.cancelled:
          return const UnlockOutcome.cancelled();
        case PaywallResult.error:
          break; // e.g. no paywall configured yet: fall back to a direct purchase
      }
    } on PlatformException catch (e) {
      debugPrint('Paywall unavailable (${e.code}): ${e.message}');
    }

    // 2. Fallback: buy the offering's package with the store's own sheet.
    final package = await _package();
    if (package == null) return const UnlockOutcome.failed('The Main Boss is not for sale yet (no RevenueCat offering).');
    try {
      final purchase = await Purchases.purchase(PurchaseParams.package(package));
      return _entitled(purchase.customerInfo)
          ? const UnlockOutcome.unlocked()
          : UnlockOutcome.failed('Purchase went through, but the "$entitlementId" entitlement is not active.');
    } on PlatformException catch (e) {
      final code = PurchasesErrorHelper.getErrorCode(e);
      if (code == PurchasesErrorCode.purchaseCancelledError) return const UnlockOutcome.cancelled();
      return UnlockOutcome.failed(e.message ?? code.name);
    }
  }

  Future<UnlockOutcome> _confirmEntitlement() async {
    final info = await Purchases.getCustomerInfo();
    return _entitled(info)
        ? const UnlockOutcome.unlocked()
        : UnlockOutcome.failed('The paywall closed, but the "$entitlementId" entitlement is not active.');
  }

  @override
  Future<bool> restore() async {
    try {
      return _entitled(await Purchases.restorePurchases());
    } on PlatformException {
      return false;
    }
  }

  @override
  Stream<bool> get changes => _changes.stream;
}
