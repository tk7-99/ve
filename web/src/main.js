import { createClient } from "@supabase/supabase-js";
import "./style.css";

const $ = (s) => document.querySelector(s);
const root = $("#root");
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://jdtvkapmroqgerqsnjwe.supabase.co";
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_j0f5nDt8HQFpug14ctAaiA_o2RuwxUR";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
let session = null, profile = null, isAdmin = false, activeConversation = null, liveChannel = null;
let conversations = [];

const esc = (v = "") => String(v).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function shell(content) {
  root.innerHTML = `<main class="app-shell"><header class="topbar"><a class="brand" href="#">دَزّة<span>DAZZA</span></a><span class="tagline">من العراق... دزّ رسالتك للعالم.</span></header>${content}<p class="footnote">دَزّة — نسخة تجريبية مجانية. لا تشارك معلومات حساسة.</p></main>`;
}
function notice(message, type = "info") {
  const el = $("#notice"); if (!el) return;
  el.textContent = message; el.dataset.type = type; el.hidden = false;
}
function renderAuth(mode = "login") {
  const signup = mode === "signup";
  shell(`<section class="auth-card"><div class="brand-mark">د</div><p class="eyebrow">هلا بيك بدَزّة</p><h1>${signup ? "سوّي حسابك الجديد" : "رجعنا للسوالف"}</h1><p class="muted">${signup ? "اختار اسمك وسجّل ببريدك." : "سجّل دخولك وكمل سوالفك."}</p><div id="notice" class="notice" hidden></div>
  <form id="auth-form">${signup ? '<label for="username">اسم المستخدم</label><input id="username" required minlength="3" maxlength="30" pattern="[a-z][a-z0-9_]{2,29}" placeholder="ali_iraqi" autocomplete="username"><label for="display">الاسم الظاهر</label><input id="display" required maxlength="80" placeholder="اسمك داخل دزّة">' : ""}
  <label for="email">البريد الإلكتروني</label><input id="email" type="email" required maxlength="254" autocomplete="email" placeholder="name@example.com">
  <label for="password">كلمة المرور</label><input id="password" type="password" required minlength="8" maxlength="72" autocomplete="${signup ? "new-password" : "current-password"}" placeholder="8 أحرف على الأقل">
  <button class="primary" type="submit">${signup ? "إنشاء الحساب" : "دخول"}</button></form>
  <p class="muted auth-switch">${signup ? "عندك حساب؟" : "أول مرة تستخدم دزّة؟"} <button id="switch-auth" class="text-btn">${signup ? "سجّل دخول" : "أنشئ حساب"}</button></p></section>`);
  $("#switch-auth").addEventListener("click", () => renderAuth(signup ? "login" : "signup"));
  $("#auth-form").addEventListener("submit", async e => {
    e.preventDefault(); const btn = e.submitter; btn.disabled = true;
    const email = $("#email").value.trim().toLowerCase(), password = $("#password").value;
    try {
      if (signup) {
        const username = $("#username").value.trim().toLowerCase();
        const display_name = $("#display").value.trim();
        const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { username, display_name }, emailRedirectTo: window.location.origin } });
        if (error) throw error;
        if (data.session) await enter(data.session);
        else notice("تم إنشاء الطلب. إذا طلب منك تأكيد البريد، افتح رسالة Supabase ثم ارجع وسجّل دخولك. الإرسال المجاني محدود من مزوّد Supabase الافتراضي.", "info");
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        await enter(data.session);
      }
    } catch (err) {
      const msg = err.message || "تعذر إكمال العملية";
      notice(msg.includes("User already registered") ? "هذا البريد مسجل مسبقاً. جرّب تسجيل الدخول." : msg, "error");
    } finally { btn.disabled = false; }
  });
}
async function enter(nextSession) {
  session = nextSession;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
  if (error) throw new Error("الحساب موجود لكن تعذر تحميل الملف الشخصي: " + error.message);
  profile = data;
  const adminCheck = await supabase.from("app_admins").select("user_id").eq("user_id", session.user.id).maybeSingle();
  isAdmin = !!adminCheck.data;
  await renderHome();
}
async function loadConversations() {
  const { data: memberships, error } = await supabase.from("conversation_members").select("conversation_id,joined_at").eq("user_id", session.user.id).order("joined_at", {ascending:false});
  if (error) throw error;
  const ids = (memberships || []).map(x => x.conversation_id);
  if (!ids.length) { conversations = []; return; }
  const { data: convs, error: convError } = await supabase.from("conversations").select("id,created_at").in("id", ids);
  if (convError) throw convError;
  const { data: members, error: memError } = await supabase.from("conversation_members").select("conversation_id,user_id").in("conversation_id", ids);
  if (memError) throw memError;
  const otherIds = [...new Set((members || []).filter(m => m.user_id !== session.user.id).map(m => m.user_id))];
  let profiles = [];
  if (otherIds.length) {
    const result = await supabase.from("profiles").select("id,username,display_name").in("id", otherIds);
    if (result.error) throw result.error; profiles = result.data || [];
  }
  conversations = (convs || []).map(c => {
    const other = (members || []).find(m => m.conversation_id === c.id && m.user_id !== session.user.id);
    const person = profiles.find(p => p.id === other?.user_id);
    return {...c, other, person, title: person?.display_name || person?.username || "محادثة جديدة"};
  }).sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
}
async function renderHome() {
  await loadConversations();
  shell(`<section class="chat-layout"><aside class="sidebar"><div class="profile"><div class="avatar">${esc((profile.display_name || "د").slice(0,1))}</div><div><strong>${esc(profile.display_name)}</strong><small>@${esc(profile.username)}</small></div><button id="logout" class="icon-btn" title="تسجيل الخروج">↪</button></div><div class="search"><input id="search" placeholder="دوّر على سوالفك..."></div><div class="list-heading">المحادثات <button id="new-chat" class="icon-btn" title="محادثة جديدة">＋</button></div>${isAdmin ? '<button id="admin-open" class="admin-link">لوحة الإدارة</button>' : ""}<div id="room-list" class="room-list"></div></aside><section class="conversation" id="conversation"><div class="empty-state"><div class="empty-icon">د</div><h2>السوالف تبدي برسالة</h2><p>اختار محادثة أو ابدي محادثة جديدة.</p></div></section></section><div id="notice" class="notice" hidden></div>`);
  drawConversations();
  $("#search").addEventListener("input", drawConversations);
  $("#admin-open")?.addEventListener("click", renderAdmin);
  $("#new-chat").addEventListener("click", createChat);
  $("#logout").addEventListener("click", async () => { if (liveChannel) await supabase.removeChannel(liveChannel); await supabase.auth.signOut(); session=null; profile=null; renderAuth(); });
  liveChannel = supabase.channel("dazza-live-" + session.user.id)
    .on("postgres_changes", {event:"INSERT",schema:"public",table:"messages"}, payload => {
      if (activeConversation === payload.new.conversation_id) appendMessage(payload.new);
      loadConversations().then(drawConversations).catch(()=>{});
    }).subscribe();
}
function drawConversations() {
  const list = $("#room-list"); if (!list) return;
  const q = ($("#search")?.value || "").toLowerCase();
  const filtered = conversations.filter(c => (c.title+" "+(c.person?.username || "")).toLowerCase().includes(q));
  list.innerHTML = filtered.map(c => `<button class="room-item" data-id="${c.id}"><span class="avatar">${esc(c.title.slice(0,1))}</span><span class="room-copy"><strong>${esc(c.title)}</strong><small>@${esc(c.person?.username || "")}</small></span></button>`).join("") || '<p class="muted empty-list">ما عندك محادثات حالياً.</p>';
  list.querySelectorAll("[data-id]").forEach(b => b.addEventListener("click", () => openConversation(b.dataset.id)));
}
async function renderAdmin() {
  if (!isAdmin) return;
  const {data: users, error} = await supabase.from("profiles").select("id,username,display_name,created_at").order("created_at",{ascending:false}).limit(200);
  if (error) return notice(error.message,"error");
  shell('<section class="admin-panel"><div class="admin-head"><button id="admin-back" class="text-btn">رجوع للمحادثات</button><span class="eyebrow">DAZZA CONTROL</span></div><h1>لوحة إدارة دَزّة</h1><p class="muted">إدارة الحسابات والملفات الشخصية. عدد الحسابات المعروضة: '+users.length+'</p><div id="notice" class="notice" hidden></div><form id="admin-password-form" class="admin-password"><label for="new-admin-password">تغيير كلمة مرور حساب الإدارة</label><input id="new-admin-password" type="password" minlength="8" autocomplete="new-password" placeholder="اكتب كلمة المرور الجديدة" required><button class="primary" type="submit">حفظ كلمة المرور</button></form><div class="admin-users">'+users.map(u=>'<article class="admin-user"><div><strong>'+esc(u.display_name)+'</strong><small>@'+esc(u.username)+'</small></div><button class="text-btn edit-user" data-id="'+u.id+'" data-name="'+esc(u.display_name)+'" data-username="'+esc(u.username)+'">تعديل</button></article>').join('')+'</div></section>');
  $("#admin-back").addEventListener("click",renderHome);
  $("#admin-password-form").addEventListener("submit",async e=>{e.preventDefault();const password=$("#new-admin-password").value;const {error}=await supabase.auth.updateUser({password});if(error)return notice(error.message,"error");$("#new-admin-password").value="";notice("تم تغيير كلمة المرور بنجاح.");});
  root.querySelectorAll(".edit-user").forEach(btn=>btn.addEventListener("click",async()=>{
    const display_name=prompt("الاسم الظاهر الجديد:",btn.dataset.name); if(display_name===null)return;
    const username=prompt("اسم المستخدم الجديد:",btn.dataset.username); if(username===null)return;
    const clean=username.trim().toLowerCase(); if(!/^[a-z][a-z0-9_]{2,29}$/.test(clean))return notice("اسم المستخدم غير صالح.","error");
    const {error:updateError}=await supabase.from("profiles").update({display_name:display_name.trim(),username:clean}).eq("id",btn.dataset.id);
    if(updateError)return notice(updateError.message,"error");
    notice("تم تحديث الحساب."); renderAdmin();
  }));
}
async function createChat() {
  const username = prompt("اكتب اسم المستخدم، بدون @");
  if (!username) return;
  const {data: person, error} = await supabase.from("profiles").select("id,username,display_name").eq("username",username.trim().replace(/^@/,"").toLowerCase()).maybeSingle();
  if (error) return notice(error.message,"error");
  if (!person) return notice("ما لكينا هذا المستخدم. تأكد من اسم المستخدم.","error");
  if (person.id === session.user.id) return notice("ما تكدر تفتح محادثة ويا نفسك.","error");
  const {data: mine} = await supabase.from("conversation_members").select("conversation_id").eq("user_id",session.user.id);
  const existing = mine?.map(x=>x.conversation_id) || [];
  if (existing.length) {
    const {data: theirs} = await supabase.from("conversation_members").select("conversation_id").eq("user_id",person.id).in("conversation_id",existing);
    if (theirs?.length) return openConversation(theirs[0].conversation_id);
  }
  const {data: conv,error: createError} = await supabase.from("conversations").insert({}).select("id").single();
  if (createError) return notice(createError.message,"error");
  const {error: firstError} = await supabase.from("conversation_members").insert({conversation_id:conv.id,user_id:session.user.id});
  if (firstError) return notice(firstError.message,"error");
  const {error: secondError} = await supabase.from("conversation_members").insert({conversation_id:conv.id,user_id:person.id});
  if (secondError) return notice(secondError.message,"error");
  await renderHome(); await openConversation(conv.id);
}
async function openConversation(id) {
  activeConversation = id;
  $(".chat-layout")?.classList.add("show-conversation");
  const conv = conversations.find(c=>c.id===id);
  const {data: messages,error} = await supabase.from("messages").select("*").eq("conversation_id",id).order("created_at",{ascending:true}).limit(200);
  if (error) return notice(error.message,"error");
  const person = conv?.person;
  $("#conversation").innerHTML = `<header class="conversation-head"><button id="back-to-list" class="icon-btn mobile-back" type="button" aria-label="رجوع">‹</button><div class="avatar">${esc((conv?.title || "د").slice(0,1))}</div><div><strong>${esc(conv?.title || "محادثة")}</strong><small>@${esc(person?.username || "")}</small></div></header><div class="messages" id="messages">${(messages||[]).map(messageHtml).join("")}</div><form id="send-form" class="composer"><input id="message" placeholder="اكتب رسالتك..." autocomplete="off" maxlength="5000" required><button class="primary" type="submit">دزّ</button></form>`;
  const box=$("#messages"); box.scrollTop=box.scrollHeight;
  $("#back-to-list").addEventListener("click", () => $(".chat-layout")?.classList.remove("show-conversation"));
  $("#send-form").addEventListener("submit",async e=>{
    e.preventDefault(); const input=$("#message"), body=input.value.trim(); if(!body)return;
    const btn=e.submitter; btn.disabled=true;
    const {data,error}=await supabase.from("messages").insert({conversation_id:id,sender_id:session.user.id,body}).select("*").single();
    if(error) notice(error.message,"error"); else { input.value=""; appendMessage(data); }
    btn.disabled=false; input.focus();
  });
}
function messageHtml(m) {
  const own=m.sender_id===session?.user.id;
  return `<article class="message ${own?"own":""}" data-message="${m.id}"><p>${esc(m.body)}</p><small>${new Date(m.created_at).toLocaleTimeString("ar-IQ",{hour:"2-digit",minute:"2-digit"})}</small></article>`;
}
function appendMessage(m) {
  const box=$("#messages"); if(!box || m.conversation_id!==activeConversation || box.querySelector('[data-message="'+m.id+'"]')) return;
  const wrap=document.createElement("div"); wrap.dataset.message=m.id; wrap.innerHTML=messageHtml(m);
  box.append(wrap.firstElementChild); box.scrollTop=box.scrollHeight;
}
supabase.auth.getSession().then(({data}) => data.session ? enter(data.session).catch(e=>renderAuth("login")) : renderAuth("login"));
supabase.auth.onAuthStateChange((event,nextSession) => {
  if (event==="SIGNED_OUT") { session=null; profile=null; renderAuth("login"); }
});
