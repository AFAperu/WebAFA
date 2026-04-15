/**
 * Extraescolares Cards Renderer
 * Groups records by activity name, renders merged cards with filters.
 */

const DATA_PATH = '../../data/extraescolares.json';

let allGroups = [];

function mergeByName(actividades) {
  const map = new Map();

  for (const act of actividades) {
    if (!act.nombre) continue;

    if (!map.has(act.nombre)) {
      map.set(act.nombre, {
        nombre: act.nombre,
        foto: act.foto,
        fotoLocal: act.fotoLocal || null,
        enlace: act.enlace || '',
        activo: act.activo,
        dias: new Set(),
        participantes: new Set(),
        horarios: new Set(),
        empresas: new Set(),
        ubicaciones: new Set(),
        otrosDatos: new Set(),
        opciones: [],
        horariosPorParticipante: [],
      });
    }

    const group = map.get(act.nombre);
    if (act.activo) group.activo = true;
    if (!group.foto && act.foto) group.foto = act.foto;
    if (!group.fotoLocal && act.fotoLocal) group.fotoLocal = act.fotoLocal;
    if (!group.enlace && act.enlace) group.enlace = act.enlace;

    if (Array.isArray(act.dias)) act.dias.forEach(d => group.dias.add(d));
    else if (act.dias) group.dias.add(act.dias);

    if (Array.isArray(act.participantes)) act.participantes.forEach(p => group.participantes.add(p));
    else if (act.participantes) group.participantes.add(act.participantes);

    if (act.horario) group.horarios.add(act.horario);
    if (act.empresa) group.empresas.add(act.empresa);
    if (act.ubicacion) group.ubicaciones.add(act.ubicacion);
    if (act.otrosDatos) group.otrosDatos.add(act.otrosDatos);

    if (act.vecesPorSemana || act.precioSocio || act.precioNoSocio) {
      group.opciones.push({
        frecuencia: act.vecesPorSemana || '',
        horario: act.horario || '',
        precioSocio: act.precioSocio || '',
        precioNoSocio: act.precioNoSocio || '',
      });
    }

    // Store per-row participant→dias→horario for "Cuando" table
    const rowParts = Array.isArray(act.participantes) ? act.participantes : (act.participantes ? [act.participantes] : []);
    const rowDias = Array.isArray(act.dias) ? act.dias : (act.dias ? [act.dias] : []);
    const rowHorario = act.horario || '';
    if (rowParts.length) {
      group.horariosPorParticipante.push({
        participantes: rowParts,
        dias: rowDias,
        horario: rowHorario,
        precioSocio: act.precioSocio || '',
      });
    }
  }

  return [...map.values()];
}

function setToStr(s) {
  return [...s].join(', ');
}

function getPhotoUrl(foto, fotoLocal) {
  // Prefer locally downloaded image (doesn't expire)
  if (fotoLocal) return `../../${fotoLocal}`;
  if (!foto || !Array.isArray(foto) || foto.length === 0) return null;
  return foto[0].thumbnails?.large?.url || foto[0].url || null;
}

function cleanPrice(price) {
  if (!price) return '—';
  // Remove "socia/o", "NO socia/o" mentions, trim
  return price.replace(/\s*(NO\s+)?soci[ao]s?\/?(o|a)?\s*/gi, ' ').replace(/\s+/g, ' ').trim();
}

function extractNumericPrice(price) {
  if (!price) return 0;
  const match = String(price).match(/[\d]+([.,]\d+)?/);
  return match ? parseFloat(match[0].replace(',', '.')) : 0;
}

function formatFrequency(freq) {
  if (!freq) return '—';
  // Convert "1 DÍA/SEMANA" → "1 día", "DÍAS SUELTOS" stays as-is
  const match = freq.match(/^(\d+)\s+D[ÍI]A/i);
  if (match) return `${match[1]} día${match[1] !== '1' ? 's' : ''}`;
  return freq;
}

function buildScheduleMap(horariosPorParticipante) {
  const map = new Map();
  for (const { participantes, horario } of horariosPorParticipante) {
    const key = participantes.join(', ');
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(horario);
  }
  // Only return multi-entry map if there are actually different combos
  const allHorarios = new Set();
  for (const h of map.values()) h.forEach(v => allHorarios.add(v));
  if (allHorarios.size <= 1) return new Map();
  return map;
}

