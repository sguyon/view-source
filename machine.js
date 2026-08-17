// machine.js — fetches this document and shows it.

// Fire-and-forget product events. No-ops until the Umami script has loaded.
export function trackEvent(name, data, umami = typeof window !== 'undefined' ? window.umami : null) {
  if (typeof name !== 'string' || !name) return false;
  if (!umami || typeof umami.track !== 'function') return false;
  try {
    if (data && typeof data === 'object') umami.track(name, data);
    else umami.track(name);
    return true;
  } catch {
    return false;
  }
}

// null when there is no server (srcdoc preview, file://).
export function documentUrl(href) {
  const u = new URL(href);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.search = '';
  u.hash = '';
  return u.href;
}

export function buildSourceLines(source) {
  return source.split('\n');
}

export function findSketchLine(source, id) {
  const marker = `// sketch: ${id}`;
  const lines = buildSourceLines(source);
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(marker)) return i;
  return -1;
}

const GHOST_ESCAPE_RE = /[&<>]/g;
const GHOST_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
export function escapeHtml(s) { return s.replace(GHOST_ESCAPE_RE, (c) => GHOST_ESCAPE_MAP[c]); }

const GHOST_KEYWORDS = 'function|const|let|var|if|else|return|for|while|class|new|this|' +
  'typeof|async|await|export|import|default|null|undefined|true|false|break|continue|' +
  'switch|case|try|catch|finally|throw|of|in|extends|static|get|set|do|yield|void|' +
  'instanceof|delete';
const GHOST_TOKEN_RE = new RegExp(
  '(<!--[\\s\\S]*?-->)' +
  '|(/\\*[\\s\\S]*?\\*/)' +
  '|(//.*$)' +
  '|(`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')' +
  '|(</?[a-zA-Z][\\w-]*|\\b(?:' + GHOST_KEYWORDS + ')\\b)' +
  '|\\b(\\d+\\.?\\d*)\\b',
  'g'
);
export function highlightGhostLine(text) {
  let out = '', last = 0, m;
  GHOST_TOKEN_RE.lastIndex = 0;
  while ((m = GHOST_TOKEN_RE.exec(text))) {
    if (m.index > last) out += escapeHtml(text.slice(last, m.index));
    const cls = m[1] || m[2] || m[3] ? 'gtok-c' : m[4] ? 'gtok-s' : m[5] ? 'gtok-k' : 'gtok-n';
    out += `<span class="${cls}">${escapeHtml(m[0])}</span>`;
    last = GHOST_TOKEN_RE.lastIndex;
  }
  if (last < text.length) out += escapeHtml(text.slice(last));
  return out;
}

export function sketchRange(source, id) {
  const lines = buildSourceLines(source);
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(`// sketch: ${id}`)) start = i;
    else if (lines[i].includes(`// /sketch: ${id}`)) end = i;
  }
  return start >= 0 && end > start ? { from: start + 1, to: end - 1 } : null;
}

// Marker lines included. Fold/ask must use this, not sketchRange (interior-only folds get dropped).
export function sketchBlock(source, id) {
  const r = sketchRange(source, id);
  return r ? { from: r.from - 1, to: r.to + 1 } : null;
}

export function hasSketches(doc, anims) {
  return !!(doc && doc.getElementById('bg-canvas')) && Array.isArray(anims) && anims.length > 0;
}

export function hasSketchScope(doc, anims, source) {
  return hasSketches(doc, anims) && sketchRange(source, anims[0].id) !== null;
}

const CONTROL_HEAD_RE = /^\s*\/\/\s*try editing these\b/;

const CONTROL_DECL_RE =
  /^(\s*)(const|let|var)([ \t]+)([A-Za-z_$][\w$]*)([ \t]*=[ \t]*)(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)([ \t]*;)([ \t]*)(\/\/.*)?$/;

export function parseControls(source, from = 0, to = null) {
  const lines = buildSourceLines(source);
  const last = to === null ? lines.length - 1 : Math.min(to, lines.length - 1);
  let head = -1;
  for (let i = Math.max(0, from); i <= last; i++) {
    if (CONTROL_HEAD_RE.test(lines[i])) { head = i; break; }
  }
  if (head < 0) return null;
  const controls = [];
  let prev = null, i = head + 1;
  for (; i <= last; i++) {
    const line = lines[i];
    if (/^\s*$/.test(line)) break;
    const m = CONTROL_DECL_RE.exec(line);
    if (m) {
      const comment = m[9] || '';
      prev = {
        line: i, indent: m[1], kw: m[2], ws: m[3], name: m[4], eq: m[5],
        authored: m[6], semi: m[7], gap: m[8], comment,
        commentCol: comment ? (m[1] + m[2] + m[3] + m[4] + m[5] + m[6] + m[7] + m[8]).length : -1,
        hint: comment.replace(/^\/\/[ \t]?/, '').trim(),
      };
      controls.push(prev);
      continue;
    }

    // wrapped hint for the const above — not a block boundary
    if (/^\s*\/\//.test(line)) {
      if (prev) prev.hint = (prev.hint + ' ' + line.replace(/^\s*\/\/[ \t]?/, '').trim()).trim();
      continue;
    }
    break;
  }
  return { head, end: i, controls };
}

// Caps live below the blank line, so MAX_SPEED inside the block stays a knob.
export function findControlCaps(source, block, to = null) {
  const lines = buildSourceLines(source);
  const last = to === null ? lines.length - 1 : Math.min(to, lines.length - 1);
  const after = lines.slice(block.end, last + 1).join('\n');
  const re = /\bconst[ \t]+(MAX|MIN)_([A-Z0-9_]+)[ \t]*=[ \t]*(\d+)/g;
  const found = [];
  let m;
  while ((m = re.exec(after))) found.push({ kind: m[1], word: m[2], value: +m[3] });
  const out = {};
  for (const k of block.controls) {
    const stem = k.name.replace(/_COUNT$/, '').replace(/S$/, '');
    if (!stem) continue;
    for (const c of found) {
      const cw = c.word.replace(/S$/, '');
      if (cw.indexOf(stem) === 0 || stem.indexOf(cw) === 0) {
        out[k.name] = out[k.name] || {};
        out[k.name][c.kind] = { name: (c.kind === 'MAX' ? 'MAX_' : 'MIN_') + c.word, value: c.value };
      }
    }
  }
  return out;
}

export const CONTROL_COUNT_CEILING = 3000;
export const CONTROL_COUNT_HEADROOM = 4;

export function decimalsOf(text) {
  const d = String(text).indexOf('.');
  return d < 0 ? 0 : String(text).length - d - 1;
}

function unitOfHint(hint) {
  if (/\bpx\s*\/\s*frame\b|\bpx\/frame\b/i.test(hint)) return 'px/f';
  if (/\bper[- ]frames?\b/i.test(hint)) return '';
  if (/\bpixel|\bpx\b/i.test(hint)) return 'px';
  if (/\bseconds?\b/i.test(hint)) return 's';
  if (/\bframes?\b/i.test(hint)) return 'f';
  return '';
}

export function controlType(control, caps = {}) {
  const N = control.name.toUpperCase();
  const v = parseFloat(control.authored);
  const isInt = !/[.eE]/.test(control.authored);
  const framesInHint = /\b(frames?|60\s?fps)\b/i.test(control.hint);
  let type;
  if (isInt && v >= 30 && (/(_EVERY|_FRAMES?|_PERIOD|_INTERVAL|_DELAY|_THRESHOLD)$/.test(N) || framesInHint)) type = 'duration';
  else if (!isInt && v > 0.5 && v < 1 && /(DECAY|RETAIN|FRICTION|DAMP)/.test(N)) type = 'retention';
  else if (!isInt && v > 0 && v < 0.5 && /(EASE|LERP|SMOOTH)/.test(N)) type = 'ease';
  else if (isInt && (v === 0 || v === 1) && /(^IS_|^USE_|^SHOW_|^ENABLE_|_ON$|_MODE$)/.test(N)) type = 'toggle';

  else if (isInt && (/[^SU]S$/.test(N) || /_COUNT$/.test(N) || v <= 24)) type = 'count';
  else if (!isInt && /FRAC$/.test(N) && !/SPEED/.test(N) && v > 0 && v <= 1) type = 'fraction';
  else type = 'value';

  let lo, hi, scale = 'log';
  if (type === 'retention') {

    const d = 1 - v; lo = 1 - Math.min(0.95, d * 8); hi = 1 - d / 8; scale = 'retention';
  } else if (type === 'ease') { lo = v / 8; hi = Math.min(0.9, v * 8); }
  else if (type === 'fraction') { lo = v / 8; hi = Math.min(1, v * 8); }
  else if (type === 'duration') { lo = Math.max(1, Math.round(v / 8)); hi = Math.round(v * 8); }
  else if (type === 'toggle') { lo = 0; hi = 1; scale = 'lin'; }
  else if (type === 'count') {
    lo = Math.max(1, Math.round(v / 8));
    hi = Math.min(Math.round(v * CONTROL_COUNT_HEADROOM), CONTROL_COUNT_CEILING);
  } else { lo = v / 8; hi = v * 8; }

  const cap = caps[control.name] || {};
  let capNote = '', capLong = '';
  if (cap.MAX && hi > cap.MAX.value) hi = cap.MAX.value;
  if (cap.MAX || cap.MIN) {
    capNote = cap.MIN && cap.MAX ? 'caps ' + cap.MIN.value + '–' + cap.MAX.value
            : cap.MAX ? 'caps ≤ ' + cap.MAX.value : 'caps ≥ ' + cap.MIN.value;
    capLong = [cap.MIN ? 'floored by ' + cap.MIN.name + ' = ' + cap.MIN.value : '',
               cap.MAX ? 'capped by ' + cap.MAX.name + ' = ' + cap.MAX.value : '']
              .filter(Boolean).join(' · ');
  }
  if (isInt) { lo = Math.max(1, Math.round(lo)); hi = Math.max(lo + 1, Math.round(hi)); }

  return {
    type, scale, min: lo, max: hi, isInt, value: v,
    authoredText: control.authored, decimals: decimalsOf(control.authored),

    unit: type === 'duration' ? 'f'
        : (type === 'ease' || type === 'retention' || type === 'fraction') ? ''
        : unitOfHint(control.hint),
    capNote, capLong,
  };
}

