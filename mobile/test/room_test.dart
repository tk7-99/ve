import 'package:flutter_test/flutter_test.dart';
import 'package:dazza/screens/room.dart';

void main() {
  test('Attachment filename maps to the correct Matrix media MIME type', () {
    expect(mimeTypeForName('photo.JPG'), 'image/jpeg');
    expect(mimeTypeForName('image.webp'), 'image/webp');
    expect(mimeTypeForName('clip.mp4'), 'video/mp4');
    expect(mimeTypeForName('recording.m4a'), 'audio/mp4');
    expect(mimeTypeForName('document.pdf'), 'application/pdf');
    expect(mimeTypeForName('unknown.custom'), 'application/octet-stream');
  });
}
