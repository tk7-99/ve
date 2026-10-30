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

  test('Audio playback retains a matching filename extension', () {
    expect(audioExtensionForMime('audio/mp4'), '.m4a');
    expect(audioExtensionForMime('audio/mpeg'), '.mp3');
    expect(audioExtensionForMime('audio/aac'), '.aac');
    expect(audioExtensionForMime('audio/ogg'), '.ogg');
    expect(audioExtensionForMime('audio/wav'), '.wav');
    expect(audioExtensionForMime('audio/webm'), '.webm');
    expect(audioExtensionForMime('application/octet-stream'), '.audio');
  });
}
