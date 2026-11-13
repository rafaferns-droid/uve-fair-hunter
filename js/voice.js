// Voice: live dictation (browser speech recognition) and voice-note audio recording.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canDictate = !!SR;
export const canRecord = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

// Live dictation. onText(fullText, isFinal). Returns {stop()}.
export function dictate({ lang = 'es-ES', onText, onEnd, onError }) {
  if (!SR) throw new Error('no_speech');
  const rec = new SR();
  rec.lang = lang;
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '';
  let stopped = false;
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += (finalText ? ' ' : '') + r[0].transcript.trim();
      else interim += r[0].transcript;
    }
    onText && onText((finalText + ' ' + interim).trim(), !interim);
  };
  rec.onerror = e => { onError && onError(e.error || 'error'); };
  // Some browsers end continuous recognition after a pause: restart until the user stops.
  rec.onend = () => { if (!stopped) { try { rec.start(); return; } catch (e) {} } onEnd && onEnd(finalText); };
  rec.start();
  return { stop() { stopped = true; try { rec.stop(); } catch (e) { onEnd && onEnd(finalText); } } };
}

// Audio recording of the hunter's own voice note. Returns {stop(): Promise<Blob>}.
export async function recordAudio({ onLevel } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const types = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'];
  const mimeType = types.find(t => window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  mr.ondataavailable = e => e.data.size && chunks.push(e.data);
  let raf = 0, ctx = null;
  if (onLevel && window.AudioContext) {
    ctx = new AudioContext();
    const an = ctx.createAnalyser(); an.fftSize = 256;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.frequencyBinCount);
    const tick = () => { an.getByteTimeDomainData(buf); let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128)); onLevel(m / 128); raf = requestAnimationFrame(tick); };
    tick();
  }
  mr.start(1000);
  return {
    stop: () => new Promise(res => {
      mr.onstop = () => {
        cancelAnimationFrame(raf); if (ctx) ctx.close();
        stream.getTracks().forEach(t => t.stop());
        res(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }));
      };
      mr.stop();
    })
  };
}

// claude.ai's own dictation (only when the app runs as a claude.ai artifact). Resolved at boot so
// start() can be called synchronously from the tap, as the platform requires.
export let platformDictation = null;
export async function initPlatformDictation() {
  try { if (window.claude && window.claude.use) platformDictation = await window.claude.use('dictation'); } catch (e) { platformDictation = null; }
  return platformDictation;
}
export function dictatePlatform({ lang = 'es-ES', onText, onEnd, onError }) {
  const d = platformDictation;
  let finalText = '', partial = '';
  const offs = [
    d.onFinal(({ text }) => { finalText += text; onText && onText((finalText + ' ' + partial).trim()); }),
    d.onPartial(({ text }) => { partial = text; onText && onText((finalText + ' ' + partial).trim()); }),
    d.onState(({ state, reason }) => { if (state === 'idle') { offs.forEach(f => { try { f(); } catch (e) {} }); onEnd && onEnd(finalText.trim(), reason); } })
  ];
  d.start({ language: lang.slice(0, 2) }).catch(e => { onError && onError(e && e.code || 'error'); });
  return { stop() { d.stop().catch(() => {}); } };
}
