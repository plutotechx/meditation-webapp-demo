export async function onRequestGet({ request, env }) {
  try {
    const u = new URL(request.url);
    const weekOffset = (u.searchParams.get("weekOffset") || "0").trim();

    if (!env.GAS_URL || !env.SECRET) {
      return json({ ok: false, error: "missing_env" }, 500);
    }

    const url = new URL(env.GAS_URL);
    url.searchParams.set("action", "dashboard");
    url.searchParams.set("secret", env.SECRET);
    url.searchParams.set("weekOffset", weekOffset);

    const res = await fetch(url.toString(), { method: "GET" });
    const out = await res.json().catch(() => ({}));
    return json(out, res.ok ? 200 : 500);

  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
