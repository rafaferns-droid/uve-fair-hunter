import * as db from './db.js';
import { contactFromCard } from './parse.js';
import { canDictate as canBrowserDictate, canRecord, dictate, recordAudio, initPlatformDictation, dictatePlatform } from './voice.js';
import { aiMode, contactFromVoice, contactFromPhoto, visitFromVoice } from './ai.js';
let platformDict = null;
const canDictateNow = () => !!platformDict || canBrowserDictate;
import { readCard, warmUp } from './ocr.js';
import { hubspotContactsCsv, visitsCsv, download } from './export.js';

const ICON = {
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
  people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20c-.5-2.6-1.9-4.3-3.8-5"/></svg>',
  visits: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9"/></svg>',
  fair: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  pen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>',
  nav: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 18-8-8 18-2-8z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>'
};
const LANGS = [['es-ES', 'ES'], ['en-US', 'EN'], ['de-DE', 'DE']];
const RESULTS = ['Reunión', 'Tarjeta', 'Volver', 'No target'];
const INTEREST = ['Alto', 'Medio', 'Bajo'];

const S = { fair: null, fairs: [], tab: 'route', day: 0, contacts: [], visits: [], lang: 'es-ES', manualVisited: new Set() };
const $ = s => document.querySelector(s);
const view = $('#view');
const h = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const pColor = p => p === 'A' ? css('--hot') : p === 'B' ? css('--warm') : css('--cold');
const initials = n => n.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const now = () => new Date().toISOString();

function toast(msg) { const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg; $('#app').appendChild(t); setTimeout(() => t.remove(), 2600); }

/* ---------------- data ---------------- */
async function loadBundledFairs() {
  try {
    const idx = await (await fetch('data/fairs/index.json')).json();
    for (const f of idx) {
      const cur = await db.get('fairs', f.id);
      if (cur && (cur.version || 1) >= (f.version || 1)) continue;
      const fair = await (await fetch('data/fairs/' + f.file)).json();
      await db.put('fairs', fair);
    }
  } catch (e) { console.warn('bundled fairs', e); }
}
async function loadFair(id) {
  S.fair = await db.get('fairs', id);
  S.contacts = await db.byFair('contacts', id);
  S.visits = await db.byFair('visits', id);
  S.manualVisited = new Set(await db.getMeta('visited:' + id, []));
  await db.setMeta('activeFair', id);
}
const companies = () => (S.fair ? S.fair.companies : []);
const company = id => companies().find(c => c.id === id);
const visitsOf = cid => S.visits.filter(v => v.companyId === cid);
const isVisited = cid => S.manualVisited.has(cid) || visitsOf(cid).length > 0;

/* ---------------- shell ---------------- */
const TABS = [['route', 'Ruta', 'map'], ['contacts', 'Contactos', 'people'], ['visits', 'Visitas', 'visits'], ['fair', 'Feria', 'fair']];
function shell() {
  $('#fairSel').innerHTML = S.fairs.map(f => `<option value="${h(f.id)}" ${S.fair && f.id === S.fair.id ? 'selected' : ''}>${h(f.name)}</option>`).join('');
  $('#tabs').innerHTML = TABS.map(([k, l, i]) => `<button role="tab" type="button" aria-selected="${S.tab === k}" data-tab="${k}">${ICON[i]}${l}</button>`).join('');
  const fab = $('#fab');
  fab.hidden = !S.fair || S.tab === 'fair';
  fab.innerHTML = `${ICON.plus}Nuevo contacto`;
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.tab = b.dataset.tab; render(); });
$('#fairSel').addEventListener('change', async e => { await loadFair(e.target.value); S.day = 0; render(); });
$('#fab').addEventListener('click', () => openContactSheet({}));
function setNet() { $('#net').classList.toggle('off', !navigator.onLine); $('#net').title = navigator.onLine ? 'Con conexión' : 'Sin conexión: todo se guarda en el móvil'; }
addEventListener('online', setNet); addEventListener('offline', setNet);

function render() {
  shell();
  if (!S.fair) { view.innerHTML = `<div class="empty">No hay ninguna feria cargada. Ve a <b>Feria</b> e importa el fichero de la feria.</div>`; if (S.tab === 'fair') vFair(); return; }
  ({ route: vRoute, contacts: vContacts, visits: vVisits, fair: vFair })[S.tab]();
}

