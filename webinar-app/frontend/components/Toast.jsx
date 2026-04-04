'use client';

import { useState, useEffect, useCallback } from 'react';
import { create } from 'zustand';

// Global toast store
export const useToastStore = create((set) => ({
  toasts: [],
  add: (toast) => {
    const id = Date.now().toString();
    set((s) => ({ toasts: [...s.toasts, { id, ...toast }] }));
    return id;
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

// Convenience helpers
export const toast = {
  success: (msg) => useToastStore.getState().add({ type: 'success', message: msg }),
  error:   (msg) => useToastStore.getState().add({ type: 'error',   message: msg }),
  info:    (msg) => useToastStore.getState().add({ type: 'info',    message: msg }),
  warn:    (msg) => useToastStore.getState().add({ type: 'warn',    message: msg }),
};

const ICONS = {
  success: '✅',
  error:   '❌',
  info:    'ℹ️',
  warn:    '⚠️',
};

const COLORS = {
  success: 'bg-green-900/90 border-green-600 text-green-100',
  error:   'bg-red-900/90   border-red-600   text-red-100',
  info:    'bg-blue-900/90  border-blue-600  text-blue-100',
  warn:    'bg-yellow-900/90 border-yellow-600 text-yellow-100',
};

function ToastItem({ id, type, message }) {
  const remove = useToastStore((s) => s.remove);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setTimeout(() => setVisible(true), 10);
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => remove(id), 300);
    }, 4000);
    return () => clearTimeout(t);
  }, [id, remove]);

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg text-sm transition-all duration-300 cursor-pointer max-w-sm ${COLORS[type]} ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
      onClick={() => remove(id)}
    >
      <span className="flex-shrink-0 text-base">{ICONS[type]}</span>
      <span className="flex-1 leading-snug">{message}</span>
    </div>
  );
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      <div className="pointer-events-auto flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} {...t} />
        ))}
      </div>
    </div>
  );
}
