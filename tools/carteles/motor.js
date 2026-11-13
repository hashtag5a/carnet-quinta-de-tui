// Motor de carteles de A Quinta (copiado del generador A Quinta Calendarios, src/posters). No editar a mano.

// src/posters/draw.js
var COL = { bg: "#0c0c0c", white: "#ffffff", slate: "#4E5A6B", rule: "#6E7C90", rule2: "rgba(110,124,144,0.45)", muted: "#8C98A8", soft: "#C3CBD6", gold: "#C9B37E" };
var FONT = { marker: '"Permanent Marker", cursive', oswald: 'Oswald, "Arial Narrow", sans-serif', brush: '"Caveat Brush", cursive' };
async function loadFonts() {
  if (!document.fonts?.load) return;
  const specs = ['400 40px "Permanent Marker"', "500 40px Oswald", "600 40px Oswald", "700 40px Oswald", '400 40px "Caveat Brush"'];
  await Promise.all(specs.map((f) => document.fonts.load(f).catch(() => null)));
}
function loadImage(url) {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = url;
  });
}
function makeCanvas(W, H) {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  return c;
}
function grunge(ctx, W, H, { overlay = false } = {}) {
  if (!overlay) {
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);
  }
  const g = ctx.createRadialGradient(W / 2, 0, 10, W / 2, 0, Math.max(W, H) * 0.75);
  g.addColorStop(0, "#2a2a2a");
  g.addColorStop(1, "rgba(12,12,12,0)");
  if (!overlay) {
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-58 * Math.PI / 180);
  const D = Math.hypot(W, H);
  ctx.fillStyle = "rgba(255,255,255,0.035)";
  for (let x = -D; x < D; x += 26) ctx.fillRect(x, -D, 3, 2 * D);
  ctx.fillStyle = "rgba(255,255,255,0.025)";
  for (let x = -D; x < D; x += 190) ctx.fillRect(x, -D, 70, 2 * D);
  ctx.restore();
  let seed = 7;
  const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let i = 0; i < W * H / 900; i++) ctx.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2);
}
function backdrop(ctx, W, H, bg) {
  if (!bg?.img && !bg?.imgFeed) return;
  const feed = W / H > 0.7;
  const img = feed && bg.imgFeed || bg.img || bg.imgFeed;
  const r = Math.max(W / img.width, H / img.height);
  const w = img.width * r, h = img.height * r;
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
  const dim = Math.min(0.9, Math.max(0, bg.dim ?? 0.5));
  ctx.fillStyle = `rgba(12,12,12,${dim})`;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, `rgba(12,12,12,${dim * 0.35})`);
  g.addColorStop(1, "rgba(12,12,12,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  grunge(ctx, W, H, { overlay: true });
}
function setFont(ctx, { size, weight = 400, family = FONT.oswald, ls = 0 }) {
  ctx.font = `${weight} ${Math.round(size)}px ${family}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${ls}px`;
}
function measure(ctx, str, opts) {
  setFont(ctx, opts);
  return ctx.measureText(str).width;
}
function text(ctx, str, x, y, { size, weight, family, ls = 0, color = COL.white, align = "center", baseline = "alphabetic", rotate = 0, underline = 0, shadow = null } = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (rotate) ctx.rotate(rotate * Math.PI / 180);
  setFont(ctx, { size, weight, family, ls });
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if (shadow) {
    ctx.fillStyle = shadow.color;
    ctx.fillText(str, shadow.dx, shadow.dy);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, 0, 0);
  if (underline) {
    const w = ctx.measureText(str).width;
    const x0 = align === "center" ? -w / 2 : align === "right" ? -w : 0;
    ctx.fillRect(x0, size * 0.22, w, underline);
  }
  ctx.restore();
}
function wrap(ctx, str, maxW, { size, minSize = size * 0.6, maxLines = 2, weight, family, ls = 0 }) {
  if (size < 8) return { lines: [String(str)], size: 8 };
  const words = String(str).split(/\s+/).filter(Boolean);
  for (let s2 = size; s2 >= minSize; s2 -= 1) {
    setFont(ctx, { size: s2, weight, family, ls });
    const lines = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(next).width <= maxW) cur = next;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) return { lines, size: s2 };
  }
  setFont(ctx, { size: minSize, weight, family, ls });
  let s = words.join(" ");
  while (s.length > 3 && ctx.measureText(`${s}\u2026`).width > maxW * maxLines) s = s.slice(0, -1);
  return wrap(ctx, `${s}\u2026`, maxW, { size: minSize, minSize: minSize - 1, maxLines, weight, family, ls });
}
function textLines(ctx, lines, x, yTop, { size, lineHeight = 1.05, ...o }) {
  lines.forEach((l, i) => text(ctx, l, x, yTop + size * 0.82 + i * size * lineHeight, { size, ...o }));
  return lines.length * size * lineHeight;
}
function fitSize(ctx, str, maxW, { size, minSize = 12, ...o }) {
  for (let s = size; s > minSize; s -= 1) if (measure(ctx, str, { size: s, ...o }) <= maxW) return s;
  return minSize;
}
var BRUSH = [[3, 18], [12, 6], [40, 12], [70, 2], [97, 10], [100, 40], [96, 72], [100, 92], [70, 86], [38, 98], [10, 90], [0, 70], [4, 45]];
function brush(ctx, cx, cy, w, h, color, rotate = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotate * Math.PI / 180);
  ctx.beginPath();
  BRUSH.forEach(([px, py], i) => ctx[i ? "lineTo" : "moveTo"](-w / 2 + px / 100 * w, -h / 2 + py / 100 * h));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}
