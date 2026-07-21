/**
 * Two-click confirmation without a dialog (issue #96). window.confirm() in an
 * Electron renderer is a native blocking dialog with a long-documented focus
 * desync: keyboard input can stay dead after it closes. It is also lousy UI.
 * First activation ARMS the control (caller renders a visible confirm state);
 * a second activation within the window fires the action; otherwise it
 * disarms itself.
 */
import { useEffect, useRef, useState } from 'react';

export function useArmedConfirm(disarmMs = 3000) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const fire = (action) => {
    if (armed) {
      clearTimeout(timer.current);
      setArmed(false);
      action();
      return true;
    }
    setArmed(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), disarmMs);
    return false;
  };

  return [armed, fire];
}
