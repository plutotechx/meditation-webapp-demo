import { json } from "./_util.js";

export async function onRequestGet({ env }) {
  try {
    if (!env.GAS_URL || !env.SECRET) {
      return json({ ok: false, error: "missing_env" }, 500);
    }

    const url = new URL(env.GAS_URL);
    url.searchParams.set("action", "names");
    url.searchParams.set("secret", env.SECRET);

    const res = await fetch(url.toString(), { method: "GET" });
    const out = await res.json().catch(() => ({}));
    return json(out, res.ok ? 200 : 500);

  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}
