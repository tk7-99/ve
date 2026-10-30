import 'package:flutter/material.dart';
import '../session.dart';

void showFailure(BuildContext context, Session s, Object error) {
  final code = error is AppFailure ? error.code : '';
  final message = switch (code) {
    'sms_not_configured' => s.text(
      'خدمة رسائل التحقق لم تُفعّل بعد.',
      'SMS verification is not configured.',
    ),
    'invalid_or_expired_code' || 'challenge_expired' => s.text(
      'الرمز غير صحيح أو انتهت صلاحيته.',
      'The code is invalid or expired.',
    ),
    'username_taken_request_new_code' => s.text(
      'اسم المستخدم محجوز. اختر اسماً آخر واطلب رمزاً جديداً.',
      'Username is taken. Choose another and request a new code.',
    ),
    'wait_before_resend' || 'too_many_attempts' || 'sms_rate_limited' => s.text(
      'انتظر قليلاً قبل المحاولة مرة ثانية.',
      'Please wait before trying again.',
    ),
    'user_not_found' => s.text('لم نجد اسم المستخدم.', 'Username not found.'),
    'encryption_unavailable' => s.text(
      'توقّف الإرسال لأن التشفير غير جاهز.',
      'Sending stopped because encryption is not ready.',
    ),
    _ => s.text(
      'تعذّرت العملية. تأكد من الاتصال وحاول مجدداً.',
      'Could not complete this action. Check your connection and retry.',
    ),
  };
  ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
}

Future<String?> askText(
  BuildContext context,
  String title, {
  String? hint,
  String initial = '',
}) async {
  final controller = TextEditingController(text: initial);
  final value = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: TextField(
        controller: controller,
        autofocus: true,
        decoration: InputDecoration(hintText: hint),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Icon(Icons.close),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(context, controller.text.trim()),
          child: const Icon(Icons.check),
        ),
      ],
    ),
  );
  // Dispose after the dialog route has completed its closing transition.
  Future<void>.delayed(const Duration(seconds: 1), controller.dispose);
  return value;
}
