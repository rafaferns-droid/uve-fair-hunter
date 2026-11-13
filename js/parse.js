// Turn dictated text or OCR text into contact fields and visit summaries.
// Rule based on purpose: it runs on the phone, without internet or AI.

const ROLE_WORDS = [
  'director', 'directora', 'manager', 'head', 'leiter', 'leiterin', 'gerente', 'responsable', 'jefe', 'jefa',
  'ceo', 'coo', 'cco', 'cfo', 'cmo', 'vp', 'vice president', 'president', 'owner', 'founder', 'co-founder',
  'geschäftsführer', 'geschäftsführerin', 'vertriebsleiter', 'vertriebsdirektor', 'key account', 'account manager',
  'sales', 'marketing', 'category', 'trade', 'export', 'commercial', 'comercial', 'buyer', 'einkauf', 'prokurist', 'lead'
];
const COMPANY_SUFFIX = /\b(gmbh|ag|kg|se|s\.?l\.?u?|s\.?a\.?|inc\.?|ltd\.?|llc|bv|b\.v\.|spa|s\.p\.a\.|srl|plc|co\.?|group|gruppe|foods?|brau(erei)?|company)\b/i;
const NAME_STOP = /\b(gmbh|ag|tel|fax|mobil|mobile|www|http|str|straße|strasse|street|road|platz)\b/i;

const NUM_WORDS = {
  cero: 0, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  null: 0, eins: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9
};

