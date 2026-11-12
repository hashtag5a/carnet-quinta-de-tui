// Bot de Correo Futgal: entra en la intranet, copia los correos no leídos al panel
// (panel_docs, col 'mails') y los vuelve a dejar como no leídos en Futgal.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";

const BASE = "https://intranet.futgal.es";
const LIST = "/nfg/NPcd/GCorreos_Listado?cod_primaria=1000193&cod_buzon=0&ModoCorreo=0";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

const jar = new Map<string, string>();
function keep(res: Response) {
  const all = (res.headers as any).getSetCookie ? (res.headers as any).getSetCookie() : [res.headers.get("set-cookie") || ""];
  for (const c of all) { const m = c.match(/^([^=;\s]+)=([^;]*)/); if (m) jar.set(m[1], m[2]); }
}
const cookie = () => [...jar].map(([k, v]) => k + "=" + v).join("; ");
async function go(path: string, init: RequestInit = {}, hops = 6): Promise<Response> {
  let url = path.startsWith("http") ? path : BASE + path;
  let opts: RequestInit = init;
  for (let i = 0; i < hops; i++) {
    const res = await fetch(url, { ...opts, redirect: "manual", headers: { ...(opts.headers || {}), "User-Agent": UA, Cookie: cookie() } });
    keep(res);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) { await res.body?.cancel(); url = new URL(loc, url).toString(); opts = {}; continue; }
    return res;
  }
  throw new Error("Demasiadas redirecciones");
}
const text = async (r: Response) => new TextDecoder("iso-8859-15").decode(await r.arrayBuffer());
const NAMED: Record<string, string> = { ntilde: "ñ", Ntilde: "Ñ", ccedil: "ç", Ccedil: "Ç", ordm: "º", ordf: "ª", iexcl: "¡", iquest: "¿", euro: "€", laquo: "«", raquo: "»", middot: "·", deg: "°", hellip: "…", ndash: "–", mdash: "—", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", bull: "•" };
const MARK: Record<string, string> = { acute: "\u0301", grave: "\u0300", uml: "\u0308", circ: "\u0302", tilde: "\u0303" };
const ent = (s: string) => s.replace(/&([a-zA-Z])(acute|grave|uml|circ|tilde);/g, (_, l, k) => (l + MARK[k]).normalize("NFC")).replace(/&([a-zA-Z]+);/g, (m, n) => NAMED[n] ?? m).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const strip = (s: string) => ent(s.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ")).replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

Deno.serve(async () => {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const estado = async (d: Record<string, unknown>) => { await sb.from("panel_docs").upsert({ col: "mails", id: "_estado", data: { ...d, fecha: new Date().toISOString() }, updated_at: new Date().toISOString() }); };
  try {
    const user = Deno.env.get("FUTGAL_USER"), pass = Deno.env.get("FUTGAL_PASS");
    const first = await go("/nfg/"); const firstHtml = await text(first);
    if (!user || !pass) { await estado({ ok: false, error: "Faltan el usuario y la contraseña de Futgal en Supabase.", alcanzable: first.status, login: firstHtml.includes("NLogin") }); return Response.json({ ok: false, reason: "sin credenciales", status: first.status }); }
    const login = await go("/nfg/NLogin", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ NUser: user, NPass: pass }).toString() });
    await text(login);
    const listRes = await go(LIST + "&NPcd_PageLines=50");
    const html = await text(listRes);
    if (!html.includes("Abrir_Correo(")) { await estado({ ok: false, error: "No se pudo entrar en Futgal (¿usuario o contraseña?)." }); return Response.json({ ok: false, reason: "login" }); }
    const rows = html.split(/<tr[\s>]/i).filter(r => r.includes("Abrir_Correo('GCorreos_Visualizacion"));
    const nuevos: string[] = [];
    for (const r of rows) {
      const id = (r.match(/cod_correo=(\d+)/) || [])[1]; if (!id) continue;
      const a = (r.match(/Abrir_Correo\([\s\S]*?<\/a>/) || [""])[0];
      const unread = /<b>/i.test(a); if (!unread) continue;
      const { data: ya } = await sb.from("panel_docs").select("id").eq("col", "mails").eq("id", id).maybeSingle();
      if (ya) continue;
      const cells = r.split(/<td[\s>]/i).map(c => strip(c.replace(/^[^>]*>/, "")));
      const fechas = (cells.find(c => /\d\d\/\d\d\/\d{4} \d\d:\d\d/.test(c)) || "").match(/\d\d\/\d\d\/\d{4} \d\d:\d\d/g) || [];
      const fIdx = cells.findIndex(c => /\d\d\/\d\d\/\d{4} \d\d:\d\d/.test(c));
      const remitente = fIdx >= 0 ? (cells.slice(fIdx + 1).find(c => c) || "") : "";
      const asunto = strip(a.replace(/^[^>]*>/, ""));
      const registro = ent((r.match(/title="(Registro[^"]*)"/) || [])[1] || "");
      const vRes = await go("/nfg/NPcd/GCorreos_Visualizacion?cod_primaria=1000193&cod_correo=" + id + "&ModoCorreo=0&Opcion=0");
      const v = await text(vRes);
      const i0 = v.search(/class="BG_TIT_PAG"\s+height/); const i1 = v.indexOf("Cerrar Ventana", i0);
      let cuerpo = strip(i0 >= 0 ? v.slice(v.indexOf(">", i0) + 1, i1 > 0 ? i1 : undefined) : v);
      // adjuntos: los del apartado Adjuntos y los enlaces a PDF dentro del texto
      const links: { href: string; nombre: string }[] = [];
      for (const m of v.matchAll(/<a[^>]*href=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi)) {
        const href = ent(m[1]); const nombre = strip(m[2]).replace(/\s*\([\d.,]+\s*KB\)\s*$/i, "").trim();
        if (/GCorreos_Descarga|DESGARGA_PDF|DESCARGA_PDF|\.pdf(\?|$)/i.test(href) && !links.some(l => l.href === href)) links.push({ href, nombre: nombre || "adjunto" });
      }
      const adjuntos: Record<string, unknown>[] = [];
      for (const [n, l] of links.slice(0, 6).entries()) {
        const item: Record<string, unknown> = { nombre: l.nombre };
        try {
          const res = await go(new URL(l.href, BASE + "/nfg/NPcd/").toString());
          const buf = new Uint8Array(await res.arrayBuffer());
          item.kb = Math.round(buf.length / 1024);
          if (buf.length > 15 * 1024 * 1024) { item.nota = "Demasiado grande para copiarlo."; adjuntos.push(item); continue; }
          const isPdf = buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46;
          const safe = l.nombre.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 80) || "adjunto";
          const path = "mails/" + id + "/" + (n + 1) + "-" + safe;
          const up = await sb.storage.from("futgal-adjuntos").upload(path, buf, { upsert: true, contentType: isPdf ? "application/pdf" : (res.headers.get("content-type") || "application/octet-stream") });
          if (!up.error) item.path = path;
          if (isPdf) {
            try {
              const pdf = await getDocumentProxy(buf);
              const { text: t, totalPages } = await extractText(pdf, { mergePages: true });
              const txt = String(t || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
              item.paginas = totalPages; item.texto = txt.slice(0, 15000);
              if (txt.length < 30) item.nota = "PDF escaneado: no tiene texto que leer.";
            } catch (_) { item.nota = "No se pudo leer el PDF."; }
          }
        } catch (_) { item.nota = "No se pudo descargar."; }
        adjuntos.push(item);
      }
      cuerpo = cuerpo.slice(0, 20000);
      // volver a dejarlo como no leído en Futgal
      await (await go(LIST + "&marcarCorreos=1&marca_leido=0&mc=" + id)).body?.cancel();
      await sb.from("panel_docs").upsert({ col: "mails", id, data: { asunto, remitente, fecha: fechas[0] || "", urgente: /title="Urgente"/.test(r), registro, cuerpo, adjuntos, titular: null, resumen: null, accion: null, estado: "nuevo", entrada: new Date().toISOString() } });
      nuevos.push(id);
    }
    await estado({ ok: true, nuevos: nuevos.length, revisados: rows.length });
    return Response.json({ ok: true, nuevos });
  } catch (e) {
    await estado({ ok: false, error: String(e && (e as Error).message || e) });
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
