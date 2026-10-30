import { createClient, IndexedDBStore } from "matrix-js-sdk";
import "./style.css";

const $ = (selector) => document.querySelector(selector);
const root = $("#root");
const config = {
  api: import.meta.env.VITE_DAZZA_API_URL || "",
  homeserver: import.meta.env.VITE_DAZZA_MATRIX_URL || "",
};
let client = null;
let currentSession = null;
let rooms = [];

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function notice(message, type = "info") {
  const el = $("#notice");
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
  el.hidden = false;
}
function shell(content) {
  root.innerHTML = `<main class="app-shell">
    <header class="topbar"><a class="brand" href="#" aria-label="دزة">دَزّة<span>DAZZA</span></a><span class="tagline">من العراق... دزّ رسالتك للعالم.</span></header>
    ${content}
    <p class="footnote">دَزّة — نسخة الويب قيد التطوير. لا تشارك معلومات حساسة قبل اكتمال اختبار الأمان.</p>
  </main>`;
}
function renderLogin() {
  shell(`<section class="auth-card">
    <div class="brand-mark">د</div>
    <p class="eyebrow">هلا بيك بدَزّة</p><h1>خلّينا نبدي السالفة</h1>
    <p class="muted">سجّل برقم هاتفك حتى نرسل رمز تحقق حقيقي.</p>
    <div id="notice" class="notice" hidden></div>
    <form id="start-form">
      <label for="phone">رقم الهاتف</label>
      <div class="phone-row"><span>+964</span><input id="phone" name="phone" inputmode="tel" autocomplete="tel-national" placeholder="7XXXXXXXXX" required minlength="9" maxlength="12"></div>
      <button class="primary" type="submit">إرسال رمز التحقق</button>
    </form>
    <form id="verify-form" hidden>
      <label for="code">رمز التحقق</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="أدخل الرمز" required>
      <label for="username">اسم المستخدم</label><input id="username" name="username" autocomplete="username" placeholder="مثال: ali_iraqi" pattern="[a-z][a-z0-9_]{2,29}" required>
      <label for="display">الاسم الظاهر</label><input id="display" name="display" autocomplete="name" placeholder="شلون تحب نناديك؟" required maxlength="80">
      <button class="primary" type="submit">تأكيد والدخول</button>
    </form>
  </section>`);
  let challengeId = "";
  $("#start-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!safeUrl(config.api)) return notice("إعداد عنوان خادم الدخول HTTPS غير مكتمل.", "error");
    const phone = $("#phone").value.trim().replace(/^0+/, "");
    const button = event.submitter; button.disabled = true; button.textContent = "دا نرسل الرمز...";
    try {
      const response = await fetch(config.api + "/v1/auth/start", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: "+964" + phone })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || "تعذر إرسال الرمز");
      challengeId = data.challenge_id;
      $("#start-form").hidden = true; $("#verify-form").hidden = false;
      notice("وصل طلب إرسال الرمز. افحص رسائلك وانتبه لا تشارك الرمز ويا أي شخص.");
    } catch (error) { notice(error.message, "error"); }
    finally { button.disabled = false; button.textContent = "إرسال رمز التحقق"; }
  });
  $("#verify-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.submitter; button.disabled = true; button.textContent = "دا نتحقق...";
    try {
      const response = await fetch(config.api + "/v1/auth/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge_id: challengeId, code: $("#code").value.trim(),
          username: $("#username").value.trim().toLowerCase(),
          display_name: $("#display").value.trim(), device_name: "DAZZA Web"
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || data.error || "فشل التحقق");
      await openMatrix(data);
    } catch (error) { notice(error.message, "error"); }
    finally { button.disabled = false; button.textContent = "تأكيد والدخول"; }
  });
}
async function openMatrix(session) {
  if (!safeUrl(config.homeserver)) throw new Error("إعداد عنوان Matrix HTTPS غير مكتمل.");
  currentSession = session;
  const store = new IndexedDBStore({
    indexedDB: window.indexedDB,
    dbName: "dazza-matrix-store",
    localStorage: window.localStorage
  });
  await store.startup();
  client = createClient({
    baseUrl: config.homeserver,
    accessToken: session.access_token,
    userId: session.user_id,
    deviceId: session.device_id,
    store,
  });
  try { await client.initRustCrypto(); }
  catch (error) { throw new Error("تعذر تهيئة التشفير على هذا المتصفح. لم نفتح المحادثات حفاظاً على الخصوصية."); }
  await client.startClient({ initialSyncLimit: 20 });
  client.once("sync", (state) => {
    if (state === "PREPARED") renderHome();
  });
  setTimeout(() => { if ($("#room-list")) renderHome(); }, 12000);
}
function renderHome() {
  if (!client) return;
  rooms = client.getRooms().filter((room) => room.getMyMembership() !== "leave");
  shell(`<section class="chat-layout">
    <aside class="sidebar">
      <div class="profile"><div class="avatar">${escapeHtml((currentSession.display_name || "د").slice(0,1))}</div><div><strong>${escapeHtml(currentSession.display_name || currentSession.username)}</strong><small>@${escapeHtml(currentSession.username)}</small></div><button id="logout" class="icon-btn" title="تسجيل الخروج">↪</button></div>
      <div class="search"><input id="search" placeholder="دوّر على سوالفك..."></div>
      <div class="list-heading">المحادثات <button id="new-chat" class="icon-btn" title="محادثة جديدة">＋</button></div>
      <div id="room-list" class="room-list"></div>
    </aside>
    <section class="conversation" id="conversation"><div class="empty-state"><div class="empty-icon">د</div><h2>السوالف تبدي برسالة</h2><p>اختار محادثة من القائمة أو ابدي محادثة جديدة.</p></div></section>
  </section><div id="notice" class="notice" hidden></div>`);
  drawRooms();
  client.on("Room", () => drawRooms());
  client.on("Room.timeline", () => { drawRooms(); });
  $("#search").addEventListener("input", drawRooms);
  $("#new-chat").addEventListener("click", createChat);
  $("#logout").addEventListener("click", async () => {
    try { await client.logout(); } catch {}
    client.stopClient(); client = null; currentSession = null; renderLogin();
  });
}
function drawRooms() {
  const list = $("#room-list"); if (!list || !client) return;
  const query = ($("#search")?.value || "").toLowerCase();
  rooms = client.getRooms().filter((room) => room.getMyMembership() !== "leave" && room.name.toLowerCase().includes(query));
  list.innerHTML = rooms.map((room) => {
    const event = room.timeline[room.timeline.length - 1]?.getContent?.() || {};
    return `<button class="room-item" data-room="${escapeHtml(room.roomId)}"><span class="avatar">${escapeHtml((room.name || "د").slice(0,1))}</span><span class="room-copy"><strong>${escapeHtml(room.name || "محادثة")}</strong><small>${escapeHtml(event.body || "ماكو رسائل بعد")}</small></span></button>`;
  }).join("") || '<p class="muted empty-list">ما عندك محادثات حالياً.</p>';
  list.querySelectorAll("[data-room]").forEach((button) => button.addEventListener("click", () => openRoom(button.dataset.room)));
}
async function createChat() {
  const user = prompt("اكتب اسم المستخدم (مثال: ali_iraqi)");
  if (!user) return;
  try {
    const response = await fetch(config.api + "/v1/users/" + encodeURIComponent(user.trim().toLowerCase()), {
      headers: { Authorization: "Bearer " + currentSession.access_token }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || "ما لكينا هذا المستخدم");
    const result = await client.createRoom({
      invite: [data.matrix_user_id], is_direct: true,
      preset: "private_chat", initial_state: [{ type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } }]
    });
    await openRoom(result.room_id);
  } catch (error) { notice(error.message, "error"); }
}
async function openRoom(roomId) {
  const room = client.getRoom(roomId);
  if (!room) return;
  if (room.getMyMembership() === "invite") {
    await client.joinRoom(roomId);
  }
  const events = room.timeline.slice(-80);
  $("#conversation").innerHTML = `<header class="conversation-head"><div class="avatar">${escapeHtml((room.name || "د").slice(0,1))}</div><div><strong>${escapeHtml(room.name || "محادثة")}</strong><small>محادثة مشفّرة عبر Matrix</small></div></header>
  <div class="messages" id="messages">${events.map((event) => messageHtml(event)).join("")}</div>
  <form id="send-form" class="composer"><input id="message" placeholder="اكتب رسالتك..." autocomplete="off" required><button class="primary" type="submit">دزّ</button></form>`;
  const messages = $("#messages"); messages.scrollTop = messages.scrollHeight;
  $("#send-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#message"); const body = input.value.trim(); if (!body) return;
    input.disabled = true;
    try {
      if (!room.hasEncryptionStateEvent()) throw new Error("هذه المحادثة غير مشفّرة؛ تم إيقاف الإرسال.");
      await client.sendTextMessage(roomId, body);
      input.value = "";
    } catch (error) { notice(error.message, "error"); }
    finally { input.disabled = false; input.focus(); }
  });
}
function messageHtml(event) {
  if (event.getType?.() !== "m.room.message") return "";
  const content = event.getContent();
  if (content.msgtype !== "m.text") return "";
  return `<article class="message"><p>${escapeHtml(content.body)}</p></article>`;
}
renderLogin();
