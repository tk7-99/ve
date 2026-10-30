import 'dart:convert';
import 'dart:math';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_vodozemac/flutter_vodozemac.dart' as crypto;
import 'package:http/http.dart' as http;
import 'package:matrix/matrix.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sqflite_sqlcipher/sqflite.dart' as sql;
import 'config.dart';

class AppFailure implements Exception {
  final String code;
  const AppFailure(this.code);
}

class Session extends ChangeNotifier {
  final Client client;
  final SharedPreferences preferences;
  bool get english => preferences.getBool('english') ?? false;
  bool get dark => preferences.getBool('dark') ?? false;
  String get dialect => preferences.getString('dialect') ?? 'بغدادية';
  double get fontScale => preferences.getDouble('fontScale') ?? 1.0;
  Session(this.client, this.preferences);
  String text(String ar, String en) => english ? en : ar;

  static Future<Session> open() async {
    await crypto.init();
    const storage = FlutterSecureStorage();
    var key = await storage.read(key: 'dazza.database.key');
    if (key == null) {
      key = base64UrlEncode(
        List<int>.generate(32, (_) => Random.secure().nextInt(256)),
      );
      await storage.write(key: 'dazza.database.key', value: key);
    }
    final dir = await getApplicationSupportDirectory();
    final database = await sql.openDatabase(
      p.join(dir.path, 'dazza.db'),
      password: key,
    );
    final client = Client(
      'DAZZA',
      database: await MatrixSdkDatabase.init('DAZZA', database: database),
    );
    await client.init(waitForFirstSync: false);
    return Session(client, await SharedPreferences.getInstance());
  }

  Future<void> setting(String key, Object value) async {
    if (value is bool) await preferences.setBool(key, value);
    if (value is String) await preferences.setString(key, value);
    if (value is double) await preferences.setDouble(key, value);
    notifyListeners();
  }

  Future<Map<String, dynamic>> request(
    String route, {
    Map<String, dynamic>? body,
    bool auth = false,
  }) async {
    final headers = {
      'Content-Type': 'application/json',
      if (auth) 'Authorization': 'Bearer ${client.accessToken}',
    };
    final uri = Uri.parse('${AppConfig.gateway}$route');
    final response = body == null
        ? await http
              .get(uri, headers: headers)
              .timeout(const Duration(seconds: 30))
        : await http
              .post(uri, headers: headers, body: jsonEncode(body))
              .timeout(const Duration(seconds: 30));
    final result = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode >= 400) {
      throw AppFailure(
        result['detail'] is String ? result['detail'] : 'request_failed',
      );
    }
    return result;
  }

  Future<void> acceptLogin(Map<String, dynamic> data) async {
    if (data['homeserver'] != AppConfig.homeserver) {
      throw const AppFailure('homeserver_mismatch');
    }
    await client.init(
      newToken: data['access_token'],
      newUserID: data['user_id'],
      newDeviceID: data['device_id'],
      newDeviceName: 'DAZZA mobile',
      newHomeserver: Uri.parse(AppConfig.homeserver),
      waitForFirstSync: false,
    );
    await preferences.setString('username', data['username']);
    notifyListeners();
  }

  Future<String> resolve(String username) async {
    final data = await request(
      '/v1/users/${Uri.encodeComponent(username.trim().toLowerCase())}',
      auth: true,
    );
    return data['matrix_user_id'] as String;
  }

  void requireEncryption(Room room) {
    if (!client.encryptionEnabled || !room.encrypted) {
      throw const AppFailure('encryption_unavailable');
    }
  }
}
