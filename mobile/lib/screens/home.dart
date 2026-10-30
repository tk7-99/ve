import 'package:flutter/material.dart';
import 'package:matrix/matrix.dart';
import '../session.dart';
import 'common.dart';
import 'room.dart';
import 'settings.dart';

class HomePage extends StatefulWidget {
  final Session session;
  const HomePage({super.key, required this.session});
  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  String search = '';
  Session get s => widget.session;
  Future<void> create(bool group) async {
    final name = await askText(
      context,
      group
          ? s.text('اسم المجموعة', 'Group name')
          : s.text('اسم المستخدم', 'Username'),
    );
    if (name == null || name.isEmpty || !mounted) return;
    try {
      if (!s.client.encryptionEnabled) {
        throw const AppFailure('encryption_unavailable');
      }
      final id = group
          ? await s.client.createGroupChat(
              groupName: name,
              enableEncryption: true,
              federated: false,
            )
          : await s.client.startDirectChat(
              await s.resolve(name),
              enableEncryption: true,
            );
      final room = s.client.getRoomById(id);
      if (room != null && mounted) open(room);
    } catch (e) {
      if (mounted) showFailure(context, s, e);
    }
  }

  Future<void> open(Room room) async {
    if (room.membership == Membership.invite) {
      final accepted = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text(s.text('دعوة للمحادثة', 'Conversation invitation')),
          content: Text(room.getLocalizedDisplayname()),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: Text(s.text('لاحقاً', 'Later')),
            ),
            FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: Text(s.text('انضمام', 'Join')),
            ),
          ],
        ),
      );
      if (accepted != true) return;
      try {
        await room.join();
      } catch (e) {
        if (mounted) showFailure(context, s, e);
        return;
      }
    }
    if (!mounted) return;
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ChatPage(session: s, room: room),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text(
        'دَزّة | DAZZA',
        style: TextStyle(fontWeight: FontWeight.w800),
      ),
      actions: [
        IconButton(
          tooltip: s.text('الإعدادات', 'Settings'),
          onPressed: () => Navigator.push(
            context,
            MaterialPageRoute(builder: (_) => SettingsPage(session: s)),
          ),
          icon: const Icon(Icons.tune_rounded),
        ),
        PopupMenuButton<bool>(
          onSelected: create,
          itemBuilder: (_) => [
            PopupMenuItem(
              value: false,
              child: Text(s.text('محادثة جديدة', 'New chat')),
            ),
            PopupMenuItem(
              value: true,
              child: Text(s.text('مجموعة جديدة', 'New group')),
            ),
          ],
        ),
      ],
    ),
    floatingActionButton: FloatingActionButton.extended(
      onPressed: () => create(false),
      icon: const Icon(Icons.edit_rounded),
      label: Text(s.text('دز رسالة', 'New message')),
    ),
    body: Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: TextField(
            onChanged: (v) => setState(() => search = v.toLowerCase()),
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search),
              hintText: s.text('دوّر على سوالفك', 'Search your conversations'),
            ),
          ),
        ),
        Expanded(
          child: StreamBuilder(
            stream: s.client.onSync.stream,
            builder: (context, _) {
              final rooms = s.client.rooms
                  .where(
                    (r) =>
                        r.membership != Membership.leave &&
                        r.getLocalizedDisplayname().toLowerCase().contains(
                          search,
                        ),
                  )
                  .toList();
              if (rooms.isEmpty) {
                return Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          Icons.forum_outlined,
                          size: 72,
                          color: Theme.of(context).colorScheme.primary,
                        ),
                        const SizedBox(height: 20),
                        Text(
                          s.text(
                            'السوالف تبدي برسالة',
                            'Every conversation starts with a message',
                          ),
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        const SizedBox(height: 8),
                        Text(
                          s.text(
                            'افتح محادثة باسم مستخدم مسجّل بدَزّة.',
                            'Start a chat with a registered DAZZA username.',
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                );
              }
              return ListView.separated(
                itemCount: rooms.length,
                separatorBuilder: (_, _) =>
                    const Divider(indent: 80, height: 1),
                itemBuilder: (context, i) {
                  final room = rooms[i];
                  final title = room.getLocalizedDisplayname();
                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: 20,
                      vertical: 8,
                    ),
                    leading: CircleAvatar(
                      radius: 26,
                      child: Text(title.isEmpty ? 'D' : title.characters.first),
                    ),
                    title: Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Text(
                      room.membership == Membership.invite
                          ? s.text('دعوة للانضمام', 'Invitation')
                          : room.lastEvent?.body ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    trailing: room.notificationCount > 0
                        ? Badge(label: Text('${room.notificationCount}'))
                        : null,
                    onTap: () => open(room),
                  );
                },
              );
            },
          ),
        ),
      ],
    ),
  );
}
