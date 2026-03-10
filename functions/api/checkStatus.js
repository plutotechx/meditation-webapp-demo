import { json } from "./_util.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const name = (url.searchParams.get("name") || "").trim();
    const logDate = (url.searchParams.get("logDate") || "").trim();

    if (!name || !logDate) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }

    if (!env.GAS_URL || !env.SECRET) {
      return json({ ok: false, error: "missing_env" }, 500);
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
