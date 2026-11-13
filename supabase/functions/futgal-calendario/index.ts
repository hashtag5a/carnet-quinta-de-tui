// Bot de calendario: los martes entra en Futgal, trae los partidos de nuestros equipos y de los
// rivales vigilados de los dos próximos fines de semana y los deja en Programar → Jornada.
// No toca partidos confirmados ni fijados: si Futgal los cambia, avisa.
// Si Futgal ya trae la hora de un partido en casa, se toma como oficial y queda fijada.
// Con { ultimo: true } (botón Generar calendario del panel) manda siempre lo último de Futgal:
// compara con lo que había y actualiza también los confirmados o fijados, apuntando cada diferencia.
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

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const opts = await req.json().catch(() => ({}));
  // Quién llama: el cron del martes usa la clave anónima; el panel, la sesión de un usuario.
  // Desde el panel siempre manda lo último de Futgal y nunca avisa por Telegram.
  const rol = (() => { try { const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(atob(t + "===".slice((t.length + 3) % 4))).role || ""; } catch { return ""; } })();
  if (rol === "authenticated") opts.ultimo = true;
  const informe: Record<string, any> = { fecha: new Date().toISOString(), importados: 0, nuevos: 0, actualizados: 0, sinEquipo: [], cambios: [], rivales: 0 };
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

    const { data: docs } = await sb.from("panel_docs").select("col,id,data").in("col", ["equipos", "pabellones", "partidos", "rivales", "partidosRivales"]);
    const C: Record<string, Record<string, any>> = { equipos: {}, pabellones: {}, partidos: {}, rivales: {}, partidosRivales: {} };
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
      const wk = weekendKey(p.fecha); const id = wk + "_" + eid;
      const cur = C.partidos[id];
      const nuevo = { equipoId: eid, fecha: p.fecha, casa, rival, codPartido: p.cod, fuente: "Futgal", lugar: casa ? "" : p.campo, futgalHora: p.hora, futgalCampo: p.campo, jornadaFutgal: p.jornada };
      informe.importados++;
      if (!cur) {
        await sb.from("panel_docs").upsert({ col: "partidos", id, data: { ...nuevo, hora: p.hora || "", pabellonId: casa ? pabFor(p.campo) : "", fija: !!(casa && p.hora), estado: "propuesto" } });
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
        await sb.from("panel_docs").update({ data: { ...cur, codPartido: p.cod, futgalHora: p.hora, futgalCampo: p.campo } }).eq("col", "partidos").eq("id", id);
        continue;
      }
      const upd = { ...cur, ...nuevo, hora: casa ? (p.hora || (cur.casa ? cur.hora : "")) : p.hora, fija: casa && p.hora ? true : !!cur.fija, pabellonId: casa ? (cur.pabellonId || pabFor(p.campo)) : "" };
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
        await sb.from("panel_docs").upsert({ col: "partidosRivales", id, data: { ...(prev || {}), rivalId: rid, fecha: p.fecha, hora: p.hora, lugar: p.campo, fuente: "Futgal", codPartido: p.cod, partido: p.local + " - " + p.visit } });
        informe.rivales++;
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
    if (token && chat && !opts.silencio && !opts.ultimo && rol !== "authenticated") { // solo la entrada del martes avisa
      // Aviso corto: solo que el calendario está listo y el enlace a Generar calendario.
      const lines = informe.ok
        ? [`🗓️ <b>Calendario A Quinta listo</b>`, `<a href="https://hashtag5a.github.io/carnet-quinta-de-tui/panel/#auto">Abrir Generar calendario</a>`]
        : [`⚠️ <b>No se pudo traer el calendario de Futgal</b>`, `<a href="https://hashtag5a.github.io/carnet-quinta-de-tui/panel/#auto">Abrir Generar calendario</a>`];
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: chat, text: lines.filter(Boolean).join("\n\n"), parse_mode: "HTML", disable_web_page_preview: true }) });
    }
  } catch (_) { /* sin aviso */ }
  return Response.json(informe);
});
