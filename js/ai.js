// Smart extraction with Claude when the app runs where Claude is available (claude.ai artifact),
// with the on-phone rules (parse.js) as fallback when it is not, or when there is no coverage.
import { contactFromSpeech, contactFromCard, visitFromSpeech } from './parse.js';

let sampleP = null;
let limitsP = null;
export function sampler() {
  if (!(window.claude && window.claude.use)) return Promise.resolve(null);
  if (!sampleP) sampleP = window.claude.use('sample').catch(() => null);
  return sampleP;
}
async function imagesOk() {
  const s = await sampler(); if (!s || !s.limits) return false;
  if (!limitsP) limitsP = s.limits().catch(() => null);
  const l = await limitsP; return !!(l && l.images);
}
export async function aiMode() {
  if (!navigator.onLine) return 'rules';
  return (await sampler()) ? 'claude' : 'rules';
}

const CONTACT_FIELDS = `{"firstName":"","lastName":"","role":"","companyName":"","companyId":"","email":"","phone":"","website":"","notes":""}`;
const RULES = `Rules:
- Never invent data. A field you cannot find stays "".
- Names and job titles keep their original language and spelling (German umlauts, accents). Capitalise names properly.
- Spoken emails: "punto"/"dot"/"Punkt" = ".", "arroba"/"at"/"ät" = "@", "guion" = "-", "guion bajo"/"underscore" = "_". Remove spaces inside the address. Lowercase it.
- Phones: digits only with a leading + and country code when said or obvious (Germany +49, Spain +34, USA +1). Spoken numbers become digits.
- companyId: if the company matches one in the fair list (same company even if said partially or with a typo), put its id and use its exact name in companyName; otherwise "" and the name as said.
- A website only if it is said or printed.`;

function fairList(companies) {
  return companies.map(c => `${c.id} | ${c.name} | stand ${c.booth}`).join('\n');
}
function pick(o, keys) { const r = {}; for (const k of keys) r[k] = typeof o[k] === 'string' ? o[k].trim() : ''; return r; }
const CK = ['firstName', 'lastName', 'role', 'companyName', 'companyId', 'email', 'phone', 'website', 'notes'];

// Dictated contact -> fields
export async function contactFromVoice(text, companies, { signal } = {}) {
  const s = navigator.onLine ? await sampler() : null;
  if (s) {
    try {
      const out = await s.json(`You turn a trade-show hunter's dictated note about ONE new contact into a CRM contact.
${RULES}
- "notes": anything else useful the hunter said about this person (interests, what to send them), in Spanish, one or two short sentences.

Fair companies (id | name | stand):
${fairList(companies)}

Dictation (may contain speech-recognition errors; fix obvious ones):
"""${text}"""

Reply with only this JSON object: ${CONTACT_FIELDS}`, { modelTier: 'quick', signal });
      const r = pick(out, CK);
      if (r.companyId && !companies.some(c => c.id === r.companyId)) r.companyId = '';
      return { ...r, engine: 'claude' };
    } catch (e) { if (e && e.code === 'cancelled') throw e; console.warn('ai contact', e); }
  }
  return { ...contactFromSpeech(text, companies), notes: '', engine: 'rules' };
}

// Card photo -> fields. Local OCR always runs first (works offline); Claude reads the photo itself when possible.
export async function contactFromPhoto(blob, ocr, companies, { signal } = {}) {
  const local = { ...contactFromCard(ocr ? ocr.lines : [], companies), notes: '', engine: 'ocr' };
  const s = navigator.onLine ? await sampler() : null;
  if (s) {
    try {
      const withImg = await imagesOk();
      const out = await s.json(`You read a business card photographed at a trade show and return the contact for a CRM.
${RULES}
- If the card shows several phones, prefer the mobile.
- "notes": "" unless the card shows something useful (e.g. second office, languages).
${withImg ? 'The photo of the card is attached. Use it as the main source.' : ''}
Text read by an on-phone OCR (may be wrong; use it only as a hint):
"""${(ocr && ocr.text || '').slice(0, 2000)}"""

Fair companies (id | name | stand):
${fairList(companies)}

Reply with only this JSON object: ${CONTACT_FIELDS}`, { modelTier: withImg ? 'default' : 'quick', images: withImg ? [blob] : undefined, signal });
      const r = pick(out, CK);
      if (r.companyId && !companies.some(c => c.id === r.companyId)) r.companyId = '';
      // keep what OCR found if Claude left a field empty
      for (const k of CK) if (!r[k] && local[k]) r[k] = local[k];
      return { ...r, engine: withImg ? 'claude-vision' : 'claude' };
    } catch (e) { if (e && e.code === 'cancelled') throw e; console.warn('ai card', e); }
  }
  return local;
}

