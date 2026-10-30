import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const between = (start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(a, -1, "Missing section: " + start);
  assert.notEqual(b, -1, "Missing section end: " + end);
  return source.slice(a, b);
};

test("login and signup inputs have FormData names", () => {
  const view = between("function authView(", "function shell()");
  for (const field of ["email", "password", "username", "display_name"]) {
    assert.ok(view.includes('name="' + field + '"'), "missing name attribute for " + field);
  }
});

test("auth submit reads exactly the named form fields", () => {
  const submit = between("async function onSubmit(", "async function onChange(");
  for (const field of ["email", "password", "username", "display_name"]) {
    assert.ok(submit.includes('data.get("' + field + '")'), "FormData does not read " + field);
  }
  assert.match(submit, /signInWithPassword\(\{ email, password \}\)/);
});

test("logout is local to this device and reports an error", () => {
  const signout = between("async function signOutUser()", "function accountMenu()");
  assert.match(signout, /signOut\(\{ scope: "local" \}\)/);
  assert.match(signout, /catch \(error\)/);
  assert.match(signout, /authView\("login"\)/);
});

test("password reset and recovery flow are wired", () => {
  assert.ok(source.includes('resetPasswordForEmail(email, { redirectTo: location.origin })'));
  assert.ok(source.includes('updateUser({ password })'));
  assert.ok(source.includes('event === "PASSWORD_RECOVERY"'));
  assert.ok(source.includes('id="password-update-form"'));
});

test("mobile account menu exposes settings and logout", () => {
  const shell = between("function shell()", "function navItem(");
  assert.ok(shell.includes('data-action="account-menu"'));
  assert.ok(source.includes('data-view="settings"'));
  assert.ok(source.includes('data-action="logout"'));
});

test("arcade includes five playable games and game engines", () => {
  for (const game of ["memory", "ttt", "2048", "rps", "quiz"]) {
    assert.ok(source.includes('"' + game + '"'), "missing game " + game);
  }
  assert.ok(source.includes("function minimax("));
  assert.ok(source.includes("function merge2048Line("));
});

test("offline app shell never caches external Supabase requests", async () => {
  const sw = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(sw, /if \(url\.origin !== self\.location\.origin\) return/);
  assert.match(sw, /self\.skipWaiting\(\)/);
});

test("messages stay in the active conversation and de-duplicate realtime delivery", () => {
  const messages = between("function appendDmMessage(", "async function startDirectMessage(");
  assert.match(messages, /data-message-id/);
  assert.match(messages, /alreadyRendered/);
  assert.match(messages, /append\(article\)/);
  assert.doesNotMatch(messages, /await renderMessages\(\)/);
  const submit = between('if (form.id === "dm-form") {', 'if (form.id === "search-form") {');
  assert.match(submit, /form\.dataset\.sending === "true"/);
  assert.match(submit, /\.insert\(/);
  assert.match(submit, /appendDmMessage\(message\)/);
  assert.doesNotMatch(submit, /await renderMessages\(\)/);
  assert.match(source, /payload\.new\)\s*;/);
});

test("profile music and social links are saved and rendered through safe HTTP URLs", () => {
  assert.match(source, /music_url/);
  assert.match(source, /social_links/);
  assert.match(source, /safeProfileUrl/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /"instagram","tiktok","youtube","facebook","x","twitch","discord"/);
});

test("unified account menu and world catalog are reachable from navigation", async () => {
  const shell = between("function shell()", "function navItem(");
  assert.match(shell, /data-action="account-menu"/);
  assert.match(shell, /data-view="world"/);
  assert.doesNotMatch(shell, /data-action="logout"/);
  const { WORLD_PROJECTS } = await import("../src/world-catalog.js");
  assert.equal(WORLD_PROJECTS.length, 100);
  assert.ok(WORLD_PROJECTS.every(item => item.owner && item.name && item.description));
});


test("social rooms, voice signaling and synchronized watch rooms are wired", async () => {
  const social = await readFile(new URL("../src/social-world.js", import.meta.url), "utf8");
  assert.match(source, /configureSocialWorld/);
  assert.match(source, /renderSocialWorld/);
  assert.match(source, /handleSocialAction/);
  assert.match(source, /handleSocialSubmit/);
  assert.match(social, /dazza_room_members/);
  assert.match(social, /config: \{ private: true/);
  assert.match(social, /RTCPeerConnection/);
  assert.match(social, /getUserMedia/);
  assert.match(social, /watch-state/);
  assert.match(social, /room-chat/);
  assert.match(social, /quiz-state/);
  const { getYouTubeVideoId } = await import("../src/social-world.js");
  assert.equal(getYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(getYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(getYouTubeVideoId("https://example.com/not-youtube"), "");
});

test("social room pages and challenge permissions are protected by RLS", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20261030080000_dazza_social_rooms_challenges.sql", import.meta.url), "utf8");
  for (const table of ["dazza_rooms", "dazza_room_members", "dazza_room_messages", "dazza_challenges", "dazza_challenge_participants"]) {
    assert.match(migration, new RegExp("alter table public\\." + table + " enable row level security"));
  }
  assert.match(migration, /dazza room members receive realtime/);
  assert.match(migration, /dazza room members send realtime/);
  assert.match(migration, /grant select, insert, update, delete on public\.dazza_rooms to authenticated/);
});
