/**
 * "Guardar en calendario" support for the events list.
 *
 * Builds the start/end wall-clock times of an event from the Airtable data
 * (data/eventos.json) and turns them into:
 *   - deep links for Google Calendar, Outlook.com and Outlook/Office 365
 *   - a downloadable .ics file (Apple Calendar, Thunderbird, and anything else)
 *
 * Rules:
 *   - `hora` empty                -> all-day event (single day or fecha..fechaFin range)
 *   - `hora` set, `horaFin` empty -> DEFAULT_DURATION_HOURS (2h) duration
 *   - `horaFin` earlier than `hora` -> the event is assumed to end the next day
 *
 * Times in the source data have no timezone; they are local school times,
 * so everything is anchored to Europe/Madrid.
 */

const TIME_ZONE = 'Europe/Madrid';
const DEFAULT_DURATION_HOURS = 2;
/** Keep the deep links comfortably short; the .ics keeps the full text. */
const URL_DESCRIPTION_LIMIT = 800;
/** Used when the event has no `lugar` of its own. */
const DEFAULT_LOCATION = 'Colegio Público Perú, C/ Baleares 18, 28019 Madrid';
const CALENDAR_URL = 'https://afaperu.com/calendario/';
const PRODID = '-//AFA Colegio Público Perú//Calendario//ES';

const MS_HOUR = 3600000;
const MS_DAY = 86400000;

/* ------------------------------------------------------------------ *
 * Wall-clock helpers
 *
 * A "wall time" is a plain { y, m, d, h, min } object. All arithmetic is
 * done through Date.UTC so the visitor's own timezone never shifts a date.
 * ------------------------------------------------------------------ */

function parseDate(iso) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(iso || '').trim());
  if (!m) return null;
  return { y: +m[1], m: +m[2], d: +m[3] };
}

/** Accepts "17:00", "10.00", "9", "18h30" and similar hand-typed values. */
function parseTime(raw) {
  const m = /^(\d{1,2})\s*[:.,hH]?\s*(\d{2})?/.exec(String(raw || '').trim());
  if (!m) return null;
  const h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (h > 23 || min > 59) return null;
  return { h, min };
}

function wall(date, time) {
  return { y: date.y, m: date.m, d: date.d, h: time ? time.h : 0, min: time ? time.min : 0 };
}

function toMillis(w) {
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min);
}

function fromMillis(ms) {
  const d = new Date(ms);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    h: d.getUTCHours(),
    min: d.getUTCMinutes(),
  };
}

function addMillis(w, ms) {
  return fromMillis(toMillis(w) + ms);
}

const pad = n => String(n).padStart(2, '0');

const fmtDate = w => `${w.y}${pad(w.m)}${pad(w.d)}`;
const fmtDateTime = w => `${fmtDate(w)}T${pad(w.h)}${pad(w.min)}00`;
const fmtIsoDate = w => `${w.y}-${pad(w.m)}-${pad(w.d)}`;
const fmtIsoDateTime = w => `${fmtIsoDate(w)}T${pad(w.h)}:${pad(w.min)}:00`;

/** Offset of Europe/Madrid, in minutes, around a given wall time. */
function tzOffsetMinutes(w) {
  const guess = new Date(toMillis(w));
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  }).formatToParts(guess).reduce((acc, p) => (acc[p.type] = p.value, acc), {});

  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour % 24, +parts.minute);
  return Math.round((asUtc - guess.getTime()) / 60000);
}

/** Madrid wall time -> UTC "YYYY-MM-DDTHH:mm:00Z". */
function fmtUtcDateTime(w) {
  const utc = addMillis(w, -tzOffsetMinutes(w) * 60000);
  return `${fmtIsoDateTime(utc)}Z`;
}

/* ------------------------------------------------------------------ *
 * Schedule
 * ------------------------------------------------------------------ */

/**
 * @returns {{allDay: boolean, start: object, end: object}|null}
 * For all-day events `end` is the exclusive end date (iCalendar / Google style).
 */
