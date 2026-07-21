/**
 * In-app confirmation modal (issue #96). window.confirm() in an Electron
 * renderer is a native blocking dialog with a long-documented focus desync
 * that can leave keyboard input dead after it closes - and it is lousy UI.
 * This is a promise-based drop-in: `if (await confirm('Sure?')) ...`.
 *
 * Usage:
 *   const [confirm, confirmModal] = useConfirm();
 *   ...
 *   if (!(await confirm('Delete this?', { confirmLabel: 'Delete' }))) return;
 *   ...
 *   return <>{...ui}{confirmModal}</>;
 */
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export function useConfirm() {
  const [pending, setPending] = useState(null); // { message, confirmLabel, resolve }

  const confirm = useCallback(
    (message, { confirmLabel = 'Confirm' } = {}) =>
      new Promise((resolve) => setPending({ message, confirmLabel, resolve })),
    []
  );

  const close = useCallback(
    (result) => {
      pending?.resolve(result);
      setPending(null);
    },
    [pending]
  );

  useEffect(() => {
    if (!pending) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [pending, close]);

  const modal = pending
    ? createPortal(
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50"
          onClick={() => close(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-xl p-5 max-w-sm w-[90%]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="m-0 mb-4 text-gray-900 dark:text-gray-100">{pending.message}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                onClick={() => close(false)}
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => close(true)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
              >
                {pending.confirmLabel}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return [confirm, modal];
}
