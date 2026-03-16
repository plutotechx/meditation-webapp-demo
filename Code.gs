// ===============================
// Code.gs (HARDENED + OPTIMIZED + KEEP-ALIVE + PREFETCH)
// UpdatedAt: 2026-03-17 (+07:00)
// Version: 2.5
// Notes:
// - Use Script Properties for SECRET / SHEET names when possible
// - Prevent duplicate rows by (Name + LogDate + Session)
// - Validate payload on GAS side, not only Cloudflare
// - Use LockService for concurrent submits
// - Keep API response schema compatible with existing frontend
// - checkStatus: fast scan (125 rows) instead of full sheet Map
// - getAllStatus: scan แค่ 125 rows ท้ายสุด (41 คน × 3 ครั้ง = 123)
// - keepAlive_: ping every 5 min via Time-based Trigger (prevents Cold Start)
// - v2.5: hasDuplicateSubmission_ scan 125 rows ท้ายสุด (ไม่อ่านทั้ง Sheet)
// - v2.5: buildStatusFor_ ใช้ buildStatusForFast_ แทน buildDoneMapFromResponses_
// ===============================

// ====== CONFIG (fallback defaults) ======
const DEFAULT_SHEET_NAME   = "Demo Meditation Log";
const DEFAULT_PEOPLE_SHEET = "People";
const DEFAULT_SECRET       = "TumTum5583";

const ALLOWED_SESSIONS  = ["ครั้งที่ 1", "ครั้งที่ 2", "ครั้งที่ 3"];
const ALLOWED_DURATIONS = ["3-5 นาที", "10 นาที"];

// ====== MENU ======
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Meditation")
    .addItem("ทดสอบ names",                   "testNames_")
    .addItem("ทดสอบ dashboard (สัปดาห์นี้)", "testDashboard_")
    .addItem("ทดสอบ getAllStatus (วันนี้)",    "testGetAllStatus_")
    .addItem("ดู config",                      "showConfig_")
    .addToUi();
}

function testNames_() {
  SpreadsheetApp.getUi().alert(JSON.stringify(handleNames_(), null, 2));
}

function testDashboard_() {
  SpreadsheetApp.getUi().alert(JSON.stringify(handleDashboard_({ weekOffset: "0" }), null, 2));
}

function testGetAllStatus_() {
  const today = toISODateServer_(new Date());
  const result = handleGetAllStatus_({ logDate: today });
  const sample = Object.fromEntries(Object.entries(result.data || {}).slice(0, 3));
  SpreadsheetApp.getUi().alert(JSON.stringify({ ...result, data: sample }, null, 2));
}

function showConfig_() {
  const cfg = getConfig_();
  SpreadsheetApp.getUi().alert(JSON.stringify({
    SHEET_NAME:               cfg.SHEET_NAME,
    PEOPLE_SHEET:             cfg.PEOPLE_SHEET,
    SECRET_SET_IN_PROPERTIES: !!cfg.SECRET_FROM_PROPERTIES
  }, null, 2));
}

// ====== KEEP-ALIVE ======
function keepAlive_() {
  PropertiesService.getScriptProperties()
    .setProperty("keepAlive", new Date().toISOString());
}

// wrapper สำหรับ Time Trigger (ไม่มี _ จึงขึ้นใน dropdown)
function keepAliveJob() {
  keepAlive_();
}

