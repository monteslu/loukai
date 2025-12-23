/**
 * LyricLine - Individual lyric line editor component
 *
 * Features:
 * - Editable timing (start/end) with < > adjustment buttons
 * - Editable text
 * - Enable/disable toggle
 * - Singer assignment dropdown
 * - Delete button
 * - Add line after button
 * - Click line number to play that section
 *
 * Keyboard shortcuts (when not in text input):
 * - d/f: Adjust start time (-/+0.1s, shift for 0.5s)
 * - j/k: Adjust end time (-/+0.1s, shift for 0.5s)
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PortalSelect } from './PortalSelect.jsx';

// Singer options for the dropdown
const SINGER_OPTIONS = [
  { value: '', label: 'Lead' },
  { value: 'B', label: 'Singer B' },
  { value: 'duet', label: 'Duet' },
  { value: 'backup', label: 'Backup' },
  { value: 'backup:PA', label: 'Backup PA 🔊' },
];

// Small/large increment values in seconds
const SMALL_INCREMENT = 0.1;
const LARGE_INCREMENT = 0.5;

// Hold-to-repeat delay and interval in milliseconds
const REPEAT_DELAY = 400;
const REPEAT_INTERVAL = 80;

/**
 * PortalTooltip - Tooltip that renders via portal for consistent positioning
 */
function PortalTooltip({ text, targetRect, visible }) {
  if (!visible || !targetRect) return null;

  // Position tooltip above the button, centered
  const style = {
    position: 'fixed',
    left: targetRect.left + targetRect.width / 2,
    top: targetRect.top - 4,
    transform: 'translate(-50%, -100%)',
    zIndex: 10000,
  };

  return createPortal(
    <div
      style={style}
      className="px-2 py-1 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded shadow-lg whitespace-nowrap pointer-events-none"
    >
      {text}
      {/* Arrow pointing down */}
      <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-900 dark:border-t-gray-700" />
    </div>,
    document.body
  );
}

/**
 * TimeAdjustButton - Button for adjusting time values with hold-to-repeat
 */
function TimeAdjustButton({ direction, onAdjust, tooltip, isStart }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipRect, setTooltipRect] = useState(null);
  const buttonRef = useRef(null);
  const intervalRef = useRef(null);
  const timeoutRef = useRef(null);
  const tooltipTimeoutRef = useRef(null);

  const doAdjust = useCallback(
    (e) => {
      const delta = direction === 'decrease' ? -1 : 1;
      const increment = e.shiftKey ? LARGE_INCREMENT : SMALL_INCREMENT;
      onAdjust(delta * increment);
    },
    [direction, onAdjust]
  );

  const startRepeat = useCallback(
    (e) => {
      // Prevent text selection during hold
      e.preventDefault();
      // Hide tooltip during adjustment
      setShowTooltip(false);
      // Do first adjustment immediately
      doAdjust(e);

      // Start repeating after delay
      timeoutRef.current = setTimeout(() => {
        intervalRef.current = setInterval(() => {
          // Use small increment for repeat (shift state may have changed)
          const delta = direction === 'decrease' ? -1 : 1;
          onAdjust(delta * SMALL_INCREMENT);
        }, REPEAT_INTERVAL);
      }, REPEAT_DELAY);
    },
    [direction, onAdjust, doAdjust]
  );

  const stopRepeat = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const handleMouseEnter = useCallback(() => {
    // Delay tooltip show slightly to avoid flicker
    tooltipTimeoutRef.current = setTimeout(() => {
      if (buttonRef.current) {
        setTooltipRect(buttonRef.current.getBoundingClientRect());
        setShowTooltip(true);
      }
    }, 400);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    setShowTooltip(false);
    stopRepeat();
  }, [stopRepeat]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const symbol = direction === 'decrease' ? '‹' : '›';
  const shortcutKey = isStart
    ? direction === 'decrease'
      ? 'd'
      : 'f'
    : direction === 'decrease'
      ? 'j'
      : 'k';

  const tooltipText = `${tooltip} (${shortcutKey}, shift for ±0.5s)`;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="w-6 h-7 flex items-center justify-center bg-gray-200 dark:bg-gray-600 hover:bg-blue-500 hover:text-white dark:hover:bg-blue-500 border border-gray-300 dark:border-gray-500 rounded text-gray-700 dark:text-gray-200 font-bold text-base cursor-pointer transition-colors select-none"
        onMouseDown={startRepeat}
        onMouseUp={stopRepeat}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={(e) => e.stopPropagation()}
      >
        {symbol}
      </button>
      <PortalTooltip text={tooltipText} targetRect={tooltipRect} visible={showTooltip} />
    </>
  );
}

/**
 * IconButton - Button with icon and portal tooltip
 * Wraps button in span to ensure tooltip works even when disabled
 */
