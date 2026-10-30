const $ = (selector, scope = document) => scope.querySelector(selector);
const esc = (value = "") => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

let runtime = {};
let activeRoom = null;
let roomChannel = null;
let roomMembers = [];
let roomHeartbeat = null;
let heartbeatBusy = false;
let heartbeatFailures = 0;
let currentQuizQuestionIndex = null;
const answeredQuizQuestions = new Set();
const hostQuizAnswers = new Set();
let localStream = null;
let voiceEnabled = false;
let muted = false;
let watchPlayer = null;
let watchTicker = null;
let remoteSyncUntil = 0;
const peers = new Map();
const remoteAudio = new Map();
const pendingCandidates = new Map();
const chatIds = new Set();

const YT_QUESTIONS = [
  { q: "ما هو الكوكب المعروف بالكوكب الأحمر؟", a: ["المريخ", "الزهرة", "زحل"], correct: 0 },
  { q: "كم عدد أضلاع المثلث؟", a: ["أربعة", "ثلاثة", "خمسة"], correct: 1 },
  { q: "ما عاصمة العراق؟", a: ["البصرة", "الموصل", "بغداد"], correct: 2 },
  { q: "أي حيوان يُعرف بسفينة الصحراء؟", a: ["الجمل", "الحصان", "الغزال"], correct: 0 },
  { q: "كم دقيقة في الساعة؟", a: ["50", "60", "100"], correct: 1 }
];

export function configureSocialWorld(options) {
  runtime = options || {};
}

function notify(message, type = "info") {
  runtime.notify?.(message, type);
}

function youtubeId(value) {
  const raw = String(value || "").trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (host === "youtu.be" || host === "www.youtu.be") {
      const id = url.pathname.split("/").filter(Boolean)[0] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
    }
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
      const parts = url.pathname.split("/").filter(Boolean);
      const candidate = url.pathname === "/watch"
        ? (url.searchParams.get("v") || "")
        : (() => {
            const marker = parts.findIndex(part => ["embed", "shorts", "live"].includes(part));
            return marker >= 0 ? (parts[marker + 1] || "") : "";
          })();
      return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : "";
    }
  } catch { /* invalid URL */ }
  return "";
}