function renderCard(group) {
  const inactiveClass = group.activo ? '' : 'inactive';
  const inactiveBadge = group.activo ? '' : '<span class="extra-badge inactive-badge">No disponible</span>';

  const photoUrl = getPhotoUrl(group.foto, group.fotoLocal);
  const photoInner = photoUrl
    ? `<img class="extra-card-img" src="${photoUrl}" alt="${group.nombre}" loading="lazy">`
    : `<div class="extra-card-img-placeholder" aria-hidden="true"></div>`;

  // Participantes badges overlaid on image
  let badgesHtml = '';
  if (group.participantes.size) {
    badgesHtml = `<div class="extra-badges">${[...group.participantes].map(p => `<span class="extra-badge">${p}</span>`).join('')}${inactiveBadge}</div>`;
  }

  const photoHtml = `<div class="extra-card-img-wrapper">${badgesHtml}${photoInner}</div>`;

  // Empresa with SVG icon
  let empresaHtml = '';
  if (group.empresas.size) {
    empresaHtml = `<div class="extra-card-empresa"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><path d="M48 0C21.5 0 0 21.5 0 48V464c0 26.5 21.5 48 48 48h96V432c0-26.5 21.5-48 48-48s48 21.5 48 48v80h96c26.5 0 48-21.5 48-48V48c0-26.5-21.5-48-48-48H48zM64 240c0-8.8 7.2-16 16-16h32c8.8 0 16 7.2 16 16v32c0 8.8-7.2 16-16 16H80c-8.8 0-16-7.2-16-16V240zm112-16h32c8.8 0 16 7.2 16 16v32c0 8.8-7.2 16-16 16H176c-8.8 0-16-7.2-16-16V240c0-8.8 7.2-16 16-16zm80 16c0-8.8 7.2-16 16-16h32c8.8 0 16 7.2 16 16v32c0 8.8-7.2 16-16 16H272c-8.8 0-16-7.2-16-16V240zM80 96h32c8.8 0 16 7.2 16 16v32c0 8.8-7.2 16-16 16H80c-8.8 0-16-7.2-16-16V112c0-8.8 7.2-16 16-16zm80 16c0-8.8 7.2-16 16-16h32c8.8 0 16 7.2 16 16v32c0 8.8-7.2 16-16 16H176c-8.8 0-16-7.2-16-16V112zM272 96h32c8.8 0 16 7.2 16 16v32c0 8.8-7.2 16-16 16H272c-8.8 0-16-7.2-16-16V112c0-8.8 7.2-16 16-16z"/></svg><span>${setToStr(group.empresas)}</span></div>`;
  }

  // Cuándo: calendar icon + days on first line, time below — one block per unique combo
  let cuandoHtml = '';
  if (group.horariosPorParticipante.length > 0) {
    const seen = new Set();
    const uniqueRows = group.horariosPorParticipante.filter(r => {
      const key = `${r.participantes.join(',')}|${r.dias.join(',')}|${r.horario}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const calendarIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512"><path d="M152 24c0-13.3-10.7-24-24-24s-24 10.7-24 24V64H64C28.7 64 0 92.7 0 128v16 48V448c0 35.3 28.7 64 64 64H384c35.3 0 64-28.7 64-64V192 144 128c0-35.3-28.7-64-64-64H344V24c0-13.3-10.7-24-24-24s-24 10.7-24 24V64H152V24zM48 192H400V448c0 8.8-7.2 16-16 16H64c-8.8 0-16-7.2-16-16V192z"/></svg>`;

    // Sort by price descending (same order as pricing table)
    uniqueRows.sort((a, b) => extractNumericPrice(b.precioSocio) - extractNumericPrice(a.precioSocio));

    // Check if participantes differ across rows
    const uniqueParticipantes = new Set(uniqueRows.map(r => r.participantes.join(',')));
    const showParticipantes = uniqueParticipantes.size > 1;

    const rows = uniqueRows.map(r => {
      const dias = r.dias.join(', ');
      const time = r.horario || '';
      const partPrefix = showParticipantes ? `<strong>${r.participantes.join(', ')}</strong> — ` : '';
      return `<div class="extra-card-cuando-row">${calendarIcon}<div class="extra-card-cuando-text">${partPrefix}${dias}${time ? ` · <span class="cuando-time">${time}</span>` : ''}</div></div>`;
    }).join('');

    cuandoHtml = `<div class="extra-card-cuando">${rows}</div>`;
  }

  // Other details
  const details = [];
  if (group.ubicaciones.size) details.push(`<div class="extra-card-detail"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 384 512" style="fill:#94a3b8;flex-shrink:0;margin-top:2px"><path d="M215.7 499.2C267 435 384 279.4 384 192C384 86 298 0 192 0S0 86 0 192c0 87.4 117 243 168.3 307.2c12.3 15.3 35.1 15.3 47.4 0zM192 128a64 64 0 1 1 0 128 64 64 0 1 1 0-128z"/></svg><span>${setToStr(group.ubicaciones)}</span></div>`);
  if (group.otrosDatos.size) details.push(`<div class="extra-card-detail"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 512 512" style="fill:#94a3b8;flex-shrink:0;margin-top:2px"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM216 336h24V272H216c-13.3 0-24-10.7-24-24s10.7-24 24-24h48c13.3 0 24 10.7 24 24v88h8c13.3 0 24 10.7 24 24s-10.7 24-24 24H216c-13.3 0-24-10.7-24-24s10.7-24 24-24zm40-208a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"/></svg><span>${setToStr(group.otrosDatos)}</span></div>`);

  // Pricing table with background
  let optionsHtml = '';
  if (group.opciones.length > 0) {
    // Deduplicate rows with identical prices — keep one row without time
    const priceKey = opt => `${opt.precioSocio}|${opt.precioNoSocio}`;
    const priceGroups = new Map();
    for (const opt of group.opciones) {
      const key = priceKey(opt);
      if (!priceGroups.has(key)) priceGroups.set(key, []);
      priceGroups.get(key).push(opt);
    }

    const deduped = [];
    for (const [, opts] of priceGroups) {
      if (opts.length > 1) {
        // All same price — collapse to one row, use frequency only (no time)
        deduped.push({ ...opts[0], horario: '', _collapsed: true });
      } else {
        deduped.push(opts[0]);
      }
    }

    const uniqueHorarios = new Set(deduped.filter(o => !o._collapsed).map(o => o.horario).filter(Boolean));
    const showHorario = uniqueHorarios.size > 1;

    const sorted = [...deduped].sort((a, b) =>
      extractNumericPrice(b.precioSocio) - extractNumericPrice(a.precioSocio)
    );

    // Check if ALL rows have same socio/no-socio price → merge into one column
    const allSamePrice = sorted.every(opt => cleanPrice(opt.precioSocio) === cleanPrice(opt.precioNoSocio));

    let thead, rows;
    if (allSamePrice) {
      thead = `<tr><th>Días/semana</th><th>Socias y no socias</th></tr>`;
      rows = sorted.map(opt => {
        const freq = formatFrequency(opt.frecuencia);
        const label = showHorario && opt.horario ? `${freq} - ${opt.horario}` : freq;
        return `<tr><td>${label}</td><td class="price-socio">${cleanPrice(opt.precioSocio)}</td></tr>`;
      }).join('');
    } else {
      thead = `<tr><th>Días/semana</th><th>Socias</th><th>No socias</th></tr>`;
      rows = sorted.map(opt => {
        const freq = formatFrequency(opt.frecuencia);
        const label = showHorario && opt.horario ? `${freq} - ${opt.horario}` : freq;
        return `
          <tr>
            <td>${label}</td>
            <td class="price-socio">${cleanPrice(opt.precioSocio)}</td>
            <td class="price-no-socio">${cleanPrice(opt.precioNoSocio)}</td>
          </tr>`;
      }).join('');
    }

    optionsHtml = `
      <div class="extra-card-price-section">
        <div class="extra-card-section-title">Precio</div>
        <table class="price-table">
          <thead>${thead}</thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  const buttonHtml = group.enlace
    ? (group.activo
      ? `<a href="${group.enlace}" target="_blank" rel="noopener" class="lk gh dk rg tc wf xf _l gi hi extra-card-btn">Apúntate</a>`
      : `<span class="lk gh dk rg tc wf xf _l gi hi extra-card-btn extra-card-btn-disabled" aria-disabled="true">Apúntate</span>`)
    : '';

  return `
    <article class="extra-card ${inactiveClass}" aria-label="${group.nombre}">
      ${photoHtml}
      <div class="extra-card-body">
        <h3 class="extra-card-name">${group.nombre}</h3>
        ${empresaHtml}
        ${cuandoHtml}
        ${details.join('')}
        ${optionsHtml}
        ${buttonHtml}
      </div>
    </article>`;
}

/* ── Filters ── */

// Age → participant labels mapping
// Each age includes all participant categories that accept that age
const AGE_TO_PARTICIPANTS = {
  '3':  ['INFANTIL', 'INFANTIL - 2º PRIMARIA', '3 A 7 AÑOS', 'INF Y PRIM', 'FAMILIAS'],
  '4':  ['INFANTIL', 'INFANTIL - 2º PRIMARIA', '3 A 7 AÑOS', 'DESDE 4 AÑOS', 'INF Y PRIM', 'FAMILIAS'],
  '5':  ['INFANTIL', 'INFANTIL - 2º PRIMARIA', '3 A 7 AÑOS', 'DESDE 4 AÑOS', 'DESDE 5 AÑOS', 'INF Y PRIM', 'FAMILIAS'],
  '6':  ['INFANTIL - 2º PRIMARIA', '3 A 7 AÑOS', 'DESDE 4 AÑOS', 'DESDE 5 AÑOS', 'PRIMARIA', '3º - 6º PRIMARIA', 'INF Y PRIM', 'FAMILIAS'],
  '7':  ['INFANTIL - 2º PRIMARIA', '3 A 7 AÑOS', 'DESDE 4 AÑOS', 'DESDE 5 AÑOS', 'PRIMARIA', '3º - 6º PRIMARIA', 'INF Y PRIM', 'FAMILIAS'],
  '8':  ['INFANTIL - 2º PRIMARIA', 'DESDE 4 AÑOS', 'DESDE 5 AÑOS', 'PRIMARIA', '3º - 6º PRIMARIA', 'INF Y PRIM', 'FAMILIAS'],
  '9':  ['DESDE 4 AÑOS', 'DESDE 5 AÑOS', 'PRIMARIA', '3º - 6º PRIMARIA', 'INF Y PRIM', 'FAMILIAS'],
  '10': ['DESDE 4 AÑOS', 'DESDE 5 AÑOS', 'PRIMARIA', '3º - 6º PRIMARIA', 'INF Y PRIM', 'FAMILIAS'],
  '11': ['DESDE 4 AÑOS', 'DESDE 5 AÑOS', 'PRIMARIA', '3º - 6º PRIMARIA', 'INF Y PRIM', 'FAMILIAS'],
  '12': ['DESDE 4 AÑOS', 'DESDE 5 AÑOS', 'PRIMARIA', '3º - 6º PRIMARIA', 'INF Y PRIM', 'FAMILIAS'],
  'ADULTOS':  ['ADULTOS', 'FAMILIAS'],
};

function matchesAge(ageKey, participantesSet) {
  if (!ageKey) return true;
  const validLabels = AGE_TO_PARTICIPANTS[ageKey];
  if (!validLabels) return false;
  // Show EDUCACIÓN ESPECIAL for child ages, but not for ADULTOS/FAMILIAS
  if (participantesSet.has('EDUCACIÓN ESPECIAL') && ageKey !== 'ADULTOS') return true;
  return validLabels.some(label => participantesSet.has(label));
}

function collectFilterOptions(groups) {
  const dias = new Set();
  const horarios = new Set();

  for (const g of groups) {
    g.dias.forEach(d => dias.add(d));
    g.horarios.forEach(h => horarios.add(h));
  }

  return {
    edades: ['3','4','5','6','7','8','9','10','11','12','ADULTOS'],
    dias: [...dias].sort((a, b) => {
      const order = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'LUN a VIE', 'Cita previa'];
      return (order.indexOf(a) ?? 99) - (order.indexOf(b) ?? 99);
    }),
    horarios: [...horarios].sort(),
  };
}

function buildSelect(id, label, options) {
  const opts = options.map(o => `<option value="${o}">${o}</option>`).join('');
  return `
    <div class="filter-group">
      <label for="${id}">${label}</label>
      <select id="${id}">
        <option value="">Todos</option>
        ${opts}
      </select>
    </div>`;
}

function renderFilters(options) {
  const edadOpts = options.edades.map(e => {
    const label = isNaN(e) ? e : `${e} años`;
    return `<option value="${e}">${label}</option>`;
  }).join('');

  return `
    <div class="filters-bar">
      <div class="filter-group">
        <label for="filter-search">🔍 Buscar</label>
        <input type="text" id="filter-search" placeholder="Nombre de actividad...">
      </div>
      <div class="filter-group">
        <label for="filter-edad">🎂 Edad</label>
        <select id="filter-edad">
          <option value="">Todas las edades</option>
          ${edadOpts}
        </select>
      </div>
      ${buildSelect('filter-dias', '📅 Días', options.dias)}
      ${buildSelect('filter-horario', '🕐 Horario', options.horarios)}
      <button id="filter-clear" class="filter-clear-btn">Limpiar filtros</button>
    </div>`;
}

function applyFilters() {
  const search = (document.getElementById('filter-search')?.value || '').toLowerCase().trim();
  const edad = document.getElementById('filter-edad')?.value || '';
  const dia = document.getElementById('filter-dias')?.value || '';
  const horario = document.getElementById('filter-horario')?.value || '';

  const filtered = allGroups.filter(g => {
    if (search && !g.nombre.toLowerCase().includes(search)) return false;
    if (edad && !matchesAge(edad, g.participantes)) return false;
    if (dia && !g.dias.has(dia)) return false;
    if (horario && !g.horarios.has(horario)) return false;
    return true;
  });

  const container = document.getElementById('cards-container');
  if (filtered.length === 0) {
    const parts = [];
    if (search) parts.push(`"${search}"`);
    if (edad) parts.push(isNaN(edad) ? edad.toLowerCase() : `${edad} años`);
    if (dia) parts.push(dia.toLowerCase());
    if (horario) parts.push(horario);
    const filterDesc = parts.length ? ` para ${parts.join(', ')}` : '';
    container.innerHTML = `<div class="no-results-msg">No se encontraron actividades${filterDesc}.</div>`;
  } else {
    container.innerHTML = filtered.map(renderCard).join('');
  }
}

function attachFilterListeners() {
  ['filter-search', 'filter-edad', 'filter-dias', 'filter-horario'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(el.tagName === 'INPUT' ? 'input' : 'change', applyFilters);
  });

  document.getElementById('filter-clear')?.addEventListener('click', () => {
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-edad').value = '';
    document.getElementById('filter-dias').value = '';
    document.getElementById('filter-horario').value = '';
    applyFilters();
  });
}

/* ── Init ── */

async function init() {
  const container = document.getElementById('cards-container');
  const filtersContainer = document.getElementById('filters-container');
  if (!container) return;

  try {
    const res = await fetch(DATA_PATH);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { actividades } = await res.json();

    const publicadas = actividades.filter(a => a.publicado !== false);
    allGroups = mergeByName(publicadas);
    allGroups.sort((a, b) => {
      if (a.activo !== b.activo) return a.activo ? -1 : 1;
      return a.nombre.localeCompare(b.nombre, 'es');
    });

    // Render filters
    if (filtersContainer) {
      const options = collectFilterOptions(allGroups);
      filtersContainer.innerHTML = renderFilters(options);
      attachFilterListeners();
    }

    // Render cards
    container.innerHTML = allGroups.map(renderCard).join('');
  } catch (err) {
    console.error('[ExtraescolaresCards]', err);
    container.innerHTML = '<p class="loading-msg">⚠️ No se pudieron cargar las actividades.</p>';
  }
}

init();
