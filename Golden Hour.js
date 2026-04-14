// Variables used by Scriptable.
// These must be at the very top of the file.
// icon-color: orange; icon-glyph: sun;

// ─────────────────────────────────────────────────────────
//  GOLDEN HOUR
// ─────────────────────────────────────────────────────────
//  Widget parameter:  city name  (e.g. "Chicago")
//  No parameter:      uses your GPS location
//  Tap widget:        opens full visual
// ─────────────────────────────────────────────────────────

const FALLBACK_CITY = "Chicago";
const CACHE_KEY     = "golden_hour_geo_cache";

// ── Geocode ─────────────────────────────────────────────
async function geocodeCity(city) {
  const fm = FileManager.iCloud();
  const cacheDir = fm.documentsDirectory();
  const cachePath = fm.joinPath(cacheDir, CACHE_KEY + ".json");

  // Check cache
  if (fm.fileExists(cachePath)) {
    await fm.downloadFileFromiCloud(cachePath);
    try {
      const cached = JSON.parse(fm.readString(cachePath));
      if (cached.city.toLowerCase() === city.toLowerCase()) {
        return cached;
      }
    } catch (e) {}
  }

  // Nominatim geocode (free, no API key)
  const encoded = encodeURIComponent(city);
  const url = "https://nominatim.openstreetmap.org/search?q="
              + encoded + "&format=json&limit=1";
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

  // Cache result
  fm.writeString(cachePath, JSON.stringify(result));
  return result;
}

async function getGPSLocation() {
  Location.setAccuracyToKilometer();
  const loc = await Location.current();
  const geo = await Location.reverseGeocode(loc.latitude, loc.longitude);
  const city = (geo && geo[0])
    ? (geo[0].city || geo[0].locality || "Here")
    : "Here";
  return {
    city: city,
    display: city,
    lat: loc.latitude,
    lon: loc.longitude,
  };
}

async function getLocation() {
  const param = (args.widgetParameter || "").trim();

  // Widget with param --> geocode that city
  if (param.length > 0) {
    const result = await geocodeCity(param);
    if (result) return result;
  }

  // In-app --> prompt for city
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

  // Widget with no param --> GPS
  return await getGPSLocation();
}

// ── Solar Calc ──────────────────────────────────────────
function calcSunEvent(lat, lon, doy, angleDeg, isRise) {
  const lngHour = lon / 15;
  const t = isRise
    ? doy + (6 - lngHour) / 24
    : doy + (18 - lngHour) / 24;

  const M = (0.9856 * t) - 3.289;
  let L = M + 1.916 * Math.sin(M * Math.PI / 180)
            + 0.020 * Math.sin(2 * M * Math.PI / 180) + 282.634;
  L = ((L % 360) + 360) % 360;

  let RA = Math.atan(0.91764 * Math.tan(L * Math.PI / 180)) * 180 / Math.PI;
  RA = ((RA % 360) + 360) % 360;
  RA += Math.floor(L / 90) * 90 - Math.floor(RA / 90) * 90;
  RA /= 15;

  const sinDec = 0.39782 * Math.sin(L * Math.PI / 180);
  const cosDec = Math.cos(Math.asin(sinDec));
  const latR = lat * Math.PI / 180;

  const cosH = (Math.sin(angleDeg * Math.PI / 180) - Math.sin(latR) * sinDec)
               / (Math.cos(latR) * cosDec);
  if (cosH > 1 || cosH < -1) return null;

  let H = Math.acos(cosH) * 180 / Math.PI;
  if (isRise) H = 360 - H;
  H /= 15;

  const T = H + RA - 0.06571 * t - 6.622;
  return ((T - lngHour) % 24 + 24) % 24;
}

function utcToLocal(utcH) {
  const off = new Date().getTimezoneOffset();
  let local = utcH - off / 60;
  if (local < 0) local += 24;
  if (local >= 24) local -= 24;
  return local;
}

function hToMin(h) { return Math.round(h * 60); }

