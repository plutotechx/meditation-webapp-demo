import { json } from "./_util.js";

const CACHE_TTL      = 45;   // วินาที — request ซ้ำในช่วงนี้ตอบจาก cache ทันที
const FETCH_TIMEOUT  = 8000; // ms — ป้องกัน GAS ค้างไม่มีกำหนด

export async function onRequestGet({ request, env }) {
  try {
    const url     = new URL(request.url);
    const name    = (url.searchParams.get("name")    || "").trim();
    const logDate = (url.searchParams.get("logDate") || "").trim();

    if (!name || !logDate) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }
    if (!env.GAS_URL || !env.SECRET) {
      return json({ ok: false, error: "missing_env" }, 500);
    }

    // ── Cloudflare Cache (key = name + logDate ต่อคนต่อวัน) ──
    const cache    = caches.default;
    const cacheKey = new Request(
      `https://cache.internal/checkStatus?name=${encodeURIComponent(name)}&logDate=${encodeURIComponent(logDate)}`
    );

    const cached = await cache.match(cacheKey);
    if (cached) return cached; // ✅ ตอบทันที ไม่ถึง GAS

    // ── ยิง GAS พร้อม timeout ──
    const gas = new URL(env.GAS_URL);
    gas.searchParams.set("action",  "checkStatus");
    gas.searchParams.set("secret",  env.SECRET);
    gas.searchParams.set("name",    name);
    gas.searchParams.set("logDate", logDate);

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);

    let res, out;
    try {
      res = await fetch(gas.toString(), { method: "GET", signal: ctrl.signal });
      out = await res.json().catch(() => ({}));
    } catch (fetchErr) {
      const isTimeout = fetchErr?.name === "AbortError";
      return json({ ok: false, error: isTimeout ? "gas_timeout" : String(fetchErr) }, 500);
    } finally {
      clearTimeout(timer);
    }

    // ── สร้าง response พร้อม Cache-Control ──
    const response = new Response(JSON.stringify(out), {
      status: res.ok ? 200 : 500,
      headers: {
        "Content-Type":                "application/json; charset=utf-8",
        "Cache-Control":               `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
        "Access-Control-Allow-Origin": "*",
      },
    });

    // เก็บ cache เฉพาะ response ที่สำเร็จเท่านั้น
    if (res.ok && out.ok !== false) {
      await cache.put(cacheKey, response.clone());
    }

    return response;

  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}
