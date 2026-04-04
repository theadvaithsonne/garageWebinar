'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useAuthStore from '../store/useAuthStore';

export default function Navbar() {
  const { user, clearAuth } = useAuthStore();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const handleLogout = () => {
    clearAuth();
    router.push('/auth/login');
  };

  return (
    <nav className="bg-gray-900 border-b border-gray-700 px-6 py-3 flex items-center justify-between">
      <Link href="/" className="text-white font-bold text-xl tracking-tight">
        WebinarApp
      </Link>

      <div className="flex items-center gap-4">
        {mounted && user ? (
          <>
            <span className="text-gray-300 text-sm">{user.name}</span>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded capitalize">
              {user.role}
            </span>
            {user.role === 'host' && (
              <Link
                href="/dashboard"
                className="text-gray-300 hover:text-white text-sm transition-colors"
              >
                Dashboard
              </Link>
            )}
            <button
              onClick={handleLogout}
              className="text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              Logout
            </button>
          </>
        ) : mounted ? (
          <>
            <Link href="/auth/login" className="text-gray-300 hover:text-white text-sm">
              Login
            </Link>
            <Link
              href="/auth/register"
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm px-4 py-1.5 rounded transition-colors"
            >
              Register
            </Link>
          </>
        ) : null}
      </div>
    </nav>
  );
}
