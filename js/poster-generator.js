/**
 * Poster template for monthly activities.
 *
 * ╔══════════════════════════════════════════╗
 * ║  [shape-06 rotated 90°, top-left,       ║
 * ║   only 33% visible as left border]      ║
 * ║                                         ║
 * ║  [shape-24 left side, 40% visible,      ║
 * ║   in upper 30% of poster]               ║
 * ║                                         ║
 * ║     ACTIVIDADES AFA CEIP PERÚ           ║
 * ║          MARZO 2026                     ║
 * ║                          [shape-01]     ║
 * ║                                         ║
 * ║  • events vertically centered in the    ║
 * ║    available space between title and     ║
 * ║    bottom section                       ║
 * ║                                         ║
 * ║                   [shape-22 half visible ║
 * ║                    right, below middle] ║
 * ║                                         ║
 * ║  ─── BOTTOM-ANCHORED SECTION ───        ║
 * ║                                         ║
 * ║     DURANTE TODO EL CURSO               ║
 * ║  Extraescolares | Primeros | Huerto     ║
 * ║  Familias comensales | Patio en fam.    ║
 * ║                                         ║
 * ║  ┌─ Dudas: afaceipperu@gmail.com ─┐     ║
 * ║                                         ║
 * ║  [shape-11 star]    AFA PERÚ logo       ║
 * ║  [shape-23 bottom-left, big, no rotate] ║
 * ║                          [shape-21]     ║
 * ╚══════════════════════════════════════════╝
 *
 * Edit this file to tweak layout, colors, fonts,
 * shape positions, or static content.
 */

const POSTER_W = 800;
const POSTER_H = 1000;

// Brand colors
const BRAND_TEAL = '#03B5B2';
const BRAND_DARK = '#1e293b';
const BRAND_GRAY = '#64748b';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

// ──────────────────────────────────────────
// STATIC CONTENT — edit these to update the
// "Durante todo el curso" section
// ──────────────────────────────────────────
const STATIC_ACTIVITIES = [
  { title: 'Extraescolares', detail: 'L a V' },
  { title: 'Primeros del cole de', detail: 'L a V (Educaventura)' },
  { title: 'Huerto en familia', detail: 'Jueves de 16 a 18h' },
  { title: 'Familias comensales', detail: 'Último jueves de cada mes' },
  { title: 'Patio en familia', detail: 'L a V de 16 a 18h. Hasta 29/5' },
];

const CONTACT_EMAIL = 'afaceipperu@gmail.com';

// ──────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────
const svgCache = new Map();

async function loadSvgAsImage(url) {
  if (svgCache.has(url)) return svgCache.get(url);
  const res = await fetch(url);
  const svgText = await res.text();
  const blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
  const objUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { svgCache.set(url, img); resolve(img); };
    img.onerror = reject;
    img.src = objUrl;
  });
}

function getMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-');
  return MONTH_NAMES[parseInt(month, 10) - 1] + ' ' + year;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ──────────────────────────────────────────
// EVENT GROUPING — merges same-name events
// into "2 y 16 de marzo - Club lectura"
// ──────────────────────────────────────────
function groupEventsByName(eventos) {
  const lines = [];
  const grouped = new Map();

  for (const e of eventos) {
    const name = e.nombre;
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push({ fecha: e.fecha, hora: e.hora || '' });
  }

  for (const [name, entries] of grouped) {
    const d = new Date(entries[0].fecha + 'T00:00:00');
    const monthName = d.toLocaleDateString('es-ES', { month: 'long' });

    // Collect unique non-empty times
    const times = [...new Set(entries.map(e => e.hora).filter(Boolean))];
    const timePart = times.length === 1 ? ` (${times[0].substring(0, 5)}h)` : '';

    if (entries.length === 1) {
      const day = d.getDate();
      lines.push({ bold: `${day} de ${monthName}${timePart}`, text: ` - ${name}` });
    } else {
      const days = entries.map(e => new Date(e.fecha + 'T00:00:00').getDate());
      const dayStr = days.slice(0, -1).join(', ') + ' y ' + days[days.length - 1];
      lines.push({ bold: `${dayStr} de ${monthName}${timePart}`, text: ` - ${name}` });
    }
  }
  return lines;
}

// ──────────────────────────────────────────
// WORD-WRAP HELPER
// ──────────────────────────────────────────
function wrapText(ctx, boldPart, normalPart, maxWidth) {
  ctx.font = 'bold 20px Outfit, sans-serif';
  const boldW = ctx.measureText(boldPart).width;
  ctx.font = '20px Outfit, sans-serif';
  const totalW = boldW + ctx.measureText(normalPart).width;

  if (totalW <= maxWidth) {
    return [{ bold: boldPart, text: normalPart }];
  }

  const words = normalPart.trim().split(' ');
  let firstLine = '';
  let i = 0;
  for (; i < words.length; i++) {
    const test = firstLine + (firstLine ? ' ' : ' - ') + words[i];
    ctx.font = '20px Outfit, sans-serif';
    if (boldW + ctx.measureText(test).width > maxWidth && firstLine) break;
    firstLine = test;
  }
  const secondLine = words.slice(i).join(' ');
  const result = [{ bold: boldPart, text: firstLine }];
  if (secondLine) result.push({ bold: '', text: '  ' + secondLine });
  return result;
}

