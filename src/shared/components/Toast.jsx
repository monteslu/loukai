import { useEffect } from 'react';

export function Toast({ message, type = 'info', onClose, duration = 3000 }) {
  useEffect(() => {
    if (duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [duration, onClose]);

  const typeStyles = {
    success: 'bg-green-600 border-green-500',
    error: 'bg-red-600 border-red-500',
    info: 'bg-blue-600 border-blue-500',
  };

  const iconName = type === 'success' ? 'check_circle' : type === 'error' ? 'error' : 'info';

  return (
    <div
      className={`fixed top-4 right-4 z-50 ${typeStyles[type]} border-l-4 rounded-lg shadow-lg px-6 py-4 cursor-pointer transition-opacity hover:opacity-90`}
      onClick={onClose}
    >
      <div className="flex items-center gap-3 text-white">
        <span className="material-icons text-2xl">{iconName}</span>
        <span className="font-medium">{message}</span>
      </div>
    </div>
  );
}
