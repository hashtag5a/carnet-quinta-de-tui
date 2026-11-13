// Bot de escudos: entra en Futgal y guarda el escudo de los rivales de los próximos partidos
// de A Quinta (y el nuestro) que todavía no tengamos.
//  1. Lee nuestros partidos de los próximos días en el buscador de partidos: cada fila trae los
//     códigos de club local y visitante (en «camisetas(clubCasa, eqCasa, clubFuera, eqFuera)»).
//  2. Lee el listado de clubes de Futgal, que trae el escudo de cada club.
//  3. Sube los escudos que falten al almacenamiento público «escudos» y los apunta en panel_docs
//     (col «escudos», id = código de club de Futgal). Los recoge tools/carteles/generar.py.
// Cuerpo opcional: { dias: 10, todos: false, extra: ["/nfg/..."] (solo diagnóstico) }
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
const ent = (s: string) => s.replace(/&([a-zA-Z])(acute|grave|uml|circ|tilde);/g, (_, l, k) => (l + MARK[k]).normalize("NFC")).replace(/&ordf;/g, "ª").replace(/&ordm;/g, "º").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const clean = (s: string) => ent(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dmy = (s: string) => s.slice(8, 10) + "-" + s.slice(5, 7) + "-" + s.slice(0, 4);
// Club del rival, sin patrocinador ni letra: 'S.D. ABETOS FS - LEYENDAS "C"' → 'S.D. ABETOS FS'
const clubDe = (s: string) => String(s || "").split(/\s+-\s*|\s*-\s+/)[0].replace(/["'][A-Z]["']\s*$/, "").replace(/\s+/g, " ").trim();

Deno.serve(async (req) => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const opts = await req.json().catch(() => ({}));
  const informe: Record<string, any> = { fecha: new Date().toISOString(), nuevos: [], yaTenia: 0, sinEscudoEnFutgal: [], sinCodigo: [], errores: [] };
  try {
    await sb.storage.createBucket("escudos", { public: true }).catch(() => null);
    await text(await go("/nfg/"));
    await text(await go("/nfg/NLogin", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ NUser: Deno.env.get("FUTGAL_USER")!, NPass: Deno.env.get("FUTGAL_PASS")! }).toString() }));

    if (opts.extra) { // diagnóstico
      const out: any = {};
      for (const u of opts.extra) { const h = await text(await go(u)); const q = h.indexOf(opts.buscar || "@@"); out[u] = { len: h.length, cerca: q < 0 ? "" : h.slice(Math.max(0, q - 1500), q + 1500) }; }
      await sb.from("panel_docs").upsert({ col: "_debug", id: "escudos", data: out });
      return Response.json({ ok: true, diagnostico: true });
    }

    // 1. Nuestros partidos de los próximos días: código de partido → [club local, club visitante]
    const hoy = iso(new Date()), hasta = iso(new Date(Date.now() + (opts.dias || 10) * 864e5));
    const lst = await text(await go(`/nfg/NPcd/NFG_LstPartidos?cod_primaria=1000139&Consulta=1&Sch_Cod_Temporada=22&Sch_Clave_Acceso_Club=${CLUB}&Sch_Fecha_Desde=${dmy(hoy)}&Sch_Fecha_Hasta=${dmy(hasta)}&NPcd_PageLines=200`));
    const clubes = new Map<string, [string, string]>();
    for (const chunk of lst.split(/<tr[\s>]/i)) {
      const tds = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1]);
      if (tds.length < 2) continue;
      const cod = clean(tds[0]); if (!/^\d+$/.test(cod)) continue;
      const cam = chunk.match(/camisetas\((\d+)\s*,\s*\d+\s*,\s*(\d+)\s*,/);
      if (cam) clubes.set(cod, [cam[1], cam[2]]);
    }

    // 2. Partidos del panel y escudos que ya tenemos
    const { data: docs } = await sb.from("panel_docs").select("col,id,data").in("col", ["partidos", "escudos"]);
    const tengo = new Set<string>();
    const quiero = new Map<string, string>(); // código de club → nombre
    for (const d of (docs || []) as any[]) {
      if (d.col === "escudos") { tengo.add(d.id); continue; }
      const p = d.data; if (!p?.codPartido || !(p.fecha >= hoy && p.fecha <= hasta)) continue;
      const cc = clubes.get(String(p.codPartido));
      if (!cc) { informe.sinCodigo.push(`${p.rival} (${p.codPartido})`); continue; }
      const rival = p.casa ? cc[1] : cc[0];
      if (rival !== CLUB) quiero.set(rival, clubDe(p.rival));
    }
    quiero.set(CLUB, "A QUINTA TUI F.S.");
    const faltan = [...quiero].filter(([c]) => opts.todos || !tengo.has(c));
    informe.yaTenia = quiero.size - faltan.length;

    if (faltan.length) {
      // 3. Listado de clubes de Futgal: código → escudo
      const html = await text(await go("/nfg/NPcd/NFG_Clubes?cod_primaria=240&cod_estado_activo=1&Buscar=1&NPcd_PageLines=6000"));
      const escudo = new Map<string, { src: string; nombre: string }>();
      for (const row of html.split(/<tr[\s>]/i)) {
        const img = row.match(/<img[^>]+src=["']([^"']*pimg\/Clubes\/[^"']+)["']/i);
        const cod = row.match(/<td[^>]*>\s*(?:&nbsp;)?\s*(\d{3,7})\s*<\/td>/i);
        const ver = row.match(/javascript:Ver\((\d+)\)[^>]*>\s*<strong>([\s\S]*?)<\/strong>/i);
        if (img && cod) escudo.set(cod[1], { src: img[1], nombre: ver ? clean(ver[2]) : "" });
      }
      informe.clubesFutgal = escudo.size;
      for (const [cod, nombre] of faltan) {
        const e = escudo.get(cod);
        if (!e) { informe.sinEscudoEnFutgal.push(`${nombre} (club ${cod})`); continue; }
        try {
          const res = await go(new URL(e.src, BASE + "/nfg/").toString());
          const tipo = (res.headers.get("content-type") || "").toLowerCase();
          const buf = new Uint8Array(await res.arrayBuffer());
          if (!res.ok || !tipo.startsWith("image/") || buf.length < 200) { informe.sinEscudoEnFutgal.push(`${nombre} (club ${cod})`); continue; }
          const ext = /jpe?g/.test(tipo) ? "jpg" : tipo.includes("gif") ? "gif" : tipo.includes("webp") ? "webp" : "png";
          const path = `${cod}.${ext}`;
          const up = await sb.storage.from("escudos").upload(path, buf, { contentType: tipo, upsert: true });
          if (up.error) { informe.errores.push(`${nombre}: ${up.error.message}`); continue; }
          await sb.from("panel_docs").upsert({ col: "escudos", id: cod, data: { nombre, nombreFutgal: e.nombre, propio: cod === CLUB, path, fuente: "Futgal", actualizado: new Date().toISOString() } });
          informe.nuevos.push(nombre);
        } catch (err) { informe.errores.push(`${nombre}: ${String((err as Error)?.message || err)}`); }
      }
    }
    informe.ok = true;
  } catch (e) { informe.ok = false; informe.error = String((e as Error)?.message || e); }
  await sb.from("panel_docs").upsert({ col: "config", id: "futgal_escudos", data: informe });
  return Response.json(informe);
});
