export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => ({}));
    const { name, logDate, session, duration, weekday, clientNow, tzOffsetMin } = body || {};

    // Basic required fields (keep same behavior)
    if (!name || !logDate || !session || !duration) {
      return json({ ok:false, error:"missing_fields" }, 400);
    }

    // ============================================================
    // Validation: "กันย้อนหลัง" + กันคนปรับเวลาเครื่องแบบทั่วไป
    // - ใช้เวลา server (Cloudflare) เป็นหลัก
    // - ยอมให้เวลาเครื่องผู้ใช้คลาดเคลื่อนจาก server ได้ไม่เกิน 10 นาที
    // - logDate ต้องเท่ากับ "วันท้องถิ่น" ของผู้ใช้ ณ ตอนกดจริง (คำนวณจาก serverNow + tzOffsetMin)
    //   เพื่อกันคนเลื่อนวันเวลาเครื่องไปวันเก่าแล้วกดบันทึก
    // ============================================================
    const DRIFT_MINUTES = 10;
    const MS_PER_MIN = 60 * 1000;

    // 1) Validate tzOffsetMin
    const off = Number(tzOffsetMin);
    if (!Number.isFinite(off) || Math.abs(off) > 14 * 60) {
      return json({ ok:false, error:"bad_tzOffsetMin" }, 400);
    }

    // 2) Validate logDate format (YYYY-MM-DD)
    const m = String(logDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      return json({ ok:false, error:"bad_logDate_format" }, 400);
    }

    // 3) Validate clientNow
    const clientMs = Date.parse(String(clientNow || ""));
    if (!Number.isFinite(clientMs)) {
      return json({ ok:false, error:"bad_clientNow" }, 400);
    }

    // 4) Drift check: clientNow vs serverNow (Cloudflare)
    const serverMs = Date.now();
    const driftMs = Math.abs(serverMs - clientMs);
    if (driftMs > DRIFT_MINUTES * MS_PER_MIN) {
      return json({
        ok:false,
        error:"clock_drift_too_large",
        detail:{ driftMinutes: Math.round(driftMs / MS_PER_MIN) }
      }, 400);
    }

    // Helper: convert UTC ms -> local date ISO by tz offset (same sign as JS getTimezoneOffset)
    const toLocalISODate = (utcMs, tzOffsetMin) => {
      const localMs = utcMs - (tzOffsetMin * MS_PER_MIN); // UTC - offset => local
      const d = new Date(localMs);
      const y = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
      const da = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${mo}-${da}`;
    };

    // 5) Must match "server local day" (prevents backdating by changing device clock)
    const serverLocalDay = toLocalISODate(serverMs, off);
    if (String(logDate) !== serverLocalDay) {
      return json({
        ok:false,
        error:"logDate_mismatch_server_local_day",
        detail:{ expected: serverLocalDay, got: String(logDate) }
      }, 400);
    }

    // 6) Optional: also ensure clientNow implies same local day (extra sanity)
    const clientLocalDay = toLocalISODate(clientMs, off);
    if (String(logDate) !== clientLocalDay) {
      return json({
        ok:false,
        error:"logDate_mismatch_client_local_day",
        detail:{ expected: clientLocalDay, got: String(logDate) }
      }, 400);
    }

    // ---- Forward payload to GAS (keep existing schema/format) ----
    const payload = {
      secret: env.SECRET,
      name,
      logDate,         // YYYY-MM-DD (วันท้องถิ่นที่เลือก)
      weekday: weekday || "",
      session,
      duration,
      clientNow: clientNow || "",
      tzOffsetMin: off
    };

    const res = await fetch(env.GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const out = await res.json().catch(() => ({}));
    return json(out, res.ok ? 200 : 500);
  } catch (e) {
    return json({ ok:false, error:String(e) }, 500);
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
