// Frame engine. Draws the photo plus a frame onto a canvas of any size.
// Measurements are relative to a 1080-wide canvas, scaled by `k`.
// A frame is either a configurable template or an uploaded PNG overlay.
(function () {
  const SANS = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Helvetica, Arial, sans-serif';
  const SERIF = 'Georgia, "Times New Roman", serif';

  // ---------- image assets (logos, overlays) ----------
  const cache = {};
  function loadImage(url) {
    if (!url) return Promise.resolve(null);
    if (cache[url]) return cache[url].p;
    const img = new Image();
    img.crossOrigin = "anonymous"; // keeps the canvas exportable
    const entry = { img, ok: false };
    entry.p = new Promise((res) => {
      img.onload = () => { entry.ok = true; res(img); };
      img.onerror = () => { delete cache[url]; res(null); };
    });
    cache[url] = entry;
    img.src = url;
    return entry.p;
  }
  const asset = (url) => (url && cache[url] && cache[url].ok ? cache[url].img : null);
  function preload(cfg) {
    const urls = [cfg.app_logo, cfg.event_logo, ...(cfg.frames || []).map((f) => f.overlay)].filter(Boolean);
    return Promise.all(urls.map(loadImage));
  }

  // ---------- helpers ----------
  function srcSize(src) {
    return { w: src.videoWidth || src.naturalWidth || src.width, h: src.videoHeight || src.naturalHeight || src.height };
  }
  function cover(ctx, src, x, y, w, h, mirror) {
    const { w: sw, h: sh } = srcSize(src);
    if (!sw || !sh) return;
    const scale = Math.max(w / sw, h / sh);
    const cw = w / scale, ch = h / scale;
    const cx = (sw - cw) / 2, cy = (sh - ch) / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (mirror) { ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(src, cx, cy, cw, ch, 0, 0, w, h); }
    else ctx.drawImage(src, cx, cy, cw, ch, x, y, w, h);
    ctx.restore();
  }
  // Draw an image scaled to fit a box; align: "center" | "left" | "right"
  function contain(ctx, img, x, y, w, h, align = "center") {
    const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    const dx = align === "left" ? x : align === "right" ? x + w - dw : x + (w - dw) / 2;
    ctx.drawImage(img, dx, y + (h - dh) / 2, dw, dh);
  }
  function fitText(ctx, text, maxW, size, weight, family) {
    let s = size;
    do {
      ctx.font = `${weight} ${s}px ${family}`;
      if (ctx.measureText(text).width <= maxW) break;
      s -= 2;
    } while (s > 10);
    return s;
  }
  function rgba(hex, a) {
    const n = parseInt((hex || "#000000").slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  const TOKENS = /\{(event_name|event_hashtag|app_name|app_hashtag)\}/g;
  const fill = (text, cfg) => (text || "").replace(TOKENS, (_, k) => cfg[k] || "").trim();

  // ---------- templates ----------
  // Each gets: ctx, src, W, H, frame config f, global cfg, k (scale), mirror, logos {ev, app}
  const TEMPLATES = {
    classic: {
      name: "Classic",
      draw(ctx, src, W, H, f, cfg, k, mirror, L) {
        ctx.fillStyle = f.bg; ctx.fillRect(0, 0, W, H);
        const m = 48 * k, band = 230 * k, top = H - band;
        cover(ctx, src, m, m, W - 2 * m, H - m - band, mirror);
        const title = fill(f.title, cfg), sub = fill(f.subtitle, cfg);
        const side = L.app ? 170 * k : 0; // room for app logo on the right
        ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        if (L.ev) {
          contain(ctx, L.ev, m + side, top + 24 * k, W - 2 * m - 2 * side, (sub ? 120 : 170) * k);
          if (sub) { ctx.fillStyle = f.accent; fitText(ctx, sub, W - 160 * k - 2 * side, 40 * k, 600, SANS); ctx.fillText(sub, W / 2, top + 190 * k); }
        } else {
          if (title) { ctx.fillStyle = f.fg; fitText(ctx, title.toUpperCase(), W - 160 * k - 2 * side, 76 * k, 800, SANS); ctx.fillText(title.toUpperCase(), W / 2, top + (sub ? 118 : 140) * k); }
          if (sub) { ctx.fillStyle = f.accent; fitText(ctx, sub, W - 160 * k - 2 * side, 40 * k, 600, SANS); ctx.fillText(sub, W / 2, top + (title ? 180 : 135) * k); }
        }
        if (L.app) contain(ctx, L.app, W - m - 140 * k, top + 60 * k, 140 * k, 110 * k, "right");
      },
    },
    polaroid: {
      name: "Polaroid",
      draw(ctx, src, W, H, f, cfg, k, mirror, L) {
        ctx.fillStyle = f.bg; ctx.fillRect(0, 0, W, H);
        const m = 70 * k, bottom = 300 * k, top = H - bottom;
        ctx.fillStyle = "rgba(0,0,0,0.08)";
        ctx.fillRect(m + 6 * k, m + 10 * k, W - 2 * m, H - m - bottom);
        cover(ctx, src, m, m, W - 2 * m, H - m - bottom, mirror);
        const title = fill(f.title, cfg), sub = fill(f.subtitle, cfg);
        const side = L.app ? 170 * k : 0;
        ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
        if (L.ev) {
          contain(ctx, L.ev, m + side, top + 40 * k, W - 2 * m - 2 * side, (sub ? 140 : 200) * k);
          if (sub) { ctx.fillStyle = f.accent; fitText(ctx, sub, W - 200 * k - 2 * side, 38 * k, 400, SANS); ctx.fillText(sub, W / 2, top + 235 * k); }
        } else {
          if (title) { ctx.fillStyle = f.fg; fitText(ctx, title, W - 200 * k - 2 * side, 84 * k, "italic 400", SERIF); ctx.fillText(title, W / 2, top + (sub ? 150 : 175) * k); }
          if (sub) { ctx.fillStyle = f.accent; fitText(ctx, sub, W - 200 * k - 2 * side, 38 * k, 400, SANS); ctx.fillText(sub, W / 2, top + (title ? 220 : 165) * k); }
        }
        if (L.app) contain(ctx, L.app, W - m - 140 * k, top + 90 * k, 140 * k, 110 * k, "right");
      },
    },
    bold: {
      name: "Bold",
      draw(ctx, src, W, H, f, cfg, k, mirror, L) {
        cover(ctx, src, 0, 0, W, H, mirror);
        const g = ctx.createLinearGradient(0, H * 0.55, 0, H);
        g.addColorStop(0, rgba(f.bg, 0)); g.addColorStop(1, rgba(f.bg, 0.88));
        ctx.fillStyle = g; ctx.fillRect(0, H * 0.55, W, H * 0.45);
        if (L.ev) contain(ctx, L.ev, 60 * k, 60 * k, 320 * k, 170 * k, "left");
        if (L.app) contain(ctx, L.app, W - 260 * k, 60 * k, 200 * k, 110 * k, "right");
        const title = fill(f.title, cfg), sub = fill(f.subtitle, cfg);
        ctx.textAlign = "left";
        ctx.fillStyle = f.accent; ctx.fillRect(60 * k, H - (title ? 300 : 200) * k, 120 * k, 14 * k);
        if (title) { ctx.fillStyle = f.fg; fitText(ctx, title.toUpperCase(), W - 120 * k, 120 * k, 900, SANS); ctx.fillText(title.toUpperCase(), 60 * k, H - 160 * k); }
        if (sub) {
          fitText(ctx, sub, W - 200 * k, 40 * k, 700, SANS);
          const tw = ctx.measureText(sub).width, px = 60 * k, py = H - 125 * k, ph = 64 * k;
          ctx.fillStyle = f.accent; roundRect(ctx, px, py, tw + 48 * k, ph, ph / 2); ctx.fill();
          ctx.fillStyle = f.fg; ctx.textBaseline = "middle"; ctx.fillText(sub, px + 24 * k, py + ph / 2 + 2 * k);
          ctx.textBaseline = "alphabetic";
        }
      },
    },
    minimal: {
      name: "Minimal",
      draw(ctx, src, W, H, f, cfg, k, mirror, L) {
        cover(ctx, src, 0, 0, W, H, mirror);
        ctx.strokeStyle = rgba(f.accent, 0.9); ctx.lineWidth = 4 * k;
        ctx.strokeRect(36 * k, 36 * k, W - 72 * k, H - 72 * k);
        if (L.ev) contain(ctx, L.ev, 72 * k, 72 * k, 240 * k, 120 * k, "left");
        if (L.app) contain(ctx, L.app, W - 72 * k - 180 * k, 72 * k, 180 * k, 90 * k, "right");
        const t = [fill(f.title, cfg), fill(f.subtitle, cfg)].filter(Boolean).join("  ·  ");
        if (!t) return;
        fitText(ctx, t, W - 160 * k, 36 * k, 600, SANS);
        const tw = ctx.measureText(t).width;
        ctx.fillStyle = rgba(f.bg, 0.45);
        roundRect(ctx, W - 72 * k - tw - 40 * k, H - 140 * k, tw + 40 * k, 64 * k, 12 * k); ctx.fill();
        ctx.fillStyle = f.fg; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(t, W - 72 * k - tw - 20 * k, H - 108 * k);
        ctx.textBaseline = "alphabetic";
      },
    },
  };

  // Main entry point
  function draw(ctx, src, W, H, f, cfg, mirror) {
    const k = W / 1080;
    ctx.save();
    if (f.kind === "overlay") {
      cover(ctx, src, 0, 0, W, H, mirror);
      const ov = asset(f.overlay);
      if (ov) ctx.drawImage(ov, 0, 0, W, H);
    } else {
      const t = TEMPLATES[f.template] || TEMPLATES.classic;
      const L = { ev: f.event_logo ? asset(cfg.event_logo) : null, app: f.app_logo ? asset(cfg.app_logo) : null };
      t.draw(ctx, src, W, H, f, cfg, k, mirror, L);
    }
    ctx.restore();
  }
  // A frame is usable on the booth if it's enabled and (for overlays) its image has loaded.
  const usable = (f) => f.enabled && (f.kind !== "overlay" || !!asset(f.overlay));

  // Placeholder "photo" for previews
  function samplePhoto(w = 800, h = 1000) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d");
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#3a3f5c"); g.addColorStop(1, "#c86b5a");
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    x.fillStyle = "rgba(255,255,255,0.18)";
    [[0.35, 0.42], [0.65, 0.45]].forEach(([cx, cy]) => {
      x.beginPath(); x.arc(w * cx, h * cy, w * 0.11, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.ellipse(w * cx, h * (cy + 0.33), w * 0.18, h * 0.2, 0, 0, Math.PI * 2); x.fill();
    });
    return c;
  }

  window.Frames = { TEMPLATES, draw, usable, preload, loadImage, asset, fill, samplePhoto, cover };
})();