export function getSchedule(evento) {
  const startDate = parseDate(evento.fecha);
  if (!startDate) return null;

  let endDate = parseDate(evento.fechaFin) || startDate;
  if (toMillis(wall(endDate)) < toMillis(wall(startDate))) endDate = startDate;

  const startTime = parseTime(evento.hora);
  const endTime = parseTime(evento.horaFin);

  if (!startTime) {
    return {
      allDay: true,
      start: wall(startDate),
      end: addMillis(wall(endDate), MS_DAY),
    };
  }

  const start = wall(startDate, startTime);
  let end;

  if (endTime) {
    end = wall(endDate, endTime);
    if (toMillis(end) <= toMillis(start)) end = addMillis(end, MS_DAY);
  } else {
    end = addMillis(wall(endDate, startTime), DEFAULT_DURATION_HOURS * MS_HOUR);
  }

  return { allDay: false, start, end };
}

function buildDescription(evento, maxLength = 0) {
  let text = String(evento.descripcion || '').trim();
  if (maxLength && text.length > maxLength) text = text.slice(0, maxLength).trimEnd() + '…';
  return (text ? text + '\n\n' : '') + `Más información: ${CALENDAR_URL}`;
}

function buildLocation(evento) {
  return String(evento.lugar || '').trim() || DEFAULT_LOCATION;
}

/** Outlook renders `body` as HTML, so newlines need <br>. */
function buildHtmlDescription(evento, maxLength) {
  return buildDescription(evento, maxLength)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

/* ------------------------------------------------------------------ *
 * Web calendar deep links
 * ------------------------------------------------------------------ */

function googleUrl(evento, s) {
  const dates = s.allDay
    ? `${fmtDate(s.start)}/${fmtDate(s.end)}`
    : `${fmtDateTime(s.start)}/${fmtDateTime(s.end)}`;

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: evento.nombre || 'Evento AFA',
    dates,
    ctz: TIME_ZONE,
    details: buildDescription(evento, URL_DESCRIPTION_LIMIT),
    location: buildLocation(evento),
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function outlookUrl(evento, s, host) {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: evento.nombre || 'Evento AFA',
    body: buildHtmlDescription(evento, URL_DESCRIPTION_LIMIT),
    location: buildLocation(evento),
  });

  if (s.allDay) {
    params.set('allday', 'true');
    params.set('startdt', fmtIsoDate(s.start));
    params.set('enddt', fmtIsoDate(s.end));
  } else {
    // Outlook reads these as UTC when they end in "Z"; a "+02:00" offset is
    // silently mishandled, so the conversion is done here.
    params.set('startdt', fmtUtcDateTime(s.start));
    params.set('enddt', fmtUtcDateTime(s.end));
  }

  return `https://${host}/calendar/0/deeplink/compose?${params}`;
}

/** @returns {{google: string, outlook: string, office365: string}|null} */
export function getCalendarLinks(evento) {
  const s = getSchedule(evento);
  if (!s) return null;
  return {
    google: googleUrl(evento, s),
    outlook: outlookUrl(evento, s, 'outlook.live.com'),
    office365: outlookUrl(evento, s, 'outlook.office.com'),
  };
}