// ====== ROUTER ======
function doGet(e) {
  const p      = (e && e.parameter) ? e.parameter : {};
  const action = String(p.action || "").trim();
  const cfg    = getConfig_();

  if (String(p.secret || "") !== cfg.SECRET) {
    return json_({ ok: false, error: "unauthorized" });
  }
  if (!action) {
    return json_({ ok: false, error: "missing_action" });
  }

  try {
    if (action === "names")        return json_(handleNames_());
    if (action === "checkStatus")  return json_(handleCheckStatus_(p));
    if (action === "getAllStatus")  return json_(handleGetAllStatus_(p));
    if (action === "dashboard")    return json_(handleDashboard_(p));
    return json_({ ok: false, error: "unknown_action" });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  const cfg  = getConfig_();
  const lock = LockService.getScriptLock();

  try {
    lock.tryLock(10000);

    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    if (String(body.secret || "") !== cfg.SECRET) {
      return json_({ ok: false, error: "unauthorized" });
    }

    const name        = String(body.name     || "").trim();
    const logDateS    = String(body.logDate  || "").trim();
    const sessionRaw  = String(body.session  || "").trim();
    const duration    = String(body.duration || "").trim();
    const clientNow   = String(body.clientNow   || "").trim();
    const tzOffsetMin = (body.tzOffsetMin !== undefined && body.tzOffsetMin !== null)
      ? Number(body.tzOffsetMin) : null;

    const session = normalizeSession_(sessionRaw);

    if (!name || !logDateS || !session || !duration)
      return json_({ ok: false, error: "missing_fields" });
    if (!isISODate_(logDateS))
      return json_({ ok: false, error: "invalid_logDate" });
    if (!ALLOWED_SESSIONS.includes(session))
      return json_({ ok: false, error: "invalid_session" });
    if (!ALLOWED_DURATIONS.includes(duration))
      return json_({ ok: false, error: "invalid_duration" });
    if (clientNow && !isValidISODateTime_(clientNow))
      return json_({ ok: false, error: "invalid_clientNow" });
    if (tzOffsetMin !== null && !isFinite(tzOffsetMin))
      return json_({ ok: false, error: "invalid_tzOffsetMin" });

    const ss        = SpreadsheetApp.getActiveSpreadsheet();
    const responses = mustSheet_(ss, cfg.SHEET_NAME);
    const people    = readPeople_(ss);

    if (!people.includes(name))
      return json_({ ok: false, error: "unknown_name" });

    const dup = hasDuplicateSubmission_(responses, name, logDateS, session);
    if (!dup.ok)
      return json_({ ok: false, error: dup.error || "duplicate_check_failed" });

    if (dup.duplicate) {
      const statusDup = buildStatusFor_(responses, name, logDateS);
      return json_({ ok: true, duplicate: true, status: statusDup });
    }

    const logDateObj = isoToDateAtMidnight_(logDateS);
    const weekdayTH  = weekdayFromISO_(logDateS);

    responses.appendRow([
      new Date(),
      name,
      weekdayTH,
      session,
      duration,
      logDateObj,
      clientNow,
      tzOffsetMin
    ]);

    const status = buildStatusFor_(responses, name, logDateS);
    return json_({ ok: true, status });

  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// ====== ACTION: names ======
function handleNames_() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const names = readPeople_(ss);
  return { ok: true, names };
}

// ====== ACTION: checkStatus ======
function handleCheckStatus_(p) {
  const name     = String(p.name    || "").trim();
  const logDateS = String(p.logDate || "").trim();

  if (!name || !logDateS)    return { ok: false, error: "missing_fields" };
  if (!isISODate_(logDateS)) return { ok: false, error: "invalid_logDate" };

  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig_();
  const sh  = mustSheet_(ss, cfg.SHEET_NAME);

  const status = buildStatusForFast_(sh, name, logDateS);

  return {
    ok:        true,
    name,
    logDate:   logDateS,
    doneCount: status.doneCount,
    sessions: {
      s1: { mark: status.sessions.s1.done ? "✅" : "—", time: status.sessions.s1.time || "" },
      s2: { mark: status.sessions.s2.done ? "✅" : "—", time: status.sessions.s2.time || "" },
      s3: { mark: status.sessions.s3.done ? "✅" : "—", time: status.sessions.s3.time || "" }
    }
  };
}

// ====== ACTION: getAllStatus (PREFETCH) ======
// ✅ scan แค่ 125 rows ท้ายสุด (41 คน × 3 ครั้ง = 123 rows max)
function handleGetAllStatus_(p) {
  const logDateS = String(p.logDate || "").trim();

  if (!logDateS)             return { ok: false, error: "missing_date" };
  if (!isISODate_(logDateS)) return { ok: false, error: "invalid_logDate" };

  const ss  = SpreadsheetApp.getActiveSpreadsheet();
  const cfg = getConfig_();
  const sh  = mustSheet_(ss, cfg.SHEET_NAME);

  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return { ok: true, date: logDateS, data: {} };

  const head       = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                       .map(h => String(h || "").trim());
  const idxName    = head.indexOf("Name");
  const idxSession = head.indexOf("Session");
  const idxLogDate = head.indexOf("LogDate");
  const idxClient  = head.indexOf("ClientNow");
  const idxTz      = head.indexOf("TzOffsetMin");
  const idxTs      = head.indexOf("Timestamp");

  if (idxName < 0 || idxSession < 0 || idxLogDate < 0) {
    return { ok: false, error: "missing_required_headers" };
  }

  // ✅ อ่านแค่ 125 rows ท้ายสุด แทนที่จะอ่านทั้ง sheet
  const SCAN_ROWS = 125;
  const startRow  = Math.max(2, lastRow - SCAN_ROWS + 1);
  const numRows   = lastRow - startRow + 1;
  const values    = sh.getRange(startRow, 1, numRows, sh.getLastColumn()).getValues();

  const data = {};

  for (let i = 0; i < values.length; i++) {
    const row = values[i];

    let rowLogISO = "";
    const v = row[idxLogDate];
    if (v instanceof Date) rowLogISO = toISODateServer_(v);
    else if (v) rowLogISO = String(v).trim();
    if (rowLogISO !== logDateS) continue;

    const name = String(row[idxName] || "").trim();
    if (!name) continue;

    const sess = normalizeSession_(String(row[idxSession] || "").trim());
    if (!sess) continue;

    if (!data[name]) {
      data[name] = {
        doneCount: 0,
        sessions: {
          s1: { mark: "—", time: "" },
          s2: { mark: "—", time: "" },
          s3: { mark: "—", time: "" }
        }
      };
    }

    let key = null;
    if (sess === "ครั้งที่ 1") key = "s1";
    else if (sess === "ครั้งที่ 2") key = "s2";
    else if (sess === "ครั้งที่ 3") key = "s3";
    if (!key) continue;

    if (data[name].sessions[key].mark === "✅") continue;

    const tClient = (idxClient >= 0 && idxTz >= 0)
      ? localHHmmFromClient_(row[idxClient], row[idxTz]) : "";
    let tTs = "";
    if (idxTs >= 0 && row[idxTs] instanceof Date) {
      tTs = Utilities.formatDate(row[idxTs], Session.getScriptTimeZone(), "HH:mm");
    }

    data[name].sessions[key] = { mark: "✅", time: tClient || tTs || "" };
    data[name].doneCount = Object.values(data[name].sessions)
      .filter(s => s.mark === "✅").length;
  }

  return { ok: true, date: logDateS, data };
}

// ====== FAST STATUS SCAN ======
function buildStatusForFast_(sh, name, logDateS) {
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return emptyStatus_();

  const head       = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                       .map(h => String(h || "").trim());
  const idxName    = head.indexOf("Name");
  const idxSession = head.indexOf("Session");
  const idxLogDate = head.indexOf("LogDate");
  const idxClient  = head.indexOf("ClientNow");
  const idxTz      = head.indexOf("TzOffsetMin");
  const idxTs      = head.indexOf("Timestamp");

  if (idxName < 0 || idxSession < 0 || idxLogDate < 0) return emptyStatus_();

  const SCAN_ROWS = 125;
  const startRow  = Math.max(2, lastRow - SCAN_ROWS + 1);
  const numRows   = lastRow - startRow + 1;
  const values    = sh.getRange(startRow, 1, numRows, sh.getLastColumn()).getValues();

  const sessions = {};
  let doneCount  = 0;

  for (let i = values.length - 1; i >= 0; i--) {
    const row = values[i];

    let rowLogISO = "";
    const v = row[idxLogDate];
    if (v instanceof Date) rowLogISO = toISODateServer_(v);
    else if (v) rowLogISO = String(v).trim();
    if (rowLogISO !== logDateS) continue;

    if (String(row[idxName] || "").trim() !== name) continue;

    const sess = normalizeSession_(String(row[idxSession] || "").trim());
    if (!sess || sessions[sess]) continue;

    const tClient = (idxClient >= 0 && idxTz >= 0)
      ? localHHmmFromClient_(row[idxClient], row[idxTz]) : "";
    let tTs = "";
    if (idxTs >= 0 && row[idxTs] instanceof Date) {
      tTs = Utilities.formatDate(row[idxTs], Session.getScriptTimeZone(), "HH:mm");
    }

    sessions[sess] = { done: true, time: tClient || tTs || "" };
    doneCount++;

    if (doneCount === 3) break;
  }

  return {
    doneCount,
    sessions: {
      s1: sessions["ครั้งที่ 1"] || { done: false, time: "" },
      s2: sessions["ครั้งที่ 2"] || { done: false, time: "" },
      s3: sessions["ครั้งที่ 3"] || { done: false, time: "" }
    }
  };
}

// ====== EMPTY STATUS ======
function emptyStatus_() {
  return {
    doneCount: 0,
    sessions: {
      s1: { done: false, time: "" },
      s2: { done: false, time: "" },
      s3: { done: false, time: "" }
    }
  };
}

// ====== ACTION: dashboard ======
function handleDashboard_(p) {
  const weekStartISO = String(p.weekStartISO || "").trim();
  const weekEndISO   = String(p.weekEndISO   || "").trim();
  const weekOffset   = Number(String(p.weekOffset || "0").trim() || 0);

  if ((weekStartISO && !isISODate_(weekStartISO)) || (weekEndISO && !isISODate_(weekEndISO))) {
    return { ok: false, error: "invalid_week_range" };
  }

  const week = (weekStartISO && weekEndISO)
    ? { startISO: weekStartISO, endISO: weekEndISO }
    : weekRangeFromOffsetServer_(weekOffset);

  const ss        = SpreadsheetApp.getActiveSpreadsheet();
  const cfg       = getConfig_();
  const responses = mustSheet_(ss, cfg.SHEET_NAME);
  const people    = readPeople_(ss);

  const doneMap   = buildDoneMapFromResponses_(responses);
  const sumThis   = calcWeekCompletion_(people, doneMap, week.startISO);
  const perPeople = buildPeopleWeekRows_(people, doneMap, week.startISO);

  return {
    ok:         true,
    week,
    weekOffset,
    summary:    { thisWeek: sumThis },
    people:     perPeople
  };
}

// ====== CONFIG ======
function getConfig_() {
  const props                = PropertiesService.getScriptProperties();
  const secretFromProps      = String(props.getProperty("SECRET")       || "").trim();
  const sheetNameFromProps   = String(props.getProperty("SHEET_NAME")   || "").trim();
  const peopleSheetFromProps = String(props.getProperty("PEOPLE_SHEET") || "").trim();

  return {
    SECRET:                 secretFromProps      || DEFAULT_SECRET,
    SHEET_NAME:             sheetNameFromProps   || DEFAULT_SHEET_NAME,
    PEOPLE_SHEET:           peopleSheetFromProps || DEFAULT_PEOPLE_SHEET,
    SECRET_FROM_PROPERTIES: !!secretFromProps
  };
}

// ====== HELPERS: Sheets ======
function mustSheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error(`sheet_not_found:${name}`);
  return sh;
}

function readPeople_(ss) {
  const cfg     = getConfig_();
  const sh      = ss.getSheetByName(cfg.PEOPLE_SHEET);
  if (!sh) return [];

  const lastRow = Math.max(1, sh.getLastRow());
  const vals    = sh.getRange(1, 1, lastRow, 1).getValues().flat()
    .map(v => String(v || "").trim())
    .filter(Boolean);

  if (vals.length && /^name$/i.test(vals[0])) vals.shift();

  return Array.from(new Set(vals));
}

// ====== HELPERS: Validation ======
function isISODate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return false;
  const [y, m, d] = String(s).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === (m - 1) && dt.getDate() === d;
}

