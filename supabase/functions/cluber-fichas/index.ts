// Fichas vs Cluber: entra en Futgal, saca los jugadores con licencia de cada equipo del club (con su edad)
// y los busca en Cluber por nombre (la edad desempata). La categoría de Cluber no se usa: manda Futgal.
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
    const i1 = rest.search(/(Delegados|Entrenadores|T[ée]cnicos|Auxiliares) \(\d+\)/);
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
  const user = (Deno.env.get("CLUBER_USER") || "").replace(/\D/g, "");
  const r = await fetch("https://api.cluber.es/api/authentication_token", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ username: user, password: (Deno.env.get("CLUBER_PASS") || "").trim() }) });
  const j = await r.json().catch(() => ({}));
  if (!j.token) throw new Error(r.status === 401 ? "Cluber: usuario o clave no válidos" : "Cluber: no se pudo entrar (" + r.status + ")");
  const H = { Authorization: "Bearer " + j.token, Accept: "application/json" };
  const get = async (p: string) => { const rr = await fetch("https://app.cluber.es" + p, { headers: H }); if (!rr.ok) throw new Error("Cluber " + p.split("?")[0] + ": " + rr.status); return rr.json(); };
  // El club: el primero donde la cuenta es gestora
  const groups = await get("/api/people-group-by-club");
  const clubs = listOf(groups).length ? listOf(groups) : Object.values(groups || {});
  const hashes = [...new Set(clubs.map((c: any) => pick(c, "club.hash", "clubHash", "hash", "club.clubHash")).filter(Boolean))] as string[];
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
      const baja = pick(p, "deleted", "deletedAt", "deleted_at", "removedAt");
      if (!full || baja) continue;
      out.push({ nombre: full, edad: edadDe(pick(p, "birthdate", "birthDate", "birth_date", "person.birthdate", "user.birthdate")), equipo: pick(p, "team.name", "teams.0.name", "category.name") || "" });
    }
    const total = pick(res, "hydra:totalItems", "totalItems", "total", "meta.total");
    if (items.length < 100 || (total && out.length >= total)) break;
  }
  return out;
}

// ---------- Cruce ----------
// Futgal: "APELLIDO1 APELLIDO2, NOMBRE". Mismo jugador = mismo nombre de pila y comparten al menos
// el primer apellido (o todos los apellidos de uno están en el otro). Si hay varios, desempata la edad.
function cruzar(equipos: any[], cl: any[]) {
  const C = cl.map(c => ({ ...c, t: new Set(toks(c.nombre)) }));
  for (const e of equipos) for (const j of e.jugadores) {
    const [ap, no] = j.nombre.includes(",") ? j.nombre.split(",") : ["", j.nombre];
    const tn = toks(no), ta = toks(ap);
    let cands = C.filter(c => tn.length && tn.every((t: string) => c.t.has(t)) && ta.length && (c.t.has(ta[0]) || ta.every((t: string) => c.t.has(t))));
    if (!cands.length) cands = C.filter(c => tn.length && c.t.has(tn[0]) && ta.filter((t: string) => c.t.has(t)).length >= Math.min(2, ta.length) && ta.length > 0);
    if (cands.length > 1 && j.edad != null) { const byAge = cands.filter(c => c.edad != null && Math.abs(c.edad - j.edad) <= 1); if (byAge.length) cands = byAge; }
    if (cands.length === 1) { j.enCluber = "si"; j.cluber = cands[0].nombre; }
    else if (cands.length > 1) { j.enCluber = "duda"; j.cluber = cands.map(c => c.nombre + (c.edad != null ? " (" + c.edad + ")" : "")).join(" · "); }
    else j.enCluber = "no";
    if (j.enCluber === "si" && j.edad != null && cands[0].edad != null && Math.abs(cands[0].edad - j.edad) > 1) { j.enCluber = "duda"; j.cluber += " (edad " + cands[0].edad + ")"; }
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
    const antes = new Map<string, string>();
    for (const e of prev?.data?.equipos || []) for (const j of e.jugadores || []) antes.set(j.lic, j.enCluber);
    if (prev?.data?.ok) for (const e of equipos) for (const j of e.jugadores) {
      const a = antes.get(j.lic);
      if (a == null) j.cambio = "nuevo en Futgal"; else if (a !== "si" && j.enCluber === "si") j.cambio = "ha entrado en Cluber"; else if (a === "si" && j.enCluber !== "si") j.cambio = "ya no aparece en Cluber";
    }
    if (prev?.data?.ok) await sb.from("panel_docs").upsert({ col: "fichas", id: "anterior", data: prev.data, updated_at: new Date().toISOString() });
    info.ok = true;
  } catch (e) { info.error = String((e as Error).message || e); }
  const all = equipos.flatMap(e => e.jugadores);
  info.si = all.filter(j => j.enCluber === "si").length; info.no = all.filter(j => j.enCluber === "no").length; info.duda = all.filter(j => j.enCluber === "duda").length;
  const data = { ...info, equipos };
  if (info.ok) await sb.from("panel_docs").upsert({ col: "fichas", id: "ultimo", data, updated_at: new Date().toISOString() });
  else await sb.from("panel_docs").upsert({ col: "fichas", id: "_error", data: info, updated_at: new Date().toISOString() });
  return new Response(JSON.stringify(info), { headers: { ...CORS, "Content-Type": "application/json" } });
});