function IconButton({ icon, tooltip, onClick, className, disabled = false }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipRect, setTooltipRect] = useState(null);
  const wrapperRef = useRef(null);
  const tooltipTimeoutRef = useRef(null);

  const handleMouseEnter = useCallback(() => {
    tooltipTimeoutRef.current = setTimeout(() => {
      if (wrapperRef.current) {
        setTooltipRect(wrapperRef.current.getBoundingClientRect());
        setShowTooltip(true);
      }
    }, 400);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    setShowTooltip(false);
  }, []);

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    };
  }, []);

  return (
    <>
      <span
        ref={wrapperRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="inline-flex"
      >
        <button type="button" className={className} disabled={disabled} onClick={onClick}>
          <span className="material-icons text-base">{icon}</span>
        </button>
      </span>
      <PortalTooltip text={tooltip} targetRect={tooltipRect} visible={showTooltip} />
    </>
  );
}

/**
 * LineNumberButton - Clickable line number with play functionality and tooltip
 */
function LineNumberButton({ index, onClick }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipRect, setTooltipRect] = useState(null);
  const buttonRef = useRef(null);
  const tooltipTimeoutRef = useRef(null);

  const handleMouseEnter = useCallback(() => {
    tooltipTimeoutRef.current = setTimeout(() => {
      if (buttonRef.current) {
        setTooltipRect(buttonRef.current.getBoundingClientRect());
        setShowTooltip(true);
      }
    }, 400);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (tooltipTimeoutRef.current) {
      clearTimeout(tooltipTimeoutRef.current);
      tooltipTimeoutRef.current = null;
    }
    setShowTooltip(false);
  }, []);

  useEffect(() => {
    return () => {
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current);
    };
  }, []);

  const tooltipText = `Play line ${index + 1} (p)`;

  return (
    <>
      <span
        ref={buttonRef}
        className="flex items-center justify-center min-w-[36px] h-9 bg-gray-200 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-sm font-semibold text-gray-700 dark:text-gray-200 cursor-pointer transition-all flex-shrink-0 hover:bg-blue-600 hover:text-white dark:hover:bg-blue-500"
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {index + 1}
      </span>
      <PortalTooltip text={tooltipText} targetRect={tooltipRect} visible={showTooltip} />
    </>
  );
}

