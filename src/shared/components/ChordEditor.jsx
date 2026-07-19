/**
 * ChordEditor - timeline editing for the chord track (issue #93), the same
 * row treatment as lyrics. Time fields use the draft pattern from issue #69:
 * hard-controlling a formatted number input eats keystrokes.
 */

import { useState } from 'react';

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
          {list.length === 0 && (
            <div className="text-sm text-gray-500 dark:text-gray-400 py-2">
              No chord track. Chords are detected automatically when a song is created or first
              played.
              <button
                onClick={() => addAfter(-1)}
                className="ml-2 text-blue-600 dark:text-blue-400 hover:underline"
              >
                Add one manually
              </button>
            </div>
          )}
          {list.map((c, i) => (
            <div key={`chord-${i}`} className="flex items-center gap-2 py-0.5">
              <TimeField value={c.start} onCommit={(v) => update(i, { start: v })} />
              <span className="text-gray-400 text-xs">to</span>
              <TimeField value={c.end} onCommit={(v) => update(i, { end: v })} />
              <input
                type="text"
                className="w-[72px] px-2 py-1 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                value={c.chord}
                onChange={(e) => update(i, { chord: e.target.value })}
              />
              <button
                onClick={() => addAfter(i)}
                title="Add chord after"
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <span className="material-icons text-gray-500 text-base leading-none">add</span>
              </button>
              <button
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
