'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Navbar from '../../../components/Navbar';
import api from '../../../lib/axios';

export default function CreateWebinarPage() {
  const router = useRouter();
  // minDate recomputed each render to always reflect "now"
  const getMinDate = () => new Date().toISOString().slice(0, 16);
  const [form, setForm] = useState({
    title: '',
    description: '',
    scheduledAt: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!form.title || !form.scheduledAt) {
      return setError('Title and scheduled date are required');
    }

    setLoading(true);
    try {
      await api.post('/api/webinars', form);
      router.push('/dashboard');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create webinar');
    } finally {
      setLoading(false);
    }
  };

  const minDate = getMinDate();

  return (
    <div className="min-h-screen bg-gray-950">
      <Navbar />

      <main className="max-w-lg mx-auto px-6 py-8">
        <div className="mb-6">
          <Link href="/dashboard" className="text-gray-400 hover:text-gray-300 text-sm">
            ← Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-white mt-2">Create Webinar</h1>
        </div>

        <form onSubmit={handleSubmit} className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
          {error && (
            <div className="bg-red-900/40 border border-red-700 text-red-300 text-sm px-3 py-2 rounded">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm text-gray-300 mb-1.5">Title *</label>
            <input
              type="text"
              name="title"
              value={form.title}
              onChange={handleChange}
              required
              placeholder="e.g. Introduction to WebRTC"
              className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded border border-gray-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-gray-500"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1.5">Description</label>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              rows={3}
              placeholder="What is this webinar about?"
              className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded border border-gray-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-gray-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1.5">Scheduled Date & Time *</label>
            <input
              type="datetime-local"
              name="scheduledAt"
              value={form.scheduledAt}
              onChange={handleChange}
              min={minDate}
              required
              className="w-full bg-gray-800 text-white text-sm px-3 py-2.5 rounded border border-gray-700 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 [color-scheme:dark]"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <Link
              href="/dashboard"
              className="flex-1 text-center bg-gray-800 hover:bg-gray-700 text-white text-sm py-2.5 rounded transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white font-semibold text-sm py-2.5 rounded transition-colors"
            >
              {loading ? 'Creating...' : 'Create Webinar'}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
