'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import api from '../../../lib/axios';
import useAuthStore from '../../../store/useAuthStore';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAuthStore();

  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data } = await api.post('/api/auth/login', form);
      setAuth(data.user, data.token);
      const redirect = searchParams.get('redirect') || '/dashboard';
      router.push(redirect);
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-bold text-white">
            WebinarApp
          </Link>
          <p className="text-gray-400 mt-1 text-sm">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-xl p-6 border border-gray-800 space-y-4">
          {error && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 text-sm px-3 py-2 rounded">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-300 mb-1">Email</label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              required
              className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded border border-gray-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">Password</label>
            <input
              type="password"
              name="password"
              value={form.password}
              onChange={handleChange}
              required
              className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded border border-gray-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold py-2.5 rounded transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-4">
          No account?{' '}
          <Link href="/auth/register" className="text-blue-400 hover:text-blue-300">
            Register
          </Link>
        </p>
      </div>
    </div>
  );
}
