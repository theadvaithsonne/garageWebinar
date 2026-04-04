'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import useRoomStore from '../store/useRoomStore';
import { disconnectSocket } from '../lib/socket';
import { toast } from './Toast';

// ── Mic level VU meter ────────────────────────────────────────────────────────
function MicLevelMeter() {
  const localStream  = useRoomStore((s) => s.localStream);
  const micEnabled   = useRoomStore((s) => s.micEnabled);
  const [level, setLevel] = useState(0);
  const rafRef  = useRef(null);
  const ctxRef  = useRef(null);
  const analyserRef = useRef(null);

  useEffect(() => {
    if (!localStream || !micEnabled) {
      setLevel(0);
      return;
    }

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    ctxRef.current  = audioCtx;
    const analyser  = audioCtx.createAnalyser();
    analyserRef.current = analyser;
    analyser.fftSize = 256;

    const source = audioCtx.createMediaStreamSource(localStream);
    source.connect(analyser);

    const dataArr = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(dataArr);
      const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length;
      setLevel(Math.min(100, (avg / 128) * 100));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      try { audioCtx.close(); } catch {}
    };
  }, [localStream, micEnabled]);

  if (!localStream || !micEnabled) return null;

  const bars = 5;
  return (
    <div className="flex items-end gap-0.5 h-5 ml-1">
      {Array.from({ length: bars }).map((_, i) => {
        const threshold = ((i + 1) / bars) * 100;
        const active    = level >= threshold;
        return (
          <div
            key={i}
            className={`w-1 rounded-sm transition-all duration-75 ${active ? 'bg-green-400' : 'bg-gray-600'}`}
            style={{ height: `${40 + i * 15}%` }}
          />
        );
      })}
    </div>
  );
}

const REACTION_EMOJIS = ['👍','❤️','😂','😮','👏','🔥','🎉','💯'];