export async function renderSocialWorld() {
  const supabase = runtime.supabase;
  const [roomsResult, challengesResult, myChallengesResult] = await Promise.all([
    supabase.from("dazza_rooms").select("id,room_type,title,host_id,video_id,game_key,max_members,created_at,expires_at").eq("status", "open").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(30),
    supabase.from("dazza_challenges").select("*").eq("status", "open").order("created_at", { ascending: false }).limit(30),
    supabase.from("dazza_challenge_participants").select("challenge_id,status,progress").eq("user_id", runtime.user.id)
  ]);
  if (roomsResult.error) throw roomsResult.error;
  if (challengesResult.error) throw challengesResult.error;
  if (myChallengesResult.error) throw myChallengesResult.error;

  const rooms = roomsResult.data || [];
  const challenges = challengesResult.data || [];
  const profilesById = await loadProfiles([...rooms.map(item => item.host_id), ...challenges.map(item => item.created_by)]);
  const joined = new Map((myChallengesResult.data || []).map(item => [item.challenge_id, item]));
  const roomCards = rooms.map(item => {
    const host = profilesById[item.host_id] || {};
    const kind = item.room_type === "voice" ? "غرفة صوتية" : item.room_type === "watch" ? "مشاهدة جماعية" : "غرفة ألعاب";
    const icon = item.room_type === "voice" ? "◖" : item.room_type === "watch" ? "▷" : "✦";
    const extras = item.room_type === "watch" ? "يوتيوب مع الأصدقاء" : item.room_type === "game" ? "تحديات ولعب جماعي" : "تحدث مباشرة مع الموجودين";
    return '<article class="social-room-card"><div class="social-room-top"><span class="social-room-icon">' + icon + '</span><span class="social-live-label">مفتوحة</span></div><small>' + kind + '</small><h3>' + esc(item.title) + '</h3><p>' + extras + '</p><div class="social-room-meta"><span>المضيف: ' + esc(host.display_name || "عضو دَزّة") + '</span><span>حتى ' + item.max_members + ' أعضاء</span></div><button class="btn-primary full" data-action="social-open-room" data-id="' + item.id + '">دخول الغرفة</button></article>';
  }).join("");

  const challengeCards = challenges.map(item => {
    const host = profilesById[item.created_by] || {};
    const mine = joined.get(item.id);
    const action = mine
      ? (mine.status === "completed"
        ? '<span class="social-completed">أنجزت التحدي</span>'
        : '<button class="btn-secondary" data-action="social-complete-challenge" data-id="' + item.id + '" data-target="' + item.target_count + '">تسجيل الإنجاز</button>')
      : '<button class="btn-primary" data-action="social-join-challenge" data-id="' + item.id + '">انضم للتحدي</button>';
    return '<article class="social-challenge-card"><div class="social-challenge-head"><span class="social-challenge-tag">' + esc(challengeTypeLabel(item.challenge_type)) + '</span><span class="social-points">' + item.reward_points + ' نقطة رمزية</span></div><h3>' + esc(item.title) + '</h3><p>' + esc(item.description || "تحدٍّ من مجتمع دَزّة") + '</p><div class="social-room-meta"><span>بواسطة ' + esc(host.display_name || "عضو") + '</span><span>الهدف ' + item.target_count + '</span></div><div class="social-challenge-action">' + action + '</div></article>';
  }).join("");

  runtime.showContent('<div class="social-hub-page"><section class="social-hub-hero"><div><span class="promo-kicker">DAZZA SOCIAL PLAY</span><h1>مكانكم يجمعكم.</h1><p>افتح غرفة صوت، شاهدوا مقطعاً سوية، العبوا وتحدّوا بعضكم، أو اصنعوا تحدياً للمجتمع.</p><div class="social-hub-stats"><span><b>' + rooms.length + '</b><small>غرف مفتوحة</small></span><span><b>' + challenges.length + '</b><small>تحديات نشطة</small></span><span><b>24/7</b><small>مساحتكم</small></span></div></div><div class="social-hub-orb">دَزّة<small>TOGETHER</small></div></section><div class="social-feature-shortcuts"><button data-action="social-focus-create" data-focus="voice">◖<strong>غرفة صوت</strong><small>سوالف مباشرة</small></button><button data-action="social-focus-create" data-focus="watch">▷<strong>مشاهدة جماعية</strong><small>مقطع واحد للجميع</small></button><button data-action="social-focus-create" data-focus="game">✦<strong>غرفة ألعاب</strong><small>تحدّوا أصدقاءكم</small></button><button data-action="social-go-games">🎮<strong>الألعاب الفردية</strong><small>العب وتدرّب</small></button></div><section class="social-create-panel"><div class="page-heading"><div><h2>أنشئ غرفة جديدة</h2><p>الغرف العامة تظهر للأعضاء المسجلين في دَزّة.</p></div><span class="free-pill">مجاناً</span></div><form id="social-room-create-form" class="social-create-form"><label>اسم الغرفة<input name="title" required minlength="2" maxlength="80" placeholder="مثلاً: سهرة الجمعة"></label><label>نوع الغرفة<select name="room_type"><option value="voice">غرفة صوتية</option><option value="watch">مشاهدة مقاطع</option><option value="game">ألعاب وتحديات</option></select></label><label class="social-video-field">رابط يوتيوب للمشاهدة<input name="video_url" type="url" placeholder="https://www.youtube.com/watch?v=..."></label><label>عدد المشاركين<select name="max_members"><option value="4">4 أعضاء</option><option value="6" selected>6 أعضاء</option><option value="8">8 أعضاء</option><option value="12">12 عضواً</option></select></label><button class="btn-primary" type="submit">إنشاء الغرفة وفتحها</button></form><p class="social-form-hint">الغرف الصوتية تستخدم اتصالاً مباشراً بين الأجهزة؛ جودة الاتصال تعتمد على الشبكة وإمكانية الوصول بين الأجهزة.</p></section><section class="social-section"><div class="page-heading"><div><h2>الغرف المفتوحة</h2><p>ادخل مع أعضاء آخرين أو أنشئ غرفتك.</p></div><button class="btn-secondary" data-action="social-refresh">تحديث</button></div><div class="social-room-grid">' + (roomCards || '<div class="social-empty">ماكو غرف مفتوحة حالياً. كن أول واحد يفتح غرفة.</div>') + '</div></section><section class="social-create-panel social-challenge-create"><div class="page-heading"><div><h2>أنشئ تحدياً للمجتمع</h2><p>حدّد المطلوب، وخلي الأصدقاء يشاركونك الإنجاز.</p></div></div><form id="social-challenge-create-form" class="social-create-form"><label>عنوان التحدي<input name="title" required minlength="3" maxlength="90" placeholder="مثلاً: خمس جولات خلال اليوم"></label><label>التصنيف<select name="challenge_type"><option value="general">عام</option><option value="games">ألعاب</option><option value="creative">إبداع</option><option value="learning">تعلم</option><option value="social">اجتماعي</option><option value="fitness">نشاط</option></select></label><label>التفاصيل<input name="description" maxlength="500" placeholder="اكتب شروط التحدي باختصار"></label><label>عدد مرات الإنجاز<input type="number" name="target_count" min="1" max="1000" value="1" required></label><label>نقاط رمزية<input type="number" name="reward_points" min="0" max="10000" value="10" required></label><button class="btn-primary" type="submit">نشر التحدي</button></form></section><section class="social-section"><div class="page-heading"><div><h2>تحديات المجتمع</h2><p>انضم إلى التحديات وسجّل تقدمك.</p></div></div><div class="social-challenge-grid">' + (challengeCards || '<div class="social-empty">لا توجد تحديات حالياً. أنشئ أول تحدٍّ.</div>') + '</div></section><section class="social-feature-note"><strong>ميزات المساحة الاجتماعية</strong><p>محادثة داخل كل غرفة، قائمة حضور مباشرة، كتم الميكروفون، مزامنة تشغيل وإيقاف يوتيوب للمضيف، وتحديات تحفظ اشتراكك وتقدمك في حسابك.</p></section></div>');
  const roomTypeSelect = $('select[name="room_type"]', $("#social-room-create-form"));
  const videoField = $(".social-video-field");
  const updateVideoField = () => { if (videoField) videoField.hidden = roomTypeSelect?.value !== "watch"; };
  roomTypeSelect?.addEventListener("change", updateVideoField);
  updateVideoField();
}

function challengeTypeLabel(type) {
  return ({ general: "عام", games: "ألعاب", fitness: "نشاط", creative: "إبداع", learning: "تعلم", social: "اجتماعي" })[type] || "عام";
}

async function loadProfiles(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const { data, error } = await runtime.supabase.from("profiles").select("id,username,display_name,avatar_path").in("id", unique);
  if (error) throw error;
  return Object.fromEntries((data || []).map(item => [item.id, item]));
}

function roomTopic(id) {
  return "dazza:room:" + id;
}

