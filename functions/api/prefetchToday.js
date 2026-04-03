import { getEnv, json } from "./_util.js";

const CACHE_TTL_SECONDS = 20;
const FETCH_TIMEOUT_MS  = 9000;
const RETRY_DELAY_MS    = 800;
const MAX_RETRIES       = 1;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetry(fetchError, res) {
  if (fetchError) return true;
  if (res && [502, 503, 504].includes(res.status)) return true;
  return false;
}

export async function onRequestGet(ctx) {
  try {
    const { request } = ctx;
    const url = new URL(request.url);
    const logDate = (url.searchParams.get("logDate") || "").trim();

    if (!logDate) {
      return json({ ok: false, error: "missing_logDate" }, 400);
    }

    const GAS_URL = getEnv(ctx, "GAS_URL");
    const SECRET  = getEnv(ctx, "SECRET");

    const hasBust = url.searchParams.has("_bust");

    const cache = caches.default;
    const cacheKey = new Request(
      `${url.origin}${url.pathname}?logDate=${encodeURIComponent(logDate)}`,
      { method: "GET" }
    );

    if (!hasBust) {
      const cached = await cache.match(cacheKey);
      if (cached) return cached;
    }

    const gas = new URL(GAS_URL);
    gas.searchParams.set("action", "getAllStatus");
    gas.searchParams.set("secret", SECRET);
    gas.searchParams.set("logDate", logDate);

    let res = null;
    let out = null;
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        res = await fetch(gas.toString(), {
          method: "GET",
          signal: controller.signal
        });

        out = await res.json().catch(() => ({}));
        lastError = null;

        if (res.ok && out.ok !== false) break;

        if (attempt < MAX_RETRIES && shouldRetry(null, res)) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }

        break;

      } catch (err) {
        lastError = err;

        if (attempt < MAX_RETRIES && shouldRetry(err, null)) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }

        throw err;

      } finally {
        clearTimeout(timer);
      }
    }

    if (lastError) {
      throw lastError;
    }

    if (!res || !res.ok || out?.ok === false) {
      return json({ ok: false, error: out?.error || `upstream_${res?.status || 500}` }, 500);
    }

    const response = new Response(JSON.stringify(out), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
        "Access-Control-Allow-Origin": "*",
      },
    });

    if (typeof ctx.waitUntil === "function") {
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
    } else {
      await cache.put(cacheKey, response.clone());
    }

    return response;

  } catch (e) {
    if (String(e).startsWith("Error: missing_env:")) {
      return json({ ok: false, error: "missing_env" }, 500);
    }

    const msg = e?.name === "AbortError" ? "gas_timeout" : String(e);
    return json({ ok: false, error: msg }, 500);
  }
}
