import 'dart:async';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:file_picker/file_picker.dart';
import 'package:matrix/matrix.dart';
import 'package:just_audio/just_audio.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';
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
  final Map<String, Future<MatrixFile?>> attachmentCache = {};
  final AudioRecorder recorder = AudioRecorder();
  Timer? recordingTimer;
  int recordingSeconds = 0;
  bool isRecording = false;
  String? recordingPath;
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
    recordingTimer?.cancel();
    unawaited(_cleanupRecorder());
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
      MatrixFile.fromMimeType(
        bytes: file.bytes!,
        name: file.name,
        mimeType: mimeTypeForName(file.name),
      ),
      inReplyTo: reply,
    );
    if (id == null) throw const AppFailure('send_failed');
    if (mounted) setState(() => reply = null);
  });

  Future<void> _cleanupRecorder() async {
    try {
      if (isRecording) await recorder.cancel();
    } catch (_) {}
    try {
      await recorder.dispose();
    } catch (_) {}
    final path = recordingPath;
    if (path != null) {
      try {
        final file = File(path);
        if (await file.exists()) await file.delete();
      } catch (_) {}
    }
  }

  Future<void> toggleVoiceRecording() => action(() async {
    if (!isRecording) {
      s.requireEncryption(room);
      if (!await recorder.hasPermission()) {
        throw const AppFailure('microphone_permission_denied');
      }
      final directory = await getTemporaryDirectory();
      final path = p.join(
        directory.path,
        'dazza-voice-${DateTime.now().microsecondsSinceEpoch}.m4a',
      );
      await recorder.start(
        const RecordConfig(
          encoder: AudioEncoder.aacLc,
          bitRate: 96000,
          sampleRate: 44100,
        ),
        path: path,
      );
      recordingPath = path;
      recordingSeconds = 0;
      if (mounted) setState(() => isRecording = true);
      recordingTimer?.cancel();
      recordingTimer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() => recordingSeconds++);
      });
      return;
    }

    recordingTimer?.cancel();
    final path = await recorder.stop();
    if (mounted) setState(() => isRecording = false);
    if (path == null) throw const AppFailure('voice_record_failed');
    final file = File(path);
    try {
      final bytes = await file.readAsBytes();
      if (bytes.length > 20 * 1024 * 1024) {
        throw const AppFailure('voice_too_large');
      }
      final id = await room.sendFileEvent(
        MatrixFile.fromMimeType(
          bytes: bytes,
          name: 'voice_message_${recordingSeconds}s.m4a',
          mimeType: 'audio/mp4',
        ),
        inReplyTo: reply,
      );
      if (id == null) throw const AppFailure('send_failed');
      if (mounted) setState(() => reply = null);
    } finally {
      if (await file.exists()) await file.delete();
      recordingPath = null;
    }
  });

  Widget _audioAttachment(Event event) => _AudioAttachmentPlayer(
    label: s.text('رسالة صوتية', 'Voice message'),
    loadAttachment: () => attachment(event),
    text: (arabic, english) => s.text(arabic, english),
    onShare: () => download(event),
  );

  Future<MatrixFile?> attachment(Event event) =>
      attachmentCache.putIfAbsent(event.eventId, () async {
        try {
          return await event.downloadAndDecryptAttachment();
        } catch (_) {
          return null;
        }
      });

  Future<void> download(Event event) => action(() async {
    final file = await attachment(event);
    if (file == null) throw const AppFailure('attachment_download_failed');
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


  Widget _imageAttachment(Event event) => FutureBuilder<MatrixFile?>(
    future: attachment(event),
    builder: (context, snapshot) {
      if (snapshot.connectionState == ConnectionState.waiting) {
        return const SizedBox(
          width: 220,
          height: 160,
          child: Center(child: CircularProgressIndicator()),
        );
      }
      final media = snapshot.data;
      if (media == null) {
        return TextButton.icon(
          onPressed: () {
            setState(() => attachmentCache.remove(event.eventId));
          },
          icon: const Icon(Icons.refresh),
          label: Text(s.text('تعذّر تحميل الصورة — أعد المحاولة', 'Image failed to load — retry')),
        );
      }
      return GestureDetector(
        onTap: busy ? null : () => download(event),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(14),
          child: Image.memory(
            media.bytes,
            width: 260,
            fit: BoxFit.cover,
            cacheWidth: 900,
            errorBuilder: (_, _, _) => SizedBox(
              width: 220,
              height: 140,
              child: Center(
                child: Text(s.text('تعذّر عرض الصورة', 'Unable to display image')),
              ),
            ),
          ),
        ),
      );
    },
  );

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
                                if (event.messageType == MessageTypes.Audio)
                                  _audioAttachment(event)
                                else if (event.messageType == MessageTypes.Image)
                                  _imageAttachment(event)
                                else if (file)
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
                    onPressed: busy || isRecording ? null : attach,
                    tooltip: s.text('إرسال ملف', 'Send file'),
                    icon: const Icon(Icons.attach_file),
                  ),
                  IconButton(
                    onPressed: busy ? null : toggleVoiceRecording,
                    tooltip: s.text(
                      isRecording ? 'إيقاف التسجيل وإرساله' : 'تسجيل رسالة صوتية',
                      isRecording ? 'Stop and send voice message' : 'Record a voice message',
                    ),
                    color: isRecording ? Theme.of(context).colorScheme.error : null,
                    icon: Icon(isRecording ? Icons.stop_circle : Icons.mic_none),
                  ),
                  if (isRecording)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 14),
                      child: Text('${recordingSeconds}s'),
                    ),
                  Expanded(
                    child: TextField(
                      controller: input,
                      enabled: !isRecording,
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
                    onPressed: busy || isRecording ? null : send,
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

 
String mimeTypeForName(String name) {
  final extension = name.split('.').last.toLowerCase();
  return switch (extension) {
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'gif' => 'image/gif',
    'webp' => 'image/webp',
    'bmp' => 'image/bmp',
    'heic' => 'image/heic',
    'mp4' => 'video/mp4',
    'mov' => 'video/quicktime',
    'm4v' => 'video/x-m4v',
    'mp3' => 'audio/mpeg',
    'm4a' => 'audio/mp4',
    'aac' => 'audio/aac',
    'ogg' => 'audio/ogg',
    'wav' => 'audio/wav',
    'pdf' => 'application/pdf',
    'txt' => 'text/plain',
    _ => 'application/octet-stream',
  };
}


class _AudioAttachmentPlayer extends StatefulWidget {
  final String label;
  final Future<MatrixFile?> Function() loadAttachment;
  final String Function(String arabic, String english) text;
  final VoidCallback onShare;

  const _AudioAttachmentPlayer({
    required this.label,
    required this.loadAttachment,
    required this.text,
    required this.onShare,
  });

  @override
  State<_AudioAttachmentPlayer> createState() => _AudioAttachmentPlayerState();
}

class _AudioAttachmentPlayerState extends State<_AudioAttachmentPlayer> {
  late final AudioPlayer player;
  String? temporaryPath;
  bool loading = false;
  String? error;

  @override
  void initState() {
    super.initState();
    player = AudioPlayer();
  }

  Future<void> toggle() async {
    if (loading) return;
    setState(() {
      loading = true;
      error = null;
    });
    try {
      if (player.playing) {
        await player.pause();
        return;
      }
      if (temporaryPath == null) {
        final media = await widget.loadAttachment();
        if (media == null) throw StateError('attachment unavailable');
        final directory = await getTemporaryDirectory();
        final extension = audioExtensionForMime(media.mimeType);
        final file = File(p.join(
          directory.path,
          'dazza-playback-${DateTime.now().microsecondsSinceEpoch}$extension',
        ));
        await file.writeAsBytes(media.bytes, flush: true);
        temporaryPath = file.path;
        await player.setFilePath(file.path);
      }
      if (player.processingState == ProcessingState.completed) {
        await player.seek(Duration.zero);
      }
      unawaited(player.play());
    } catch (_) {
      error = widget.text(
        'تعذّر تشغيل الرسالة الصوتية.',
        'Could not play this voice message.',
      );
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  @override
  void dispose() {
    unawaited(player.dispose());
    final path = temporaryPath;
    if (path != null) {
      unawaited(() async {
        try {
          final file = File(path);
          if (await file.exists()) await file.delete();
        } catch (_) {}
      }());
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      IconButton(
        onPressed: loading ? null : toggle,
        icon: loading
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(strokeWidth: 2),
              )
            : StreamBuilder<PlayerState>(
                stream: player.playerStateStream,
                builder: (context, snapshot) {
                  final playing = snapshot.data?.playing ?? false;
                  final completed = snapshot.data?.processingState ==
                      ProcessingState.completed;
                  return Icon(
                    completed
                        ? Icons.replay
                        : playing
                            ? Icons.pause_circle
                            : Icons.play_circle,
                  );
                },
              ),
      ),
      Flexible(
        child: Text(
          error ?? widget.label,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ),
      IconButton(
        onPressed: loading ? null : widget.onShare,
        tooltip: widget.text('مشاركة الملف الصوتي', 'Share audio file'),
        icon: const Icon(Icons.share_outlined, size: 18),
      ),
    ],
  );
}

String audioExtensionForMime(String mimeType) {
  return switch (mimeType.toLowerCase()) {
    'audio/mp4' || 'audio/x-m4a' => '.m4a',
    'audio/mpeg' || 'audio/mp3' => '.mp3',
    'audio/aac' => '.aac',
    'audio/ogg' || 'application/ogg' => '.ogg',
    'audio/wav' || 'audio/x-wav' => '.wav',
    'audio/webm' => '.webm',
    _ => '.audio',
  };
}
