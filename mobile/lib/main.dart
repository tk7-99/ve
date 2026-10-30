import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'config.dart';
import 'session.dart';
import 'screens/login.dart';
import 'screens/home.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  if (!AppConfig.configured) {
    runApp(const SetupNotice());
    return;
  }
  try {
    final session = await Session.open();
    runApp(DazzaApp(session: session));
  } catch (_) {
    runApp(const SetupNotice(storageError: true));
  }
}

class DazzaApp extends StatelessWidget {
  final Session session;
  const DazzaApp({super.key, required this.session});
  @override
  Widget build(BuildContext context) => ListenableBuilder(
    listenable: session,
    builder: (context, _) => MaterialApp(
      title: 'دَزّة | DAZZA',
      debugShowCheckedModeBanner: false,
      locale: Locale(session.english ? 'en' : 'ar'),
      supportedLocales: const [Locale('ar'), Locale('en')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      theme: makeTheme(Brightness.light),
      darkTheme: makeTheme(Brightness.dark),
      themeMode: session.dark ? ThemeMode.dark : ThemeMode.light,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(session.fontScale)),
        child: child!,
      ),
      home: StreamBuilder(
        stream: session.client.onLoginStateChanged.stream,
        builder: (context, _) => session.client.isLogged()
            ? HomePage(session: session)
            : LoginPage(session: session),
      ),
    ),
  );
}

ThemeData makeTheme(Brightness brightness) => ThemeData(
  useMaterial3: true,
  brightness: brightness,
  colorScheme: ColorScheme.fromSeed(
    seedColor: const Color(0xff5142b5),
    brightness: brightness,
    secondary: const Color(0xff078b83),
  ),
  scaffoldBackgroundColor: brightness == Brightness.light
      ? const Color(0xfff7f6fb)
      : const Color(0xff151323),
  inputDecorationTheme: InputDecorationTheme(
    filled: true,
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(18),
      borderSide: BorderSide.none,
    ),
  ),
  filledButtonTheme: FilledButtonThemeData(
    style: FilledButton.styleFrom(
      minimumSize: const Size(48, 52),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
    ),
  ),
);

class BrandMark extends StatelessWidget {
  const BrandMark({super.key});
  @override
  Widget build(BuildContext context) => Container(
    width: 88,
    height: 88,
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(28),
      gradient: const LinearGradient(
        colors: [Color(0xff5142b5), Color(0xff078b83)],
      ),
    ),
    child: const Icon(
      Icons.mark_chat_unread_rounded,
      color: Colors.white,
      size: 46,
    ),
  );
}

class SetupNotice extends StatelessWidget {
  final bool storageError;
  const SetupNotice({super.key, this.storageError = false});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'DAZZA',
    theme: makeTheme(Brightness.light),
    home: Directionality(
      textDirection: TextDirection.rtl,
      child: Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const BrandMark(),
                const SizedBox(height: 24),
                const Text(
                  'دَزّة | DAZZA',
                  style: TextStyle(fontSize: 30, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 16),
                Text(
                  storageError
                      ? 'تعذّر فتح التخزين الآمن. لا تمسح بيانات التطبيق قبل حفظ مفاتيحك.'
                      : 'الخادم لم يُربط بهذه النسخة بعد. راجع دليل التشغيل لتعيين عناوين خدمة دَزّة.',
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}
