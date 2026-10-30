import 'package:flutter/material.dart';
import '../session.dart';
import 'common.dart';

class SettingsPage extends StatelessWidget {
  final Session session;
  const SettingsPage({super.key, required this.session});
  @override
  Widget build(BuildContext context) {
    final s = session;
    return ListenableBuilder(
      listenable: s,
      builder: (context, _) => Scaffold(
        appBar: AppBar(title: Text(s.text('الإعدادات', 'Settings'))),
        body: ListView(
          children: [
            ListTile(
              title: Text(s.preferences.getString('username') ?? 'DAZZA'),
              subtitle: SelectableText(s.client.userID ?? ''),
            ),
            ListTile(
              leading: const Icon(Icons.person_outline),
              title: Text(s.text('تعديل الاسم', 'Edit display name')),
              onTap: () async {
                final value = await askText(
                  context,
                  s.text('اسمك', 'Your name'),
                );
                if (value == null || value.isEmpty) return;
                try {
                  await s.client.setProfileField(
                    s.client.userID!,
                    'displayname',
                    {'displayname': value},
                  );
                } catch (e) {
                  if (context.mounted) showFailure(context, s, e);
                }
              },
            ),
            SwitchListTile(
              title: Text(s.text('الوضع الليلي', 'Dark mode')),
              value: s.dark,
              onChanged: (v) => s.setting('dark', v),
            ),
            SwitchListTile(
              title: const Text('English'),
              value: s.english,
              onChanged: (v) => s.setting('english', v),
            ),
            ListTile(
              title: Text(s.text('حجم الخط', 'Text size')),
              subtitle: Slider(
                value: s.fontScale,
                min: .9,
                max: 1.4,
                divisions: 5,
                onChanged: (v) => s.setting('fontScale', v),
              ),
            ),
            ListTile(
              title: Text(s.text('حالة النسخة', 'Build status')),
              subtitle: Text(
                s.text(
                  '0.1.0 — حزمة تطوير. المكالمات والحالات والقنوات وإشعارات الخلفية واستعادة مفاتيح التشفير لم تُنفّذ بعد. لا تستخدمها لبيانات حساسة قبل مراجعة الأمن واختبار الأجهزة.',
                  '0.1.0 — Development build. Calls, stories, channels, background push and encryption key recovery are not implemented. Security review and device tests are still required.',
                ),
              ),
            ),
            ListTile(
              leading: const Icon(Icons.logout),
              title: Text(s.text('تسجيل الخروج', 'Sign out')),
              onTap: () async {
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (context) => AlertDialog(
                    title: Text(s.text('تسجيل الخروج؟', 'Sign out?')),
                    content: Text(
                      s.text(
                        'استعادة مفاتيح الرسائل القديمة غير متاحة في هذه النسخة. تسجيل الخروج قد يفقدك القدرة على قراءتها بهذا الجهاز.',
                        'Key recovery is not implemented. Signing out may prevent this device from reading previous encrypted messages.',
                      ),
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.pop(context, false),
                        child: Text(s.text('إلغاء', 'Cancel')),
                      ),
                      FilledButton(
                        onPressed: () => Navigator.pop(context, true),
                        child: Text(s.text('خروج', 'Sign out')),
                      ),
                    ],
                  ),
                );
                if (ok != true) return;
                try {
                  await s.client.logout();
                  if (context.mounted) Navigator.pop(context);
                } catch (e) {
                  if (context.mounted) showFailure(context, s, e);
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}
