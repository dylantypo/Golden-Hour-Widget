// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: orange; icon-glyph: sun;

// ─────────────────────────────────────────────────────────
//  GOLDEN HOUR
// ─────────────────────────────────────────────────────────
//  Widget parameter:  city name  (e.g. "Chicago")
//  No parameter:      uses your GPS location
//  Tap widget:        opens full visual
//  Supports:          small (170x170) + medium (364x170)
// ─────────────────────────────────────────────────────────

const FALLBACK_CITY = "Chicago";
const CACHE_KEY = "golden_hour_geo_cache";

// ── Geocode ─────────────────────────────────────────────
async function geocodeCity(city) {
  const fm = FileManager.iCloud();
  const cacheDir = fm.documentsDirectory();
  const cachePath = fm.joinPath(cacheDir, CACHE_KEY + ".json");

  if (fm.fileExists(cachePath)) {
    await fm.downloadFileFromiCloud(cachePath);
    try {
      const cached = JSON.parse(fm.readString(cachePath));
      if (cached.city.toLowerCase() === city.toLowerCase()) {
        return cached;
      }
    } catch (e) {}
  }

  const encoded = encodeURIComponent(city);
  const url =
    "https://nominatim.openstreetmap.org/search?q=" +
    encoded +
    "&format=json&limit=1";
  const req = new Request(url);
  req.headers = { "User-Agent": "Scriptable-GoldenHour/1.0" };
  const res = await req.loadJSON();

  if (!res || res.length === 0) return null;

  const result = {
    city: city,
    display: res[0].display_name.split(",")[0].trim(),
    lat: parseFloat(res[0].lat),
    lon: parseFloat(res[0].lon),
  };

  fm.writeString(cachePath, JSON.stringify(result));
  return result;
}

async function getGPSLocation() {
  Location.setAccuracyToKilometer();
  const loc = await Location.current();
  const geo = await Location.reverseGeocode(loc.latitude, loc.longitude);
  const city =
    geo && geo[0] ? geo[0].city || geo[0].locality || "Here" : "Here";
  return {
    city: city,
    display: city,
    lat: loc.latitude,
    lon: loc.longitude,
  };
}

async function getLocation() {
  const param = (args.widgetParameter || "").trim();

  if (param.length > 0) {
    const result = await geocodeCity(param);
    if (result) return result;
  }

  if (!config.runsInWidget) {
    const alert = new Alert();
    alert.title = "Golden Hour";
    alert.message = "Enter a city, or leave blank for GPS";
    alert.addTextField("City", FALLBACK_CITY);
    alert.addAction("Go");
    alert.addCancelAction("Use GPS");
    const idx = await alert.presentAlert();

    if (idx === 0) {
      const city = alert.textFieldValue(0).trim();
      if (city.length > 0) {
        const result = await geocodeCity(city);
        if (result) return result;
      }
    }
    return await getGPSLocation();
  }

  return await getGPSLocation();
}

// ── Cloud Cover ─────────────────────────────────────────
async function fetchCloudCover(lat, lon) {
  try {
    const url =
      "https://api.open-meteo.com/v1/forecast" +
      "?latitude=" +
      lat.toFixed(4) +
      "&longitude=" +
      lon.toFixed(4) +
      "&hourly=cloud_cover" +
      "&forecast_days=1";
    const req = new Request(url);
    req.timeoutInterval = 5;
    const res = await req.loadJSON();
    if (res && res.hourly && res.hourly.cloud_cover) {
      return res.hourly;
    }
  } catch (e) {}
  return null;
}

function getCloudAtMin(hourly, targetMin) {
  if (!hourly || !hourly.cloud_cover) return null;
  const hour = Math.min(Math.floor(targetMin / 60), 23);
  const val = hourly.cloud_cover[hour];
  if (val === null) return null;
  return val;
}

function cloudLabel(pct) {
  if (pct === null) return { text: "--", color: "#8a7b72", tier: "unknown" };
  if (pct <= 20) return { text: "Clear", color: "#7fb87a", tier: "clear" };
  if (pct <= 50)
    return { text: "Partly Cloudy", color: "#d4a574", tier: "partly" };
  if (pct <= 80)
    return { text: "Mostly Cloudy", color: "#c4784a", tier: "mostly" };
  return { text: "Overcast", color: "#8a6060", tier: "overcast" };
}

function cloudShort(pct) {
  if (pct === null) return { text: "--", color: "#8a7b72" };
  if (pct <= 20) return { text: "Clear", color: "#7fb87a" };
  if (pct <= 50) return { text: "Partial", color: "#d4a574" };
  if (pct <= 80) return { text: "Cloudy", color: "#c4784a" };
  return { text: "Overcast", color: "#8a6060" };
}

