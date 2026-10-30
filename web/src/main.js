import { createClient } from "@supabase/supabase-js";
import "./style.css";

const $ = (selector, scope = document) => scope.querySelector(selector);
const root = $("#root");
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://jdtvkapmroqgerqsnjwe.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_j0f5nDt8HQFpug14ctAaiA_o2RuwxUR";
const BUCKET = "dazza-social-media";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

let session = null;
let profile = null;
let isAdmin = false;
let currentView = "feed";
let feedFilter = "for-you";
let currentProfileId = null;
let activeConversation = null;
let conversations = [];
let feedPosts = [];
let storyGroups = [];
let liveChannel = null;
let searchTerm = "";
let busy = false;
let activeGame = "hub";
let gameState = null;
let deferredInstallPrompt = null;
let memoryClock = null;
let timerClock = null;
let focusSeconds = 25 * 60;
let focusRunning = false;
let focusInterval = null;
let quizQuestions = [];
let quizIndex = 0;
let quizScore = 0;
let quizSelected = null;
let authBusy = false;

function storageGet(key, fallback = null) {
  try { const value = localStorage.getItem(key); return value === null ? fallback : value; }
  catch { return fallback; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch { return false; }
}
function applyTheme() {
  const theme = storageGet("dazza-theme", "midnight");
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
}

const esc = (value = "") => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const avatarUrl = path => path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : "";
const publicUrl = path => path ? supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : "";
const initials = value => esc((value || "د").trim().slice(0, 1) || "د");
const dateLabel = value => {
  const date = new Date(value);
  const diff = Math.max(0, Date.now() - date.getTime());
  if (diff < 60000) return "الآن";
  if (diff < 3600000) return Math.floor(diff / 60000) + " د";
  if (diff < 86400000) return Math.floor(diff / 3600000) + " س";
  return date.toLocaleDateString("ar-IQ", { day: "numeric", month: "short" });
};
function notice(message, type = "info") {
  const node = $("#global-notice");
  if (!node) return;
  node.textContent = message;
  node.dataset.type = type;
  node.hidden = false;
  window.clearTimeout(notice.timer);
  notice.timer = window.setTimeout(() => { node.hidden = true; }, 6000);
}
function setBusy(value) {
  busy = value;
  root.classList.toggle("is-busy", value);
}
function resetSignedInState() {
  session = null;
  profile = null;
  isAdmin = false;
  activeConversation = null;
  currentProfileId = null;
  currentView = "feed";
  if (liveChannel) {
    supabase.removeChannel(liveChannel).catch(error => console.warn("Realtime cleanup:", error));
    liveChannel = null;
  }
  if (focusInterval) { clearInterval(focusInterval); focusInterval = null; }
  focusRunning = false;
  focusSeconds = 25 * 60;
  closeModal();
}
function updateNetworkBadge() {
  const badge = $("#network-status");
  if (!badge) return;
  badge.hidden = navigator.onLine;
  badge.textContent = navigator.onLine ? "" : "أنت غير متصل — بعض الميزات تحتاج إنترنت";
}
function openPasswordUpdate() {
  openModal('<header class="modal-head"><h2>تعيين كلمة مرور جديدة</h2></header><form id="password-update-form"><label for="new-password">كلمة المرور الجديدة</label><input id="new-password" name="password" type="password" minlength="8" maxlength="72" autocomplete="new-password" required placeholder="8 أحرف على الأقل"><label for="new-password-confirm">تأكيد كلمة المرور</label><input id="new-password-confirm" name="password_confirm" type="password" minlength="8" maxlength="72" autocomplete="new-password" required placeholder="أعد كتابة كلمة المرور"><button class="btn-primary full" type="submit">حفظ كلمة المرور</button></form>');
}
function openForgotPassword() {
  openModal('<header class="modal-head"><h2>استعادة كلمة المرور</h2><button class="close-btn" data-action="close-modal">×</button></header><p class="muted">اكتب بريد حسابك، ونرسل لك رابط تعيين كلمة مرور جديدة.</p><form id="reset-request-form"><label for="reset-email">البريد الإلكتروني</label><input id="reset-email" name="email" type="email" autocomplete="email" required placeholder="name@example.com"><button class="btn-primary full" type="submit">إرسال رابط الاستعادة</button></form>');
}
async function signOutUser() {
  const buttons = [...root.querySelectorAll('[data-action="logout"]')];
  buttons.forEach(button => { button.disabled = true; button.dataset.oldText = button.textContent; button.textContent = "جارٍ الخروج…"; });
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) throw error;
    resetSignedInState();
    authView("login");
    const banner = $("#auth-notice");
    if (banner) { banner.textContent = "تم تسجيل الخروج من هذا الجهاز."; banner.hidden = false; }
  } catch (error) {
    console.error("Sign out failed:", error);
    notice("تعذر تسجيل الخروج: " + (error.message || "خطأ غير معروف"), "error");
    buttons.forEach(button => { button.disabled = false; button.textContent = button.dataset.oldText || "تسجيل الخروج"; });
  }
}
function accountMenu() {
  const avatar = avatarUrl(profile?.avatar_path);
  openModal('<div class="account-menu"><div class="account-menu-user"><span class="avatar">' + (avatar ? '<img src="' + esc(avatar) + '" alt="">' : initials(profile?.display_name)) + '</span><div><strong>' + esc(profile?.display_name || "") + '</strong><small>@' + esc(profile?.username || "") + '</small></div></div><button data-action="my-profile">الملف الشخصي</button><button data-view="settings">الإعدادات والحساب</button><button data-action="toggle-theme">تغيير المظهر</button><button class="logout-menu" data-action="logout">تسجيل الخروج</button></div>');
}
function authView(mode = "login") {
  const signup = mode === "signup";
  root.innerHTML = '<main class="auth-screen"><section class="auth-brand"><div class="brand-symbol">د</div><h1>دَزّة</h1><p>مساحتك، ناسك، وحكاياتك.</p><div class="auth-art"><span>شارك لحظتك</span><span>تابع مجتمعك</span><span>خلك قريب</span></div></section><section class="auth-panel"><div class="auth-card"><div class="brand-mobile">دَزّة</div><p class="eyebrow">أهلاً بيك بمجتمع دَزّة</p><h2>' + (signup ? "أنشئ حسابك" : "سجّل دخولك") + '</h2><p class="muted">' + (signup ? "ابدأ شارك صورك وقصصك وتواصل ويا الناس." : "ادخل لحسابك وشوف جديد مجتمعك.") + '</p><div id="auth-notice" class="notice" hidden></div><form id="auth-form" data-mode="' + mode + '">' +
    (signup ? '<label for="username">اسم المستخدم</label><input id="username" name="username" minlength="3" maxlength="30" pattern="[a-z][a-z0-9_]{2,29}" placeholder="ali_iraqi" required autocomplete="username"><label for="display-name">الاسم الظاهر</label><input id="display-name" name="display_name" maxlength="80" required placeholder="اسمك للناس">' : "") +
    '<label for="email">البريد الإلكتروني</label><input id="email" name="email" type="email" maxlength="254" required autocomplete="email" inputmode="email" placeholder="name@example.com"><label for="password">كلمة المرور</label><div class="password-field"><input id="password" name="password" type="password" minlength="8" maxlength="72" required autocomplete="' + (signup ? "new-password" : "current-password") + '" placeholder="8 أحرف على الأقل"><button type="button" class="password-toggle" data-action="toggle-password" aria-label="إظهار كلمة المرور">◉</button></div><button class="btn-primary full" type="submit">' + (signup ? "إنشاء الحساب" : "دخول") + '</button></form>' + (!signup ? '<button class="forgot-link" type="button" data-action="forgot-password">نسيت كلمة المرور؟</button>' : '') + '<p class="auth-switch">' + (signup ? "عندك حساب؟" : "ما عندك حساب؟") + ' <button class="link-btn" data-action="switch-auth" data-mode="' + (signup ? "login" : "signup") + '">' + (signup ? "سجّل دخول" : "أنشئ حساب") + '</button></p></div></section></main>';
}
function shell() {
  const avatar = avatarUrl(profile?.avatar_path);
  const avatarHTML = avatar
    ? '<img class="avatar-img" src="' + esc(avatar) + '" alt="">'
    : '<span>' + initials(profile?.display_name) + '</span>';
  root.innerHTML = '<div class="social-app"><aside class="left-sidebar"><a class="logo" href="#" data-view="feed"><span class="logo-mark">د</span><span><b>دَزّة</b><small>YOUR WORLD. YOUR WAY.</small></span></a><nav class="main-nav">' +
    navItem("feed", "⌂", "الرئيسية") +
    navItem("explore", "⌕", "استكشف") +
    navItem("reels", "▷", "ريلز") +
    navItem("games", "✦", "مركز الألعاب") +
    navItem("tools", "⌘", "الأدوات") +
    navItem("messages", "✉", "الرسائل") +
    navItem("notifications", "♡", "الإشعارات", '<i id="notification-badge" class="nav-badge" hidden></i>') +
    navItem("saved", "▣", "المحفوظات") +
    '<button class="nav-item create-nav" data-action="new-post"><span class="nav-icon">＋</span><span>إنشاء منشور</span></button>' +
    navItem("settings", "⚙", "الإعدادات") +
    '<button class="nav-item profile-nav" data-action="my-profile"><span class="nav-avatar">' + avatarHTML + '</span><span>الملف الشخصي</span></button>' +
    '<button class="nav-item nav-logout" data-action="logout"><span class="nav-icon">↪</span><span>تسجيل الخروج</span></button>' +
    '</nav><div class="sidebar-bottom"><span class="muted small">دَزّة · مجتمع عراقي</span><button class="install-link" data-action="install-app">تثبيت التطبيق على جهازك ↗</button></div></aside><main class="main-column"><header class="mobile-header"><a class="logo" href="#" data-view="feed"><span class="logo-mark">د</span><span>دَزّة</span></a><div class="mobile-header-actions"><span id="network-status" class="network-pill" hidden>غير متصل</span><button class="icon-action" data-action="install-app" aria-label="تثبيت">⇩</button><button class="icon-action" data-view="messages" aria-label="الرسائل">✉</button><button class="icon-action account-trigger" data-action="account-menu" aria-label="الحساب">' + avatarHTML + '</button></div></header><div id="content" class="content-column"></div></main><aside class="right-sidebar"><div class="my-mini-profile">' + avatarHTML + '<div><strong>' + esc(profile?.display_name || "") + '</strong><small>@' + esc(profile?.username || "") + '</small></div><button class="link-btn" data-action="my-profile">عرض</button></div><div class="suggestions" id="suggestions"><div class="section-head"><strong>اقتراحات للمتابعة</strong><button class="link-btn" data-view="explore">عرض الكل</button></div><div class="muted small">اكتشف وجوهاً وأفكاراً جديدة.</div></div><section class="right-promo"><span class="promo-kicker">DAZZA ARCADE</span><strong>استراحة ذكية؟</strong><p>ألعاب خفيفة وتحديات قصيرة داخل التطبيق.</p><button class="btn-secondary" data-view="games">اكتشف الألعاب</button></section><div class="right-footer">مجتمع · ألعاب · أدوات · خصوصية<br>© دَزّة 2026</div></aside><nav class="mobile-nav">' +
    mobileNav("feed", "⌂") + mobileNav("explore", "⌕") + mobileNav("games", "✦") + '<button data-action="new-post" aria-label="إنشاء">＋</button>' + mobileNav("notifications", "♡") + mobileNav("my-profile", "○") +
    '</nav><div id="modal-root"></div><div id="global-notice" class="notice global-notice" hidden></div></div>';
}
function navItem(view, symbol, label, extra = "") {
  return '<button class="nav-item" data-view="' + view + '"><span class="nav-icon">' + symbol + '</span><span>' + label + '</span>' + extra + '</button>';
}
function mobileNav(view, symbol) {
  return '<button data-view="' + view + '" aria-label="' + view + '">' + symbol + '</button>';
}
function setActiveNav() {
  root.querySelectorAll("[data-view]").forEach(node => {
    const view = node.dataset.view;
    node.classList.toggle("active", view === currentView || (view === "my-profile" && currentView === "profile" && currentProfileId === session?.user?.id));
  });
}
function showContent(html) {
  const content = $("#content");
  if (content) content.innerHTML = html;
  setActiveNav();
}
function loading() {
  showContent('<div class="loading-state"><div class="spinner"></div><p>دا نحضّر صفحتك...</p></div>');
}
async function enter(nextSession) {
  session = nextSession;
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    resetSignedInState();
    throw new Error(userError?.message || "انتهت جلسة الدخول. سجّل الدخول مرة أخرى.");
  }
  session = { ...session, user: userData.user };
  const { data, error } = await supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
  if (error || !data) {
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    resetSignedInState();
    throw new Error(error?.message || "حسابك لم يكتمل إعداده بعد. جرّب مرة ثانية.");
  }
  profile = data;
  const admin = await supabase.from("app_admins").select("user_id").eq("user_id", session.user.id).maybeSingle();
  isAdmin = !!admin.data;
  shell();
  loadNotificationBadge();
  loadSuggestions();
  await navigate("feed");
  startRealtime();
  const linkedPost = new URLSearchParams(location.search).get("post");
  if (linkedPost) {
    await renderPostModal(linkedPost);
    const cleanUrl = new URL(location.href);
    cleanUrl.searchParams.delete("post");
    history.replaceState({}, "", cleanUrl.toString());
  }
}
async function boot() {
  applyTheme();
  root.addEventListener("click", onClick);
  root.addEventListener("submit", onSubmit);
  root.addEventListener("change", onChange);
  root.addEventListener("input", onInput);
  window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    document.body.classList.add("pwa-installable");
  });
  window.addEventListener("online", updateNetworkBadge);
  window.addEventListener("offline", updateNetworkBadge);
  document.addEventListener("keydown", onGameKeydown);
  updateNetworkBadge();
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) console.warn("Session restore:", sessionError);
  if (data.session) await enter(data.session);
  else authView("login");
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      resetSignedInState();
      authView("login");
    } else if (event === "PASSWORD_RECOVERY") {
      openPasswordUpdate();
    }
  });
}
async function navigate(view, param) {
  if (!session) return authView("login");
  currentView = view;
  if (param !== undefined) currentProfileId = param;
  setActiveNav();
  loading();
  try {
    if (view === "feed") await renderFeed();
    else if (view === "explore") await renderExplore();
    else if (view === "reels") await renderReels();
    else if (view === "games") await renderGames();
    else if (view === "tools") await renderTools();
    else if (view === "settings") await renderSettings();
    else if (view === "profile") await renderProfile(currentProfileId || session.user.id);
    else if (view === "notifications") await renderNotifications();
    else if (view === "saved") await renderSaved();
    else if (view === "messages") await renderMessages();
    else showContent('<div class="empty-state"><h2>هذه الصفحة قيد الإعداد</h2></div>');
  } catch (error) {
    console.error(error);
    showContent('<div class="empty-state"><h2>ما قدرنا نحمّل الصفحة</h2><p>' + esc(error.message || "خطأ غير معروف") + '</p><button class="btn-secondary" data-action="retry">إعادة المحاولة</button></div>');
  }
}