function fmtTime(m) {
  let h = Math.floor(m / 60);
  const mn = m % 60;
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return h + ":" + String(mn).padStart(2, "0") + " " + ap;
}

function getTimes(lat, lon) {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const doy = Math.floor((now - start) / 86400000);

  const angles = [
    { key: "civil",   deg: -6.0 },
    { key: "goldenL", deg: -4.0 },
    { key: "sun",     deg: -0.833 },
    { key: "goldenH", deg:  6.0 },
  ];

  const ev = {};
  for (const a of angles) {
    const rise = calcSunEvent(lat, lon, doy, a.deg, true);
    const set  = calcSunEvent(lat, lon, doy, a.deg, false);
    if (rise === null || set === null) return null;
    ev[a.key + "_rise"] = hToMin(utcToLocal(rise));
    ev[a.key + "_set"]  = hToMin(utcToLocal(set));
  }

  return {
    blue_am:   { start: ev.civil_rise,   end: ev.goldenL_rise },
    golden_am: { start: ev.goldenL_rise, end: ev.goldenH_rise },
    sunrise:   ev.sun_rise,
    golden_pm: { start: ev.goldenH_set,  end: ev.goldenL_set },
    sunset:    ev.sun_set,
    blue_pm:   { start: ev.goldenL_set,  end: ev.civil_set },
  };
}