// ── Solar Calc ──────────────────────────────────────────
function calcSunEvent(lat, lon, doy, angleDeg, isRise) {
  const lngHour = lon / 15;
  const t = isRise ? doy + (6 - lngHour) / 24 : doy + (18 - lngHour) / 24;

  const M = 0.9856 * t - 3.289;
  let L =
    M +
    1.916 * Math.sin((M * Math.PI) / 180) +
    0.02 * Math.sin((2 * M * Math.PI) / 180) +
    282.634;
  L = ((L % 360) + 360) % 360;

  let RA = (Math.atan(0.91764 * Math.tan((L * Math.PI) / 180)) * 180) / Math.PI;
  RA = ((RA % 360) + 360) % 360;
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
  RA /= 15;

  const sinDec = 0.39782 * Math.sin((L * Math.PI) / 180);
  const cosDec = Math.cos(Math.asin(sinDec));
  const latR = (lat * Math.PI) / 180;

  const cosH =
    (Math.sin((angleDeg * Math.PI) / 180) - Math.sin(latR) * sinDec) /
    (Math.cos(latR) * cosDec);
  if (cosH > 1 || cosH < -1) return null;

  let H = (Math.acos(cosH) * 180) / Math.PI;
  if (isRise) H = 360 - H;
  H /= 15;

  const T = H + RA - 0.06571 * t - 6.622;
  return (((T - lngHour) % 24) + 24) % 24;
}

function utcToLocal(utcH) {
  const off = new Date().getTimezoneOffset();
  let local = utcH - off / 60;
  if (local < 0) local += 24;
  if (local >= 24) local -= 24;
  return local;
}

function hToMin(h) {
  return Math.round(h * 60);
}

function fmtTime(m) {
  let h = Math.floor(m / 60);
  const mn = m % 60;
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + String(mn).padStart(2, "0") + " " + ap;
}

// Short time format for small widget (no space before AM/PM)
function fmtShort(m) {
  let h = Math.floor(m / 60);
  const mn = m % 60;
  const ap = h >= 12 ? "p" : "a";
  h = h % 12 || 12;
  return h + ":" + String(mn).padStart(2, "0") + ap;
}

function getTimes(lat, lon) {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const doy = Math.floor((now - start) / 86400000);

  const angles = [
    { key: "civil", deg: -6.0 },
    { key: "goldenL", deg: -4.0 },
    { key: "sun", deg: -0.833 },
    { key: "goldenH", deg: 6.0 },
  ];

  const ev = {};
  for (const a of angles) {
    const rise = calcSunEvent(lat, lon, doy, a.deg, true);
    const set = calcSunEvent(lat, lon, doy, a.deg, false);
    if (rise === null || set === null) return null;
    ev[a.key + "_rise"] = hToMin(utcToLocal(rise));
    ev[a.key + "_set"] = hToMin(utcToLocal(set));
  }

  return {
    blue_am: { start: ev.civil_rise, end: ev.goldenL_rise },
    golden_am: { start: ev.goldenL_rise, end: ev.goldenH_rise },
    sunrise: ev.sun_rise,
    golden_pm: { start: ev.goldenH_set, end: ev.goldenL_set },
    sunset: ev.sun_set,
    blue_pm: { start: ev.goldenL_set, end: ev.civil_set },
  };
}

// ── Event Helpers ───────────────────────────────────────
function getAllEvents(t) {
  return [
    {
      label: "AM Blue",
      full: "Morning Blue Hour",
      start: t.blue_am.start,
      end: t.blue_am.end,
      icon: "~",
      color: "#4a6fa5",
    },
    {
      label: "AM Gold",
      full: "Morning Golden Hour",
      start: t.golden_am.start,
      end: t.golden_am.end,
      icon: "*",
      color: "#f0c27f",
    },
    {
      label: "PM Gold",
      full: "Evening Golden Hour",
      start: t.golden_pm.start,
      end: t.golden_pm.end,
      icon: "*",
      color: "#e8a87c",
    },
    {
      label: "PM Blue",
      full: "Evening Blue Hour",
      start: t.blue_pm.start,
      end: t.blue_pm.end,
      icon: "~",
      color: "#4a6fa5",
    },
  ];
}

function getNextEvent(t, nowMin) {
  const allEvents = getAllEvents(t);

  for (const e of allEvents) {
    if (nowMin >= e.start && nowMin <= e.end) {
      const remain = e.end - nowMin;
      return { ...e, active: true, remain: remain, countdown: null };
    }
  }

  for (const e of allEvents) {
    if (nowMin < e.start) {
      const diff = e.start - nowMin;
      const h = Math.floor(diff / 60);
      const m = diff % 60;
      const txt = h > 0 ? h + "h " + m + "m" : m + "m";
      return { ...e, active: false, remain: null, countdown: txt };
    }
  }

  return null;
}