async function renderFeed() {
  const [stories, posts] = await Promise.all([getStories(), getPosts()]);
  storyGroups = stories;
  feedPosts = posts;
  const storyHTML = stories.map(group => {
    const p = group.profile;
    const src = avatarUrl(p?.avatar_path);
    return '<button class="story-item" data-action="open-story" data-id="' + group.latest.id + '"><span class="story-ring"><span class="story-avatar">' + (src ? '<img src="' + esc(src) + '" alt="">' : initials(p?.display_name)) + '</span></span><span>' + esc(p?.id === session.user.id ? "قصتك" : (p?.username || p?.display_name || "عضو")) + '</span></button>';
  }).join("");
  const cards = posts.map(postCard).join("");
  showContent('<div class="feed-layout"><section class="feed-main"><div class="stories-bar"><button class="story-item add-story" data-action="add-story"><span class="story-ring"><span class="story-avatar add-story-icon">＋</span></span><span>قصتك</span></button>' + storyHTML + '</div><div class="feed-heading"><div><h1>آخر الحكايات</h1><p>شارك وشوف جديد الناس اللي تتابعهم.</p></div><div class="feed-filters"><button class="' + (feedFilter === "for-you" ? "selected" : "") + '" data-action="feed-filter" data-filter="for-you">لك</button><button class="' + (feedFilter === "following" ? "selected" : "") + '" data-action="feed-filter" data-filter="following">المتابَعون</button></div></div>' + (cards || '<div class="empty-feed"><div class="empty-illustration">✦</div><h2>هنا تبدي الحكاية</h2><p>انشر أول صورة أو تابع حسابات حتى تشوف منشوراتهم هنا.</p><button class="btn-primary" data-action="new-post">أنشئ أول منشور</button></div>') + '</section><aside class="feed-aside"><div class="mini-account-card"><div class="avatar-large">' + (avatarUrl(profile.avatar_path) ? '<img src="' + esc(avatarUrl(profile.avatar_path)) + '" alt="">' : initials(profile.display_name)) + '</div><div><strong>' + esc(profile.display_name) + '</strong><small>@' + esc(profile.username) + '</small></div><button class="link-btn" data-action="my-profile">ملفي</button></div><div class="aside-note"><strong>خلي لحظاتك توصل</strong><p>انشر صورة أو فيديو، وخلّ أصحابك يشاركونك اللحظة.</p><button class="btn-secondary" data-action="new-post">إنشاء منشور</button></div><p class="tiny-muted">دَزّة — مساحة للتواصل والمشاركة.</p></aside></div>');
}
async function getPosts(ids) {
  let query = supabase.from("posts").select("*").order("created_at", { ascending: false }).limit(60);
  if (ids) query = query.in("user_id", ids.length ? ids : [session.user.id]).eq("user_id", "__none__");
  const { data, error } = await query;
  if (error) throw error;
  const posts = data || [];
  if (feedFilter === "following" && currentView === "feed") {
    const { data: follows, error: fError } = await supabase.from("follows").select("following_id").eq("follower_id", session.user.id).eq("status", "accepted");
    if (fError) throw fError;
    const allowed = new Set([session.user.id, ...(follows || []).map(item => item.following_id)]);
    const filtered = posts.filter(post => allowed.has(post.user_id));
    return enrichPosts(filtered);
  }
  return enrichPosts(posts);
}
async function enrichPosts(posts) {
  if (!posts.length) return [];
  const postIds = posts.map(post => post.id);
  const userIds = [...new Set(posts.map(post => post.user_id))];
  const [profilesResult, likesResult, commentsResult, mineResult, savedResult] = await Promise.all([
    supabase.from("profiles").select("id,username,display_name,avatar_path,bio").in("id", userIds),
    supabase.from("post_likes").select("post_id").in("post_id", postIds),
    supabase.from("post_comments").select("post_id").in("post_id", postIds),
    supabase.from("post_likes").select("post_id").eq("user_id", session.user.id).in("post_id", postIds),
    supabase.from("post_bookmarks").select("post_id").eq("user_id", session.user.id).in("post_id", postIds)
  ]);
  for (const result of [profilesResult, likesResult, commentsResult, mineResult, savedResult]) if (result.error) throw result.error;
  const profiles = new Map((profilesResult.data || []).map(item => [item.id, item]));
  const count = rows => rows.reduce((map, row) => map.set(row.post_id, (map.get(row.post_id) || 0) + 1), new Map());
  const likes = count(likesResult.data || []);
  const comments = count(commentsResult.data || []);
  const mine = new Set((mineResult.data || []).map(row => row.post_id));
  const saved = new Set((savedResult.data || []).map(row => row.post_id));
  return posts.map(post => ({
    ...post,
    author: profiles.get(post.user_id),
    likesCount: likes.get(post.id) || 0,
    commentsCount: comments.get(post.id) || 0,
    liked: mine.has(post.id),
    saved: saved.has(post.id)
  }));
}
function postCard(post) {
  const author = post.author || {};
  const avatar = avatarUrl(author.avatar_path);
  const media = post.media_path ? (post.media_type === "video"
    ? '<video class="post-media" controls playsinline preload="metadata" src="' + esc(publicUrl(post.media_path)) + '"></video>'
    : '<img class="post-media" loading="lazy" src="' + esc(publicUrl(post.media_path)) + '" alt="صورة منشور">') : "";
  return '<article class="post-card" data-post-card="' + post.id + '"><header class="post-head"><button class="post-author" data-action="open-profile" data-id="' + author.id + '"><span class="avatar">' + (avatar ? '<img src="' + esc(avatar) + '" alt="">' : initials(author.display_name)) + '</span><span><strong>' + esc(author.display_name || author.username || "عضو") + '</strong><small>@' + esc(author.username || "") + ' · ' + dateLabel(post.created_at) + '</small></span></button><button class="dots-btn" data-action="post-menu" data-id="' + post.id + '" aria-label="خيارات">•••</button></header>' +
    (post.caption ? '<p class="post-caption">' + esc(post.caption) + '</p>' : '') + media +
    (post.location ? '<div class="post-location">⌖ ' + esc(post.location) + '</div>' : '') +
    '<div class="post-actions"><button class="post-action ' + (post.liked ? "is-liked" : "") + '" data-action="toggle-like" data-id="' + post.id + '" data-liked="' + post.liked + '"><span>' + (post.liked ? "♥" : "♡") + '</span><b>' + post.likesCount + '</b></button><button class="post-action" data-action="view-comments" data-id="' + post.id + '"><span>▢</span><b>' + post.commentsCount + '</b></button><button class="post-action" data-action="share-post" data-id="' + post.id + '"><span>↗</span></button><button class="post-action save-action ' + (post.saved ? "is-saved" : "") + '" data-action="toggle-save" data-id="' + post.id + '"><span>' + (post.saved ? "▣" : "▢") + '</span></button></div>' +
    '<form class="comment-form" data-post="' + post.id + '"><input name="body" maxlength="1000" placeholder="اكتب تعليقاً..." required><button type="submit">نشر</button></form></article>';
}
async function getStories() {
  const { data, error } = await supabase.from("stories").select("*").gt("expires_at", new Date().toISOString()).order("created_at", { ascending: true }).limit(150);
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) return [];
  const users = [...new Set(rows.map(row => row.user_id))];
  const result = await supabase.from("profiles").select("id,username,display_name,avatar_path").in("id", users);
  if (result.error) throw result.error;
  const profiles = new Map(result.data.map(item => [item.id, item]));
  const groups = new Map();
  rows.forEach(story => {
    if (!groups.has(story.user_id)) groups.set(story.user_id, { userId: story.user_id, profile: profiles.get(story.user_id), stories: [] });
    groups.get(story.user_id).stories.push(story);
  });
  return [...groups.values()].map(group => ({ ...group, latest: group.stories[group.stories.length - 1] }));
}