/* ---------------- route ---------------- */
const boothNum = c => { const m = String(c.booth || '').match(/(\d+)(?!.*\d)/); return m ? +m[1] : null; };
const aisleOf = c => { const n = boothNum(c); return n == null ? '' : `${c.hall} · ${Math.floor(n / 100) * 100}-${Math.floor(n / 100) * 100 + 99}`; };
function dayStops() {
  let list = companies().filter(c => c.day === S.day);
  if (S.onlyA) list = list.filter(c => c.priority === 'A');
  if (list.length < 3) return list;
  if (list.every(c => boothNum(c) != null)) {
    // stand numbers follow the aisles: walk hall by hall, aisle by aisle, alternating direction
    const halls = [...new Set(list.map(c => c.hall))];
    return [...list].sort((a, b) => {
      if (a.hall !== b.hall) return halls.indexOf(a.hall) - halls.indexOf(b.hall);
      const ra = Math.floor(boothNum(a) / 100), rb = Math.floor(boothNum(b) / 100);
      if (ra !== rb) return ra - rb;
      return ra % 2 ? boothNum(b) - boothNum(a) : boothNum(a) - boothNum(b);
    });
  }
  // nearest neighbour from the entrance closest to the first stop
  const ents = (S.fair.map && S.fair.map.entrances) || [];
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let cur = ents.length ? ents.reduce((m, e) => (d(e, list[0]) < d(m, list[0]) ? e : m), ents[0]) : list[0];
  const left = [...list], out = [];
  while (left.length) { left.sort((a, b) => d(cur, a) - d(cur, b)); cur = left.shift(); out.push(cur); }
  return out;
}
function vRoute() {
  const f = S.fair, unpl = S.day === f.unplannedDay;
  const st = unpl ? companies().filter(c => c.day === S.day).sort((a, b) => a.booth.localeCompare(b.booth, 'es', { numeric: true })) : dayStops();
  const next = unpl ? null : st.find(c => !isVisited(c.id));
  const legend = (f.map && f.map.legend) || {};
  view.innerHTML = `<div class="stack">
  <div class="days" role="group" aria-label="Día de feria">${f.days.map((d, i) => { const [a, b] = d.split(' · '); return `<button type="button" aria-pressed="${i === S.day}" data-d="${i}"><b>${i === f.unplannedDay ? 'Resto' : 'Día ' + (i + 1)}</b>${h(a)}${b ? `<br><span class="muted" style="font-size:11px">${h(b)}</span>` : ''}</button>`; }).join('')}</div>
  ${next ? `<div class="next">${ICON.nav}<div style="min-width:0"><div style="font-size:12px;opacity:.8">Siguiente visita</div><b>${h(next.name)}</b> · ${h(next.booth)}</div><button class="go" type="button" data-open="${next.id}">Ficha</button></div>`
    : unpl ? '' : `<div class="next"><b>${st.length ? 'Día completado' : 'Sin visitas planificadas este día'}</b></div>`}
  ${unpl ? `<p class="muted" style="margin:0;font-size:13px">Expositores con prioridad C (start-ups, distribuidores, equipamiento, vino). Visítalos solo si te queda tiempo o te cruzas con ellos.</p>` : ''}
  ${f.map && !unpl ? `<div class="mapwrap">${mapSvg(st)}<button type="button" class="mapbig" id="mapBig" aria-label="Ver el plano en grande">⤢ Ampliar</button></div><div class="legend">${Object.entries(legend).map(([k, c]) => `<span><i style="background:${h(c)}"></i>${h(k === 'F&B' ? 'Food & Beverage' : k)}</span>`).join('')}</div>` : ''}
  <div class="row" style="justify-content:space-between"><h2>${st.length} ${unpl ? 'expositores' : 'visitas'} · ${st.filter(c => isVisited(c.id)).length} hechas</h2>${!unpl ? `<button type="button" class="chip dot A" id="onlyA" aria-pressed="${!!S.onlyA}" style="${S.onlyA ? 'background:var(--hot);color:#fff;border-color:transparent' : ''}">${S.onlyA ? 'Solo A ✓' : 'Ver solo A'}</button>` : ''}</div>
  <div class="stack" style="gap:8px">${st.map((c, i) => { const a = aisleOf(c), prev = i ? aisleOf(st[i - 1]) : null; return (a && a !== prev ? `<p class="aisle">Pabellón ${h(a.replace(' · ', ' · pasillo '))}</p>` : '') + stopRow(c, i + 1); }).join('') || '<div class="empty">Nada para este día.</div>'}</div>
  ${f.demo ? `<p class="demo">${h(f.note || 'Datos de demostración.')}</p>` : ''}</div>`;
  view.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.day = +b.dataset.d; vRoute(); });
  const oa = view.querySelector('#onlyA'); if (oa) oa.onclick = () => { S.onlyA = !S.onlyA; vRoute(); };
  const mb = view.querySelector('#mapBig'); if (mb) mb.onclick = () => openBigMap(st);
  bindOpen();
}
function openBigMap(st) {
  const o = document.createElement('div'); o.className = 'bigmap'; o.id = 'bigmap'; o.setAttribute('role', 'dialog');
  o.innerHTML = `<div class="bigmap-top"><b>${h(S.fair.days[S.day] || '')}</b><button type="button" class="btn ghost" id="bmClose" aria-label="Cerrar">✕</button></div><div class="bigmap-body">${mapSvg(st, true)}</div><p class="muted bigmap-hint">Toca un número para abrir la ficha. Pellizca para hacer zoom.</p>`;
  $('#app').appendChild(o);
  o.querySelector('#bmClose').onclick = () => o.remove();
  o.querySelectorAll('.pin').forEach(pn => pn.onclick = () => { o.remove(); openCompany(pn.dataset.id); });
}
function stopRow(c, n) {
  const v = isVisited(c.id);
  return `<button type="button" class="stop ${v ? 'visited' : ''}" data-open="${c.id}"><span class="k" style="background:${v ? css('--cold') : pColor(c.priority)}">${n}</span><span class="t"><b>${h(c.name)}</b><small>${c.priority ? `<span style="color:${pColor(c.priority)};font-weight:700">${h(c.priority)}</span> · ` : ''}${h(c.sector)}${visitsOf(c.id)[0] ? ' · ' + h(visitsOf(c.id)[0].result || 'visitada') : ''}</small></span><span class="booth">${h(c.booth)}</span></button>`;
}
function bindOpen() {
  view.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openCompany(b.dataset.open));
  view.querySelectorAll('.pin').forEach(p => { p.onclick = () => openCompany(p.dataset.id); p.onkeydown = e => { if (e.key === 'Enter') openCompany(p.dataset.id); }; });
}
const w0 = vb => +vb.split(' ')[2];
function mapSvg(st, big = false) {
  const m = S.fair.map;
  const ent = (m.entrances || []).map(e => `<circle cx="${e.x}" cy="${e.y}" r="9" fill="var(--hot)"/><text x="${e.x}" y="${e.y + 3}" text-anchor="middle" style="font:700 7px sans-serif;fill:#fff">${h(e.label[0])}</text>`).join('');
  const route = st.map(c => `${c.x},${c.y}`).join(' ');
  // zoom to the day's stops so pins in one hall stay readable
  const [, , VW, VH] = m.viewBox.split(' ').map(Number);
  let vb = m.viewBox, k = 1;
  if (st.length) {
    let x0 = Math.min(...st.map(c => c.x)), x1 = Math.max(...st.map(c => c.x)), y0 = Math.min(...st.map(c => c.y)), y1 = Math.max(...st.map(c => c.y));
    const pad = big ? 14 : 40, AR = big ? 0.72 : VW / VH;
    let w = Math.max(x1 - x0 + pad, big ? 50 : 110), hh = Math.max(y1 - y0 + pad, big ? 60 : 90);
    if (w / hh > AR) hh = w / AR; else w = hh * AR;
    w = Math.min(w, VW); hh = Math.min(hh, VH);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const vx = Math.max(0, Math.min(VW - w, cx - w / 2)), vy = Math.max(0, Math.min(VH - hh, cy - hh / 2));
    vb = `${vx.toFixed(1)} ${vy.toFixed(1)} ${w.toFixed(1)} ${hh.toFixed(1)}`; k = w / VW;
  }
  const r = big ? Math.max(Math.min(w0(vb) / 22, 9), 1.6) : Math.max(9 * k * 1.3, 4.2), fs = r * 1.05;
  const HALLFS = Math.max(11 * k * 1.2, 5).toFixed(1);
  const halls = m.halls.map(hl => {
    const p = hl.points.split(' ').map(q => q.split(',').map(Number));
    const cx = p.reduce((a, q) => a + q[0], 0) / p.length, cy = p.reduce((a, q) => a + q[1], 0) / p.length;
    const active = st.some(c => c.hall === hl.id);
    return `<polygon points="${h(hl.points)}" fill="${h(m.legend[hl.cat] || '#ccc')}" opacity="${active ? 1 : .45}" stroke="var(--surface)" stroke-width="2"/><text class="hall-label" x="${cx}" y="${cy + 3}" text-anchor="middle" style="font-size:${HALLFS}px">${h(hl.id.replace(' FF', ''))}</text>`;
  }).join('');
  const pins = st.map((c, i) => `<g class="pin ${isVisited(c.id) ? 'visited' : ''}" data-id="${c.id}" role="button" tabindex="0" aria-label="${h(c.name)}, stand ${h(c.booth)}"><circle cx="${c.x}" cy="${c.y}" r="${r.toFixed(2)}" fill="${pColor(c.priority)}" style="stroke-width:${(r / 4.5).toFixed(2)}"/><text x="${c.x}" y="${(c.y + fs * 0.36).toFixed(2)}" text-anchor="middle" style="font-size:${fs.toFixed(2)}px">${i + 1}</text>${big ? `<text class="pin-booth" x="${c.x}" y="${(c.y + r + fs * 0.75).toFixed(2)}" text-anchor="middle" style="font-size:${(fs * 0.6).toFixed(2)}px">${h(String(c.booth).split('.').pop())}</text>` : ''}</g>`).join('');
  return `<svg id="map" viewBox="${vb}" role="img" aria-label="Plano de pabellones con la ruta del día">${halls}${ent}<polyline points="${route}" fill="none" stroke="var(--fg)" stroke-width="${(2 * Math.max(k, .35)).toFixed(2)}" stroke-dasharray="${(5 * Math.max(k, .35)).toFixed(1)} ${(4 * Math.max(k, .35)).toFixed(1)}" stroke-linecap="round" opacity=".7"/>${pins}</svg>`;
}

