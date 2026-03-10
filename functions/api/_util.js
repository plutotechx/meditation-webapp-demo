const CACHE_TTL_SECONDS = 600; // 10 นาที
const FETCH_TIMEOUT_MS = 7000; // 7 วินาที

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

export async function onRequestGet(context) {
  const { env, request } = context;

  try {
    if (!env.GAS_URL || !env.SECRET) {
      return jsonResponse({ ok: false, error: "missing_env" }, 500);
    }

    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).toString(), {
      method: "GET",
    });

    const cached = await cache.match(cacheKey);
    if (cached) {
      return cached;
    }

    const url = new URL(env.GAS_URL);
    url.searchParams.set("action", "names");
    url.searchParams.set("secret", env.SECRET);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res;
    let out;

    try {
      res = await fetch(url.toString(), {
        method: "GET",
        signal: controller.signal,
      });
      out = await res.json().catch(() => ({}));
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok || out.ok === false) {
      return jsonResponse(
        { ok: false, error: out.error || `upstream_${res.status}` },
        500
      );
    }

    const response = jsonResponse(out, 200, {
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}, s-maxage=${CACHE_TTL_SECONDS}`,
    });

    context.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (e) {
    const msg = e && e.name === "AbortError" ? "gas_timeout" : String(e);
    return jsonResponse({ ok: false, error: msg }, 500);
  }
}
