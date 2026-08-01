/**
 * Single stylesheet shared by every page. Kept as a string so pages stay
 * server-rendered with no build step and no client framework.
 */
export const STYLES = `
:root {
  --bg: #f2f2f7;
  --card: #ffffff;
  --text: #1c1c1e;
  --muted: #6e6e73;
  --separator: #d8d8dc;
  --accent: #007aff;
  --danger: #ff3b30;
  --success: #34c759;
  --radius: 16px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #000000;
    --card: #1c1c1e;
    --text: #f5f5f7;
    --muted: #98989d;
    --separator: #38383a;
    --card-2: #2c2c2e;
  }
}
* { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font: 17px/1.47 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
body { padding-bottom: calc(88px + env(safe-area-inset-bottom)); }
.page { max-width: 560px; margin: 0 auto; }

/* ---------- gallery ---------- */
.gallery {
  display: flex;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  aspect-ratio: 4 / 3;
  background: var(--card);
}
.gallery::-webkit-scrollbar { display: none; }
.gallery figure {
  flex: 0 0 100%;
  scroll-snap-align: center;
  margin: 0;
  height: 100%;
}
.gallery img { width: 100%; height: 100%; object-fit: cover; display: block; }
.dots {
  display: flex;
  justify-content: center;
  gap: 6px;
  padding: 10px 0 2px;
}
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--separator); transition: background .2s; }
.dot[data-active="true"] { background: var(--accent); }
.gallery-empty {
  aspect-ratio: 4 / 3;
  display: grid;
  place-items: center;
  background: var(--card);
  color: var(--muted);
}

/* ---------- content ---------- */
.content { padding: 4px 16px 24px; }
h1 { font-size: 26px; line-height: 1.2; letter-spacing: -0.4px; margin: 12px 0 4px; font-weight: 700; }
.subtitle { color: var(--muted); margin: 0 0 16px; }
.price { font-size: 22px; font-weight: 700; margin: 0 0 2px; }
.card {
  background: var(--card);
  border-radius: var(--radius);
  padding: 14px 16px;
  margin: 12px 0;
}
.card h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); margin: 0 0 10px; font-weight: 600; }
.rows { display: grid; gap: 0; }
.row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 9px 0;
  border-bottom: 1px solid var(--separator);
}
.row:last-child { border-bottom: none; }
.row dt { color: var(--muted); margin: 0; }
.row dd { margin: 0; text-align: right; font-weight: 500; }
.match { display: grid; gap: 8px; }
.match li { list-style: none; display: flex; gap: 9px; align-items: flex-start; }
.match ul { margin: 0; padding: 0; display: grid; gap: 8px; }
.tick { color: var(--success); font-weight: 700; flex: 0 0 auto; }
.chips { display: flex; flex-wrap: wrap; gap: 7px; }
.chip {
  background: var(--bg);
  border: 1px solid var(--separator);
  border-radius: 100px;
  padding: 5px 11px;
  font-size: 14px;
}
@media (prefers-color-scheme: dark) { .chip { background: var(--card-2, #2c2c2e); } }
.description { white-space: pre-wrap; margin: 0; color: var(--text); }
.provider { color: var(--muted); font-size: 14px; text-align: center; padding: 8px 0 0; }
.provider a { color: var(--accent); }

/* ---------- action bar ---------- */
.actionbar {
  position: fixed;
  left: 0; right: 0; bottom: 0;
  display: flex;
  gap: 10px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: color-mix(in srgb, var(--card) 88%, transparent);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: 1px solid var(--separator);
}
.btn {
  flex: 1;
  display: block;
  border: none;
  border-radius: 13px;
  padding: 15px 12px;
  font: inherit;
  font-weight: 600;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  transition: opacity .15s, transform .1s;
}
.btn:active { transform: scale(.98); opacity: .85; }
.btn[disabled] { opacity: .45; pointer-events: none; }
.btn-primary { background: var(--accent); color: #fff; }
.btn-secondary { background: var(--bg); color: var(--text); border: 1px solid var(--separator); }
@media (prefers-color-scheme: dark) { .btn-secondary { background: var(--card-2, #2c2c2e); } }
.btn-danger { background: transparent; color: var(--danger); border: 1px solid var(--separator); }
.btn-full { width: 100%; }

/* ---------- states ---------- */
.state {
  min-height: 100vh;
  min-height: 100dvh;
  display: grid;
  place-content: center;
  text-align: center;
  padding: 32px 28px;
  gap: 10px;
}
.state .glyph { font-size: 52px; line-height: 1; }
.state h1 { margin: 6px 0 0; font-size: 22px; }
.state p { color: var(--muted); margin: 0; max-width: 34ch; }

/* ---------- forms ---------- */
textarea {
  width: 100%;
  min-height: 260px;
  border-radius: 12px;
  border: 1px solid var(--separator);
  background: var(--bg);
  color: var(--text);
  padding: 13px;
  font: inherit;
  line-height: 1.5;
  resize: vertical;
}
@media (prefers-color-scheme: dark) { textarea { background: #2c2c2e; } }
.warn {
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  border-radius: 12px;
  padding: 12px 14px;
  font-size: 15px;
  margin: 12px 0;
}
.stack { display: grid; gap: 10px; margin-top: 14px; }
`;