async function renderReels() {
  const { data, error } = await supabase.from("posts").select("*").eq("media_type", "video").order("created_at", { ascending: false }).limit(40);
  if (error) throw error;
  const posts = await enrichPosts(data || []);
  showContent('<div class="page-heading"><div><h1>ريلز دَزّة</h1><p>مقاطع قصيرة من مجتمعنا.</p></div></div>' +
    (posts.map(post => '<article class="reel-card"><video class="reel-video" src="' + esc(publicUrl(post.media_path)) + '" controls playsinline preload="metadata"></video>' +
    '<div class="reel-info"><button class="post-author" data-action="open-post" data-id="' + post.id + '"><strong>' + esc(post.author?.display_name || post.author?.username || "عضو") + '</strong><small>@' + esc(post.author?.username || "") + '</small></button>' +
    '<p>' + esc(post.caption) + '</p><div class="reel-actions"><button class="post-action ' + (post.liked ? "is-liked" : "") + '" data-action="toggle-like" data-id="' + post.id + '" data-liked="' + post.liked + '"><span>' + (post.liked ? "♥" : "♡") + '</span><b>' + post.likesCount + '</b></button><button class="post-action" data-action="view-comments" data-id="' + post.id + '">تعليقات ' + post.commentsCount + '</button></div></div></article>').join("") ||
    '<div class="empty-state"><h2>ماكو مقاطع بعد</h2><p>انشر فيديو حتى يظهر هنا.</p><button class="btn-primary" data-action="new-post">نشر فيديو</button></div>'));
}

