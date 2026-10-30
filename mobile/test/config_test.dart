import 'package:flutter_test/flutter_test.dart';
import 'package:dazza/config.dart';

void main() {
  test(
    'Only HTTPS service endpoints without embedded credentials are accepted',
    () {
      expect(AppConfig.secureUrl('https://api.dazza.example'), isTrue);
      expect(AppConfig.secureUrl('http://api.dazza.example'), isFalse);
      expect(
        AppConfig.secureUrl('https://user:secret@api.dazza.example'),
        isFalse,
      );
      expect(AppConfig.secureUrl(''), isFalse);
      expect(
        AppConfig.secureUrl('https://api.dazza.example?token=value'),
        isFalse,
      );
    },
  );
}
