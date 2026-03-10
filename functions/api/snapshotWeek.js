import { getEnv, withAction, json } from "./_util.js";

export async function onRequestGet(ctx) {
  try {
    const GAS_URL = getEnv(ctx, "GAS_URL");
    const SECRET = getEnv(ctx, "SECRET");

    const url = withAction(GAS_URL, "snapshotWeek", SECRET);
    const res = await fetch(url, { method: "GET" });
    const out = await res.json().catch(() => ({}));

    return json(out, res.ok ? 200 : 500);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}
