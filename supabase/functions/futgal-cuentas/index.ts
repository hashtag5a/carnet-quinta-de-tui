// Estado de cuentas: gastos con la Federación (Futgal) de una temporada, con lo pagado y lo pendiente.
// Solo se lanza al pulsar el botón del panel. Fuentes en la intranet de Futgal:
//  - Liquidaciones: mutualidad de las licencias (se paga con tarjeta; el resto queda fraccionado).
//  - Fraccionamientos: plazos de esas liquidaciones, pagados o pendientes.
//  - Extracto de la cuenta del club: derechos de fichas, afiliación de técnicos, cuotas de equipo y club,
//    gastos de cada partido (arbitraje) y los pagos del club. Los pagos se aplican a lo más antiguo primero.
// Guarda cada liquidación en PDF y el extracto en el almacenamiento privado `cuentas-docs` (repositorio
// para subvenciones) y el resultado en panel_docs (col "cuentas", id "t_<temporada>" y "_estado").
import { createClient } from "jsr:@supabase/supabase-js@2";

const FUT = "https://intranet.futgal.es";
const CLAVE = "4583", COD_CLUB = "5232770";
const BUCKET = "cuentas-docs";
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
const MARK: Record<string, string> = { acute: "́", grave: "̀", uml: "̈", circ: "̂", tilde: "̃" };
const ent = (s: string) => s.replace(/&([a-zA-Z])(acute|grave|uml|circ|tilde);/g, (_, l, k) => (l + MARK[k]).normalize("NFC")).replace(/&ordf;/g, "ª").replace(/&ordm;/g, "º").replace(/&nbsp;/g, " ").replace(/&euro;/g, "€").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const clean = (s: string) => ent(s.replace(/<[^>]+>/g, " ")).replace(/[\s ]+/g, " ").trim();
const num = (s: string) => { const t = String(s || "").replace(/[^\d,.-]/g, ""); return t ? Math.round(parseFloat(t.replace(/\./g, "").replace(",", ".")) * 100) / 100 || 0 : 0; };
const iso = (d: string) => { const m = String(d).match(/(\d\d)-(\d\d)-(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };
const r2 = (n: number) => Math.round(n * 100) / 100;
// Filas de las tablas de una página: celdas ya limpias
const filas = (h: string) => h.split(/<tr[\s>]/i).slice(1).map(tr => [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1])));