function isValidISODateTime_(s) {
  return isFinite(Date.parse(String(s || "")));
}

function normalizeSession_(s) {
  s = String(s || "").trim();
  const m = s.match(/^ครั้งที่\s*[123]$/);
  if (m) return s.replace(/\s+/g, " ").trim();
  const m2 = s.match(/^ครั้งที่\s*[123]/);
  return m2 ? m2[0].replace(/\s+/g, " ").trim() : s;
}

// ====== HELPERS: Date ======
function isoToDateAtMidnight_(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function weekdayFromISO_(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const th = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัส","ศุกร์","เสาร์"];
  return th[dt.getDay()];
}

function localHHmmFromClient_(clientNowISO, tzOffsetMin) {
  if (!clientNowISO) return "";
  const utcMs = Date.parse(String(clientNowISO));
  if (!isFinite(utcMs)) return "";
  const off = Number(tzOffsetMin);
  if (!isFinite(off)) return "";
  const localMs = utcMs - (off * 60000);
  return Utilities.formatDate(new Date(localMs), "UTC", "HH:mm");
}

function toISODateServer_(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

// ====== DUPLICATE CHECK (OPTIMIZED v2.5) ======
// ✅ scan แค่ 125 rows ท้ายสุด แทน getDataRange() ทั้ง Sheet
function hasDuplicateSubmission_(sh, name, logDateS, session) {
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return { ok: true, duplicate: false };

  const head       = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0]
                       .map(h => String(h || "").trim());
  const idxName    = head.indexOf("Name");
  const idxSession = head.indexOf("Session");
  const idxLogDate = head.indexOf("LogDate");

  if (idxName < 0 || idxSession < 0 || idxLogDate < 0)
    return { ok: false, error: "missing_required_headers" };

  const SCAN_ROWS = 125;
  const startRow  = Math.max(2, lastRow - SCAN_ROWS + 1);
  const numRows   = lastRow - startRow + 1;
  const values    = sh.getRange(startRow, 1, numRows, sh.getLastColumn()).getValues();

  for (let i = values.length - 1; i >= 0; i--) {
    const row        = values[i];
    const rowName    = String(row[idxName]    || "").trim();
    const rowSession = normalizeSession_(String(row[idxSession] || "").trim());

    let rowLogISO = "";
    const v = row[idxLogDate];
    if (v instanceof Date) rowLogISO = toISODateServer_(v);
    else if (v) rowLogISO = String(v).trim();

    if (rowName === name && rowSession === session && rowLogISO === logDateS) {
      return { ok: true, duplicate: true };
    }
  }

  return { ok: true, duplicate: false };
}

// ====== BUILD STATUS (OPTIMIZED v2.5) ======
// ✅ ใช้ buildStatusForFast_ แทน buildDoneMapFromResponses_ (ไม่อ่าน Sheet ทั้งหมด)
function buildStatusFor_(responsesSheet, name, logDateS) {
  const fast = buildStatusForFast_(responsesSheet, name, logDateS);
  return {
    doneCount: fast.doneCount,
    sessions: {
      s1: { done: fast.sessions.s1.done, time: fast.sessions.s1.time || "" },
      s2: { done: fast.sessions.s2.done, time: fast.sessions.s2.time || "" },
      s3: { done: fast.sessions.s3.done, time: fast.sessions.s3.time || "" }
    }
  };
}

// ====== BUILD DONE MAP (ใช้สำหรับ dashboard เท่านั้น) ======
function buildDoneMapFromResponses_(sh) {
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return new Map();

  const head       = values[0].map(h => String(h || "").trim());
  const idxName    = head.indexOf("Name");
  const idxSession = head.indexOf("Session");
  const idxLogDate = head.indexOf("LogDate");
  const idxTs      = head.indexOf("Timestamp");
  const idxClient  = head.indexOf("ClientNow");
  const idxTz      = head.indexOf("TzOffsetMin");

  const map = new Map();

  for (let i = 1; i < values.length; i++) {
    const row        = values[i];
    const name       = idxName    >= 0 ? String(row[idxName]    || "").trim() : "";
    const sessionRaw = idxSession >= 0 ? String(row[idxSession] || "").trim() : "";
    const session    = normalizeSession_(sessionRaw);

    let logISO = "";
    if (idxLogDate >= 0) {
      const v = row[idxLogDate];
      if (v instanceof Date) logISO = toISODateServer_(v);
      else if (v) logISO = String(v).trim();
    }

    if (!name || !session || !logISO) continue;

    const key = `${name}|${logISO}`;
    if (!map.has(key)) map.set(key, { set: new Set(), times: {} });

    const rec = map.get(key);
    rec.set.add(session);

    const tClient = (idxClient >= 0 && idxTz >= 0)
      ? localHHmmFromClient_(row[idxClient], row[idxTz]) : "";
    let tTs = "";
    if (idxTs >= 0) {
      const vts = row[idxTs];
      if (vts instanceof Date) {
        tTs = Utilities.formatDate(vts, Session.getScriptTimeZone(), "HH:mm");
      }
    }

    const hhmm = tClient || tTs || "";
    if (hhmm && !rec.times[session]) rec.times[session] = hhmm;
  }

  return map;
}

// ====== WEEK CALC ======
function mondayOfWeek_(d) {
  const x   = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day  = x.getDay();
  const diff = (day === 0) ? -6 : (1 - day);
  x.setDate(x.getDate() + diff);
  return x;
}

function weekRangeFromOffsetServer_(weekOffset) {
  const now     = new Date();
  const shifted = new Date(now);
  shifted.setDate(now.getDate() + (weekOffset * 7));
  const mon = mondayOfWeek_(shifted);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { startISO: toISODateServer_(mon), endISO: toISODateServer_(sun) };
}

function calcWeekCompletion_(peopleList, doneMap, weekStartISO) {
  const start = isoToDateAtMidnight_(weekStartISO);
  const days  = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
  }

  let completePeople = 0;
  let totalDoneAll   = 0;

  for (const name of peopleList) {
    let done = 0;
    for (const dayISO of days) {
      const rec = doneMap.get(`${name}|${dayISO}`);
      done += rec ? Math.min(3, rec.set.size) : 0;
    }
    totalDoneAll += done;
    if (done >= 21) completePeople++;
  }

  const peopleTotal      = peopleList.length;
  const incompletePeople = Math.max(0, peopleTotal - completePeople);
  const totalSlots       = peopleTotal * 21;
  const completeRate     = peopleTotal ? Math.round((completePeople / peopleTotal) * 100) : 0;

  return { peopleTotal, completePeople, incompletePeople, completeRate, totalDoneAll, totalSlots };
}