export function controlValueAt(c, t) {
  if (c.scale === 'lin') return c.min + (c.max - c.min) * t;
  if (c.scale === 'retention') {
    const dmax = 1 - c.min, dmin = 1 - c.max;
    return 1 - dmax * Math.pow(dmin / dmax, t);
  }
  return c.min * Math.pow(c.max / c.min, t);
}
export function controlPosOf(c, v) {
  let t;
  if (c.scale === 'lin') t = (v - c.min) / (c.max - c.min);
  else if (c.scale === 'retention') {
    const dmax = 1 - c.min, dmin = 1 - c.max;
    t = Math.log((1 - v) / dmax) / Math.log(dmin / dmax);
  } else t = Math.log(v / c.min) / Math.log(c.max / c.min);
  return Math.max(0, Math.min(1, t || 0));
}

export function formatControlValue(c, v) {
  if (Math.abs(v - c.value) < 1e-12) return c.authoredText;
  if (c.isInt) return String(Math.round(v));
  let dec = c.decimals;
  if (c.scale === 'retention') dec = Math.max(dec, 4);
  else {
    const perStep = Math.abs(c.max - c.min) / 200;
    if (perStep > 0) dec = Math.max(dec, Math.min(6, Math.ceil(-Math.log10(perStep))));
  }
  let s = v.toFixed(Math.min(6, dec));
  if (decimalsOf(s) < c.decimals) s = v.toFixed(c.decimals);
  return s;
}

export function halfLifeFrames(perFrameRetention) { return Math.log(0.5) / Math.log(perFrameRetention); }

export function controlAside(c, v) {
  if (c.type === 'duration') return '≈ ' + (v / 60).toFixed(v / 60 < 10 ? 2 : 1) + ' s';
  if (c.type === 'retention') return '½ ' + Math.round(halfLifeFrames(v)) + ' f';
  if (c.type === 'ease') return '½ ' + Math.round(halfLifeFrames(1 - v)) + ' f';
  if (c.type === 'fraction' && c.value >= 0.01) return (v * 100).toFixed(1) + '%';
  return '';
}

export function controlStep(v) {
  if (v < 20) return 1;
  if (v < 120) return 5;
  if (v < 600) return 10;
  if (v < 3000) return 50;
  return 100;
}

export function shortHint(hint, max = 46) {
  const t = String(hint || '').trim();
  if (!t || t.length <= max) return t;
  const clause = t.split(/\s+—\s+|\s+--\s+|;\s+|,\s+|\s+\(/)[0].trim();
  if (clause && clause.length <= max) return clause;
  const cut = (clause || t).slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:—-]+$/, '') + '…';
}

export function controlLine(control, valueText) {
  const head = control.indent + control.kw + control.ws + control.name + control.eq + valueText + control.semi;
  if (!control.comment) return head + control.gap;
  return head + ' '.repeat(Math.max(1, control.commentCol - head.length)) + control.comment;
}

export function writeControl(source, control, valueText) {
  const lines = buildSourceLines(source);
  lines[control.line] = controlLine(control, valueText);
  return lines.join('\n');
}

export function applyAskPatch(source, patch, from = 0, to = null) {
  let next = String(source);
  for (const change of patch || []) {
    const parsed = parseControls(next, from, to);
    const control = parsed && parsed.controls.find((c) => c.name === change.name);
    if (!control) throw new Error('unknown control');
    next = writeControl(next, control, String(change.value));
  }
  return next;
}

export const ASK_TYPE_BUDGET_MS = 900;

export function askLinesAt(elapsedMs, budgetMs, steps) {
  if (steps <= 0) return 0;
  if (!(budgetMs > 0)) return steps;
  return Math.min(steps, Math.max(0, Math.round((elapsedMs / budgetMs) * steps)));
}

export function diffLines(A, B) {
  const n = A.length, m = B.length;
  const dp = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Uint16Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: '=', s: A[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: '-', s: A[i] }); i++; }
    else { out.push({ t: '+', s: B[j] }); j++; }
  }
  while (i < n) out.push({ t: '-', s: A[i++] });
  while (j < m) out.push({ t: '+', s: B[j++] });
  const res = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    for (const o of run) if (o.t === '-') res.push(o);
    for (const o of run) if (o.t === '+') res.push(o);
    run = [];
  };
  for (const o of out) { if (o.t === '=') { flush(); res.push(o); } else run.push(o); }
  flush();
  return res;
}

export function askDiffSteps(fromText, toText) {
  const ops = diffLines(buildSourceLines(fromText), buildSourceLines(toText));
  let steps = 0;
  for (const o of ops) if (o.t !== '=') o.step = steps++;
  return { ops, steps };
}

export function askPartialText(ops, k) {
  const out = [];
  for (const o of ops) {
    if (o.t === '=') out.push(o.s);
    else if (o.t === '-') { if (k <= o.step) out.push(o.s); }
    else if (k > o.step) out.push(o.s);
  }
  return out.join('\n');
}

const SKETCH_BODY_INDENT = '    ';
const quoteSketchValue = (s) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
export function wrapAskBody(body, sketch) {
  const id = (sketch && sketch.id) || 'sketch';
  const name = (sketch && sketch.name) || id;
  const group = sketch && sketch.group;
  const lines = String(body).replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '').split('\n');

  let common = Infinity;
  for (const l of lines) if (l.trim()) common = Math.min(common, l.length - l.trimStart().length);
  if (!Number.isFinite(common)) common = 0;
  return [
    `// sketch: ${id}`,
    'ANIMS.push({',
    `  id: ${quoteSketchValue(id)},`,
    `  name: ${quoteSketchValue(name)},`,
    ...(group ? [`  group: ${quoteSketchValue(group)},`] : []),
    '  make: function () {',
    ...lines.map((l) => (l.trim() ? SKETCH_BODY_INDENT + l.slice(common) : '')),
    '  }',
    '});',
    `// /sketch: ${id}`,
  ].join('\n');
}

export function matchAskRecipe(recipes, prompt) {
  const p = String(prompt || '');
  for (const r of recipes) if (r.match.test(p)) return r;
  return null;
}

export const ASK_SUGGESTIONS = [
  'mirror it four ways',
  'fill the space between them',
  "don't erase, let it paint",
  'make it denser',
  'tile it',
];

const ASK_BODY_DONUTS = `// try editing these
const DONUT_COUNT = 320;   // how many rings fill the sky — scales with the canvas area
const DONUT_R = 2.6;       // outer radius of a ring at full depth, in pixels
const RING_WIDTH = 0.9;    // stroke width of each ring, in pixels
const DRIFT_SPEED = 0.10;  // parallax drift, scaled per ring by its own depth
const CURSOR_REACH = 300;  // radius around the cursor where rings brighten, in pixels

var rings = [], mx = -9999, my = -9999, seededAt = -1;
function seed(w, h) {
  rings = [];
  var n = Math.round(DONUT_COUNT * Math.max(0.25, Math.min(2, (w * h) / (1440 * 900))));
  for (var i = 0; i < n; i++) {
    rings.push({ x: Math.random() * w, y: Math.random() * h,
                 d: 0.3 + Math.random() * 0.7, a: 0.22 + Math.random() * 0.55 });
  }
  seededAt = w;
}
return {
  draw: function (ctx, w, h, f) {
    if (seededAt !== w) seed(w, h);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = RING_WIDTH;
    for (var i = 0; i < rings.length; i++) {
      var s = rings[i];
      s.x += DRIFT_SPEED * s.d;
      if (s.x > w + 6) s.x = -6;
      var dx = s.x - mx, dy = s.y - my;
      var near = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / CURSOR_REACH);
      var a = s.a * (0.45 + 0.55 * near * near);
      ctx.strokeStyle = 'rgba(' + THEME.dot + ',' + a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(s.x, s.y, DONUT_R * s.d + 0.5, 0, 6.283185);
      ctx.stroke();
    }
  },
  onmove: function (x, y) { mx = x; my = y; }
};`;

const ASK_BODY_COMET = `// try editing these
const STAR_COUNT = 540;    // how many stars fill the sky — scales with the canvas area
const DRIFT_SPEED = 0.08;  // parallax drift, scaled per star by its own depth
const COMET_EVERY = 210;   // frames between one comet and the next
const COMET_SPEED = 7.5;   // how fast a comet crosses, px/frame
const TAIL_LENGTH = 120;   // length of the tail trailing the head, in pixels

var stars = [], comets = [], seededAt = -1, since = 0;
function seed(w, h) {
  stars = [];
  var n = Math.round(STAR_COUNT * Math.max(0.25, Math.min(2, (w * h) / (1440 * 900))));
  for (var i = 0; i < n; i++) {
    stars.push({ x: Math.random() * w, y: Math.random() * h,
                 d: 0.3 + Math.random() * 0.7, a: 0.2 + Math.random() * 0.6 });
  }
  seededAt = w;
}
return {
  draw: function (ctx, w, h, f) {
    if (seededAt !== w) seed(w, h);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, w, h);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.x += DRIFT_SPEED * s.d;
      if (s.x > w + 3) s.x = -3;
      ctx.fillStyle = 'rgba(' + THEME.dot + ',' + (s.a * s.d).toFixed(3) + ')';
      ctx.fillRect(s.x, s.y, 1.4 * s.d, 1.4 * s.d);
    }
    since++;
    if (since >= COMET_EVERY) {
      since = 0;
      comets.push({ x: -TAIL_LENGTH, y: Math.random() * h * 0.6, vy: 0.25 + Math.random() * 0.4 });
    }
    for (var c = comets.length - 1; c >= 0; c--) {
      var k = comets[c];
      k.x += COMET_SPEED;
      k.y += COMET_SPEED * k.vy;
      if (k.x - TAIL_LENGTH > w || k.y - TAIL_LENGTH > h) { comets.splice(c, 1); continue; }
      var g = ctx.createLinearGradient(k.x, k.y, k.x - TAIL_LENGTH, k.y - TAIL_LENGTH * k.vy);
      g.addColorStop(0, 'rgba(' + THEME.glow + ',0.85)');
      g.addColorStop(1, 'rgba(' + THEME.glow + ',0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(k.x, k.y);
      ctx.lineTo(k.x - TAIL_LENGTH, k.y - TAIL_LENGTH * k.vy);
      ctx.stroke();
      ctx.fillStyle = 'rgba(' + THEME.glow + ',0.95)';
      ctx.beginPath();
      ctx.arc(k.x, k.y, 1.8, 0, 6.283185);
      ctx.fill();
    }
  }
};`;