export default function ControlBar({ socket, webinarId, onToggleMic, onToggleCam, onShareScreen, onStartMedia, mediaStarted }) {
  const router = useRouter();
  const role          = useRoomStore((s) => s.role);
  const micEnabled    = useRoomStore((s) => s.micEnabled);
  const camEnabled    = useRoomStore((s) => s.camEnabled);
  const screenSharing = useRoomStore((s) => s.screenSharing);
  const isRecording   = useRoomStore((s) => s.isRecording);

  const [elapsed,       setElapsed]       = useState(0);
  const [showReactions, setShowReactions] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (isRecording) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((t) => t + 1), 1000);
    } else {
      clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => clearInterval(timerRef.current);
  }, [isRecording]);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;

  const isPresenter = role === 'host' || role === 'panelist';

  const handleLeave = () => { disconnectSocket(); router.push('/dashboard'); };

  const handleEndWebinar = () => {
    if (!confirm('End the webinar for everyone?')) return;
    socket?.emit('endWebinar', { webinarId }, (res) => {
      if (!res?.success) toast.error('Could not end webinar: ' + res?.error);
    });
  };

  const handleRaiseHand = () => socket?.emit('raiseHand', { webinarId });

  const sendReaction = (emoji) => {
    socket?.emit('sendReaction', { webinarId, emoji });
    setShowReactions(false);
  };

  const mediaRecorderRef = useRef(null);
  const chunksRef        = useRef([]);
  const captureStreamRef = useRef(null);

  const handleStartRecording = async () => {
    try {
      // Capture the entire browser tab — everything visible:
      // screen share, all participant videos, chat, UI
      const tabStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30, displaySurface: 'browser' },
        audio: true,                    // captures tab audio (all remote audio)
        preferCurrentTab: true,         // Chrome: auto-selects this tab
        selfBrowserSurface: 'include',
      });
      captureStreamRef.current = tabStream;

      // Also mix in the host's microphone (not captured by tab audio)
      const localStream = useRoomStore.getState().localStream;
      let finalStream   = tabStream;
      try {
        if (localStream?.getAudioTracks().length > 0) {
          const ctx  = new AudioContext();
          const dest = ctx.createMediaStreamDestination();
          // Tab audio (remote participants)
          tabStream.getAudioTracks().forEach((t) =>
            ctx.createMediaStreamSource(new MediaStream([t])).connect(dest));
          // Host mic
          localStream.getAudioTracks().forEach((t) =>
            ctx.createMediaStreamSource(new MediaStream([t])).connect(dest));
          finalStream = new MediaStream([
            ...tabStream.getVideoTracks(),
            ...dest.stream.getAudioTracks(),
          ]);
        }
      } catch {}

      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
        .find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';

      const recorder = new MediaRecorder(finalStream, { mimeType, videoBitsPerSecond: 3000000 });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.start(1000);
      mediaRecorderRef.current = recorder;

      // Auto-stop if user ends tab capture manually
      tabStream.getVideoTracks()[0].onended = () => {
        if (mediaRecorderRef.current?.state === 'recording') handleStopRecording();
      };

      socket?.emit('startRecording', { webinarId }, (res) => {
        if (!res?.success) toast.error('Recording failed: ' + (res?.error || ''));
      });
    } catch (err) {
      if (err.name !== 'NotAllowedError') toast.error('Recording error: ' + err.message);
    }
  };

  const handleStopRecording = async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;

    socket?.emit('stopRecording', { webinarId }, () => {});

    captureStreamRef.current?.getTracks().forEach((t) => t.stop());
    captureStreamRef.current = null;

    recorder.stop();
    await new Promise((r) => { recorder.onstop = r; });

    const blob = new Blob(chunksRef.current, { type: 'video/webm' });
    chunksRef.current        = [];
    mediaRecorderRef.current = null;

    if (blob.size === 0) return toast.error('Recording was empty');

    toast.info('Uploading & converting to MP4...');
    try {
      const token = localStorage.getItem('auth_token');
      const form  = new FormData();
      form.append('recording', blob, 'recording.webm');
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/webinars/${webinarId}/recording`,
        { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }
      );
      if (!res.ok) throw new Error(await res.text());
      toast.success('Recording saved! Download from dashboard.');
    } catch (err) {
      // Fallback: download WebM directly
      const url = URL.createObjectURL(blob);
      const a   = Object.assign(document.createElement('a'), { href: url, download: `recording-${Date.now()}.webm` });
      a.click();
      URL.revokeObjectURL(url);
      toast.warn('Upload failed — saved locally as .webm');
    }
  };

  return (
    <div className="h-16 bg-gray-900 border-t border-gray-700 flex items-center px-6 gap-2 flex-shrink-0">

      {/* Presenter controls */}
      {isPresenter && (
        !mediaStarted ? (
          <button onClick={onStartMedia} className="bg-blue-600 hover:bg-blue-500 active:scale-95 text-white text-sm px-4 py-2 rounded-full transition-all">
            Join with Camera
          </button>
        ) : (
          <>
            <div className="flex items-center">
              <CtrlBtn onClick={onToggleMic} active={micEnabled}
                icon={micEnabled ? '🎙️' : '🔇'} label={micEnabled ? 'Mic On' : 'Mic Off'}
                activeClass="bg-gray-700 hover:bg-gray-600" inactiveClass="bg-red-800 hover:bg-red-700" />
              <MicLevelMeter />
            </div>
            <CtrlBtn onClick={onToggleCam} active={camEnabled}
              icon={camEnabled ? '📹' : '📷'} label={camEnabled ? 'Cam On' : 'Cam Off'}
              activeClass="bg-gray-700 hover:bg-gray-600" inactiveClass="bg-red-800 hover:bg-red-700" />
            <CtrlBtn onClick={onShareScreen} active={screenSharing}
              icon="🖥️" label={screenSharing ? 'Stop Share' : 'Share Screen'}
              activeClass="bg-green-700 hover:bg-green-600" inactiveClass="bg-gray-700 hover:bg-gray-600" />
          </>
        )
      )}

      {/* Attendee controls */}
      {role === 'attendee' && (
        <button onClick={handleRaiseHand} className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-4 py-2 rounded-full transition-colors">
          ✋ Raise Hand
        </button>
      )}

      {/* Emoji reactions — everyone */}
      <div className="relative">
        <button
          onClick={() => setShowReactions((v) => !v)}
          className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-3 py-2 rounded-full transition-colors"
        >
          😊
        </button>
        {showReactions && (
          <div className="absolute bottom-12 left-0 bg-gray-800 border border-gray-700 rounded-xl p-2 flex gap-1.5 shadow-2xl z-50">
            {REACTION_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => sendReaction(e)}
                className="text-xl hover:scale-125 transition-transform leading-none p-1"
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Recording — host only */}
      {role === 'host' && (
        isRecording ? (
          <button onClick={handleStopRecording}
            className="flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-2 rounded-full transition-colors">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="font-mono text-red-400 tabular-nums">{fmt(elapsed)}</span>
            <span>Stop Rec</span>
          </button>
        ) : (
          <button onClick={handleStartRecording}
            className="flex items-center gap-1.5 bg-red-700 hover:bg-red-600 text-white text-xs px-3 py-2 rounded-full transition-colors">
            <span className="w-2 h-2 rounded-full bg-white" />
            Record
          </button>
        )
      )}

      <div className="flex-1" />

      {role === 'host' ? (
        <button onClick={handleEndWebinar} className="bg-red-700 hover:bg-red-600 active:scale-95 text-white text-sm px-5 py-2 rounded-full transition-all font-medium">
          End Webinar
        </button>
      ) : (
        <button onClick={handleLeave} className="bg-red-700 hover:bg-red-600 active:scale-95 text-white text-sm px-5 py-2 rounded-full transition-all">
          Leave
        </button>
      )}
    </div>
  );
}

function CtrlBtn({ onClick, active, icon, label, activeClass, inactiveClass }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-1.5 text-white text-sm px-3 py-2 rounded-full transition-all active:scale-95 ${active ? activeClass : inactiveClass}`}>
      <span>{icon}</span>
      <span className="text-xs">{label}</span>
    </button>
  );
}