async function openSocialRoom(roomId) {
  if (activeRoom) await closeRealtime();
  const { data: room, error } = await runtime.supabase.from("dazza_rooms").select("*").eq("id", roomId).maybeSingle();
  if (error) throw error;
  if (!room || room.status !== "open" || !room.expires_at || new Date(room.expires_at).getTime() <= Date.now()) {
    throw new Error("هذه الغرفة مغلقة أو انتهت صلاحيتها.");
  }
  const { data: membership, error: membershipError } = await runtime.supabase.from("dazza_room_members").select("role").eq("room_id", room.id).eq("user_id", runtime.user.id).maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) {
    const { error: joinError } = await runtime.supabase.from("dazza_room_members").insert({
      room_id: room.id, user_id: runtime.user.id, role: room.host_id === runtime.user.id ? "host" : "member"
    });
    if (joinError) throw joinError;
  } else {
    const { data: refreshed, error: refreshError } = await runtime.supabase.from("dazza_room_members")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("room_id", room.id).eq("user_id", runtime.user.id)
      .select("room_id").maybeSingle();
    if (refreshError) throw refreshError;
    if (!refreshed) throw new Error("انتهت عضويتك في هذه الغرفة. حاول الدخول مجدداً.");
  }
  activeRoom = room;
  roomMembers = [];
  chatIds.clear();
  try {
    await renderRoomPage();
    await connectRoomChannel();
  } catch (error) {
    const failedRoomId = activeRoom?.id || room.id;
    await runtime.supabase.from("dazza_room_members").delete()
      .eq("room_id", failedRoomId).eq("user_id", runtime.user.id);
    await closeRealtime();
    activeRoom = null;
    await renderSocialWorld();
    throw error;
  }
}

export async function openSharedSocialRoom(roomId) { return openSocialRoom(roomId); }

async function createSocialRoom(data) {
  const title = String(data.get("title") || "").trim();
  const roomType = String(data.get("room_type") || "voice");
  const maxMembers = Number(data.get("max_members") || 6);
  if (title.length < 2 || title.length > 80) throw new Error("اسم الغرفة يجب أن يكون بين حرفين و80 حرفاً.");
  if (!["voice", "watch", "game"].includes(roomType)) throw new Error("نوع الغرفة غير صالح.");
  if (!Number.isInteger(maxMembers) || maxMembers < 2 || maxMembers > 12) throw new Error("عدد المشاركين يجب أن يكون بين 2 و12.");
  const max = roomType === "voice" ? Math.min(maxMembers, 6) : maxMembers;
  let videoId = null;
  if (roomType === "watch") {
    videoId = youtubeId(data.get("video_url"));
    if (!videoId) throw new Error("أدخل رابط يوتيوب صحيحاً لمقطع صالح.");
  }
  const gameKey = roomType === "game" ? "quick-quiz" : null;
  const { data: room, error } = await runtime.supabase.from("dazza_rooms").insert({
    room_type: roomType, title, host_id: runtime.user.id, video_id: videoId,
    game_key: gameKey, max_members: max, status: "open"
  }).select("*").single();
  if (error) throw error;
  const { error: memberError } = await runtime.supabase.from("dazza_room_members").insert({
    room_id: room.id, user_id: runtime.user.id, role: "host"
  });
  if (memberError) {
    await runtime.supabase.from("dazza_rooms").delete().eq("id", room.id);
    throw memberError;
  }
  notify("تم إنشاء الغرفة. شاركها مع أصدقائك.");
  await openSocialRoom(room.id);
}

async function createChallenge(data) {
  const title = String(data.get("title") || "").trim();
  const description = String(data.get("description") || "").trim();
  const target = Number(data.get("target_count") || 1);
  const points = Number(data.get("reward_points") || 0);
  const type = String(data.get("challenge_type") || "general");
  if (title.length < 3) throw new Error("اكتب عنواناً أوضح للتحدي.");
  if (!Number.isInteger(target) || target < 1 || target > 1000) throw new Error("هدف التحدي غير صالح.");
  if (!Number.isInteger(points) || points < 0 || points > 10000) throw new Error("عدد النقاط غير صالح.");
  const { error } = await runtime.supabase.from("dazza_challenges").insert({
    created_by: runtime.user.id, title, description, challenge_type: type,
    target_count: target, reward_points: points, status: "open"
  });
  if (error) throw error;
  notify("تم نشر التحدي للمجتمع.");
  await renderSocialWorld();
}

export async function handleSocialSubmit(event) {
  const form = event.target;
  if (!form?.matches?.("form")) return false;
  if (!["social-room-create-form", "social-challenge-create-form", "social-room-chat-form"].includes(form.id)) return false;
  event.preventDefault();
  const data = new FormData(form);
  const button = $('button[type="submit"]', form);
  if (button) button.disabled = true;
  try {
    if (form.id === "social-room-create-form") {
      await createSocialRoom(data);
      return true;
    }
    if (form.id === "social-challenge-create-form") {
      await createChallenge(data);
      form.reset();
      return true;
    }
    if (form.id === "social-room-chat-form") {
      const body = String(data.get("body") || "").trim().slice(0, 500);
      if (!body || !activeRoom) return true;
      const { data: message, error } = await runtime.supabase.from("dazza_room_messages").insert({
        room_id: activeRoom.id, user_id: runtime.user.id, body
      }).select("*").single();
      if (error) throw error;
      const ownMessage = { ...message, display_name: runtime.profile?.display_name || "أنا" };
      appendRoomMessage(ownMessage);
      form.reset();
      $('input[name="body"]', form)?.focus();
      if (roomChannel) {
        try {
          await roomChannel.send({ type: "broadcast", event: "room-chat", payload: ownMessage });
        } catch (broadcastError) {
          console.warn("Room message saved but realtime delivery failed:", broadcastError);
          notify("تم حفظ الرسالة، وقد تتأخر بالظهور عند بقية الأعضاء.");
        }
      }
      return true;
    }
  } finally {
    if (button && button.isConnected) button.disabled = false;
  }
  return true;
}