// Returns all events not yet finished (active or upcoming)
function getRemainingEvents(t, nowMin) {
  const allEvents = getAllEvents(t);
  const remaining = [];

  for (const e of allEvents) {
    if (nowMin >= e.start && nowMin <= e.end) {
      remaining.push({ ...e, active: true });
    } else if (nowMin < e.start) {
      remaining.push({ ...e, active: false });
    }
  }

  return remaining;
}

// ── Draw Timeline Bar ───────────────────────────────────
function drawTimeline(t, nowMin, width, height) {
  const dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.respectScreenScale = true;

  const DS = 300,
    DE = 1260,
    DR = DE - DS;
  function x(m) {
    return ((m - DS) / DR) * width;
  }

  const bg = new Path();
  bg.addRoundedRect(new Rect(0, 0, width, height), 4, 4);
  dc.addPath(bg);
  dc.setFillColor(new Color("#1e1520"));
  dc.fillPath();

  const segs = [
    { s: t.blue_am.start, e: t.blue_am.end, c: "#4a6fa5" },
    { s: t.golden_am.start, e: t.golden_am.end, c: "#f0c27f" },
    { s: t.golden_pm.start, e: t.golden_pm.end, c: "#e8a87c" },
    { s: t.blue_pm.start, e: t.blue_pm.end, c: "#4a6fa5" },
  ];

  for (const seg of segs) {
    const sx = x(seg.s);
    const ex = x(seg.e);
    const p = new Path();
    p.addRoundedRect(new Rect(sx, 0, ex - sx, height), 2, 2);
    dc.addPath(p);
    dc.setFillColor(new Color(seg.c, 0.75));
    dc.fillPath();
  }

  const np = x(nowMin);
  if (np >= 0 && np <= width) {
    const marker = new Path();
    marker.addRoundedRect(new Rect(np - 1, 0, 3, height), 1, 1);
    dc.addPath(marker);
    dc.setFillColor(new Color("#ffffff"));
    dc.fillPath();

    const glow = new Path();
    glow.addRoundedRect(new Rect(np - 3, 0, 7, height), 2, 2);
    dc.addPath(glow);
    dc.setFillColor(new Color("#ffffff", 0.2));
    dc.fillPath();
  }

  return dc.getImage();
}

// ─────────────────────────────────────────────────────────
//  MEDIUM WIDGET  (364 x 170 pt)
// ─────────────────────────────────────────────────────────

// Compact time row for medium widget
function addTimeRowMed(stack, icon, label, startMin, endMin, color, active) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.setPadding(4, 7, 4, 7);
  row.cornerRadius = 5;

  if (active) {
    row.backgroundColor = new Color(color, 0.15);
    row.borderColor = new Color(color, 0.4);
    row.borderWidth = 1;
  } else {
    row.backgroundColor = new Color("#1e1520", 0.6);
  }

  const ico = row.addText(icon);
  ico.font = Font.boldMonospacedSystemFont(10);
  ico.textColor = new Color(color);
  row.addSpacer(5);

  const info = row.addStack();
  info.layoutVertically();

  const lbl = info.addText(label);
  lbl.font = Font.mediumMonospacedSystemFont(9);
  lbl.textColor = new Color(color);
  lbl.lineLimit = 1;

  const times = info.addText(fmtShort(startMin) + " - " + fmtShort(endMin));
  times.font = Font.lightMonospacedSystemFont(8);
  times.textColor = new Color("#8a7b72");
  times.lineLimit = 1;

  row.addSpacer();

  const dur = endMin - startMin;
  const durText = row.addText(dur + "m");
  durText.font = Font.mediumMonospacedSystemFont(8);
  durText.textColor = new Color(color, 0.7);
}

