// functions/api/prefetchToday.js
import { json } from "./_util.js";

const CACHE_TTL_SECONDS = 55;
const FETCH_TIMEOUT_MS  = 9000;

export async function onRequestGet({ request, env }) {
  try {
    const url     = new URL(request.url);
    const logDate = (url.searchParams.get("logDate") || "").trim();

    if (!logDate)
      return json({ ok: false, error: "missing_logDate" }, 400);
    if (!env.GAS_URL || !env.SECRET)
      return json({ ok: false, error: "missing_env" }, 500);

    // ✅ ลอง Cloudflare Cache ก่อน
    const cache    = caches.default;
    const cacheKey = new Request(request.url, { method: "GET" });
    const cached   = await cache.match(cacheKey);
    if (cached) return cached;

    // ยิง GAS
    const gas = new URL(env.GAS_URL);
    gas.searchParams.set("action",  "getAllStatus");
    gas.searchParams.set("secret",  env.SECRET);
    gas.searchParams.set("logDate", logDate);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res, out;
    try {
      res = await fetch(gas.toString(), { method: "GET", signal: controller.signal });
      out = await res.json().catch(() => ({}));
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok || out.ok === false) {
      return json({ ok: false, error: out.error || `upstream_${res.status}` }, 500);
    }

    // ✅ เก็บ cache 55 วิ
    const response = new Response(JSON.stringify(out), {
      status: 200,
      headers: {
        "Content-Type":  "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
        "Access-Control-Allow-Origin": "*",
      },
    });
    cache.put(cacheKey, response.clone());
    return response;

  } catch (e) {
    const msg = e?.name === "AbortError" ? "gas_timeout" : String(e);
    return json({ ok: false, error: msg }, 500);
  }
}