/* ---------------- sheets ---------------- */
let sheetCleanup = null;
function sheet(html, onClose) {
  closeSheet();
  const s = document.createElement('div'); s.className = 'scrim'; s.id = 'scrim'; s.onclick = closeSheet;
  const p = document.createElement('div'); p.className = 'sheet'; p.id = 'sheet'; p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true');
  p.innerHTML = `<div class="grab"></div><button type="button" class="btn ghost" style="position:absolute;right:12px;top:10px;padding:6px 10px" aria-label="Cerrar" data-close>✕</button>` + html;
  p.querySelector('[data-close]').onclick = closeSheet;
  $('#app').append(s, p);
  sheetCleanup = onClose || null;
  return p;
}
function closeSheet() { if (sheetCleanup) { try { sheetCleanup(); } catch (e) {} sheetCleanup = null; } $('#scrim')?.remove(); $('#sheet')?.remove(); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

/* ---------------- company ---------------- */
function openCompany(id) {
  const c = company(id); if (!c) return;
  const vs = visitsOf(id), cs = S.contacts.filter(x => x.companyId === id);
  const p = sheet(`<div class="stack">
  <div><div class="row" style="justify-content:space-between;padding-right:44px"><p class="eyebrow">Stand ${h(c.booth)} · ${h(c.hall)}</p><span class="chip dot ${h(c.priority)}">Prioridad ${h(c.priority)}</span></div><h1>${h(c.name)}</h1>
  <div class="row" style="margin-top:6px"><span class="chip ${/^Cliente/.test(c.crm) ? 'crm' : c.crm === 'Nuevo' ? 'new' : ''}">${h(c.crm === 'Nuevo' ? 'Nuevo en HubSpot' : c.crm)}</span><span class="chip">${h(c.sector)}</span>${c.kind ? `<span class="chip">${h(c.kind)}</span>` : ''}</div>${c.country ? `<p class="muted" style="margin:6px 0 0;font-size:13px">${h([c.city, c.country].filter(Boolean).join(', '))}</p>` : ''}</div>
  ${c.hook ? `<div class="hook"><b>Gancho:</b> ${h(c.hook)}</div>` : ''}
  <dl class="kv">${c.distribution ? `<dt>Distribución</dt><dd>${h(c.distribution)}</dd>` : ''}${c.case ? `<dt>Caso a contar</dt><dd>${h(c.case)}</dd>` : ''}${c.keyQuestion ? `<dt>Pregunta clave</dt><dd>${h(c.keyQuestion)}</dd>` : ''}</dl>
  ${c.targetRoles ? `<dl class="kv"><dt>Cargos a buscar</dt><dd>${h(c.targetRoles)}</dd></dl>` : ''}
  ${(c.people || []).length ? `<div><h2 style="margin-bottom:4px">A quién buscar</h2>${c.people.map(pp => `<div class="person"><span class="av">${h(initials(pp.name))}</span><div style="min-width:0"><b>${h(pp.name)}</b><div class="muted" style="font-size:12.5px">${h(pp.role)}</div></div><button type="button" class="chip" data-adopt="${h(pp.name)}|${h(pp.role)}">Añadir</button></div>`).join('')}</div>` : ''}
  ${cs.length ? `<div><h2 style="margin-bottom:4px">Contactos capturados</h2>${cs.map(x => `<button type="button" class="person" style="width:100%;background:none;border:0;border-bottom:1px solid var(--line);text-align:left" data-contact="${x.id}"><span class="av">${h(initials(`${x.firstName} ${x.lastName}`))}</span><div style="min-width:0"><b>${h(x.firstName)} ${h(x.lastName)}</b><div class="muted" style="font-size:12.5px">${h(x.role || x.email)}</div></div><span class="src">${h(srcLabel(x.source))}</span></button>`).join('')}</div>` : ''}
  ${vs.length ? `<div><h2 style="margin-bottom:4px">Visitas</h2>${vs.map(visitCard).join('')}</div>` : ''}
  <div class="grid2"><button class="btn primary" type="button" id="bVisit">${ICON.mic} Resumen de visita</button><button class="btn ghost" type="button" id="bNew">${ICON.plus} Nuevo contacto</button></div>
  ${c.source ? `<p class="muted" style="margin:0;font-size:12px">Fuente: ${h(c.source)}. Stand y contactos pueden cambiar en 2027.</p>` : ''}
  <button class="btn ghost block" type="button" id="bVis">${isVisited(id) ? 'Marcar como pendiente' : 'Marcar como visitada'}</button></div>`);
  p.querySelector('#bVisit').onclick = () => openVisitSheet(c);
  p.querySelector('#bNew').onclick = () => openContactSheet({ companyId: c.id, companyName: c.name });
  p.querySelectorAll('[data-adopt]').forEach(b => b.onclick = () => { const [n, r] = b.dataset.adopt.split('|'); const [fn, ...ln] = n.split(' '); openContactSheet({ companyId: c.id, companyName: c.name, firstName: fn, lastName: ln.join(' '), role: r, source: 'manual' }); });
  p.querySelectorAll('[data-contact]').forEach(b => b.onclick = () => openContactSheet(S.contacts.find(x => x.id === b.dataset.contact)));
  p.querySelector('#bVis').onclick = async () => { if (S.manualVisited.has(id)) S.manualVisited.delete(id); else S.manualVisited.add(id); await db.setMeta('visited:' + S.fair.id, [...S.manualVisited]); closeSheet(); render(); };
  bindAudio(p);
}
const srcLabel = s => ({ card: 'Tarjeta', voice: 'Voz', manual: 'Manual' }[s] || '');
function visitCard(v) {
  return `<div class="card stack" style="gap:6px;margin-bottom:8px"><div class="row" style="justify-content:space-between"><span class="eyebrow">${h(new Date(v.createdAt).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}</span><span class="row" style="gap:6px">${v.result ? `<span class="chip crm">${h(v.result)}</span>` : ''}${v.interest ? `<span class="chip">Interés ${h(v.interest.toLowerCase())}</span>` : ''}</span></div>
  ${v.summary ? `<p style="margin:0">${h(v.summary)}</p>` : ''}${v.nextStep ? `<p style="margin:0"><b>Siguiente paso:</b> ${h(v.nextStep)}</p>` : ''}${v.audioId ? `<audio controls preload="none" data-audio="${v.audioId}"></audio>` : ''}</div>`;
}
function bindAudio(root) {
  root.querySelectorAll('audio[data-audio]').forEach(async a => { const b = await db.getBlob(a.dataset.audio); if (b) a.src = URL.createObjectURL(b); });
}

/* ---------------- voice widget ---------------- */
// Renders a dictation box: live speech recognition when the browser has it, otherwise the keyboard mic.
function voiceBox(root, { placeholder, onDone, parseLabel = 'Rellenar con lo dictado' }) {
  const box = root.querySelector('.voicebox');
  const canD = canDictateNow();
  box.innerHTML = `<div class="row" style="justify-content:space-between"><div class="langs" role="group" aria-label="Idioma del dictado">${LANGS.map(([k, l]) => `<button type="button" aria-pressed="${S.lang === k}" data-lang="${k}">${l}</button>`).join('')}</div><span class="muted" style="font-size:12px" id="vState">${canD ? 'Pulsa y habla' : 'Usa el micrófono del teclado'}</span></div>
  ${canD ? `<button type="button" class="mic" id="vMic" aria-label="Empezar a dictar">${ICON.mic}</button>` : ''}
  <div class="field"><label for="vText">${canD ? 'Lo que has dicho (puedes corregirlo)' : 'Dicta aquí con el micrófono del teclado'}</label><textarea id="vText" class="transcript" rows="4" placeholder="${h(placeholder)}"></textarea></div>
  <button type="button" class="btn ghost block" id="vParse">${h(parseLabel)}</button>
  <div class="progress" id="vBusy" hidden><span class="spin"></span><span id="vBusyT">Ordenando los datos…</span></div>
  <p class="muted" id="vEngine" style="margin:0;font-size:12px"></p>`;
  aiMode().then(m => { const e = box.querySelector('#vEngine'); if (e) e.textContent = m === 'claude' ? 'Claude ordena lo que dictas. Revisa antes de guardar.' : 'Sin conexión con Claude: se ordena con reglas en el móvil. Revisa antes de guardar.'; });
  let session = null, busy = false;
  box.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { S.lang = b.dataset.lang; box.querySelectorAll('[data-lang]').forEach(x => x.setAttribute('aria-pressed', x === b)); db.setMeta('lang', S.lang); });
  const mic = box.querySelector('#vMic'), ta = box.querySelector('#vText'), st = box.querySelector('#vState');
  const setIdle = msg => { session = null; if (mic) { mic.classList.remove('on'); mic.innerHTML = ICON.mic; } if (msg) st.textContent = msg; };
  const stop = () => { if (session) session.stop(); setIdle('Listo'); };
  const run = async () => {
    if (busy || !ta.value.trim()) return;
    busy = true; box.querySelector('#vBusy').hidden = false; box.querySelector('#vParse').disabled = true;
    try { await onDone(ta.value); } catch (e) { console.warn(e); toast('No se ha podido ordenar. Revisa a mano.'); }
    busy = false; const b = box.querySelector('#vBusy'); if (b) b.hidden = true; const p = box.querySelector('#vParse'); if (p) p.disabled = false;
  };
  const errMsg = err => ({ 'not-allowed': 'Sin permiso de micrófono', not_granted: 'Sin permiso de micrófono', network: 'Sin conexión: usa el micrófono del teclado', unavailable: 'Dictado no disponible aquí: usa el teclado' }[err] || 'No se ha podido dictar: usa el teclado');
  if (mic) mic.onclick = () => {
    if (session) { stop(); setTimeout(run, platformDict ? 600 : 0); return; }
    const before = ta.value ? ta.value.trim() + ' ' : '';
    const opts = { lang: S.lang, onText: t => { ta.value = before + t; }, onEnd: () => { if (session) setIdle('Listo'); }, onError: err => { setIdle(errMsg(err)); } };
    try {
      session = platformDict ? dictatePlatform(opts) : dictate(opts);
      mic.classList.add('on'); mic.innerHTML = ICON.stop; st.textContent = 'Escuchando… pulsa para terminar';
    } catch (e) { setIdle('Dictado no disponible: usa el micrófono del teclado'); ta.focus(); }
  };
  box.querySelector('#vParse').onclick = () => { if (session) stop(); run(); };
  return stop;
}

