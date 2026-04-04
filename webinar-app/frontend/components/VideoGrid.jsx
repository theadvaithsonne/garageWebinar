'use client';

import { useEffect, useRef, useState } from 'react';
import useRoomStore from '../store/useRoomStore';
import useAuthStore from '../store/useAuthStore';

// ── Floating emoji reaction overlay ──────────────────────────────────────────
function ReactionOverlay() {
  const reactions = useRoomStore((s) => s.reactions);
  if (!reactions.length) return null;
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
      {reactions.map((r) => (
        <div
          key={r.id}
          className="absolute bottom-16 animate-float-up"
          style={{ left: `${10 + Math.random() * 60}%` }}
        >
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-3xl drop-shadow-lg leading-none">{r.emoji}</span>
            <span className="text-white text-xs bg-black/50 px-1.5 py-0.5 rounded-full whitespace-nowrap">{r.name}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Hidden audio player for remote peers ─────────────────────────────────────
function RemoteAudio({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current && stream) {
      ref.current.srcObject = stream;
      ref.current.play().catch(() => {});
    }
  }, [stream]);
  return <audio ref={ref} autoPlay playsInline style={{ display: 'none' }} />;
}

// ── Single video tile ─────────────────────────────────────────────────────────
function Tile({ stream, name, isLocal, small = false }) {
  const videoRef = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (stream) {
      video.srcObject = stream;
      const check = () => {
        const t = stream.getVideoTracks()[0];
        setHasVideo(!!t && t.readyState !== 'ended');
      };
      check();
      stream.addEventListener('addtrack', check);
      stream.addEventListener('removetrack', check);
      return () => {
        stream.removeEventListener('addtrack', check);
        stream.removeEventListener('removetrack', check);
      };
    } else {
      video.srcObject = null;
      setHasVideo(false);
    }
  }, [stream]);

  const initial = name?.[0]?.toUpperCase() || '?';

  return (
    <div className={`relative bg-gray-900 rounded-xl overflow-hidden flex items-center justify-center border border-gray-800 group ${small ? 'w-full h-full' : 'w-full h-full'}`}>
      {/* Avatar placeholder */}
      <div className={`absolute inset-0 flex flex-col items-center justify-center transition-opacity ${hasVideo ? 'opacity-0' : 'opacity-100'}`}>
        <div className={`rounded-full bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center font-bold text-white shadow-lg ${small ? 'w-8 h-8 text-sm' : 'w-14 h-14 text-xl'}`}>
          {initial}
        </div>
        {!small && <span className="text-gray-500 text-xs mt-2">Camera off</span>}
      </div>

      {/* Video */}
      <video
        ref={videoRef}
        autoPlay playsInline
        muted={isLocal}
        className={`w-full h-full object-cover transition-opacity ${hasVideo ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Label */}
      {!small && (
        <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
          <span className="text-white text-xs font-medium truncate block">{name}</span>
        </div>
      )}
      {small && (
        <div className="absolute bottom-1 left-1 right-1">
          <span className="text-white text-xs font-medium truncate block drop-shadow-lg text-center">{name?.split(' ')[0]}</span>
        </div>
      )}

      {isLocal && (
        <div className="absolute top-1.5 right-1.5 bg-blue-600/90 text-white text-xs px-1.5 py-0.5 rounded-full">
          You
        </div>
      )}
    </div>
  );
}

// ── Main VideoGrid ────────────────────────────────────────────────────────────
export default function VideoGrid({ pinnedSocketId }) {
  const { peers, localStream, screenStream, screenSharing } = useRoomStore();
  const { user } = useAuthStore();

  // Find active screen share (local or remote)
  const localScreenActive = screenSharing && screenStream;
  const remoteScreenPeer  = peers.find((p) => p.streams?.screen);
  const spotlightStream   = localScreenActive ? screenStream : remoteScreenPeer?.streams?.screen;
  const spotlightName     = localScreenActive ? 'Your Screen' : (remoteScreenPeer ? `${remoteScreenPeer.name}'s Screen` : null);
  const inSpotlight       = !!spotlightStream;

  // PiP cameras (shown when in spotlight mode)
  const pipTiles = [
    { key: 'local', stream: localStream, name: 'You', isLocal: true },
    ...peers
      .filter((p) => !p.streams?.screen || localScreenActive) // hide screen peer's camera if they're spotlighted
      .map((p) => ({ key: p.socketId, stream: p.streams?.video || null, name: p.name, isLocal: false })),
  ];

  // Grid tiles (shown when NOT in spotlight mode)
  const gridTiles = [
    { key: 'local-cam', stream: localStream, name: 'You (Camera)', isLocal: true },
    ...peers.map((p) => ({
      key: `${p.socketId}-video`,
      stream: p.streams?.video || null,
      name: p.name,
      isLocal: false,
    })),
  ];

  const count    = gridTiles.length;
  const gridCols = count === 1 ? 'grid-cols-1' : count === 2 ? 'grid-cols-2' : count <= 4 ? 'grid-cols-2' : count <= 9 ? 'grid-cols-3' : 'grid-cols-4';

  return (
    <>
      {/* Hidden audio players */}
      {peers.map((p) =>
        p.streams?.audio ? <RemoteAudio key={`audio-${p.socketId}`} stream={p.streams.audio} /> : null
      )}

      <div className="relative w-full h-full">
      <ReactionOverlay />

      {inSpotlight ? (
        /* ── SPOTLIGHT MODE ─── */
        <div className="relative w-full h-full bg-black">
          {/* Full-screen spotlight tile */}
          <Tile stream={spotlightStream} name={spotlightName} isLocal={localScreenActive} />

          {/* PiP strip — bottom right */}
          <div className="absolute bottom-4 right-4 flex flex-col gap-2 z-10">
            {pipTiles.map((t) => (
              <div key={t.key} className="w-36 h-24 rounded-xl overflow-hidden shadow-2xl border border-gray-700 ring-1 ring-black/50">
                <Tile stream={t.stream} name={t.name} isLocal={t.isLocal} small />
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ── GRID MODE ─── */
        <div className={`grid ${gridCols} gap-2 w-full h-full p-2 auto-rows-fr`}>
          {gridTiles.map((t) => (
            <Tile key={t.key} stream={t.stream} name={t.name} isLocal={t.isLocal} />
          ))}
        </div>
      )}
      </div>
    </>
  );
}
