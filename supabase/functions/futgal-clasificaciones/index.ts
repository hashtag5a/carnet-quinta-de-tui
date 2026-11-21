// Clasificaciones: entra en Futgal, coge de la portada la jornada actual de cada competición y grupo del club,
// baja la clasificación de cada grupo y la guarda en standings (una fila por equipo nuestro, emparejado por
// categoría, nivel y letra con panel_docs/equipos; la liga manda sobre la fase previa). También pone los resultados de los partidos en matches (y así se cierra la porra). La lanza pg_cron sábado y domingo noche y lunes.
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
const LEVEL: [RegExp, string][] = [[/PREF/, "PREF"], [/PRIMERA|1ª/, "1"], [/SEGUNDA|2ª/, "2"], [/TERCERA|3ª/, "3"]];
const CATS = ["PREBENJAMIN", "BENJAMIN", "ALEVIN", "INFANTIL", "CADETE", "JUVENIL", "SENIOR"];
const catOf = (s: string) => { const n = norm(s); return CATS.find(c => n.includes(c)) || ""; };
const levelOf = (s: string) => { const n = norm(s); for (const [re, v] of LEVEL) if (re.test(n)) return v; return ""; };
const letterOf = (s: string) => ((s.match(/"([A-Z])"\s*$/) || s.match(/"([A-Z])"/) || [])[1] || "");