async function createWidget(loc, hourly) {
  const t = getTimes(loc.lat, loc.lon);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const w = new ListWidget();
  w.backgroundColor = new Color("#1a1218");
  w.setPadding(10, 10, 10, 10);

  // ── Header ──
  const title = w.addText("GOLDEN HOUR");
  title.font = Font.boldMonospacedSystemFont(11);
  title.textColor = new Color("#f0c27f");
  title.centerAlignText();

  const locText = w.addText(loc.display);
  locText.font = Font.lightMonospacedSystemFont(7);
  locText.textColor = new Color("#8a7b72");
  locText.centerAlignText();

  w.addSpacer(4);

  if (!t) {
    w.addSpacer();
    const err = w.addText("No data");
    err.font = Font.lightMonospacedSystemFont(9);
    err.textColor = new Color("#8a7b72");
    w.addSpacer();
    return w;
  }

  const inBlueAM = nowMin >= t.blue_am.start && nowMin <= t.blue_am.end;
  const inGoldenAM = nowMin >= t.golden_am.start && nowMin <= t.golden_am.end;
  const inGoldenPM = nowMin >= t.golden_pm.start && nowMin <= t.golden_pm.end;
  const inBluePM = nowMin >= t.blue_pm.start && nowMin <= t.blue_pm.end;
  const shooting = inBlueAM || inGoldenAM || inGoldenPM || inBluePM;

  // ── Status + Cloud (merged row) ──
  const nxt = getNextEvent(t, nowMin);
  const cloudTarget = nxt ? nxt.start : null;
  const cloudPct = cloudTarget ? getCloudAtMin(hourly, cloudTarget) : null;
  const cl = cloudShort(cloudPct);

  const comboRow = w.addStack();
  comboRow.layoutHorizontally();
  comboRow.centerAlignContent();

  comboRow.addSpacer();

  const badge = comboRow.addStack();
  badge.cornerRadius = 4;

  if (shooting) {
    badge.setPadding(4, 12, 4, 12);
    badge.backgroundColor = new Color("#f0c27f", 0.28);
    badge.borderColor = new Color("#f0c27f", 0.95);
    badge.borderWidth = 2;
    badge.addSpacer();
    const bt = badge.addText("* SHOOTING NOW *");
    bt.font = Font.boldMonospacedSystemFont(10);
    bt.textColor = new Color("#fff3d9");
    badge.addSpacer();
  } else if (nxt) {
    badge.setPadding(3, 10, 3, 10);
    badge.backgroundColor = new Color("#8a7b72", 0.1);
    badge.borderColor = new Color("#8a7b72", 0.2);
    badge.borderWidth = 1;
    const bt = badge.addText(">> " + nxt.label + " in " + nxt.countdown);
    bt.font = Font.mediumMonospacedSystemFont(8);
    bt.textColor = new Color("#d4a574");
  } else {
    badge.setPadding(3, 10, 3, 10);
    badge.backgroundColor = new Color("#8a7b72", 0.08);
    const bt = badge.addText("Done for today");
    bt.font = Font.lightMonospacedSystemFont(8);
    bt.textColor = new Color("#8a7b72");
  }

  comboRow.addSpacer(6);

  const cloudPill = comboRow.addStack();
  cloudPill.setPadding(3, 8, 3, 8);
  cloudPill.cornerRadius = 4;
  cloudPill.backgroundColor = new Color(cl.color, 0.1);
  cloudPill.borderColor = new Color(cl.color, 0.2);
  cloudPill.borderWidth = 1;

  const cTxt = cloudPill.addText(cl.text);
  cTxt.font = Font.mediumMonospacedSystemFont(7);
  cTxt.textColor = new Color(cl.color);

  if (cloudPct !== null) {
    cloudPill.addSpacer(3);
    const cPct = cloudPill.addText(cloudPct + "%");
    cPct.font = Font.lightMonospacedSystemFont(7);
    cPct.textColor = new Color(cl.color, 0.6);
  }

  comboRow.addSpacer();

  w.addSpacer(4);

  // ── Timeline Bar ──
  const tlImg = drawTimeline(t, nowMin, 1032, 24);
  const tlRow = w.addStack();
  const imgWidget = tlRow.addImage(tlImg);
  imgWidget.imageSize = new Size(344, 12);

  w.addSpacer(4);

  // ── AM / PM Columns ──
  const body = w.addStack();
  body.layoutHorizontally();
  body.centerAlignContent();

  const amCol = body.addStack();
  amCol.layoutVertically();
  amCol.spacing = 3;
  amCol.size = new Size(168, 0);

  const amHead = amCol.addText(t.blue_am.start < 720 ? " MORNING" : " DAWN");
  amHead.font = Font.lightMonospacedSystemFont(6);
  amHead.textColor = new Color("#8a7b72");

  addTimeRowMed(
    amCol,
    "~",
    "Blue",
    t.blue_am.start,
    t.blue_am.end,
    "#4a6fa5",
    inBlueAM,
  );
  addTimeRowMed(
    amCol,
    "*",
    "Golden",
    t.golden_am.start,
    t.golden_am.end,
    "#f0c27f",
    inGoldenAM,
  );

  body.addSpacer(8);

  const pmCol = body.addStack();
  pmCol.layoutVertically();
  pmCol.spacing = 3;
  pmCol.size = new Size(168, 0);

  const pmHead = pmCol.addText(t.golden_pm.start >= 720 ? " EVENING" : " DUSK");
  pmHead.font = Font.lightMonospacedSystemFont(6);
  pmHead.textColor = new Color("#8a7b72");

  addTimeRowMed(
    pmCol,
    "*",
    "Golden",
    t.golden_pm.start,
    t.golden_pm.end,
    "#e8a87c",
    inGoldenPM,
  );
  addTimeRowMed(
    pmCol,
    "~",
    "Blue",
    t.blue_pm.start,
    t.blue_pm.end,
    "#4a6fa5",
    inBluePM,
  );

  return w;
}