export async function handleSocialAction(action, node) {
  if (!action || !action.startsWith("social-")) return false;
  if (action === "social-refresh") { await renderSocialWorld(); return true; }
  if (action === "social-focus-create") {
    const form = $("#social-room-create-form");
    if (form) {
      const select = $('select[name="room_type"]', form);
      if (select) select.value = node.dataset.focus || "voice";
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      $('input[name="title"]', form)?.focus();
    }
    return true;
  }
  if (action === "social-go-games") {
    runtime.navigate?.("games");
    return true;
  }
  if (action === "social-open-room") {
    await openSocialRoom(node.dataset.id);
    return true;
  }
  if (action === "social-join-challenge") {
    const { error } = await runtime.supabase.from("dazza_challenge_participants").insert({
      challenge_id: node.dataset.id, user_id: runtime.user.id, status: "joined"
    });
    if (error && error.code !== "23505") throw error;
    notify(error ? "أنت منضم لهذا التحدي بالفعل." : "انضممت للتحدي. بالتوفيق!");
    await renderSocialWorld();
    return true;
  }
  if (action === "social-complete-challenge") {
    const { error } = await runtime.supabase.from("dazza_challenge_participants").update({
      progress: Number(node.dataset.target || 1), status: "completed", completed_at: new Date().toISOString()
    }).eq("challenge_id", node.dataset.id).eq("user_id", runtime.user.id);
    if (error) throw error;
    notify("تم تسجيل إنجازك. النقاط المعروضة رمزية وليست رصيداً قابلاً للسحب.");
    await renderSocialWorld();
    return true;
  }
  if (action === "social-room-leave") {
    await leaveSocialRoom();
    return true;
  }
  if (action === "social-room-copy") {
    const url = location.origin + location.pathname + "?room=" + encodeURIComponent(activeRoom?.id || "");
    try { await navigator.clipboard.writeText(url); notify("تم نسخ رابط الغرفة."); }
    catch { notify(url); }
    return true;
  }
  if (action === "social-voice-toggle") {
    await toggleVoice();
    return true;
  }
  if (action === "social-voice-mute") {
    muted = !muted;
    localStream?.getAudioTracks().forEach(track => { track.enabled = !muted; });
    await updatePresence();
    const button = $('[data-action="social-voice-mute"]');
    if (button) button.textContent = muted ? "إلغاء كتم الميكروفون" : "كتم الميكروفون";
    return true;
  }
  if (action === "social-watch-control") {
    const mode = node.dataset.mode;
    if (!watchPlayer) return true;
    if (mode === "play") watchPlayer.playVideo();
    else if (mode === "pause") watchPlayer.pauseVideo();
    else if (mode === "sync") sendWatchState();
    return true;
  }
  if (action === "social-quiz-start") {
    if (activeRoom?.host_id !== runtime.user.id) return true;
    const index = Math.floor(Math.random() * YT_QUESTIONS.length);
    const state = { questionIndex: index, answers: [] };
    currentQuizQuestionIndex = index;
    answeredQuizQuestions.clear();
    hostQuizAnswers.clear();
    renderRoomQuiz(state);
    await roomChannel?.send({ type: "broadcast", event: "quiz-state", payload: state });
    return true;
  }
  if (action === "social-quiz-answer") {
    const index = Number(node.dataset.answer);
    const questionIndex = Number(node.dataset.question);
    const question = YT_QUESTIONS[questionIndex];
    if (!question || !Number.isInteger(index) || index < 0 || index >= question.a.length) return true;
    if (answeredQuizQuestions.has(questionIndex)) return true;
    answeredQuizQuestions.add(questionIndex);
    $("#social-room-quiz")?.querySelectorAll("button[data-action='social-quiz-answer']").forEach(button => { button.disabled = true; });
    await roomChannel?.send({
      type: "broadcast", event: "quiz-answer",
      payload: { userId: runtime.user.id, displayName: runtime.profile?.display_name || "عضو", questionIndex, answerIndex: index }
    });
    notify("تم إرسال إجابتك. بانتظار تأكيد المضيف.");
    return true;
  }
  return false;
}

