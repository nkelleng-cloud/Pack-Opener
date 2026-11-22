// Cloudflare Worker: auto-opens packs on demongacha.com on a cron schedule.
//
// Secrets (set with `wrangler secret put <NAME>`):
//   SID            value of the `sid` cookie
//   CF_CLEARANCE   value of the `cf_clearance` cookie
//   TRIGGER_TOKEN  (optional) bearer token to allow manual runs / status via HTTP
//
// Vars (wrangler.toml [vars]):
//   MAX_OPENS_PER_RUN  max pack-open calls per cron run (default 5)
//   PACKS_PER_OPEN     "count" sent per request (default 1)
//   USER_AGENT         should match the browser the cookies came from
//
// Optional KV binding: LOG  (stores the last run summary)

const BASE = "https://demongacha.com";

function headers(env, withJson) {
  const h = {
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    origin: BASE,
    referer: BASE + "/",
    "user-agent":
      env.USER_AGENT ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
    cookie: `cf_clearance=${env.CF_CLEARANCE}; sid=${env.SID}`,
  };
  if (withJson) h["content-type"] = "application/json";
  return h;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readBody(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 300);
  }
}

function stopReason(status) {
  if (status === 401) return "Session expired (401): update the SID secret.";
  if (status === 403)
    return "Blocked (403): likely Cloudflare rejecting cf_clearance (it is tied to your IP/user agent) or a bad session.";
  if (status === 429) return "Rate limited (429): stopping until next run.";
  if (status >= 500) return `Server error (${status}): stopping until next run.`;
  return null;
}

async function run(env) {
  const summary = { startedAt: new Date().toISOString(), opened: 0, results: [], stopped: null };

  if (!env.SID || !env.CF_CLEARANCE) {
    summary.stopped = "Missing SID or CF_CLEARANCE secret.";
    return summary;
  }

  // Check the account first (same call the site makes).
  const meRes = await fetch(`${BASE}/api/me`, { headers: headers(env, false) });
  summary.meStatus = meRes.status;
  const reason = stopReason(meRes.status);
  if (reason) {
    summary.stopped = reason;
    return summary;
  }
  summary.me = await readBody(meRes);

  const max = parseInt(env.MAX_OPENS_PER_RUN || "5", 10);
  const count = parseInt(env.PACKS_PER_OPEN || "1", 10);

  for (let i = 0; i < max; i++) {
    const res = await fetch(`${BASE}/api/packs/open`, {
      method: "POST",
      headers: headers(env, true),
      body: JSON.stringify({ requestId: crypto.randomUUID(), count }),
    });
    const body = await readBody(res);

    if (!res.ok) {
      // 4xx like "no packs available / on cooldown" ends the run normally.
      summary.stopped = stopReason(res.status) || `Stopped at status ${res.status}`;
      summary.lastResponse = body;
      break;
    }

    summary.opened += count;
    summary.results.push(body);
    await sleep(1500); // be gentle with the server
  }

  summary.finishedAt = new Date().toISOString();
  return summary;
}

async function save(env, summary) {
  console.log(JSON.stringify(summary));
  if (env.LOG) await env.LOG.put("last_run", JSON.stringify(summary));
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(run(env).then((s) => save(env, s)));
  },

  // Optional manual control: GET /status, POST /run  (Authorization: Bearer <TRIGGER_TOKEN>)
  async fetch(request, env) {
    const url = new URL(request.url);
    const auth = request.headers.get("authorization");
    if (!env.TRIGGER_TOKEN || auth !== `Bearer ${env.TRIGGER_TOKEN}`) {
      return new Response("Not found", { status: 404 });
    }
    if (url.pathname === "/status") {
      const last = env.LOG ? await env.LOG.get("last_run") : null;
      return new Response(last || "{}", { headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/run" && request.method === "POST") {
      const summary = await run(env);
      await save(env, summary);
      return Response.json(summary);
    }
    return new Response("Not found", { status: 404 });
  },
};