const ASK_BODY_PACMAN = `// try editing these
const DOT_GRID = 42;       // spacing between one dot and the next, in pixels
const PAC_SPEED = 1.9;     // how fast pacman crosses the board, px/frame
const CHOMP_EVERY = 34;    // frames for one full open-and-close of the jaw
const GHOSTS = 4;          // how many ghosts trail behind him
const GHOST_LAG = 62;      // distance between one ghost and the next, in pixels

var dots = [], seededAt = -1, px = 0, py = 0, dir = 0, trail = [];
var DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function seed(w, h) {
  dots = [];
  for (var x = DOT_GRID; x < w; x += DOT_GRID) {
    for (var y = DOT_GRID; y < h; y += DOT_GRID) dots.push({ x: x, y: y, on: true });
  }
  px = DOT_GRID; py = DOT_GRID; dir = 0; trail = [];
  seededAt = w;
}
return {
  draw: function (ctx, w, h, f) {
    if (seededAt !== w) seed(w, h);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, w, h);
    px += DIRS[dir][0] * PAC_SPEED;
    py += DIRS[dir][1] * PAC_SPEED;
    if (px > w - DOT_GRID || px < DOT_GRID || py > h - DOT_GRID || py < DOT_GRID) {
      px = Math.max(DOT_GRID, Math.min(w - DOT_GRID, px));
      py = Math.max(DOT_GRID, Math.min(h - DOT_GRID, py));
      dir = (dir + 1) % 4;
    }
    trail.unshift({ x: px, y: py });
    if (trail.length > GHOSTS * GHOST_LAG) trail.length = GHOSTS * GHOST_LAG;
    ctx.fillStyle = 'rgba(' + THEME.muted + ',0.55)';
    for (var i = 0; i < dots.length; i++) {
      var d = dots[i];
      if (d.on && Math.abs(d.x - px) < DOT_GRID * 0.5 && Math.abs(d.y - py) < DOT_GRID * 0.5) d.on = false;
      if (d.on) { ctx.beginPath(); ctx.arc(d.x, d.y, 1.7, 0, 6.283185); ctx.fill(); }
    }
    var jaw = 0.32 * Math.abs(Math.sin((f % CHOMP_EVERY) / CHOMP_EVERY * Math.PI));
    var face = Math.atan2(DIRS[dir][1], DIRS[dir][0]);
    ctx.fillStyle = 'rgba(' + THEME.accent + ',0.95)';
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, DOT_GRID * 0.34, face + jaw, face - jaw + 6.283185);
    ctx.closePath();
    ctx.fill();
    for (var g = 1; g <= GHOSTS; g++) {
      var t = trail[Math.min(trail.length - 1, g * GHOST_LAG)];
      if (!t) continue;
      var r = DOT_GRID * 0.28;
      ctx.fillStyle = 'rgba(' + THEME.line + ',' + (0.75 - g * 0.12).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(t.x, t.y - r * 0.3, r, Math.PI, 0);
      ctx.lineTo(t.x + r, t.y + r * 0.8);
      ctx.lineTo(t.x - r, t.y + r * 0.8);
      ctx.closePath();
      ctx.fill();
    }
  }
};`;

const ASK_BODY_BROKEN = `// try editing these
const DROP_COUNT = 340;    // how many drops are falling at once
const FALL_SPEED = 4.2;    // how fast a drop falls, px/frame
const DROP_LENGTH = 14;    // length of a single drop, in pixels

var drops = [], seededAt = -1;
function seed(w, h) {
  drops = [];
  for (var i = 0; i < DROP_COUNT; i++) {
    drops.push({ x: Math.random() * w, y: Math.random() * h, d: 0.4 + Math.random() * 0.6 });
  }
  seededAt = w;
}
return {
  draw: function (ctx, w, h, f) {
    if (seededAt !== w) seed(w, h);
    ctx.fillStyle = THEME.bg;
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1;
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];
      d.y += FALL_SPEED * d.d;
      if (d.y > h) { d.y = -DROP_LENGTH; d.x = Math.random() * w; }
      ctx.strokeStyle = 'rgba(' + THEME.line + ',' + (0.5 * d.d * TWINKLE).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x, d.y + DROP_LENGTH * d.d);
      ctx.stroke();
    }
  }
};`;

export const ASK_RECIPES = [
  { id: 'donuts', label: 'make the stars into small donuts',
    match: /donut|doughnut|\bring\b|torus/i, body: ASK_BODY_DONUTS },
  { id: 'comet', label: 'add a comet every few seconds',
    match: /comet|shooting star|meteor/i, body: ASK_BODY_COMET },
  { id: 'pacman', label: 'make a pacman game',
    match: /pac[\s-]?man|\bgame\b|chomp/i, body: ASK_BODY_PACMAN },
];

export const ASK_FAILING_PROMPT = 'make it rain';

export function createMockAskTransport(recipes, opts = {}) {
  const { available = true, latencyMs = 1400, failingBody = ASK_BODY_BROKEN } = opts;
  return {
    async health() { return available; },
    edit({ prompt, signal }) {
      return new Promise((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          const e = new Error('the earlier request was dropped');
          e.name = 'AbortError';
          reject(e);
        };
        const timer = setTimeout(() => {
          if (signal) signal.removeEventListener('abort', abort);
          const hit = matchAskRecipe(recipes, prompt);
          resolve(hit ? { body: hit.body } : { body: failingBody });
        }, latencyMs);
        if (signal) {
          if (signal.aborted) return abort();
          signal.addEventListener('abort', abort, { once: true });
        }
      });
    },
  };
}

export function createHttpAskTransport(fetchImpl, base = '/api') {
  return {
    async health() {
      try {
        const r = await fetchImpl(base + '/health', { method: 'GET', cache: 'no-store' });
        return !!(r && r.ok);
      } catch (e) {
        return false;
      }
    },
    async edit({ sketchId, prompt, signal }) {
      const r = await fetchImpl(base + '/edit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },

        body: JSON.stringify({ sketchId, prompt }),
        signal,
      });
      if (!r || !r.ok) {
        const said = await r.json().catch(() => null);
        throw new Error((said && said.error) || "couldn't reach the editor for that one");
      }
      const data = await r.json();
      if (Array.isArray(data.patch) && data.patch.length) return { patch: data.patch };
      const body = data && data.body;
      if (typeof body !== 'string' || !body.trim()) throw new Error('the answer came back empty');
      return { body };
    },
  };
}

// node --test imports this module; don't bind fetch at load.
const ASK_TRANSPORT = typeof window === 'undefined'
  ? null
  : createHttpAskTransport(fetch.bind(window));

export function chunkBoundaries(total) {
  if (total <= 0) return [];
  const n = Math.max(1, Math.min(5 + Math.floor(Math.random() * 3), total));
  const raw = [];
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += Math.pow(0.6, i); raw.push(acc); }
  const scale = raw[n - 1];
  const out = [];
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const target = i === n - 1 ? total : Math.round((raw[i] / scale) * total);
    prev = Math.min(total, Math.max(target, prev + 1));
    out.push(prev);
  }
  return out.filter((v, i) => i === 0 || v > out[i - 1]);
}

export function sidePairs(boundaries, grow) {
  const seq = grow ? boundaries : [...boundaries].reverse();
  const withZero = grow ? [0, ...seq] : [...seq, 0];
  const pairs = [];
  for (let i = 0; i < withZero.length - 1; i++) pairs.push({ old: withZero[i], to: withZero[i + 1] });
  return pairs;
}

export function focusReducer(state, event) {
  if (event === 'toggle') return state === 'code' ? 'content' : 'code';
  if (event === 'escape') return 'content';
  if (event === 'enter') return 'code';
  return state;
}

export function cycle(idx, delta, n) { return ((idx + delta) % n + n) % n; }