async function connectRoomChannel() {
  if (!activeRoom) return;
  if (roomHeartbeat) { clearInterval(roomHeartbeat); roomHeartbeat = null; }
  if (roomChannel) await runtime.supabase.removeChannel(roomChannel);
  const channel = runtime.supabase.channel(roomTopic(activeRoom.id), {
    config: { private: true, presence: { key: runtime.user.id }, broadcast: { ack: true } }
  });
  roomChannel = channel;
  channel
    .on("presence", { event: "sync" }, syncRoomPresence)
    .on("presence", { event: "join" }, syncRoomPresence)
    .on("presence", { event: "leave" }, syncRoomPresence)
    .on("broadcast", { event: "room-chat" }, event => {
      const payload = event?.payload || event;
      if (payload?.user_id !== runtime.user.id) appendRoomMessage(payload);
    })
    .on("broadcast", { event: "rtc-signal" }, event => handleRtcSignal(event?.payload || event))
    .on("broadcast", { event: "watch-state" }, event => applyWatchState(event?.payload || event))
    .on("broadcast", { event: "room-closed" }, async () => {
      notify("أغلق المضيف هذه الغرفة.");
      await closeRealtime();
      activeRoom = null;
      await renderSocialWorld();
    })
    .on("broadcast", { event: "quiz-state" }, event => {
      const state = event?.payload || event;
      answeredQuizQuestions.clear();
      currentQuizQuestionIndex = state?.questionIndex ?? null;
      renderRoomQuiz(state);
    })
    .on("broadcast", { event: "quiz-answer" }, async event => {
      const payload = event?.payload || event;
      if (activeRoom?.host_id !== runtime.user.id) return;
      const question = YT_QUESTIONS[Number(payload.questionIndex)];
      const answerIndex = Number(payload.answerIndex);
      if (!question || !payload.userId || !Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= question.a.length) return;
      const answerKey = String(payload.questionIndex) + ":" + payload.userId;
      if (hostQuizAnswers.has(answerKey)) return;
      hostQuizAnswers.add(answerKey);
      const correct = answerIndex === question.correct;
      await roomChannel?.send({
        type: "broadcast", event: "quiz-answer-result",
        payload: { userId: payload.userId, correct, questionIndex: payload.questionIndex }
      });
      notify((payload.displayName || "عضو") + (correct ? " أجاب بشكل صحيح." : " إجابته غير صحيحة."));
    })
    .on("broadcast", { event: "quiz-answer-result" }, event => {
      const payload = event?.payload || event;
      if (payload?.userId === runtime.user.id) {
        notify(payload.correct ? "إجابة صحيحة!" : "إجابة غير صحيحة، جرّب بالسؤال القادم.");
      }
    });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("انتهت مهلة الاتصال بالغرفة. تحقق من اتصال الإنترنت.")), 15000);
    channel.subscribe(status => {
      if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timeout);
        reject(new Error("تعذر الاتصال الفوري بالغرفة. تأكد من سياسات Realtime."));
      }
    });
  });
  const activePresenceCount = roomPresenceState().length;
  if (activePresenceCount >= activeRoom.max_members && activeRoom.host_id !== runtime.user.id) {
    await runtime.supabase.from("dazza_room_members").delete().eq("room_id", activeRoom.id).eq("user_id", runtime.user.id);
    await runtime.supabase.removeChannel(channel);
    roomChannel = null;
    throw new Error("الغرفة مكتملة حالياً. جرّب غرفة أخرى أو أنشئ غرفتك.");
  }
  await heartbeatRoom();
  if (!activeRoom || !roomChannel) throw new Error("انتهى اتصالك بالغرفة.");
  heartbeatFailures = 0;
  roomHeartbeat = setInterval(async () => {
    try {
      const renewed = await heartbeatRoom();
      if (!renewed) throw new Error("انتهت عضويتك في الغرفة.");
      heartbeatFailures = 0;
    } catch (error) {
      heartbeatFailures++;
      console.warn("Room heartbeat:", error);
      if (heartbeatFailures >= 4 && activeRoom) {
        try {
          await leaveSocialRoom({ refresh: false, announce: false });
        } catch (leaveError) {
          console.warn("Could not finalize the expired room session:", leaveError);
          await closeRealtime();
          activeRoom = null;
        }
        notify("انقطع اتصال الغرفة. يمكنك العودة من قائمة الغرف.");
        await runtime.navigate?.("social");
      }
    }
  }, 25000);
  await updatePresence();
  await loadRoomChat();
  syncRoomPresence();
  if (activeRoom.room_type === "watch") await initializeWatchPlayer();
  if (activeRoom.room_type === "game") renderRoomQuiz(null);
}

function roomPresenceState() {
  if (!roomChannel) return [];
  const all = Object.values(roomChannel.presenceState() || {}).flat();
  const unique = new Map();
  for (const item of all) if (item?.userId) unique.set(item.userId, item);
  return [...unique.values()];
}

async function updatePresence() {
  if (!roomChannel || !runtime.user) return;
  await roomChannel.track({
    userId: runtime.user.id,
    displayName: runtime.profile?.display_name || "عضو",
    username: runtime.profile?.username || "",
    voice: !!voiceEnabled,
    muted: !!muted,
    joinedAt: new Date().toISOString()
  });
}

function syncRoomPresence() {
  roomMembers = roomPresenceState();
  const node = $("#social-room-presence");
  if (node) {
    node.innerHTML = roomMembers.map(member => '<span class="social-presence-person"><i class="' + (member.voice ? "online" : "") + '"></i>' + esc(member.displayName || "عضو") + (member.voice ? ' <small>بالصوت</small>' : '') + '</span>').join("") || '<small>بانتظار المشاركين...</small>';
  }
  const count = $("#social-room-count");
  if (count) count.textContent = roomMembers.length + " / " + (activeRoom?.max_members || 6);
  if (voiceEnabled) syncVoicePeers();
}