// ─────────────────────────────────────────────────────────
//  SMALL WIDGET  (170 x 170 pt)
// ─────────────────────────────────────────────────────────

function addCompactRow(stack, ev) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.setPadding(5, 8, 5, 8);
  row.cornerRadius = 6;

  if (ev.active) {
    row.backgroundColor = new Color(ev.color, 0.15);
    row.borderColor = new Color(ev.color, 0.4);
    row.borderWidth = 1;
  } else {
    row.backgroundColor = new Color("#1e1520", 0.5);
  }

  const ico = row.addText(ev.icon);
  ico.font = Font.boldMonospacedSystemFont(10);
  ico.textColor = new Color(ev.color);
  row.addSpacer(5);

  const info = row.addStack();
  info.layoutVertically();

  const lbl = info.addText(ev.label);
  lbl.font = Font.mediumMonospacedSystemFont(9);
  lbl.textColor = new Color(ev.color);
  lbl.lineLimit = 1;

  const times = info.addText(fmtShort(ev.start) + " - " + fmtShort(ev.end));
  times.font = Font.lightMonospacedSystemFont(8);
  times.textColor = new Color("#8a7b72");
  times.lineLimit = 1;

  row.addSpacer();

  const dur = ev.end - ev.start;
  const durText = row.addText(dur + "m");
  durText.font = Font.mediumMonospacedSystemFont(8);
  durText.textColor = new Color(ev.color, 0.7);
}

async function createSmallWidget(loc, hourly) {
  const t = getTimes(loc.lat, loc.lon);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const w = new ListWidget();
  w.backgroundColor = new Color("#1a1218");
  w.setPadding(12, 10, 12, 10);

  // ── City Header ──
  const locText = w.addText(loc.display);
  locText.font = Font.boldMonospacedSystemFont(12);
  locText.textColor = new Color("#f0c27f");
  locText.centerAlignText();

  w.addSpacer(4);

  if (!t) {
    w.addSpacer();
    const err = w.addText("No data");
    err.font = Font.lightMonospacedSystemFont(10);
    err.textColor = new Color("#8a7b72");
    err.centerAlignText();
    w.addSpacer();
    return w;
  }

  // ── Shooting state ──
  const shooting =
    (nowMin >= t.blue_am.start && nowMin <= t.blue_am.end) ||
    (nowMin >= t.golden_am.start && nowMin <= t.golden_am.end) ||
    (nowMin >= t.golden_pm.start && nowMin <= t.golden_pm.end) ||
    (nowMin >= t.blue_pm.start && nowMin <= t.blue_pm.end);

  // ── Cloud pill ──
  const nxt = getNextEvent(t, nowMin);
  const cloudTarget = nxt ? nxt.start : null;
  const cloudPct = cloudTarget ? getCloudAtMin(hourly, cloudTarget) : null;
  const cl = cloudShort(cloudPct);

  const cloudRow = w.addStack();
  cloudRow.layoutHorizontally();
  cloudRow.addSpacer();

  const cloudPill = cloudRow.addStack();
  cloudPill.setPadding(3, 8, 3, 8);
  cloudPill.cornerRadius = 4;
  cloudPill.backgroundColor = new Color(cl.color, 0.1);
  cloudPill.borderColor = new Color(cl.color, 0.2);
  cloudPill.borderWidth = 1;

  const cTxt = cloudPill.addText(cl.text);
  cTxt.font = Font.mediumMonospacedSystemFont(8);
  cTxt.textColor = new Color(cl.color);

  if (cloudPct !== null) {
    cloudPill.addSpacer(4);
    const cPct = cloudPill.addText(cloudPct + "%");
    cPct.font = Font.lightMonospacedSystemFont(8);
    cPct.textColor = new Color(cl.color, 0.6);
  }

  cloudRow.addSpacer();

  if (shooting) {
    w.addSpacer(4);
    const shootRow = w.addStack();
    shootRow.layoutHorizontally();
    shootRow.setPadding(3, 8, 3, 8);
    shootRow.cornerRadius = 4;
    shootRow.backgroundColor = new Color("#f0c27f", 0.25);
    shootRow.borderColor = new Color("#f0c27f", 0.9);
    shootRow.borderWidth = 2;
    shootRow.addSpacer();
    const st = shootRow.addText("* SHOOTING NOW *");
    st.font = Font.boldMonospacedSystemFont(9);
    st.textColor = new Color("#fff3d9");
    shootRow.addSpacer();
  }

  w.addSpacer(6);

  // ── Remaining events ──
  const remaining = getRemainingEvents(t, nowMin);

  if (remaining.length === 0) {
    w.addSpacer();
    const done = w.addText("Done for today");
    done.font = Font.lightMonospacedSystemFont(10);
    done.textColor = new Color("#8a7b72");
    done.centerAlignText();
    w.addSpacer();
    return w;
  }

  const evStack = w.addStack();
  evStack.layoutVertically();
  evStack.spacing = 4;

  for (const ev of remaining) {
    addCompactRow(evStack, ev);
  }

  w.addSpacer();

  return w;
}