const QUIZ_BANK = [
  { q:"ما هو أكبر كوكب في المجموعة الشمسية؟", a:["الأرض","المشتري","زحل","نبتون"], correct:1, why:"المشتري هو الأكبر حجماً وكتلةً." },
  { q:"كم عدد أضلاع الشكل السداسي؟", a:["5","6","7","8"], correct:1, why:"السداسي له ستة أضلاع." },
  { q:"ما عاصمة اليابان؟", a:["أوساكا","كيوتو","طوكيو","هيروشيما"], correct:2, why:"طوكيو هي عاصمة اليابان." },
  { q:"أي عنصر رمزه الكيميائي O؟", a:["الذهب","الأكسجين","الحديد","الهيدروجين"], correct:1, why:"الرمز O يشير إلى الأكسجين." },
  { q:"كم دقيقة في ساعتين ونصف؟", a:["120","130","150","180"], correct:2, why:"2.5 × 60 = 150 دقيقة." },
  { q:"ما الحيوان المعروف بسفينة الصحراء؟", a:["الحصان","الجمل","الفيل","الغزال"], correct:1, why:"الجمل متكيف مع البيئة الصحراوية." },
  { q:"ما اللغة الرسمية في البرازيل؟", a:["الإسبانية","البرتغالية","الفرنسية","الإنجليزية"], correct:1, why:"البرتغالية هي اللغة الرسمية في البرازيل." },
  { q:"أي محيط هو الأكبر على الأرض؟", a:["الأطلسي","الهندي","المتجمد الشمالي","الهادئ"], correct:3, why:"المحيط الهادئ هو الأكبر مساحةً." },
  { q:"ما ناتج 12 × 12؟", a:["124","132","144","154"], correct:2, why:"12 في 12 تساوي 144." },
  { q:"أي كوكب يُعرف بالكوكب الأحمر؟", a:["الزهرة","المريخ","عطارد","أورانوس"], correct:1, why:"لون المريخ المائل للأحمر بسبب أكاسيد الحديد." }
];
function gameScore(name) {
  const scores = JSON.parse(storageGet("dazza-game-scores", "{}") || "{}");
  return Number(scores[name] || 0);
}
function saveGameScore(name, score, mode = "max") {
  const scores = JSON.parse(storageGet("dazza-game-scores", "{}") || "{}");
  scores[name] = mode === "sum" ? (Number(scores[name] || 0) + score) : Math.max(Number(scores[name] || 0), score);
  storageSet("dazza-game-scores", JSON.stringify(scores));
}
function renderGames() {
  if (memoryClock) { clearInterval(memoryClock); memoryClock = null; }
  if (activeGame !== "hub") { renderGame(activeGame); return; }
  const games = [
    ["memory","ذاكرة الكواكب","طابق الرموز بأقل عدد من المحاولات.","🧠","تركيز"],
    ["ttt","إكس أو","واجه خصماً ذكياً في لعبة سريعة.","✕","استراتيجية"],
    ["2048","2048","ادمج الأرقام للوصول إلى 2048.","🔢","ألغاز"],
    ["rps","حجر ورقة مقص","تحدّ خصم الكمبيوتر وارفع نتيجتك.","✊","سريعة"],
    ["quiz","اختبار المعلومات","خمسة أسئلة جديدة في كل جولة.","⚡","ثقافة"]
  ];
  const best = JSON.parse(storageGet("dazza-game-scores","{}") || "{}");
  showContent('<div class="games-hero"><div class="games-hero-copy"><span class="eyebrow">DAZZA ARCADE · FREE TO PLAY</span><h1>مساحة لعبك تبدأ هنا.</h1><p>ألعاب خفيفة وسريعة تعمل داخل دَزّة بدون تنزيل إضافي أو اشتراك.</p><div class="hero-stats"><span><b>05</b><small>ألعاب متاحة</small></span><span><b>0</b><small>تكلفة لعب</small></span><span><b>∞</b><small>محاولات</small></span></div></div><div class="games-orb">✦</div></div><div class="page-heading"><div><h2>اختر لعبتك</h2><p>النتائج الأفضل تُحفظ على هذا الجهاز.</p></div><span class="free-pill">مجاني</span></div><div class="games-grid">' + games.map(([id,title,description,icon,tag],index)=>'<button class="game-card game-card-'+id+'" data-action="launch-game" data-game="'+id+'"><span class="game-card-top"><i>'+icon+'</i><small>'+tag+'</small></span><strong>'+title+'</strong><p>'+description+'</p><span class="game-card-bottom"><span>أفضل نتيجة: '+(best[id] ?? "—")+'</span><b>العب الآن ↗</b></span></button>').join("") + '</div><section class="arcade-note"><span>✧</span><div><strong>اللعب النظيف</strong><p>الألعاب حالياً فردية ومحلية. لا نطلب صلاحيات خاصة ولا نرسل نتائجك إلى خادم خارجي.</p></div></section>');
}
function renderGame(id) {
  activeGame=id;
  if(memoryClock){clearInterval(memoryClock);memoryClock=null;}
  if(id==="memory") {
    const symbols=["🚀","🪐","🎮","🎧","🌙","⚡","👾","💎"];
    const cards=[...symbols,...symbols].map((value,index)=>({id:index,value})).sort(()=>Math.random()-.5);
    gameState={cards,flipped:[],matched:[],moves:0,locked:false,elapsed:0};
    renderMemory();
    memoryClock=setInterval(()=>{
      if(activeGame!=="memory"||!gameState){clearInterval(memoryClock);memoryClock=null;return;}
      if(gameState.matched.length===8){clearInterval(memoryClock);memoryClock=null;return;}
      gameState.elapsed++;
      const timer=$("#memory-time"); if(timer)timer.textContent=formatClock(gameState.elapsed);
    },1000);
    return;
  }
  if(id==="ttt"){gameState={board:Array(9).fill(""),turn:"X",winner:null,thinking:false};return renderTicTacToe();}
  if(id==="rps"){gameState={wins:0,losses:0,draws:0,last:null};return renderRps();}
  if(id==="quiz"){quizQuestions=[...QUIZ_BANK].sort(()=>Math.random()-.5).slice(0,5);quizIndex=0;quizScore=0;quizSelected=null;return renderQuiz();}
  if(id==="2048"){
    const board=Array.from({length:4},()=>Array(4).fill(0));
    add2048Tile(board);add2048Tile(board);
    gameState={board,score:0,over:false,won:false};
    return render2048();
  }
  renderGames();
}
function gameLayout(title,desc,body) {
  return '<div class="game-page"><div class="game-page-head"><button class="back-link" data-action="games-home">← كل الألعاب</button><span class="game-kicker">DAZZA ARCADE</span></div><section class="game-panel"><div class="game-panel-head"><div><h1>'+title+'</h1><p>'+desc+'</p></div><button class="icon-action" data-action="game-reset" aria-label="إعادة اللعب">↻</button></div>'+body+'</section><p class="game-footnote">لعبة مجانية داخل دَزّة · النتائج محفوظة محلياً على جهازك.</p></div>';
}
function formatClock(seconds) {
  const mins=String(Math.floor(seconds/60)).padStart(2,"0");
  const secs=String(seconds%60).padStart(2,"0");
  return mins+":"+secs;
}
function renderMemory() {
  if(!gameState)return;
  const done=gameState.matched.length===8;
  showContent(gameLayout("ذاكرة الكواكب","اكشف البطاقات وطابق الرموز المتشابهة.",'<div class="game-metrics"><span>المحاولات <b>'+gameState.moves+'</b></span><span>الوقت <b id="memory-time">'+formatClock(gameState.elapsed)+'</b></span><span>الأزواج <b>'+gameState.matched.length+'/8</b></span></div><div class="memory-grid">'+gameState.cards.map((card,index)=>'<button class="memory-card '+(gameState.flipped.includes(index)||gameState.matched.includes(index)?"revealed":"")+' '+(gameState.matched.includes(index)?"matched":"")+'" data-action="memory-card" data-index="'+index+'" aria-label="بطاقة '+(index+1)+'">'+(gameState.flipped.includes(index)||gameState.matched.includes(index)?card.value:"✦")+'</button>').join("")+'</div>'+(done?'<div class="game-result"><strong>ممتاز! خلصت الجولة.</strong><p>أنهيتها بـ '+gameState.moves+' محاولة خلال '+formatClock(gameState.elapsed)+'.</p></div>':'<p class="game-hint">اضغط بطاقتين في كل مرة وحاول تتذكر أماكن الرموز.</p>')));
  if(done){saveGameScore("memory",Math.max(1,1000-gameState.moves*10-gameState.elapsed));if(memoryClock){clearInterval(memoryClock);memoryClock=null;}}
}
function flipMemoryCard(index) {
  if(!gameState||gameState.locked||gameState.flipped.includes(index)||gameState.matched.includes(index))return;
  gameState.flipped.push(index);
  if(gameState.flipped.length===2){
    gameState.moves++;
    const [first,second]=gameState.flipped;
    if(gameState.cards[first].value===gameState.cards[second].value){
      gameState.matched.push(first,second);
      gameState.flipped=[];
      renderMemory();
      return;
    }
    gameState.locked=true;
    renderMemory();
    setTimeout(()=>{if(!gameState||activeGame!=="memory")return;gameState.flipped=[];gameState.locked=false;renderMemory();},850);
    return;
  }
  renderMemory();
}
function tttWinner(board) {
  const lines=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for(const [a,b,c] of lines)if(board[a]&&board[a]===board[b]&&board[a]===board[c])return board[a];
  return board.every(Boolean)?"draw":null;
}
function minimax(board,isMaximizing,depth=0) {
  const winner=tttWinner(board);
  if(winner==="O")return 10-depth;
  if(winner==="X")return depth-10;
  if(winner==="draw")return 0;
  const moves=[];
  board.forEach((v,i)=>{if(!v){board[i]=isMaximizing?"O":"X";const score=minimax(board,!isMaximizing,depth+1);board[i]="";moves.push({index:i,score});}});
  if(!moves.length)return 0;
  return isMaximizing?Math.max(...moves.map(x=>x.score)):Math.min(...moves.map(x=>x.score));
}
function bestTttMove(board) {
  let best=-Infinity,index=-1;
  board.forEach((v,i)=>{if(!v){board[i]="O";const score=minimax(board,false);board[i]="";if(score>best){best=score;index=i;}}});
  return index;
}
function renderTicTacToe() {
  if(!gameState)return;
  const winner=gameState.winner;
  const result=winner?(winner==="draw"?"تعادل! جولة متكافئة.":winner==="X"?"فزت على الكمبيوتر!":"هذه المرة الكمبيوتر فاز."):"أنت X · الكمبيوتر O";
  showContent(gameLayout("إكس أو","تحدّ خصم الكمبيوتر. العب بذكاء وخذ الوسط إذا استطعت.",'<div class="ttt-status">'+(gameState.thinking?"الكمبيوتر يفكر…":result)+'</div><div class="ttt-board">'+gameState.board.map((v,i)=>'<button class="ttt-cell '+(v?"mark-"+v.toLowerCase():"")+'" data-action="ttt-cell" data-index="'+i+'" '+(v||winner||gameState.thinking?"disabled":"")+'>'+v+'</button>').join("")+'</div><div class="game-result"><span>انتصاراتك <b>'+gameScore("ttt")+'</b></span><p>اللعبة تعمل دون اتصال.</p></div>'));
}
function playTicTacToe(index) {
  if(!gameState||gameState.winner||gameState.thinking||gameState.board[index])return;
  gameState.board[index]="X";
  gameState.winner=tttWinner(gameState.board);
  if(gameState.winner){if(gameState.winner==="X")saveGameScore("ttt",gameScore("ttt")+1);renderTicTacToe();return;}
  gameState.thinking=true;renderTicTacToe();
  setTimeout(()=>{
    if(!gameState||activeGame!=="ttt")return;
    const move=bestTttMove(gameState.board);
    if(move>=0)gameState.board[move]="O";
    gameState.winner=tttWinner(gameState.board);
    gameState.thinking=false;
    renderTicTacToe();
  },380);
}
function renderRps() {
  const s=gameState;
  const last=s.last?'<div class="rps-result"><span>'+s.last.you+'</span><b>'+s.last.result+'</b><span>'+s.last.cpu+'</span></div>':'<p class="game-hint">اختر حركتك لبدء الجولة.</p>';
  showContent(gameLayout("حجر ورقة مقص","اختبر حظك ضد الكمبيوتر واجمع الانتصارات.",'<div class="rps-score"><span>فوز <b>'+s.wins+'</b></span><span>تعادل <b>'+s.draws+'</b></span><span>خسارة <b>'+s.losses+'</b></span></div>'+last+'<div class="rps-choices"><button data-action="rps-choice" data-choice="rock">✊<small>حجر</small></button><button data-action="rps-choice" data-choice="paper">✋<small>ورقة</small></button><button data-action="rps-choice" data-choice="scissors">✌<small>مقص</small></button></div>'));
}
function playRps(choice) {
  if(!gameState)return;
  const choices=["rock","paper","scissors"],icons={rock:"✊",paper:"✋",scissors:"✌"};
  const cpu=choices[Math.floor(Math.random()*3)];
  let result="تعادل";
  if(choice!==cpu){
    const wins=(choice==="rock"&&cpu==="scissors")||(choice==="paper"&&cpu==="rock")||(choice==="scissors"&&cpu==="paper");
    result=wins?"فزت!":"الكمبيوتر فاز";
    if(wins)gameState.wins++;else gameState.losses++;
  } else gameState.draws++;
  gameState.last={you:icons[choice],cpu:icons[cpu],result};
  if(gameState.wins>gameScore("rps"))saveGameScore("rps",gameState.wins);
  renderRps();
}
function renderQuiz() {
  if(quizIndex>=quizQuestions.length){
    saveGameScore("quiz",quizScore);
    showContent(gameLayout("نتيجة التحدّي","انتهت جولتك الحالية.",'<div class="quiz-finish"><span>🏆</span><strong>'+quizScore+' / '+quizQuestions.length+'</strong><p>'+(quizScore>=4?"ممتاز! ثقافتك قوية.":quizScore>=2?"نتيجة حلوة، جرب مرة ثانية.":"لا بأس، التعلّم هو المكسب.")+'</p><button class="btn-primary" data-action="game-reset">جولة جديدة</button></div>'));
    return;
  }
  const item=quizQuestions[quizIndex];
  showContent(gameLayout("اختبار المعلومات","سؤال "+(quizIndex+1)+" من "+quizQuestions.length+" · إجابات سريعة.",'<div class="quiz-progress"><span style="width:'+((quizIndex)/quizQuestions.length*100)+'%"></span></div><div class="quiz-scoreline">النقاط الحالية <b>'+quizScore+'</b></div><h2 class="quiz-question">'+item.q+'</h2><div class="quiz-options">'+item.a.map((answer,index)=>'<button class="quiz-option '+(quizSelected!==null?(index===item.correct?"correct":index===quizSelected?"wrong":""):"")+'" data-action="quiz-answer" data-index="'+index+'" '+(quizSelected!==null?"disabled":"")+'>'+answer+'</button>').join("")+'</div>'+(quizSelected!==null?'<div class="quiz-feedback">'+(quizSelected===item.correct?"إجابة صحيحة! ":"ليست الإجابة الصحيحة. ")+item.why+'<button class="btn-primary" data-action="quiz-next">السؤال التالي</button></div>':''));
}
function answerQuiz(index) {
  if(quizSelected!==null||!quizQuestions[quizIndex])return;
  quizSelected=index;
  if(index===quizQuestions[quizIndex].correct)quizScore++;
  renderQuiz();
}
function nextQuizQuestion(){quizIndex++;quizSelected=null;renderQuiz();}
function add2048Tile(board) {
  const empty=[];
  board.forEach((row,r)=>row.forEach((value,c)=>{if(!value)empty.push([r,c]);}));
  if(!empty.length)return;
  const [r,c]=empty[Math.floor(Math.random()*empty.length)];
  board[r][c]=Math.random()<.9?2:4;
}
function merge2048Line(line) {
  const values=line.filter(Boolean);
  const result=[];let gain=0;
  for(let i=0;i<values.length;i++){
    if(values[i]===values[i+1]){const next=values[i]*2;result.push(next);gain+=next;i++;}
    else result.push(values[i]);
  }
  while(result.length<4)result.push(0);
  return {line:result,gain};
}
function is2048Over(board) {
  for(let r=0;r<4;r++)for(let c=0;c<4;c++){
    if(!board[r][c])return false;
    if(c<3&&board[r][c]===board[r][c+1])return false;
    if(r<3&&board[r][c]===board[r+1][c])return false;
  }
  return true;
}
function move2048(direction) {
  if(!gameState||gameState.over)return;
  const old=JSON.stringify(gameState.board),next=gameState.board.map(row=>row.slice());
  let gain=0;
  for(let i=0;i<4;i++){
    let line=[];
    if(direction==="left"||direction==="right")line=next[i].slice();
    else line=next.map(row=>row[i]);
    if(direction==="right"||direction==="down")line.reverse();
    const merged=merge2048Line(line);gain+=merged.gain;line=merged.line;
    if(direction==="right"||direction==="down")line.reverse();
    if(direction==="left"||direction==="right")next[i]=line;
    else for(let r=0;r<4;r++)next[r][i]=line[r];
  }
  if(JSON.stringify(next)===old)return;
  gameState.board=next;gameState.score+=gain;add2048Tile(gameState.board);
  if(gameState.board.flat().includes(2048))gameState.won=true;
  gameState.over=is2048Over(gameState.board);
  const best=gameScore("2048");if(gameState.score>best)saveGameScore("2048",gameState.score);
  render2048();
}
function render2048() {
  if(!gameState)return;
  const tiles=gameState.board.flat().map(value=>'<div class="tile tile-'+(value||0)+'">'+(value||"")+'</div>').join("");
  showContent(gameLayout("2048","حرّك الأرقام وادمج المربعات المتشابهة حتى تصل إلى 2048.",'<div class="game-metrics"><span>النقاط <b>'+gameState.score+'</b></span><span>أفضل نتيجة <b>'+gameScore("2048")+'</b></span></div><div class="board-2048">'+tiles+'</div><div class="game-controls"><button data-action="game-move" data-direction="up">↑</button><div><button data-action="game-move" data-direction="left">←</button><button data-action="game-move" data-direction="down">↓</button><button data-action="game-move" data-direction="right">→</button></div></div>'+(gameState.won?'<div class="game-result"><strong>وصلت إلى 2048! إنجاز ممتاز.</strong></div>':"")+(gameState.over?'<div class="game-result"><strong>انتهت الحركات. نتيجتك '+gameState.score+'.</strong><button class="btn-primary" data-action="game-reset">حاول مجدداً</button></div>':'<p class="game-hint">استخدم الأسهم أو أزرار الاتجاهات. على الهاتف استخدم لوحة التحكم.</p>')));
}
function onGameKeydown(event) {
  if(currentView!=="games"||activeGame!=="2048")return;
  if(["INPUT","TEXTAREA","SELECT"].includes(event.target?.tagName))return;
  const map={ArrowUp:"up",ArrowDown:"down",ArrowLeft:"left",ArrowRight:"right"};
  if(map[event.key]){event.preventDefault();move2048(map[event.key]);}
}
function resetGame() {
  if(activeGame==="hub")return renderGames();
  if(activeGame==="ttt"||activeGame==="memory"||activeGame==="2048"||activeGame==="rps"||activeGame==="quiz")return renderGame(activeGame);
  renderGames();
}
async function renderSettings() {
  const avatar=avatarUrl(profile.avatar_path);
  const theme=storageGet("dazza-theme","midnight");
  showContent('<div class="page-heading"><div><h1>الإعدادات والحساب</h1><p>تحكم بتجربتك داخل دَزّة.</p></div></div><section class="settings-card"><div class="settings-account"><span class="profile-avatar small-avatar">'+(avatar?'<img src="'+esc(avatar)+'" alt="">':initials(profile.display_name))+'</span><div><strong>'+esc(profile.display_name)+'</strong><small>@'+esc(profile.username)+'</small><small>'+esc(session.user.email||"")+'</small></div></div><button class="btn-secondary" data-action="edit-profile">تعديل بيانات الملف</button></section><section class="settings-card"><h2>المظهر</h2><p>اختر الشكل الذي يناسب عينيك.</p><div class="theme-choices"><button data-action="set-theme" data-theme="midnight" class="'+(theme==="midnight"?"selected":"")+'">ليلي فضائي</button><button data-action="set-theme" data-theme="daylight" class="'+(theme==="daylight"?"selected":"")+'">نهاري هادئ</button></div></section><section class="settings-card"><h2>التطبيق</h2><p>ثبّت دَزّة على الشاشة الرئيسية للوصول السريع. الملفات الأساسية قابلة للتخزين المؤقت، لكن المحتوى والحساب يحتاجان اتصالاً.</p><button class="btn-secondary" data-action="install-app">تثبيت دَزّة</button></section><section class="settings-card settings-danger"><h2>الجلسة والأمان</h2><p>تسجيل الخروج من هذا الجهاز فقط، ولن يتم إنهاء جلساتك على الأجهزة الأخرى.</p><button class="btn-danger" data-action="logout">تسجيل الخروج من الحساب</button></section>');
}
async function renderTools() {
  const notes=JSON.parse(storageGet("dazza-notes","[]")||"[]");
  showContent('<div class="page-heading"><div><h1>مختبر دَزّة</h1><p>أدوات سريعة ومجانية، تعمل مباشرة على جهازك.</p></div><span class="free-pill">بدون اشتراك</span></div><div class="tools-grid"><section class="tool-card"><span class="tool-icon">∑</span><h2>حاسبة سريعة</h2><form id="calculator-form" class="tool-form"><input type="number" step="any" name="a" placeholder="الرقم الأول" required><select name="operator"><option value="+">جمع +</option><option value="-">طرح −</option><option value="*">ضرب ×</option><option value="/">قسمة ÷</option><option value="%">باقي القسمة %</option></select><input type="number" step="any" name="b" placeholder="الرقم الثاني" required><button class="btn-primary" type="submit">احسب</button></form><output id="calculator-output" class="tool-output">النتيجة تظهر هنا</output></section><section class="tool-card"><span class="tool-icon">⇄</span><h2>تحويل الوحدات</h2><form id="converter-form" class="tool-form"><input name="amount" type="number" step="any" placeholder="القيمة" required><select name="conversion"><option value="km-mi">كيلومتر ← ميل</option><option value="mi-km">ميل ← كيلومتر</option><option value="kg-lb">كيلوغرام ← باوند</option><option value="lb-kg">باوند ← كيلوغرام</option><option value="c-f">مئوية ← فهرنهايت</option><option value="f-c">فهرنهايت ← مئوية</option><option value="cm-in">سنتيمتر ← إنش</option><option value="in-cm">إنش ← سنتيمتر</option></select><button class="btn-primary" type="submit">حوّل</button></form><output id="converter-output" class="tool-output">اختر الوحدة وأدخل القيمة</output></section><section class="tool-card"><span class="tool-icon">✎</span><h2>ملاحظاتك الخاصة</h2><p>تُحفظ الملاحظات على هذا الجهاز فقط، ولا ترفع إلى الخادم.</p><textarea id="quick-note" rows="3" maxlength="1000" placeholder="اكتب فكرة أو ملاحظة..."></textarea><button class="btn-primary" data-action="save-note">حفظ الملاحظة</button><div class="notes-list">'+(notes.slice(0,8).map((note,index)=>'<div class="note-item"><p>'+esc(note.text)+'</p><small>'+esc(note.date)+'</small><button data-action="delete-note" data-index="'+index+'" aria-label="حذف">×</button></div>').join("")||'<small class="muted">لا توجد ملاحظات محفوظة.</small>')+'</div></section><section class="tool-card"><span class="tool-icon">◷</span><h2>مؤقّت التركيز</h2><p>جلسة تركيز قصيرة، ثم استراحة بسيطة.</p><div class="focus-clock" id="focus-clock">'+formatClock(focusSeconds)+'</div><div class="focus-actions"><button class="btn-primary" data-action="focus-toggle">'+(focusRunning?"إيقاف مؤقت":"ابدأ التركيز")+'</button><button class="btn-secondary" data-action="focus-reset">إعادة</button></div></section><section class="tool-card wide-tool"><span class="tool-icon">Aa</span><h2>عداد النصوص</h2><textarea id="word-input" rows="4" placeholder="الصق أو اكتب النص هنا حتى تحسب كلماته وحروفه..."></textarea><div class="text-stats"><span>كلمات <b id="word-count">0</b></span><span>حروف <b id="char-count">0</b></span><span>حروف بدون مسافات <b id="char-no-space">0</b></span></div></section></div><p class="tools-disclaimer">الأدوات الحسابية والملاحظات والمؤقّت تعمل على جهازك. لا تُرسل محتوى الملاحظات إلى دَزّة.</p>');
}
function saveQuickNote() {
  const input=$("#quick-note");
  const text=String(input?.value||"").trim();
  if(!text)return notice("اكتب ملاحظة قبل الحفظ.","error");
  const notes=JSON.parse(storageGet("dazza-notes","[]")||"[]");
  notes.unshift({text,date:new Date().toLocaleString("ar-IQ")});
  storageSet("dazza-notes",JSON.stringify(notes.slice(0,30)));
  renderTools();
  notice("تم حفظ الملاحظة على هذا الجهاز.");
}
function deleteQuickNote(index) {
  const notes=JSON.parse(storageGet("dazza-notes","[]")||"[]");
  if(index<0||index>=notes.length)return;
  notes.splice(index,1);storageSet("dazza-notes",JSON.stringify(notes));renderTools();
}
function toggleFocusTimer() {
  focusRunning=!focusRunning;
  if(focusRunning){
    focusInterval=setInterval(()=>{
      focusSeconds=Math.max(0,focusSeconds-1);
      const clock=$("#focus-clock");if(clock)clock.textContent=formatClock(focusSeconds);
      if(focusSeconds===0){clearInterval(focusInterval);focusInterval=null;focusRunning=false;notice("انتهت جلسة التركيز. خذ استراحة قصيرة.");const button=$('[data-action="focus-toggle"]');if(button)button.textContent="ابدأ التركيز";}
    },1000);
  } else if(focusInterval){clearInterval(focusInterval);focusInterval=null;}
  const button=$('[data-action="focus-toggle"]');if(button)button.textContent=focusRunning?"إيقاف مؤقت":"متابعة التركيز";
}
function resetFocusTimer() {
  if(focusInterval){clearInterval(focusInterval);focusInterval=null;}
  focusRunning=false;focusSeconds=25*60;
  const clock=$("#focus-clock");if(clock)clock.textContent=formatClock(focusSeconds);
  const button=$('[data-action="focus-toggle"]');if(button)button.textContent="ابدأ التركيز";
}

async function renderExplore() {
  const [users, posts] = await Promise.all([searchUsers(searchTerm || ""), getExplorePosts()]);
  showContent('<div class="page-heading"><div><h1>استكشف</h1><p>اكتشف حسابات ومنشورات جديدة.</p></div></div><form id="search-form" class="search-form"><span>⌕</span><input name="query" value="' + esc(searchTerm) + '" placeholder="ابحث عن اسم مستخدم أو شخص أو منشور"><button class="btn-primary" type="submit">بحث</button></form><section class="search-results"><h2>الحسابات</h2>' + (users.map(userRow).join("") || '<p class="muted">ما لقينا حسابات مطابقة.</p>') + '</section><section class="explore-posts"><h2>منشورات المجتمع</h2><div class="explore-grid">' + posts.map(post => '<button class="explore-tile" data-action="open-post" data-id="' + post.id + '">' + (post.media_path ? (post.media_type === "video" ? '<video src="' + esc(publicUrl(post.media_path)) + '" muted></video>' : '<img loading="lazy" src="' + esc(publicUrl(post.media_path)) + '" alt="">') : '<span>' + esc(post.caption.slice(0,90)) + '</span>') + '</button>').join("") + '</div></section>');
}
async function searchUsers(query) {
  let request = supabase.from("profiles").select("id,username,display_name,avatar_path,bio").neq("id", session.user.id).order("created_at", { ascending: false }).limit(12);
  if (query.trim()) request = request.or("username.ilike.%" + query.trim().replace(/[%,()]/g, "") + "%,display_name.ilike.%" + query.trim().replace(/[%,()]/g, "") + "%");
  const { data, error } = await request;
  if (error) throw error;
  const ids = (data || []).map(row => row.id);
  const following = ids.length ? await supabase.from("follows").select("following_id").eq("follower_id", session.user.id).in("following_id", ids) : { data: [] };
  const set = new Set((following.data || []).map(row => row.following_id));
  return (data || []).map(user => ({ ...user, following: set.has(user.id) }));
}
async function getExplorePosts() {
  let request = supabase.from("posts").select("*").order("created_at", { ascending: false }).limit(30);
  if (searchTerm.trim()) request = request.ilike("caption", "%" + searchTerm.trim().replace(/[%,()]/g, "") + "%");
  const { data, error } = await request;
  if (error) throw error;
  return enrichPosts(data || []);
}
function userRow(user) {
  const avatar = avatarUrl(user.avatar_path);
  return '<div class="user-row"><button class="post-author" data-action="open-profile" data-id="' + user.id + '"><span class="avatar">' + (avatar ? '<img src="' + esc(avatar) + '" alt="">' : initials(user.display_name)) + '</span><span><strong>' + esc(user.display_name) + '</strong><small>@' + esc(user.username) + '</small><small class="muted">' + esc(user.bio || "") + '</small></span></button><button class="' + (user.following ? "btn-secondary" : "btn-primary") + ' btn-small" data-action="follow" data-id="' + user.id + '" data-following="' + !!user.following + '">' + (user.following ? "تتابعه" : "متابعة") + '</button></div>';
}
async function renderProfile(userId) {
  const [profileResult, postsResult, followersResult, followingResult] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).single(),
    supabase.from("posts").select("*", { count: "exact" }).eq("user_id", userId).order("created_at", { ascending: false }).limit(90),
    supabase.from("follows").select("follower_id", { count: "exact", head: true }).eq("following_id", userId).eq("status", "accepted"),
    supabase.from("follows").select("following_id", { count: "exact", head: true }).eq("follower_id", userId).eq("status", "accepted")
  ]);
  if (profileResult.error) throw profileResult.error;
  if (postsResult.error) throw postsResult.error;
  const user = profileResult.data;
  const mine = userId === session.user.id;
  const followResult = mine ? { data: null } : await supabase.from("follows").select("follower_id").eq("follower_id", session.user.id).eq("following_id", userId).maybeSingle();
  if (followResult.error) throw followResult.error;
  const isFollowing = !!followResult.data;
  const avatar = avatarUrl(user.avatar_path);
  const posts = await enrichPosts(postsResult.data || []);
  showContent('<div class="profile-page"><section class="profile-header"><div class="profile-avatar">' + (avatar ? '<img src="' + esc(avatar) + '" alt="">' : initials(user.display_name)) + '</div><div class="profile-info"><div class="profile-title"><h1>' + esc(user.username) + '</h1>' + (mine ? '<button class="btn-secondary" data-action="edit-profile">تعديل الملف</button>' : '<button class="' + (isFollowing ? "btn-secondary" : "btn-primary") + '" data-action="follow" data-id="' + user.id + '" data-following="' + isFollowing + '">' + (isFollowing ? "إلغاء المتابعة" : "متابعة") + '</button><button class="btn-secondary" data-action="message-user" data-id="' + user.id + '">رسالة</button>') + '</div><div class="profile-stats"><span><b>' + (postsResult.count || 0) + '</b> منشور</span><button data-action="open-follow-list" data-type="followers" data-id="' + user.id + '"><b>' + (followersResult.count || 0) + '</b> متابع</button><button data-action="open-follow-list" data-type="following" data-id="' + user.id + '"><b>' + (followingResult.count || 0) + '</b> يتابع</button></div><strong>' + esc(user.display_name) + '</strong><p>' + esc(user.bio || "لا توجد نبذة بعد.") + '</p>' + (user.website && (user.website.startsWith("https://") || user.website.startsWith("http://")) ? '<a class="profile-website" href="' + esc(user.website) + '" target="_blank" rel="noopener noreferrer">' + esc(user.website) + '</a>' : '') + '</div></section><div class="profile-tabs"><span>▦ المنشورات</span></div><div class="profile-grid">' + posts.map(post => '<button class="profile-tile" data-action="open-post" data-id="' + post.id + '">' + (post.media_path ? (post.media_type === "video" ? '<video src="' + esc(publicUrl(post.media_path)) + '" muted></video>' : '<img loading="lazy" src="' + esc(publicUrl(post.media_path)) + '" alt="">') : '<span>' + esc(post.caption.slice(0,110)) + '</span>') + '</button>').join("") + '</div>' + (!posts.length ? '<div class="empty-state"><h2>ماكو منشورات بعد</h2><p>' + (mine ? "شارك أول منشور ويا مجتمعك." : "هذا الحساب ما نشر أي منشور بعد.") + '</p>' + (mine ? '<button class="btn-primary" data-action="new-post">إنشاء منشور</button>' : '') + '</div>' : '') + '</div>');
}
async function renderFollowList(userId, type) {
  const isFollowers = type === "followers";
  const query = isFollowers
    ? supabase.from("follows").select("follower_id").eq("following_id", userId).eq("status", "accepted")
    : supabase.from("follows").select("following_id").eq("follower_id", userId).eq("status", "accepted");
  const { data, error } = await query.order("created_at", { ascending: false }).limit(150);
  if (error) return notice(error.message, "error");
  const ids = (data || []).map(row => isFollowers ? row.follower_id : row.following_id);
  const people = ids.length ? await supabase.from("profiles").select("id,username,display_name,avatar_path,bio").in("id", ids) : { data: [], error: null };
  if (people.error) return notice(people.error.message, "error");
  const following = ids.length ? await supabase.from("follows").select("following_id").eq("follower_id", session.user.id).in("following_id", ids) : { data: [] };
  if (following.error) return notice(following.error.message, "error");
  const followingSet = new Set((following.data || []).map(row => row.following_id));
  const profiles = new Map((people.data || []).map(person => [person.id, person]));
  const users = ids.map(id => profiles.get(id)).filter(Boolean).map(user => ({ ...user, following: followingSet.has(user.id) }));
  openModal('<header class="modal-head"><h2>' + (isFollowers ? "المتابعون" : "يتابع") + '</h2><button data-action="close-modal" class="close-btn">×</button></header>' +
    '<div class="follow-list">' + (users.map(userRow).join("") || '<p class="muted">ماكو حسابات بهالقائمة بعد.</p>') + '</div>');
}
async function renderNotifications() {
  const { data, error } = await supabase.from("notifications").select("*").eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(60);
  if (error) throw error;
  const rows = data || [];
  const actorIds = [...new Set(rows.map(row => row.actor_id))];
  const people = actorIds.length ? await supabase.from("profiles").select("id,username,display_name,avatar_path").in("id", actorIds) : { data: [] };
  if (people.error) throw people.error;
  const map = new Map((people.data || []).map(person => [person.id, person]));
  showContent('<div class="page-heading"><div><h1>الإشعارات</h1><p>تفاعلات الناس وياك.</p></div><button class="link-btn" data-action="mark-notifications">تعليم الكل كمقروء</button></div><section class="notification-list">' + (rows.map(row => {
    const actor = map.get(row.actor_id) || {};
    const avatar = avatarUrl(actor.avatar_path);
    const text = row.type === "like" ? "أعجب بمنشورك" : row.type === "comment" ? "علّق على منشورك" : row.type === "message" ? "أرسل لك رسالة" : "بدأ بمتابعتك";
    return '<button class="notification-row ' + (!row.is_read ? "unread" : "") + '" data-action="notification-open" data-post="' + (row.post_id || "") + '" data-conversation="' + (row.conversation_id || "") + '" data-id="' + row.id + '"><span class="avatar">' + (avatar ? '<img src="' + esc(avatar) + '" alt="">' : initials(actor.display_name)) + '</span><span><strong>' + esc(actor.display_name || actor.username || "مستخدم") + '</strong> ' + text + '<small>' + dateLabel(row.created_at) + '</small></span><i>' + (row.type === "follow" ? "＋" : row.type === "like" ? "♥" : "▢") + '</i></button>';
  }).join("") || '<div class="empty-state"><h2>ماكو إشعارات</h2><p>راح تظهر هنا التفاعلات الجديدة.</p></div>') + '</section>');
  await supabase.from("notifications").update({ is_read: true }).eq("user_id", session.user.id).eq("is_read", false);
  loadNotificationBadge();
}
async function renderSaved() {
  const { data, error } = await supabase.from("post_bookmarks").select("post_id,created_at").eq("user_id", session.user.id).order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  const ids = (data || []).map(row => row.post_id);
  const posts = ids.length ? await supabase.from("posts").select("*").in("id", ids) : { data: [], error: null };
  if (posts.error) throw posts.error;
  const order = new Map(ids.map((id, index) => [id, index]));
  const enriched = await enrichPosts((posts.data || []).sort((a,b) => order.get(a.id) - order.get(b.id)));
  showContent('<div class="page-heading"><div><h1>المحفوظات</h1><p>المنشورات اللي احتفظت بيها.</p></div></div>' + (enriched.map(postCard).join("") || '<div class="empty-state"><h2>ما عندك محفوظات</h2><p>اضغط علامة الحفظ على أي منشور حتى يرجعلك هنا.</p></div>'));
}
async function loadSuggestions() {
  try {
    const users = await searchUsers("");
    const target = $("#suggestions");
    if (!target) return;
    target.innerHTML = '<div class="section-head"><strong>اقتراحات للمتابعة</strong><button class="link-btn" data-view="explore">عرض الكل</button></div>' + (users.slice(0,5).map(userRow).join("") || '<p class="muted small">ماكو اقتراحات جديدة حالياً.</p>');
  } catch (error) { console.warn("Suggestions unavailable", error); }
}
async function loadNotificationBadge() {
  const { count, error } = await supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", session.user.id).eq("is_read", false);
  const badge = $("#notification-badge");
  if (badge && !error) { badge.hidden = !count; badge.textContent = count > 9 ? "9+" : String(count || ""); }
}
function startRealtime() {
  if (liveChannel) supabase.removeChannel(liveChannel);
  liveChannel = supabase.channel("dazza-social-" + session.user.id)
    .on("postgres_changes", { event: "*", schema: "public", table: "posts" }, () => {
      if (currentView === "feed") renderFeed().catch(console.error);
      if (currentView === "profile") renderProfile(currentProfileId).catch(console.error);
    })
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "user_id=eq." + session.user.id }, () => loadNotificationBadge())
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, payload => {
      if (currentView === "messages" && activeConversation === payload.new.conversation_id) renderMessages().catch(console.error);
    }).subscribe();
}

