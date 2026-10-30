# DAZZA mobile

Native Flutter Android/iOS client. Read `../README.ar.md` for setup and `../docs/STATUS.md` for the exact implementation and verification status. This is an incomplete development release, not a production messenger.

flutter analyze
flutter test

The app requires HTTPS DAZZA_API_URL and DAZZA_MATRIX_URL via --dart-define. It never substitutes fake login or demo conversations when these are absent.
