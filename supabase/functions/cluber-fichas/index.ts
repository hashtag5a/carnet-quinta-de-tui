// Fichas vs Cluber: entra en Futgal, saca los jugadores con licencia de cada equipo del club (con su edad)
// y los busca en Cluber por nombre y apellidos (la edad desempata). La categoría de Cluber no se usa: manda Futgal.
// Estado en Cluber: alta nueva o renovado = al día (pagando); pendiente de renovar = no renovado; si no aparece, no está en Cluber.
// Solo se lanza al pulsar el botón del panel. Guarda el resultado en panel_docs (col "fichas", id "ultimo")
// y la revisión anterior en "anterior", para marcar quién ha entrado en Cluber desde la última vez.
import { createClient } from "jsr:@supabase/supabase-js@2";

const FUT = "https://intranet.futgal.es";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const jar = new Map<string, string>();
function keep(res: Response) { const all = (res.headers as any).getSetCookie ? (res.headers as any).getSetCookie() : []; for (const c of all) { const m = c.match(/^([^=;\s]+)=([^;]*)/); if (m) jar.set(m[1], m[2]); } }
const cookie = () => [...jar].map(([k, v]) => k + "=" + v).join("; ");
async function go(path: string, init: RequestInit = {}): Promise<Response> {
  let url = path.startsWith("http") ? path : FUT + path; let opts = init;
  for (let i = 0; i < 6; i++) { const res = await fetch(url, { ...opts, redirect: "manual", headers: { ...(opts.headers || {}), "User-Agent": UA, Cookie: cookie() } }); keep(res); const loc = res.headers.get("location"); if (res.status >= 300 && res.status < 400 && loc) { await res.body?.cancel(); url = new URL(loc, url).toString(); opts = {}; continue; } return res; }
  throw new Error("Demasiadas redirecciones");
}
const text = async (r: Response) => new TextDecoder("iso-8859-15").decode(await r.arrayBuffer());
const MARK: Record<string, string> = { acute: "\u0301", grave: "\u0300", uml: "\u0308", circ: "\u0302", tilde: "\u0303" };
const ent = (s: string) => s.replace(/&([a-zA-Z])(acute|grave|uml|circ|tilde);/g, (_, l, k) => (l + MARK[k]).normalize("NFC")).replace(/&ordf;/g, "ª").replace(/&ordm;/g, "º").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const clean = (s: string) => ent(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const norm = (s: string) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z\s]/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set(["DE", "DEL", "LA", "LAS", "LOS", "DA", "DO", "DAS", "DOS", "E", "Y", "I"]);
const toks = (s: string) => norm(s).split(" ").filter(t => t && !STOP.has(t));
const CATS = ["PREBENJAMIN", "BENJAMIN", "ALEVIN", "INFANTIL", "CADETE", "JUVENIL", "SENIOR", "VETERANO"];
const catRank = (s: string) => { const n = norm(s); const i = CATS.findIndex(c => n.includes(c)); return i < 0 ? 99 : i; };

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// ---------- Futgal ----------
async function futgal() {
  await text(await go("/nfg/"));
  await text(await go("/nfg/NLogin", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ NUser: Deno.env.get("FUTGAL_USER")!, NPass: Deno.env.get("FUTGAL_PASS")! }).toString() }));
  const club = await text(await go("/nfg/NPcd/NFG_VerMiClub?cod_primaria=1000110"));
  const teams = new Map<string, string>();
  for (const m of club.matchAll(/NFG_VisEquipos\?cod_primaria=1000102&(?:amp;)?Codigo_Equipo=(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi)) if (!teams.has(m[1])) teams.set(m[1], clean(m[2]));
  if (!teams.size) throw new Error("Futgal: no se encontraron equipos (¿sesión caducada?)");
  const equipos = await pool([...teams], 4, async ([cod, nombre]) => {
    const h = await text(await go(`/nfg/NPcd/NFG_VisEquipos?cod_primaria=1000102&Codigo_Equipo=${cod}`));
    const flat = ent(h.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "|")).replace(/\s*\|[\s|]*/g, "|");
    const categoria = ((flat.match(/Categoría:\|([^|]+)\|/) || [])[1] || "").trim();
    const i0 = h.search(/Jugadores \(\d+\)/); const rest = i0 >= 0 ? h.slice(i0) : "";
    const i1 = rest.search(/(Delegados|Entrenadores|T(?:&eacute;|é|e)cnicos|Auxiliares|Oficiales)\s*\(\d+\)/);
    const sec = i1 > 0 ? rest.slice(0, i1) : rest;
    const jug: { lic: string; nombre: string; url?: string; edad?: number }[] = [];
    for (const m of sec.matchAll(/href=["']([^"']*NFG_GC_VisLicencia\?[^"']*cod_licencia=(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const nombre = clean(m[3]); if (nombre && !jug.some(j => j.lic === m[2])) jug.push({ lic: m[2], nombre, url: m[1].replace(/&amp;/g, "&") });
    }
    return { cod, nombre, categoria, jugadores: jug };
  });
  const todos = equipos.flatMap(e => e.jugadores);
  await pool(todos, 6, async (j) => {
    try {
      const h = await text(await go(j.url || `/nfg/NPcd/NFG_GC_VisLicencia?&cod_primaria=1000188&cod_licencia=${j.lic}&codigo_estado=1`));
      const m = ent(h).match(/Edad:\s*(\d+)/); if (m) j.edad = +m[1]; 
      delete j.url;
    } catch { /* sin edad */ }
  });
  return equipos.filter(e => e.jugadores.length).sort((a, b) => catRank(a.categoria) - catRank(b.categoria) || a.nombre.localeCompare(b.nombre));
}

// ---------- Cluber ----------
const pick = (o: any, ...ks: string[]) => { for (const k of ks) { const v = k.split(".").reduce((a: any, x) => a == null ? a : a[x], o); if (v != null && v !== "") return v; } return undefined; };
const listOf = (j: any): any[] => Array.isArray(j) ? j : j?.["hydra:member"] || j?.member || j?.data || j?.items || j?.results || j?.players || [];
function edadDe(fecha: any): number | undefined {
  if (!fecha) return; const s = String(fecha); let d: Date | null = null;
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})/); const m2 = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m1) d = new Date(+m1[1], +m1[2] - 1, +m1[3]); else if (m2) d = new Date(+m2[3], +m2[2] - 1, +m2[1]);
  if (!d || isNaN(+d)) return; const t = new Date(); let a = t.getFullYear() - d.getFullYear();
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) a--; return a;
}
async function cluber(info: any) {
  // Cluber quiere el teléfono con 0034 delante
  const user = "0034" + (Deno.env.get("CLUBER_USER") || "").replace(/\D/g, "").slice(-9);
  const r = await fetch("https://api.cluber.es/api/authentication_token", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ username: user, password: (Deno.env.get("CLUBER_PASS") || "").trim() }) });
  const j = await r.json().catch(() => ({}));
  if (!j.token) throw new Error(r.status === 401 ? "Cluber: usuario o clave no válidos" : "Cluber: no se pudo entrar (" + r.status + ")");
  const H = { Authorization: "Bearer " + j.token, Accept: "application/json" };
  const get = async (p: string) => { const rr = await fetch("https://app.cluber.es" + p, { headers: H }); if (!rr.ok) throw new Error("Cluber " + p.split("?")[0] + ": " + rr.status); return rr.json(); };
  // El club: el primero donde la cuenta es gestora
  const groups = await get("/api/people-group-by-club");
  const clubs = listOf(groups).length ? listOf(groups) : Object.values(groups || {});
  const hashes = [...new Set(clubs.filter((c: any) => (c.persons || []).some((p: any) => p.type === "manager") || !c.persons).map((c: any) => pick(c, "club.id", "club.hash", "clubHash", "hash")).filter(Boolean))] as string[];
  if (!hashes.length) throw new Error("Cluber: no se encontró el club en la cuenta");
  info.cluberClub = hashes[0];
  const out: any[] = [];
  for (let page = 1; page <= 40; page++) {
    const res = await get(`/api/clubs/${hashes[0]}/players-full?page=${page}&limit=100`);
    const items = listOf(res); if (!items.length) break;
    for (const p of items) {
      const nombre = pick(p, "name", "firstName", "first_name", "person.name", "user.name") || "";
      const apellidos = pick(p, "surname", "surnames", "lastName", "last_name", "person.surname", "user.surname") || "";
      const full = (nombre + " " + apellidos).trim() || pick(p, "fullName", "full_name") || "";
      if (!full || p.enabled === false) continue;
      out.push({ nombre: full, edad: edadDe(pick(p, "birthdate", "birthDate", "birth_date", "person.birthdate", "user.birthdate")), equipo: pick(p, "team.customName", "team.name") || "", estado: p.status || "", pendientes: p.pendingCharges, renovacion: typeof p.renewalStatus === "object" ? p.renewalStatus?.id : p.renewalStatus });
    }
    const total = pick(res, "count", "hydra:totalItems", "totalItems", "total");
    if (total ? page * 100 >= total : items.length < 100) break;
  }
  info.cluberRenov = out.reduce((o: any, c: any) => { o[String(c.renovacion)] = (o[String(c.renovacion)] || 0) + 1; return o; }, {});
  info.cluberPago = out.reduce((o: any, c: any) => { o[c.estado] = (o[c.estado] || 0) + 1; return o; }, {});
  return out;
}

