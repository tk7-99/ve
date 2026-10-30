import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../session.dart';
import '../main.dart' show BrandMark;
import 'common.dart';

class LoginPage extends StatefulWidget {
  final Session session;
  const LoginPage({super.key, required this.session});
  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final phone = TextEditingController(text: '+964');
  final code = TextEditingController();
  final username = TextEditingController();
  final name = TextEditingController();
  String? challenge;
  bool busy = false;
  int cooldown = 0;
  Timer? timer;
  Session get s => widget.session;
  @override
  void dispose() {
    timer?.cancel();
    for (final c in [phone, code, username, name]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> start() async {
    setState(() => busy = true);
    try {
      final data = await s.request(
        '/v1/auth/start',
        body: {'phone': phone.text.trim()},
      );
      if (!mounted) return;
      setState(() {
        challenge = data['challenge_id'];
        cooldown = data['resend_after'];
      });
      timer?.cancel();
      timer = Timer.periodic(const Duration(seconds: 1), (t) {
        if (!mounted) {
          t.cancel();
          return;
        }
        setState(() => cooldown--);
        if (cooldown <= 0) t.cancel();
      });
    } catch (e) {
      if (mounted) showFailure(context, s, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> verify() async {
    if (!RegExp(r'^[a-z][a-z0-9_]{2,29}$').hasMatch(username.text.trim()) ||
        name.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            s.text(
              'اكتب اسمك واسم مستخدم من 3–30 حرفاً إنجليزياً أو رقماً، يبدأ بحرف.',
              'Enter your name and a 3–30 character username starting with a letter.',
            ),
          ),
        ),
      );
      return;
    }
    setState(() => busy = true);
    try {
      final data = await s.request(
        '/v1/auth/verify',
        body: {
          'challenge_id': challenge,
          'code': code.text.trim(),
          'username': username.text.trim(),
          'display_name': name.text.trim(),
          'device_name': 'DAZZA mobile',
        },
      );
      await s.acceptLogin(data);
    } catch (e) {
      if (mounted) showFailure(context, s, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      actions: [
        TextButton(
          onPressed: () => s.setting('english', !s.english),
          child: Text(s.english ? 'العربية' : 'English'),
        ),
      ],
    ),
    body: Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 460),
        child: ListView(
          padding: const EdgeInsets.all(28),
          children: [
            const Center(child: BrandMark()),
            const SizedBox(height: 24),
            Text(
              s.text('هلا بيك بدَزّة', 'Welcome to DAZZA'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
            const SizedBox(height: 8),
            Text(
              s.text(
                'من العراق... دزّ رسالتك للعالم.',
                'From Iraq… send your message to the world.',
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),
            TextField(
              controller: phone,
              enabled: !busy && challenge == null,
              keyboardType: TextInputType.phone,
              textDirection: TextDirection.ltr,
              decoration: InputDecoration(
                labelText: s.text(
                  'رقم الهاتف مع مفتاح الدولة',
                  'Phone with country code',
                ),
              ),
            ),
            const SizedBox(height: 16),
            if (challenge == null)
              FilledButton(
                onPressed: busy ? null : start,
                child: Text(s.text('دز رمز التحقق', 'Send verification code')),
              ),
            if (challenge != null) ...[
              TextField(
                controller: code,
                enabled: !busy,
                keyboardType: TextInputType.number,
                autofillHints: const [AutofillHints.oneTimeCode],
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                decoration: InputDecoration(
                  labelText: s.text('رمز التحقق', 'Verification code'),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: name,
                enabled: !busy,
                decoration: InputDecoration(
                  labelText: s.text('اسمك', 'Your name'),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: username,
                enabled: !busy,
                textDirection: TextDirection.ltr,
                decoration: InputDecoration(
                  labelText: s.text('اسم المستخدم', 'Username'),
                  helperText: s.text(
                    'للحساب الجديد فقط؛ الحساب الحالي يحتفظ باسمه.',
                    'New accounts only; existing usernames are preserved.',
                  ),
                ),
              ),
              const SizedBox(height: 20),
              FilledButton(
                onPressed: busy ? null : verify,
                child: Text(s.text('هلا بيك، ادخل', 'Verify and sign in')),
              ),
              TextButton(
                onPressed: busy || cooldown > 0 ? null : start,
                child: Text(
                  cooldown > 0
                      ? '${s.text('إعادة الإرسال بعد', 'Resend in')} $cooldown'
                      : s.text('إعادة إرسال الرمز', 'Resend code'),
                ),
              ),
              TextButton(
                onPressed: busy
                    ? null
                    : () => setState(() {
                        challenge = null;
                        code.clear();
                      }),
                child: Text(s.text('تغيير الرقم', 'Change number')),
              ),
            ],
            if (busy)
              const Padding(
                padding: EdgeInsets.all(16),
                child: Center(child: CircularProgressIndicator()),
              ),
            const SizedBox(height: 24),
            Text(
              s.text(
                'هذه حزمة تطوير أولية. لم تُعتمد للاستخدام العام بعد.',
                'Development build. Not approved for public use yet.',
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    ),
  );
}
