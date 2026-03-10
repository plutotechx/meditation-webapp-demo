import { json, withAction } from "./_util.js";

export async function onRequestGet({ env }) {
  try {
    const url = withAction(env.GAS_URL, "names", env.SECRET);
    const res = await fetch(url, { method: "GET" });
    const out = await res.json().catch(() => ({}));
    return json(out, res.ok ? 200 : 500);
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
}
