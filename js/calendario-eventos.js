/**
 * Renders the calendar events list from data/eventos.json,
 * grouped by month with inline layout.
 */

import { downloadMonthPoster } from './poster-generator.js';

const DATA_PATH = '../data/eventos.json';
const BASE_PATH = '../';

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

function formatDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00');
  const weekday = d.toLocaleDateString('es-ES', { weekday: 'long' });
  return weekday.charAt(0).toUpperCase() + weekday.slice(1) + ' ' + d.getDate() + ' de ' +
    d.toLocaleDateString('es-ES', { month: 'long' });
}

function formatTime(time) {
  if (!time) return '';
  return time.substring(0, 5) + 'h';
}

function isPast(isoDate) {
  if (!isoDate) return false;
  const eventDate = new Date(isoDate + 'T23:59:59');
  return eventDate < new Date();
}

function getMonthKey(isoDate) {
  if (!isoDate) return '9999-99';
  return isoDate.substring(0, 7); // "2026-04"
}

function getMonthLabel(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00');
  return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
}

function renderEvent(evento) {
  const past = isPast(evento.fecha);
  const d = evento.fecha ? new Date(evento.fecha + 'T00:00:00') : null;
  const day = d ? d.getDate() : '';
  const monthShort = d ? d.toLocaleDateString('es-ES', { month: 'short' }).toUpperCase() : '';
  const dateStr = formatDate(evento.fecha);
  const timeStr = formatTime(evento.hora);

  return `
    <div class="evento-row ${past ? 'evento-past' : ''}">
      <div class="evento-fecha-badge">
        <span class="evento-dia">${day}</span>
        <span class="evento-mes">${monthShort}</span>
      </div>
      <span class="evento-nombre">${evento.nombre}</span>
      <span class="evento-detalle">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ${dateStr}
      </span>
      ${timeStr ? `<span class="evento-detalle">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        ${timeStr}
      </span>` : ''}
    </div>`;
}

function groupByMonth(eventos) {
  const groups = new Map();
  for (const e of eventos) {
    const key = getMonthKey(e.fecha);
    if (!groups.has(key)) groups.set(key, { label: getMonthLabel(e.fecha), eventos: [] });
    groups.get(key).eventos.push(e);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

async function init() {
  const container = document.getElementById('eventos-container');
  if (!container) return;

  try {
    const res = await fetch(DATA_PATH);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { eventos } = await res.json();

    if (!eventos || eventos.length === 0) {
      container.innerHTML = '<p class="loading-msg">No hay eventos programados próximamente.</p>';
      return;
    }

    // Sort by date ascending
    eventos.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || ''));

    const months = groupByMonth(eventos);
    let html = '';
    for (const [key, group] of months) {
      html += `<div class="eventos-month-header-row">
        <h3 class="eventos-month-header">${group.label}</h3>
        <button class="btn-descargar-poster" data-month="${key}" aria-label="Descargar actividades de ${group.label}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          Descargar actividades
        </button>
      </div>`;
      html += group.eventos.map(renderEvent).join('');
    }

    container.innerHTML = html;

    // Wire up download buttons
    const monthsMap = new Map(months);
    container.querySelectorAll('.btn-descargar-poster').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.month;
        const group = monthsMap.get(key);
        if (!group) return;
        btn.disabled = true;
        btn.textContent = 'Generando...';
        try {
          await downloadMonthPoster(key, group.eventos, BASE_PATH);
        } catch (e) {
          console.error('[PosterGenerator]', e);
        }
        btn.disabled = false;
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Descargar actividades`;
      });
    });
  } catch (err) {
    console.error('[CalendarioEventos]', err);
    container.innerHTML = '<p class="loading-msg">⚠️ No se pudieron cargar los eventos.</p>';
  }
}

init();