// ---------- Cruce ----------
// Futgal: "APELLIDO1 APELLIDO2, NOMBRE". Candidato en Cluber = tiene el nombre de pila y comparte
// el primer apellido (o todos). Gana quien comparte más apellidos; los repetidos en Cluber cuentan como uno.
// Con el nombre completo igual es «sí» aunque la edad no cuadre (se avisa: suele ser la fecha mal puesta).
// Si solo coincide en parte, la edad decide: con ±1 año es «sí»; si no, «no» (otra persona).
// Si quedan varias personas distintas, desempata la edad; si aun así hay varias, «revisar».
// Estado en Cluber (renewalStatus): 1 alta nueva y 2 renovado = «si» (pagando); 0 pendiente de renovar = «norenovado».
// Pago de la cuota (status de Cluber), solo para «si»: paid / paid-in-cash = pagado; unpaid / overdue = impagado;
// pending-payment, pending y signed = pendiente (cuota emitida o programada, aún no impagada); new y pending-sign = sin cuota.
function cruzar(equipos: any[], cl: any[]) {
  const C = cl.map(c => ({ ...c, tl: toks(c.nombre) })).map(c => ({ ...c, t: new Set(c.tl), k: c.tl.join(" ") }));
  // Cuántos apellidos de Futgal están en Cluber, contando repetidos (Álvarez Álvarez ≠ Álvarez Acuña)
  const comunes = (a: string[], b: string[]) => { const r = [...b]; let n = 0; for (const t of a) { const i = r.indexOf(t); if (i >= 0) { n++; r.splice(i, 1); } } return n; };
  for (const e of equipos) for (const j of e.jugadores) {
    const [ap, no] = j.nombre.includes(",") ? j.nombre.split(",") : ["", j.nombre];
    const tn = toks(no), ta = toks(ap);
    const scored = C.map(c => {
      if (!tn.length || !c.t.has(tn[0]) || !ta.length) return null;
      const sa = comunes(ta, c.tl);
      if (!sa || !(c.t.has(ta[0]) || sa === ta.length)) return null;
      const nombreOk = tn.every((t: string) => c.t.has(t));
      const full = sa === ta.length && nombreOk;
      const exacto = full && c.tl.length === tn.length + ta.length;
      const orden = ta.length > 1 && c.tl.indexOf(ta[0]) >= 0 && c.tl.indexOf(ta[0]) < c.tl.lastIndexOf(ta[ta.length - 1]) ? 1 : 0;
      return { c, full, exacto, score: sa * 10 + (nombreOk ? 5 : 0) + (exacto ? 3 : 0) + orden };
    }).filter(Boolean) as any[];
    const best = scored.length ? Math.max(...scored.map(x => x.score)) : 0;
    let cands = scored.filter(x => x.score === best);
    const edadOk = (x: any) => j.edad == null || x.c.edad == null || Math.abs(x.c.edad - j.edad) <= 1;
    // La misma persona dada de alta dos veces en Cluber cuenta como una
    const rep = cands.length > 1 && new Set(cands.map(x => x.c.k)).size < cands.length;
    const porNombre = new Map<string, any[]>(); for (const x of cands) porNombre.set(x.c.k, [...(porNombre.get(x.c.k) || []), x]);
    // De una persona repetida, mejor la ficha con la edad buena y que esté renovada o sea alta nueva
    const pref = (x: any) => (edadOk(x) ? 2 : 0) + (x.c.renovacion === 1 || x.c.renovacion === 2 ? 1 : 0);
    cands = [...porNombre.values()].map(g => [...g].sort((a, b) => pref(b) - pref(a))[0]);
    if (cands.length > 1) { const ok = cands.filter(edadOk); if (ok.length) cands = ok; }
    const nom = (x: any) => x.c.nombre.replace(/\s+/g, " ").trim() + (x.c.edad != null ? " (" + x.c.edad + ")" : "");
    delete j.nota; delete j.cluber; delete j.alta; delete j.pago;
    if (cands.length === 1) {
      const x = cands[0];
      if (edadOk(x) || x.exacto) {
        j.enCluber = x.c.renovacion === 0 ? "norenovado" : "si"; j.cluber = nom(x); j.cluberEquipo = x.c.equipo;
        j.alta = x.c.renovacion === 1 ? "Alta nueva" : x.c.renovacion === 2 ? "Renovado" : x.c.renovacion === 0 ? "No renovado" : "";
        if (j.enCluber === "si") { const st = x.c.estado; j.pago = /^paid/.test(st) ? "pagado" : /^(unpaid|overdue)$/.test(st) ? "impagado" : /^(pending-payment|pending|signed)$/.test(st) ? "pendiente" : "sincuota"; }
        const notas = [];
        if (!edadOk(x)) notas.push("en Cluber tiene otra edad (" + x.c.edad + "): revisa la fecha de nacimiento");
        if (rep) notas.push("está dado de alta dos veces en Cluber");
        if (notas.length) j.nota = notas.join("; ");
      } else if (x.full) { j.enCluber = "duda"; j.cluber = nom(x); j.nota = "el nombre cuadra pero la edad no"; }
      else { j.enCluber = "no"; j.cluber = nom(x); }
    } else if (cands.length > 1) { j.enCluber = "duda"; j.cluber = cands.map(nom).join(" · "); j.nota = "hay varios parecidos en Cluber"; }
    else j.enCluber = "no";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Solo quien tiene el módulo «fichas» en el panel
  const auth = req.headers.get("Authorization") || "";
  const userSb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: me } = await userSb.rpc("panel_me");
  if (!me || !(me.modulos || []).includes("fichas")) return new Response(JSON.stringify({ ok: false, error: "Sin permiso" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });

  const info: any = { fecha: new Date().toISOString(), ok: false };
  let equipos: any[] = [];
  try {
    equipos = await futgal(); info.futgal = equipos.reduce((n, e) => n + e.jugadores.length, 0);
    const cl = await cluber(info); info.cluber = cl.length;
    cruzar(equipos, cl);
    const { data: prev } = await sb.from("panel_docs").select("data").eq("col", "fichas").eq("id", "ultimo").maybeSingle();
    const antes = new Map<string, string>(), pagoAntes = new Map<string, string>();
    for (const e of prev?.data?.equipos || []) for (const j of e.jugadores || []) { antes.set(j.lic, j.enCluber); if (j.pago) pagoAntes.set(j.lic, j.pago); }
    if (prev?.data?.ok) for (const e of equipos) for (const j of e.jugadores) {
      const a = antes.get(j.lic);
      if (a == null) j.cambio = "nuevo en Futgal";
      else if (a !== j.enCluber) j.cambio = j.enCluber === "si" ? (a === "norenovado" ? "ha renovado en Cluber" : "ha entrado en Cluber") : j.enCluber === "norenovado" ? "ahora sale como no renovado" : j.enCluber === "no" ? "ya no aparece en Cluber" : "";
      else if (j.pago && pagoAntes.has(j.lic) && pagoAntes.get(j.lic) !== j.pago) j.cambio = j.pago === "pagado" ? "ha pagado la cuota" : j.pago === "impagado" ? "ahora tiene la cuota impagada" : "";
      if (!j.cambio) delete j.cambio;
    }
    if (prev?.data?.ok) await sb.from("panel_docs").upsert({ col: "fichas", id: "anterior", data: prev.data, updated_at: new Date().toISOString() });
    info.ok = true;
  } catch (e) { info.error = String((e as Error).message || e); }
  const all = equipos.flatMap(e => e.jugadores);
  info.si = all.filter(j => j.enCluber === "si").length; info.no = all.filter(j => j.enCluber === "no").length; info.duda = all.filter(j => j.enCluber === "duda").length; info.norenovado = all.filter(j => j.enCluber === "norenovado").length;
  info.impagados = all.filter(j => j.pago === "impagado").length;
  info.pagos = all.reduce((o: any, j: any) => { if (j.pago) o[j.pago] = (o[j.pago] || 0) + 1; return o; }, {});
  const data = { ...info, equipos };
  if (info.ok) { await sb.from("panel_docs").upsert({ col: "fichas", id: "ultimo", data, updated_at: new Date().toISOString() }); await sb.from("panel_docs").delete().eq("col", "fichas").eq("id", "_error"); }
  else await sb.from("panel_docs").upsert({ col: "fichas", id: "_error", data: info, updated_at: new Date().toISOString() });
  return new Response(JSON.stringify(info), { headers: { ...CORS, "Content-Type": "application/json" } });
});
