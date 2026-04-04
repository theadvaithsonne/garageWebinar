'use client';

import { useEffect, useRef, useState } from 'react';

export default function VideoTile({ stream, name, isLocal = false }) {
  const videoRef = useRef(null);
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream) {
      video.srcObject = stream;
      const vt = stream.getVideoTracks()[0];
      setHasVideo(!!vt && vt.enabled && vt.readyState !== 'ended');

      // Track state changes
      const onTrackChange = () => {
        const t = stream.getVideoTracks()[0];
        setHasVideo(!!t && t.enabled && t.readyState !== 'ended');
      };
      stream.addEventListener('addtrack',    onTrackChange);
      stream.addEventListener('removetrack', onTrackChange);
      return () => {
        stream.removeEventListener('addtrack',    onTrackChange);
        stream.removeEventListener('removetrack', onTrackChange);
      };
    } else {
      video.srcObject = null;
      setHasVideo(false);
    }
  }, [stream]);

  const initial = name?.[0]?.toUpperCase() || '?';

  return (
    <div className="relative bg-gray-900 rounded-xl overflow-hidden flex items-center justify-center border border-gray-800 group">
      {/* Placeholder when no video */}
      <div className={`absolute inset-0 flex flex-col items-center justify-center transition-opacity ${hasVideo ? 'opacity-0' : 'opacity-100'}`}>
        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-gray-600 to-gray-700 flex items-center justify-center text-xl font-bold text-white shadow-lg">
          {initial}
        </div>
        <span className="text-gray-500 text-xs mt-2">Camera off</span>
      </div>

      {/* Video element */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={`w-full h-full object-cover transition-opacity ${hasVideo ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Name label */}
      <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/70 to-transparent">
        <span className="text-white text-xs font-medium truncate block">{name}</span>
      </div>

      {/* Local indicator */}
      {isLocal && (
        <div className="absolute top-2 right-2 bg-blue-600/80 text-white text-xs px-1.5 py-0.5 rounded-full">
          You
        </div>
      )}
    </div>
  );
}
