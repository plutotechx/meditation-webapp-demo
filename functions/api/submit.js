import { json } from "./_util.js";

const FETCH_TIMEOUT = 25000; // เพิ่ม timeout รองรับ GAS cold start

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  try {
    const body = await request.json().catch(() => ({}));
    const { name, logDate, session, duration, weekday, clientNow, tzOffsetMin } = body || {};

    if (!name || !logDate || !session || !duration) {
      return json({ ok: false, error: "missing_fields" }, 400);
    }

    const GAS_URL = env?.GAS_URL || ctx.cloudflare?.env?.GAS_URL;
    const SECRET  = env?.SECRET  || ctx.cloudflare?.env?.SECRET;
    if (!GAS_URL || !SECRET) {
      return json({ ok: false, error: "missing_env" }, 500);
    }

    const DRIFT_MINUTES = 10;
    const MS_PER_MIN    = 60 * 1000;

    const off = Number(tzOffsetMin);
    if (!Number.isFinite(off) || Math.abs(off) > 14 * 60) {
      return json({ ok: false, error: "bad_tzOffsetMin" }, 400);
    }

    const m = String(logDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      return json({ ok: false, error: "bad_logDate_format" }, 400);
    }

    const clientMs = Date.parse(String(clientNow || ""));
    if (!Number.isFinite(clientMs)) {
      return json({ ok: false, error: "bad_clientNow" }, 400);
    }

    const serverMs  = Date.now();
    const driftMs   = Math.abs(serverMs - clientMs);
    if (driftMs > DRIFT_MINUTES * MS_PER_MIN) {
      return json({
        ok: false,
        error: "clock_drift_too_large",
        detail: { driftMinutes: Math.round(driftMs / MS_PER_MIN) }
      }, 400);
    }

    const toLocalISODate = (utcMs, tzOff) => {
      const localMs = utcMs - (tzOff * MS_PER_MIN);
      const d = new Date(localMs);
      const y  = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
      const da = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${mo}-${da}`;
    };

    const serverLocalDay = toLocalISODate(serverMs, off);
    if (String(logDate) !== serverLocalDay) {
      return json({
        ok: false,
        error: "logDate_mismatch_server_local_day",
        detail: { expected: serverLocalDay, got: String(logDate) }
      }, 400);
    }

    const clientLocalDay = toLocalISODate(clientMs, off);
    if (String(logDate) !== clientLocalDay) {
      return json({
        ok: false,
        error: "logDate_mismatch_client_local_day",
        detail: { expected: clientLocalDay, got: String(logDate) }
      }, 400);
    }

    const payload = {
      secret: SECRET,
      name, logDate,
      weekday: weekday || "",
      session, duration,
      clientNow: clientNow || "",
      tzOffsetMin: off
    };

    let res, out;
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
      try {
        res = await fetch(GAS_URL, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(payload),
          signal:  ctrl.signal,
        });
        out = await res.json().catch(() => ({}));
      } finally {
        clearTimeout(timer);
      }
    } catch (fetchErr) {
      const isTimeout = fetchErr?.name === "AbortError";
      return json({ ok: false, error: isTimeout ? "gas_timeout" : String(fetchErr) }, 500);
    }

    return json(out, res.ok ? 200 : 500);

  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
}
