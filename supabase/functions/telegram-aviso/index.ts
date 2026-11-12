// Avisa en el grupo de Telegram de cada correo nuevo de Futgal ya resumido.
// Busca solo el grupo (al añadir el bot) y lo guarda en panel_docs (mails/_telegram).
import { createClient } from "jsr:@supabase/supabase-js@2";
const PANEL = "https://hashtag5a.github.io/carnet-quinta-de-tui/panel/#mails";
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async () => {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return Response.json({ ok: false, reason: "falta TELEGRAM_BOT_TOKEN" });
  const tg = (m: string, body: unknown) => fetch(`https://api.telegram.org/bot${token}/${m}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: cfgRow } = await sb.from("panel_docs").select("data").eq("col", "mails").eq("id", "_telegram").maybeSingle();
  let cfg = (cfgRow?.data || {}) as Record<string, unknown>;
  // descubrir el grupo
  const upd = await tg("getUpdates", { allowed_updates: ["message", "my_chat_member"] });
  for (const u of (upd.result || [])) {
    const chat = u.my_chat_member?.chat || u.message?.chat;
    if (chat && (chat.type === "group" || chat.type === "supergroup")) {
      const leftNow = u.my_chat_member && ["left", "kicked"].includes(u.my_chat_member.new_chat_member?.status);
      if (!leftNow && cfg.chat_id !== chat.id) {
        cfg = { chat_id: chat.id, titulo: chat.title };
        await sb.from("panel_docs").upsert({ col: "mails", id: "_telegram", data: cfg });
        await tg("sendMessage", { chat_id: chat.id, text: "Hola. Aquí avisaré de cada correo nuevo de Futgal con su titular y resumen." });
      }
    }
    // la migración de grupo a supergrupo cambia el id
    if (u.message?.migrate_to_chat_id) { cfg = { ...cfg, chat_id: u.message.migrate_to_chat_id }; await sb.from("panel_docs").upsert({ col: "mails", id: "_telegram", data: cfg }); }
  }
  if (upd.result?.length) await tg("getUpdates", { offset: upd.result[upd.result.length - 1].update_id + 1 });
  if (!cfg.chat_id) return Response.json({ ok: false, reason: "el bot aún no está en ningún grupo" });

  const { data: rows } = await sb.from("panel_docs").select("id,data,updated_at").eq("col", "mails");
  const ahora = Date.now(); let enviados = 0;
  for (const r of rows || []) {
    if (String(r.id).startsWith("_")) continue;
    const m = r.data as Record<string, any>;
    if (m.avisado) continue;
    const viejo = m.entrada && ahora - Date.parse(m.entrada) > 3 * 3600e3;
    if (!m.resumen && !viejo) continue; // espera al resumen (máx. 3 h)
    const adj = (m.adjuntos || []).length;
    const txt = [
      (m.urgente ? "🔴 " : "📬 ") + "<b>" + esc(m.titular || m.asunto) + "</b>",
      m.accion ? "👉 " + esc(m.accion) : "",
      esc(m.resumen || String(m.cuerpo || "").slice(0, 300)),
      adj ? "📎 " + adj + (adj === 1 ? " adjunto" : " adjuntos") : "",
      `<a href="${PANEL}">Ver todo en el panel</a>`,
    ].filter(Boolean).join("\n\n");
    const res = await tg("sendMessage", { chat_id: cfg.chat_id, text: txt, parse_mode: "HTML", disable_web_page_preview: true });
    if (res.ok) { await sb.from("panel_docs").update({ data: { ...m, avisado: new Date().toISOString() } }).eq("col", "mails").eq("id", r.id); enviados++; }
  }
  return Response.json({ ok: true, enviados, grupo: cfg.titulo });
});
