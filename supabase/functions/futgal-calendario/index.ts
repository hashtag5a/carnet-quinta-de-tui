// Bot de calendario: los martes entra en Futgal, trae los partidos de nuestros equipos y de los
// rivales vigilados de los dos próximos fines de semana y los deja en Programar → Jornada.
// No toca partidos confirmados ni fijados: si Futgal los cambia, avisa.
// Si Futgal ya trae la hora de un partido en casa, se toma como oficial y queda fijada.
// Con { ultimo: true } (botón Generar calendario del panel) manda siempre lo último de Futgal:
// compara con lo que había y actualiza también los confirmados o fijados, apuntando cada diferencia.
// Tras la entrada del martes propone las horas de los partidos en casa que aún no la tienen
// (misma lógica que «Proponer horarios» del panel: prioridad, normas, conflictos y horas de pabellón).
import { createClient } from "jsr:@supabase/supabase-js@2";

const BASE = "https://intranet.futgal.es";
const CLUB = "4583";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const jar = new Map<string, string>();
function keep(res: Response) { const all = (res.headers as any).getSetCookie ? (res.headers as any).getSetCookie() : []; for (const c of all) { const m = c.match(/^([^=;\s]+)=([^;]*)/); if (m) jar.set(m[1], m[2]); } }
const cookie = () => [...jar].map(([k, v]) => k + "=" + v).join("; ");
async function go(path: string, init: RequestInit = {}): Promise<Response> {
  let url = path.startsWith("http") ? path : BASE + path; let opts = init;
  for (let i = 0; i < 6; i++) { const res = await fetch(url, { ...opts, redirect: "manual", headers: { ...(opts.headers || {}), "User-Agent": UA, Cookie: cookie() } }); keep(res); const loc = res.headers.get("location"); if (res.status >= 300 && res.status < 400 && loc) { await res.body?.cancel(); url = new URL(loc, url).toString(); opts = {}; continue; } return res; }
  throw new Error("Demasiadas redirecciones");
}
const text = async (r: Response) => new TextDecoder("iso-8859-15").decode(await r.arrayBuffer());
const MARK: Record<string, string> = { acute: "́", grave: "̀", uml: "̈", circ: "̂", tilde: "̃" };
const ent = (s: string) => s.replace(/&([a-zA-Z])(acute|grave|uml|circ|tilde);/g, (_, l, k) => (l + MARK[k]).normalize("NFC")).replace(/&ordf;/g, "ª").replace(/&ordm;/g, "º").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const clean = (s: string) => ent(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const norm = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const weekendKey = (s: string) => { const d = new Date(s + "T12:00:00Z").getUTCDay(); return addDays(s, d === 0 ? -1 : 6 - d); };
const dmy = (s: string) => s.slice(8, 10) + "-" + s.slice(5, 7) + "-" + s.slice(0, 4);

type P = { cod: string; fecha: string; comp: string; local: string; visit: string; campo: string; hora: string; jornada: string };
function parse(html: string): P[] {
  const out: P[] = []; let fecha = "", comp = "";
  const i0 = html.indexOf('<table class="table table-striped'); if (i0 < 0) return out;
  const body = html.slice(i0);
  for (const chunk of body.split(/<tr[\s>]/i)) {
    const f = chunk.match(/<b>(\d\d)-(\d\d)-(\d{4}),/); if (f) { fecha = `${f[3]}-${f[2]}-${f[1]}`; continue; }
    if (/Cod\. Partido/.test(chunk)) { const ths = [...chunk.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(m => clean(m[1])); comp = ths[1] || ""; continue; }
    const tds = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    if (tds.length < 7) continue;
    const cod = clean(tds[0]); if (!/^\d+$/.test(cod)) continue;
    const raw = tds[1].replace(/<span[\s\S]*?<\/span>/gi, "").replace(/<a[\s\S]*?<\/a>/gi, "");
    const sep = raw.split(/&nbsp;\s*-\s*&nbsp;/);
    const local = clean(sep[0] || ""), visit = clean(sep.slice(1).join(" - "));
    out.push({ cod, fecha, comp, local, visit, campo: clean(tds[4]), hora: clean(tds[5]).replace(/[^\d:]/g, ""), jornada: clean(tds[6]) });
  }
  return out;
}
const LEVEL: [RegExp, string][] = [[/PREF/, "PREF"], [/PRIMERA|1ª/, "1"], [/SEGUNDA|2ª/, "2"], [/TERCERA|3ª/, "3"]];
const CATS = ["PREBENJAMIN", "BENJAMIN", "ALEVIN", "INFANTIL", "CADETE", "JUVENIL", "SENIOR", "BIBERON", "FEMENINO"];
const catOf = (s: string) => { const n = norm(s); return CATS.find(c => n.includes(c)) || ""; };
const levelOf = (s: string) => { const n = norm(s).replace(/ª/g, "ª"); for (const [re, v] of LEVEL) if (re.test(n) || re.test(s.toUpperCase())) return v; return ""; };
const letterOf = (s: string) => ((s.match(/"([A-Z])"\s*$/) || s.match(/"([A-Z])"/) || [])[1] || "");

// ---- Proponer horarios (copia de la lógica del panel) ----
const toMin = (t: string) => { if (!t) return null as any; const [a, b] = t.split(":").map(Number); return a * 60 + (b || 0); };
const toHM = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const dow = (f: string) => String(new Date(f + "T12:00:00Z").getUTCDay());
function parseFed(str: string) {
  const map: Record<string, string> = { vie: "5", sab: "6", dom: "0" }; const out: { d: string; desde: string; hasta: string }[] = [];
  String(str || "").split(";").forEach(part => {
    const m = part.trim().match(/^(vie|s[aá]b|dom)[a-zá]*\.?\s+(.+)$/i); if (!m) return;
    const d = map[m[1].toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
    m[2].split(",").forEach(r => { const k = r.trim().match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/); if (k) out.push({ d, desde: k[1].padStart(5, "0"), hasta: k[2].padStart(5, "0") }); });
  });
  return out;
}
const normasDe = (e: any) => ({ dias: ["5", "6", "0"], desde: "", hasta: "", pabs: [] as string[], fed: "", ...((e && e.normas) || {}) });
function cumpleNormas(e: any, fecha: string, t: number, d: number, pab: string) {
  const n = normasDe(e); const dw = dow(fecha);
  const fed = parseFed(n.fed); if (fed.length && !fed.some(f => f.d === dw && t >= toMin(f.desde) && t <= toMin(f.hasta))) return false;
  if (n.dias.length && !n.dias.includes(dw)) return false;
  if (n.desde && t < toMin(n.desde)) return false;
  if (n.hasta && t + d > toMin(n.hasta)) return false;
  if (n.pabs.length && !n.pabs.includes(pab)) return false;
  return true;
}
async function proponer(sb: any, C: Record<string, Record<string, any>>, wk: string) {
  const c = { margen: 15, margenPab: 10, durRival: 60, ...(C.config.general || {}) };
  const dur = (e: any) => Number(e && e.duracion) || 60;
  const frs = Object.values(C.franjas).filter((x: any) => weekendKey(x.fecha) === wk).sort((a: any, b: any) => (a.fecha + a.desde).localeCompare(b.fecha + b.desde)) as any[];
  const all = Object.entries(C.partidos).filter(([, p]) => p.fecha && weekendKey(p.fecha) === wk);
  const libres = all.filter(([, p]) => p.casa && !p.fija && p.estado !== "confirmado" && !p.hora)
    .sort((a, b) => ((C.equipos[a[1].equipoId] || {}).orden ?? 0) - ((C.equipos[b[1].equipoId] || {}).orden ?? 0));
  if (!libres.length) return null;
  if (!frs.length) return { finde: wk, propuestos: 0, sinHueco: libres.length, aviso: "Sin horas de pabellón ese fin de semana" };
  const incompat = (eid: string) => { const e = C.equipos[eid] || {}; const set = new Set<string>(e.evitarEq || []);
    Object.entries(C.equipos).forEach(([oid, o]) => { if ((o.evitarEq || []).includes(eid)) set.add(oid); }); set.delete(eid); return [...set].filter(x => C.equipos[x]); };
  const occ: any[] = [];
  all.forEach(([, p]) => { if (!p.hora) return; const s = toMin(p.hora), e = s + dur(C.equipos[p.equipoId]);
    occ.push({ fecha: p.fecha, pab: p.casa ? p.pabellonId : null, s, e, eid: p.equipoId }); });
  const pabOrden = Object.entries(C.pabellones).sort((a, b) => (a[1].orden ?? 0) - (b[1].orden ?? 0)).map(([id]) => id);
  let ok = 0, sin = 0;
  for (const [pid, p] of libres) {
    const eq = C.equipos[p.equipoId]; const d = dur(eq); const inc = incompat(p.equipoId);
    const rv: any[] = [];
    ((eq && eq.evitar) || []).forEach((rid: string) => { const r = C.rivales[rid]; if (!r) return;
      Object.values(C.partidosRivales).forEach((rp: any) => { if (rp.rivalId === rid && rp.hora && weekendKey(rp.fecha) === wk) { const s = toMin(rp.hora); rv.push({ fecha: rp.fecha, s, e: s + (Number(r.duracion) || c.durRival) }); } }); });
    const fits = (fecha: string, pab: string, t: number, fd: number, fh: number) => t >= fd && t + d <= fh
      && !occ.some(o => o.fecha === fecha && o.pab && o.pab === pab && t < o.e + c.margenPab && o.s < t + d + c.margenPab)
      && !occ.some(o => o.fecha === fecha && inc.includes(o.eid) && t < o.e + c.margen && o.s < t + d + c.margen)
      && !rv.some(r => r.fecha === fecha && t < r.e + c.margen && r.s < t + d + c.margen)
      && cumpleNormas(eq, fecha, t, d, pab);
    let best: any = null;
    for (const fr of frs) {
      const fd = toMin(fr.desde), fh = toMin(fr.hasta); if (fd == null || fh == null) continue;
      const cand = new Set<number>([fd]);
      occ.forEach(o => { if (o.fecha === fr.fecha) { cand.add(o.e + c.margenPab); cand.add(o.e + c.margen); } });
      rv.forEach(r => { if (r.fecha === fr.fecha) cand.add(r.e + c.margen); });
      for (let t = fd; t <= fh - d; t += 5) cand.add(t);
      for (const t of [...cand].filter(t => t >= fd).sort((a, b) => a - b)) {
        if (fits(fr.fecha, fr.pabellonId, t, fd, fh)) {
          const key = fr.fecha + toHM(t);
          if (!best || key < best.key || (key === best.key && pabOrden.indexOf(fr.pabellonId) < pabOrden.indexOf(best.pab))) best = { key, fecha: fr.fecha, pab: fr.pabellonId, s: t };
          break;
        }
      }
    }
    if (best) {
      occ.push({ fecha: best.fecha, pab: best.pab, s: best.s, e: best.s + d, eid: p.equipoId });
      C.partidos[pid] = { ...p, fecha: best.fecha, hora: toHM(best.s), pabellonId: best.pab, propuestoPorBot: true };
      await sb.from("panel_docs").update({ data: C.partidos[pid] }).eq("col", "partidos").eq("id", pid);
      ok++;
    } else sin++;
  }
  return { finde: wk, propuestos: ok, sinHueco: sin };
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const opts = await req.json().catch(() => ({}));
  // Solo la entrada programada del martes lleva { martes: true }: es la única que respeta lo
  // confirmado/fijado y la única que avisa por Telegram. Cualquier otra llamada (el panel al abrir
  // Generar calendario, «Traer ahora de Futgal»…) se queda siempre con lo último y no avisa.
  const martes = opts.martes === true;
  if (!martes) opts.ultimo = true;
  const informe: Record<string, any> = { fecha: new Date().toISOString(), modo: martes ? "martes" : "panel", importados: 0, nuevos: 0, actualizados: 0, sinEquipo: [], cambios: [], rivales: 0 };
  try {
    await text(await go("/nfg/"));
    await text(await go("/nfg/NLogin", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ NUser: Deno.env.get("FUTGAL_USER")!, NPass: Deno.env.get("FUTGAL_PASS")! }).toString() }));
    const today = iso(new Date());
    const wk1 = weekendKey(addDays(today, 1));
    const desde = addDays(wk1, -1), hasta = addDays(wk1, opts.semanas === 1 ? 1 : 8);
    informe.desde = desde; informe.hasta = hasta;
    const url = (club: string, extra = "") => `/nfg/NPcd/NFG_LstPartidos?cod_primaria=1000139&Consulta=1&Sch_Cod_Temporada=22&Sch_Clave_Acceso_Club=${club}${extra}&Sch_Fecha_Desde=${dmy(desde)}&Sch_Fecha_Hasta=${dmy(hasta)}&NPcd_PageLines=200`;
    const html = await text(await go(url(CLUB)));
    if (!html.includes("Cod. Partido") && !html.includes("table-striped")) throw new Error("No se pudo entrar en Futgal o leer el buscador de partidos.");
    const ps = parse(html);

    const { data: docs } = await sb.from("panel_docs").select("col,id,data").in("col", ["equipos", "pabellones", "partidos", "rivales", "partidosRivales", "franjas", "config"]);
    const C: Record<string, Record<string, any>> = { equipos: {}, pabellones: {}, partidos: {}, rivales: {}, partidosRivales: {}, franjas: {}, config: {} };
    (docs || []).forEach((d: any) => { C[d.col][d.id] = d.data; });
    const eqs = Object.entries(C.equipos);
    const pabFor = (campo: string) => { const n = norm(campo); let best = ""; for (const [id, p] of Object.entries(C.pabellones)) { const words = norm(p.nombre).replace(/^P\.?\s*/, "").split(/[^A-Z0-9]+/).filter(w => w.length > 3); if (words.some(w => n.includes(w))) best = id; } return best; };
    const matchEq = (ourName: string, comp: string) => {
      const exact = eqs.find(([, e]) => e.futgal && norm(e.futgal) === norm(ourName) && (!e.futgalComp || norm(comp).includes(norm(e.futgalComp))));
      if (exact) return exact[0];
      const cat = catOf(comp), lvl = levelOf(comp), let_ = letterOf(ourName) || "A";
      const pool = eqs.filter(([, e]) => catOf(e.categoria) === cat && (!levelOf(e.categoria) || levelOf(e.categoria) === lvl));
      const byLetter = pool.filter(([, e]) => (letterOf(e.nombre) || "A") === let_);
      if (byLetter.length === 1) return byLetter[0][0];
      if (pool.length === 1) return pool[0][0];
      return "";
    };
    const avisos: string[] = [];
    for (const p of ps) {
      if (!p.fecha) continue;
      const casa = norm(p.local).includes("QUINTA");
      const ours = casa ? p.local : p.visit, rival = casa ? p.visit : p.local;
      if (!norm(ours).includes("QUINTA")) continue;
      const eid = matchEq(ours, p.comp);
      if (!eid) { informe.sinEquipo.push(`${p.comp} · ${ours} (${p.fecha})`); continue; }
      if (p.comp && C.equipos[eid].competicion !== p.comp) { C.equipos[eid] = { ...C.equipos[eid], competicion: p.comp }; await sb.from("panel_docs").update({ data: C.equipos[eid] }).eq("col", "equipos").eq("id", eid); }
      const wk = weekendKey(p.fecha); const id = wk + "_" + eid;
      const cur = C.partidos[id];
      const nuevo = { equipoId: eid, fecha: p.fecha, casa, rival, codPartido: p.cod, fuente: "Futgal", lugar: casa ? "" : p.campo, futgalHora: p.hora, futgalCampo: p.campo, jornadaFutgal: p.jornada };
      informe.importados++;
      if (!cur) {
        C.partidos[id] = { ...nuevo, hora: p.hora || "", pabellonId: casa ? pabFor(p.campo) : "", fija: !!(casa && p.hora), estado: "propuesto" };
        await sb.from("panel_docs").upsert({ col: "partidos", id, data: C.partidos[id] });
        informe.nuevos++; continue;
      }
      if (opts.ultimo) {
        const dif: string[] = [];
        if (cur.fecha !== p.fecha) dif.push(`fecha ${cur.fecha} → ${p.fecha}`);
        if (norm(cur.rival) !== norm(rival)) dif.push(`rival «${cur.rival}» → «${rival}»`);
        if (!!cur.casa !== casa) dif.push(casa ? "ahora en casa" : "ahora fuera");
        if (p.hora && (cur.hora || "") !== p.hora) dif.push(`hora ${cur.hora || "—"} → ${p.hora}`);
        if (!casa && norm(cur.lugar || "") !== norm(p.campo)) dif.push(`campo «${cur.lugar || "—"}» → «${p.campo}»`);
        if (dif.length) { const e = C.equipos[eid]; informe.cambios.push(`${e.categoria} ${e.nombre}: ${dif.join(", ")} (actualizado)`); }
      }
      const bloqueado = (cur.estado === "confirmado" || cur.fija) && !opts.ultimo;
      if (bloqueado) {
        const dif: string[] = [];
        if (cur.fecha !== p.fecha) dif.push(`fecha ${cur.fecha} → ${p.fecha}`);
        if (norm(cur.rival) !== norm(rival)) dif.push(`rival «${cur.rival}» → «${rival}»`);
        if (!!cur.casa !== casa) dif.push(casa ? "ahora en casa" : "ahora fuera");
        if (!casa && p.hora && cur.hora !== p.hora) dif.push(`hora ${cur.hora || "—"} → ${p.hora}`);
        if (dif.length) { const e = C.equipos[eid]; const t = `${e.categoria} ${e.nombre}: ${dif.join(", ")}`; informe.cambios.push(t); avisos.push(t); }
        C.partidos[id] = { ...cur, codPartido: p.cod, futgalHora: p.hora, futgalCampo: p.campo };
        await sb.from("panel_docs").update({ data: C.partidos[id] }).eq("col", "partidos").eq("id", id);
        continue;
      }
      const upd = { ...cur, ...nuevo, hora: casa ? (p.hora || (cur.casa ? cur.hora : "")) : p.hora, fija: casa && p.hora ? true : !!cur.fija, pabellonId: casa ? (cur.pabellonId || pabFor(p.campo)) : "" };
      C.partidos[id] = upd;
      await sb.from("panel_docs").update({ data: upd }).eq("col", "partidos").eq("id", id);
      informe.actualizados++;
    }
    // rivales vigilados: su enlace de Futgal trae club y equipo
    for (const [rid, r] of Object.entries(C.rivales)) {
      const club = (String(r.enlace || "").match(/Club=(\d+)/) || [])[1]; const eq = (String(r.enlace || "").match(/Sch_Codigo_Equipo=(\d+)/) || [])[1];
      if (!club) continue;
      const rp = parse(await text(await go(url(club, eq ? `&Club=${club}&Sch_Codigo_Equipo=${eq}` : ""))));
      for (const p of rp) {
        if (!p.fecha) continue;
        const id = "f" + p.cod;
        const prev = C.partidosRivales[id];
        C.partidosRivales[id] = { ...(prev || {}), rivalId: rid, fecha: p.fecha, hora: p.hora, lugar: p.campo, fuente: "Futgal", codPartido: p.cod, partido: p.local + " - " + p.visit };
        await sb.from("panel_docs").upsert({ col: "partidosRivales", id, data: C.partidosRivales[id] });
        informe.rivales++;
      }
    }
    // propuesta automática de horas (solo la entrada del martes)
    if (martes) {
      informe.propuesta = [];
      for (const wk of [wk1, addDays(wk1, 7)]) {
        const r = await proponer(sb, C, wk);
        if (r) informe.propuesta.push(r);
      }
    }
    informe.ok = true;
  } catch (e) { informe.ok = false; informe.error = String((e as Error)?.message || e); }
  await sb.from("panel_docs").upsert({ col: "config", id: "futgal_import", data: informe });
  // aviso en Telegram
  try {
    const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const { data: tgRow } = await sb.from("panel_docs").select("data").eq("col", "mails").eq("id", "_telegram").maybeSingle();
    const chat = (tgRow?.data as any)?.chat_id;
    if (token && chat && martes && !opts.silencio) { // solo la entrada del martes avisa
      // Aviso corto: solo que el calendario está listo y el enlace a Generar calendario.
      const lines = informe.ok
        ? [`🗓️ <b>Calendario A Quinta listo</b>`, `<a href="https://hashtag5a.github.io/carnet-quinta-de-tui/panel/#auto">Abrir Generar calendario</a>`]
        : [`⚠️ <b>No se pudo traer el calendario de Futgal</b>`, `<a href="https://hashtag5a.github.io/carnet-quinta-de-tui/panel/#auto">Abrir Generar calendario</a>`];
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: lines.filter(Boolean).join("\n\n"), parse_mode: "HTML", disable_web_page_preview: true }) });
    }
  } catch (_) { /* sin aviso */ }
  return Response.json(informe);
});
