import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Play, Pause, Maximize, Minimize } from 'lucide-react';
import { useDrive } from '../store/DriveStore';
import { thumbUrl } from '../components/common';
import { genThumb } from '../utils/fileTypes';

/** Thumbnails of the other images in the folder; click to jump. */
export function Filmstrip({ ids, current, onPick }) {
  const { state } = useDrive();
  const ref = useRef(null);
  useEffect(() => {
    ref.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [current]);
  if (ids.length < 2) return null;
  return (
    <div className="filmstrip" ref={ref} role="listbox" aria-label="Images in this folder">
      {ids.map((id, i) => {
        const it = state.items[id];
        if (!it) return null;
        return (
          <button key={id} role="option" aria-selected={id === current} className={`film-thumb ${id === current ? 'active' : ''}`} onClick={() => onPick(id)} data-tip={it.name}>
            <img src={thumbUrl(it) || genThumb(1)} alt={`${i + 1}. ${it.name}`} draggable={false} loading="lazy" />
          </button>
        );
      })}
    </div>
  );
}

const INTERVALS = [3, 5, 10];

/** Full-screen slideshow over a set of images, with autoplay. */
export function Slideshow({ ids, startId, onClose, onChange }) {
  const { state, api } = useDrive();
  const [idx, setIdx] = useState(Math.max(0, ids.indexOf(startId)));
  const shownId = useRef(ids[idx]);
  const [playing, setPlaying] = useState(true);
  const [secs, setSecs] = useState(5);
  const [full, setFull] = useState(false);
  const [chrome, setChrome] = useState(true);
  const rootRef = useRef(null);
  const hideTimer = useRef(null);
  const item = state.items[ids[idx]];

  const go = (d) => setIdx((i) => (ids.length ? (i + d + ids.length) % ids.length : 0));
  // The image list can change while the slideshow is open (files deleted, moved…): stay on the same image if it's
  // still there, otherwise clamp; close when no images remain so the slideshow never hides while eating keys.
  const idsKey = ids.join('|');
  useEffect(() => {
    if (!ids.length) { onClose(); return; }
    const keep = ids.indexOf(shownId.current);
    setIdx((i) => (keep >= 0 ? keep : Math.min(i, ids.length - 1)));
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = ids[idx];
    if (!id) return;
    if (id !== shownId.current) api.markOpened?.(id);
    shownId.current = id;
    onChange?.(id);
  }, [idx, idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autoplay: restart the timer whenever the slide, speed or play state changes.
  useEffect(() => {
    if (!playing) return undefined;
    const t = setTimeout(() => go(1), secs * 1000);
    return () => clearTimeout(t);
  }, [playing, secs, idx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preload the next image so transitions are instant.
  useEffect(() => {
    const next = state.items[ids[(idx + 1) % ids.length]];
    if (next) { const img = new Image(); img.src = thumbUrl(next) || ''; }
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    onClose();
  };
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else rootRef.current?.requestFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(-1); }
      if (e.key === ' ') { e.preventDefault(); setPlaying((p) => !p); }
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) toggleFull();
      poke();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // Controls fade out after a moment without mouse movement.
  const poke = () => {
    setChrome(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), 2500);
  };
  useEffect(() => { poke(); return () => clearTimeout(hideTimer.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) return null; // (the effect above clamps the index or closes)
  return createPortal(
    <div className={`slideshow ${chrome ? '' : 'idle'}`} ref={rootRef} onMouseMove={poke} role="dialog" aria-modal="true" aria-label="Slideshow">
      <img key={item.id} className="slideshow-img" src={thumbUrl(item) || genThumb(1)} alt={item.name} draggable={false} />
      <div className="slideshow-top">
        <span className="truncate">{item.name}</span>
        <span className="muted">{idx + 1} / {ids.length}</span>
        <span className="grow" />
        <button className="icon-btn on-dark" onClick={toggleFull} aria-label={full ? 'Exit full screen' : 'Full screen'} data-tip="Full screen (F)">{full ? <Minimize size={18} /> : <Maximize size={18} />}</button>
        <button className="icon-btn on-dark" onClick={close} aria-label="Close slideshow" data-tip="Close (Esc)"><X size={20} /></button>
      </div>
      <button className="stage-arrow left" onClick={() => go(-1)} aria-label="Previous image"><ChevronLeft size={26} /></button>
      <button className="stage-arrow right" onClick={() => go(1)} aria-label="Next image"><ChevronRight size={26} /></button>
      <div className="slideshow-bar">
        <button className="icon-btn on-dark" onClick={() => setPlaying(!playing)} aria-label={playing ? 'Pause slideshow' : 'Play slideshow'} data-tip={playing ? 'Pause (Space)' : 'Play (Space)'}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <div className="seg-dark" role="group" aria-label="Seconds per image">
          {INTERVALS.map((s) => <button key={s} className={secs === s ? 'active' : ''} onClick={() => setSecs(s)} aria-pressed={secs === s}>{s}s</button>)}
        </div>
      </div>
      {playing && <div key={`${idx}-${secs}`} className="slideshow-progress" style={{ animationDuration: `${secs}s` }} />}
    </div>,
    document.body,
  );
}