// Concepto de cada movimiento del extracto
function concepto(t: string): string {
  const n = t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
  if (/^DCHOS?\b|DCHOS\. LIC|DERECHOS/.test(n)) return "fichas";
  if (/AFILIACION CGE/.test(n)) return "fichas";
  if (/CUOTA (EQUIPO|CLUB)/.test(n)) return "cuotas";
  if (/SANCION|MULTA/.test(n)) return "otros";
  if (/ -|- /.test(t)) return "arbitrajes"; // «LOCAL - VISITANTE»: gastos del partido
  return "otros";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Solo quien tiene el módulo «cuentas» en el panel
  const auth = req.headers.get("Authorization") || "";
  const userSb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: me } = await userSb.rpc("panel_me");
  if (!me || !(me.modulos || []).includes("cuentas")) return new Response(JSON.stringify({ ok: false, error: "Sin permiso" }), { status: 403, headers: { ...CORS, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({}));

  const info: any = { fecha: new Date().toISOString(), ok: false, docsNuevos: 0 };
  try {
    await text(await go("/nfg/"));
    await text(await go("/nfg/NLogin", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ NUser: Deno.env.get("FUTGAL_USER")!, NPass: Deno.env.get("FUTGAL_PASS")! }).toString() }));

    // ---- Temporada (la actual de Futgal, o la que se pida) ----
    const base = await text(await go("/nfg/NPcd/NFG_GC_LstLiquidaciones?cod_primaria=1000192"));
    const temporadas = Object.fromEntries([...base.matchAll(/<option value=(\d+)>(20\d\d-20\d\d)<\/option>/g)].map(m => [m[1], m[2]]));
    const actual = (base.match(/cod_temporada\.value=(\d+)/) || [])[1];
    const cod = String(body.temporada || actual || "");
    const nombre = temporadas[cod]; if (!nombre) throw new Error("Futgal: no encuentro la temporada " + cod);
    const y0 = +nombre.slice(0, 4), desde = `${y0}-07-01`, hasta = `${y0 + 1}-06-30`;
    info.temporada = nombre; info.cod = cod;

    // ---- Liquidaciones ----
    const lh = await text(await go(`/nfg/NPcd/NFG_GC_LstLiquidaciones?cod_primaria=1000192&siguiente_vez=1&cod_temporada=${cod}&Sch_Codigo_Equipo=`));
    // Tabla principal: filas que empiezan por la clave del club (la segunda tabla empieza por la fecha)
    const t1 = lh.slice(Math.max(0, lh.search(/Liquidaci(?:&oacute;|ó|o)n vinculada/i)));
    const liqs: any[] = [];
    for (const c of filas(t1)) {
      if (c.length < 15 || c[0] !== CLAVE || !/^LC\d+$/.test(c[4])) continue;
      liqs.push({ fecha: iso(c[2]), tipo: c[3], liq: c[4], drchos: num(c[7]), incremento: num(c[8]), recibo: num(c[9]), tramitacion: num(c[10]), mutualidad: num(c[11]), pagos: num(c[12]), total: num(c[13]), forma: c[14] === "---" ? "" : c[14] });
    }
    info.liquidaciones = liqs.length;

    // ---- Fraccionamientos (plazos de las liquidaciones) ----
    const fh = await text(await go(`/nfg/NPcd/NFG_GC_LstFraccionamientos?cod_primaria=1000552&que_club=${COD_CLUB}&buscar=1&Sch_estado=&Sch_temporada=${cod}&NPcd_PageLines=500`));
    const fracc: any[] = [];
    for (const c of filas(fh)) if (c.length >= 6 && /^LC\d+$/.test(c[0]) && /\d\d-\d\d-\d{4}/.test(c[1])) fracc.push({ liq: c[0], importe: num(c[2]), limite: iso(c[3]), estado: /pendiente/i.test(c[5]) ? "pendiente" : "pagado" });

    const items: any[] = [];
    for (const l of liqs) {
      const fs = fracc.filter(f => f.liq === l.liq);
      const fPend = r2(fs.filter(f => f.estado === "pendiente").reduce((s, f) => s + f.importe, 0));
      const fPag = r2(fs.filter(f => f.estado === "pagado").reduce((s, f) => s + f.importe, 0));
      const cargos = r2(l.mutualidad + l.drchos + l.tramitacion);
      if (/mutualidad/i.test(l.tipo)) {
        if (!cargos && !l.total) continue; // liquidaciones a cero (altas sin coste)
        const pagado = r2(l.total + fPag), pendiente = fPend;
        const importe = Math.max(cargos, r2(pagado + pendiente));
        items.push({ id: l.liq, fecha: l.fecha, concepto: "mutualidad", descripcion: "Mutualidad · liquidación " + l.liq, importe, pagado, pendiente: r2(importe - pagado),
          plazos: fs.map(f => ({ importe: f.importe, vence: f.limite, estado: f.estado })), forma: l.forma, liq: l.liq });
      } else if (l.total || l.incremento || l.recibo) {
        // Liquidaciones de Federación: son pagos a la cuenta del club (ya salen en el extracto)
        items.push({ id: l.liq, fecha: l.fecha, concepto: "pagos", descripcion: "Pago a la Federación · liquidación " + l.liq, importe: r2(l.total || l.incremento + l.recibo), pagado: r2(l.total), pendiente: 0, forma: l.forma, liq: l.liq });
      }
    }

    // ---- Extracto de la cuenta del club (todas las temporadas, en orden inverso) ----
    const xh = await text(await go(`/nfg/NPcd/NFG_GC_LstSaldosInfo?cod_primaria=1000192&clave_acceso=${CLAVE}`));
    const movs: any[] = [];
    for (const c of filas(xh)) if (c.length >= 5 && /^\d\d-\d\d-\d{4}$/.test(c[0])) movs.push({ fecha: iso(c[0]), texto: c[1], debe: Math.abs(num(c[2])), haber: Math.abs(num(c[3])), saldo: num(c[4]) });
    movs.reverse(); // del más antiguo al más reciente
    // Cierre y apertura del año contable: cada cierre y la apertura que le sigue se anulan entre sí.
    // Una apertura sin cierre delante es el saldo con el que empieza el historial: se queda como cargo.
    const movsR: any[] = []; let cierre = false;
    for (const m of movs) {
      if (/^CIERRE CONTABILIDAD/i.test(m.texto.trim())) { cierre = true; continue; }
      if (/^APERTURA/i.test(m.texto.trim()) && cierre) { cierre = false; continue; }
      movsR.push(m);
    }
    // Aplicar cada pago a la deuda más antigua (FIFO) para saber qué cargo queda pendiente
    const cola: any[] = []; let favor = 0;
    for (const m of movsR) {
      if (m.debe) { const it = { ...m, pend: m.debe }; if (favor > 0) { const x = Math.min(favor, it.pend); it.pend = r2(it.pend - x); favor = r2(favor - x); } cola.push(it); }
      if (m.haber) { let h = m.haber; for (const it of cola) { if (h <= 0) break; if (it.pend <= 0) continue; const x = Math.min(h, it.pend); it.pend = r2(it.pend - x); h = r2(h - x); } favor = r2(favor + h); }
    }
    const anteriores = r2(cola.filter(it => it.fecha < desde).reduce((s, it) => s + it.pend, 0));
    let i = 0;
    for (const it of cola.filter(it => it.fecha >= desde && it.fecha <= hasta)) {
      const cpt = concepto(it.texto);
      items.push({ id: "x" + (++i) + "_" + it.fecha, fecha: it.fecha, concepto: cpt, descripcion: it.texto, importe: it.debe, pagado: r2(it.debe - it.pend), pendiente: it.pend, origen: "extracto" });
    }
    for (const m of movsR.filter(m => m.haber && m.fecha >= desde && m.fecha <= hasta && !items.some(x => x.concepto === "pagos" && x.fecha === m.fecha && Math.abs(x.pagado - m.haber) < 0.01)))
      items.push({ id: "p" + (++i) + "_" + m.fecha, fecha: m.fecha, concepto: /AXUDA|AYUDA|SUBVENC/i.test(m.texto) ? "ayudas" : "pagos", descripcion: m.texto, importe: m.haber, pagado: m.haber, pendiente: 0, origen: "extracto" });
    const ultimo = movs[movs.length - 1];
    info.saldoCuenta = ultimo ? ultimo.saldo : 0; // negativo = el club debe a la Federación
    info.pendienteAnteriores = anteriores >= 0.05 ? anteriores : 0;

    // ---- Repositorio de documentos (PDF) ----
    const carpeta = nombre;
    const { data: ya } = await sb.storage.from(BUCKET).list(carpeta, { limit: 1000 });
    const existe = new Set((ya || []).map((f: any) => f.name));
    const subir = async (url: string, nombreArchivo: string, siempre = false) => {
      if (!siempre && existe.has(nombreArchivo)) return carpeta + "/" + nombreArchivo;
      const r = await go(url); const buf = new Uint8Array(await r.arrayBuffer());
      if (!/pdf/i.test(r.headers.get("content-type") || "") || buf.length < 500) return "";
      const { error } = await sb.storage.from(BUCKET).upload(carpeta + "/" + nombreArchivo, buf, { contentType: "application/pdf", upsert: true });
      if (error) { info.errores = [...(info.errores || []), nombreArchivo + ": " + error.message]; return ""; }
      if (!existe.has(nombreArchivo)) info.docsNuevos++;
      return carpeta + "/" + nombreArchivo;
    };
    for (const it of items.filter(x => x.liq)) it.doc = await subir(`/nfg/NPcd/NFG_GC_VisLiquidacion?cod_primaria=1000192&cod_liquidacion=${it.liq.replace(/\D/g, "")}&cod_temporada=${cod}&nueva_ventana=1&NPcd_Pdf=1`, `Liquidacion ${it.liq}.pdf`);
    const extracto = await subir(`/nfg/NPcd/NFG_GC_LstSaldosInfo?cod_primaria=1000192&clave_acceso=${CLAVE}&NPcd_Pdf=1`, "Extracto cuenta club.pdf", true);
    for (const it of items.filter(x => x.origen === "extracto")) it.doc = extracto;

    // ---- Resumen ----
    const conceptos = ["mutualidad", "fichas", "cuotas", "arbitrajes", "otros"];
    const resumen: any = {};
    for (const k of conceptos) { const xs = items.filter(x => x.concepto === k); resumen[k] = { importe: r2(xs.reduce((s, x) => s + x.importe, 0)), pagado: r2(xs.reduce((s, x) => s + x.pagado, 0)), pendiente: r2(xs.reduce((s, x) => s + x.pendiente, 0)), n: xs.length }; }
    resumen.total = { importe: r2(conceptos.reduce((s, k) => s + resumen[k].importe, 0)), pagado: r2(conceptos.reduce((s, k) => s + resumen[k].pagado, 0)), pendiente: r2(conceptos.reduce((s, k) => s + resumen[k].pendiente, 0)) };
    items.sort((a, b) => b.fecha.localeCompare(a.fecha));
    info.ok = true; info.resumen = resumen;
    await sb.from("panel_docs").upsert({ col: "cuentas", id: "t_" + nombre, data: { ...info, desde, hasta, items, extracto }, updated_at: new Date().toISOString() });
  } catch (e) { info.error = String((e as Error).message || e); }
  await sb.from("panel_docs").upsert({ col: "cuentas", id: "_estado", data: info, updated_at: new Date().toISOString() });
  return new Response(JSON.stringify(info), { headers: { ...CORS, "Content-Type": "application/json" } });
});
