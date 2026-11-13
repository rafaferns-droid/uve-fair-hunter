// Exports: HubSpot contact import CSV, visits CSV and a full backup.
const esc = v => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (head, rows) => '﻿' + [head, ...rows].map(r => r.map(esc).join(',')).join('\r\n');

export async function download(name, text, type = 'text/csv;charset=utf-8') {
  const blob = text instanceof Blob ? text : new Blob([text], { type });
  // Inside a claude.ai artifact plain downloads are blocked: use the platform's save dialog.
  if (window.claude && window.claude.use) {
    try { const d = await window.claude.use('downloads'); if (d) { await d.save({ filename: name, data: blob }); return; } } catch (e) { if (e && e.code === 'declined') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// Column names match HubSpot's default contact properties so the import maps them automatically.
export function hubspotContactsCsv(fair, contacts, visits) {
  const lastVisit = cid => visits.filter(v => v.companyId && v.companyId === cid).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const rows = contacts.map(c => {
    const v = lastVisit(c.companyId);
    const note = [c.notes, v && v.summary ? `Visita: ${v.summary}` : '', v && v.nextStep ? `Siguiente paso: ${v.nextStep}` : ''].filter(Boolean).join(' | ');
    return [c.firstName, c.lastName, c.email, c.phone, c.role, c.companyName, c.website, `Trade show: ${fair.name}`, c.createdAt.slice(0, 10), note];
  });
  return csv(['First Name', 'Last Name', 'Email', 'Phone Number', 'Job Title', 'Company Name', 'Website URL', 'Lead Source Detail', 'Fair Capture Date', 'Fair Notes'], rows);
}

export function visitsCsv(fair, companies, visits, contacts) {
  const byId = Object.fromEntries(companies.map(c => [c.id, c]));
  const rows = visits.map(v => {
    const c = byId[v.companyId] || {};
    const people = contacts.filter(x => x.companyId && x.companyId === v.companyId).map(x => `${x.firstName} ${x.lastName}`.trim()).join('; ');
    return [fair.name, v.createdAt.slice(0, 16).replace('T', ' '), c.name || v.companyName || '', c.booth || '', v.result, v.interest, v.summary, v.nextStep, people, v.audioId ? 'Sí' : 'No'];
  });
  return csv(['Feria', 'Fecha', 'Empresa', 'Stand', 'Resultado', 'Interés', 'Resumen', 'Siguiente paso', 'Contactos', 'Nota de voz'], rows);
}
