'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Navbar from '../../components/Navbar';
import api from '../../lib/axios';
import useAuthStore from '../../store/useAuthStore';

export default function DashboardPage() {
  const { user, token } = useAuthStore();
  const router = useRouter();
  const [mounted,           setMounted]           = useState(false);
  const [webinars,          setWebinars]          = useState([]);
  const [loading,           setLoading]           = useState(true);
  const [error,             setError]             = useState('');
  const [copiedId,          setCopiedId]          = useState(null);
  const [copiedPanelistId,  setCopiedPanelistId]  = useState(null);

  // Auth guard — redirect if not logged in
  useEffect(() => {
    setMounted(true);
    if (!token) {
      router.replace('/auth/login');
    }
  }, [token, router]);

  const fetchWebinars = async () => {
    try {
      const { data } = await api.get('/api/webinars');
      const order = { live: 0, scheduled: 1, ended: 2 };
      data.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
      setWebinars(data);
    } catch {
      setError('Failed to load webinars');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (token) fetchWebinars();
  }, [token]);

  const deleteWebinar = async (id) => {
    if (!confirm('Delete this webinar?')) return;
    try {
      await api.delete(`/api/webinars/${id}`);
      setWebinars((prev) => prev.filter((w) => w._id !== id));
    } catch {
      alert('Failed to delete');
    }
  };

  const copyInviteLink = (id) => {
    const link = `${window.location.origin}/join/${id}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const copyPanelistLink = (webinar) => {
    if (!webinar.panelistLink) return;
    const link = `${window.location.origin}/room/${webinar._id}?role=panelist&pt=${webinar.panelistLink}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedPanelistId(webinar._id);
      setTimeout(() => setCopiedPanelistId(null), 2000);
    });
  };

  const statusColor = {
    scheduled: 'text-yellow-400 bg-yellow-900/30',
    live:      'text-green-400  bg-green-900/30',
    ended:     'text-gray-400   bg-gray-800',
  };

  // Don't render until mounted and authenticated
  if (!mounted || !token) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">My Webinars</h1>
            <p className="text-gray-400 text-sm mt-0.5">Welcome back, {user?.name || '...'}</p>
          </div>
          <Link href="/webinar/create" className="bg-blue-600 hover:bg-blue-500 text-white font-semibold px-4 py-2 rounded-lg transition-colors text-sm">
            + New Webinar
          </Link>
        </div>

        {loading && <p className="text-gray-400">Loading webinars...</p>}
        {error   && <p className="text-red-400">{error}</p>}

        {!loading && webinars.length === 0 && (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-12 text-center">
            <p className="text-gray-400 mb-4">No webinars yet</p>
            <Link href="/webinar/create" className="text-blue-400 hover:text-blue-300 text-sm">
              Create your first webinar
            </Link>
          </div>
        )}

        <div className="space-y-3">
          {webinars.map((w) => (
            <div key={w._id} className="bg-gray-900 rounded-xl border border-gray-800 p-5">
              <div className="flex items-start justify-between gap-4">
                {/* Left: info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h2 className="text-white font-semibold truncate">{w.title}</h2>
                    <span className={`text-xs px-2 py-0.5 rounded capitalize ${statusColor[w.status]}`}>
                      {w.status}
                    </span>
                  </div>
                  {w.description && (
                    <p className="text-gray-400 text-sm truncate mb-1">{w.description}</p>
                  )}
                  <p className="text-gray-500 text-xs">
                    {w.scheduledAt ? new Date(w.scheduledAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—'} · {w.participantCount ?? 0} participants
                  </p>

                  {/* Invite link row */}
                  <div className="mt-2 flex items-center gap-2 flex-wrap">
                    <span className="text-gray-600 text-xs font-mono truncate max-w-xs">
                      /join/{w._id}
                    </span>
                    <button
                      onClick={() => copyInviteLink(w._id)}
                      className="text-xs text-blue-400 hover:text-blue-300 bg-blue-900/20 hover:bg-blue-900/40 px-2 py-0.5 rounded transition-colors flex-shrink-0"
                    >
                      {copiedId === w._id ? '✅ Copied!' : '🔗 Copy Invite'}
                    </button>
                    {w.panelistLink && (
                      <button
                        onClick={() => copyPanelistLink(w)}
                        className="text-xs text-purple-400 hover:text-purple-300 bg-purple-900/20 hover:bg-purple-900/40 px-2 py-0.5 rounded transition-colors flex-shrink-0"
                      >
                        {copiedPanelistId === w._id ? '✅ Copied!' : '🎙️ Copy Panelist Link'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Right: actions */}
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                  {w.status !== 'ended' && (
                    <Link
                      href={`/room/${w._id}?role=host`}
                      className="bg-green-700 hover:bg-green-600 text-white text-xs px-3 py-1.5 rounded transition-colors"
                    >
                      {w.status === 'live' ? 'Rejoin' : 'Start'}
                    </Link>
                  )}

                  {w.recordingFile && (
                    <a
                      href={`${process.env.NEXT_PUBLIC_API_URL}/recordings/${w.recordingFile}`}
                      download
                      className="bg-purple-700 hover:bg-purple-600 text-white text-xs px-3 py-1.5 rounded transition-colors"
                    >
                      ⏬ Download Recording
                    </a>
                  )}

                  <button
                    onClick={() => deleteWebinar(w._id)}
                    className="text-red-400 hover:text-red-300 text-xs px-2 py-1.5 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