function openModal(html) {
  const target = $("#modal-root");
  if (!target) return;
  target.innerHTML = '<div class="modal-backdrop" data-action="close-modal"><section class="modal-card" role="dialog" aria-modal="true">' + html + '</section></div>';
}
function closeModal() {
  const target = $("#modal-root");
  if (target) target.innerHTML = "";
}
function postModal() {
  openModal('<header class="modal-head"><h2>منشور جديد</h2><button data-action="close-modal" class="close-btn">×</button></header><form id="post-form"><label>شنو تحب تشارك؟</label><textarea name="caption" maxlength="2200" rows="4" placeholder="اكتب شي حلو..."></textarea><label>صورة أو فيديو</label><input name="media" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"><label>الموقع (اختياري)</label><input name="location" maxlength="120" placeholder="بغداد، العراق"><p class="muted small">الحد الأعلى للملف 50 ميغابايت. الصور والفيديوهات في المنشورات متاحة لمستخدمي الموقع.</p><button class="btn-primary full" type="submit">نشر المنشور</button></form>');
}
function profileModal() {
  openModal('<header class="modal-head"><h2>تعديل الملف الشخصي</h2><button data-action="close-modal" class="close-btn">×</button></header><form id="profile-form"><label>الاسم الظاهر</label><input name="display_name" maxlength="80" required value="' + esc(profile.display_name) + '"><label>نبذة عنك</label><textarea name="bio" maxlength="160" rows="3" placeholder="اكتب نبذة بسيطة">' + esc(profile.bio || "") + '</textarea><label>الموقع الإلكتروني</label><input name="website" type="url" maxlength="200" value="' + esc(profile.website || "") + '" placeholder="https://example.com"><label>الصورة الشخصية</label><input name="avatar" type="file" accept="image/jpeg,image/png,image/webp"><button class="btn-primary full" type="submit">حفظ التغييرات</button></form>');
}
async function uploadMedia(file, folder) {
  if (!file) return null;
  const allowed = ["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm"];
  if (!allowed.includes(file.type)) throw new Error("نوع الملف غير مدعوم. استخدم JPG أو PNG أو WEBP أو GIF أو MP4 أو WEBM.");
  if (file.size > 50 * 1024 * 1024) throw new Error("حجم الملف أكبر من 50 ميغابايت.");
  const extension = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = session.user.id + "/" + folder + "/" + crypto.randomUUID() + "." + extension;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    cacheControl: "3600", upsert: false, contentType: file.type
  });
  if (error) throw error;
  return { path, type: file.type.startsWith("video/") ? "video" : "image" };
}
async function addStory(file) {
  try {
    if (!file) return;
    setBusy(true);
    const media = await uploadMedia(file, "stories");
    const { error } = await supabase.from("stories").insert({
      user_id: session.user.id, media_path: media.path, media_type: media.type,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    });
    if (error) {
      await supabase.storage.from(BUCKET).remove([media.path]);
      throw error;
    }
    notice("تم نشر قصتك، وتبقى ظاهرة لمدة 24 ساعة.");
    if (currentView === "feed") await renderFeed();
  } catch (error) { notice(error.message, "error"); }
  finally { setBusy(false); }
}
async function openStory(storyId) {
  const { data: story, error } = await supabase.from("stories").select("*").eq("id", storyId).single();
  if (error) return notice(error.message, "error");
  const { data: author } = await supabase.from("profiles").select("id,username,display_name,avatar_path").eq("id", story.user_id).single();
  if (story.user_id !== session.user.id) {
    const alreadyViewed = await supabase.from("story_views").select("story_id").eq("story_id", story.id).eq("viewer_id", session.user.id).maybeSingle();
    if (!alreadyViewed.data) await supabase.from("story_views").insert({ story_id: story.id, viewer_id: session.user.id });
  }
  const { data: siblings } = await supabase.from("stories").select("id").eq("user_id", story.user_id).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: true });
  const storyList = siblings || [];
  const index = storyList.findIndex(item => item.id === story.id);
  const previous = index > 0 ? storyList[index - 1].id : "";
  const next = index >= 0 && index < storyList.length - 1 ? storyList[index + 1].id : "";
  const media = publicUrl(story.media_path);
  const element = story.media_type === "video"
    ? '<video class="story-media" src="' + esc(media) + '" controls autoplay playsinline></video>'
    : '<img class="story-media" src="' + esc(media) + '" alt="قصة">';
  openModal('<div class="story-viewer"><header><button class="story-step" data-action="previous-story" data-id="' + previous + '" ' + (!previous ? "disabled" : "") + '>‹</button><span>' + esc(author?.display_name || author?.username || "قصة") + '</span><button class="close-btn" data-action="close-modal">×</button></header>' +
    '<div class="story-stage">' + element + '</div>' + (story.caption ? '<p>' + esc(story.caption) + '</p>' : '') +
    '<footer><small>' + dateLabel(story.created_at) + ' · ' + (index + 1) + ' / ' + storyList.length + '</small><button class="story-step" data-action="next-story" data-id="' + next + '" ' + (!next ? "disabled" : "") + '>›</button></footer></div>');
}

