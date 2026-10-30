class AppConfig {
  static const _gateway = String.fromEnvironment('DAZZA_API_URL');
  static const _homeserver = String.fromEnvironment('DAZZA_MATRIX_URL');

  // Normalize base URLs so a trailing slash does not create double-slash
  // API routes or a false homeserver mismatch after login.
  static String get gateway => normalizeBaseUrl(_gateway);
  static String get homeserver => normalizeBaseUrl(_homeserver);

  static String normalizeBaseUrl(String value) {
    var normalized = value.trim();
    while (normalized.endsWith('/')) {
      normalized = normalized.substring(0, normalized.length - 1);
    }
    return normalized;
  }

  static bool get configured => secureUrl(gateway) && secureUrl(homeserver);

  static bool secureUrl(String value) {
    final uri = Uri.tryParse(value);
    return uri != null &&
        uri.scheme == 'https' &&
        uri.host.isNotEmpty &&
        uri.userInfo.isEmpty &&
        uri.query.isEmpty &&
        uri.fragment.isEmpty;
  }
}
