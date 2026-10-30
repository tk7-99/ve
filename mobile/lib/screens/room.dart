import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:file_picker/file_picker.dart';
import 'package:matrix/matrix.dart';
import 'package:share_plus/share_plus.dart';
import '../session.dart';
import 'common.dart';

class ChatPage extends StatefulWidget {
  final Session session;
  final Room room;
  const ChatPage({super.key, required this.session, required this.room});
  @override
  State<ChatPage> createState() => _ChatPageState();
}

class _ChatPageState extends State<ChatPage> {
  final input = TextEditingController();
  Timeline? timeline;
  Event? reply;
  String? editing;
  bool busy = false;
  bool loadFailed = false;
  String search = '';
  Timer? typing;
  Session get s => widget.session;
  Room get room => widget.room;
  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    try {
      final t = await room.getTimeline(
        onUpdate: () {
          if (mounted) setState(() {});
        },
      );
      if (!mounted) {
        t.cancelSubscriptions();
        return;
      }
      setState(() {
        timeline = t;
        loadFailed = false;
      });
      if (t.events.isNotEmpty) await room.setReadMarker(t.events.first.eventId);
    } catch (e) {
      if (mounted) {
        setState(() => loadFailed = true);
        showFailure(context, s, e);
      }
    }
  }

  @override
  void dispose() {
    typing?.cancel();
    timeline?.cancelSubscriptions();
    input.dispose();
    super.dispose();
  }

  Future<void> action(Future<void> Function() fn) async {
    if (busy) return;
    setState(() => busy = true);
    try {
      await fn();
    } catch (e) {
      if (mounted) showFailure(context, s, e);
    } finally {
      if (mounted) setState(() => busy = false);
    }
  }

  Future<void> send() => action(() async {
    final text = input.text.trim();
    if (text.isEmpty) return;
    s.requireEncryption(room);
    final id = await room.sendTextEvent(
      text,
      inReplyTo: reply,
      editEventId: editing,
    );
    if (id == null) throw const AppFailure('send_failed');
    input.clear();
    if (mounted) {
      setState(() {
        reply = null;
        editing = null;
      });
    }
    await room.setTyping(false);
  });
  Future<void> attach() => action(() async {
    s.requireEncryption(room);
    final result = await FilePicker.platform.pickFiles(withData: true);
    if (result == null) return;
    final file = result.files.single;
    if (file.size > 20 * 1024 * 1024 || file.bytes == null) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              s.text(
                'الحد الأعلى للملف 20 ميغابايت.',
                'Maximum file size is 20 MB.',
              ),
            ),
          ),
        );
      }
      return;
    }
    final id = await room.sendFileEvent(
      MatrixFile(bytes: file.bytes!, name: file.name),
      inReplyTo: reply,
    );
    if (id == null) throw const AppFailure('send_failed');
    if (mounted) setState(() => reply = null);
  });
  Future<void> download(Event event) => action(() async {
    final file = await event.downloadAndDecryptAttachment();
    if (!mounted) return;
    final box = context.findRenderObject() as RenderBox?;
    await SharePlus.instance.share(
      ShareParams(
        files: [
          XFile.fromData(file.bytes, name: file.name, mimeType: file.mimeType),
        ],
        fileNameOverrides: [file.name],
        sharePositionOrigin: box == null
            ? null
            : box.localToGlobal(Offset.zero) & box.size,
      ),
    );
  });
  Future<void> menu(Event event) async {
    final own = event.senderId == s.client.userID;
    final choice = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            for (final item in <String, String>{
              'reply': s.text('رد', 'Reply'),
              'copy': s.text('نسخ', 'Copy'),
              'react': s.text('تفاعل بقلب', 'React with heart'),
              if (own && event.messageType == MessageTypes.Text)
                'edit': s.text('تعديل', 'Edit'),
            }.entries)
              ListTile(
                title: Text(item.value),
                onTap: () => Navigator.pop(context, item.key),
              ),
          ],
        ),
      ),
    );
    if (!mounted || choice == null) return;
    switch (choice) {
      case 'reply':
        setState(() {
          reply = event;
          editing = null;
        });
      case 'copy':
        await Clipboard.setData(ClipboardData(text: event.body));
      case 'react':
        await action(() async {
          s.requireEncryption(room);
          await room.sendReaction(event.eventId, '❤️');
        });
      case 'edit':
        setState(() {
          editing = event.eventId;
          reply = null;
          input.text = event.body;
        });
    }
  }

  Future<void> invite() async {
    final name = await askText(
      context,
      s.text('أضف باسم المستخدم', 'Invite by username'),
    );
    if (name == null || name.isEmpty) return;
    await action(() async {
      await room.invite(await s.resolve(name));
    });
  }

  @override
  Widget build(BuildContext context) {
    final events =
        timeline?.events
            .where(
              (e) =>
                  (e.type == EventTypes.Message ||
                      e.type == EventTypes.Encrypted) &&
                  e.body.toLowerCase().contains(search),
            )
            .toList() ??
        <Event>[];
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              room.getLocalizedDisplayname(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            Text(
              room.encrypted
                  ? s.text(
                      'غرفة مشفّرة • تحقق الأجهزة غير مكتمل',
                      'Encrypted room • device verification pending',
                    )
                  : s.text(
                      'الإرسال متوقف: غرفة غير مشفّرة',
                      'Sending blocked: room not encrypted',
                    ),
              style: Theme.of(context).textTheme.labelSmall,
            ),
          ],
        ),
        actions: [
          IconButton(
            onPressed: invite,
            tooltip: s.text('إضافة عضو', 'Invite member'),
            icon: const Icon(Icons.person_add_outlined),
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(10),
            child: TextField(
              onChanged: (v) => setState(() => search = v.toLowerCase()),
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: s.text(
                  'ابحث بالرسائل المحمّلة',
                  'Search loaded messages',
                ),
              ),
            ),
          ),
          if (loadFailed)
            TextButton(
              onPressed: load,
              child: Text(s.text('إعادة المحاولة', 'Retry')),
            ),
          Expanded(
            child: timeline == null
                ? const Center(child: CircularProgressIndicator())
                : ListView.builder(
                    reverse: true,
                    padding: const EdgeInsets.all(16),
                    itemCount: events.length + 1,
                    itemBuilder: (context, i) {
                      if (i == events.length) {
                        return TextButton(
                          onPressed: busy
                              ? null
                              : () => action(() async {
                                  await timeline!.requestHistory();
                                }),
                          child: Text(s.text('رسائل أقدم', 'Older messages')),
                        );
                      }
                      final event = events[i];
                      final own = event.senderId == s.client.userID;
                      final file = [
                        MessageTypes.File,
                        MessageTypes.Image,
                        MessageTypes.Video,
                        MessageTypes.Audio,
                      ].contains(event.messageType);
                      return Align(
                        alignment: own
                            ? AlignmentDirectional.centerEnd
                            : AlignmentDirectional.centerStart,
                        child: GestureDetector(
                          onLongPress: () => menu(event),
                          child: Container(
                            constraints: BoxConstraints(
                              maxWidth: MediaQuery.sizeOf(context).width * .78,
                            ),
                            margin: const EdgeInsets.symmetric(vertical: 4),
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              color: own
                                  ? Theme.of(
                                      context,
                                    ).colorScheme.primaryContainer
                                  : Theme.of(
                                      context,
                                    ).colorScheme.surfaceContainerHighest,
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                if (!own)
                                  Text(
                                    event.senderFromMemoryOrFallback
                                        .calcDisplayname(),
                                    style: Theme.of(
                                      context,
                                    ).textTheme.labelSmall,
                                  ),
                                if (file)
                                  TextButton.icon(
                                    onPressed: busy
                                        ? null
                                        : () => download(event),
                                    icon: const Icon(Icons.download),
                                    label: Text(event.body),
                                  )
                                else
                                  Text(
                                    event.body,
                                    textDirection:
                                        RegExp(
                                          r'[\u0600-\u06FF]',
                                        ).hasMatch(event.body)
                                        ? TextDirection.rtl
                                        : TextDirection.ltr,
                                  ),
                                const SizedBox(height: 4),
                                Text(
                                  '${TimeOfDay.fromDateTime(event.originServerTs.toLocal()).format(context)}${own ? ' · ${event.status.isSent ? s.text('أرسلت للخادم', 'Sent to server') : s.text('قيد الإرسال أو تعذّر', 'Pending or failed')}' : ''}',
                                  style: Theme.of(context).textTheme.labelSmall,
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    },
                  ),
          ),
          StreamBuilder(
            stream: s.client.onSync.stream,
            builder: (_, _) => room.typingUsers.isEmpty
                ? const SizedBox.shrink()
                : Padding(
                    padding: const EdgeInsets.all(8),
                    child: Text(s.text('يكتب الآن…', 'Typing…')),
                  ),
          ),
          if (reply != null || editing != null)
            ListTile(
              title: Text(
                editing != null
                    ? s.text('تعديل الرسالة', 'Editing message')
                    : reply!.body,
                maxLines: 1,
              ),
              trailing: IconButton(
                onPressed: () => setState(() {
                  reply = null;
                  editing = null;
                }),
                icon: const Icon(Icons.close),
              ),
            ),
          if (busy) const LinearProgressIndicator(),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  IconButton(
                    onPressed: busy ? null : attach,
                    tooltip: s.text('إرسال ملف', 'Send file'),
                    icon: const Icon(Icons.attach_file),
                  ),
                  Expanded(
                    child: TextField(
                      controller: input,
                      minLines: 1,
                      maxLines: 5,
                      onChanged: (_) {
                        typing?.cancel();
                        typing = Timer(
                          const Duration(milliseconds: 500),
                          () async {
                            try {
                              await room.setTyping(
                                input.text.isNotEmpty,
                                timeout: 5000,
                              );
                            } catch (_) {
                              /* Presence is best effort. */
                            }
                          },
                        );
                      },
                      decoration: InputDecoration(
                        hintText: s.text('دز رسالة…', 'Send a message…'),
                      ),
                    ),
                  ),
                  IconButton.filled(
                    onPressed: busy ? null : send,
                    tooltip: s.text('إرسال', 'Send'),
                    icon: const Icon(Icons.send_rounded),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
