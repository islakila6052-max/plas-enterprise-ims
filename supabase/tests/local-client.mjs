// Shared real-stack access for notification tests. Never targets a hosted project.
import { createHmac, randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import pg from "pg";

export const PASSWORD = "Correct-Horse-Battery-9";

export async function openLocalStack() {
  const urls = Object.fromEntries(["DB", "AUTH", "REST"].map((name) => {
    const value = process.env[`TEST_${name}_URL`];
    if (!value || !["localhost", "127.0.0.1"].includes(new URL(value).hostname)) {
      throw new Error(`TEST_${name}_URL must point at localhost.`);
    }
    return [name, value];
  }));
  const secret = process.env.TEST_JWT_SECRET;
  if (!secret) throw new Error("TEST_JWT_SECRET is not set.");
  const jwt = (role) => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
    const data = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ role, iat: now, exp: now + 3600 })}`;
    return `${data}.${createHmac("sha256", secret).update(data).digest("base64url")}`;
  };
  const service = jwt("service_role");
  const anon = jwt("anon");
  const db = new pg.Client({ connectionString: urls.DB });
  await db.connect();
  const proxy = createServer((req, res) => {
    const route = req.url.startsWith("/auth/v1/") ? ["/auth/v1", urls.AUTH]
      : req.url.startsWith("/rest/v1/") ? ["/rest/v1", urls.REST] : null;
    if (!route) { res.writeHead(404).end(); return; }
    const target = new URL(req.url.slice(route[0].length), route[1]);
    const upstream = request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    req.pipe(upstream);
  });
  const sockets = new Set();
  proxy.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { proxy.once("error", reject); proxy.listen(0, "127.0.0.1", resolve); });
  const env = {
    SUPABASE_URL: `http://127.0.0.1:${proxy.address().port}`,
    SUPABASE_SERVICE_ROLE_KEY: service,
    SUPABASE_ANON_KEY: anon,
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  let handler;
  async function http(base, path, token, method = "POST", body, headers = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }
  const rest = (path, token, method, body, headers) => http(urls.REST, path, token, method, body, headers);
  const runId = randomUUID();
  const email = (label) => `${label}-${runId}@example.com`;
  async function createCaller(role, label = role) {
    const address = email(label);
    const created = await http(urls.AUTH, "/admin/users", service, "POST", {
      email: address, password: PASSWORD, email_confirm: true,
      app_metadata: { role }, user_metadata: { full_name: `Test ${label}` },
    });
    if (created.status !== 200) throw new Error(`GoTrue fixture creation: ${created.status}`);
    const session = await http(urls.AUTH, "/token?grant_type=password", anon, "POST", { email: address, password: PASSWORD });
    if (session.status !== 200) throw new Error(`GoTrue fixture sign-in: ${session.status}`);
    const profile = await db.query("select role from public.profiles where id=$1", [created.data.id]);
    if (profile.rows[0]?.role !== role) throw new Error(`Fixture profile has wrong role: ${role}`);
    return { id: created.data.id, email: address, token: session.data.access_token };
  }
  async function createAccount(token, role, label) {
    if (!handler) ({ default: handler } = await import("../../api/admin/create-user.js"));
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      setHeader() {},
    };
    await handler({ method: "POST", headers: { authorization: `Bearer ${token}` },
      socket: { remoteAddress: "127.0.0.1" },
      body: { email: email(label), password: PASSWORD, user_metadata: { role, full_name: `New ${label}` } },
    }, res);
    return { status: res.statusCode, data: res.body };
  }
  return { db, rest, service, anon, createCaller, createAccount, email,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
      await db.end();
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    },
  };
}