function buildPeopleWeekRows_(peopleList, doneMap, weekStartISO) {
  const start = isoToDateAtMidnight_(weekStartISO);
  const days  = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
  }

  const out = [];
  for (const name of peopleList) {
    let totalDone = 0;
    let doneDays  = 0;
    const perDay  = [];

    for (let i = 0; i < 7; i++) {
      const key   = `${name}|${days[i]}`;
      const rec   = doneMap.get(key);
      const set   = rec ? rec.set   : null;
      const times = rec ? rec.times : {};
      const cnt   = set ? Math.min(3, set.size) : 0;

      totalDone += cnt;
      if (cnt === 3) doneDays++;

      perDay.push({
        dateISO: days[i],
        count:   cnt,
        sessions: {
          s1: { done: !!(set && set.has("ครั้งที่ 1")), time: times["ครั้งที่ 1"] || "" },
          s2: { done: !!(set && set.has("ครั้งที่ 2")), time: times["ครั้งที่ 2"] || "" },
          s3: { done: !!(set && set.has("ครั้งที่ 3")), time: times["ครั้งที่ 3"] || "" }
        }
      });
    }

    out.push({
      name,
      totalDone,
      totalSlots: 21,
      percent:    Math.round((totalDone / 21) * 100),
      doneDays,
      perDay
    });
  }

  return out;
}

// ====== JSON ======
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