async function renderComments(postId) {
  const [commentsResult, postResult] = await Promise.all([
    supabase.from("post_comments").select("*").eq("post_id", postId).order("created_at", { ascending: true }).limit(100),
    supabase.from("posts").select("id,caption").eq("id", postId).single()
  ]);
  if (commentsResult.error) return notice(commentsResult.error.message, "error");
  if (postResult.error) return notice(postResult.error.message, "error");
  const rows = commentsResult.data || [];
  const ids = [...new Set(rows.map(row => row.user_id))];
  const people = ids.length ? await supabase.from("profiles").select("id,username,display_name,avatar_path").in("id", ids) : { data: [] };
  if (people.error) return notice(people.error.message, "error");
  const map = new Map((people.data || []).map(person => [person.id, person]));
  const html = rows.map(row => {
    const person = map.get(row.user_id) || {};
    const avatar = avatarUrl(person.avatar_path);
    return '<article class="comment-row"><span class="avatar">' + (avatar ? '<img src="' + esc(avatar) + '" alt="">' : initials(person.display_name)) + '</span><div><strong>' + esc(person.username || person.display_name || "عضو") + '</strong><p>' + esc(row.body) + '</p><small>' + dateLabel(row.created_at) + '</small></div></article>';
  }).join("");
  openModal('<header class="modal-head"><h2>التعليقات</h2><button data-action="close-modal" class="close-btn">×</button></header>' +
    '<div class="comment-list">' + (html || '<p class="muted">ماكو تعليقات بعد. اكتب أول تعليق.</p>') + '</div>' +
    '<form class="comment-form modal-comment-form" data-post="' + postId + '"><input name="body" maxlength="1000" placeholder="اكتب تعليقاً..." required><button type="submit">نشر</button></form>');
}
async function renderPostModal(postId) {
  const { data, error } = await supabase.from("posts").select("*").eq("id", postId).single();
  if (error) return notice(error.message, "error");
  const posts = await enrichPosts([data]);
  if (!posts.length) return;
  const post = posts[0];
  openModal('<header class="modal-head"><h2>المنشور</h2><button data-action="close-modal" class="close-btn">×</button></header>' + postCard(post));
}
async function toggleLike(button) {
  const postId = button.dataset.id;
  const liked = button.dataset.liked === "true";
  button.disabled = true;
  const result = liked
    ? await supabase.from("post_likes").delete().eq("post_id", postId).eq("user_id", session.user.id)
    : await supabase.from("post_likes").insert({ post_id: postId, user_id: session.user.id });
  button.disabled = false;
  if (result.error) return notice(result.error.message, "error");
  button.dataset.liked = String(!liked);
  button.classList.toggle("is-liked", !liked);
  const count = $("b", button);
  if (count) count.textContent = String(Math.max(0, Number(count.textContent) + (liked ? -1 : 1)));
  const icon = $("span", button);
  if (icon) icon.textContent = liked ? "♡" : "♥";
}
async function toggleBookmark(button) {
  const postId = button.dataset.id;
  const saved = button.classList.contains("is-saved");
  const result = saved
    ? await supabase.from("post_bookmarks").delete().eq("post_id", postId).eq("user_id", session.user.id)
    : await supabase.from("post_bookmarks").insert({ post_id: postId, user_id: session.user.id });
  if (result.error) return notice(result.error.message, "error");
  button.classList.toggle("is-saved", !saved);
  $("span", button).textContent = saved ? "▢" : "▣";
}
async function followUser(userId, button) {
  const following = button?.dataset.following === "true";
  const result = following
    ? await supabase.from("follows").delete().eq("follower_id", session.user.id).eq("following_id", userId)
    : await supabase.from("follows").insert({ follower_id: session.user.id, following_id: userId, status: "accepted" });
  if (result.error) return notice(result.error.message, "error");
  notice(following ? "تم إلغاء المتابعة." : "تمت المتابعة بنجاح.");
  if (button) {
    button.dataset.following = String(!following);
    button.textContent = following ? "متابعة" : "إلغاء المتابعة";
    button.classList.toggle("btn-primary", following);
    button.classList.toggle("btn-secondary", !following);
  }
  if (currentView === "profile") await renderProfile(currentProfileId);
  loadSuggestions();
}

