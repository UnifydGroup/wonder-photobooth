import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") || "";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "";
const EMAIL_ENABLED = !!(RESEND_KEY && EMAIL_FROM);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-staff-key, x-cron-key, authorization, apikey",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FRAMES = ["classic", "polaroid", "bold", "minimal"];
const MAX_FAILS = 30, FAIL_WINDOW_MIN = 15;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const clean = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function safeEqual(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}
async function secret(key: string) {
  const { data } = await db.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value as string | undefined;
}
const clientIp = (req: Request) =>
  (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

// Returns "ok" | "denied" | "locked"
// Superadmin passcode = full access (and runs booths). Client passcode = brand kit + stats only.
type Role = "superadmin" | "client" | "operator";
const PASS_KEYS = { superadmin: "staff_passcode_sha256", client: "client_passcode_sha256", operator: "operator_passcode_sha256" } as const;
// Is this passcode hash already used by another role?
async function passClash(h: string, own: keyof typeof PASS_KEYS) {
  for (const [r, k] of Object.entries(PASS_KEYS)) {
    if (r === own) continue;
    const v = await secret(k);
    if (v && safeEqual(h, v)) return r;
  }
  return null;
}
async function staffCheck(req: Request): Promise<Role | "denied" | "locked"> {
  const ip = clientIp(req);
  const since = new Date(Date.now() - FAIL_WINDOW_MIN * 60000).toISOString();
  const { count } = await db.from("auth_failures").select("*", { count: "exact", head: true }).eq("ip", ip).gte("created_at", since);
  if ((count || 0) >= MAX_FAILS) return "locked";
  const key = req.headers.get("x-staff-key") || "";
  if (key) {
    const h = await sha256(key);
    const sup = await secret("staff_passcode_sha256");
    if (sup && safeEqual(h, sup)) return "superadmin";
    const cli = await secret("client_passcode_sha256");
    if (cli && safeEqual(h, cli)) return "client";
    const op = await secret("operator_passcode_sha256");
    if (op && safeEqual(h, op)) return "operator";
  }
  await db.from("auth_failures").insert({ ip });
  return "denied";
}
// What a client admin may change (brand kit only); everything else is kept as is.
const CLIENT_BRAND_KEYS = ["app_name", "app_hashtag", "app_logo", "event_logo", "colors", "start_headline", "start_sub", "qr_headline", "guest_headline", "guest_intro", "optin_text", "terms_url"];
// What a brand profile stores
const PROFILE_KEYS = ["event_name", "event_hashtag", ...CLIENT_BRAND_KEYS, "frames"];
function normProfile(d: any) {
  d = d && typeof d === "object" ? d : {};
  const b = normBranding(d);
  const out: Record<string, unknown> = { event_name: textOr(d.event_name, 60, "Event"), event_hashtag: textOr(d.event_hashtag, 60, "") };
  for (const k of CLIENT_BRAND_KEYS) out[k] = (b as any)[k];
  out.frames = normFrames(d.frames);
  return out;
}
const SUPER_ONLY = [/^\/heartbeat$/, /^\/upload$/, /^\/admin\/photo\//, /^\/admin\/booth\//, /^\/admin\/passcode$/, /^\/admin\/client-passcode$/, /^\/admin\/operator-passcode$/, /^\/admin\/profiles/];
const OPERATOR_OK = ["/auth", "/heartbeat", "/upload"];

// ---------- Branding / config ----------
const ASSET_BASE = `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/branding/`;
const TEMPLATES = ["classic", "polaroid", "bold", "minimal"];
const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_BRANDING = {
  app_name: "Wonder", app_hashtag: "#WonderMoments", app_logo: "", event_logo: "",
  colors: { accent: "#FF5A36", background: "#0E0E12", text: "#F5EFE6" },
  start_headline: "Ready when you are", start_sub: "Tap to start the booth",
  qr_headline: "Scan to get your photo", countdown: 5,
  guest_headline: "Your photo is ready",
  guest_intro: "Pop in your details to unlock your photo, then share it straight to Instagram or Facebook.",
  optin_text: "Yes, send me news and offers. You can unsubscribe at any time.",
  terms_url: "",
  staff_menu_lock: false,
};
const tpl = (id: string, name: string, bg: string, fg: string, accent: string) =>
  ({ id, name, kind: "template", template: id, enabled: true, bg, fg, accent, title: "{event_name}", subtitle: "{event_hashtag}", event_logo: true, app_logo: false, overlay: "" });
const DEFAULT_FRAMES = [
  tpl("classic", "Classic", "#FFFFFF", "#111111", "#FF5A36"),
  tpl("polaroid", "Polaroid", "#F5EFE6", "#2B2522", "#8A7F76"),
  tpl("bold", "Bold", "#0E0E12", "#FFFFFF", "#FF5A36"),
  tpl("minimal", "Minimal", "#000000", "#FFFFFF", "#FFFFFF"),
];
const color = (v: unknown, d: string) => (typeof v === "string" && HEX.test(v) ? v : d);
const assetUrl = (v: unknown) => (typeof v === "string" && v.startsWith(ASSET_BASE) && !v.includes("..") ? v.slice(0, 300) : "");
const httpsUrl = (v: unknown) => {
  try { const u = new URL(String(v)); return u.protocol === "https:" ? u.href.slice(0, 300) : ""; } catch { return ""; }
};
const textOr = (v: unknown, max: number, d: string) => (typeof v === "string" ? v.trim().slice(0, max) : d);

function normBranding(b: any) {
  const d = DEFAULT_BRANDING;
  b = b && typeof b === "object" ? b : {};
  const c = b.colors && typeof b.colors === "object" ? b.colors : {};
  return {
    app_name: textOr(b.app_name, 60, d.app_name),
    app_hashtag: textOr(b.app_hashtag, 60, d.app_hashtag),
    app_logo: assetUrl(b.app_logo),
    event_logo: assetUrl(b.event_logo),
    colors: { accent: color(c.accent, d.colors.accent), background: color(c.background, d.colors.background), text: color(c.text, d.colors.text) },
    start_headline: textOr(b.start_headline, 80, d.start_headline),
    start_sub: textOr(b.start_sub, 120, d.start_sub),
    qr_headline: textOr(b.qr_headline, 80, d.qr_headline),
    countdown: Math.min(10, Math.max(3, parseInt(b.countdown, 10) || d.countdown)),
    guest_headline: textOr(b.guest_headline, 80, d.guest_headline),
    guest_intro: textOr(b.guest_intro, 300, d.guest_intro),
    optin_text: textOr(b.optin_text, 200, d.optin_text),
    terms_url: b.terms_url ? httpsUrl(b.terms_url) : "",
    staff_menu_lock: b.staff_menu_lock === true,
  };
}
function normFrames(list: any) {
  if (!Array.isArray(list) || !list.length) return DEFAULT_FRAMES;
  const seen = new Set<string>();
  const out = [];
  for (const f of list.slice(0, 16)) {
    if (!f || typeof f !== "object") continue;
    let id = textOr(f.id, 40, "").replace(/[^a-z0-9_-]/gi, "") || crypto.randomUUID().slice(0, 8);
    while (seen.has(id)) id += "x";
    seen.add(id);
    const kind = f.kind === "overlay" ? "overlay" : "template";
    const template = TEMPLATES.includes(f.template) ? f.template : "classic";
    const base = DEFAULT_FRAMES.find((x) => x.template === template)!;
    const overlay = assetUrl(f.overlay);
    if (kind === "overlay" && !overlay) continue;
    out.push({
      id, kind, template, overlay,
      name: textOr(f.name, 40, base.name) || base.name,
      enabled: f.enabled !== false,
      bg: color(f.bg, base.bg), fg: color(f.fg, base.fg), accent: color(f.accent, base.accent),
      title: textOr(f.title, 80, base.title), subtitle: textOr(f.subtitle, 80, base.subtitle),
      event_logo: f.event_logo !== false, app_logo: f.app_logo === true,
    });
  }
  if (!out.some((f) => f.enabled) && out.length) out[0].enabled = true;
  return out.length ? out : DEFAULT_FRAMES;
}

async function getSettings() {
  const { data } = await db.from("settings")
    .select("event_name, tagline, frame_message, enabled_frames, photo_retention_days, wifi_name, wifi_password, branding, frames")
    .eq("id", 1).single();
  if (!data) return null;
  const branding = normBranding(data.branding);
  const frames = normFrames(data.frames);
  return {
    event_name: data.event_name,
    event_hashtag: data.frame_message,
    frame_message: data.frame_message, // kept for older booths
    tagline: data.tagline,
    photo_retention_days: data.photo_retention_days,
    wifi_name: data.wifi_name,
    wifi_password: data.wifi_password,
    ...branding,
    frames,
    enabled_frames: frames.filter((f) => f.enabled && f.kind === "template" && f.id === f.template).map((f) => f.id), // older booths
  };
}

async function sendPhotoEmail(to: string, firstName: string, storagePath: string) {
  if (!EMAIL_ENABLED) return false;
  const s = await getSettings();
  const { data } = await db.storage.from("photos").createSignedUrl(storagePath, 60 * 60 * 24 * 7, { download: "photo.jpg" });
  const { data: view } = await db.storage.from("photos").createSignedUrl(storagePath, 60 * 60 * 24 * 7);
  if (!data || !view) return false;
  const event = esc(s?.event_name || "the event");
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
    <h2>Hi ${esc(firstName)}, here's your photo from ${event}</h2>
    <p><img src="${view.signedUrl}" alt="Your photo" style="width:100%;border-radius:12px"></p>
    <p><a href="${data.signedUrl}" style="display:inline-block;background:#FF5A36;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Download your photo</a></p>
    <p style="color:#666;font-size:13px">This link expires in 7 days. Save the photo to keep it, then share it to Instagram or Facebook.</p></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject: `Your photo from ${s?.event_name || "the event"}`, html }),
  });
  return r.ok;
}

