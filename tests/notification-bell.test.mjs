// Real JSX click path, AuthProvider, router, supabase-js, GoTrue and PostgREST.
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { openLocalStack, PASSWORD } from "../supabase/tests/local-client.mjs";

let stack;
let dom;
let modules;
let caller;
let root;
const globals = {};
const bundle = fileURLToPath(new URL(`../tmp/scratch/notification-bell-${randomUUID()}.mjs`, import.meta.url));

before(async () => {
  stack = await openLocalStack();
  caller = await stack.createCaller("intern", "bell-intern");
  dom = new JSDOM('<div id="root"></div>', { url: "http://localhost:5173/start" });
  for (const key of ["window", "document", "navigator", "localStorage", "HTMLElement"]) {
    globals[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] });
  }
  globals.IS_REACT_ACT_ENVIRONMENT = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await mkdir(fileURLToPath(new URL("../tmp/scratch/", import.meta.url)), { recursive: true });
  await build({
    stdin: {
      contents: `
        import React from "react";
        import { useAuth } from "./src/contexts/AuthContext.jsx";
        import { useLocation, useNavigate } from "react-router-dom";
        export { default as NotificationBell } from "./src/components/layout/NotificationBell.jsx";
        export { AuthProvider } from "./src/contexts/AuthContext.jsx";
        export { supabase } from "./src/lib/supabase.js";
        export { onlineManager } from "./src/lib/onlineManager.js";
        export { MemoryRouter } from "react-router-dom";
        export function Probe() {
          const { user } = useAuth();
          const location = useLocation();
          const navigate = useNavigate();
          return <><button id="reset-route" onClick={() => navigate("/start")}>Reset route</button>
            <output data-user={user?.id ?? ""}>{location.pathname + location.search + location.hash}</output></>;
        }
      `,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)), loader: "jsx",
    },
    outfile: bundle, bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic",
    alias: { "@": fileURLToPath(new URL("../src/", import.meta.url)) },
    define: { "import.meta.env": JSON.stringify({ DEV: false, PROD: false, MODE: "test",
      VITE_SUPABASE_URL: process.env.SUPABASE_URL, VITE_SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY }) },
  });
  modules = await import(pathToFileURL(bundle));
  const login = await modules.supabase.auth.signInWithPassword({ email: caller.email, password: PASSWORD });
  assert.equal(login.error, null);
  assert.equal(login.data.user.id, caller.id);
  root = createRoot(document.getElementById("root"));
  await act(async () => root.render(React.createElement(modules.AuthProvider, null,
    React.createElement(modules.MemoryRouter, { initialEntries: ["/start"] },
      React.createElement(modules.Probe), React.createElement(modules.NotificationBell)))));
  await until(() => document.querySelector("output")?.dataset.user === caller.id, "real AuthProvider did not load the signed-in user");
});

after(async () => {
  if (root) await act(async () => root.unmount());
  if (modules) {
    await modules.supabase.removeAllChannels();
    await modules.supabase.auth.dispose();
    modules.onlineManager.destroy();
  }
  dom?.window.close();
  for (const [key, descriptor] of Object.entries(globals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
  await rm(bundle, { force: true });
  await stack?.close();
});

async function until(condition, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
  assert.fail(message);
}

async function clickNotification(link) {
  const title = `Bell ${randomUUID()}`;
  const created = await stack.rest("/notifications", stack.service, "POST", {
    user_id: caller.id, type: "announcement", title, message: "Recorded notification", link,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  await act(async () => document.getElementById("reset-route").click());
  await until(() => document.querySelector("output").textContent === "/start", "test route did not reset");
  await act(async () => document.querySelector('[aria-label="Notifications"]').click());
  const item = () => [...document.querySelectorAll("button")].find((button) => button.textContent.includes(title));
  await until(() => item(), "real notification list did not contain the persisted notification");
  await act(async () => item().click());
  await until(() => !item(), "notification click did not close the bell");
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
  const row = (await stack.db.query("select is_read,read_at from public.notifications where id=$1", [created.data[0].id])).rows[0];
  assert.equal(row.is_read, true, "real click must mark the persisted notification read");
  assert.ok(row.read_at, "real click must set the read timestamp");
  return document.querySelector("output").textContent;
}

test("S5 bell: valid internal paths navigate through the actual click handler", async () => {
  for (const link of ["/", "/intern", "/intern/attendance?date=2020-01-01#clock"]) {
    assert.equal(await clickNotification(link), link);
  }
});

test("S5 bell: unsafe links are marked read but never navigate", async () => {
  // oxlint-disable-next-line no-script-url -- Intentional attack input for the real click path.
  for (const link of ["intern/attendance", "https://example.com", "http://example.com", "//example.com", "javascript:alert(1)",
    " /intern", "\t/intern", "/\\example.com", "/intern\u0001", "/intern\u0085", "/intern\n", ""]) {
    assert.equal(await clickNotification(link), "/start", `must reject ${JSON.stringify(link)}`);
  }
});

test("S5 bell: a legacy null link is still marked read without navigation", async () => {
  assert.equal(await clickNotification(null), "/start");
});
