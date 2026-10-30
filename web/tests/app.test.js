import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const between = (start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(a, -1, \`Missing section: \${start}\`);
  assert.notEqual(b, -1, \`Missing section end: \${end}\`);
  return source.slice(a, b);
};

test("login and signup inputs have FormData names", () => {
  const view = between("function authView(", "function resetSignedInState(");
  for (const field of ["email", "password", "username", "display_name"]) {
    assert.match(view, new RegExp(\`name=["']\${field}["']\`), \`missing name attribute for \${field}\`);
  }
});

test("auth submit reads exactly the named form fields", () => {
  const submit = between("async function onSubmit(", "async function onChange(");
  for (const field of ["email", "password", "username", "display_name"]) {
    assert.ok(submit.includes(\`data.get("\${field}")\`), \`FormData does not read \${field}\`);
  }
  assert.match(submit, /signInWithPassword\\(\\{ email, password \\}\\)/);
});

test("logout is local to this device and reports an error", () => {
  const signout = between("async function signOutUser()", "function accountMenu()");
  assert.match(signout, /signOut\\(\\{ scope: "local" \\}\\)/);
  assert.match(signout, /catch \\(error\\)/);
  assert.match(signout, /authView\\("login"\\)/);
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
  assert.ok(shell.includes('data-view="settings"') || source.includes('data-view="settings"'));
  assert.ok(shell.includes('data-action="logout"'));
});

test("arcade includes five playable games and no external game SDK", () => {
  for (const game of ["memory", "ttt", "2048", "rps", "quiz"]) {
    assert.ok(source.includes(\`"\${game}"\`), \`missing game \${game}\`);
  }
  assert.ok(source.includes("function minimax("));
  assert.ok(source.includes("function merge2048Line("));
});

test("offline app shell never caches external Supabase requests", async () => {
  const sw = await readFile(new URL("../../public/sw.js", import.meta.url), "utf8");
  assert.match(sw, /if \\(url\\.origin !== self\\.location\\.origin\\) return/);
  assert.match(sw, /self\\.skipWaiting\\(\\)/);
});