async function renderMessages() {
  const { data: memberships, error } = await supabase.from("conversation_members").select("conversation_id,joined_at").eq("user_id", session.user.id).order("joined_at", { ascending: false });
  if (error) throw error;
  const ids = (memberships || []).map(row => row.conversation_id);
  let rooms = [];
  if (ids.length) {
    const [membersResult, convResult] = await Promise.all([
      supabase.from("conversation_members").select("conversation_id,user_id").in("conversation_id", ids),
      supabase.from("conversations").select("id,created_at").in("id", ids)
    ]);
    if (membersResult.error) throw membersResult.error;
    if (convResult.error) throw convResult.error;
    const otherIds = [...new Set((membersResult.data || []).filter(item => item.user_id !== session.user.id).map(item => item.user_id))];
    const users = otherIds.length ? await supabase.from("profiles").select("id,username,display_name,avatar_path").in("id", otherIds) : { data: [] };
    if (users.error) throw users.error;
    const userMap = new Map(users.data.map(user => [user.id, user]));
    rooms = (convResult.data || []).map(conv => {
      const other = (membersResult.data || []).find(item => item.conversation_id === conv.id && item.user_id !== session.user.id);
      return { ...conv, person: userMap.get(other?.user_id), title: userMap.get(other?.user_id)?.display_name || "محادثة" };
    });
  }
  const selected = rooms.find(room => room.id === activeConversation);
  let messageHTML = '<div class="empty-state"><h2>اختار محادثة</h2><p>ابدأ محادثة خاصة ويا شخص من المجتمع.</p><button class="btn-primary" data-action="new-chat">رسالة جديدة</button></div>';
  if (selected) {
    const { data: messages, error: messageError } = await supabase.from("messages").select("*").eq("conversation_id", selected.id).order("created_at", { ascending: true }).limit(300);
    if (messageError) throw messageError;
    messageHTML = '<header class="dm-head"><strong>' + esc(selected.title) + '</strong><small>@' + esc(selected.person?.username || "") + '</small></header><div id="dm-messages" class="dm-messages">' + (messages || []).map(message => '<article class="dm-message ' + (message.sender_id === session.user.id ? "mine" : "") + '"><p>' + esc(message.body) + '</p><small>' + dateLabel(message.created_at) + '</small></article>').join("") + '</div><form id="dm-form" class="dm-form"><input name="body" maxlength="5000" placeholder="اكتب رسالتك..." required><button class="btn-primary" type="submit">إرسال</button></form>';
  }
  showContent('<div class="dm-page"><header class="page-heading"><div><h1>الرسائل</h1><p>محادثاتك الخاصة.</p></div><button class="btn-primary" data-action="new-chat">رسالة جديدة</button></header><div class="dm-layout"><aside class="dm-list">' + (rooms.map(room => '<button class="dm-room ' + (room.id === activeConversation ? "selected" : "") + '" data-action="open-dm" data-id="' + room.id + '"><span class="avatar">' + initials(room.title) + '</span><span><strong>' + esc(room.title) + '</strong><small>@' + esc(room.person?.username || "") + '</small></span></button>').join("") || '<p class="muted">ما عندك محادثات بعد.</p>') + '</aside><section class="dm-conversation">' + messageHTML + '</section></div></div>');
  const box = $("#dm-messages");
  if (box) box.scrollTop = box.scrollHeight;
  conversations = rooms;
}
async function startDirectMessage(userId) {
  const { data: conversationId, error } = await supabase.rpc("create_direct_conversation", {
    p_other_user_id: userId
  });
  if (error) return notice(error.message, "error");
  activeConversation = conversationId;
  await navigate("messages");
}
async function promptNewChat() {
  const username = prompt("اكتب اسم المستخدم بدون @");
  if (!username) return;
  const { data, error } = await supabase.from("profiles").select("id").eq("username", username.trim().replace(/^@/, "").toLowerCase()).maybeSingle();
  if (error) return notice(error.message, "error");
  if (!data) return notice("ما لقينا هذا المستخدم.", "error");
  if (data.id === session.user.id) return notice("ما تكدر تراسل نفسك.", "error");
  await startDirectMessage(data.id);
}

