import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:dazza/main.dart';

void main() {
  testWidgets('Unconfigured build does not provide fake login or fake chats', (
    tester,
  ) async {
    await tester.pumpWidget(const SetupNotice());
    expect(find.text('دَزّة | DAZZA'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);
    expect(find.textContaining('الخادم لم يُربط'), findsOneWidget);
  });
}
