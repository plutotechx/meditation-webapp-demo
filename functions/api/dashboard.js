import { json } from "./_util.js";

const FETCH_TIMEOUT = 25000; // เพิ่ม timeout รองรับ GAS cold start

async function fetchWithTimeout(url, timeoutMs) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequestGet(ctx) {
  const { request, env } = ctx;
  try {
    const u          = new URL(request.url);
    const weekOffset = (u.searchParams.get("weekOffset") || "0").trim();

    const GAS_URL = env?.GAS_URL || ctx.cloudflare?.env?.GAS_URL;
    const SECRET  = env?.SECRET  || ctx.cloudflare?.env?.SECRET;
    if (!GAS_URL || !SECRET) {
      return json({ ok: false, error: "missing_env" }, 500);
    }

    const url = new URL(GAS_URL);
    url.searchParams.set("action",     "dashboard");
    url.searchParams.set("secret",     SECRET);
    url.searchParams.set("weekOffset", weekOffset);

    let res, out;
    try {
      res = await fetchWithTimeout(url.toString(), FETCH_TIMEOUT);
      out = await res.json().catch(() => ({}));
    } catch (fetchErr) {
      const isTimeout = fetchErr?.name === "AbortError";
      return json({ ok: false, error: isTimeout ? "gas_timeout" : String(fetchErr) }, 500);
    }

    return json(out, res.ok ? 200 : 500);

  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}
