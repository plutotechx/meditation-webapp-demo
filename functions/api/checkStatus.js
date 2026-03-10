export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const name = (url.searchParams.get("name") || "").trim();
    const logDate = (url.searchParams.get("logDate") || "").trim(); // YYYY-MM-DD

    if (!name || !logDate) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }

    const gas = new URL(env.GAS_URL);
    gas.searchParams.set("action", "checkStatus");
    gas.searchParams.set("secret", env.SECRET);
    gas.searchParams.set("name", name);
    gas.searchParams.set("logDate", logDate);

    const res = await fetch(gas.toString(), { method: "GET" });
    const out = await res.json().catch(() => ({}));

    return json(out, res.ok ? 200 : 500);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
