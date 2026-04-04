'use client';

import { create } from 'zustand';

function loadFromStorage() {
  if (typeof window === 'undefined') return { user: null, token: null };
  try {
    const token = localStorage.getItem('auth_token');
    const user = JSON.parse(localStorage.getItem('auth_user') || 'null');
    return { user, token };
  } catch {
    return { user: null, token: null };
  }
}

const useAuthStore = create((set) => ({
  ...loadFromStorage(),

  setAuth: (user, token) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('auth_token', token);
      localStorage.setItem('auth_user', JSON.stringify(user));
      // Also set cookie for Next.js middleware
      document.cookie = `auth_token=${token}; path=/; max-age=${7 * 24 * 60 * 60}`;
    }
    set({ user, token });
  },

  clearAuth: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('auth_user');
      document.cookie = 'auth_token=; path=/; max-age=0';
    }
    set({ user: null, token: null });
  },
}));

export default useAuthStore;