async function renderRoomPage() {
  if (!activeRoom) return;
  const room = activeRoom;
  const isHost = room.host_id === runtime.user.id;
  const participants = roomPresenceState();
  const messagesResult = await runtime.supabase.from("dazza_room_messages").select("*").eq("room_id", room.id).order("created_at", { ascending: false }).limit(80);
  if (messagesResult.error) throw messagesResult.error;
  const messages = (messagesResult.data || []).reverse();
  const profiles = await loadProfiles(messages.map(item => item.user_id));
  const chatHTML = messages.map(item => {
    chatIds.add(item.id);
    const name = profiles[item.user_id]?.display_name || (item.user_id === runtime.user.id ? runtime.profile?.display_name : "عضو");
    return roomMessageHTML({ ...item, display_name: name });
  }).join("");
  const kindLabel = room.room_type === "voice" ? "غرفة صوتية" : room.room_type === "watch" ? "مشاهدة جماعية" : "تحديات جماعية";
  const mainBody = room.room_type === "watch"
    ? '<div class="social-watch-stage"><div id="dazza-watch-player"></div></div><div class="social-watch-actions">' + (isHost ? '<button class="btn-primary" data-action="social-watch-control" data-mode="play">تشغيل للجميع</button><button class="btn-secondary" data-action="social-watch-control" data-mode="pause">إيقاف للجميع</button><button class="btn-secondary" data-action="social-watch-control" data-mode="sync">مزامنة الآن</button>' : '<p>المضيف يتحكم بتشغيل المقطع وإيقافه حتى تبقون متزامنين.</p>') + '</div><p class="social-room-safety">المشاهدة تستخدم مشغل YouTube الرسمي. كل مشارك يشاهد من اتصاله وحسابه، ولا يتم نسخ أو إعادة بث الفيديو.</p>'
    : room.room_type === "voice"
      ? '<div class="social-voice-stage"><div class="social-voice-orb">◖</div><h2>مجلس دَزّة</h2><p>افتح الميكروفون حتى يسمعك الموجودون في الغرفة.</p><div class="social-voice-actions"><button class="btn-primary" data-action="social-voice-toggle">' + (voiceEnabled ? "مغادرة الصوت" : "دخول الصوت") + '</button><button class="btn-secondary" data-action="social-voice-mute"' + (voiceEnabled ? "" : " disabled") + '>' + (muted ? "إلغاء كتم الميكروفون" : "كتم الميكروفون") + '</button></div><p class="social-room-safety">الغرفة الصوتية تستخدم اتصال WebRTC مباشر بين المشاركين، ومحددة بستة أعضاء لتقليل الضغط على الاتصال.</p></div>'
      : '<div class="social-game-stage"><span class="promo-kicker">DAZZA QUICK QUIZ</span><h2>تحدّي المعلومات السريع</h2><p>المضيف يبدأ سؤالاً، وكل شخص يختار إجابته من الخيارات.</p><div id="social-room-quiz"><p class="muted">بانتظار بداية الجولة.</p></div>' + (isHost ? '<button class="btn-primary" data-action="social-quiz-start">ابدأ سؤالاً جديداً</button>' : '<p class="muted">انتظر المضيف حتى يبدأ الجولة.</p>') + '</div>';
  runtime.showContent('<div class="social-room-page"><div class="social-room-toolbar"><button class="back-link" data-action="social-room-leave">← مغادرة الغرفة</button><span>' + kindLabel + '</span><button class="btn-secondary" data-action="social-room-copy">نسخ الرابط</button></div><div class="social-room-layout"><main class="social-room-main"><section class="social-room-title"><div><h1>' + esc(room.title) + '</h1><p><span id="social-room-count">' + participants.length + ' / ' + room.max_members + '</span> · ' + (isHost ? "أنت المضيف" : "عضو في الغرفة") + '</p></div><span class="social-live-label">مباشر</span></section>' + mainBody + '<section class="social-members-panel"><h3>الموجودون الآن</h3><div id="social-room-presence">' + participants.map(member => '<span class="social-presence-person"><i class="' + (member.voice ? "online" : "") + '"></i>' + esc(member.displayName || "عضو") + '</span>').join("") + '</div></section></main><aside class="social-room-chat"><div class="social-chat-head"><strong>محادثة الغرفة</strong><small>رسائل للأعضاء الموجودين</small></div><div id="social-room-chat-list" class="social-room-chat-list">' + (chatHTML || '<p class="muted">ابدأوا الحديث...</p>') + '</div><form id="social-room-chat-form" class="social-room-chat-form"><input name="body" maxlength="500" autocomplete="off" placeholder="اكتب رسالة..." required><button type="submit" aria-label="إرسال">إرسال</button></form></aside></div></div>');
  syncRoomPresence();
  const chatList = $("#social-room-chat-list");
  if (chatList) chatList.scrollTop = chatList.scrollHeight;
}

function roomMessageHTML(message) {
  return '<article class="social-chat-message" data-message-id="' + esc(message.id) + '"><strong>' + esc(message.display_name || "عضو") + '</strong><p>' + esc(message.body) + '</p><small>' + new Date(message.created_at).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" }) + '</small></article>';
}

function appendRoomMessage(message) {
  if (!message?.id || chatIds.has(message.id)) return;
  chatIds.add(message.id);
  const list = $("#social-room-chat-list");
  if (!list) return;
  if (list.querySelector(".muted")) list.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.innerHTML = roomMessageHTML(message);
  const article = wrap.firstElementChild;
  if (article) list.append(article);
  list.scrollTop = list.scrollHeight;
}

async function loadRoomChat() {
  if (!activeRoom) return;
  const { data, error } = await runtime.supabase.from("dazza_room_messages").select("*").eq("room_id", activeRoom.id).order("created_at", { ascending: false }).limit(80);
  if (error) throw error;
  const messages = (data || []).reverse();
  const ids = messages.map(item => item.user_id);
  const profiles = await loadProfiles(ids);
  for (const item of messages) {
    appendRoomMessage({ ...item, display_name: profiles[item.user_id]?.display_name || "عضو" });
  }
}

async function leaveSocialRoom({ refresh = true, announce = true } = {}) {
  if (!activeRoom) return;
  const room = activeRoom;
  if (room.host_id === runtime.user.id) {
    try { await roomChannel?.send({ type: "broadcast", event: "room-closed", payload: { by: runtime.user.id } }); }
    catch (error) { console.warn("Room close broadcast failed:", error); }
    const { error: closeError } = await runtime.supabase.from("dazza_rooms")
      .update({ status: "closed", updated_at: new Date().toISOString() }).eq("id", room.id);
    if (closeError) throw closeError;
    const { error: membersError } = await runtime.supabase.from("dazza_room_members").delete().eq("room_id", room.id);
    if (membersError) throw membersError;
  } else {
    const { error } = await runtime.supabase.from("dazza_room_members").delete()
      .eq("room_id", room.id).eq("user_id", runtime.user.id);
    if (error) throw error;
  }
  await closeRealtime();
  activeRoom = null;
  if (announce) notify(room.host_id === runtime.user.id ? "تم إغلاق الغرفة." : "غادرت الغرفة.");
  if (refresh) await renderSocialWorld();
}