async function onClick(event) {
  const node = event.target.closest("[data-action],[data-view]");
  if (!node) return;
  const action = node.dataset.action;
  const view = node.dataset.view;
  if (view) {
    event.preventDefault();
    closeModal();
    if (view === "my-profile") await navigate("profile", session.user.id);
    else await navigate(view);
    return;
  }
  if (!action) return;
  if (action === "switch-auth") return authView(node.dataset.mode);
  if (action === "logout") return signOutUser();
  if (action === "account-menu") return accountMenu();
  if (action === "forgot-password") return openForgotPassword();
  if (action === "toggle-theme") {
    const next = storageGet("dazza-theme", "midnight") === "midnight" ? "daylight" : "midnight";
    storageSet("dazza-theme", next); applyTheme(); notice(next === "daylight" ? "تم تفعيل المظهر النهاري." : "تم تفعيل المظهر الليلي.");
    return;
  }
  if (action === "set-theme") {
    storageSet("dazza-theme", node.dataset.theme === "daylight" ? "daylight" : "midnight");
    applyTheme(); return renderSettings();
  }
  if (action === "toggle-password") {
    const input = $("#password");
    if (input) { input.type = input.type === "password" ? "text" : "password"; node.setAttribute("aria-label", input.type === "password" ? "إظهار كلمة المرور" : "إخفاء كلمة المرور"); }
    return;
  }
  if (action === "install-app") {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const result = await deferredInstallPrompt.userChoice;
      notice(result?.outcome === "accepted" ? "تم بدء تثبيت دَزّة." : "يمكنك تثبيت دَزّة لاحقاً من قائمة المتصفح.");
      deferredInstallPrompt = null;
    } else notice("من قائمة المتصفح اختر «إضافة إلى الشاشة الرئيسية» لتثبيت دَزّة.");
    return;
  }
  if (action === "new-post") return postModal();
  if (action === "edit-profile") return profileModal();
  if (action === "close-modal") {
    if (event.target === node || node.classList.contains("close-btn")) closeModal();
    return;
  }
  if (action === "my-profile") return navigate("profile", session.user.id);
  if (action === "open-profile") return navigate("profile", node.dataset.id);
  if (action === "follow") return followUser(node.dataset.id, node);
  if (action === "open-follow-list") return renderFollowList(node.dataset.id, node.dataset.type);
  if (action === "toggle-like") return toggleLike(node);
  if (action === "toggle-save") return toggleBookmark(node);
  if (action === "feed-filter") {
    feedFilter = node.dataset.filter;
    return renderFeed();
  }
  if (action === "add-story") {
    const input = $("#story-upload");
    if (input) input.click();
    else {
      const hidden = document.createElement("input");
      hidden.type = "file"; hidden.accept = "image/jpeg,image/png,image/webp,video/mp4,video/webm";
      hidden.onchange = () => addStory(hidden.files?.[0]);
      hidden.click();
    }
    return;
  }
  if (action === "open-story") return openStory(node.dataset.id);
  if (action === "previous-story" || action === "next-story") {
    if (node.dataset.id) return openStory(node.dataset.id);
    return;
  }
  if (action === "view-comments") return renderComments(node.dataset.id);
  if (action === "focus-comment") {
    const form = $('form[data-post="' + node.dataset.id + '"]');
    if (form) { form.querySelector("input")?.focus(); form.scrollIntoView({ behavior: "smooth", block: "center" }); }
    return;
  }
  if (action === "share-post") {
    const url = location.origin + location.pathname + "?post=" + encodeURIComponent(node.dataset.id);
    try { await navigator.clipboard.writeText(url); notice("تم نسخ رابط المنشور."); }
    catch { notice(url); }
    return;
  }
  if (action === "post-menu") {
    const { data: post, error: postError } = await supabase.from("posts").select("id,user_id").eq("id", node.dataset.id).maybeSingle();
    if (postError) return notice(postError.message, "error");
    if (!post) return notice("هذا المنشور لم يعد موجوداً.", "error");
    if (post.user_id === session.user.id && confirm("تحذف هذا المنشور؟")) {
      const { error } = await supabase.from("posts").delete().eq("id", post.id);
      if (error) notice(error.message, "error"); else { closeModal(); notice("تم حذف المنشور."); await navigate(currentView); }
    } else if (post.user_id !== session.user.id) {
      if (confirm("تريد الإبلاغ عن هذا المنشور؟")) notice("وصلنا تنبيهك. نظام البلاغات المتكامل قيد الإعداد.");
    }
    return;
  }
  if (action === "notification-open") {
    await supabase.from("notifications").update({ is_read: true }).eq("id", node.dataset.id);
    loadNotificationBadge();
    if (node.dataset.conversation) {
      activeConversation = node.dataset.conversation;
      return navigate("messages");
    }
    if (node.dataset.post) return renderPostModal(node.dataset.post);
    return navigate("notifications");
  }
  if (action === "mark-notifications") {
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", session.user.id);
    return renderNotifications();
  }
  if (action === "retry") return navigate(currentView);
  if (action === "new-chat") return promptNewChat();
  if (action === "open-dm") { activeConversation = node.dataset.id; return renderMessages(); }
  if (action === "message-user") return startDirectMessage(node.dataset.id);
  if (action === "open-post") return renderPostModal(node.dataset.id);
  if (action === "launch-game") { activeGame = node.dataset.game; gameState = null; return renderGame(activeGame); }
  if (action === "games-home") { activeGame = "hub"; return renderGames(); }
  if (action === "game-reset") return resetGame();
  if (action === "memory-card") return flipMemoryCard(Number(node.dataset.index));
  if (action === "ttt-cell") return playTicTacToe(Number(node.dataset.index));
  if (action === "rps-choice") return playRps(node.dataset.choice);
  if (action === "quiz-answer") return answerQuiz(Number(node.dataset.index));
  if (action === "quiz-next") return nextQuizQuestion();
  if (action === "game-move") return move2048(node.dataset.direction);
  if (action === "focus-toggle") return toggleFocusTimer();
  if (action === "focus-reset") return resetFocusTimer();
  if (action === "save-note") return saveQuickNote();
  if (action === "delete-note") return deleteQuickNote();
  if (action === "copy-tool-result") {
    const value = $("#tool-result")?.textContent || "";
    try { await navigator.clipboard.writeText(value); notice("تم النسخ."); } catch { notice("تعذر النسخ من المتصفح.", "error"); }
    return;
  }
}
async function onSubmit(event) {
  const form = event.target;
  if (!form.matches("form")) return;
  event.preventDefault();
  const data = new FormData(form);
  try {
    if (form.id === "auth-form") {
      const mode = form.dataset.mode;
      const email = String(data.get("email") || "").trim().toLowerCase();
      const password = String(data.get("password") || "");
      const submit = $("button[type=submit]", form);
      submit.disabled = true;
      if (!email || !password) throw new Error("أدخل البريد الإلكتروني وكلمة المرور.");
      if (mode === "signup") {
        const username = String(data.get("username") || "").trim().toLowerCase();
        const display_name = String(data.get("display_name") || "").trim();
        if (!/^[a-z][a-z0-9_]{2,29}$/.test(username)) throw new Error("اسم المستخدم يجب أن يبدأ بحرف إنجليزي ويحتوي 3 إلى 30 حرفاً أو رقماً أو _.");
        if (display_name.length < 1) throw new Error("اكتب الاسم الظاهر.");
        const result = await supabase.auth.signUp({
          email, password, options: { data: { username, display_name }, emailRedirectTo: location.origin }
        });
        if (result.error) throw result.error;
        if (result.data.session) {
          await enter(result.data.session);
        } else {
          const node = $("#auth-notice");
          if (node) { node.textContent = "تم إنشاء الحساب. افتح رسالة تأكيد البريد ثم ارجع وسجّل الدخول."; node.hidden = false; }
        }
      } else {
        const result = await supabase.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        if (!result.data.session) throw new Error("لم يتم إنشاء جلسة دخول. تأكد من تأكيد بريدك الإلكتروني.");
        await enter(result.data.session);
      }
      if (submit) submit.disabled = false;
      return;
    }
    if (form.id === "reset-request-form") {
      const email = String(data.get("email") || "").trim().toLowerCase();
      if (!email) throw new Error("أدخل بريدك الإلكتروني.");
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
      if (error) throw error;
      closeModal();
      if ($("#auth-notice")) {
        $("#auth-notice").textContent = "تم طلب رابط الاستعادة. افحص البريد الوارد ومجلد الرسائل غير المرغوب بها.";
        $("#auth-notice").hidden = false;
      } else notice("تم طلب رابط الاستعادة. افحص بريدك الإلكتروني.");
      return;
    }
    if (form.id === "password-update-form") {
      const password = String(data.get("password") || "");
      const confirmPassword = String(data.get("password_confirm") || "");
      if (password.length < 8) throw new Error("كلمة المرور يجب أن تكون 8 أحرف على الأقل.");
      if (password !== confirmPassword) throw new Error("كلمتا المرور غير متطابقتين.");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      closeModal();
      const { data: current } = await supabase.auth.getSession();
      if (current.session) await enter(current.session);
      else authView("login");
      notice("تم تغيير كلمة المرور بنجاح.");
      return;
    }
    if (form.id === "calculator-form") {
      const a=Number(data.get("a")), b=Number(data.get("b")), op=String(data.get("operator"));
      if(!Number.isFinite(a)||!Number.isFinite(b))throw new Error("أدخل رقمين صالحين.");
      if(op==="/"&&b===0)throw new Error("لا يمكن القسمة على صفر.");
      let result=0;
      if(op==="+")result=a+b;else if(op==="-")result=a-b;else if(op==="*")result=a*b;else if(op==="/")result=a/b;else if(op==="%")result=a%b;
      const output=$("#calculator-output");
      if(output)output.textContent=Number.isFinite(result)?new Intl.NumberFormat("ar-IQ",{maximumFractionDigits:8}).format(result):"نتيجة غير صالحة";
      return;
    }
    if (form.id === "converter-form") {
      const amount=Number(data.get("amount")), kind=String(data.get("conversion"));
      if(!Number.isFinite(amount))throw new Error("أدخل قيمة رقمية.");
      const formulas={
        "km-mi":[amount=>amount*0.621371,"ميل"],
        "mi-km":[amount=>amount/0.621371,"كم"],
        "kg-lb":[amount=>amount*2.2046226218,"باوند"],
        "lb-kg":[amount=>amount/2.2046226218,"كغم"],
        "c-f":[amount=>amount*9/5+32,"°F"],
        "f-c":[amount=>(amount-32)*5/9,"°C"],
        "cm-in":[amount=>amount/2.54,"إنش"],
        "in-cm":[amount=>amount*2.54,"سم"]
      };
      const [convert,unit]=formulas[kind];
      const value=convert(amount);
      const output=$("#converter-output");
      if(output)output.textContent=new Intl.NumberFormat("ar-IQ",{maximumFractionDigits:4}).format(value)+" "+unit;
      return;
    }
    if (form.id === "post-form") {
      const caption = String(data.get("caption") || "").trim();
      const file = data.get("media");
      const locationName = String(data.get("location") || "").trim();
      if (!caption && (!file || !file.size)) throw new Error("اكتب وصفاً أو أرفق صورة أو فيديو.");
      setBusy(true);
      const media = file?.size ? await uploadMedia(file, "posts") : null;
      const { error } = await supabase.from("posts").insert({
        user_id: session.user.id,
        caption,
        location: locationName || null,
        media_path: media?.path || null,
        media_type: media?.type || "text"
      });
      if (error) {
        if (media?.path) await supabase.storage.from(BUCKET).remove([media.path]);
        throw error;
      }
      closeModal(); notice("تم نشر منشورك بنجاح."); await navigate("feed");
      setBusy(false); return;
    }
    if (form.id === "profile-form") {
      setBusy(true);
      let avatarPath = profile.avatar_path;
      const file = data.get("avatar");
      if (file?.size) {
        const media = await uploadMedia(file, "avatars");
        avatarPath = media.path;
      }
      const display_name = String(data.get("display_name") || "").trim();
      const bio = String(data.get("bio") || "").trim();
      const website = String(data.get("website") || "").trim();
      if (website) {
        let parsed;
        try { parsed = new URL(website); } catch { throw new Error("رابط الموقع غير صالح."); }
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("استخدم رابطاً يبدأ بـ https:// أو http://");
      }
      const { data: updated, error } = await supabase.from("profiles").update({
        display_name, bio, website: website || null, avatar_path: avatarPath, updated_at: new Date().toISOString()
      }).eq("id", session.user.id).select("*").single();
      if (error) throw error;
      if (profile.avatar_path && profile.avatar_path !== avatarPath) {
        await supabase.storage.from(BUCKET).remove([profile.avatar_path]);
      }
      profile = updated; closeModal(); notice("تم تحديث ملفك الشخصي."); await shell(); await loadSuggestions(); await navigate("profile", session.user.id);
      setBusy(false); return;
    }
    if (form.matches(".comment-form")) {
      const postId = form.dataset.post;
      const body = String(data.get("body") || "").trim();
      if (!body) return;
      const { error } = await supabase.from("post_comments").insert({ post_id: postId, user_id: session.user.id, body });
      if (error) throw error;
      form.reset(); notice("تم نشر تعليقك.");
      if (form.classList.contains("modal-comment-form")) await renderComments(postId);
      else if (currentView === "feed") await renderFeed();
      else if (currentView === "saved") await renderSaved();
      return;
    }
    if (form.id === "dm-form") {
      const body = String(data.get("body") || "").trim();
      if (!body || !activeConversation) return;
      const { error } = await supabase.from("messages").insert({
        conversation_id: activeConversation, sender_id: session.user.id, body
      });
      if (error) throw error;
      await renderMessages();
    }
    if (form.id === "search-form") {
      searchTerm = String(data.get("query") || "").trim();
      await navigate("explore");
    }
  } catch (error) {
    console.error(error);
    const message = error.message || "تعذر إكمال العملية.";
    if (form.id === "auth-form") {
      const node = $("#auth-notice");
      if (node) { node.textContent = message; node.dataset.type = "error"; node.hidden = false; }
    } else if (form.id === "reset-request-form" || form.id === "password-update-form") {
      const existing = $("#auth-notice");
      if (existing) { existing.textContent = message; existing.dataset.type = "error"; existing.hidden = false; }
      else notice(message, "error");
    } else notice(message, "error");
    setBusy(false);
    const submit = $("button[type=submit]", form);
    if (submit) submit.disabled = false;
  }
}
async function onChange(event) {
  const target = event.target;
  if (target.id === "story-upload") await addStory(target.files?.[0]);
}
function onInput(event) {
  if (event.target.id === "live-search") {
    searchTerm = event.target.value;
  }
  if (event.target.id === "word-input") {
    const value=event.target.value;
    const words=value.trim()?value.trim().split(/\s+/u).length:0;
    const word=$("#word-count"),chars=$("#char-count"),compact=$("#char-no-space");
    if(word)word.textContent=words;
    if(chars)chars.textContent=value.length;
    if(compact)compact.textContent=value.replace(/\s/g,"").length;
  }
}

boot().catch(error => {
  console.error(error);
  authView("login");
  const node = $("#auth-notice");
  if (node) { node.textContent = "صار خطأ في تشغيل دَزّة: " + error.message; node.hidden = false; }
});