// ──────────────────────────────────────────
// Measure total height of event lines
// (used to vertically center them)
// ──────────────────────────────────────────
function measureEventsHeight(ctx, eventLines, maxTextWidth) {
  const lineH = 38;
  let totalLines = 0;
  for (const line of eventLines) {
    const wrapped = wrapText(ctx, line.bold, line.text, maxTextWidth);
    totalLines += wrapped.length;
  }
  return totalLines * lineH;
}

// ──────────────────────────────────────────
// MAIN POSTER GENERATOR
// ──────────────────────────────────────────
async function generatePoster(monthKey, eventos, basePath) {
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_W;
  canvas.height = POSTER_H;
  const ctx = canvas.getContext('2d');

  await document.fonts.ready;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, POSTER_W, POSTER_H);

  // ── Load assets ──
  const shapePath = basePath + 'images/shapes/';
  const logoPath = basePath + 'images/logos/logo-light.svg';

  const [shape01, shape06, shape11, shape21, shape22, shape23, shape24, logo] = await Promise.all([
    loadSvgAsImage(shapePath + 'shape-01.svg'),
    loadSvgAsImage(shapePath + 'shape-06.svg'),
    loadSvgAsImage(shapePath + 'shape-11.svg'),
    loadSvgAsImage(shapePath + 'shape-21.svg'),
    loadSvgAsImage(shapePath + 'shape-22.svg'),
    loadSvgAsImage(shapePath + 'shape-23.svg'),
    loadSvgAsImage(shapePath + 'shape-24.svg'),
    loadSvgAsImage(logoPath),
  ]);

  // ════════════════════════════════════════
  // DECORATIVE SHAPES
  // ════════════════════════════════════════

  // ── Shape-06: rotated 90°, half native size, 33% visible, tiled across top ──
  // Native: 86×145. Half size → 43×72.5. Rotated 90° → footprint 72.5w × 43h.
  // Only 33% of the height (43h) visible → ~14px showing, rest above canvas.
  {
    const s06HalfW = 43;    // half native width
    const s06HalfH = 72.5;  // half native height
    // After 90° rotation: each tile is 72.5px wide, 43px tall
    const tileW = s06HalfH;
    const tilesNeeded = Math.ceil(POSTER_W / tileW) + 1;
    const tileCenterY = -(s06HalfW * 0.67) / 2 + 4; // nudged a few px lower
    for (let i = 0; i < tilesNeeded; i++) {
      ctx.save();
      const cx = i * tileW + tileW / 2;
      ctx.translate(cx, tileCenterY);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(shape06, -s06HalfW / 2, -s06HalfH / 2, s06HalfW, s06HalfH);
      ctx.restore();
    }
  }

  // ── Shape-24: left side, 40% visible, lowered (centered around 35% mark) ──
  // Native: 569×550. Rendered at ~280×270.
  // 40% visible → 60% overflows left.
  const s24W = 280;
  const s24H = 270;
  const s24X = -s24W * 0.6;                    // -168, so 40% shows
  const s24Y = POSTER_H * 0.35 - s24H / 2;     // centered around 35% height (lowered)
  ctx.drawImage(shape24, s24X, s24Y, s24W, s24H);

  // ── Shape-22 (flower): right side, below middle, half visible ──
  const s22W = 240;
  const s22H = 230;
  ctx.drawImage(shape22, POSTER_W - 100, POSTER_H / 2 + 40, s22W, s22H);

  // ── Shape-01 (diamond): right of month title ──
  ctx.drawImage(shape01, POSTER_W - 140, 100, 55, 55);

  // ── Shape-11 (star): left side, above bottom section ──
  ctx.drawImage(shape11, 100, POSTER_H - 240, 40, 40);

  // ── Shape-23 (wavy): bottom-left corner, large, NO rotation ──
  const s23W = 500;
  const s23H = 62;
  ctx.drawImage(shape23, -230, POSTER_H - 80, s23W, s23H);

  // ── Shape-21 (flag/banner): bottom-right corner, correct aspect ratio, rotated 90° ──
  // Native: 86×145. We render at 35×59 (half-ish) to keep proportion, then rotate 90°.
  {
    const s21W = 35;
    const s21H = 59;
    const s21X = POSTER_W - 50;
    const s21Y = POSTER_H - 50;
    ctx.save();
    ctx.translate(s21X, s21Y);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(shape21, -s21W / 2, -s21H / 2, s21W, s21H);
    ctx.restore();
  }

  // ════════════════════════════════════════
  // TITLE + MONTH
  // ════════════════════════════════════════
  ctx.fillStyle = BRAND_DARK;
  ctx.font = 'bold 40px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('ACTIVIDADES AFA CEIP PERÚ', POSTER_W / 2, 78);

  const monthLabel = getMonthLabel(monthKey).toUpperCase();
  ctx.font = 'bold 28px Outfit, sans-serif';
  ctx.fillText(monthLabel, POSTER_W / 2, 118);

  // ════════════════════════════════════════
  // BOTTOM-ANCHORED SECTION
  // (positioned from bottom upward)
  // ════════════════════════════════════════

  // Logo
  const logoW = 160;
  const logoH = 83;
  const logoY = POSTER_H - logoH - 30;
  ctx.drawImage(logo, (POSTER_W - logoW) / 2, logoY, logoW, logoH);

  // Contact bar
  const barW = 400;
  const barH = 38;
  const barY = logoY - barH - 25;
  const barX = (POSTER_W - barW) / 2;
  ctx.fillStyle = BRAND_TEAL;
  roundRect(ctx, barX, barY, barW, barH, 19);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 15px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Dudas: ' + CONTACT_EMAIL, POSTER_W / 2, barY + 24);

  // "Durante todo el curso" — 30px higher
  const LIFT = 30;

  // Row 2 (2 items)
  const row2Y = barY - 40 - LIFT;
  ctx.textAlign = 'center';
  const col2Width = (POSTER_W - 120) / 2;
  for (let i = 3; i < STATIC_ACTIVITIES.length; i++) {
    const x = 60 + col2Width * (i - 3) + col2Width / 2;
    ctx.fillStyle = BRAND_DARK;
    ctx.font = 'bold 17px Outfit, sans-serif';
    ctx.fillText(STATIC_ACTIVITIES[i].title, x, row2Y);
    ctx.fillStyle = BRAND_GRAY;
    ctx.font = '16px Outfit, sans-serif';
    ctx.fillText(STATIC_ACTIVITIES[i].detail, x, row2Y + 20);
  }

  // Row 1 (3 items)
  const row1Y = row2Y - 52;
  const colWidth = (POSTER_W - 120) / 3;
  for (let i = 0; i < 3; i++) {
    const x = 60 + colWidth * i + colWidth / 2;
    ctx.fillStyle = BRAND_DARK;
    ctx.font = 'bold 17px Outfit, sans-serif';
    ctx.fillText(STATIC_ACTIVITIES[i].title, x, row1Y);
    ctx.fillStyle = BRAND_GRAY;
    ctx.font = '16px Outfit, sans-serif';
    ctx.fillText(STATIC_ACTIVITIES[i].detail, x, row1Y + 20);
  }

  // Section title
  const sectionTitleY = row1Y - 32;
  ctx.fillStyle = BRAND_DARK;
  ctx.font = 'bold 23px Outfit, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('DURANTE TODO EL CURSO', POSTER_W / 2, sectionTitleY);

  // ════════════════════════════════════════
  // EVENTS LIST — 500px wide, horizontally
  // centered, vertically centered between
  // title and section title
  // ════════════════════════════════════════
  const EVENTS_CONTAINER_W = 500;
  const eventsLeftEdge = (POSTER_W - EVENTS_CONTAINER_W) / 2; // 150
  const leftMargin = eventsLeftEdge + 20; // 20px padding for bullet
  const maxTextWidth = EVENTS_CONTAINER_W - 30;

  const titleBottom = 135;
  const availableTop = titleBottom;
  const availableBottom = sectionTitleY - 30;
  const availableH = availableBottom - availableTop;

  const eventLines = groupEventsByName(eventos);
  const eventsH = measureEventsHeight(ctx, eventLines, maxTextWidth);

  let y = availableTop + (availableH - eventsH) / 2;
  if (y < availableTop) y = availableTop;

  ctx.textAlign = 'left';
  for (const line of eventLines) {
    const wrapped = wrapText(ctx, line.bold, line.text, maxTextWidth);
    for (let wi = 0; wi < wrapped.length; wi++) {
      const wl = wrapped[wi];
      if (wi === 0) {
        ctx.fillStyle = BRAND_DARK;
        ctx.beginPath();
        ctx.arc(leftMargin - 15, y - 4, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (wl.bold) {
        ctx.font = 'bold 20px Outfit, sans-serif';
        ctx.fillStyle = BRAND_DARK;
        const bw = ctx.measureText(wl.bold).width;
        ctx.fillText(wl.bold, leftMargin, y);
        ctx.font = '20px Outfit, sans-serif';
        ctx.fillText(wl.text, leftMargin + bw, y);
      } else {
        ctx.font = '20px Outfit, sans-serif';
        ctx.fillStyle = BRAND_DARK;
        ctx.fillText(wl.text, leftMargin + 20, y);
      }
      y += 38;
    }
  }

  return canvas;
}

export async function downloadMonthPoster(monthKey, eventos, basePath) {
  const canvas = await generatePoster(monthKey, eventos, basePath);
  const link = document.createElement('a');
  const monthLabel = getMonthLabel(monthKey).toLowerCase().replace(/\s+/g, '-');
  link.download = `actividades-afa-peru-${monthLabel}.jpg`;
  link.href = canvas.toDataURL('image/jpeg', 0.92);
  link.click();
}
