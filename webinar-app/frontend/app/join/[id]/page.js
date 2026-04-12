'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import api from '../../../lib/axios';
import useAuthStore from '../../../store/useAuthStore';

export default function JoinPage() {
  const { id: webinarId } = useParams();
  const router = useRouter();
  const { user, token } = useAuthStore();

  const [webinar, setWebinar]     = useState(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [guestName, setGuestName] = useState('');

  useEffect(() => {
    if (!webinarId) return;
    api.get(`/api/webinars/${webinarId}`)
      .then(({ data }) => setWebinar(data))
      .catch((err) => {
        if (err.response?.status === 404) setError('Webinar not found');
        else setError('Unable to load webinar. Please try again.');
      })
      .finally(() => setLoading(false));
  }, [webinarId]);

  const handleJoin = () => {
    // Authenticated user — join directly
    if (token) {
      router.push(`/room/${webinarId}?role=attendee`);
      return;
    }
    // Guest user — join with name
    if (guestName.trim()) {
      router.push(`/room/${webinarId}?role=attendee&guest=true&name=${encodeURIComponent(guestName.trim())}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Loading webinar...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">😕</div>
          <p className="text-red-400 text-lg font-semibold">{error}</p>
          <Link href="/" className="text-blue-400 hover:text-blue-300 text-sm mt-3 block">
            Go home
          </Link>
        </div>
      </div>
    );
  }

  if (!webinar) return null;

  const isEnded = webinar.status === 'ended';
  const isLive  = webinar.status === 'live';

  const statusBadge = {
    live:      'bg-green-900/40 text-green-400 border border-green-700',
    scheduled: 'bg-yellow-900/40 text-yellow-400 border border-yellow-700',
    ended:     'bg-gray-800 text-gray-400 border border-gray-700',
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden shadow-2xl">
          {/* Top banner */}
          <div className={`h-2 w-full ${isLive ? 'bg-green-500' : isEnded ? 'bg-gray-600' : 'bg-blue-500'}`} />

          <div className="p-8 text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-5
              bg-gradient-to-br from-blue-600 to-purple-600">
              🎥
            </div>

            <h1 className="text-xl font-bold text-white mb-1">{webinar.title}</h1>
            {webinar.description && (
              <p className="text-gray-400 text-sm mb-4 leading-relaxed">{webinar.description}</p>
            )}

            <div className="flex items-center justify-center gap-3 mb-6">
              <span className={`text-xs px-2.5 py-1 rounded-full capitalize font-medium ${statusBadge[webinar.status]}`}>
                {isLive ? '● LIVE NOW' : webinar.status}
              </span>
              <span className="text-gray-500 text-xs">
                {new Date(webinar.scheduledAt).toLocaleString([], {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>

            {isEnded ? (
              <div className="bg-gray-800 rounded-xl p-4">
                <p className="text-gray-400 text-sm">This webinar has ended.</p>
              </div>
            ) : user ? (
              /* Logged-in user — join directly */
              <button
                onClick={handleJoin}
                className="w-full bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold py-3 rounded-xl transition-all"
              >
                {isLive ? '🔴 Join Live Now' : 'Join Webinar'}
              </button>
            ) : (
              /* Guest — just enter a name */
              <div className="space-y-3">
                <input
                  type="text"
                  placeholder="Enter your name"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                  maxLength={50}
                  className="w-full bg-gray-800 border border-gray-700 text-white text-center rounded-xl py-3 px-4 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-gray-500"
                  autoFocus
                />
                <button
                  onClick={handleJoin}
                  disabled={!guestName.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold py-3 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                >
                  {isLive ? '🔴 Join Live Now' : 'Join Webinar'}
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-gray-600 text-xs mt-4">
          Powered by <span className="text-gray-500">WebinarApp</span>
        </p>
      </div>
    </div>
  );
}
