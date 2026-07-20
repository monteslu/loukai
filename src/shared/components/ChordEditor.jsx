/**
 * ChordEditor - timeline editing for the chord track (issue #93), the same
 * row treatment as lyrics. Time fields use the draft pattern from issue #69:
 * hard-controlling a formatted number input eats keystrokes.
 */

import { useState } from 'react';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// The detector's vocabulary as pick-list suggestions; typing stays free-form
// because the format allows richer qualities (G7, Csus4) the detector does not
// emit yet.
const COMMON_CHORDS = NOTE_NAMES.flatMap((n) => [n, n + 'm']);

// Audition a chord as a synthesized triad, sustained for the chord's own
// duration (like a lyric line plays for its span). No samples, no assets.
let auditionCtx = null;
let auditionGain = null;
function playChordTone(name, durationSec) {
  const m = String(name || '')
    .trim()
    .match(/^([A-Ga-g])([#b]?)(m?)(?![a-z])/);
  if (!m) return;
  const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
  let root = m[1].toUpperCase() + (m[2] || '');
  root = FLAT_TO_SHARP[root] || root;
  const pc = NOTE_NAMES.indexOf(root);
  if (pc < 0) return;
  const minor = m[3] === 'm';
  const dur = Math.min(Math.max(Number(durationSec) || 1, 0.4), 12);
  auditionCtx = auditionCtx || new (window.AudioContext || window.webkitAudioContext)();
  const ctx = auditionCtx;
  const now = ctx.currentTime;
  // A new audition cuts off the previous one (like restarting line playback).
  if (auditionGain) {
    try {
      auditionGain.gain.cancelScheduledValues(now);
      auditionGain.gain.setTargetAtTime(0.0001, now, 0.02);
    } catch {
      /* already gone */
    }
  }
  const master = ctx.createGain();
  auditionGain = master;
  master.gain.setValueAtTime(0.0001, now);
  master.gain.linearRampToValueAtTime(0.22, now + 0.04);
  master.gain.setValueAtTime(0.22, now + Math.max(0.05, dur - 0.25));
  master.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  master.connect(ctx.destination);
  for (const interval of [0, minor ? 3 : 4, 7]) {
    const midi = 60 + pc + interval; // around C4 so triads sit mid-range
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    osc.connect(master);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  }
}

function TimeField({ value, onCommit }) {
  const [draft, setDraft] = useState(null);
  return (
    <input
      type="number"
      step="0.1"
      min="0"
      className="w-[64px] px-1 py-1 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white text-xs text-center font-mono focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      value={draft ?? value.toFixed(2)}
      onChange={(e) => {
        setDraft(e.target.value);
        const v = parseFloat(e.target.value);
        if (Number.isFinite(v)) onCommit(Math.max(0, v));
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

export function ChordEditor({ chords, onChange }) {
  const [selectedIndex, setSelectedIndex] = useState(null);
  const [open, setOpen] = useState(false);
  const list = chords || [];

  const update = (i, patch) => {
    const next = list.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    onChange(next);
  };
  const remove = (i) => onChange(list.filter((_, idx) => idx !== i));
  const addAfter = (i) => {
    const prev = list[i];
    const start = prev ? prev.end : 0;
    const entry = { start, end: start + 2, chord: 'C' };
    const next = [...list];
    next.splice(i + 1, 0, entry);
    onChange(next);
  };

  return (
    <div className="mt-4 border border-gray-200 dark:border-gray-700 rounded-lg">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <span className="font-semibold text-gray-900 dark:text-gray-100">
          Chords ({list.length})
        </span>
        <span className="material-icons text-gray-500">{open ? 'expand_less' : 'expand_more'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 max-h-[300px] overflow-y-auto">
          <datalist id="chord-name-options">
            {COMMON_CHORDS.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {list.length === 0 && (
            <div className="text-sm text-gray-500 dark:text-gray-400 py-2">
              No chord track. Chords are detected automatically when a song is created or first
              played.
              <button
                type="button"
                onClick={() => addAfter(-1)}
                className="ml-2 text-blue-600 dark:text-blue-400 hover:underline"
              >
                Add one manually
              </button>
            </div>
          )}
          {list.map((c, i) => (
            <div
              key={`chord-${i}`}
              onClick={() => setSelectedIndex(i)}
              className={`flex items-center gap-2.5 mb-2.5 p-2 border-2 rounded transition-all cursor-pointer ${
                selectedIndex === i
                  ? 'border-blue-500 bg-blue-100 dark:border-blue-400 dark:bg-blue-900/40'
                  : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-750 hover:border-gray-400 dark:hover:border-gray-500'
              }`}
            >
              <span
                title={`Play chord ${i + 1} as a tone`}
                className="flex items-center justify-center min-w-[36px] h-9 bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm font-semibold text-gray-700 dark:text-gray-200 cursor-pointer transition-all flex-shrink-0 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-500"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedIndex(i);
                  playChordTone(c.chord, c.end - c.start);
                }}
              >
                {i + 1}
              </span>
              <TimeField value={c.start} onCommit={(v) => update(i, { start: v })} />
              <span className="text-gray-400 text-xs">to</span>
              <TimeField value={c.end} onCommit={(v) => update(i, { end: v })} />
              <input
                type="text"
                list="chord-name-options"
                className="w-[72px] px-2 py-1 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                value={c.chord}
                onChange={(e) => update(i, { chord: e.target.value })}
              />
              <button
                type="button"
                onClick={() => addAfter(i)}
                title="Add chord after"
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <span className="material-icons text-gray-500 text-base leading-none">add</span>
              </button>
              <button
                type="button"
                onClick={() => remove(i)}
                title="Delete chord"
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <span className="material-icons text-gray-500 text-base leading-none">delete</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