// Resultados del buscador de partidos: código de partido y goles local-visitante
function parseResults(html: string) {
  const out: { cod: string; gl: number; gv: number }[] = [];
  const i0 = html.indexOf('<table class="table table-striped'); if (i0 < 0) return out;
  for (const chunk of html.slice(i0).split(/<tr[\s>]/i)) {
    const tds = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
    if (tds.length < 7) continue;
    const cod = clean(tds[0]); if (!/^\d+$/.test(cod)) continue;
    const r = tds[tds.length - 1].match(/<b>\s*(\d+)\s*<\/b>\s*-\s*<b>\s*(\d+)\s*<\/b>/);
    if (r) out.push({ cod, gl: +r[1], gv: +r[2] });
  }
  return out;
}
// Tabla "clasificación resumida": pos | equipo | pts | J | G | E | P | F | C | 5 últimos | sanción
function parseTable(html: string) {
  const i = html.search(/clasificaci(ó|&oacute;)n detallada/i);
  const part = i >= 0 ? html.slice(i) : html;
  const rows: any[] = [];
  for (const tr of part.split(/<tr[\s>]/i).slice(1)) {
    const tds = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1])).filter(x => x !== "");
    if (tds.length < 9 || !/^\d+$/.test(tds[0]) || !/^-?\d+$/.test(tds[2])) continue;
    const pos = +tds[0]; if (rows.some(r => r.pos === pos)) break;
    rows.push({ pos, team: tds[1], pts: +tds[2], j: +tds[3], g: +tds[4], e: +tds[5], p: +tds[6], gf: +tds[7], gc: +tds[8], last: tds.slice(9).filter(x => /^[GEP]$/.test(x)).join("") });
  }
  return rows;
}

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const informe: any = { at: new Date().toISOString(), grupos: 0, guardados: 0, sinEquipo: [], errores: [] };
  try {
    await text(await go("/nfg/"));
    await text(await go("/nfg/NLogin", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ NUser: Deno.env.get("FUTGAL_USER")!, NPass: Deno.env.get("FUTGAL_PASS")! }).toString() }));
    // La portada de la intranet enlaza la jornada actual de cada competición y grupo del club
    const home = await text(await go("/nfg/"));
    const links = new Map<string, { comp: string; grupo: string; jornada: number }>();
    for (const m of home.matchAll(/NFG_CmpJornada\?cod_primaria=1000128&(?:amp;)?CodCompeticion=(\d+)&(?:amp;)?CodGrupo=(\d+)&(?:amp;)?CodTemporada=\d+&(?:amp;)?CodJornada=(\d+)/g))
      links.set(m[1] + "_" + m[2], { comp: m[1], grupo: m[2], jornada: +m[3] });
    informe.enlaces = links.size;
    const { data: eqDocs } = await sb.from("panel_docs").select("id,data").eq("col", "equipos");
    const eqs: [string, any][] = (eqDocs || []).map((d: any) => [d.id, d.data]);
    const { data: teams } = await sb.from("teams").select("id,panel_id");
    const teamOf = Object.fromEntries((teams || []).map((t: any) => [t.panel_id, t.id]));
    const best: Record<string, any> = {};
    for (const l of links.values()) {
      try {
        const h = await text(await go(`/nfg/NPcd/NFG_VisClasificacion?cod_primaria=1000128&codjornada=${l.jornada}&codcompeticion=${l.comp}&codgrupo=${l.grupo}`));
        const flat = ent(h.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "|")).replace(/\s*\|[\s|]*/g, "|");
        const hm = flat.match(/\|([^|]+)\|([^|]+)\|Temporada 20\d\d-20\d\d\|Jornada (\d+)/);
        const compName = hm ? (hm[1].trim() + " | " + hm[2].trim()).replace(/\s+/g, " ").replace(/^-->\s*\|\s*/, "") : "";
        const table = parseTable(h); informe.grupos++;
        if (!table.length || !compName) { informe.errores.push(`Sin tabla ${l.comp}/${l.grupo}`); continue; }
        for (const row of table.filter(r => norm(r.team).includes("QUINTA"))) {
          // Mismo equipo = misma categoría y nivel, y misma letra ("B", "C"…; sin letra = A)
          const cands = eqs.filter(([, e]) => catOf(e.categoria) === catOf(compName) && (!levelOf(e.categoria) || levelOf(e.categoria) === levelOf(compName)));
          const pick = cands.find(([, e]) => e.futgal && norm(e.futgal) === norm(row.team)) || cands.find(([, e]) => !e.futgal && (letterOf(e.nombre) || "A") === (letterOf(row.team) || "A")) || (cands.length === 1 ? cands[0] : null);
          if (!pick || !teamOf[pick[0]]) { informe.sinEquipo.push(`${compName} · ${row.team}`); continue; }
          // Si un equipo está en dos grupos (fase previa y liga), manda la liga aunque lleve menos jornadas
          const prio = /FASE PREVIA/i.test(compName) ? 0 : 1;
          const cur = best[pick[0]];
          if (!cur || prio > cur.prio || (prio === cur.prio && row.j > cur.j)) best[pick[0]] = { prio, j: row.j, team_id: teamOf[pick[0]], competition: compName, jornada: hm ? +hm[3] : l.jornada, our_name: row.team, rows: table };
        }
      } catch (e) { informe.errores.push(`${l.comp}/${l.grupo}: ${e}`); }
    }
    // Resultados de las tres últimas semanas: se guardan en el carnet y cierran la porra (trigger de matches)
    try {
      const d = (n: number) => { const x = new Date(Date.now() + n * 864e5); return String(x.getUTCDate()).padStart(2, "0") + "-" + String(x.getUTCMonth() + 1).padStart(2, "0") + "-" + x.getUTCFullYear(); };
      const lh = await text(await go(`/nfg/NPcd/NFG_LstPartidos?cod_primaria=1000139&Consulta=1&Sch_Cod_Temporada=22&Sch_Clave_Acceso_Club=${CLUB}&Sch_Fecha_Desde=${d(-21)}&Sch_Fecha_Hasta=${d(0)}&NPcd_PageLines=300`));
      const res = parseResults(lh); informe.resultadosFutgal = res.length; informe.resultados = 0;
      if (res.length) {
        const { data: pts } = await sb.from("panel_docs").select("id,data").eq("col", "partidos");
        const byCod = new Map((pts || []).filter((x: any) => x.data?.codPartido).map((x: any) => [String(x.data.codPartido), x]));
        for (const r of res) {
          const pd: any = byCod.get(r.cod); if (!pd) continue;
          const casa = !!pd.data.casa;
          const { data: up, error } = await sb.from("matches").update({ goals_for: casa ? r.gl : r.gv, goals_against: casa ? r.gv : r.gl, finished: true })
            .eq("source_ref", "panel:" + pd.id).eq("finished", false).select("id");
          if (error) informe.errores.push("resultado " + r.cod + ": " + error.message); else informe.resultados += (up || []).length;
        }
      }
    } catch (e) { informe.errores.push("resultados: " + e); }
    for (const b of Object.values(best)) {
      const { j, prio, ...row } = b;
      const { error } = await sb.from("standings").upsert({ ...row, updated_at: new Date().toISOString() });
      if (error) informe.errores.push(error.message); else informe.guardados++;
    }
  } catch (e) { informe.errores.push(String(e)); }
  await sb.from("panel_docs").upsert({ col: "config", id: "futgal_clasificaciones", data: informe });
  return new Response(JSON.stringify(informe), { headers: { "Content-Type": "application/json" } });
});
