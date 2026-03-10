import { json, withAction } from "./_util.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const name = (url.searchParams.get("name") || "").trim();
    const logDate = (url.searchParams.get("logDate") || "").trim();

    if (!name || !logDate) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }

    const gasUrl = new URL(withAction(env.GAS_URL, "checkStatus", env.SECRET));
    gasUrl.searchParams.set("name", name);
    gasUrl.searchParams.set("logDate", logDate);

    const res = await fetch(gasUrl.toString(), {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
    });

    const out = await res.json().catch(() => ({}));
    return json(out, res.ok ? 200 : 500);
  } catch (err) {
    return json({ ok: false, error: String(err) }, 500);
  }
}