/* ------------------------------------------------------------------ *
 * .ics file
 * ------------------------------------------------------------------ */

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  `TZID:${TIME_ZONE}`,
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function escapeIcsText(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

const encoder = new TextEncoder();

/**
 * iCalendar content lines must be folded at 75 octets, and a fold may never
 * split a multi-octet character, so this walks code points (emoji included).
 */
function foldLine(line) {
  if (encoder.encode(line).length <= 75) return line;

  const out = [];
  let current = '';
  let bytes = 0;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > 75) {
      out.push(current);
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  out.push(current);

  return out.join('\r\n');
}

function utcStamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function buildIcs(evento) {
  const s = getSchedule(evento);
  if (!s) return null;

  const start = s.allDay
    ? `DTSTART;VALUE=DATE:${fmtDate(s.start)}`
    : `DTSTART;TZID=${TIME_ZONE}:${fmtDateTime(s.start)}`;
  const end = s.allDay
    ? `DTEND;VALUE=DATE:${fmtDate(s.end)}`
    : `DTEND;TZID=${TIME_ZONE}:${fmtDateTime(s.end)}`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...VTIMEZONE,
    'BEGIN:VEVENT',
    `UID:${evento.id || 'evento-' + fmtDate(s.start)}@afaperu.com`,
    `DTSTAMP:${utcStamp()}`,
    start,
    end,
    `SUMMARY:${escapeIcsText(evento.nombre || 'Evento AFA')}`,
    `DESCRIPTION:${escapeIcsText(buildDescription(evento))}`,
    `LOCATION:${escapeIcsText(buildLocation(evento))}`,
    `URL:${CALENDAR_URL}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  return lines.map(foldLine).join('\r\n') + '\r\n';
}

function slugify(text) {
  return String(text || 'evento')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'evento';
}

export function downloadIcs(evento) {
  const ics = buildIcs(evento);
  if (!ics) return;

  const filename = `${slugify(evento.nombre)}.ics`;
  const isIos = /iP(ad|hone|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // iOS Safari ignores the download attribute on blob URLs; navigating to a
  // data URI opens the native "add event" sheet instead.
  if (isIos) {
    window.location.href = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    return;
  }

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------------------------------------------ *
 * UI
 * ------------------------------------------------------------------ */

function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="13" x2="12" y2="18"/><line x1="9.5" y1="15.5" x2="14.5" y2="15.5"/></svg>';

/**
 * HTML for the per-event "Guardar en calendario" button and its menu.
 * Returns an empty string when the event has no usable date.
 */
export function renderCalendarButton(evento) {
  const links = getCalendarLinks(evento);
  if (!links) return '';

  const label = escapeAttr(`Guardar ${evento.nombre || 'este evento'} en mi calendario`);

  return `
      <div class="evento-cal">
        <button type="button" class="btn-add-calendar" data-evento-id="${escapeAttr(evento.id || '')}"
                aria-haspopup="true" aria-expanded="false" aria-label="${label}"
                title="Guardar en mi calendario">
          ${ICON}
          <span>Guardar</span>
        </button>
        <div class="cal-menu" role="menu" hidden>
          <span class="cal-menu-title">Añadir a mi calendario</span>
          <a role="menuitem" href="${links.google}" target="_blank" rel="noopener noreferrer">Google Calendar</a>
          <a role="menuitem" href="${links.outlook}" target="_blank" rel="noopener noreferrer">Outlook.com</a>
          <a role="menuitem" href="${links.office365}" target="_blank" rel="noopener noreferrer">Outlook / Office 365</a>
          <button type="button" role="menuitem" class="cal-menu-ics">Apple Calendar u otros (.ics)</button>
        </div>
      </div>`;
}

/**
 * Wires the menus rendered by renderCalendarButton().
 * @param {HTMLElement} container element holding the event rows
 * @param {Map<string, object>} eventosById lookup used by the .ics download
 */
export function attachCalendarMenus(container, eventosById) {
  let openWrapper = null;

  function close() {
    if (!openWrapper) return;
    openWrapper.querySelector('.cal-menu').hidden = true;
    openWrapper.querySelector('.btn-add-calendar').setAttribute('aria-expanded', 'false');
    openWrapper.closest('.evento-row')?.classList.remove('cal-open');
    openWrapper = null;
  }

  function open(wrapper) {
    close();
    wrapper.querySelector('.cal-menu').hidden = false;
    wrapper.querySelector('.btn-add-calendar').setAttribute('aria-expanded', 'true');
    wrapper.closest('.evento-row')?.classList.add('cal-open');
    openWrapper = wrapper;
  }

  container.addEventListener('click', event => {
    const toggle = event.target.closest('.btn-add-calendar');
    if (toggle) {
      event.preventDefault();
      const wrapper = toggle.closest('.evento-cal');
      if (openWrapper === wrapper) close();
      else open(wrapper);
      return;
    }

    const icsBtn = event.target.closest('.cal-menu-ics');
    if (icsBtn) {
      const id = icsBtn.closest('.evento-cal')?.querySelector('.btn-add-calendar')?.dataset.eventoId;
      const evento = eventosById.get(id);
      if (evento) downloadIcs(evento);
      close();
      return;
    }

    if (event.target.closest('.cal-menu a')) close();
  });

  document.addEventListener('click', event => {
    if (openWrapper && !event.target.closest('.evento-cal')) close();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') close();
  });
}