async function heartbeatRoom() {
  if (!activeRoom || !roomChannel || heartbeatBusy) return false;
  heartbeatBusy = true;
  try {
    const { data, error } = await runtime.supabase.from("dazza_room_members")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("room_id", activeRoom.id).eq("user_id", runtime.user.id)
      .select("room_id").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("انتهت عضويتك في الغرفة.");
    return true;
  } finally {
    heartbeatBusy = false;
  }
}

async function closeRealtime() {
  if (roomHeartbeat) { clearInterval(roomHeartbeat); roomHeartbeat = null; }
  await stopVoice();
  if (watchTicker) { clearInterval(watchTicker); watchTicker = null; }
  if (watchPlayer?.destroy) { try { watchPlayer.destroy(); } catch { /* player already removed */ } }
  watchPlayer = null;
  if (roomChannel) {
    const channel = roomChannel;
    roomChannel = null;
    await runtime.supabase.removeChannel(channel);
  }
  chatIds.clear();
  answeredQuizQuestions.clear();
  hostQuizAnswers.clear();
  currentQuizQuestionIndex = null;
  heartbeatFailures = 0;
}

async function toggleVoice() {
  if (!activeRoom || !roomChannel) return;
  if (voiceEnabled) {
    await stopVoice();
    await updatePresence();
    const button = $('[data-action="social-voice-toggle"]');
    if (button) button.textContent = "دخول الصوت";
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("المتصفح لا يدعم الميكروفون أو أن الاتصال ليس آمناً. افتح دَزّة عبر HTTPS.");
  localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  voiceEnabled = true;
  muted = false;
  await updatePresence();
  const button = $('[data-action="social-voice-toggle"]');
  if (button) button.textContent = "مغادرة الصوت";
  const muteButton = $('[data-action="social-voice-mute"]');
  if (muteButton) { muteButton.disabled = false; muteButton.textContent = "كتم الميكروفون"; }
  await syncVoicePeers();
  notify("تم تشغيل الميكروفون. تحدث مع الموجودين في الغرفة.");
}

async function stopVoice() {
  voiceEnabled = false;
  muted = false;
  if (localStream) localStream.getTracks().forEach(track => track.stop());
  localStream = null;
  for (const [id, pc] of peers) { try { pc.close(); } catch { /* ignored */ } closeRemoteAudio(id); }
  peers.clear();
  pendingCandidates.clear();
  const muteButton = $('[data-action="social-voice-mute"]');
  if (muteButton) { muteButton.disabled = true; muteButton.textContent = "كتم الميكروفون"; }
}

async function syncVoicePeers() {
  if (!voiceEnabled || !localStream || !roomChannel) return;
  const members = roomPresenceState();
  const activeIds = new Set(members.filter(item => item.voice && item.userId !== runtime.user.id).map(item => item.userId));
  for (const [peerId, pc] of peers) {
    if (!activeIds.has(peerId)) { try { pc.close(); } catch { /* ignored */ } peers.delete(peerId); closeRemoteAudio(peerId); }
  }
  for (const member of members) {
    if (!member.voice || member.userId === runtime.user.id || peers.has(member.userId)) continue;
    if (String(runtime.user.id) < String(member.userId)) await createPeer(member.userId, true);
  }
}

async function createPeer(peerId, initiator) {
  if (peers.has(peerId) || !localStream || !roomChannel) return peers.get(peerId);
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
  });
  peers.set(peerId, pc);
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  pc.onicecandidate = event => {
    if (event.candidate) roomChannel?.send({
      type: "broadcast", event: "rtc-signal",
      payload: { from: runtime.user.id, to: peerId, kind: "candidate", candidate: event.candidate }
    });
  };
  pc.ontrack = event => attachRemoteAudio(peerId, event.streams[0]);
  pc.onconnectionstatechange = () => {
    if (["failed", "closed"].includes(pc.connectionState)) {
      peers.delete(peerId);
      closeRemoteAudio(peerId);
    }
  };
  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await roomChannel.send({
      type: "broadcast", event: "rtc-signal",
      payload: { from: runtime.user.id, to: peerId, kind: "offer", description: pc.localDescription }
    });
  }
  return pc;
}

