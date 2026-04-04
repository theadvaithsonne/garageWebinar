'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Navbar from '../components/Navbar';
import useAuthStore from '../store/useAuthStore';

export default function HomePage() {
  const { token } = useAuthStore();
  const router    = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (token) router.replace('/dashboard');
  }, [token, router]);

  // Show spinner while checking auth
  if (!mounted) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // If logged in, redirect is in progress — show nothing
  if (token) return null;

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <Navbar />

      {/* Hero */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 text-center py-20">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 bg-blue-950/60 border border-blue-800 text-blue-300 text-xs px-3 py-1.5 rounded-full mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            100% Free & Open Source
          </div>

          <h1 className="text-5xl font-extrabold text-white mb-4 leading-tight tracking-tight">
            Host Professional{' '}
            <span className="bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Webinars
            </span>{' '}
            with No Limits
          </h1>
          <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto leading-relaxed">
            End-to-end WebRTC video, live chat, Q&A, polls, and recording — all self-hosted with zero vendor lock-in.
          </p>

          <div className="flex gap-4 justify-center">
            <Link href="/auth/register" className="bg-blue-600 hover:bg-blue-500 active:scale-95 text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-lg shadow-blue-500/25">
              Get Started Free
            </Link>
            <Link href="/auth/login" className="bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white font-semibold px-6 py-3 rounded-xl transition-colors">
              Sign In
            </Link>
          </div>
        </div>

        {/* Features */}
        <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-5 max-w-4xl w-full text-left">
          {[
            { icon: '🎥', title: 'HD Video & Audio',       desc: 'Powered by mediasoup WebRTC SFU — scalable, low-latency, no TURN server needed for LAN.' },
            { icon: '💬', title: 'Interactive Engagement',  desc: 'Live chat, Q&A with upvotes, real-time polls, raise hand, and participant controls.' },
            { icon: '⏺',  title: 'Server-side Recording',  desc: 'Record sessions as MP4 via FFmpeg + RTP piping. Download right from your dashboard.' },
            { icon: '🔒', title: 'Role-based Access',       desc: 'Host, Panelist, and Attendee roles. Promote attendees live, mute, or remove anyone.' },
            { icon: '🌐', title: 'Shareable Invite Links',  desc: 'One-click invite URLs. Attendees just need a browser — no app installs required.' },
            { icon: '🚀', title: 'Self-hosted & Private',   desc: 'Run on your own server. Your data never leaves your infrastructure.' },
          ].map((f) => (
            <div key={f.title} className="bg-gray-900 rounded-2xl p-5 border border-gray-800 hover:border-gray-700 transition-colors">
              <div className="text-3xl mb-3">{f.icon}</div>
              <h3 className="text-white font-semibold mb-1">{f.title}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="text-center text-gray-600 text-xs py-6 border-t border-gray-800">
        WebinarApp — Built with Next.js, mediasoup, Socket.io & MongoDB
      </footer>
    </div>
  );
}