// ── Full Visual ─────────────────────────────────────────
function getFullHTML(loc, hourly) {
  const t = getTimes(loc.lat, loc.lon);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const latStr = Math.abs(loc.lat).toFixed(2) + (loc.lat >= 0 ? "N" : "S");
  const lonStr = Math.abs(loc.lon).toFixed(2) + (loc.lon >= 0 ? "E" : "W");

  if (!t)
    return "<html><body style='background:#1a1218;color:#e8d5c4;font-family:monospace;padding:40px'><p>No sunrise/sunset data</p></body></html>";

  const inBlueAM = nowMin >= t.blue_am.start && nowMin <= t.blue_am.end;
  const inGoldenAM = nowMin >= t.golden_am.start && nowMin <= t.golden_am.end;
  const inGoldenPM = nowMin >= t.golden_pm.start && nowMin <= t.golden_pm.end;
  const inBluePM = nowMin >= t.blue_pm.start && nowMin <= t.blue_pm.end;
  const shooting = inBlueAM || inGoldenAM || inGoldenPM || inBluePM;

  const nxt = getNextEvent(t, nowMin);
  const cloudTarget = nxt ? nxt.start : null;
  const cloudPct = cloudTarget ? getCloudAtMin(hourly, cloudTarget) : null;
  const cl = cloudLabel(cloudPct);

  let cloudPillHTML = "";
  if (nxt) {
    const pctStr = cloudPct !== null ? cloudPct + "%" : "";
    cloudPillHTML =
      '<div class="cloud-pill" style="border-color:' +
      cl.color +
      "40;background:" +
      cl.color +
      '18"><span class="cloud-icon" style="color:' +
      cl.color +
      '99">//</span>' +
      '<span class="cloud-text" style="color:' +
      cl.color +
      '">' +
      cl.text +
      "</span>";
    if (pctStr)
      cloudPillHTML +=
        '<span class="cloud-pct" style="color:' +
        cl.color +
        '99">' +
        pctStr +
        "</span>";
    cloudPillHTML += "</div>";
  }

  let statusHTML = "";
  if (shooting) {
    const remainTxt =
      nxt && nxt.remain !== null
        ? '<div class="sr">' + nxt.remain + " min remaining</div>"
        : "";
    statusHTML =
      '<div class="status shooting"><div class="st-body"><div class="st">* SHOOTING NOW *</div>' +
      remainTxt +
      "</div>" +
      cloudPillHTML +
      "</div>";
  } else {
    const events = [
      { min: t.blue_am.start, label: "AM Blue Hour" },
      { min: t.golden_am.start, label: "AM Golden Hour" },
      { min: t.golden_pm.start, label: "PM Golden Hour" },
      { min: t.blue_pm.start, label: "PM Blue Hour" },
    ];
    let found = false;
    for (const e of events) {
      if (nowMin < e.min) {
        const diff = e.min - nowMin;
        const h = Math.floor(diff / 60);
        const m = diff % 60;
        const txt = h > 0 ? (m > 0 ? h + "h " + m + "m" : h + "h") : m + "m";
        statusHTML =
          '<div class="status waiting"><div class="st-body"><div class="sl">NEXT UP</div><div class="st">' +
          e.label +
          "  --  " +
          txt +
          "</div></div>" +
          cloudPillHTML +
          "</div>";
        found = true;
        break;
      }
    }
    if (!found) {
      statusHTML =
        '<div class="status done"><div class="st-body"><div class="st" style="color:#8a7b72">Done for today -- see you tomorrow</div></div>' +
        cloudPillHTML +
        "</div>";
    }
  }

  const DS = 300,
    DE = 1260,
    DR = DE - DS;
  function pct(m) {
    return ((m - DS) / DR) * 100;
  }

  const segs = [
    {
      s: t.blue_am.start,
      e: t.blue_am.end,
      bg: "linear-gradient(180deg,#4a6fa5,#2d4a7a)",
      a: inBlueAM,
    },
    {
      s: t.golden_am.start,
      e: t.golden_am.end,
      bg: "linear-gradient(180deg,#f0c27f,#d4a054)",
      a: inGoldenAM,
    },
    {
      s: t.golden_am.end,
      e: t.golden_pm.start,
      bg: "rgba(232,213,196,0.06)",
      a: false,
    },
    {
      s: t.golden_pm.start,
      e: t.golden_pm.end,
      bg: "linear-gradient(180deg,#e8a87c,#c4784a)",
      a: inGoldenPM,
    },
    {
      s: t.blue_pm.start,
      e: t.blue_pm.end,
      bg: "linear-gradient(180deg,#4a6fa5,#2d4a7a)",
      a: inBluePM,
    },
  ];

  let tlHTML = "";
  for (const s of segs) {
    tlHTML +=
      '<div style="position:absolute;left:' +
      pct(s.s) +
      "%;width:" +
      (pct(s.e) - pct(s.s)) +
      "%;height:100%;background:" +
      s.bg +
      ";opacity:" +
      (s.a ? 1 : 0.6) +
      '"></div>';
  }
  const np = pct(nowMin);
  if (np >= 0 && np <= 100) {
    tlHTML +=
      '<div style="position:absolute;left:' +
      np +
      '%;top:0;height:100%;width:2px;background:#f0f0f0;box-shadow:0 0 8px rgba(240,240,240,0.5);z-index:10"><div style="position:absolute;top:-14px;left:-10px;font-size:8px;color:#f0f0f0;letter-spacing:1px;font-weight:500">NOW</div></div>';
  }

  function rc(label, s, e, icon, color, active) {
    const dur = e - s;
    const bdr = active
      ? "border-color:" + color + "CC;background:" + color + "33"
      : "";
    return (
      '<div class="card" style="' +
      bdr +
      '"><div class="cl"><div class="ci" style="color:' +
      color +
      '">' +
      icon +
      '</div><div><div class="cn">' +
      label +
      '</div><div class="ct">' +
      fmtTime(s) +
      " \u2013 " +
      fmtTime(e) +
      '</div></div></div><div class="cd" style="color:' +
      color +
      '">' +
      dur +
      "m</div></div>"
    );
  }

  function pc(label, m, icon, color) {
    return (
      '<div class="cp"><div class="cl"><div class="ci" style="color:' +
      color +
      ';opacity:0.6">' +
      icon +
      '</div><div class="cn" style="color:#b8a89c">' +
      label +
      '</div></div><div style="font-size:11px;color:#b8a89c;flex-shrink:0;white-space:nowrap">' +
      fmtTime(m) +
      "</div></div>"
    );
  }

  const morningCol =
    '<div class="sl2">' +
    (t.blue_am.start < 720 ? "MORNING" : "DAWN") +
    "</div>" +
    rc("Blue Hour", t.blue_am.start, t.blue_am.end, "~", "#4a6fa5", inBlueAM) +
    rc(
      "Golden Hour",
      t.golden_am.start,
      t.golden_am.end,
      "*",
      "#f0c27f",
      inGoldenAM,
    ) +
    pc("Sunrise", t.sunrise, "^", "#e8a87c");

  const eveningCol =
    '<div class="sl2">' +
    (t.golden_pm.start >= 720 ? "EVENING" : "DUSK") +
    "</div>" +
    rc(
      "Golden Hour",
      t.golden_pm.start,
      t.golden_pm.end,
      "*",
      "#e8a87c",
      inGoldenPM,
    ) +
    pc("Sunset", t.sunset, "v", "#c4784a") +
    rc("Blue Hour", t.blue_pm.start, t.blue_pm.end, "~", "#4a6fa5", inBluePM);

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:ui-monospace,'SF Mono',monospace;background:linear-gradient(175deg,#1a1218,#2d1b2e 30%,#1e1520);color:#e8d5c4;padding:24px 20px calc(16px + env(safe-area-inset-bottom,0px));min-height:100vh;display:flex;flex-direction:column;gap:10px}
.hd{text-align:center}
.co{font-size:9px;letter-spacing:4px;color:#c4784a;text-transform:uppercase;font-weight:300;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
h1{font-size:22px;font-weight:700;letter-spacing:2px;color:#f0c27f;margin-bottom:4px}
.dt{font-size:10px;color:#8a7b72;font-weight:300;letter-spacing:1px;white-space:nowrap}
.status{padding:10px 12px;border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:8px}
.st-body{min-width:0;flex:1}
.shooting{background:rgba(240,194,127,0.22);border:1px solid rgba(240,194,127,0.6);animation:pulse-border 2.5s ease-in-out infinite}
.waiting{background:rgba(138,123,114,0.1);border:1px solid rgba(138,123,114,0.2)}
.done{background:rgba(138,123,114,0.08);border:1px solid rgba(138,123,114,0.15)}
.sl{font-size:9px;color:#8a7b72;letter-spacing:2px;margin-bottom:3px}
.st{font-size:12px;font-weight:500;color:#d4a574;letter-spacing:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.shooting .st{color:#f0c27f;letter-spacing:3px;font-size:16px;font-weight:700}
.sr{font-size:9px;color:#d4a574;letter-spacing:2px;margin-top:3px;font-weight:300;white-space:nowrap}
.cloud-pill{display:inline-flex;align-items:center;gap:5px;padding:6px 10px;border-radius:6px;border:1px solid;flex-shrink:0;white-space:nowrap}
.cloud-icon{font-size:9px;font-weight:300}
.cloud-text{font-size:10px;font-weight:500;letter-spacing:1px}
.cloud-pct{font-size:9px;font-weight:300}
.tb{position:relative;height:30px;background:rgba(30,21,32,0.6);border-radius:6px;overflow:hidden;border:1px solid rgba(138,123,114,0.12)}
.tl{display:flex;justify-content:space-between;font-size:8px;color:#6a5b52;letter-spacing:1px;margin-top:4px}
.sl2{font-size:9px;letter-spacing:3px;color:#8a7b72;margin-bottom:2px;white-space:nowrap;flex-shrink:0}
.main{flex:1;display:flex;flex-direction:column;gap:14px;min-height:0;justify-content:space-between}
.col{display:flex;flex-direction:column;gap:6px}
.card{background:rgba(30,21,32,0.4);border:1px solid rgba(138,123,114,0.12);border-radius:8px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between}
.cl{display:flex;align-items:center;gap:8px;min-width:0}
.ci{width:16px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700;flex-shrink:0}
.cn{font-size:11px;font-weight:500;letter-spacing:1px;white-space:nowrap}
.ct{font-size:9px;color:#8a7b72;margin-top:2px;letter-spacing:.5px;white-space:nowrap}
.cd{font-size:10px;font-weight:500;letter-spacing:1px;flex-shrink:0;white-space:nowrap}
.cp{background:rgba(30,21,32,0.25);border:1px solid rgba(138,123,114,0.08);border-radius:8px;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0}
.bt{display:flex;flex-direction:column;align-items:center;padding-top:10px;border-top:1px solid rgba(138,123,114,0.15);gap:4px}
.lg{display:flex;align-items:center;gap:14px;flex-shrink:0}
.li{display:flex;align-items:center;gap:5px;font-size:9px;color:#8a7b72;letter-spacing:1px;white-space:nowrap}
.ld{width:6px;height:6px;border-radius:2px;flex-shrink:0}
.ft{font-size:8px;color:#5a4b42;letter-spacing:1px;white-space:nowrap;text-align:center}
@keyframes pulse-border{0%,100%{border-color:rgba(240,194,127,0.6)}50%{border-color:rgba(240,194,127,0.95)}}
@media(prefers-reduced-motion:reduce){.shooting{animation:none}}
</style>
</head><body>
<div class="hd">
  <div class="co">${loc.display}  //  ${latStr}  ${lonStr}</div>
  <h1>GOLDEN HOUR</h1>
  <div class="dt">${dateStr}</div>
</div>
${statusHTML}
<div>
  <div class="tb">${tlHTML}</div>
  <div class="tl"><span>5 AM</span><span>9 AM</span><span>1 PM</span><span>5 PM</span><span>9 PM</span></div>
</div>
<div class="main">
  <div class="col">${morningCol}</div>
  <div class="col">${eveningCol}</div>
</div>
<div class="bt">
  <div class="lg">
    <div class="li"><div class="ld" style="background:#4a6fa5"></div>Blue</div>
    <div class="li"><div class="ld" style="background:#f0c27f"></div>Golden AM</div>
    <div class="li"><div class="ld" style="background:#e8a87c"></div>Golden PM</div>
  </div>
  <div class="ft">Golden Hour: -4\u00b0 to +6\u00b0</div>
  <div class="ft">Blue Hour: -6\u00b0 to -4\u00b0</div>
  <div class="ft">Cloud Data: Open-Meteo</div>
</div>
</body></html>`;
}

// ── Run ─────────────────────────────────────────────────
const loc = await getLocation();
const hourly = await fetchCloudCover(loc.lat, loc.lon);

if (config.runsInWidget) {
  const family = config.widgetFamily;
  let w;
  if (family === "small") {
    w = await createSmallWidget(loc, hourly);
  } else {
    w = await createWidget(loc, hourly);
  }
  Script.setWidget(w);
  Script.complete();
} else {
  await WebView.loadHTML(getFullHTML(loc, hourly), null, null, true);
}