// ── Draw Timeline Bar ───────────────────────────────────
function drawTimeline(t, nowMin, width, height) {
  const dc = new DrawContext();
  dc.size = new Size(width, height);
  dc.opaque = false;
  dc.respectScreenScale = true;

  const DS = 300, DE = 1260, DR = DE - DS;
  function x(m) { return ((m - DS) / DR) * width; }

  // Track background
  const bg = new Path();
  bg.addRoundedRect(new Rect(0, 0, width, height), 4, 4);
  dc.addPath(bg);
  dc.setFillColor(new Color("#1e1520"));
  dc.fillPath();

  // Segments
  const segs = [
    { s: t.blue_am.start,   e: t.blue_am.end,   c: "#4a6fa5" },
    { s: t.golden_am.start, e: t.golden_am.end,  c: "#f0c27f" },
    { s: t.golden_pm.start, e: t.golden_pm.end,  c: "#e8a87c" },
    { s: t.blue_pm.start,   e: t.blue_pm.end,    c: "#4a6fa5" },
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

  // NOW marker
  const np = x(nowMin);
  if (np >= 0 && np <= width) {
    const marker = new Path();
    marker.addRoundedRect(new Rect(np - 1, 0, 3, height), 1, 1);
    dc.addPath(marker);
    dc.setFillColor(new Color("#ffffff"));
    dc.fillPath();

    // Glow
    const glow = new Path();
    glow.addRoundedRect(new Rect(np - 3, 0, 7, height), 2, 2);
    dc.addPath(glow);
    dc.setFillColor(new Color("#ffffff", 0.2));
    dc.fillPath();
  }

  // Time labels
  dc.setFont(Font.lightMonospacedSystemFont(7));
  dc.setTextColor(new Color("#6a5b52"));
  const labels = [
    { m: 360,  t: "6a" },
    { m: 720,  t: "12p" },
    { m: 1080, t: "6p" },
  ];
  for (const l of labels) {
    const lx = x(l.m);
    dc.drawTextInRect(l.t, new Rect(lx - 8, height + 1, 20, 10));
  }

  return dc.getImage();
}

// ── Widget Row Helper ───────────────────────────────────
function addTimeRow(stack, icon, label, startMin, endMin, color, active) {
  const row = stack.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();
  row.setPadding(5, 8, 5, 8);
  row.cornerRadius = 6;

  if (active) {
    row.backgroundColor = new Color(color, 0.15);
    row.borderColor = new Color(color, 0.4);
    row.borderWidth = 1;
  } else {
    row.backgroundColor = new Color("#1e1520", 0.6);
  }

  // Icon
  const ico = row.addText(icon);
  ico.font = Font.boldMonospacedSystemFont(12);
  ico.textColor = new Color(color);
  row.addSpacer(6);

  // Label + times
  const info = row.addStack();
  info.layoutVertically();

  const lbl = info.addText(label);
  lbl.font = Font.mediumMonospacedSystemFont(10);
  lbl.textColor = new Color(color);
  lbl.lineLimit = 1;

  const times = info.addText(fmtTime(startMin) + " - " + fmtTime(endMin));
  times.font = Font.lightMonospacedSystemFont(9);
  times.textColor = new Color("#8a7b72");
  times.lineLimit = 1;

  row.addSpacer();

  // Duration
  const dur = endMin - startMin;
  const durText = row.addText(dur + "m");
  durText.font = Font.mediumMonospacedSystemFont(9);
  durText.textColor = new Color(color, 0.7);
}

// ── Widget ──────────────────────────────────────────────
async function createWidget(loc) {
  const t = getTimes(loc.lat, loc.lon);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const w = new ListWidget();
  w.backgroundColor = new Color("#1a1218");
  w.setPadding(12, 14, 12, 14);

  // ── Header ──
  const title = w.addText("GOLDEN HOUR");
  title.font = Font.boldMonospacedSystemFont(12);
  title.textColor = new Color("#f0c27f");
  title.centerAlignText();

  const locText = w.addText(loc.display);
  locText.font = Font.lightMonospacedSystemFont(8);
  locText.textColor = new Color("#8a7b72");
  locText.centerAlignText();

  w.addSpacer(6);

  if (!t) {
    const err = w.addText("No data");
    err.font = Font.lightMonospacedSystemFont(11);
    err.textColor = new Color("#8a7b72");
    return w;
  }

  const inBlueAM   = nowMin >= t.blue_am.start   && nowMin <= t.blue_am.end;
  const inGoldenAM = nowMin >= t.golden_am.start  && nowMin <= t.golden_am.end;
  const inGoldenPM = nowMin >= t.golden_pm.start  && nowMin <= t.golden_pm.end;
  const inBluePM   = nowMin >= t.blue_pm.start    && nowMin <= t.blue_pm.end;
  const shooting   = inBlueAM || inGoldenAM || inGoldenPM || inBluePM;

  // ── Status Badge ──
  const statusRow = w.addStack();
  statusRow.layoutHorizontally();
  statusRow.addSpacer();
  const badge = statusRow.addStack();
  badge.setPadding(4, 12, 4, 12);
  badge.cornerRadius = 5;

  if (shooting) {
    badge.backgroundColor = new Color("#f0c27f", 0.12);
    badge.borderColor = new Color("#f0c27f", 0.3);
    badge.borderWidth = 1;
    const bt = badge.addText("* SHOOTING NOW *");
    bt.font = Font.boldMonospacedSystemFont(9);
    bt.textColor = new Color("#f0c27f");
  } else {
    const events = [
      { min: t.blue_am.start,   label: "AM Blue" },
      { min: t.golden_am.start, label: "AM Gold" },
      { min: t.golden_pm.start, label: "PM Gold" },
      { min: t.blue_pm.start,   label: "PM Blue" },
    ];
    let nextLabel = null;
    let nextTxt = null;
    for (const e of events) {
      if (nowMin < e.min) {
        const diff = e.min - nowMin;
        const h = Math.floor(diff / 60);
        const m = diff % 60;
        nextTxt = h > 0 ? h+"h "+m+"m" : m+"m";
        nextLabel = e.label;
        break;
      }
    }

    if (nextLabel) {
      badge.backgroundColor = new Color("#8a7b72", 0.1);
      badge.borderColor = new Color("#8a7b72", 0.2);
      badge.borderWidth = 1;
      const bt = badge.addText(">> " + nextLabel + " in " + nextTxt);
      bt.font = Font.mediumMonospacedSystemFont(9);
      bt.textColor = new Color("#d4a574");
    } else {
      badge.backgroundColor = new Color("#8a7b72", 0.08);
      const bt = badge.addText("Done for today");
      bt.font = Font.lightMonospacedSystemFont(9);
      bt.textColor = new Color("#8a7b72");
    }
  }
  statusRow.addSpacer();

  w.addSpacer(6);

  // ── Timeline Bar ──
  const tlImg = drawTimeline(t, nowMin, 600, 24);
  const tlRow = w.addStack();
  tlRow.addSpacer();
  const imgWidget = tlRow.addImage(tlImg);
  imgWidget.imageSize = new Size(300, 16);
  tlRow.addSpacer();

  w.addSpacer(8);

  // ── AM / PM Columns ──
  const body = w.addStack();
  body.layoutHorizontally();
  body.spacing = 8;

  // AM column
  const amCol = body.addStack();
  amCol.layoutVertically();
  amCol.spacing = 4;

  const amHead = amCol.addText("  MORNING");
  amHead.font = Font.lightMonospacedSystemFont(7);
  amHead.textColor = new Color("#8a7b72");

  addTimeRow(amCol, "*", "Golden", t.golden_am.start, t.golden_am.end, "#f0c27f", inGoldenAM);
  addTimeRow(amCol, "~", "Blue",   t.blue_am.start,   t.blue_am.end,   "#4a6fa5", inBlueAM);

  // PM column
  const pmCol = body.addStack();
  pmCol.layoutVertically();
  pmCol.spacing = 4;

  const pmHead = pmCol.addText("  EVENING");
  pmHead.font = Font.lightMonospacedSystemFont(7);
  pmHead.textColor = new Color("#8a7b72");

  addTimeRow(pmCol, "*", "Golden", t.golden_pm.start, t.golden_pm.end, "#e8a87c", inGoldenPM);
  addTimeRow(pmCol, "~", "Blue",   t.blue_pm.start,   t.blue_pm.end,   "#4a6fa5", inBluePM);

  return w;
}

// ── Full Visual ─────────────────────────────────────────
function getFullHTML(loc) {
  const t = getTimes(loc.lat, loc.lon);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric"
  });

  const latStr = Math.abs(loc.lat).toFixed(2) + (loc.lat >= 0 ? "N" : "S");
  const lonStr = Math.abs(loc.lon).toFixed(2) + (loc.lon >= 0 ? "E" : "W");

  if (!t) return "<html><body style='background:#1a1218;color:#e8d5c4;font-family:monospace;padding:40px'><p>No sunrise/sunset data</p></body></html>";

  const inBlueAM   = nowMin >= t.blue_am.start   && nowMin <= t.blue_am.end;
  const inGoldenAM = nowMin >= t.golden_am.start  && nowMin <= t.golden_am.end;
  const inGoldenPM = nowMin >= t.golden_pm.start  && nowMin <= t.golden_pm.end;
  const inBluePM   = nowMin >= t.blue_pm.start    && nowMin <= t.blue_pm.end;
  const shooting   = inBlueAM || inGoldenAM || inGoldenPM || inBluePM;

  let statusHTML = "";
  if (shooting) {
    statusHTML = '<div class="status shooting"><div class="st">* * *  SHOOTING NOW  * * *</div></div>';
  } else {
    const events = [
      { min: t.blue_am.start,   label: "Morning Blue Hour" },
      { min: t.golden_am.start, label: "Morning Golden Hour" },
      { min: t.golden_pm.start, label: "Evening Golden Hour" },
      { min: t.blue_pm.start,   label: "Evening Blue Hour" },
    ];
    let found = false;
    for (const e of events) {
      if (nowMin < e.min) {
        const diff = e.min - nowMin;
        const h = Math.floor(diff / 60);
        const m = diff % 60;
        const txt = h > 0 ? h+"h "+m+"m" : m+"m";
        statusHTML = '<div class="status waiting"><div class="sl">NEXT UP</div><div class="st">'+e.label+'  --  '+txt+'</div></div>';
        found = true;
        break;
      }
    }
    if (!found) {
      statusHTML = '<div class="status done"><div class="st" style="color:#8a7b72">Done for today -- see you tomorrow</div></div>';
    }
  }

  const DS = 300, DE = 1260, DR = DE - DS;
  function pct(m) { return ((m - DS) / DR) * 100; }

  const segs = [
    { s: t.blue_am.start,   e: t.blue_am.end,   bg: "linear-gradient(180deg,#4a6fa5,#2d4a7a)", a: inBlueAM },
    { s: t.golden_am.start, e: t.golden_am.end,  bg: "linear-gradient(180deg,#f0c27f,#d4a054)", a: inGoldenAM },
    { s: t.golden_am.end,   e: t.golden_pm.start,bg: "rgba(232,213,196,0.06)", a: false },
    { s: t.golden_pm.start, e: t.golden_pm.end,  bg: "linear-gradient(180deg,#e8a87c,#c4784a)", a: inGoldenPM },
    { s: t.blue_pm.start,   e: t.blue_pm.end,    bg: "linear-gradient(180deg,#4a6fa5,#2d4a7a)", a: inBluePM },
  ];

  let tlHTML = "";
  for (const s of segs) {
    tlHTML += '<div style="position:absolute;left:'+pct(s.s)+'%;width:'+(pct(s.e)-pct(s.s))+'%;height:100%;background:'+s.bg+';opacity:'+(s.a?1:0.6)+'"></div>';
  }
  const np = pct(nowMin);
  if (np >= 0 && np <= 100) {
    tlHTML += '<div style="position:absolute;left:'+np+'%;top:0;height:100%;width:2px;background:#f0f0f0;box-shadow:0 0 8px rgba(240,240,240,0.5);z-index:10"><div style="position:absolute;top:-16px;left:-10px;font-size:8px;color:#f0f0f0;letter-spacing:1px;font-weight:500">NOW</div></div>';
  }

  function rc(label, s, e, icon, color, active) {
    const dur = e - s;
    const bdr = active ? "border-color:"+color+";background:"+color+"18" : "";
    return '<div class="card" style="'+bdr+'"><div class="cl"><div class="ci" style="color:'+color+'">'+icon+'</div><div><div class="cn">'+label+'</div><div class="ct">'+fmtTime(s)+'  -->  '+fmtTime(e)+'</div></div></div><div class="cd" style="color:'+color+'">'+dur+' min</div></div>';
  }

  function pc(label, m, icon, color) {
    return '<div class="cp"><div class="cl"><div class="ci" style="color:'+color+';opacity:0.6">'+icon+'</div><div class="cn" style="color:#b8a89c">'+label+'</div></div><div style="font-size:12px;color:#b8a89c">'+fmtTime(m)+'</div></div>';
  }

  let ch = '<div class="sl2">MORNING</div>';
  ch += rc("Blue Hour",   t.blue_am.start,   t.blue_am.end,   "~", "#4a6fa5", inBlueAM);
  ch += rc("Golden Hour", t.golden_am.start, t.golden_am.end, "*", "#f0c27f", inGoldenAM);
  ch += pc("Sunrise",     t.sunrise, "^", "#e8a87c");
  ch += '<div class="sl2" style="margin-top:20px">EVENING</div>';
  ch += rc("Golden Hour", t.golden_pm.start, t.golden_pm.end, "*", "#e8a87c", inGoldenPM);
  ch += pc("Sunset",      t.sunset, "v", "#c4784a");
  ch += rc("Blue Hour",   t.blue_pm.start,   t.blue_pm.end,   "~", "#4a6fa5", inBluePM);

  return `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,'SF Mono',monospace;background:linear-gradient(175deg,#1a1218,#2d1b2e 30%,#1e1520);color:#e8d5c4;padding:48px 24px 40px;min-height:100vh}
.hd{text-align:center;margin-bottom:40px}
.co{font-size:10px;letter-spacing:5px;color:#c4784a;text-transform:uppercase;font-weight:300;margin-bottom:8px}
h1{font-size:26px;font-weight:700;letter-spacing:2px;background:linear-gradient(90deg,#f0c27f,#e8a87c,#d4a054);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px}
.dt{font-size:11px;color:#8a7b72;font-weight:300;letter-spacing:1px}
.status{text-align:center;margin-bottom:32px;padding:14px 18px;border-radius:8px}
.shooting{background:rgba(240,194,127,0.12);border:1px solid rgba(240,194,127,0.3)}
.waiting{background:rgba(138,123,114,0.1);border:1px solid rgba(138,123,114,0.2)}
.done{background:rgba(138,123,114,0.08);border:1px solid rgba(138,123,114,0.15)}
.sl{font-size:10px;color:#8a7b72;letter-spacing:2px;margin-bottom:4px}
.st{font-size:13px;font-weight:500;color:#d4a574;letter-spacing:1px}
.shooting .st{color:#f0c27f;letter-spacing:3px}
.tb{position:relative;height:36px;background:rgba(30,21,32,0.6);border-radius:6px;overflow:hidden;border:1px solid rgba(138,123,114,0.12);margin-bottom:6px}
.tl{display:flex;justify-content:space-between;font-size:9px;color:#6a5b52;letter-spacing:1px;margin-bottom:40px}
.sl2{font-size:10px;letter-spacing:3px;color:#8a7b72;margin-bottom:12px;margin-top:8px}
.cards{display:flex;flex-direction:column;gap:12px}
.card{background:rgba(30,21,32,0.4);border:1px solid rgba(138,123,114,0.12);border-radius:8px;padding:14px 16px;display:flex;align-items:center;justify-content:space-between}
.cl{display:flex;align-items:center;gap:12px}
.ci{width:30px;height:30px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700}
.cn{font-size:13px;font-weight:500;letter-spacing:1px}
.ct{font-size:10px;color:#8a7b72;margin-top:3px;letter-spacing:.5px}
.cd{font-size:11px;font-weight:500;letter-spacing:1px}
.cp{background:rgba(30,21,32,0.25);border:1px solid rgba(138,123,114,0.08);border-radius:8px;padding:10px 16px;display:flex;align-items:center;justify-content:space-between}
.cp .cl{gap:12px}
.lg{margin-top:36px;padding-top:16px;border-top:1px solid rgba(138,123,114,0.15);display:flex;gap:20px;justify-content:center;flex-wrap:wrap}
.li{display:flex;align-items:center;gap:7px;font-size:9px;color:#8a7b72;letter-spacing:1px}
.ld{width:7px;height:7px;border-radius:2px}
.ft{text-align:center;margin-top:20px;font-size:9px;color:#5a4b42;letter-spacing:1px;line-height:2}
</style>
</head><body>
<div class="hd">
  <div class="co">${loc.display}  //  ${latStr}  ${lonStr}</div>
  <h1>GOLDEN HOUR</h1>
  <div class="dt">${dateStr}</div>
</div>
${statusHTML}
<div class="tb">${tlHTML}</div>
<div class="tl"><span>5 AM</span><span>9 AM</span><span>1 PM</span><span>5 PM</span><span>9 PM</span></div>
<div class="cards">${ch}</div>
<div class="lg">
  <div class="li"><div class="ld" style="background:#4a6fa5"></div>Blue</div>
  <div class="li"><div class="ld" style="background:#f0c27f"></div>Golden AM</div>
  <div class="li"><div class="ld" style="background:#e8a87c"></div>Golden PM</div>
</div>
<div class="ft">Sun angles:  Golden = -4 to 6 deg  |  Blue = -6 to -4 deg</div>
</body></html>`;
}

// ── Run ─────────────────────────────────────────────────
const loc = await getLocation();

if (config.runsInWidget) {
  const w = await createWidget(loc);
  Script.setWidget(w);
  Script.complete();
} else {
  await WebView.loadHTML(getFullHTML(loc), null, null, true);
}