async function handleRtcSignal(signal) {
  if (!voiceEnabled || !signal || signal.to !== runtime.user.id || !signal.from) return;
  try {
    if (signal.kind === "offer") {
      let pc = peers.get(signal.from);
      if (!pc) pc = await createPeer(signal.from, false);
      await pc.setRemoteDescription(new RTCSessionDescription(signal.description));
      const pending = pendingCandidates.get(signal.from) || [];
      for (const candidate of pending) await pc.addIceCandidate(new RTCIceCandidate(candidate));
      pendingCandidates.delete(signal.from);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await roomChannel.send({
        type: "broadcast", event: "rtc-signal",
        payload: { from: runtime.user.id, to: signal.from, kind: "answer", description: pc.localDescription }
      });
    } else if (signal.kind === "answer") {
      const pc = peers.get(signal.from);
      if (!pc) return;
      await pc.setRemoteDescription(new RTCSessionDescription(signal.description));
      const pending = pendingCandidates.get(signal.from) || [];
      for (const candidate of pending) await pc.addIceCandidate(new RTCIceCandidate(candidate));
      pendingCandidates.delete(signal.from);
    } else if (signal.kind === "candidate") {
      const pc = peers.get(signal.from);
      if (!pc || !pc.remoteDescription) {
        const pending = pendingCandidates.get(signal.from) || [];
        pending.push(signal.candidate);
        pendingCandidates.set(signal.from, pending);
      } else {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    }
  } catch (error) {
    console.warn("Voice signaling error:", error);
  }
}

function attachRemoteAudio(peerId, stream) {
  let audio = remoteAudio.get(peerId);
  if (!audio) {
    audio = document.createElement("audio");
    audio.autoplay = true;
    audio.playsInline = true;
    audio.dataset.peer = peerId;
    $(".social-room-page")?.append(audio);
    remoteAudio.set(peerId, audio);
  }
  audio.srcObject = stream;
  audio.play().catch(() => notify("اضغط على الصفحة للسماح بتشغيل صوت المشاركين."));
}

function closeRemoteAudio(peerId) {
  const audio = remoteAudio.get(peerId);
  if (audio) {
    audio.srcObject = null;
    audio.remove();
    remoteAudio.delete(peerId);
  }
}

let youTubeApiPromise = null;
function ensureYouTubeAPI() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youTubeApiPromise) return youTubeApiPromise;
  youTubeApiPromise = new Promise((resolve, reject) => {
    const oldCallback = window.onYouTubeIframeAPIReady;
    const timeout = setTimeout(() => {
      youTubeApiPromise = null;
      reject(new Error("تعذر تحميل مشغل يوتيوب. تحقق من اتصال الإنترنت."));
    }, 18000);
    window.onYouTubeIframeAPIReady = () => {
      if (typeof oldCallback === "function") oldCallback();
      clearTimeout(timeout);
      resolve(window.YT);
    };
    let script = $('script[src="https://www.youtube.com/iframe_api"]');
    if (!script) {
      script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.append(script);
    }
    script.onerror = () => {
      clearTimeout(timeout);
      youTubeApiPromise = null;
      reject(new Error("فشل تحميل مشغل يوتيوب."));
    };
  });
  return youTubeApiPromise;
}

async function initializeWatchPlayer() {
  if (!activeRoom?.video_id) return;
  const YT = await ensureYouTubeAPI();
  if (!$("#dazza-watch-player")) return;
  watchPlayer = new YT.Player("dazza-watch-player", {
    width: "100%",
    height: "100%",
    videoId: activeRoom.video_id,
    playerVars: { playsinline: 1, rel: 0, controls: activeRoom.host_id === runtime.user.id ? 1 : 0, disablekb: activeRoom.host_id === runtime.user.id ? 0 : 1 },
    events: {
      onReady: () => {
        if (activeRoom?.host_id === runtime.user.id) {
          if (watchTicker) clearInterval(watchTicker);
          watchTicker = setInterval(() => sendWatchState(), 5000);
        }
      },
      onStateChange: event => {
        if (activeRoom?.host_id !== runtime.user.id || Date.now() < remoteSyncUntil) return;
        if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED) sendWatchState();
      }
    }
  });
}

async function sendWatchState() {
  if (!watchPlayer || !roomChannel || activeRoom?.host_id !== runtime.user.id) return;
  let time = 0;
  try { time = watchPlayer.getCurrentTime() || 0; } catch { return; }
  const playing = watchPlayer.getPlayerState() === window.YT.PlayerState.PLAYING;
  await roomChannel.send({ type: "broadcast", event: "watch-state", payload: { time, playing, sentAt: Date.now() } });
}

function applyWatchState(state) {
  if (!watchPlayer || activeRoom?.host_id === runtime.user.id || !state) return;
  remoteSyncUntil = Date.now() + 2500;
  const elapsed = Math.max(0, (Date.now() - Number(state.sentAt || Date.now())) / 1000);
  const target = Math.max(0, Number(state.time || 0) + (state.playing ? elapsed : 0));
  try {
    const current = Number(watchPlayer.getCurrentTime() || 0);
    if (Math.abs(current - target) > 2.25) watchPlayer.seekTo(target, true);
    const playerState = watchPlayer.getPlayerState();
    if (state.playing && playerState !== window.YT.PlayerState.PLAYING) watchPlayer.playVideo();
    else if (!state.playing && playerState === window.YT.PlayerState.PLAYING) watchPlayer.pauseVideo();
  } catch (error) { console.warn("Watch party sync failed:", error); }
}

function renderRoomQuiz(state) {
  const box = $("#social-room-quiz");
  if (!box) return;
  if (!state || !Number.isInteger(state.questionIndex)) {
    box.innerHTML = '<p class="muted">بانتظار بداية الجولة.</p>';
    return;
  }
  const item = YT_QUESTIONS[state.questionIndex];
  if (!item) return;
  const answered = answeredQuizQuestions.has(state.questionIndex);
  box.innerHTML = '<h3>' + esc(item.q) + '</h3><div class="social-quiz-answers">' + item.a.map((answer, index) => '<button class="btn-secondary" data-action="social-quiz-answer" data-answer="' + index + '" data-question="' + state.questionIndex + '"' + (answered ? " disabled" : "") + '>' + esc(answer) + '</button>').join("") + '</div>' + (answered ? '<small class="muted">تم إرسال إجابتك.</small>' : "");
}

export async function cleanupSocialWorld() {
  if (activeRoom) {
    try {
      await leaveSocialRoom({ refresh: false, announce: false });
    } catch (error) {
      console.warn("Could not close/leave the active room cleanly:", error);
      await closeRealtime();
      activeRoom = null;
    }
  } else {
    await closeRealtime();
  }
  activeRoom = null;
  roomMembers = [];
}

export function getYouTubeVideoId(value) {
  return youtubeId(value);
}