export function debounce(fn, ms) {
  let t = null;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

async function pipeThrough(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

// Inflate cap — a tiny #s/ fragment must not decompress without bound.
export const SHARE_MAX_ENCODED_LEN = 1024 * 1024;
export const SHARE_MAX_DECODED_BYTES = 512 * 1024;

export async function encodeShare(source) {
  const deflated = await pipeThrough(new TextEncoder().encode(source), new CompressionStream('deflate'));
  let bin = '';
  for (const b of deflated) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export async function decodeShare(encoded) {
  if (typeof encoded !== 'string' || !encoded || encoded.length > SHARE_MAX_ENCODED_LEN) {
    throw new Error('share link is invalid or too large');
  }
  const b64 = encoded.replaceAll('-', '+').replaceAll('_', '/');
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > SHARE_MAX_DECODED_BYTES) {
      await reader.cancel();
      throw new Error('share link exceeds the decompressed size cap');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
}

function withBase(text) {

  if (/<base[\s>]/i.test(text)) return text;
  return text.replace(/<head([^>]*)>/i, (m, a) => `<head${a}><base href="${document.baseURI}">`);
}

const META_ESCAPE_RE = /[&<>"]/g;
const META_ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
// Carries the sketch id in a meta tag — this file is spliced into a <script>.
export function withPreviewSketch(text, sketchId) {
  if (!sketchId) return text;
  const safe = String(sketchId).replace(META_ESCAPE_RE, (c) => META_ESCAPE_MAP[c]);
  return text.replace(/<head([^>]*)>/i, (m, a) => `<head${a}><meta name="preview-sketch" content="${safe}">`);
}

let machineSrc = null;
async function getMachineSrc() {
  if (machineSrc !== null) return machineSrc;
  try {
    machineSrc = await (await fetch('machine.js', { cache: 'no-cache' })).text();
  } catch (e) {
    return null;
  }
  return machineSrc;
}

let cssSrc = null;
async function getCssSrc() {
  if (cssSrc !== null) return cssSrc;
  try {
    cssSrc = await (await fetch('site.css', { cache: 'no-cache' })).text();
  } catch (e) {
    return null;
  }
  return cssSrc;
}

const SCRIPT_OPEN = '<script type="module">';
// Split so inlining this file cannot close the surrounding <script>.
const CLOSE_TAG_SEQ = '<' + '/script';
const SCRIPT_CLOSE = CLOSE_TAG_SEQ + '>';
const MODULE_TAG_RE = /<script\s+type="module"\s+src="machine\.js"><\/script>/;

function inlineMachine(text, src) {
  if (!src) return text;
  const m = MODULE_TAG_RE.exec(text);
  if (!m) return text;

  const escaped = src.split(CLOSE_TAG_SEQ).join('<\\/script');
  return text.slice(0, m.index) + SCRIPT_OPEN + '\n' + escaped + '\n' + SCRIPT_CLOSE
    + text.slice(m.index + m[0].length);
}

const STYLE_LINK_RE = /<link\b(?=[^>]*\bhref=["']site\.css["'])(?=[^>]*\brel=["']stylesheet["'])[^>]*>/i;

function buildStandalone(text) {
  let out = text;
  if (cssSrc) {
    const m = STYLE_LINK_RE.exec(out);
    if (m) out = out.slice(0, m.index) + '<style>\n' + cssSrc + '\n</style>' + out.slice(m.index + m[0].length);
  }
  return inlineMachine(out, machineSrc);
}

const THEMES = {
  dark:  { bg: '#0d0d0f', bgRGB: '13,13,15',    line: '90,175,150', glow: '120,205,175',
           dot: '237,233,223', accent: '217,200,160', muted: '141,145,150',
           bird: '206,209,201', panel: '20,20,25' },
  light: { bg: '#f4f1ea', bgRGB: '244,241,234', line: '33,105,74',  glow: '28,90,64',
           dot: '60,58,52',    accent: '131,100,42',  muted: '120,116,108',
           bird: '96,93,86',   panel: '228,224,214' },
};
function isLight() { return document.documentElement.getAttribute('data-theme') === 'light'; }
if (typeof document !== 'undefined') window.THEME = THEMES[isLight() ? 'light' : 'dark'];

const CONTROL_TRACKS = [[6.5, 15.5], [12, 8], [17.5, 12]];
const CONTROL_ICON =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.3" stroke-linecap="round" aria-hidden="true">' +
  CONTROL_TRACKS.map((t) => '<path d="M4 ' + t[0] + 'H20"/>').join('') +
  CONTROL_TRACKS.map((t) => '<circle cx="' + t[1] + '" cy="' + t[0] + '" r="2.1" fill="currentColor" stroke="none"/>').join('') +
  '</svg>';

function bootPreview() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const ANIMS = window.ANIMS || [];
  if (!ANIMS.length) return;

  let w = 0, h = 0, f = 0, inst = null, idx = 0;
  function size() {
    const d = Math.min(devicePixelRatio || 1, 1.5);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * d; canvas.height = h * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg');
    ctx.fillRect(0, 0, w, h);
  }
  addEventListener('resize', size);

  function activate(i) {
    idx = cycle(i, 0, ANIMS.length);
    inst = ANIMS[idx].make();
    f = 0;
    size();
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  (function loop() {
    if (inst && !document.hidden) { inst.draw(ctx, w, h, f++); if (reduced && f >= 1) inst = { draw() {} }; }
    requestAnimationFrame(loop);
  })();
  canvas.addEventListener('mousemove', (e) => {
    if (inst && inst.onmove) inst.onmove(e.clientX, e.clientY);
  });

  canvas.addEventListener('click', (e) => {
    if (inst && inst.onclick) inst.onclick(e.clientX, e.clientY);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); activate(cycle(idx, -1, ANIMS.length)); }
    if (e.key === 'ArrowRight') { e.preventDefault(); activate(cycle(idx, +1, ANIMS.length)); }
  });

  const wantedEl = document.querySelector('meta[name="preview-sketch"]');
  const wantedId = wantedEl && wantedEl.getAttribute('content');
  activate(wantedId ? Math.max(0, ANIMS.findIndex((a) => a.id === wantedId)) : 0);
}

async function boot() {
  let source = null;

  const url = documentUrl(location.href);
  if (url) {
    try {
      source = await (await fetch(url, { cache: 'no-cache' })).text();
    } catch (e) {

    }
  }
  if (source === null) { bootPreview(); return; }

  const ANIMS = window.ANIMS || [];
  const sketches = hasSketches(document, ANIMS);
  const scopable = hasSketchScope(document, ANIMS, source);

  let w = 0, h = 0, f = 0, inst = null, idx = 0;

  getMachineSrc();
  getCssSrc();

  const ghost = document.createElement('div');
  ghost.id = 'ghost';
  ghost.setAttribute('aria-hidden', 'true');
  document.body.appendChild(ghost);

  const root = document.createElement('div');
  root.id = 'stage-root';

  root.innerHTML = `
    <button id="pill" type="button" aria-label="View source">‹/› source</button>
  ` + (sketches ? `
    <div id="placard">
      <button id="pl-prev" type="button" aria-label="Previous animation">‹</button>
      <span id="pl-count"></span>
      <button id="pl-name" type="button" aria-haspopup="listbox">…</button>
      <button id="pl-next" type="button" aria-label="Next animation">›</button>
    </div>
    <div id="pl-list" role="listbox"></div>
  ` : '');
  document.body.appendChild(root);
  function buildGhost(text) {
    ghost.innerHTML = '';
    const frag = document.createDocumentFragment();
    buildSourceLines(text).forEach((l, i) => {
      const row = document.createElement('div');
      row.className = 'gline';
      const no = document.createElement('span');
      no.className = 'gno';
      no.textContent = i + 1;
      const tx = document.createElement('span');
      tx.className = 'gtx';

      tx.innerHTML = l === '' ? ' ' : highlightGhostLine(l);
      row.append(no, tx);
      frag.appendChild(row);
    });
    ghost.appendChild(frag);
    const caret = document.createElement('span');
    caret.id = 'gcaret';
    ghost.appendChild(caret);
  }
  buildGhost(source);

  const firstSketchId = ANIMS[0]?.id;
  if (firstSketchId) syncGhostScroll(firstSketchId);

  window.__machine = { source, root, ghost };

  let editorView = null, editorLoading = false, currentSource = source, cmRef = null;
  let themeCompartment = null, editorThemeExt = null;
  let ghostSource = source;

  let scoped = false, scopeTimer = null, cascadeCancel = null, beatHideTimer = null, sketchFocusEffect = null;

  let applyingControl = false;

  let applyingAsk = false, askFlight = null, promptOwnsUndo = false, askReadOnly = null;
  const askUndoStack = [];

  let askWrap = null, askBar = null, askIn = null, askWord = null, askGlyph = null,
      askOpenBtn = null, askErrEl = null, askScratch = null, askCollapseT = 0;
  const previewFrame = document.createElement('iframe');
  previewFrame.id = 'preview-frame';
  previewFrame.setAttribute('sandbox', 'allow-scripts');
  const resetBtn = document.createElement('button');
  resetBtn.id = 'reset-btn'; resetBtn.type = 'button'; resetBtn.textContent = 'reset';
  root.appendChild(resetBtn);

  let scopeBtn = null;

  const tunable = sketches && ANIMS.some((a) => {
    const r = sketchRange(source, a.id);
    const b = r && parseControls(source, r.from, r.to);
    return !!(b && b.controls.length);
  });
  let ctlBtn = null, ctlPanel = null, ctlBody = null, ctlBlock = null;
  if (tunable) {
    ctlBtn = document.createElement('button');
    ctlBtn.id = 'ctl-btn'; ctlBtn.type = 'button';
    ctlBtn.title = 'controls';
    ctlBtn.setAttribute('aria-label', 'controls');
    ctlBtn.setAttribute('aria-expanded', 'false');
    ctlBtn.setAttribute('aria-controls', 'ctl-panel');
    ctlBtn.innerHTML = CONTROL_ICON;
    root.appendChild(ctlBtn);
    ctlPanel = document.createElement('div');
    ctlPanel.id = 'ctl-panel';
    ctlPanel.setAttribute('role', 'group');
    ctlPanel.setAttribute('aria-label', 'controls');

    ctlPanel.innerHTML =
      '<div id="ctl-head"><span>controls</span>' +
      '<button id="ctl-scope" type="button"></button></div>' +
      '<div id="ctl-body"></div>';
    root.appendChild(ctlPanel);
    ctlBody = ctlPanel.querySelector('#ctl-body');
    ctlBtn.addEventListener('click', () => setControlsOpen(!ctlPanel.classList.contains('open')));
    ctlBody.addEventListener('scroll', ctlScrollState);
    const headScope = ctlPanel.querySelector('#ctl-scope');
    if (scopable) { scopeBtn = headScope; updateScopeToggle(); }
    else headScope.remove();
  }

  const editorHost = document.createElement('div');
  editorHost.id = 'editor-host';
  root.appendChild(editorHost);

  const renderPreview = debounce((text) => {
    if (!previewFrame.isConnected) document.body.appendChild(previewFrame);
    previewFrame.srcdoc = withPreviewSketch(withBase(inlineMachine(text, machineSrc)), ANIMS[idx] && ANIMS[idx].id);
    document.body.classList.add('previewing');
  }, 500);

  function resetEdits() {

    askAbandon();
    askUndoStack.length = 0;
    promptOwnsUndo = false;
    askSetError(null);

    if (editorView) editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: source } });
    renderPreview.cancel();
    currentSource = source;
    previewFrame.remove();
    document.body.classList.remove('previewing');
    location.hash = '';

    if (scoped && editorView && cmRef) foldToActiveSketch();

    document.body.classList.remove('tuned');
    if (ghostSource !== source) { buildGhost(source); ghostSource = source; }
    buildControlPanel();
    if (sketches && ANIMS.length) { inst = ANIMS[idx].make(); f = 0; size(); }
  }
  resetBtn.addEventListener('click', resetEdits);

  if (scopeBtn) scopeBtn.addEventListener('click', () => { if (scoped) scopeOut(true); else scopeIn(true); });

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buildStandalone(currentSource)], { type: 'text/html' }));

      a.download = location.pathname.split('/').pop() || 'index.html';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  });

  if (location.hash.startsWith('#s/')) {
    history.replaceState(null, '', location.pathname + location.search);
  }

  async function enterEditor() {
    document.body.classList.add('editing');
    trackEvent('editor_open');
    if (!editorView && !editorLoading) {
      editorLoading = true;
      try {
        const cm = await import('./vendor/codemirror.js');
        cmRef = cm;

        const chrome = (dark) => cm.EditorView.theme({
          '&': { backgroundColor: 'transparent' },
          '.cm-content': { caretColor: 'var(--jade)' },
          '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--jade)', borderLeftWidth: '2px' },
          '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--jade) 4%, transparent)' },
          '.cm-selectionBackground, &.cm-focused .cm-selectionBackground':
            { backgroundColor: 'color-mix(in srgb, var(--jade) 18%, transparent)' },
          '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#4a4e55' },
        }, { dark });
        const highlight = (c) => cm.HighlightStyle.define([
          { tag: cm.tags.comment, color: c.comment, fontStyle: 'italic' },
          { tag: [cm.tags.tagName, cm.tags.keyword], color: c.tag },
          { tag: [cm.tags.attributeName, cm.tags.propertyName, cm.tags.function(cm.tags.variableName)], color: c.attr },
          { tag: [cm.tags.string, cm.tags.attributeValue], color: c.string },
          { tag: cm.tags.number, color: c.number },
          { tag: [cm.tags.operator, cm.tags.punctuation, cm.tags.bracket], color: c.punct },
          { tag: [cm.tags.variableName, cm.tags.content], color: c.text },
        ]);
        const DARK_SYNTAX  = { comment: '#6b6f76', tag: '#5aaf96', attr: '#8fd0bc', string: '#d9c8a0',
                               number: '#e0cfa6', punct: '#9a9890', text: '#ede9df' };
        const LIGHT_SYNTAX = { comment: '#8a877e', tag: '#21694a', attr: '#1c5f45', string: '#83642a',
                               number: '#83642a', punct: '#5f5c55', text: '#1c1c1e' };
        editorThemeExt = () => [
          chrome(!isLight()),
          cm.syntaxHighlighting(highlight(isLight() ? LIGHT_SYNTAX : DARK_SYNTAX)),
        ];
        themeCompartment = new cm.Compartment();

        askReadOnly = new cm.Compartment();
        editorView = new cm.EditorView({
          parent: editorHost,
          state: cm.EditorState.create({
            doc: currentSource,
            extensions: [cm.basicSetup, cm.html(), themeCompartment.of(editorThemeExt()), sketchFocusField(cm),
              askReadOnly.of(cm.EditorState.readOnly.of(false)),
              cm.EditorView.updateListener.of(u => {

                if (u.docChanged && applyingAsk) return;

                if (u.docChanged && applyingControl) { currentSource = u.state.doc.toString(); return; }
                if (u.docChanged) {

                  promptOwnsUndo = false;
                  currentSource = u.state.doc.toString(); renderPreview(currentSource);

                  const gathering = !!(scopeTimer || cascadeCancel);
                  if (scopeTimer) { clearTimeout(scopeTimer); scopeTimer = null; }
                  cancelCascade();

                  if (scoped && gathering && editorView && cmRef) foldToActiveSketch({ moveSelection: false });
                  hideBeat();
                }
              })],
          }),
        });
      } catch (e) {
        editorLoading = false;
        throw e;
      }
    }
    if (!editorView) return;

    const bounds = sketchBounds();
    if (bounds) editorView.dispatch({ selection: { anchor: bounds.from }, scrollIntoView: true });

    editorView.focus();
    armAutoScope();
  }
  function exitEditor() {
    document.body.classList.remove('editing');

    askAbandon();
    clearTimeout(scopeTimer); scopeTimer = null;
    cancelCascade();
    clearTimeout(beatHideTimer); beatHideTimer = null;
    if (editorView && cmRef) { cmRef.unfoldAll(editorView); hideBeat(); }
    scoped = false; updateScopeToggle();
    if (currentSource !== ghostSource) { buildGhost(currentSource); ghostSource = currentSource; }
  }

  new MutationObserver(() => {
    window.THEME = THEMES[isLight() ? 'light' : 'dark'];
    size();
    if (editorView && themeCompartment) editorView.dispatch({ effects: themeCompartment.reconfigure(editorThemeExt()) });
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function sketchBounds() {
    if (!editorView || !ANIMS.length) return null;
    const doc = editorView.state.doc;
    const b = sketchBlock(doc.toString(), ANIMS[idx].id);
    if (!b) return null;
    return { from: doc.line(b.from + 1).from, to: doc.line(b.to + 1).to };
  }

  function updateScopeToggle() {
    if (!scopeBtn) return;

    scopeBtn.textContent = scoped ? 'whole page' : 'sketch';
  }

  function sketchFocusField(cm) {
    sketchFocusEffect = cm.StateEffect.define();
    const focusLine = cm.Decoration.line({ class: 'cm-sketch-focus' });
    return cm.StateField.define({
      create() { return cm.Decoration.none; },
      update(deco, tr) {
        for (const e of tr.effects) {
          if (e.is(sketchFocusEffect)) {
            if (!e.value) return cm.Decoration.none;
            const doc = tr.state.doc;
            const a = doc.lineAt(Math.min(e.value.from, e.value.to));
            const b = doc.lineAt(Math.max(e.value.from, e.value.to));
            const builder = new cm.RangeSetBuilder();
            for (let n = a.number; n <= b.number; n++) builder.add(doc.line(n).from, doc.line(n).from, focusLine);
            return builder.finish();
          }
        }
        return deco.map(tr.changes);
      },
      provide: f => cm.EditorView.decorations.from(f),
    });
  }
  function showBeat() {
    if (!editorView || !sketchFocusEffect) return;
    const bounds = sketchBounds();
    if (!bounds) return;
    clearTimeout(beatHideTimer); beatHideTimer = null;
    editorView.dispatch({ effects: sketchFocusEffect.of(bounds) });
  }
  function hideBeat() {
    if (!editorView || !sketchFocusEffect) return;
    editorView.dispatch({ effects: sketchFocusEffect.of(null) });
  }
  function hideBeatSoon() {
    clearTimeout(beatHideTimer);
    beatHideTimer = setTimeout(() => { beatHideTimer = null; hideBeat(); }, 600);
  }

  function foldToActiveSketch({ moveSelection = true } = {}) {
    if (!editorView || !cmRef || !cmRef.foldEffect) return;
    cmRef.unfoldAll(editorView);
    const bounds = sketchBounds();
    if (!bounds) return;
    const { from: startOfSketch, to: endOfSketch } = bounds;
    const doc = editorView.state.doc;

    const head = moveSelection ? startOfSketch : editorView.state.selection.main.head;
    const effects = [];
    if (startOfSketch > 0 && head >= startOfSketch) effects.push(cmRef.foldEffect.of({ from: 0, to: startOfSketch - 1 }));
    if (endOfSketch < doc.length && head <= endOfSketch) effects.push(cmRef.foldEffect.of({ from: endOfSketch + 1, to: doc.length }));
    if (effects.length) editorView.dispatch({ effects });
    if (moveSelection) editorView.dispatch({ selection: { anchor: startOfSketch }, scrollIntoView: true });
  }

  function buildCascade(doc, startOfSketch, endOfSketch, grow) {
    const beforeLen = Math.max(0, startOfSketch - 1);
    const afterLen = Math.max(0, doc.length - (endOfSketch + 1));
    const beforePairs = sidePairs(chunkBoundaries(beforeLen), grow);
    const afterPairs = sidePairs(chunkBoundaries(afterLen), grow);
    const steps = [];
    const n = Math.max(beforePairs.length, afterPairs.length);
    for (let i = 0; i < n; i++) {
      if (i < beforePairs.length) {
        const { old, to } = beforePairs[i];
        const effects = [];
        if (old > 0) effects.push(cmRef.unfoldEffect.of({ from: 0, to: old }));
        if (to > 0) effects.push(cmRef.foldEffect.of({ from: 0, to }));
        if (effects.length) steps.push({ effects });
      }
      if (i < afterPairs.length) {
        const { old, to } = afterPairs[i];
        const effects = [];
        if (old > 0) effects.push(cmRef.unfoldEffect.of({ from: doc.length - old, to: doc.length }));
        if (to > 0) effects.push(cmRef.foldEffect.of({ from: doc.length - to, to: doc.length }));
        if (effects.length) steps.push({ effects });
      }
    }
    const N = steps.length;
    steps.forEach((s, k) => {
      const t = N <= 1 ? 0 : k / (N - 1);
      const base = 90 - 45 * t;
      s.delay = Math.max(20, base + (Math.random() - 0.5) * 50);
    });
    return steps;
  }

  function staggered(steps, anchorPos, done) {
    let i = 0, timer = null;
    function next() {
      if (i >= steps.length) { timer = null; if (done) done(); return; }
      const step = steps[i++];
      if (editorView) editorView.dispatch({ effects: step.effects, selection: { anchor: anchorPos }, scrollIntoView: true });
      timer = setTimeout(next, step.delay);
    }
    next();
    return () => { clearTimeout(timer); timer = null; };
  }
  function cancelCascade() {
    if (cascadeCancel) { cascadeCancel(); cascadeCancel = null; }
  }

  function scopeIn(animated) {
    if (!editorView || !cmRef || !cmRef.foldEffect) return;

    const bounds = sketchBounds();
    if (!bounds) return;
    cancelCascade();
    scoped = true; updateScopeToggle();
    showBeat();
    if (!animated || reduced) { foldToActiveSketch(); hideBeatSoon(); return; }
    cmRef.unfoldAll(editorView);
    const doc = editorView.state.doc;
    const steps = buildCascade(doc, bounds.from, bounds.to, true);
    if (!steps.length) { foldToActiveSketch(); hideBeatSoon(); return; }
    cascadeCancel = staggered(steps, bounds.from, () => { cascadeCancel = null; hideBeatSoon(); });
  }

  function scopeOut(animated) {
    if (!editorView || !cmRef) return;
    cancelCascade();
    clearTimeout(scopeTimer); scopeTimer = null;
    clearTimeout(beatHideTimer); beatHideTimer = null;
    hideBeat();
    scoped = false; updateScopeToggle();
    if (!animated || reduced) { cmRef.unfoldAll(editorView); return; }

    foldToActiveSketch();
    const bounds = sketchBounds();
    if (!bounds) { cmRef.unfoldAll(editorView); return; }
    const doc = editorView.state.doc;
    const steps = buildCascade(doc, bounds.from, bounds.to, false);
    if (!steps.length) { cmRef.unfoldAll(editorView); return; }
    cascadeCancel = staggered(steps, bounds.from, () => { cascadeCancel = null; });
  }

  function armAutoScope() {
    clearTimeout(scopeTimer);
    cancelCascade();

    if (!sketchBounds()) return;
    showBeat();
    scopeTimer = setTimeout(() => { scopeTimer = null; scopeIn(true); }, 800);
  }

  let focus = 'content';
  const pill = root.querySelector('#pill');
  pill.title = 'press / or ` to toggle — esc to leave';
  function applyFocus(next) {
    focus = next;
    document.body.classList.toggle('code-focus', focus === 'code');
    pill.textContent = focus === 'code' ? 'esc hide' : '‹/› source';
    window.__machine.focus = focus;
    if (focus === 'code') enterEditor(); else exitEditor();
  }
  pill.addEventListener('click', () => applyFocus(focusReducer(focus, 'toggle')));

  function typingIntoField(e) {
    return !!e.target.closest('#editor-host, input, textarea, [contenteditable]');
  }
  document.addEventListener('keydown', (e) => {
    if ((e.key === '`' || e.key === '/') && !e.metaKey && !e.ctrlKey && !typingIntoField(e)) {
      e.preventDefault();
      applyFocus(focusReducer(focus, 'toggle'));
    }
    if (e.key === 'Escape') {

      if (askIsOpen()) { askCollapse(); return; }

      if (listEl && listEl.classList.contains('open')) { listEl.classList.remove('open'); return; }

      if (ctlPanel && ctlPanel.classList.contains('open')) { setControlsOpen(false); ctlBtn.focus(); return; }
      applyFocus(focusReducer(focus, 'escape'));
    }
  });
  applyFocus('content');

  const canvas = sketches ? document.getElementById('bg-canvas') : null;
  const ctx = canvas ? canvas.getContext('2d') : null;
  const nameEl = root.querySelector('#pl-name');
  const countEl = root.querySelector('#pl-count');
  const listEl = root.querySelector('#pl-list');
  function size() {
    if (!ctx) return;
    const d = Math.min(devicePixelRatio || 1, 1.5);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * d; canvas.height = h * d;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg');
    ctx.fillRect(0, 0, w, h);
  }
  addEventListener('resize', size);
  addEventListener('resize', syncListMinWidth);

  if (canvas && typeof ResizeObserver !== 'undefined') new ResizeObserver(syncControlWidth).observe(canvas);
  else addEventListener('resize', syncControlWidth);

  function syncGhostScroll(id) {
    const line = findSketchLine(source, id);
    if (line < 0) return;
    const lh = ghost.querySelector('.gline')?.offsetHeight || 18;
    ghost.scrollTop = Math.max(0, line * lh - 80);
  }

  function instantiateFromSource() {
    const id = ANIMS[idx] && ANIMS[idx].id;
    const r = id ? sketchRange(currentSource, id) : null;
    if (!r) return null;
    const before = ANIMS.length;
    const el = document.createElement('script');
    el.textContent = buildSourceLines(currentSource).slice(r.from, r.to + 1).join('\n');
    document.head.appendChild(el);
    el.remove();
    const added = ANIMS.splice(before);
    const entry = added[added.length - 1];

    if (!entry || typeof entry.make !== 'function') return null;
    try { return entry.make(); } catch (e) { return null; }
  }

  function reinstantiate() {
    const next = instantiateFromSource();
    if (!next) return;
    inst = next; f = 0; size();
  }

  function commitControl(control, valueText) {
    const inSync = ghostSource === currentSource;
    const text = controlLine(control, valueText);
    currentSource = writeControl(currentSource, control, valueText);

    if (inSync) { patchGhostLine(control.line, text); ghostSource = currentSource; }
    if (editorView) {
      const doc = editorView.state.doc;
      if (control.line + 1 <= doc.lines) {
        const ln = doc.line(control.line + 1);
        applyingControl = true;
        try { editorView.dispatch({ changes: { from: ln.from, to: ln.to, insert: text } }); }
        finally { applyingControl = false; }
      }
    }
    document.body.classList.toggle('tuned', currentSource !== source);
  }
  function patchGhostLine(i, text) {
    const row = ghost.children[i];
    if (!row || !row.classList || !row.classList.contains('gline')) return;
    const tx = row.querySelector('.gtx');
    if (tx) tx.innerHTML = text === '' ? ' ' : highlightGhostLine(text);
  }

  function setControlsOpen(open) {
    if (!ctlPanel) return;
    ctlPanel.classList.toggle('open', open);
    ctlBtn.setAttribute('aria-expanded', String(open));
    if (open) ctlScrollState();
  }

  function ctlScrollState() {
    if (!ctlBody) return;
    const atEnd = ctlBody.scrollTop + ctlBody.clientHeight >= ctlBody.scrollHeight - 2;
    ctlBody.classList.toggle('at-end', atEnd);
  }

  function syncControlWidth() {
    const px = canvas ? canvas.clientWidth : (typeof innerWidth === 'number' ? innerWidth : 1024);
    document.body.classList.toggle('ctl-narrow', px < 460);
    ctlScrollState();
  }

  function buildControlPanel() {
    if (!ctlBtn) return;
    const id = ANIMS[idx] && ANIMS[idx].id;
    const live = id ? sketchRange(currentSource, id) : null;
    const block = live && parseControls(currentSource, live.from, live.to);
    ctlBlock = block && block.controls.length ? block : null;
    ctlBtn.classList.toggle('gone', !ctlBlock);
    ctlBody.innerHTML = '';
    if (!ctlBlock) { setControlsOpen(false); return; }
    const caps = findControlCaps(currentSource, ctlBlock, live.to);

    const pristine = sketchRange(source, id);
    const pb = pristine && parseControls(source, pristine.from, pristine.to);
    const authored = {};
    if (pb) for (const k of pb.controls) authored[k.name] = k;
    for (const k of ctlBlock.controls) {
      const c = controlType(authored[k.name] || k, caps);
      const cur = parseFloat(k.authored);

      if (isFinite(cur)) { c.min = Math.min(c.min, cur); c.max = Math.max(c.max, cur); }
      ctlBody.appendChild(controlRow(k, c, isFinite(cur) ? cur : c.value));
    }
    ctlScrollState();
  }

  function controlRow(k, c, cur) {
    const row = document.createElement('div');
    row.className = 'ctl-row';
    const top = document.createElement('div');
    top.className = 'ctl-top';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'ctl-name'; nameSpan.textContent = k.name;
    const valSpan = document.createElement('span');
    valSpan.className = 'ctl-val';
    const asideSpan = document.createElement('span');
    asideSpan.className = 'ctl-aside';
    top.append(nameSpan, valSpan);
    if (c.unit) {
      const unitSpan = document.createElement('span');
      unitSpan.className = 'ctl-unit'; unitSpan.textContent = c.unit;
      top.append(unitSpan);
    }
    top.append(asideSpan);
    row.appendChild(top);

    const brief = shortHint(k.hint);
    if (brief) {
      const hintEl = document.createElement('div');
      hintEl.className = 'ctl-hint';
      hintEl.textContent = brief;
      if (brief !== k.hint) hintEl.title = k.hint;
      row.appendChild(hintEl);
    }
    const label = k.name + (k.hint ? ' — ' + k.hint : '');
    const paint = (text) => {
      valSpan.textContent = text;
      asideSpan.textContent = controlAside(c, parseFloat(text));
      row.classList.toggle('ctl-moved', text !== c.authoredText);
    };

    // make() re-seeds — rebuild at most once per frame, not per pointer pixel
    let lastWritten = formatControlValue(c, cur), lastBuilt = lastWritten, raf = 0;
    const writeLive = (text) => {
      if (text === lastWritten) return;
      lastWritten = text;
      commitControl(k, text);
    };
    const rebuildNow = () => {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (!row.isConnected || lastWritten === lastBuilt) return;
      lastBuilt = lastWritten;
      reinstantiate();
    };
    const rebuildSoon = () => {
      if (lastWritten === lastBuilt || raf) return;
      raf = requestAnimationFrame(() => { raf = 0; rebuildNow(); });
    };

    if (c.type === 'count') {
      const wrap = document.createElement('div');
      wrap.className = 'ctl-step';
      const minus = document.createElement('button');
      minus.type = 'button'; minus.textContent = '−';
      minus.setAttribute('aria-label', 'decrease ' + k.name);
      const input = document.createElement('input');
      input.type = 'text'; input.inputMode = 'numeric';
      input.setAttribute('aria-label', label);
      const plus = document.createElement('button');
      plus.type = 'button'; plus.textContent = '+';
      plus.setAttribute('aria-label', 'increase ' + k.name);
      wrap.append(minus, input, plus);
      row.appendChild(wrap);
      const fill = document.createElement('div');
      fill.className = 'ctl-fill';
      const bar = document.createElement('i');
      fill.appendChild(bar);
      row.appendChild(fill);
      const step = controlStep(c.value);
      const set = (v, write, flush) => {
        v = Math.max(c.min, Math.min(c.max, Math.round(v)));
        const text = formatControlValue(c, v);
        input.value = String(v);
        bar.style.width = (controlPosOf(c, v) * 100) + '%';
        paint(text);
        if (!write) return;
        writeLive(text);
        if (flush) rebuildNow();
        else rebuildSoon();
      };
      minus.addEventListener('click', () => set(parseFloat(input.value) - step, true, true));
      plus.addEventListener('click', () => set(parseFloat(input.value) + step, true, true));
      input.addEventListener('change', () => {
        const v = parseFloat(input.value);
        set(isFinite(v) ? v : cur, true, true);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp') { e.preventDefault(); set(parseFloat(input.value) + step, true, true); }
        if (e.key === 'ArrowDown') { e.preventDefault(); set(parseFloat(input.value) - step, true, true); }
      });

      let dragging = false, x0 = 0, v0 = 0;
      input.addEventListener('pointerdown', (e) => {
        dragging = true; x0 = e.clientX; v0 = parseFloat(input.value);
        try { input.setPointerCapture(e.pointerId); } catch (err) {  }
      });
      input.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        e.preventDefault();
        set(v0 + (e.clientX - x0) * Math.max(1, (c.max - c.min) / 320), true, false);
      });
      const endScrub = (e) => {
        if (!dragging) return;
        dragging = false;
        try { input.releasePointerCapture(e.pointerId); } catch (err) {  }
        rebuildNow();
      };
      input.addEventListener('pointerup', endScrub);
      input.addEventListener('pointercancel', endScrub);
      set(cur, false, false);
    } else {
      const track = document.createElement('div');
      track.className = 'ctl-track';
      const range = document.createElement('input');
      range.type = 'range'; range.className = 'ctl-range';
      range.min = '0'; range.max = '200'; range.step = '1';
      range.setAttribute('aria-label', label);
      const tick = document.createElement('span');
      tick.className = 'ctl-authored';
      tick.style.left = 'calc(' + (controlPosOf(c, c.value) * 100) + '% - 0.5px)';
      tick.title = 'authored ' + c.authoredText;
      track.append(range, tick);
      row.appendChild(track);
      const set = (t, flush) => {
        let v = controlValueAt(c, t);
        if (c.isInt) v = Math.round(v);
        const text = formatControlValue(c, v);
        range.style.setProperty('--fill', String(t));
        paint(text);
        writeLive(text);
        if (flush) rebuildNow();
        else rebuildSoon();
      };
      range.addEventListener('input', () => set(+range.value / 200, false));
      range.addEventListener('change', () => set(+range.value / 200, true));
      range.addEventListener('pointerup', () => set(+range.value / 200, true));
      const t0 = controlPosOf(c, cur);
      range.value = String(Math.round(t0 * 200));
      range.style.setProperty('--fill', String(t0));
      paint(formatControlValue(c, cur));
    }

    if (c.capNote) {

      const meta = document.createElement('div');
      meta.className = 'ctl-meta';
      const capEl = document.createElement('span');
      capEl.textContent = c.capNote;
      if (c.capLong) capEl.title = c.capLong;
      meta.appendChild(capEl);
      row.appendChild(meta);
    }
    return row;
  }

  function askIsOpen() { return !!(askBar && askBar.dataset.state !== 'idle'); }

  function askGate(bodyText) {
    const before = ANIMS.length;
    let thrown = null;
    const onError = (e) => { thrown = (e && e.error) || new Error((e && e.message) || 'that answer did not parse'); };
    window.addEventListener('error', onError);
    const el = document.createElement('script');
    el.textContent = bodyText;
    try { document.head.appendChild(el); }
    finally { el.remove(); window.removeEventListener('error', onError); }
    const added = ANIMS.splice(before);
    if (thrown) throw thrown;
    const entry = added[added.length - 1];
    if (!entry || typeof entry.make !== 'function') throw new Error('that answer never pushed a sketch with a make()');
    const made = entry.make();
    if (!made || typeof made.draw !== 'function') throw new Error('make() returned something without a draw()');
    if (!askScratch) askScratch = document.createElement('canvas');
    const sw = 240, sh = 150;
    askScratch.width = sw; askScratch.height = sh;
    const sctx = askScratch.getContext('2d', { willReadFrequently: true });
    sctx.clearRect(0, 0, sw, sh);
    made.draw(sctx, sw, sh, 0);
    const px = sctx.getImageData(0, 0, sw, sh).data;
    let painted = false;
    for (let i = 3; i < px.length; i += 4) { if (px[i] !== 0) { painted = true; break; } }
    if (!painted) throw new Error('it compiled and then drew nothing at all on its first frame');
    return entry;
  }

  function askSetStatus(kind, word) {
    if (!askBar) return;
    askBar.dataset.state = kind;
    askBar.classList.toggle('show-status', kind === 'flight' || kind === 'ok' || kind === 'fail');
    askWord.textContent = word;
    askGlyph.textContent = kind === 'ok' ? '✓' : kind === 'fail' ? '✕' : '';
  }

  function askSetError(message) {
    if (!askErrEl) return;
    document.body.classList.toggle('ask-failed', !!message);
    if (!message) { askErrEl.textContent = ''; return; }
    const running = (ANIMS[idx] && ANIMS[idx].name) || 'the sketch';
    askErrEl.textContent = 'the answer did not survive its first frame — ' + message +
      ' · the canvas is still running ' + running + ', the editor is the broken one';
  }

  function askLock(on) {
    document.body.classList.toggle('ask-writing', on);
    if (ctlPanel) ctlPanel.classList.toggle('busy', on);
    if (editorView && askReadOnly && cmRef) {
      editorView.dispatch({ effects: askReadOnly.reconfigure(cmRef.EditorState.readOnly.of(on)) });
    }
  }

  function askOpen(prefill) {
    if (!askBar) return;
    clearTimeout(askCollapseT);
    askSetStatus('prompting', '');
    askOpenBtn.setAttribute('aria-expanded', 'true');
    if (prefill !== undefined) askIn.value = prefill;
    askSetTyping(askIn.value.length > 0);
    requestAnimationFrame(() => { askIn.focus(); askIn.select(); });
  }
  function askCollapse() {
    if (!askBar || askFlight) return;
    clearTimeout(askCollapseT);
    askSetStatus('idle', '');
    askOpenBtn.setAttribute('aria-expanded', 'false');
    askSetTyping(false);
  }

  function askSetTyping(on) { document.body.classList.toggle('ask-typing', !!on); }

  function askAbandon() {
    if (!askFlight) { if (askBar) askCollapse(); return; }
    const my = askFlight;
    my.cancelled = true;
    my.ctrl.abort();
    if (my.raf) cancelAnimationFrame(my.raf);
    if (my.typed && editorView) {
      askUndoStack.pop();
      askPaintRegion(my, my.fromText);
      currentSource = editorView.state.doc.toString();
    }
    askFlight = null;
    askLock(false);
    if (askBar) askCollapse();
  }

  function askPaintRegion(my, text) {
    applyingAsk = true;
    try { editorView.dispatch({ changes: { from: my.regionFrom, to: my.regionTo, insert: text } }); }
    finally { applyingAsk = false; }
    my.regionTo = my.regionFrom + text.length;
  }

  function askSend(prompt) {
    prompt = String(prompt || '').trim();
    if (!prompt || !askBar || !editorView) return;
    const id = ANIMS[idx] && ANIMS[idx].id;
    const range = id ? sketchRange(currentSource, id) : null;
    if (!range) return;
    trackEvent('ask_submit', { sketch: id });
    const interrupted = !!askFlight;
    if (interrupted) askAbandon();

    clearTimeout(askCollapseT);
    askSetError(null);
    const my = { ctrl: new AbortController(), cancelled: false, raf: 0, typed: false,
                 before: currentSource, prompt };
    askFlight = my;
    askLock(true);
    askSetStatus('flight', (interrupted ? 'dropped the earlier one · ' : '') + 'thinking…');
    ASK_TRANSPORT.edit({ sketchId: id, prompt, signal: my.ctrl.signal }).then((answer) => {
      if (my.cancelled) return;
      askSetStatus('flight', 'writing…');
      askUndoStack.push({ source: my.before, prompt });
      askWrite(my, answer);
    }).catch((e) => {
      if (my.cancelled) return;
      askFlight = null;
      askLock(false);
      askSetStatus('fail', "couldn't do that one");
      askSetError(String((e && e.message) || e));
      askHandBack(prompt);
    });
  }

  function askWrite(my, answer) {
    const sketch = ANIMS[idx];
    const block = sketch && sketch.id ? sketchBlock(currentSource, sketch.id) : null;
    if (!block) { askFlight = null; askLock(false); return; }
    const doc = editorView.state.doc;

    my.regionFrom = doc.line(block.from + 1).from;
    my.regionTo = doc.line(block.to + 1).to;
    my.fromText = doc.sliceString(my.regionFrom, my.regionTo);
    my.typed = true;
    let nextText;
    try {
      if (answer && answer.patch) nextText = applyAskPatch(my.fromText, answer.patch);
      else nextText = wrapAskBody(answer.body, sketch);
    } catch (e) {
      askFlight = null;
      askLock(false);
      askSetStatus('fail', "couldn't do that one");
      askSetError(String((e && e.message) || e));
      askHandBack(my.prompt);
      return;
    }
    const { ops, steps } = askDiffSteps(my.fromText, nextText);
    showBeat();
    const done = (ms) => {
      if (my.cancelled) return;
      askFinish(my, nextText, steps, ms);
    };
    if (!steps) { done(0); return; }
    if (reduced) { askPaintRegion(my, askPartialText(ops, steps)); done(0); return; }
    const t0 = performance.now();
    let last = -1;
    (function step() {
      if (my.cancelled) return;
      const elapsed = performance.now() - t0;
      const k = askLinesAt(elapsed, ASK_TYPE_BUDGET_MS, steps);
      if (k !== last) { last = k; askPaintRegion(my, askPartialText(ops, k)); }
      if (elapsed < ASK_TYPE_BUDGET_MS) { my.raf = requestAnimationFrame(step); return; }
      if (last !== steps) askPaintRegion(my, askPartialText(ops, steps));
      done(Math.round(performance.now() - t0));
    })();
  }

  function askFinish(my, body, changed, ms) {
    askFlight = null;
    askLock(false);
    currentSource = editorView.state.doc.toString();
    let entry = null, failure = null;
    try { entry = askGate(body); } catch (e) { failure = e; }

    if (failure) {
      askSetStatus('fail', "couldn't do that one");
      askSetError(String(failure.message || failure));
      document.body.classList.toggle('tuned', currentSource !== source);
      buildControlPanel();
      askHandBack(my.prompt);
    } else {

      let live = null;
      try { live = entry.make(); } catch (e) { live = null; }
      if (live) { inst = live; f = 0; size(); }
      if (entry.name && nameEl) nameEl.textContent = `— ${entry.name}`;

      renderPreview.cancel();
      previewFrame.remove();
      document.body.classList.remove('previewing');
      document.body.classList.toggle('tuned', currentSource !== source);
      buildControlPanel();
      askSetStatus('ok', `applied · ${changed} lines in ${ms === 0 ? 'one go' : ms + ' ms'} · ⌘Z undoes it`);
      askCollapseT = setTimeout(askCollapse, reduced ? 1800 : 5000);
    }
    promptOwnsUndo = true;
    hideBeatSoon();

    if (scoped && cmRef) foldToActiveSketch();
  }

  function askHandBack(prompt) {
    askCollapseT = setTimeout(() => {
      if (askFlight || !askBar) return;
      askBar.classList.remove('show-status');
      askIn.value = prompt;
      askIn.focus();
      askIn.select();
    }, reduced ? 600 : 2200);
  }

  function askUndo() {
    if (!askUndoStack.length || !editorView) return;
    const last = askUndoStack.pop();
    applyingAsk = true;
    try { editorView.dispatch({ changes: { from: 0, to: editorView.state.doc.length, insert: last.source } }); }
    finally { applyingAsk = false; }
    currentSource = last.source;
    document.body.classList.toggle('tuned', currentSource !== source);
    askSetError(null);
    reinstantiate();
    if (nameEl && ANIMS[idx]) nameEl.textContent = `— ${ANIMS[idx].name}`;
    buildControlPanel();
    if (scoped && cmRef) foldToActiveSketch();
    promptOwnsUndo = askUndoStack.length > 0;
    if (askIsOpen()) {
      askIn.value = last.prompt;
      askSetStatus('ok', 'undone in one step');
      askCollapseT = setTimeout(askCollapse, reduced ? 600 : 1800);
    }
  }

  function askChip(label, run, cls, note) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ask-chip' + (cls ? ' ' + cls : '');
    const w = document.createElement('span');
    w.className = 'ask-cw';
    w.textContent = label;
    b.appendChild(w);
    if (note) {
      const n = document.createElement('span');
      n.className = 'ask-cnote';
      n.textContent = note;
      b.appendChild(n);
    }
    b.addEventListener('click', () => { askIn.value = run; askSetTyping(false); askSend(run); });
    return b;
  }

  function buildAsk() {
    askWrap = document.createElement('div');
    askWrap.id = 'ask-wrap';
    askWrap.innerHTML =
      '<div id="ask-panel" role="group" aria-label="suggested requests">' +
        '<p id="ask-err"></p>' +
        '<p id="ask-label">try one, or ask for anything</p>' +
        '<div id="ask-chips"></div>' +
      '</div>' +
      '<div id="ask" data-state="idle">' +
        '<button id="ask-open" type="button" aria-expanded="false" aria-controls="ask-in">' +
          '<span class="ask-ast" aria-hidden="true">✳</span> Ask AI</button>' +
        '<span class="ask-live">' +
          '<label class="ask-vh" for="ask-in">Ask AI to change the animation</label>' +
          '<input id="ask-in" type="text" autocomplete="off" spellcheck="false" maxlength="140" ' +
                 'placeholder="Ask AI to change the animation…">' +
          '<span class="ask-status">' +
            '<span id="ask-glyph" aria-hidden="true"></span>' +
            '<span id="ask-word" role="status" aria-live="polite"></span>' +
          '</span>' +
          '<button id="ask-send" type="button" aria-label="send this request">↵</button>' +
        '</span>' +
      '</div>';
    root.appendChild(askWrap);
    askBar = askWrap.querySelector('#ask');
    askIn = askWrap.querySelector('#ask-in');
    askWord = askWrap.querySelector('#ask-word');
    askGlyph = askWrap.querySelector('#ask-glyph');
    askOpenBtn = askWrap.querySelector('#ask-open');
    askErrEl = askWrap.querySelector('#ask-err');
    const chips = askWrap.querySelector('#ask-chips');
    for (const label of ASK_SUGGESTIONS) chips.appendChild(askChip(label, label));

    askOpenBtn.addEventListener('click', () => askOpen(''));
    askWrap.querySelector('#ask-send').addEventListener('click', () => askSend(askIn.value));
    askIn.addEventListener('input', () => askSetTyping(askIn.value.length > 0));
    askIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); askSend(askIn.value); return; }

      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); askCollapse(); }
    });

    document.addEventListener('keydown', (e) => {
      if (!promptOwnsUndo || !document.body.classList.contains('editing')) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.stopPropagation();
        askUndo();
      }
    }, true);
  }

  if (scopable) {
    Promise.resolve()
      .then(() => ASK_TRANSPORT.health())
      .then((ok) => { if (ok) buildAsk(); })
      .catch(() => {});
  }

  function activate(i) {
    if (!sketches) return;
    const prev = idx;
    idx = cycle(i, 0, ANIMS.length);

    inst = (currentSource === source ? null : instantiateFromSource()) || ANIMS[idx].make();
    f = 0;
    size();
    countEl.textContent = `${String(idx + 1).padStart(2, '0')} / ${String(ANIMS.length).padStart(2, '0')}`;
    nameEl.textContent = `— ${ANIMS[idx].name}`;
    renderList();
    buildControlPanel();
    syncGhostScroll(ANIMS[idx].id);

    if (editorView && document.body.classList.contains('editing') && scoped) scopeIn(true);
    if (prev !== idx && ANIMS[idx] && ANIMS[idx].id) {
      trackEvent('sketch_switch', { sketch: ANIMS[idx].id });
    }
  }

  function renderList() {
    listEl.innerHTML = '';

    ANIMS.forEach((a, i) => {
      const it = document.createElement('div');
      it.className = 'pl-item' + (i === idx ? ' current' : '');
      it.setAttribute('role', 'option');
      it.textContent = a.name;
      it.addEventListener('click', (e) => { e.stopPropagation(); activate(i); listEl.classList.remove('open'); });
      listEl.appendChild(it);
    });
    syncListMinWidth();
  }

  function syncListMinWidth() {
    if (!listEl || !nameEl) return;
    const bar = nameEl.parentElement;
    if (!bar) return;
    listEl.style.minWidth = bar.offsetWidth + 'px';
  }

  if (sketches) {

    (function loop() {
      if (inst && !document.hidden) {
        try { inst.draw(ctx, w, h, f++); }
        catch (e) {
          let back = null;
          if (!inst.__recovered) { try { back = ANIMS[idx].make(); } catch (err) { back = null; } }
          if (back) back.__recovered = true;
          inst = back;
          f = 0;
        }
        if (reduced && f >= 1) inst = { draw() {} };
      }
      requestAnimationFrame(loop);
    })();
    canvas.addEventListener('mousemove', (e) => {
      if (inst && inst.onmove) inst.onmove(e.clientX, e.clientY);
    });

    canvas.addEventListener('click', (e) => {
      if (inst && inst.onclick) inst.onclick(e.clientX, e.clientY);
    });
    root.querySelector('#pl-prev').addEventListener('click', () => activate(cycle(idx, -1, ANIMS.length)));
    root.querySelector('#pl-next').addEventListener('click', () => activate(cycle(idx, +1, ANIMS.length)));
    nameEl.addEventListener('click', (e) => { e.stopPropagation(); listEl.classList.toggle('open'); });
    document.addEventListener('click', () => listEl.classList.remove('open'));
    document.addEventListener('keydown', (e) => {
      if (document.body.classList.contains('editing')) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); activate(cycle(idx, -1, ANIMS.length)); }
      if (e.key === 'ArrowRight') { e.preventDefault(); activate(cycle(idx, +1, ANIMS.length)); }
    });
    syncControlWidth();
    activate(0);
  }
}

if (typeof document !== 'undefined') boot();