export const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL_RE = /\b(?:https?:\/\/)?(?:www\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/i;
const PHONE_RE = /(\+?\(?\d[\d\s()./-]{6,}\d)/;

const clean = s => (s || '').replace(/\s+/g, ' ').trim();
const cap = s => s.split(/(\s+|-)/).map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : w).join('');
const capName = s => cap(s.toLowerCase());
const upFirst = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const trimRole = r => upFirst(clean(r.split(/\s+(?:de la|de|del|at|bei|von|for|para|en|in)\s+/i)[0].replace(/\s+(?:de|at|bei|von|en)$/i, '')));

// "markus punto stein arroba hanse feinkost punto de" -> "markus.stein@hansefeinkost.de"
export function spokenEmail(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  const re = /((?:[\wäöüß-]+ ?(?:punto|dot|punkt|guion|guión|bajo|underscore|minus|-|\.)? ?){1,4})\s*(?:arroba|at|@|ät)\s+((?:[\wäöüß-]+ ?(?:punto|dot|punkt|guion|guión|-|\.)? ?){1,5})/g;
  for (const m of t.matchAll(re)) { const r = emailFromMatch(m); if (r) return r; }
  return null;
}
function emailFromMatch(m) {
  const norm = s => s.trim()
    .replace(/\s*(punto|dot|punkt|\.)\s*/g, '.')
    .replace(/\s*(guion bajo|guión bajo|underscore)\s*/g, '_')
    .replace(/\s*(guion|guión|minus|-)\s*/g, '-')
    .replace(/\s+/g, '')
    .replace(/[äöüß]/g, c => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' }[c]));
  let local = norm(m[1].split(/\b(?:es|is|ist|email|correo|mail|e-mail)\b/).pop());
  let domain = norm(m[2]);
  domain = domain.replace(/\.+$/, '');
  if (!/\.[a-z]{2,}$/.test(domain)) return null;
  local = local.replace(/^\.+|\.+$/g, '');
  return local && domain ? `${local}@${domain}` : null;
}

function spokenDigits(text) {
  // join runs of number words / digits that follow "teléfono|phone|telefon|móvil|mobile"
  const m = text.match(/(?:tel[eé]fono|phone|telefon|telefonnummer|m[oó]vil|mobile|handy|n[uú]mero)\s*(?:es|is|ist|:)?\s*((?:\+|m[aá]s|plus)?\s*(?:[\d]+|cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|zero|one|two|three|four|five|six|seven|eight|nine|null|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun)(?:[\s,.-]+(?:[\d]+|cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|zero|one|two|three|four|five|six|seven|eight|nine|null|eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun))*)/i);
  if (!m) return null;
  let s = m[1].toLowerCase().replace(/^(m[aá]s|plus)\s*/, '+');
  s = s.replace(/[a-zäöüß]+/g, w => (w in NUM_WORDS ? String(NUM_WORDS[w]) : ''));
  const digits = s.replace(/[^\d+]/g, '');
  return digits.replace(/\+/g, '').length >= 7 ? digits : null;
}

function findPhone(text) {
  const spoken = spokenDigits(text);
  if (spoken) return formatPhone(spoken);
  const m = text.match(PHONE_RE);
  return m ? formatPhone(m[1]) : null;
}
function formatPhone(p) {
  const s = p.replace(/[^\d+]/g, '');
  return s.startsWith('00') ? '+' + s.slice(2) : s;
}

function matchCompany(text, companies) {
  const t = text.toLowerCase();
  let best = null;
  for (const c of companies || []) {
    const n = c.name.toLowerCase();
    const core = n.replace(COMPANY_SUFFIX, '').trim();
    const sig = core.split(/\s+/).filter(w => w.length >= 4 && !/^\d+$/.test(w));
    const fuzzy = sig.length >= 2 ? sig.slice(0, 2).every(w => t.includes(w)) : (sig[0] && sig[0].length >= 6 && t.includes(sig[0]));
    if (t.includes(n) || (core.length > 3 && t.includes(core)) || fuzzy) {
      if (!best || n.length > best.name.length) best = c;
    }
  }
  return best;
}

function roleFromText(text) {
  const m = text.match(/(?:cargo(?: es)?|es el|es la|es|is the|is a|is|works as|ist|als|position)\s+((?:[\wäöüßÀ-ÿ&/-]+\s?){1,6}?)(?=\s+(?:de|del|en|at|bei|von|in|for|para)\s|[,.;]|\s+(?:email|correo|mail|tel|tel[eé]fono|phone|m[oó]vil)|$)/i);
  if (m && ROLE_WORDS.some(w => m[1].toLowerCase().includes(w))) return trimRole(m[1]);
  // fallback: a run of words containing a role keyword
  const words = text.split(/[,.;]/);
  for (const w of words) {
    const lw = w.toLowerCase();
    const kw = ROLE_WORDS.find(r => new RegExp(`\\b${r}\\b`).test(lw));
    if (kw) {
      const seg = w.match(new RegExp(`((?:[\\wäöüßÀ-ÿ&/-]+\\s){0,3}${kw}(?:\\s[\\wäöüßÀ-ÿ&/-]+){0,3})`, 'i'));
      if (seg) return trimRole(seg[1].replace(/^(es|is|the|el|la|ist|der|die|a|an|una|un)\s+/i, ''));
    }
  }
  return '';
}

function nameFromText(text) {
  const m = text.match(/(?:se llama|me llamo|nombre(?: es)?|contacto(?: es)?|name is|his name is|her name is|this is|heißt|ich bin|soy|he hablado con|hablado con|met|spoke with|con)\s+([A-ZÀ-Ýa-zà-ÿäöüß'-]+(?:\s+[A-ZÀ-Ýa-zà-ÿäöüß'-]+){0,2})/i);
  let cand = m ? m[1] : null;
  if (!cand) {
    const caps = text.match(/\b([A-ZÀ-Ý][a-zà-ÿäöüß'-]+)\s+([A-ZÀ-Ý][a-zà-ÿäöüß'-]+)\b/);
    cand = caps ? caps[0] : null;
  }
  if (!cand) return { firstName: '', lastName: '' };
  const parts = cand.split(/\s+/).filter(p => !/^(de|del|la|el|y|und|and|von|van|es|is|ist)$/i.test(p) || p === cand.split(/\s+/)[1]);
  const words = parts.filter(p => !ROLE_WORDS.includes(p.toLowerCase())).slice(0, 3).map(capName);
  return { firstName: words[0] || '', lastName: words.slice(1).join(' ') };
}

// Voice: "Markus Stein, Leiter Key Account Großhandel de Hanse Feinkost, correo markus punto stein arroba hanse-feinkost punto de, teléfono más 49 40 5550 1234"
export function contactFromSpeech(text, companies = []) {
  const t = clean(text);
  const email = (t.match(EMAIL_RE) || [])[0] || spokenEmail(t) || '';
  const phone = findPhone(t) || '';
  const comp = matchCompany(t, companies);
  let companyName = comp ? comp.name : '';
  if (!companyName) {
    const m = t.match(/(?:de la empresa|empresa|de|at|bei|from|von|company)\s+([A-ZÀ-Ý][\wÀ-ÿäöüß&.\- ]{2,40}?)(?=[,.;]|\s+(?:correo|email|mail|tel|tel[eé]fono|phone|m[oó]vil|y|and|und)\b|$)/);
    if (m && !ROLE_WORDS.includes(m[1].toLowerCase())) companyName = clean(m[1]);
  }
  if (!companyName && email) companyName = companyFromDomain(email);
  const { firstName, lastName } = nameFromText(t);
  return { firstName, lastName, role: roleFromText(t), companyName, companyId: comp ? comp.id : '', email, phone, website: '' };
}

export function companyFromDomain(email) {
  const d = (email.split('@')[1] || '').split('.')[0];
  if (!d || /^(gmail|hotmail|outlook|yahoo|gmx|web|icloud|live|t-online)$/i.test(d)) return '';
  return cap(d.replace(/[-_]/g, ' '));
}

// OCR: Tesseract result lines (text + bbox) -> contact fields
export function contactFromCard(lines, companies = []) {
  const L = lines.map(l => ({ text: clean(l.text), h: l.bbox ? l.bbox.y1 - l.bbox.y0 : 0 })).filter(l => l.text.length > 1);
  const full = L.map(l => l.text).join('\n');
  const email = ((full.match(EMAIL_RE) || [])[0] || '').replace(/[,;]$/, '');
  const website = ((full.match(URL_RE) || [])[0] || '');
  let phone = '';
  const phoneLine = L.find(l => /(mob|mobil|mobile|handy|m[oó]vil|cell)/i.test(l.text) && PHONE_RE.test(l.text))
    || L.find(l => /(tel|phone|fon|t\s?[:.]|\+)/i.test(l.text) && PHONE_RE.test(l.text))
    || L.find(l => PHONE_RE.test(l.text) && !EMAIL_RE.test(l.text));
  if (phoneLine) phone = formatPhone(phoneLine.text.match(PHONE_RE)[1]);

  const comp = matchCompany(full, companies);
  let companyName = comp ? comp.name : '';
  const compLine = L.find(l => COMPANY_SUFFIX.test(l.text) && !EMAIL_RE.test(l.text) && !URL_RE.test(l.text));
  if (!companyName && compLine) companyName = compLine.text;
  if (!companyName && email) companyName = companyFromDomain(email);

  const roleLine = L.find(l => ROLE_WORDS.some(w => new RegExp(`\\b${w}\\b`, 'i').test(l.text)) && !EMAIL_RE.test(l.text) && !PHONE_RE.test(l.text) && l !== compLine);

  const isNameLike = l => {
    const w = l.text.split(' ');
    return w.length >= 2 && w.length <= 4 && !/\d/.test(l.text) && !EMAIL_RE.test(l.text) && !NAME_STOP.test(l.text)
      && !COMPANY_SUFFIX.test(l.text) && l !== roleLine && w.every(x => /^[A-ZÀ-Ý][\wÀ-ÿäöüß'.-]*$/.test(x) || /^(von|van|de|del|der|la)$/i.test(x));
  };
  let nameLine = L.filter(isNameLike).sort((a, b) => b.h - a.h)[0];
  // the email local part often confirms the name
  if (!nameLine && email) {
    const lp = email.split('@')[0].split(/[._-]/);
    if (lp.length >= 2) nameLine = { text: lp.map(capName).join(' ') };
  }
  const nameParts = nameLine ? nameLine.text.split(' ') : [];
  return {
    firstName: nameParts[0] || '', lastName: nameParts.slice(1).join(' '),
    role: roleLine ? roleLine.text : '', companyName, companyId: comp ? comp.id : '',
    email, phone, website
  };
}

// Visit note: free speech -> result, interest, next step
export function visitFromSpeech(text) {
  const t = clean(text);
  const lt = t.toLowerCase();
  let result = '';
  if (/(reuni[oó]n|meeting|termin|demo)\b.*(cerrad|agend|fijad|booked|set|vereinbart|confirm)|(cerramos|agendamos|tenemos) (una )?(reuni[oó]n|demo)/.test(lt)) result = 'Reunión';
  else if (/(volver|vuelvo|repesca|come back|later|später|wiederkommen)/.test(lt)) result = 'Volver';
  else if (/(no (es )?target|no encaja|no interesa|not a fit|kein interesse)/.test(lt)) result = 'No target';
  else if (/(tarjeta|card|visitenkarte)/.test(lt)) result = 'Tarjeta';
  let interest = '';
  if (/(inter[eé]s alto|muy interesad|high interest|very interested|sehr interessiert|mucho inter[eé]s)/.test(lt)) interest = 'Alto';
  else if (/(inter[eé]s bajo|poco inter[eé]s|low interest|wenig interesse|no interesad)/.test(lt)) interest = 'Bajo';
  else if (/(inter[eé]s medio|algo de inter[eé]s|some interest|medium)/.test(lt)) interest = 'Medio';
  const ns = t.match(/(?:siguiente paso|pr[oó]ximo paso|next step|n[aä]chster schritt|quedamos en|we agreed to|follow ?up)\s*(?:es|is|ist|:)?\s*([^.]+)/i);
  return { result, interest, nextStep: ns ? clean(ns[1]) : '' };
}