/* ---------------- contact sheet ---------------- */
function openContactSheet(c) {
  const isNew = !c.id;
  const x = Object.assign({ firstName: '', lastName: '', role: '', companyName: '', companyId: '', email: '', phone: '', website: '', notes: '', source: 'manual' }, c);
  const mode = isNew && !c.source ? 'card' : 'form';
  const p = sheet(`<div class="stack">
  <div><p class="eyebrow">${h(x.companyName || S.fair.name)}</p><h1>${isNew ? 'Nuevo contacto' : 'Editar contacto'}</h1></div>
  ${isNew ? `<div class="tabs-src" role="group" aria-label="Cómo crear el contacto">
    <button type="button" data-mode="card" aria-pressed="${mode === 'card'}">${ICON.cam}Foto tarjeta</button>
    <button type="button" data-mode="voice" aria-pressed="false">${ICON.mic}Por voz</button>
    <button type="button" data-mode="form" aria-pressed="${mode === 'form'}">${ICON.pen}Escribir</button></div>` : ''}
  <div id="mCard" hidden class="stack" style="gap:10px">
    <label class="cap" for="cardImg">${ICON.cam}Hacer foto de la tarjeta<input id="cardImg" type="file" accept="image/*" capture="environment"></label>
    <img id="thumb" class="thumb" alt="Tarjeta" hidden><div class="progress" id="ocrP" hidden><span class="spin"></span><span id="ocrT">Preparando lector…</span></div></div>
  <div id="mVoice" hidden class="stack voicebox" style="gap:10px"></div>
  <form id="cform" class="stack" style="gap:10px">
    <div class="grid2">${fld('firstName', 'Nombre', x.firstName)}${fld('lastName', 'Apellidos', x.lastName)}</div>
    ${fld('role', 'Cargo', x.role)}
    <div class="field"><label for="f_companyId">Empresa</label><select id="f_companyId"><option value="">Otra empresa (no está en la feria)</option>${companies().map(co => `<option value="${co.id}" ${co.id === x.companyId ? 'selected' : ''}>${h(co.name)} · ${h(co.booth)}</option>`).join('')}</select></div>
    ${fld('companyName', 'Nombre de la empresa', x.companyName)}
    ${fld('email', 'Email', x.email, 'email')}${fld('phone', 'Teléfono', x.phone, 'tel')}${fld('website', 'Web', x.website)}
    <div class="field"><label for="f_notes">Nota</label><textarea id="f_notes" rows="2" placeholder="Qué te ha dicho, siguiente paso">${h(x.notes)}</textarea></div>
    <button class="btn primary block" type="submit">Guardar contacto</button>
    ${!isNew ? '<button class="btn ghost block danger" type="button" id="cDel">Eliminar contacto</button>' : ''}
  </form></div>`);
  const fillForm = (d, src) => {
    for (const k of ['firstName', 'lastName', 'role', 'companyName', 'email', 'phone', 'website']) {
      if (d[k]) { const i = p.querySelector('#f_' + k); i.value = d[k]; i.classList.add('filled'); }
    }
    if (d.companyId) p.querySelector('#f_companyId').value = d.companyId;
    x.source = src;
  };
  const show = m => { p.querySelector('#mCard').hidden = m !== 'card'; p.querySelector('#mVoice').hidden = m !== 'voice'; p.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m)); if (m === 'card') warmUp().catch(() => {}); };
  p.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => show(b.dataset.mode));
  if (isNew) show(mode);
  let stopVoice = null;
  if (isNew) stopVoice = voiceBox(p, {
    placeholder: 'Ej.: Markus Stein, Leiter Key Account de Hanse Feinkost, correo markus punto stein arroba hanse-feinkost punto de, teléfono más 49 40 5550 1234',
    onDone: async text => { const d = await contactFromVoice(text, companies()); fillForm(d, 'voice'); if (d.notes && !p.querySelector('#f_notes').value) p.querySelector('#f_notes').value = d.notes; toast(d.engine === 'claude' ? 'Ficha rellenada por Claude. Revisa y guarda.' : 'Ficha rellenada. Revisa y guarda.'); p.querySelector('#cform').scrollIntoView({ behavior: 'smooth' }); }
  });
  sheetCleanup = () => stopVoice && stopVoice();
  p.querySelector('#f_companyId').onchange = e => { const co = company(e.target.value); if (co) p.querySelector('#f_companyName').value = co.name; };
  let cardBlob = null;
  p.querySelector('#cardImg').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    cardBlob = f;
    const t = p.querySelector('#thumb'); t.src = URL.createObjectURL(f); t.hidden = false;
    const pr = p.querySelector('#ocrP'); pr.hidden = false;
    let ocr = null;
    try { ocr = await readCard(f, m => { p.querySelector('#ocrT').textContent = m; }); } catch (err) { console.warn('ocr', err); }
    try {
      if (ocr) fillForm(contactFromCard(ocr.lines, companies()), 'card');
      if ((await aiMode()) === 'claude') {
        p.querySelector('#ocrT').textContent = 'Claude está leyendo la tarjeta…';
        const d = await contactFromPhoto(f, ocr, companies());
        fillForm(d, 'card'); if (d.notes && !p.querySelector('#f_notes').value) p.querySelector('#f_notes').value = d.notes;
        p.querySelector('#ocrT').textContent = d.engine.startsWith('claude') ? 'Tarjeta leída por Claude. Revisa y guarda.' : 'Tarjeta leída. Revisa los datos y guarda.';
      } else {
        p.querySelector('#ocrT').textContent = ocr ? 'Tarjeta leída en el móvil. Revisa los datos y guarda.' : 'No he podido leer la tarjeta. La foto queda guardada: rellena los datos a mano.';
      }
    } catch (err) { console.error(err); p.querySelector('#ocrT').textContent = 'Revisa los datos: la lectura no ha sido completa.'; }
    pr.querySelector('.spin').hidden = true; x.source = 'card';
  };
  p.querySelector('#cform').onsubmit = async e => {
    e.preventDefault();
    const v = k => p.querySelector('#f_' + k).value.trim();
    const rec = Object.assign({}, x, { firstName: v('firstName'), lastName: v('lastName'), role: v('role'), companyId: v('companyId'), companyName: v('companyName') || (company(v('companyId')) || {}).name || '', email: v('email'), phone: v('phone'), website: v('website'), notes: v('notes') });
    if (!rec.firstName && !rec.lastName && !rec.email) { toast('Pon al menos un nombre o un email'); return; }
    if (isNew) { rec.id = db.uid('ct'); rec.fairId = S.fair.id; rec.createdAt = now(); }
    rec.updatedAt = now();
    if (cardBlob) rec.cardImageId = await db.putBlob(cardBlob);
    await db.put('contacts', rec);
    S.contacts = await db.byFair('contacts', S.fair.id);
    closeSheet(); render(); toast(isNew ? 'Contacto guardado en el móvil' : 'Contacto actualizado');
  };
  const del = p.querySelector('#cDel');
  if (del) {
    let armed = false;
    del.onclick = async () => {
      if (!armed) { armed = true; del.textContent = 'Pulsa otra vez para eliminar'; return; }
      await db.del('contacts', x.id); S.contacts = await db.byFair('contacts', S.fair.id); closeSheet(); render(); toast('Contacto eliminado');
    };
  }
  if (!isNew && x.cardImageId) db.getBlob(x.cardImageId).then(b => { if (b) { const t = p.querySelector('#thumb'); t.src = URL.createObjectURL(b); t.hidden = false; p.querySelector('#mCard').hidden = false; p.querySelector('.cap').hidden = true; } });
}
const fld = (k, l, v = '', type = 'text') => `<div class="field"><label for="f_${k}">${l}</label><input id="f_${k}" type="${type}" value="${h(v)}" autocomplete="off"></div>`;

