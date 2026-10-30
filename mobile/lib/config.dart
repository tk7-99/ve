class AppConfig {
  static const gateway = String.fromEnvironment('DAZZA_API_URL');
  static const homeserver = String.fromEnvironment('DAZZA_MATRIX_URL');
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
