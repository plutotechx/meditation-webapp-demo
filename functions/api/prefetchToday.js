diff --git a/functions/api/prefetchToday.js b/functions/api/prefetchToday.js
index 1738a7ee37eb6de5c8cd187c0904d96df62c3bfc..6bbcc83090df3a24ca20da6bb0c7d6421ae6bbb0 100644
--- a/functions/api/prefetchToday.js
+++ b/functions/api/prefetchToday.js
@@ -1,79 +1,102 @@
 // functions/api/prefetchToday.js — v3.0
 // =====================================================================
 // CHANGELOG v1 → v3.0:
 //   [FIX 1] ลด CACHE_TTL จาก 55 → 20 วินาที
 //   [FIX 2] ถ้า URL มี _bust parameter → ข้าม Cloudflare cache
 //   [UNCHANGED] ทุกอย่างอื่นเหมือนเดิม
 // =====================================================================
 
-import { json } from "./_util.js";
+import { getEnv, json } from "./_util.js";
 
 const CACHE_TTL_SECONDS = 20;   // ✅ v3.0: ลดจาก 55 → 20 วินาที
-const FETCH_TIMEOUT_MS  = 9000;
+const FETCH_TIMEOUT_MS  = 15000;
+const RETRY_DELAY_MS    = 1200;
+const MAX_RETRIES       = 1;
 
-export async function onRequestGet({ request, env }) {
+export async function onRequestGet(ctx) {
   try {
+    const { request } = ctx;
     const url     = new URL(request.url);
     const logDate = (url.searchParams.get("logDate") || "").trim();
 
     if (!logDate)
       return json({ ok: false, error: "missing_logDate" }, 400);
-    if (!env.GAS_URL || !env.SECRET)
-      return json({ ok: false, error: "missing_env" }, 500);
+
+    const GAS_URL = getEnv(ctx, "GAS_URL");
+    const SECRET  = getEnv(ctx, "SECRET");
 
     // ✅ v3.0: ถ้ามี _bust → ข้าม cache (index.html ส่งมาหลัง submit สำเร็จ)
     const hasBust = url.searchParams.has("_bust");
 
     // ── Cloudflare Cache ──
     // ใช้ cache key ที่มีแค่ logDate (ไม่มี _bust) เพื่อให้ทุก request ใช้ cache ร่วมกัน
     const cache    = caches.default;
     const cacheKey = new Request(
       `${url.origin}${url.pathname}?logDate=${encodeURIComponent(logDate)}`,
       { method: "GET" }
     );
 
     // ถ้าไม่มี _bust → ลองใช้ cache ก่อน
     if (!hasBust) {
       const cached = await cache.match(cacheKey);
       if (cached) return cached;
     }
 
     // ── ยิง GAS ──
-    const gas = new URL(env.GAS_URL);
+    const gas = new URL(GAS_URL);
     gas.searchParams.set("action",  "getAllStatus");
-    gas.searchParams.set("secret",  env.SECRET);
+    gas.searchParams.set("secret",  SECRET);
     gas.searchParams.set("logDate", logDate);
 
-    const controller = new AbortController();
-    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
-
     let res, out;
-    try {
-      res = await fetch(gas.toString(), { method: "GET", signal: controller.signal });
-      out = await res.json().catch(() => ({}));
-    } finally {
-      clearTimeout(timer);
+    let lastFetchError = null;
+    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
+      if (attempt > 0) {
+        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
+      }
+      const controller = new AbortController();
+      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
+      try {
+        res = await fetch(gas.toString(), { method: "GET", signal: controller.signal });
+        out = await res.json().catch(() => ({}));
+        if (res.ok && out.ok !== false) break;
+      } catch (fetchErr) {
+        lastFetchError = fetchErr;
+        if (attempt === MAX_RETRIES) throw fetchErr;
+      } finally {
+        clearTimeout(timer);
+      }
     }
 
-    if (!res.ok || out.ok === false) {
+    if ((!res || !res.ok || out?.ok === false) && lastFetchError) {
+      throw lastFetchError;
+    }
+    if (!res || !res.ok || out?.ok === false) {
       return json({ ok: false, error: out.error || `upstream_${res.status}` }, 500);
     }
 
     // ── เก็บ cache ใหม่ (ทั้งกรณี _bust และไม่มี) ──
     const response = new Response(JSON.stringify(out), {
       status: 200,
       headers: {
         "Content-Type":  "application/json; charset=utf-8",
         "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
         "Access-Control-Allow-Origin": "*",
       },
     });
 
-    cache.put(cacheKey, response.clone());
+    if (typeof ctx.waitUntil === "function") {
+      ctx.waitUntil(cache.put(cacheKey, response.clone()));
+    } else {
+      await cache.put(cacheKey, response.clone());
+    }
     return response;
 
   } catch (e) {
+    if (String(e).startsWith("Error: missing_env:")) {
+      return json({ ok: false, error: "missing_env" }, 500);
+    }
     const msg = e?.name === "AbortError" ? "gas_timeout" : String(e);
     return json({ ok: false, error: msg }, 500);
   }
 }
