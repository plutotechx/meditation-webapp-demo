// functions/api/prefetchToday.js — v3.0
// =====================================================================
// CHANGELOG:
//   [FIX 1] ลด CACHE_TTL จาก 55 วินาที → 20 วินาที
//           → ข้อมูลเก่าหมดอายุเร็วขึ้น แม้ไม่มี _bust ก็รอไม่นาน
//
//   [FIX 2] ถ้า URL มี _bust parameter → ข้าม Cloudflare cache ทันที
//           → index.html v3.0 จะส่ง _bust มาหลังจากเพิ่งบันทึกสำเร็จ
//           → ได้ข้อมูลใหม่ล่าสุดจาก GAS โดยไม่ต้องรอ cache หมดอายุ
//
//   [UNCHANGED] GAS endpoint, error handling, response format
//               → ไม่กระทบ status.html, dashboard.html, report-weekly.html
// =====================================================================

import { json } from "./_util.js";

const CACHE_TTL_SECONDS = 20;   // ✅ v3.0: ลดจาก 55 → 20 วินาที
const FETCH_TIMEOUT_MS  = 9000;

export async function onRequestGet({ request, env }) {
  try {
    const url     = new URL(request.url);
    const logDate = (url.searchParams.get("logDate") || "").trim();

    if (!logDate)
      return json({ ok: false, error: "missing_logDate" }, 400);
    if (!env.GAS_URL || !env.SECRET)
      return json({ ok: false, error: "missing_env" }, 500);

    // ✅ v3.0: ถ้ามี _bust parameter → ข้าม cache ทันที (ไปเรียก GAS ตรง)
    const hasBust = url.searchParams.has("_bust");

    if (!hasBust) {
      // ลอง Cloudflare Cache ก่อน (เฉพาะกรณีไม่มี _bust)
      const cache    = caches.default;
      const cacheKey = new Request(
        // ✅ สร้าง cache key จาก logDate อย่างเดียว (ไม่รวม _bust)
        `https://cache.internal/prefetchToday?logDate=${encodeURIComponent(logDate)}`,
        { method: "GET" }
      );
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

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

    // ✅ เก็บ cache (ใช้ cache key ที่ไม่มี _bust เพื่อให้ request ถัดไปใช้ได้)
    const response = new Response(JSON.stringify(out), {
      status: 200,
      headers: {
        "Content-Type":  "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
        "Access-Control-Allow-Origin": "*",
      },
    });

    // ✅ เก็บ cache ด้วย key ที่ไม่มี _bust → ครั้งถัดไปที่ไม่มี _bust จะได้ข้อมูลใหม่
    const cache    = caches.default;
    const cacheKey = new Request(
      `https://cache.internal/prefetchToday?logDate=${encodeURIComponent(logDate)}`,
      { method: "GET" }
    );
    cache.put(cacheKey, response.clone());

    return response;

  } catch (e) {
    const msg = e?.name === "AbortError" ? "gas_timeout" : String(e);
    return json({ ok: false, error: msg }, 500);
  }
}
