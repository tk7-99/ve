# DAZZA mobile

تطبيق Flutter الأصلي لأندرويد وiOS. هذه نسخة تطوير وليست إصداراً جاهزاً للنشر.

## المتطلبات

- Flutter/Dart متوافقان مع القيود في pubspec.yaml.
- Android Studio أو Android SDK لبناء APK.
- عنوان HTTPS لخدمة FastAPI وعنوان HTTPS لخادم Matrix.
- خادم DAZZA فعلي مع PostgreSQL وRedis وSynapse وResend.

## التثبيت والفحص

من هذا المجلد:

    flutter pub get
    flutter analyze
    flutter test

## بناء APK تجريبي

    flutter build apk --debug \
      --dart-define=DAZZA_API_URL=https://api.example.com \
      --dart-define=DAZZA_MATRIX_URL=https://matrix.example.com

استبدل العناوين بعناوين الخادم المنشور فعلياً. يجب أن تستخدم HTTPS. إذا لم تُمرّر العناوين الصحيحة، يعرض التطبيق شاشة إعداد ولا ينشئ تسجيل دخول وهمياً.

## تسجيل الحساب

التسجيل والدخول بالبريد الإلكتروني فقط. يتطلب الخادم ضبط RESEND_API_KEY وRESEND_FROM في ملف البيئة الخاص بالخادم. لا تضع مفتاح Resend أو أسرار Synapse في التطبيق.

راجع ../README.ar.md لتشغيل الخدمات، و../docs/ARCHITECTURE.md للبنية، و../docs/STATUS.md لما هو منفذ وما يزال متبقياً.
