import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, RotateCcw, RotateCw, Volume2, VolumeX, Repeat, Music } from 'lucide-react';
import { realUrl } from '../components/preview/Viewers';

const fmt = (t) => {
  if (!Number.isFinite(t)) return '0:00';
  const s = Math.floor(t % 60); const m = Math.floor(t / 60) % 60; const h = Math.floor(t / 3600);
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : m}:${String(s).padStart(2, '0')}`;
};
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

/** A short generated tune (WAV) so sample audio files without media data can still be played. */
export function sampleWav(seedText, seconds = 12) {
  const rate = 22050;
  const n = rate * seconds;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  const h = hash(seedText);
  const scale = [0, 2, 4, 7, 9, 12, 14, 16]; // major pentatonic-ish
  const root = 220 * 2 ** (((h % 7) - 3) / 12);
  const step = 0.375; // seconds per note
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const k = Math.floor(t / step);
    const local = t - k * step;
    const deg = scale[(h >> (k % 24)) % scale.length ^ (k % 3)] ?? 0;
    const f = root * 2 ** (deg / 12);
    const env = Math.min(1, local * 40) * Math.exp(-local * 5);
    const bass = Math.sin(2 * Math.PI * (root / 2) * t) * 0.12 * (k % 4 === 0 ? Math.exp(-local * 3) : 0.4 * Math.exp(-local * 3));
    const fade = Math.min(1, t / 0.3, (seconds - t) / 1.2);
    const s = (Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(4 * Math.PI * f * t) * 0.12) * env + bass;
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s * 0.6 * fade)) * 32767, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/** Peak amplitudes (0..1) for drawing a waveform. Returns null if the browser can't decode the file. */
async function peaksOf(url, bars) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const data = await (await fetch(url)).arrayBuffer();
  if (data.byteLength > 60 * 1024 * 1024) return null;
  const ctx = new Ctx();
  try {
    const audio = await ctx.decodeAudioData(data);
    const ch = audio.getChannelData(0);
    const size = Math.floor(ch.length / bars) || 1;
    const out = [];
    for (let b = 0; b < bars; b++) {
      let max = 0;
      for (let i = b * size, end = Math.min(ch.length, (b + 1) * size); i < end; i += 16) max = Math.max(max, Math.abs(ch[i]));
      out.push(max);
    }
    const top = Math.max(...out, 0.01);
    return out.map((x) => x / top);
  } finally { ctx.close?.(); }
}

const BARS = 120;
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export default function AudioPlayer({ item }) {
  const real = realUrl(item);
  // Created and revoked in the same effect (a useMemo URL would be revoked by StrictMode's extra cleanup).
  const [sampleUrl, setSampleUrl] = useState(null);
  useEffect(() => {
    if (real) { setSampleUrl(null); return undefined; }
    const u = URL.createObjectURL(sampleWav(item.name));
    setSampleUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [real, item.name]);
  const url = real || sampleUrl;

  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [vol, setVol] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [peaks, setPeaks] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    setPeaks(null); setError(false); setTime(0); setPlaying(false);
    if (!url) return undefined;
    peaksOf(url, BARS).then((p) => { if (alive) setPeaks(p); }).catch(() => { if (alive) setPeaks(null); });
    return () => { alive = false; };
  }, [url]);

  useEffect(() => { if (ref.current) ref.current.volume = vol; }, [vol]);
  useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted]);
  useEffect(() => { if (ref.current) ref.current.playbackRate = speed; }, [speed]);

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => setError(true)); else a.pause();
  };
  const seek = (t) => { const a = ref.current; if (a && Number.isFinite(a.duration)) a.currentTime = Math.max(0, Math.min(a.duration, t)); };

  // Space toggles playback; J/L skip like video players. Arrow keys stay with the preview (next/previous file).
  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(document.activeElement?.tagName) && e.key === ' ') return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); toggle(); }
      if (e.key === 'j') seek((ref.current?.currentTime || 0) - 10);
      if (e.key === 'l') seek((ref.current?.currentTime || 0) + 10);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pct = dur ? time / dur : 0;
  const onWave = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * dur);
  };
  const onWaveKey = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seek(time + 5); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); seek(time - 5); }
  };
  const fallbackBars = useMemo(() => Array.from({ length: BARS }, (_, i) => 0.25 + 0.6 * Math.abs(Math.sin(i * 0.37 + hash(item.name) % 7) * Math.cos(i * 0.11))), [item.name]);
  const bars = peaks || fallbackBars;

  return (
    <div className="viewer-center dark">
      <div className="audio-card">
        <div className="audio-art" aria-hidden="true"><Music size={40} strokeWidth={1.4} /></div>
        <div className="audio-title truncate">{item.name.replace(/\.[^.]+$/, '')}</div>
        <div className="audio-sub">{real ? item.ext.toUpperCase() : 'Sample audio · generated preview tone'}</div>

        <audio ref={ref} src={url} preload="metadata" loop={loop}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
          onDurationChange={(e) => setDur(e.currentTarget.duration)} onError={() => setError(true)} />

        {error ? <div className="banner warning">This browser can't play this audio format. Download the file to listen to it.</div> : (
          <>
            <div className="audio-wave" role="slider" tabIndex={0} aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(time)} aria-valuetext={`${fmt(time)} of ${fmt(dur)}`}
              onClick={onWave} onKeyDown={onWaveKey}>
              {bars.map((p, i) => <span key={i} className={i / BARS < pct ? 'on' : ''} style={{ height: `${Math.max(6, p * 100)}%` }} />)}
            </div>
            <div className="audio-times"><span>{fmt(time)}</span><span>{fmt(dur)}</span></div>
            <div className="audio-controls">
              <button className={`icon-btn on-dark ${loop ? 'active' : ''}`} onClick={() => setLoop(!loop)} aria-pressed={loop} aria-label="Repeat" data-tip="Repeat"><Repeat size={17} /></button>
              <button className="icon-btn on-dark" onClick={() => seek(time - 10)} aria-label="Back 10 seconds" data-tip="Back 10s (J)"><RotateCcw size={18} /></button>
              <button className="audio-play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'} data-tip={playing ? 'Pause (Space)' : 'Play (Space)'}>
                {playing ? <Pause size={26} fill="currentColor" /> : <Play size={26} fill="currentColor" />}
              </button>
              <button className="icon-btn on-dark" onClick={() => seek(time + 10)} aria-label="Forward 10 seconds" data-tip="Forward 10s (L)"><RotateCw size={18} /></button>
              <select className="audio-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
                {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
              </select>
            </div>
            <div className="audio-volume">
              <button className="icon-btn on-dark" onClick={() => setMuted(!muted)} aria-label={muted ? 'Unmute' : 'Mute'}>{muted || vol === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
              <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : vol} onChange={(e) => { setVol(Number(e.target.value)); setMuted(false); }} aria-label="Volume" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