function rule(ctx, x0, x1, y, k = 1) {
  ctx.fillStyle = COL.rule;
  ctx.fillRect(x0, y, x1 - x0, 2 * k);
  ctx.fillStyle = COL.rule2;
  ctx.fillRect(x0, y + 4 * k, x1 - x0, 2 * k);
}
var ICONS = {
  calendar: { vb: 24, stroke: ["M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z", "M3 10h18M8 3v4M16 3v4M7 14h2M11 14h2M15 14h2M7 17h2M11 17h2"] },
  clock: { vb: 24, stroke: ["M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18Z", "M12 7v5l3 2"] },
  pin: { vb: 22, fill: "M9 1C4.6 1 1 4.5 1 8.8 1 14.6 9 21 9 21s8-6.4 8-12.2C17 4.5 13.4 1 9 1Z", hole: [9, 9, 3] }
};
function icon(ctx, name, cx, cy, size, color = COL.white, holeColor = COL.bg) {
  const ic = ICONS[name];
  ctx.save();
  const k = size / ic.vb;
  ctx.translate(cx - size / 2 + (name === "pin" ? size * 0.09 : 0), cy - size / 2);
  ctx.scale(k, k);
  if (ic.stroke) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const d2 of ic.stroke) ctx.stroke(new Path2D(d2));
  } else {
    ctx.fillStyle = color;
    ctx.fill(new Path2D(ic.fill));
    ctx.fillStyle = holeColor;
    ctx.beginPath();
    ctx.arc(ic.hole[0], ic.hole[1], ic.hole[2], 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
var SHIELD = "M10 10 H122 V86 C122 120 96 138 66 146 C36 138 10 120 10 86 Z";
function crest(ctx, img, cx, cy, size, { us = false, initials: initials2 = "?" } = {}) {
  if (img) {
    const r = Math.min(size / img.width, size / img.height);
    const w = img.width * r, h = img.height * r;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
    return;
  }
  if (us) {
    ctx.save();
    const k = size / 150;
    ctx.translate(cx - 66 * k, cy - 75 * k);
    ctx.scale(k, k);
    const p = new Path2D(SHIELD);
    ctx.fillStyle = "#111";
    ctx.fill(p);
    ctx.strokeStyle = COL.gold;
    ctx.lineWidth = 5;
    ctx.stroke(p);
    ctx.restore();
    text(ctx, "AQ", cx, cy + size * 0.16, { size: size * 0.3, family: FONT.marker });
    return;
  }
  ctx.save();
  ctx.setLineDash([size * 0.06, size * 0.05]);
  ctx.strokeStyle = COL.muted;
  ctx.lineWidth = Math.max(2, size * 0.03);
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.46, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  text(ctx, initials2, cx, cy + size * 0.1, { size: size * 0.28, family: FONT.marker, color: COL.muted });
}

// src/importer/normalize.js
function normalize(v = "") {
  return String(v ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}
function compact(v = "") {
  return normalize(v).replace(/[^a-z0-9]/g, "");
}
function cleanField(v = "") {
  return String(v ?? "").replace(/[|¦]/g, " ").replace(/[“”„«»″]/g, '"').replace(/[‘’´`′]/g, "'").replace(/["'°º*]\s*([ABC])\s*["'°º*]/g, '"$1"').replace(/(^|\s)[FE]\.?S\.(?=\s|$|-|")/g, "$1F.S.").replace(/[‐‑‒–—―−~]/g, "-").replace(/\s+/g, " ").trim();
}
function levenshtein(a, b) {
  a = String(a);
  b = String(b);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}
var AGES = [
  ["prebenjamin", "Prebenjam\xEDn", ["prebenjamin", "prebenxamin"]],
  ["benjamin", "Benjam\xEDn", ["benjamin", "benxamin"]],
  ["alevin", "Alev\xEDn", ["alevin"]],
  ["infantil", "Infantil", ["infantil"]],
  ["cadete", "Cadete", ["cadete"]],
  ["juvenil", "Juvenil", ["juvenil", "xuvenil"]],
  ["senior", "Senior", ["senior"]],
  ["veteranos", "Veteranos", ["veteranos"]],
  ["femenino", "Femenino", ["femenino", "feminino"]]
];
var LEVELS = [
  ["preferente", "Preferente", ["preferente"]],
  ["primera", "Primera", ["primera", "primeira"]],
  ["segunda", "Segunda", ["segunda"]],
  ["tercera", "Tercera", ["tercera", "terceira"]],
  ["liga local", "Liga Local", ["local"]]
];
function detectFrom(table, text2) {
  const words = normalize(text2).split(/[^a-z0-9]+/).filter(Boolean);
  for (const [key, label, variants] of table) {
    for (const v of variants) {
      const tol = v.length >= 8 ? 2 : v.length >= 5 ? 1 : 0;
      if (words.some((w) => Math.abs(w.length - v.length) <= tol && levenshtein(w, v) <= tol)) return { key, label };
    }
  }
  return null;
}
function parseCategory(text2 = "") {
  const age = detectFrom(AGES, text2);
  if (!age) return null;
  const level = detectFrom(LEVELS, text2);
  const n = normalize(text2).replace(/[gc]r[uv]p[o0]/g, "grupo");
  const g = n.match(/grupo\s*[.:nº°o]*\s*(\d{1,2})\b/) || n.match(/\bg\s*(\d{1,2})\b/);
  const group = g ? Number(g[1]) : null;
  const label = [age.label, level?.label, group ? `Grupo ${group}` : ""].filter(Boolean).join(" ");
  return { age: age.key, level: level?.key || "", group, label, key: normalize(label) };
}

// src/posters/model.js
var GL_DAYS = ["DOMINGO", "LUNS", "MARTES", "M\xC9RCORES", "XOVES", "VENRES", "S\xC1BADO"];
var GL_MONTHS = ["XANEIRO", "FEBREIRO", "MARZO", "ABRIL", "MAIO", "XU\xD1O", "XULLO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DECEMBRO"];
var LEVEL_SHORT = { preferente: "PREF.", primera: "1\xAA", segunda: "2\xAA", tercera: "3\xAA", "liga local": "LOCAL" };
var d = (iso) => /* @__PURE__ */ new Date(`${iso}T12:00:00Z`);
var dayMonth = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
var dayLabel = (iso) => `${GL_DAYS[d(iso).getUTCDay()]} ${dayMonth(iso)}`;
function variantLetter(name = "") {
  const m = cleanField(name).match(/["'°*]\s*([A-C])\s*["'°*]?\s*$/);
  return m ? m[1] : "";
}
function shortOpponent(name = "") {
  const s = cleanField(name);
  const base = s.split(/\s+-\s*|\s*-\s+/)[0].trim();
  const v = variantLetter(s);
  const baseV = variantLetter(base);
  return v && !baseV ? `${base} "${v}"` : base;
}
function shortVenue(v = "") {
  return cleanField(v).replace(/^Pabell[oó]n\s+Municipal\s+(de\s+)?/i, "P. M. ").replace(/^Pabell[oó]n\s+(Polideportivo\s+)?/i, "P. ").replace(/^Polideportivo\s+(Municipal\s+)?/i, "Polid. ").replace(/\b(?:IES|CEIP|Colexio|Colegio)\s+/i, "").trim();
}
var STOP = /* @__PURE__ */ new Set(["club", "futbol", "sala", "futsal", "fs", "f", "s", "cd", "sd", "ad", "cf", "ud", "sc", "cdf", "edm", "de", "del", "da", "do", "la", "el", "los", "las", "a", "o", "y", "e"]);
var tokens = (s) => normalize(shortOpponent(s).replace(/["'][A-C]["']/g, " ")).split(/[^a-z0-9]+/).filter((t) => t && (t.length > 1 || /\d/.test(t)) && !STOP.has(t));
function matchCrest(name, crests = []) {
  const target = tokens(name);
  if (!target.length) return null;
  const tc = compact(shortOpponent(name).replace(/["'][A-C]["']/g, ""));
  let best = null, bestScore = 0;
  for (const c of crests) {
    if (c.is_own) continue;
    for (const n of [c.name, ...c.aliases || []].filter(Boolean)) {
      if (compact(n) === tc) return c;
      const ct = tokens(n);
      if (!ct.length) continue;
      const inter = ct.filter((t) => target.includes(t)).length;
      const score = inter === Math.min(ct.length, target.length) ? inter + inter / Math.max(ct.length, target.length) : 0;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
  }
  return best;
}
var initials = (name) => tokens(name).slice(0, 2).map((t) => t[0].toUpperCase()).join("") || "?";
function posterMatch(m, { teams = [], crests = [], logoUrl = () => "" } = {}) {
  const team = teams.find((t) => t.id === m.team_id) || {};
  const own = crests.find((c) => c.is_own);
  const v = variantLetter(team.name || "");
  const us = {
    us: true,
    name: `A QUINTA F.S.${v ? ` "${v}"` : ""}`,
    sponsor: team.sponsor || "",
    logo: logoUrl(team.logo_path || own?.logo_path || "")
  };
  const crest2 = m.opponent_logo_path ? null : matchCrest(m.opponent, crests);
  const them = {
    us: false,
    name: (crest2?.short_name || shortOpponent(m.opponent)).toUpperCase(),
    full: m.opponent,
    initials: initials(m.opponent),
    logo: logoUrl(m.opponent_logo_path || crest2?.logo_path || ""),
    crestFound: Boolean(m.opponent_logo_path || crest2)
  };
  const cat = parseCategory(m.group_name || team.category || "");
  const age = cat ? cat.label.split(" ")[0].toUpperCase() : (m.group_name || "").toUpperCase();
  return {
    id: m.id,
    date: m.match_date,
    time: String(m.match_time || "").slice(0, 5),
    venue: shortVenue(m.venue).toUpperCase(),
    venueFull: m.venue,
    round: m.round ?? null,
    cat,
    // Cinta de categoría: la edad (y la letra si A Quinta tiene varios equipos).
    ribbon: `${age}${v ? ` "${v}"` : ""}`,
    ribbonLong: `${age}${cat?.level ? ` ${LEVEL_SHORT[cat.level] || ""}` : ""}${v ? ` "${v}"` : ""}`.trim(),
    home: m.is_home ? us : them,
    away: m.is_home ? them : us
  };
}
function headerFor(pms) {
  if (!pms.length) return "";
  const lv = new Set(pms.map((p) => p.cat ? `${p.cat.level}|${p.cat.group}` : "?"));
  const rounds = new Set(pms.map((p) => p.round));
  const p0 = pms[0];
  if (lv.size === 1 && p0.cat?.level) {
    const level = p0.cat.label.split(" ").slice(1).join(" ").toUpperCase();
    const r = rounds.size === 1 && p0.round ? ` \xB7 XORNADA ${p0.round}` : "";
    if (level) return `${level}${r}`;
  }
  const dates = [...new Set(pms.map((p) => p.date))].sort();
  const months = [...new Set(dates.map((x) => GL_MONTHS[d(x).getUTCMonth()]))];
  const days = dates.map((x) => String(d(x).getUTCDate()));
  const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} E ${days[days.length - 1]}` : days[0];
  if (dates.length === 1) return `${GL_DAYS[d(dates[0]).getUTCDay()]} ${days[0]} DE ${months[0]}`;
  const span = (d(dates[dates.length - 1]) - d(dates[0])) / 864e5;
  if (dates.length > 1 && span <= 4 && months.length === 2)
    return `FIN DE SEMANA \xB7 ${days[0]} DE ${months[0]} \u2013 ${days[days.length - 1]} DE ${months[1]}`;
  return dates.length > 1 && dates.length <= 4 && months.length === 1 ? `FIN DE SEMANA \xB7 ${list} DE ${months[0]}` : `${dayMonth(dates[0])} \u2013 ${dayMonth(dates[dates.length - 1])}`;
}
var AGE_ORDER = ["prebenjamin", "benjamin", "alevin", "infantil", "cadete", "juvenil", "senior", "veteranos", "femenino"];
var ageRank = (p) => {
  const i = AGE_ORDER.indexOf(p.cat?.age);
  return i < 0 ? AGE_ORDER.length : i;
};
function posterOrder(a, b) {
  return a.date.localeCompare(b.date) || ageRank(a) - ageRank(b) || a.time.localeCompare(b.time);
}
function groupByDay(pms) {
  const map = /* @__PURE__ */ new Map();
  for (const p of [...pms].sort(posterOrder)) {
    if (!map.has(p.date)) map.set(p.date, []);
    map.get(p.date).push(p);
  }
  return [...map.entries()].map(([date, matches]) => ({ date, label: dayLabel(date), matches }));
}

// src/posters/quinta.js
var SIDE = 48;
function subtitle(ctx, cx, y, size) {
  const parts = ["COMPETICI\xD3N", "FORMACI\xD3N", "FUTURO"];
  const o = { size, weight: 500, ls: size * 0.25 };
  const gap = size * 0.8, sq = size * 0.33;
  const widths = parts.map((p) => measure(ctx, p, o));
  const total = widths.reduce((a, b) => a + b, 0) + gap * 2 * (parts.length - 1) + sq * (parts.length - 1);
  let x = cx - total / 2;
  parts.forEach((p, i) => {
    text(ctx, p, x, y, { ...o, align: "left" });
    x += widths[i];
    if (i < parts.length - 1) {
      ctx.fillStyle = COL.muted;
      ctx.fillRect(x + gap, y - size * 0.45, sq, sq);
      x += gap * 2 + sq;
    }
  });
}
function header(ctx, W, top, s, headerText, { stacked }) {
  const cx = W / 2, maxW = W - 2 * SIDE;
  const k = stacked ? 1.1 : 1;
  text(ctx, headerText, cx, top + 28 * s * k, { size: fitSize(ctx, headerText, maxW, { size: 27 * s * k, weight: 600, ls: 6 * s }), weight: 600, ls: 6 * s });
  const ts = fitSize(ctx, "A QUINTA F.S.", maxW, { size: 112 * s * k, family: FONT.marker });
  text(ctx, "A QUINTA F.S.", cx, top + 134 * s * k, { size: ts, family: FONT.marker, rotate: -2 });
  subtitle(ctx, cx, top + 182 * s * k, 24 * s * k);
  return top + 202 * s * k;
}
var HASHTAG = "#eusondeaquinta";
function footer(ctx, W, yBase, s) {
  const label = HASHTAG;
  const size = 58 * s;
  const w = measure(ctx, label, { size, family: FONT.marker });
  text(ctx, label, W / 2, yBase, { size, family: FONT.marker, rotate: -3, underline: 5 * s });
  ctx.fillStyle = COL.rule;
  ctx.fillRect(SIDE + 10, yBase - size * 0.3, W / 2 - w / 2 - SIDE - 40, 2);
  ctx.fillRect(W / 2 + w / 2 + 30, yBase - size * 0.3, W / 2 - w / 2 - SIDE - 40, 2);
}
function teamColumn(ctx, team, img, cx, top, h, colW, s) {
  const nameSize = 34 * s;
  const name = wrap(ctx, team.name, colW - 16, { size: nameSize, minSize: 22 * s, weight: 600 });
  const nameH = name.lines.length * name.size * 1.04;
  const size = Math.min(160 * s, h - nameH - 14 * s);
  const blockH = size + 10 * s + nameH;
  const y0 = top + (h - blockH) / 2;
  crest(ctx, img, cx, y0 + size / 2, size, team);
  textLines(ctx, name.lines, cx, y0 + size + 10 * s, { size: name.size, weight: 600, lineHeight: 1.04 });
}
function drawQuinta3(pms, imgs, { story = false, header: headerText, bg = null } = {}) {
  const W = 1080, H = story ? 1920 : 1350, s = story ? 1.15 : 1;
  const c = makeCanvas(W, H);
  const ctx = c.getContext("2d");
  grunge(ctx, W, H);
  backdrop(ctx, W, H, bg);
  const top = story ? 110 : 34;
  let y = header(ctx, W, top, s, headerText || headerFor(pms), { stacked: story });
  y += 18 * s;
  rule(ctx, SIDE, W - SIDE, y, 1);
  y += 18 * s;
  const footerY = H - (story ? 110 : 40);
  const areaH = footerY - 70 * s - y;
  const slotH = areaH / 3;
  const startY = y + (3 - pms.length) * slotH / 2;
  pms.forEach((m, i) => {
    const b = startY + i * slotH;
    const ribbonH = 58 * s, infoH = 76 * s;
    const rs = fitSize(ctx, m.ribbon, W * 0.55, { size: 44 * s, weight: 700, ls: 1 });
    const rw = measure(ctx, m.ribbon, { size: rs, weight: 700, ls: 1 }) + 110 * s;
    brush(ctx, W / 2, b + ribbonH / 2, rw, ribbonH, COL.slate, -2);
    text(ctx, m.ribbon, W / 2, b + ribbonH / 2, { size: rs, weight: 700, ls: 1, baseline: "middle", rotate: -2 });
    const rowTop = b + ribbonH;
    const rowH = slotH - ribbonH - infoH - 22 * s;
    const vsW = 200 * s;
    const colW = (W - 2 * SIDE - vsW) / 2;
    teamColumn(ctx, m.home, imgs.get(m.home.logo), SIDE + colW / 2, rowTop, rowH, colW, s);
    teamColumn(ctx, m.away, imgs.get(m.away.logo), W - SIDE - colW / 2, rowTop, rowH, colW, s);
    text(ctx, "VS", W / 2, rowTop + rowH / 2 + 44 * s, { size: 124 * s, family: FONT.marker, rotate: -6 });
    const ib = rowTop + rowH + 4 * s;
    rule(ctx, SIDE + 16, W - SIDE - 16, ib, 1);
    const cells = [1, 1, 1.45], tot = 3.45, iw = W - 2 * SIDE - 40;
    let x = SIDE + 20;
    const midY = ib + 8 * s + infoH / 2;
    const items = [["calendar", dayMonth(m.date)], ["clock", `${m.time} h.`], ["pin", m.venue]];
    items.forEach(([ic, label], k) => {
      const cw = iw * cells[k] / tot;
      const isz = 42 * s, gap = 16 * s;
      const ts = fitSize(ctx, label, cw - isz - gap - 20, { size: 40 * s, weight: 600, minSize: 22 * s });
      const tw = measure(ctx, label, { size: ts, weight: 600 });
      const startX = x + (cw - (isz + gap + tw)) / 2;
      icon(ctx, ic, startX + isz / 2, midY, isz);
      text(ctx, label, startX + isz + gap, midY + 1, { size: ts, weight: 600, align: "left", baseline: "middle" });
      if (k < 2) {
        ctx.fillStyle = COL.white;
        ctx.fillRect(x + cw - 2, midY - 23 * s, 4, 46 * s);
      }
      x += cw;
    });
    rule(ctx, SIDE + 16, W - SIDE - 16, ib + infoH + 12 * s, 1);
  });
  footer(ctx, W, footerY, s);
  return c;
}
function drawQuintaTodos(pms, imgs, { minHeight = 1920, header: headerText, bg = null } = {}) {
  const W = 1080, s = 1;
  const days = groupByDay(pms);
  const dayH = 78, headH = 268, footH = 130;
  const fit = (minHeight - headH - 70 - days.length * dayH - footH) / Math.max(1, pms.length);
  const rowH = Math.max(92, Math.min(130, fit));
  const H = Math.max(minHeight, Math.ceil(headH + 70 + days.length * dayH + pms.length * rowH + footH));
  const c = makeCanvas(W, H);
  const ctx = c.getContext("2d");
  grunge(ctx, W, H);
  backdrop(ctx, W, H, bg);
  let y = header(ctx, W, 64, s, headerText || headerFor(pms), { stacked: false });
  const used = days.length * dayH + pms.length * rowH;
  const free = H - footH - (y + 24) - used;
  y += 24 + Math.max(0, free / 2);
  const rH = rowH;
  for (const d2 of days) {
    const lw = measure(ctx, d2.label, { size: 34, weight: 700, ls: 2 }) + 70;
    brush(ctx, SIDE + lw / 2, y + 34, lw, 54, COL.white, -1.5);
    text(ctx, d2.label, SIDE + lw / 2, y + 35, { size: 34, weight: 700, ls: 2, color: COL.bg, baseline: "middle", rotate: -1.5 });
    ctx.fillStyle = COL.rule;
    ctx.fillRect(SIDE + lw + 18, y + 34, W - 2 * SIDE - lw - 18, 2);
    y += dayH;
    for (const m of d2.matches) {
      const cy = y + rH / 2;
      const ribW = 178;
      const rib = wrap(ctx, m.ribbonLong, ribW - 22, { size: 23, minSize: 16, weight: 700, maxLines: 2 });
      const ribH = rib.lines.length > 1 ? 64 : 48;
      brush(ctx, SIDE + ribW / 2, cy, ribW, ribH, COL.slate, -2);
      textLines(ctx, rib.lines, SIDE + ribW / 2, cy - rib.lines.length * rib.size * 1.02 / 2, { size: rib.size, weight: 700, lineHeight: 1.02, rotate: -2 });
      const timeW = 160;
      const midX0 = SIDE + ribW + 14, midX1 = W - SIDE - timeW - 10;
      const crestS = Math.min(70, rH * 0.6), vsW = 54;
      const nameW = (midX1 - midX0 - 2 * crestS - vsW - 32) / 2;
      const ny = cy - rH * 0.13;
      crest(ctx, imgs.get(m.home.logo), midX0 + crestS / 2, ny, crestS, m.home);
      crest(ctx, imgs.get(m.away.logo), midX1 - crestS / 2, ny, crestS, m.away);
      const hn = wrap(ctx, m.home.name, nameW, { size: 26, minSize: 17, weight: 600 });
      const an = wrap(ctx, m.away.name, nameW, { size: 26, minSize: 17, weight: 600 });
      const lh = 1.02;
      textLines(ctx, hn.lines, midX0 + crestS + 10, ny - hn.lines.length * hn.size * lh / 2, { size: hn.size, weight: 600, lineHeight: lh, align: "left" });
      textLines(ctx, an.lines, midX1 - crestS - 10, ny - an.lines.length * an.size * lh / 2, { size: an.size, weight: 600, lineHeight: lh, align: "right" });
      text(ctx, "VS", (midX0 + midX1) / 2, ny + 12, { size: 34, family: FONT.marker, rotate: -6 });
      const vy = cy + rH * 0.32;
      const vs = fitSize(ctx, m.venue, midX1 - midX0 - 40, { size: 20, weight: 500, ls: 1, minSize: 14 });
      const vw = measure(ctx, m.venue, { size: vs, weight: 500, ls: 1 });
      icon(ctx, "pin", (midX0 + midX1) / 2 - vw / 2 - 12, vy - 1, 18, COL.soft);
      text(ctx, m.venue, (midX0 + midX1) / 2 + 6, vy, { size: vs, weight: 500, ls: 1, color: COL.soft, baseline: "middle" });
      ctx.fillStyle = COL.white;
      ctx.fillRect(W - SIDE - timeW, cy - 30, 3, 60);
      icon(ctx, "clock", W - SIDE - timeW + 34, cy, 30);
      text(ctx, m.time, W - SIDE, cy + 1, { size: 40, weight: 700, align: "right", baseline: "middle" });
      ctx.fillStyle = COL.rule2;
      ctx.fillRect(SIDE, y + rH - 1, W - 2 * SIDE, 1);
      y += rH;
    }
    y += 10;
  }
  footer(ctx, W, H - 56, s);
  return c;
}

// src/posters/classic.js
function fitText(ctx, text2, maxW) {
  if (ctx.measureText(text2).width <= maxW) return text2;
  let s = text2;
  while (s.length > 3 && ctx.measureText(`${s}\u2026`).width > maxW) s = s.slice(0, -1);
  return `${s}\u2026`;
}
var fmtDate = (d2) => new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" }).format(/* @__PURE__ */ new Date(`${d2}T12:00:00`));
async function drawClassic(pms, imgs, { story = false, long = false, index = 1, total = 1 } = {}) {
  const W = 1080, header2 = 160, footer2 = 70, gap = 18;
  const minCard = long ? 190 : 260, targetH = story ? 1920 : 1350;
  const cardH = Math.max(minCard, (targetH - header2 - footer2 - gap * (pms.length + 1)) / pms.length);
  const H = Math.ceil(long ? header2 + footer2 + gap * (pms.length + 1) + cardH * pms.length : targetH);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#080b10";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#1c7ed6";
  ctx.fillRect(0, 0, W, 9);
  ctx.fillStyle = "#fff";
  ctx.font = "800 50px Arial";
  ctx.fillText("A QUINTA DE TUI", 55, 72);
  ctx.font = "600 24px Arial";
  ctx.fillStyle = "#aeb8c6";
  ctx.fillText("PARTIDOS \xB7 FIN DE SEMANA", 55, 115);
  pms.forEach((m, i) => {
    const y = header2 + gap + i * (cardH + gap);
    ctx.fillStyle = "#11161e";
    ctx.strokeStyle = "#27313e";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(32, y, W - 64, cardH, 24);
    ctx.fill();
    ctx.stroke();
    const compact2 = cardH < 230, box = compact2 ? 72 : Math.min(130, cardH * 0.34), cy = y + cardH * (compact2 ? 0.5 : 0.48);
    const li = imgs.get(m.home.logo), ri = imgs.get(m.away.logo);
    if (li) ctx.drawImage(li, 70, cy - box / 2, box, box);
    if (ri) ctx.drawImage(ri, W - 70 - box, cy - box / 2, box, box);
    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = `800 ${compact2 ? 26 : Math.min(46, Math.max(30, cardH * 0.14))}px Arial`;
    ctx.fillText(fitText(ctx, m.home.name, 330), W * 0.27, cy + 10);
    ctx.fillText(fitText(ctx, m.away.name, 330), W * 0.73, cy + 10);
    ctx.fillStyle = "#7f8b99";
    ctx.font = `800 ${compact2 ? 18 : 24}px Arial`;
    ctx.fillText("VS", W / 2, cy - 20);
    ctx.fillStyle = "#1c7ed6";
    ctx.font = `800 ${compact2 ? 23 : 30}px Arial`;
    ctx.fillText(m.time, W / 2, cy + compact2 * 32 + 40);
    ctx.fillStyle = "#aeb8c6";
    ctx.font = `600 ${compact2 ? 16 : 22}px Arial`;
    ctx.fillText(fitText(ctx, `${fmtDate(m.date)} \xB7 ${m.venueFull}`, 700), W / 2, cy + compact2 * 32 + 72);
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${compact2 ? 16 : 20}px Arial`;
    ctx.fillText(m.ribbonLong, 65, y + 32);
  });
  ctx.fillStyle = "#657181";
  ctx.font = "500 18px Arial";
  ctx.textAlign = "left";
  ctx.fillText(total > 1 ? `A Quinta \xB7 ${index}/${total}` : "A Quinta de Tui Futsal", 55, H - 28);
  return c;
}

// src/posters/index.js
var DESIGNS = [
  {
    id: "quinta",
    label: "A Quinta \xB7 negro (A, B y C)",
    // 3 por imagen → A (4:5) o B (Story); todos → C (Story, se alarga si hace falta)
    background: true,
    render(chunk, imgs, { story, all, bg }) {
      return all ? drawQuintaTodos(chunk, imgs, { minHeight: story ? 1920 : 1350, bg }) : drawQuinta3(chunk, imgs, { story, bg });
    }
  },
  {
    id: "clasico",
    label: "Cl\xE1sico (dise\xF1o anterior)",
    render(chunk, imgs, { story, all, index, total }) {
      return drawClassic(chunk, imgs, { story, long: all, index, total });
    }
  }
];
var DEFAULT_DESIGN = "quinta";
async function generatePosters(matches, ctx, { design = DEFAULT_DESIGN, format = "4:5", batch = "3", background = null } = {}) {
  const d2 = DESIGNS.find((x) => x.id === design) || DESIGNS[0];
  const pms = matches.map((m) => posterMatch(m, ctx)).sort(posterOrder);
  await loadFonts();
  const urls = [...new Set(pms.flatMap((p) => [p.home.logo, p.away.logo]).filter(Boolean))];
  const imgs = new Map(await Promise.all(urls.map(async (u) => [u, await loadImage(u)])));
  const all = batch === "all";
  const chunks = all ? [pms] : Array.from({ length: Math.ceil(pms.length / 3) }, (_, i) => pms.slice(i * 3, i * 3 + 3));
  let bg = null;
  if (background && d2.background) {
    const [img, imgFeed] = await Promise.all([loadImage(ctx.logoUrl(background.image_path)), loadImage(ctx.logoUrl(background.image_feed_path || ""))]);
    if (!img && !imgFeed) throw new Error(`No se pudo cargar la imagen del fondo \xAB${background.name}\xBB.`);
    bg = { img, imgFeed, dim: background.dim ?? 0.5 };
  }
  const out = [];
  for (let i = 0; i < chunks.length; i++) {
    const canvas = await d2.render(chunks[i], imgs, { story: format === "9:16", all, index: i + 1, total: chunks.length, bg });
    const tag = all ? "todos" : `${i + 1}-de-${chunks.length}`;
    out.push({ canvas, filename: `a-quinta-${chunks[i][0].date}-${format.replace(":", "x")}-${tag}.jpg` });
  }
  const missing = [...new Set(pms.flatMap((p) => [p.home, p.away]).filter((t) => !t.us && !t.crestFound).map((t) => t.full))];
  return { images: out, missingCrests: missing };
}
export {
  DEFAULT_DESIGN,
  DESIGNS,
  generatePosters
};