/* ---------------- visit sheet ---------------- */
function openVisitSheet(c) {
  const st = { result: '', interest: '', audio: null, people: [], painPoints: [], followUpDate: '', engine: '' };
  const p = sheet(`<div class="stack">
  <div><p class="eyebrow">${h(c.name)} · ${h(c.booth)}</p><h1>Resumen de la visita</h1></div>
  <p class="muted" style="margin:0;font-size:13px">Al salir del stand, dícta con tus palabras: con quién has hablado (nombre, cargo, email si lo tienes), qué te han contado, interés y siguiente paso. La app hace el resumen y crea los contactos.</p>
  ${(c.people || []).length || c.targetRoles ? `<div class="card stack" style="gap:6px"><p class="eyebrow">Preparado antes de la feria</p>${c.targetRoles ? `<p style="margin:0;font-size:13px"><b>Cargos a buscar:</b> ${h(c.targetRoles)}</p>` : ''}${(c.people || []).length ? `<p class="muted" style="margin:0;font-size:12.5px">Marca con quién has hablado (se crean como contactos al guardar):</p><div class="row" id="vKnown">${c.people.map((pp, i) => `<button type="button" class="chip" data-kp="${i}" aria-pressed="false">${h(pp.name)}</button>`).join('')}</div>` : ''}</div>` : ''}
  <div class="stack voicebox" style="gap:10px"></div>
  <div class="field"><label for="vSum">Resumen para el CRM</label><textarea id="vSum" rows="4" placeholder="Se rellena al ordenar lo dictado. Puedes editarlo."></textarea></div>
  <div id="vPain" class="row" hidden></div>
  <div><p class="eyebrow" style="margin-bottom:6px">Resultado</p><div class="seg" id="sRes">${RESULTS.map(o => `<button type="button" aria-pressed="false">${o}</button>`).join('')}</div></div>
  <div><p class="eyebrow" style="margin-bottom:6px">Interés</p><div class="seg" id="sInt" style="grid-template-columns:repeat(3,1fr)">${INTEREST.map(o => `<button type="button" aria-pressed="false">${o}</button>`).join('')}</div></div>
  <div class="grid2"><div class="field"><label for="vNext">Siguiente paso</label><input id="vNext" placeholder="Ej.: demo con Larry"></div><div class="field"><label for="vDate">Fecha de seguimiento</label><input id="vDate" type="date"></div></div>
  <div id="vPeople" class="stack" style="gap:6px" hidden></div>
  ${canRecord ? `<div class="card stack" style="gap:8px"><div class="row" style="justify-content:space-between"><b>Nota de voz (audio)</b><span class="muted" id="aT" style="font-variant-numeric:tabular-nums">opcional</span></div>
    <button type="button" class="btn ghost block" id="aRec">${ICON.mic} Grabar mi nota de voz</button><audio id="aPlay" controls hidden></audio>
    <p class="muted" style="margin:0;font-size:12px">Solo tu voz, después de la visita. No grabes la conversación con el cliente.</p></div>` : ''}
  <button type="button" class="btn primary block" id="vSave">Guardar visita</button></div>`);
  const seg = (id, key) => p.querySelectorAll(`#${id} button`).forEach(b => b.onclick = () => { st[key] = st[key] === b.textContent ? '' : b.textContent; p.querySelectorAll(`#${id} button`).forEach(x => x.setAttribute('aria-pressed', x.textContent === st[key])); });
  seg('sRes', 'result'); seg('sInt', 'interest');
  const setSeg = (id, val) => p.querySelectorAll(`#${id} button`).forEach(x => x.setAttribute('aria-pressed', x.textContent === val));
  const metKnown = new Set();
  p.querySelectorAll('[data-kp]').forEach(b => b.onclick = () => { const i = +b.dataset.kp; if (metKnown.has(i)) metKnown.delete(i); else metKnown.add(i); b.setAttribute('aria-pressed', metKnown.has(i)); b.classList.toggle('crm', metKnown.has(i)); });
  const drawPeople = () => {
    const box = p.querySelector('#vPeople');
    box.hidden = !st.people.length;
    box.innerHTML = `<p class="eyebrow">Contactos detectados en lo dictado</p>` + st.people.map((x, i) => `<label class="person" style="grid-template-columns:24px 38px 1fr;cursor:pointer"><input type="checkbox" data-pp="${i}" ${x.keep ? 'checked' : ''} aria-label="Crear ${h(x.firstName)} ${h(x.lastName)}"><span class="av">${h(initials(`${x.firstName} ${x.lastName}`))}</span><span style="min-width:0"><b>${h(`${x.firstName} ${x.lastName}`.trim())}</b><span class="muted" style="display:block;font-size:12.5px">${h([x.role, x.email, x.phone].filter(Boolean).join(' · '))}</span></span></label>`).join('') + `<p class="muted" style="margin:0;font-size:12px">Los marcados se crean como contactos de ${h(c.name)} al guardar. Podrás editarlos después.</p>`;
    box.querySelectorAll('[data-pp]').forEach(cb => cb.onchange = () => { st.people[+cb.dataset.pp].keep = cb.checked; });
  };
  const stopVoice = voiceBox(p, {
    parseLabel: 'Hacer resumen y detectar contactos',
    placeholder: 'Ej.: He hablado con Katrin Vogel, Head of Foodservice Sales, katrin punto vogel arroba hanse punto de. Tienen 180 mayoristas y liquidan en Excel. Muy interesada. Quedamos en una demo con Larry el martes 23.',
    onDone: async text => {
      const d = await visitFromVoice(text, c, companies());
      st.engine = d.engine;
      if (d.summary) p.querySelector('#vSum').value = d.summary;
      if (d.result) { st.result = d.result; setSeg('sRes', d.result); }
      if (d.interest) { st.interest = d.interest; setSeg('sInt', d.interest); }
      if (d.nextStep) p.querySelector('#vNext').value = d.nextStep;
      if (d.followUpDate) p.querySelector('#vDate').value = d.followUpDate;
      st.painPoints = d.painPoints || [];
      const pain = p.querySelector('#vPain'); pain.hidden = !st.painPoints.length; pain.innerHTML = st.painPoints.map(x => `<span class="chip">${h(x)}</span>`).join('');
      const known = S.contacts.filter(x => x.companyId === c.id).map(x => `${x.firstName} ${x.lastName}`.trim().toLowerCase());
      st.people = (d.contacts || []).filter(x => !known.includes(`${x.firstName} ${x.lastName}`.trim().toLowerCase())).map(x => ({ ...x, keep: true }));
      drawPeople();
      toast(d.engine === 'claude' ? 'Resumen hecho por Claude. Revisa y guarda.' : 'Resumen listo. Revisa y guarda.');
    }
  });
  let rec = null, timer = null;
  const aRec = p.querySelector('#aRec');
  const stopRec = async () => {
    if (!rec) return; clearInterval(timer);
    const blob = await rec.stop(); rec = null; st.audio = blob;
    const a = p.querySelector('#aPlay'); a.src = URL.createObjectURL(blob); a.hidden = false;
    aRec.innerHTML = `${ICON.mic} Volver a grabar`; aRec.classList.remove('danger');
  };
  if (aRec) aRec.onclick = async () => {
    if (rec) { await stopRec(); return; }
    try {
      rec = await recordAudio(); let s = 0;
      aRec.innerHTML = `${ICON.stop} Parar`; aRec.classList.add('danger');
      timer = setInterval(() => { s++; p.querySelector('#aT').textContent = `${String(s / 60 | 0).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }, 1000);
    } catch (e) { toast('Aquí no se puede grabar audio: dicta el resumen'); rec = null; }
  };
  sheetCleanup = () => { stopVoice(); if (rec) { clearInterval(timer); rec.stop(); rec = null; } };
  p.querySelector('#vSave').onclick = async () => {
    await stopRec();
    const transcript = p.querySelector('#vText').value.trim();
    const summary = p.querySelector('#vSum').value.trim() || transcript;
    if (!summary && !st.result && !st.audio) { toast('Dicta un resumen, elige un resultado o graba una nota'); return; }
    const v = { id: db.uid('vs'), fairId: S.fair.id, companyId: c.id, companyName: c.name, booth: c.booth, result: st.result, interest: st.interest, summary, transcript, painPoints: st.painPoints, nextStep: p.querySelector('#vNext').value.trim(), followUpDate: p.querySelector('#vDate').value, engine: st.engine, createdAt: now() };
    if (st.audio) v.audioId = await db.putBlob(st.audio);
    await db.put('visits', v);
    let created = 0;
    const already = S.contacts.filter(x => x.companyId === c.id).map(x => `${x.firstName} ${x.lastName}`.trim().toLowerCase());
    for (const i of metKnown) {
      const pp = c.people[i]; const [fn, ...ln] = pp.name.split(' ');
      if (already.includes(pp.name.toLowerCase()) || st.people.some(x => x.keep && `${x.firstName} ${x.lastName}`.trim().toLowerCase() === pp.name.toLowerCase())) continue;
      await db.put('contacts', { id: db.uid('ct'), fairId: S.fair.id, companyId: c.id, companyName: c.name, firstName: fn, lastName: ln.join(' '), role: '', email: '', phone: '', website: '', notes: 'Visto en el stand', source: 'manual', visitId: v.id, createdAt: now(), updatedAt: now() });
      created++;
    }
    for (const x of st.people.filter(x => x.keep)) {
      await db.put('contacts', { id: db.uid('ct'), fairId: S.fair.id, companyId: c.id, companyName: c.name, firstName: x.firstName, lastName: x.lastName, role: x.role, email: x.email, phone: x.phone, website: '', notes: x.notes || '', source: 'voice', visitId: v.id, createdAt: now(), updatedAt: now() });
      created++;
    }
    S.visits = await db.byFair('visits', S.fair.id);
    S.contacts = await db.byFair('contacts', S.fair.id);
    sheetCleanup = null; closeSheet(); render(); toast(created ? `Visita y ${created} contacto${created > 1 ? 's' : ''} guardados` : 'Visita guardada en el móvil');
  };
}

/* ---------------- contacts tab ---------------- */
function vContacts() {
  view.innerHTML = `<div class="stack"><div><p class="eyebrow">${h(S.fair.name)}</p><h1>Contactos capturados</h1></div>
  <div class="field"><label for="q">Buscar</label><input id="q" placeholder="Nombre, empresa, cargo…" autocomplete="off"></div>
  <div id="plist" class="stack" style="gap:8px"></div></div>`;
  const draw = q => {
    const list = S.contacts.filter(c => !q || `${c.firstName} ${c.lastName} ${c.companyName} ${c.role} ${c.email}`.toLowerCase().includes(q)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    $('#plist').innerHTML = list.map(c => `<button type="button" class="stop" data-c="${c.id}"><span class="av">${h(initials(`${c.firstName} ${c.lastName}` || c.email))}</span><span class="t"><b>${h(`${c.firstName} ${c.lastName}`.trim() || c.email)}</b><small>${h([c.role, c.companyName].filter(Boolean).join(' · '))}</small></span><span class="src">${h(srcLabel(c.source))}</span></button>`).join('')
      || `<div class="empty">Aún no hay contactos. Pulsa <b>Nuevo contacto</b> y haz una foto a una tarjeta o díctalo.</div>`;
    view.querySelectorAll('[data-c]').forEach(b => b.onclick = () => openContactSheet(S.contacts.find(x => x.id === b.dataset.c)));
  };
  draw(''); $('#q').oninput = e => draw(e.target.value.toLowerCase().trim());
}

/* ---------------- visits tab ---------------- */
function vVisits() {
  const list = [...S.visits].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  view.innerHTML = `<div class="stack"><div><p class="eyebrow">${h(S.fair.name)}</p><h1>Visitas</h1></div>
  ${list.map(v => `<div><button type="button" class="stop" data-open="${v.companyId}" style="margin-bottom:6px"><span class="k" style="background:${pColor((company(v.companyId) || {}).priority)}">${h((v.result || '·')[0])}</span><span class="t"><b>${h(v.companyName)}</b><small>${h(v.booth || '')}</small></span><span class="booth">${h(new Date(v.createdAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }))}</span></button>${visitCard(v)}</div>`).join('')
    || '<div class="empty">Aún no hay visitas. Abre una empresa en la ruta y pulsa <b>Resumen de visita</b>.</div>'}</div>`;
  bindOpen(); bindAudio(view);
}

/* ---------------- fair tab ---------------- */
async function vFair() {
  const f = S.fair;
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
  view.innerHTML = `<div class="stack">
  ${f ? `<div><p class="eyebrow">${h(f.city || '')}</p><h1>${h(f.name)}</h1></div>
  <div class="stat"><div class="card"><span class="eyebrow">Empresas objetivo</span><b>${f.companies.length}</b></div><div class="card"><span class="eyebrow">Visitadas</span><b>${f.companies.filter(c => isVisited(c.id)).length}</b></div><div class="card"><span class="eyebrow">Contactos</span><b>${S.contacts.length}</b></div><div class="card"><span class="eyebrow">Con reunión</span><b>${S.visits.filter(v => v.result === 'Reunión').length}</b></div></div>
  <div class="card stack" style="gap:8px"><h2>Pasar a HubSpot</h2><p class="muted" style="margin:0;font-size:13px">Descarga los contactos en el formato de importación de HubSpot y el registro de visitas. Al importar, revisa duplicados.</p>
  <button type="button" class="btn primary block" id="xC">Contactos para HubSpot (.csv)</button><button type="button" class="btn ghost block" id="xV">Visitas (.csv)</button><button type="button" class="btn ghost block" id="xB">Copia completa (.json)</button></div>` : ''}
  <div class="card stack" style="gap:8px"><h2>Cargar otra feria</h2><p class="muted" style="margin:0;font-size:13px">GTM Ops prepara el fichero de cada feria (expositores segmentados, stands, plano y contactos). Impórtalo aquí antes de viajar: después funciona sin conexión.</p>
  <label class="btn ghost block" for="imp" style="position:relative">Importar feria (.json)<input id="imp" type="file" accept=".json,application/json" style="position:absolute;inset:0;opacity:0"></label></div>
  <div class="card stack" style="gap:6px"><h2>Este móvil</h2>
  <p style="margin:0;font-size:13px">Conexión: <b>${navigator.onLine ? 'sí' : 'no'}</b> · Dictado en vivo: <b>${canDictateNow() ? 'sí' : 'no, usa el teclado'}</b> · Ordenar con Claude: <b>${(await aiMode()) === 'claude' ? 'sí' : 'no, reglas en el móvil'}</b> · Grabación de notas: <b>${canRecord ? 'sí' : 'no'}</b> · Datos protegidos: <b>${persisted ? 'sí' : 'no'}</b></p>
  <p class="muted" style="margin:0;font-size:12px">Todo se guarda solo en este móvil. Exporta al acabar cada día.</p></div>
  </div>`;
  if (f) {
    const day = new Date().toISOString().slice(0, 10), slug = f.id;
    $('#xC').onclick = () => download(`${slug}_contactos_hubspot_${day}.csv`, hubspotContactsCsv(f, S.contacts, S.visits));
    $('#xV').onclick = () => download(`${slug}_visitas_${day}.csv`, visitsCsv(f, f.companies, S.visits, S.contacts));
    $('#xB').onclick = () => download(`${slug}_copia_${day}.json`, JSON.stringify({ fair: f, contacts: S.contacts, visits: S.visits, visited: [...S.manualVisited], exportedAt: now() }, null, 1), 'application/json');
  }
  $('#imp').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const fair = data.fair && data.contacts ? data.fair : data;
      if (!fair.id || !fair.name || !Array.isArray(fair.companies)) throw new Error('formato');
      await db.put('fairs', fair);
      if (data.contacts) { for (const c of data.contacts) await db.put('contacts', c); for (const v of data.visits || []) await db.put('visits', v); }
      S.fairs = await db.all('fairs'); await loadFair(fair.id); S.tab = 'route'; render(); toast(`${fair.name} cargada`);
    } catch (err) { toast('El fichero no tiene el formato de una feria'); }
  };
}

/* ---------------- boot ---------------- */
async function boot() {
  setNet();
  db.persist();
  initPlatformDictation().then(d => { platformDict = d; });
  S.lang = await db.getMeta('lang', navigator.language && navigator.language.startsWith('de') ? 'de-DE' : navigator.language && navigator.language.startsWith('en') ? 'en-US' : 'es-ES');
  await loadBundledFairs();
  S.fairs = await db.all('fairs');
  const active = await db.getMeta('activeFair', S.fairs[0] && S.fairs[0].id);
  if (active && S.fairs.some(f => f.id === active)) await loadFair(active);
  else if (S.fairs[0]) await loadFair(S.fairs[0].id);
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));
}
boot();