// When a photo lands, turn any waiting claims into leads and email them the photo.
async function resolvePending(photoId: string, storagePath: string) {
  const { data: rows } = await db.from("pending_claims").select("*").eq("photo_id", photoId);
  for (const p of rows || []) {
    await db.from("leads").upsert({
      photo_id: photoId, first_name: p.first_name, last_name: p.last_name, email: p.email,
      postcode: p.postcode, marketing_opt_in: p.marketing_opt_in, terms_accepted: true,
    }, { onConflict: "photo_id,email" });
    await db.from("photos").update({ claimed_at: new Date().toISOString() }).eq("id", photoId).is("claimed_at", null);
    try { await sendPhotoEmail(p.email, p.first_name, storagePath); } catch (e) { console.error("email", e); }
    await db.from("pending_claims").delete().eq("photo_id", photoId).eq("email", p.email);
  }
}

async function removePhotos(rows: { id: string; storage_path: string; thumb_path: string | null }[]) {
  const paths = rows.flatMap((r) => [r.storage_path, r.thumb_path].filter(Boolean)) as string[];
  for (let i = 0; i < paths.length; i += 100) await db.storage.from("photos").remove(paths.slice(i, i + 100));
  if (rows.length) await db.from("photos").delete().in("id", rows.map((r) => r.id));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*\/booth-api/, "") || "/";
  const parts = path.split("/").filter(Boolean);

  try {
    // ---------- Public ----------
    if (req.method === "GET" && path === "/config") return json(await getSettings());

    if (req.method === "GET" && parts[0] === "photo" && parts[1]) {
      if (!UUID.test(parts[1])) return json({ error: "Invalid link" }, 400);
      const { data } = await db.from("photos").select("id").eq("id", parts[1]).maybeSingle();
      const s = await getSettings();
      return json({ ready: !!data, event_name: s?.event_name, tagline: s?.tagline, email_fallback: EMAIL_ENABLED });
    }

    if (req.method === "POST" && path === "/claim") {
      const b = await req.json();
      const id = clean(b.id, 40);
      if (!UUID.test(id)) return json({ error: "Invalid link" }, 400);
      const first_name = clean(b.first_name, 60);
      const email = clean(b.email, 160).toLowerCase();
      if (!first_name) return json({ error: "Please enter your first name" }, 400);
      if (!EMAIL.test(email)) return json({ error: "Please enter a valid email" }, 400);
      if (b.terms_accepted !== true) return json({ error: "Please accept the terms" }, 400);
      const lead = {
        first_name, email,
        last_name: clean(b.last_name, 60) || null,
        postcode: clean(b.postcode, 10) || null,
        marketing_opt_in: b.marketing_opt_in === true,
      };

      const { data: photo } = await db.from("photos").select("id, storage_path, claimed_at").eq("id", id).maybeSingle();
      if (!photo) {
        // Photo still uploading: keep their details so nothing is lost, and email it later if enabled.
        await db.from("pending_claims").upsert({ photo_id: id, ...lead }, { onConflict: "photo_id,email" });
        return json({ error: "Your photo is still uploading", pending: true, email_fallback: EMAIL_ENABLED }, 404);
      }
      const { error: e1 } = await db.from("leads").upsert({ photo_id: id, ...lead, terms_accepted: true }, { onConflict: "photo_id,email" });
      if (e1) throw e1;
      await db.from("pending_claims").delete().eq("photo_id", id).eq("email", email);
      if (!photo.claimed_at) await db.from("photos").update({ claimed_at: new Date().toISOString() }).eq("id", id);

      const { data: signed, error: e2 } = await db.storage.from("photos").createSignedUrl(photo.storage_path, 60 * 60 * 24);
      if (e2) throw e2;
      const { data: dl } = await db.storage.from("photos").createSignedUrl(photo.storage_path, 60 * 60 * 24, { download: "photo.jpg" });
      return json({ url: signed.signedUrl, download_url: dl?.signedUrl });
    }

    if (req.method === "POST" && path === "/shared") {
      const b = await req.json();
      if (UUID.test(b.id)) await db.from("photos").update({ shared_at: new Date().toISOString() }).eq("id", b.id).is("shared_at", null);
      return json({ ok: true });
    }

    // ---------- Scheduled cleanup (pg_cron) ----------
    if (req.method === "POST" && path === "/cron/cleanup") {
      const key = req.headers.get("x-cron-key") || "";
      const stored = await secret("cron_key");
      if (!stored || !safeEqual(key, stored)) return json({ error: "Unauthorised" }, 401);
      const s = await getSettings();
      const days = Math.max(1, s?.photo_retention_days || 30);
      const cutoff = new Date(Date.now() - days * 86400000).toISOString();
      let removed = 0;
      for (;;) {
        const { data: old } = await db.from("photos").select("id, storage_path, thumb_path").lt("created_at", cutoff).limit(200);
        if (!old?.length) break;
        await removePhotos(old);
        removed += old.length;
      }
      // Claims whose photo never arrived after 2 days: keep the guest as a lead (no photo).
      const stale = new Date(Date.now() - 2 * 86400000).toISOString();
      const { data: orphans } = await db.from("pending_claims").select("*").lt("created_at", stale);
      for (const p of orphans || []) {
        await db.from("leads").insert({ photo_id: null, first_name: p.first_name, last_name: p.last_name, email: p.email, postcode: p.postcode, marketing_opt_in: p.marketing_opt_in, terms_accepted: true });
        await db.from("pending_claims").delete().eq("photo_id", p.photo_id).eq("email", p.email);
      }
      await db.from("auth_failures").delete().lt("created_at", new Date(Date.now() - 86400000).toISOString());
      return json({ ok: true, removed, orphans: orphans?.length || 0 });
    }

    // ---------- Staff ----------
    const auth = await staffCheck(req);
    if (auth === "locked") return json({ error: "Too many attempts — wait 15 minutes" }, 429);
    if (auth === "denied") return json({ error: "Unauthorised" }, 401);
    const role: Role = auth;
    if (role === "operator" && !OPERATOR_OK.includes(path)) return json({ error: "Operator passcodes can only run booths" }, 403);
    if (role === "client" && SUPER_ONLY.some((r) => r.test(path))) return json({ error: "Not available for client access" }, 403);

    if (req.method === "POST" && path === "/auth") return json({ ok: true, role });

    if (req.method === "POST" && path === "/heartbeat") {
      const b = await req.json();
      const id = clean(b.booth_id, 40);
      if (!id) return json({ error: "booth_id required" }, 400);
      await db.from("booths").upsert({
        id, name: clean(b.name, 40) || "Booth", last_seen: new Date().toISOString(),
        queue_length: Math.max(0, Number(b.queue_length) || 0), app_version: clean(b.app_version, 20) || null,
      });
      return json({ ok: true, settings: await getSettings() });
    }

    if (req.method === "POST" && path === "/upload") {
      const form = await req.formData();
      const id = String(form.get("id") || "");
      const frame = String(form.get("frame") || "");
      const boothId = clean(String(form.get("booth_id") || ""), 40) || null;
      const file = form.get("file");
      const thumb = form.get("thumb");
      if (!UUID.test(id) || !(file instanceof File)) return json({ error: "Bad upload" }, 400);
      const { data: existing } = await db.from("photos").select("storage_path, thumb_path").eq("id", id).maybeSingle();
      const day = new Date().toISOString().slice(0, 10);
      const storage_path = existing?.storage_path || `${day}/${id}.jpg`;
      const thumb_path = thumb instanceof File ? (existing?.thumb_path || `${day}/${id}_t.jpg`) : existing?.thumb_path || null;
      const { error: e1 } = await db.storage.from("photos").upload(storage_path, file, { contentType: "image/jpeg", upsert: true });
      if (e1) throw e1;
      if (thumb instanceof File && thumb_path) {
        await db.storage.from("photos").upload(thumb_path, thumb, { contentType: "image/jpeg", upsert: true });
      }
      if (!existing) {
        const { error: e2 } = await db.from("photos").insert({ id, frame: clean(frame, 40) || null, storage_path, thumb_path, booth_id: boothId });
        if (e2 && e2.code !== "23505") throw e2;
      } else if (thumb_path && !existing.thumb_path) {
        await db.from("photos").update({ thumb_path }).eq("id", id);
      }
      if (boothId) await db.from("booths").update({ last_upload: new Date().toISOString() }).eq("id", boothId);
      await resolvePending(id, storage_path);
      return json({ ok: true, id });
    }

    if (req.method === "GET" && path === "/admin/summary") {
      const head = { count: "exact" as const, head: true };
      const [{ count: photos }, { count: claimed }, { count: shared }, { count: leads }, { count: optins }, { count: pending }] = await Promise.all([
        db.from("photos").select("*", head),
        db.from("photos").select("*", head).not("claimed_at", "is", null),
        db.from("photos").select("*", head).not("shared_at", "is", null),
        db.from("leads").select("*", head),
        db.from("leads").select("*", head).eq("marketing_opt_in", true),
        db.from("pending_claims").select("*", head),
      ]);
      const { data: recent } = await db.from("photos").select("id, frame, storage_path, thumb_path, created_at, claimed_at, shared_at, booth_id").order("created_at", { ascending: false }).limit(60);
      const thumbs: Record<string, string> = {};
      if (recent?.length && role === "superadmin") {
        const { data: urls } = await db.storage.from("photos").createSignedUrls(recent.map((r) => r.thumb_path || r.storage_path), 3600);
        urls?.forEach((u, i) => { if (u.signedUrl) thumbs[recent[i].id] = u.signedUrl; });
      }
      // Activity for the last 24 hours, bucketed by hour
      const since = new Date(Date.now() - 24 * 3600000).toISOString();
      const [{ data: ph }, { data: ld }] = await Promise.all([
        db.from("photos").select("created_at").gte("created_at", since).limit(20000),
        db.from("leads").select("created_at").gte("created_at", since).limit(20000),
      ]);
      const hourly: { hour: string; photos: number; leads: number }[] = [];
      const top = new Date(); top.setUTCMinutes(0, 0, 0);
      for (let i = 23; i >= 0; i--) hourly.push({ hour: new Date(top.getTime() - i * 3600000).toISOString(), photos: 0, leads: 0 });
      const bucket = (t: string) => hourly.find((h) => new Date(t).getTime() >= new Date(h.hour).getTime() && new Date(t).getTime() < new Date(h.hour).getTime() + 3600000);
      (ph || []).forEach((r) => { const b = bucket(r.created_at); if (b) b.photos++; });
      (ld || []).forEach((r) => { const b = bucket(r.created_at); if (b) b.leads++; });
      const settings = await getSettings();
      if (role === "client") {
        // Client admins see statistics and their brand kit, not guest data or operations
        const { wifi_name, wifi_password, photo_retention_days, ...brand } = settings as any;
        return json({ now: new Date().toISOString(), role, stats: { photos, claimed, shared, leads, optins }, settings: brand, hourly, last_photo_at: recent?.[0]?.created_at || null });
      }
      const { data: leadRows } = await db.from("leads").select("id, photo_id, first_name, last_name, email, postcode, marketing_opt_in, created_at").order("created_at", { ascending: false }).limit(5000);
      const { data: booths } = await db.from("booths").select("*").order("last_seen", { ascending: false });
      const { data: cp } = await db.from("app_secrets").select("value").eq("key", "client_passcode_sha256").single();
      const { data: op } = await db.from("app_secrets").select("value").eq("key", "operator_passcode_sha256").maybeSingle();
      return json({
        role,
        hourly,
        client_access: !!cp?.value,
        operator_access: !!op?.value,
        now: new Date().toISOString(),
        stats: { photos, claimed, shared, leads, optins, pending },
        settings,
        email_enabled: EMAIL_ENABLED,
        last_photo_at: recent?.[0]?.created_at || null,
        booths: booths || [],
        photos: (recent || []).map(({ storage_path, thumb_path, ...r }) => ({ ...r, thumb: thumbs[r.id] })),
        leads: leadRows || [],
      });
    }

    if (req.method === "GET" && parts[0] === "admin" && parts[1] === "photo" && UUID.test(parts[2] || "") && parts[3] === "url") {
      const { data: p } = await db.from("photos").select("storage_path").eq("id", parts[2]).maybeSingle();
      if (!p) return json({ error: "Not found" }, 404);
      const { data } = await db.storage.from("photos").createSignedUrl(p.storage_path, 600);
      return json({ url: data?.signedUrl });
    }

    if (req.method === "PUT" && path === "/admin/settings" && role === "client") {
      // Brand kit only: merge allowed fields over the current settings
      const b = await req.json();
      const cur: any = await getSettings();
      const merged: any = { ...cur };
      for (const k of CLIENT_BRAND_KEYS) if (k in b) merged[k] = b[k];
      const frames = normFrames(b.frames ?? cur.frames);
      const { error } = await db.from("settings").update({
        event_name: clean(b.event_name ?? cur.event_name, 60) || "Event",
        frame_message: clean(b.event_hashtag ?? cur.event_hashtag, 60),
        enabled_frames: frames.filter((f) => f.enabled && f.kind === "template").map((f) => f.template),
        branding: normBranding(merged),
        frames,
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (error) throw error;
      const { wifi_name, wifi_password, photo_retention_days, ...brand } = (await getSettings()) as any;
      return json(brand);
    }

    if (req.method === "PUT" && path === "/admin/settings") {
      const b = await req.json();
      const days = Math.min(365, Math.max(1, parseInt(b.photo_retention_days, 10) || 30));
      const frames = normFrames(b.frames);
      const { error } = await db.from("settings").update({
        event_name: clean(b.event_name, 60) || "Event",
        tagline: clean(b.tagline, 80),
        frame_message: clean(b.event_hashtag ?? b.frame_message, 60),
        enabled_frames: frames.filter((f) => f.enabled && f.kind === "template").map((f) => f.template),
        photo_retention_days: days,
        wifi_name: clean(b.wifi_name, 60),
        wifi_password: clean(b.wifi_password, 60),
        branding: normBranding(b),
        frames,
        updated_at: new Date().toISOString(),
      }).eq("id", 1);
      if (error) throw error;
      return json(await getSettings());
    }

    if (req.method === "POST" && path === "/admin/asset") {
      const form = await req.formData();
      const file = form.get("file");
      const types: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
      if (!(file instanceof File) || !types[file.type]) return json({ error: "Upload a PNG, JPG or WebP image" }, 400);
      if (file.size > 5 * 1024 * 1024) return json({ error: "Image must be under 5 MB" }, 400);
      const name = `${crypto.randomUUID()}.${types[file.type]}`;
      const { error } = await db.storage.from("branding").upload(name, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
      if (error) throw error;
      return json({ url: ASSET_BASE + name });
    }

    // ---------- Brand profiles (superadmin) ----------
    if (req.method === "GET" && path === "/admin/profiles") {
      const { data } = await db.from("brand_profiles").select("id, name, data, created_at, updated_at").order("updated_at", { ascending: false });
      return json(data || []);
    }
    if (req.method === "POST" && path === "/admin/profiles") {
      const b = await req.json();
      const name = clean(b.name, 60);
      if (!name) return json({ error: "Give the profile a name" }, 400);
      const { count } = await db.from("brand_profiles").select("*", { count: "exact", head: true });
      if ((count || 0) >= 100) return json({ error: "Up to 100 profiles" }, 400);
      const { data, error } = await db.from("brand_profiles").insert({ name, data: normProfile(b.data) }).select().single();
      if (error) throw error;
      return json(data);
    }
    if ((req.method === "PUT" || req.method === "DELETE") && parts[0] === "admin" && parts[1] === "profiles" && UUID.test(parts[2] || "")) {
      if (req.method === "DELETE") {
        await db.from("brand_profiles").delete().eq("id", parts[2]);
        return json({ ok: true });
      }
      const b = await req.json();
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (b.name !== undefined) { const n = clean(b.name, 60); if (!n) return json({ error: "Give the profile a name" }, 400); patch.name = n; }
      if (b.data !== undefined) patch.data = normProfile(b.data);
      const { data, error } = await db.from("brand_profiles").update(patch).eq("id", parts[2]).select().single();
      if (error) throw error;
      return json(data);
    }

    // ---------- Client admin passcode (superadmin) ----------
    const PASS_PATHS: Record<string, keyof typeof PASS_KEYS> = { "/admin/passcode": "superadmin", "/admin/client-passcode": "client", "/admin/operator-passcode": "operator" };
    if (req.method === "PUT" && PASS_PATHS[path]) {
      const which = PASS_PATHS[path];
      const b = await req.json();
      if (b.disable === true && which !== "superadmin") {
        await db.from("app_secrets").upsert({ key: PASS_KEYS[which], value: "" });
        return json({ ok: true, enabled: false });
      }
      const pc = clean(b.passcode, 100);
      if (pc.length < 8) return json({ error: "Passcode must be at least 8 characters" }, 400);
      const h = await sha256(pc);
      const clash = await passClash(h, which);
      if (clash) return json({ error: `That's already the ${clash} passcode. Use a different one.` }, 400);
      await db.from("app_secrets").upsert({ key: PASS_KEYS[which], value: h });
      return json({ ok: true, enabled: true });
    }

    if (req.method === "DELETE" && parts[0] === "admin" && parts[1] === "photo" && UUID.test(parts[2] || "")) {
      const { data: p } = await db.from("photos").select("id, storage_path, thumb_path").eq("id", parts[2]).maybeSingle();
      if (p) await removePhotos([p]);
      return json({ ok: true });
    }

    if (req.method === "DELETE" && parts[0] === "admin" && parts[1] === "booth" && parts[2]) {
      await db.from("booths").delete().eq("id", clean(decodeURIComponent(parts[2]), 40));
      return json({ ok: true });
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "Something went wrong" }, 500);
  }
});