export function LyricLine({
  line,
  index,
  isSelected,
  onSelect,
  onUpdate,
  onDelete,
  onAddAfter,
  onSplit,
  onPlaySection,
  onAdjustStartTime,
  onAdjustEndTime,
  canAddAfter,
  canSplit,
  hasOverlap = false,
}) {
  const startTime = line.start || line.startTimeSec || 0;
  const endTime = line.end || line.endTimeSec || startTime + 3;
  const text = line.text || '';
  const disabled = line.disabled === true;
  // Support new singer field, with backward compatibility for legacy backup boolean
  const singer = line.singer || (line.backup === true ? 'backup' : '');
  const isBackup = singer?.startsWith('backup') || false;

  const handleStartTimeChange = (e) => {
    const value = parseFloat(e.target.value) || 0;
    onUpdate(index, { ...line, start: value, startTimeSec: value });
  };

  const handleEndTimeChange = (e) => {
    const value = parseFloat(e.target.value) || 0;
    onUpdate(index, { ...line, end: value, endTimeSec: value });
  };

  const handleTextChange = (e) => {
    onUpdate(index, { ...line, text: e.target.value });
  };

  const handleSingerChange = (e) => {
    const newSinger = e.target.value || undefined;
    // Remove legacy backup field when using new singer field
    const { backup: _backup, ...lineWithoutBackup } = line;
    onSelect(index); // Select this line to ensure immediate visual update
    onUpdate(index, { ...lineWithoutBackup, singer: newSinger });
  };

  const handleToggleDisabled = () => {
    onUpdate(index, { ...line, disabled: !disabled });
  };

  const handleLineNumberClick = (e) => {
    e.stopPropagation();
    onSelect(index); // Select the line
    onPlaySection(startTime, endTime); // And play it
  };

  // Build container classes with proper precedence
  let containerClasses =
    'lyric-line-editor flex items-center gap-2.5 mb-2.5 p-2 border-2 rounded transition-all cursor-pointer';

  // Conditional states - backup background takes priority, selection adds border
  if (isBackup) {
    // Backup lines always show yellow background
    containerClasses += ' bg-yellow-50 dark:bg-yellow-900/20';
    containerClasses += isSelected
      ? ' border-blue-500 dark:border-blue-400'
      : ' border-yellow-400 dark:border-yellow-600';
  } else if (isSelected) {
    containerClasses += ' border-blue-500 bg-blue-100 dark:border-blue-400 dark:bg-blue-900/40';
  } else if (disabled) {
    containerClasses +=
      ' opacity-50 bg-gray-100 dark:bg-gray-900 border-gray-300 dark:border-gray-600';
  } else {
    // Default state
    containerClasses +=
      ' bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-750 hover:border-gray-400 dark:hover:border-gray-500';
  }

  return (
    <div
      className={containerClasses}
      data-index={index}
      data-start-time={startTime}
      data-end-time={endTime}
      onClick={() => onSelect(index)}
    >
      <LineNumberButton index={index} onClick={handleLineNumberClick} />

      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Start time with adjustment buttons */}
        <TimeAdjustButton
          direction="decrease"
          onAdjust={onAdjustStartTime}
          tooltip="Earlier"
          isStart={true}
        />
        <input
          type="number"
          className={`w-[58px] px-1 py-1.5 bg-gray-100 dark:bg-gray-700 rounded text-gray-900 dark:text-white text-xs text-center font-mono focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
            hasOverlap
              ? 'border-2 border-red-500 dark:border-red-400 focus:border-red-600 dark:focus:border-red-300'
              : 'border border-gray-300 dark:border-gray-600 focus:border-blue-500 dark:focus:border-blue-400'
          }`}
          value={startTime.toFixed(1)}
          onChange={handleStartTimeChange}
          step="0.1"
          min="0"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(index);
          }}
          title={
            hasOverlap
              ? 'Warning: This line overlaps with the previous line for the same singer'
              : 'Start time (d/f to adjust)'
          }
        />
        <TimeAdjustButton
          direction="increase"
          onAdjust={onAdjustStartTime}
          tooltip="Later"
          isStart={true}
        />

        <span className="text-gray-500 dark:text-gray-400 font-semibold mx-0.5">—</span>

        {/* End time with adjustment buttons */}
        <TimeAdjustButton
          direction="decrease"
          onAdjust={onAdjustEndTime}
          tooltip="Earlier"
          isStart={false}
        />
        <input
          type="number"
          className="w-[58px] px-1 py-1.5 bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white text-xs text-center font-mono focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          value={endTime.toFixed(1)}
          onChange={handleEndTimeChange}
          step="0.1"
          min="0"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(index);
          }}
          title="End time (j/k to adjust)"
        />
        <TimeAdjustButton
          direction="increase"
          onAdjust={onAdjustEndTime}
          tooltip="Later"
          isStart={false}
        />
      </div>

      <input
        type="text"
        className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:focus:ring-blue-400 dark:focus:border-blue-400"
        value={text}
        onChange={handleTextChange}
        placeholder="Enter lyrics..."
        onClick={(e) => {
          e.stopPropagation();
          onSelect(index);
        }}
        disabled={disabled}
      />

      <div
        className="flex items-center gap-1 flex-shrink-0 w-28"
        onClick={(e) => {
          e.stopPropagation();
          onSelect(index);
        }}
      >
        <PortalSelect
          value={singer}
          onChange={handleSingerChange}
          options={SINGER_OPTIONS}
          className="text-xs py-1 px-2"
        />
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        <IconButton
          icon={!disabled ? 'visibility' : 'visibility_off'}
          tooltip={!disabled ? 'Disable line' : 'Enable line'}
          className={`w-8 h-8 p-0 flex items-center justify-center border border-gray-300 dark:border-gray-600 rounded cursor-pointer transition-all ${!disabled ? 'bg-gray-200 dark:bg-gray-700 text-green-600 dark:text-green-400 hover:bg-gray-300 dark:hover:bg-gray-600' : 'bg-gray-200 dark:bg-gray-700 text-red-600 dark:text-red-400 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
          onClick={(e) => {
            e.stopPropagation();
            handleToggleDisabled();
          }}
        />
        <IconButton
          icon="delete"
          tooltip="Delete line"
          className="w-8 h-8 p-0 flex items-center justify-center border border-gray-300 dark:border-gray-600 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded cursor-pointer transition-all hover:bg-red-600 hover:border-red-600 hover:text-white dark:hover:bg-red-500 dark:hover:border-red-500"
          onClick={(e) => {
            e.stopPropagation();
            if (confirm('Delete this lyric line?')) {
              onDelete(index);
            }
          }}
        />
        <IconButton
          icon="call_split"
          tooltip={canSplit ? 'Split at punctuation' : 'No punctuation to split on'}
          className={`w-8 h-8 p-0 flex items-center justify-center border rounded cursor-pointer transition-all ${canSplit ? 'border-gray-300 dark:border-gray-600 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-blue-600 hover:border-blue-600 hover:text-white dark:hover:bg-blue-500 dark:hover:border-blue-500' : 'opacity-30 cursor-not-allowed border-gray-300 dark:border-gray-600 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
          disabled={!canSplit}
          onClick={(e) => {
            e.stopPropagation();
            if (canSplit) {
              onSplit(index);
            }
          }}
        />
        <IconButton
          icon="add"
          tooltip={canAddAfter ? 'Add line after' : 'No room (need 0.6s gap)'}
          className={`w-8 h-8 p-0 flex items-center justify-center border rounded cursor-pointer transition-all ${canAddAfter ? 'border-gray-300 dark:border-gray-600 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-green-600 hover:border-green-600 hover:text-white dark:hover:bg-green-500 dark:hover:border-green-500' : 'opacity-30 cursor-not-allowed border-gray-300 dark:border-gray-600 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
          disabled={!canAddAfter}
          onClick={(e) => {
            e.stopPropagation();
            onAddAfter(index);
          }}
        />
      </div>
    </div>
  );
}
