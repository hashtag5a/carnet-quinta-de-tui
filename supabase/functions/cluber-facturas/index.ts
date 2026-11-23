// Facturas que Cluber emite al club (comisión de servicio por los cobros que hacemos) y resumen de lo cobrado con Cluber. Se llama desde el panel
// («Estado de cuentas» → «Actualizar»). Trae todas las facturas, guarda los PDF nuevos en cuentas-docs/<temporada>/
// y deja el listado en panel_docs cuentas/cluber.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const API = "https://api.cluber.es";
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
// Temporada de julio a junio
const temporadaDe = (ym: string) => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return m >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Solo quien tiene el módulo «cuentas» en el panel
  const auth = req.headers.get("Authorization") || "";
  const userSb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const { data: me } = await userSb.rpc("panel_me");
  if (!me || !(me.modulos || []).includes("cuentas")) return json({ ok: false, error: "Sin permiso" }, 403);

  try {
    const user = "0034" + (Deno.env.get("CLUBER_USER") || "").replace(/\D/g, "").slice(-9);
    const lr = await fetch(API + "/api/authentication_token", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ username: user, password: (Deno.env.get("CLUBER_PASS") || "").trim() }) });
    const lj = await lr.json().catch(() => ({}));
    if (!lj.token) throw new Error("Cluber no deja entrar (" + lr.status + ")");
    const H = { Authorization: "Bearer " + lj.token, Accept: "application/ld+json" };

    const club = "64a6e5bad24f26c9d03649eaa142aeed9c0910b6"; // A Quinta de Tui Futsal en Cluber

    // Todas las facturas (páginas de 25)
    const todas: any[] = [];
    for (let page = 1; page <= 20; page++) {
      const r = await fetch(`${API}/api/account/clubs/${club}/invoices?page=${page}`, { headers: H });
      if (!r.ok) throw new Error("Cluber: facturas " + r.status);
      const j = await r.json(); const ms = j["hydra:member"] || [];
      todas.push(...ms);
      if (!ms.length || todas.length >= (j["hydra:totalItems"] || 0)) break;
    }

    const prev = (await sb.from("panel_docs").select("data").eq("col", "cuentas").eq("id", "cluber").maybeSingle()).data?.data || {};
    const docsPrev: Record<string, string> = Object.fromEntries((prev.facturas || []).filter((f: any) => f.doc).map((f: any) => [f.numero, f.doc]));
    let docsNuevos = 0;
    const facturas = [];
    for (const f of todas) {
      // Mes al que corresponde: la fecha del concepto («Factura para club … 31/08/2026»); si no, la de emisión
      const m = String(f.concept || "").match(/(\d\d)\/(\d\d)\/(20\d\d)/);
      const fecha = m ? `${m[3]}-${m[2]}-${m[1]}` : String(f.issueDate || "").slice(0, 10);
      const signo = f.invoiceType === "invoice" ? 1 : -1; // abonos en negativo
      const numero = String(f.number || f.hash);
      let doc = docsPrev[numero] || "";
      if (!doc) {
        const r = await fetch(`${API}/api/account/invoices/${f.hash}/download`, { headers: { Authorization: H.Authorization } });
        if (r.ok) {
          const path = `${temporadaDe(fecha.slice(0, 7))}/Cluber - Factura ${numero.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
          const { error } = await sb.storage.from("cuentas-docs").upload(path, new Uint8Array(await r.arrayBuffer()), { contentType: "application/pdf", upsert: true });
          if (!error) { doc = path; docsNuevos++; }
        }
      }
      facturas.push({
        numero, fecha, emision: String(f.issueDate || "").slice(0, 10), pago: f.paymentDate ? String(f.paymentDate).slice(0, 10) : null,
        neto: signo * (f.netAmount || 0) / 100, iva: signo * (f.taxAmount || 0) / 100, total: signo * (f.totalAmount || 0) / 100,
        estado: f.status, pagada: f.status === "paid", tipo: f.invoiceType, doc,
      });
    }
    facturas.sort((a, b) => a.fecha.localeCompare(b.fecha));

    // ---- Cobros hechos con Cluber (ingresos). Solo se guardan sumas, sin datos de personas ----
    // Cuenta lo cobrado con tarjeta o recibo en Cluber (llega al banco por Paymatico) y lo pagado en efectivo;
    // las transferencias que se apuntan a mano en Cluber ya salen en el banco y no se cuentan aquí.
    const cobrosRaw: any[] = [];
    for (let page = 1; page <= 200; page++) {
      const r = await fetch(`https://app.cluber.es/api/clubs/${club}/charges?page=${page}&limit=100`, { headers: { Authorization: H.Authorization, Accept: "application/json" } });
      if (!r.ok) throw new Error("Cluber: cobros " + r.status);
      const j = await r.json(); const ms = j.results || [];
      cobrosRaw.push(...ms);
      if (!ms.length || cobrosRaw.length >= (j.count || 0)) break;
    }
    const tipo = (d: string) => /campus|campamento|rafting/i.test(d) ? "campus"
      : /cuota socio|simpatizante|tarxeta/i.test(d) ? "socios"
      : /cuota|cota|mensual|[uú]nico|irm[aá]n|minis|predeporte|efectivo|transferencia/i.test(d) ? "cuotas" : "ventas";
    // Temporada de cada seasonId de Cluber: la que contiene la fecha mediana de sus cobros
    const porSeason: Record<string, string[]> = {};
    for (const c of cobrosRaw) if (c.seasonId != null) (porSeason[c.seasonId] ||= []).push(String(c.collectAt).slice(0, 7));
    const temSeason: Record<string, string> = {};
    for (const [k, v] of Object.entries(porSeason)) { v.sort(); temSeason[k] = temporadaDe(v[Math.floor(v.length / 2)]); }
    const agg: Record<string, any> = {};
    for (const c of cobrosRaw) {
      const d = String(c.description || ""), cat = tipo(d);
      if (c.paymentType === "OTHER" && !/efectivo/i.test(d)) continue; // transferencias apuntadas a mano: ya están en el banco
      const estado = c.status === "PAID" ? "cobrado" : c.status === "READY" ? "programado" : c.status === "ERROR" ? "impagado" : "";
      if (!estado || !c.amount) continue;
      const ym = String(c.collectAt).slice(0, 7);
      const t = cat === "cuotas" && c.seasonId != null ? temSeason[c.seasonId] : temporadaDe(ym);
      const key = [t, cat, ym, estado].join("|");
      (agg[key] ||= { t, cat, ym, estado, importe: 0, n: 0 });
      agg[key].importe = Math.round((agg[key].importe + c.amount / 100) * 100) / 100; agg[key].n++;
    }
    const cobros = Object.values(agg).sort((a: any, b: any) => a.ym.localeCompare(b.ym));
    const data = { facturas, cobros, actualizado: new Date().toISOString() };
    const { error } = await sb.from("panel_docs").upsert({ col: "cuentas", id: "cluber", data, updated_at: new Date().toISOString() }, { onConflict: "col,id" });
    if (error) throw error;
    return json({ ok: true, facturas: facturas.length, docsNuevos, cobros: cobrosRaw.length });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) });
  }
});