// Dictated visit -> summary, result, interest, next step and the people mentioned
export async function visitFromVoice(text, company, companies, { signal } = {}) {
  const s = navigator.onLine ? await sampler() : null;
  if (s) {
    try {
      const out = await s.json(`You are helping a B2B sales hunter from UVE Solutions (route-to-market data for food & beverage manufacturers: sell-out data sharing with distributors, agreements and settlements, outlet census, field sales app). He just left a trade-show stand and dictated this note about the visit to "${company.name}" (stand ${company.booth}).

Dictation (may contain speech-recognition errors; fix obvious ones):
"""${text}"""

Return only this JSON:
{"summary":"","result":"","interest":"","nextStep":"","followUpDate":"","painPoints":[],"contacts":[{"firstName":"","lastName":"","role":"","email":"","phone":"","notes":""}]}

Rules:
- Never invent anything that was not said.
- "summary": 2 to 4 short sentences in Spanish, factual, for the CRM: who he spoke with, their situation (distributors, current tools, problems), what interested them.
- "result": exactly one of "Reunión" (a meeting or demo was agreed), "Tarjeta" (got a card, no meeting yet), "Volver" (must come back to the stand), "No target" (not a fit), or "" if unclear.
- "interest": "Alto", "Medio", "Bajo" or "".
- "nextStep": the agreed next action in Spanish, short, with who and when if said. "" if none.
- "followUpDate": ISO date YYYY-MM-DD only if a concrete date can be derived (today is ${new Date().toISOString().slice(0, 10)}), else "".
- "painPoints": up to 3 very short Spanish phrases with the problems they mentioned.
- "contacts": every person from ${company.name} he says he met or must contact, with what was said about them. Spoken emails and phones normalised as usual. Empty list if none.`, { modelTier: 'quick', signal });
      const RES = ['Reunión', 'Tarjeta', 'Volver', 'No target'], INT = ['Alto', 'Medio', 'Bajo'];
      return {
        summary: (out.summary || '').trim(),
        result: RES.includes(out.result) ? out.result : '',
        interest: INT.includes(out.interest) ? out.interest : '',
        nextStep: (out.nextStep || '').trim(),
        followUpDate: /^\d{4}-\d{2}-\d{2}$/.test(out.followUpDate || '') ? out.followUpDate : '',
        painPoints: Array.isArray(out.painPoints) ? out.painPoints.filter(x => typeof x === 'string').slice(0, 3) : [],
        contacts: Array.isArray(out.contacts) ? out.contacts.map(c => pick(c || {}, ['firstName', 'lastName', 'role', 'email', 'phone', 'notes'])).filter(c => c.firstName || c.lastName || c.email) : [],
        engine: 'claude'
      };
    } catch (e) { if (e && e.code === 'cancelled') throw e; console.warn('ai visit', e); }
  }
  const r = visitFromSpeech(text);
  const cc = contactFromSpeech(text, [company]);
  const contacts = cc.firstName && (cc.role || cc.email || cc.phone) ? [{ firstName: cc.firstName, lastName: cc.lastName, role: cc.role, email: cc.email, phone: cc.phone, notes: '' }] : [];
  return { summary: text.trim(), ...r, followUpDate: '', painPoints: [], contacts, engine: 'rules' };
}
