'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import useRoomStore from '../store/useRoomStore';
import { disconnectSocket } from '../lib/socket';
import { toast } from './Toast';

// ── Mic level VU meter ────────────────────────────────────────────────────────
function MicLevelMeter() {
  const localStream = useRoomStore((s) => s.localStream);
  const micEnabled  = useRoomStore((s) => s.micEnabled);
  const [level, setLevel] = useState(0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!localStream || !micEnabled) { setLevel(0); return; }

    const audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
    const analyser  = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    audioCtx.createMediaStreamSource(localStream).connect(analyser);
    const dataArr = new Uint8Array(analyser.frequencyBinCount);

    let running = true;
    const tick = () => {
      if (!running) return;
      analyser.getByteFrequencyData(dataArr);
      const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length;
      setLevel(Math.min(100, (avg / 128) * 100));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
      try { audioCtx.close(); } catch {}
    };
  }, [localStream, micEnabled]);

  if (!localStream || !micEnabled) return null;

  return (
    <div className="flex items-end gap-0.5 h-5 ml-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className={`w-1 rounded-sm transition-all duration-75 ${level >= ((i + 1) / 5) * 100 ? 'bg-green-400' : 'bg-gray-600'}`}
          style={{ height: `${40 + i * 15}%` }}
        />
      ))}
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
  const handRaised    = useRoomStore((s) => s.handRaised);

  const [elapsed,       setElapsed]       = useState(0);
  const [showReactions, setShowReactions] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // 0 = idle, 1–99 = uploading, 100 = done
  const timerRef = useRef(null);

  // Recording state refs — avoids stale closures in event handlers
  const mediaRecorderRef  = useRef(null);
  const chunksRef         = useRef([]);
  const captureStreamRef  = useRef(null);
  const audioCtxRef       = useRef(null);
  const recordingActiveRef = useRef(false); // guard against double-start/stop

  // Cleanup on unmount — stop any active recording
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      try { audioCtxRef.current?.close(); } catch {}
      captureStreamRef.current?.getTracks().forEach((t) => t.stop());
      if (mediaRecorderRef.current?.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch {}
      }
    };
  }, []);

  // Recording timer
  useEffect(() => {
    if (isRecording) {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((t) => t + 1), 1000);
    } else {
      clearInterval(timerRef.current);
      timerRef.current = null;
      setElapsed(0);
    }
    return () => { clearInterval(timerRef.current); timerRef.current = null; };
  }, [isRecording]);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  const isPresenter = role === 'host' || role === 'panelist';

  const handleLeave = () => {
    if (!confirm('Leave the webinar?')) return;
    disconnectSocket();
    router.push('/dashboard');
  };

  const handleEndWebinar = () => {
    if (!confirm('End the webinar for everyone?')) return;
    socket?.emit('endWebinar', { webinarId }, (res) => {
      if (!res?.success) toast.error('Could not end webinar: ' + res?.error);
    });
  };

  const handleRaiseHand = () => {
    socket?.emit('raiseHand', { webinarId });
    useRoomStore.getState().handRaised
      ? useRoomStore.setState({ handRaised: false })
      : useRoomStore.setState({ handRaised: true });
  };

  const sendReaction = (emoji) => {
    socket?.emit('sendReaction', { webinarId, emoji });
    setShowReactions(false);
  };

  // ── Upload with progress ────────────────────────────────────────────────────
  const uploadRecording = useCallback((blob, title) => {
    return new Promise((resolve, reject) => {
      const token = localStorage.getItem('auth_token');
      const form  = new FormData();
      form.append('recording', blob, 'recording.webm');
      if (title) form.append('title', title);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${process.env.NEXT_PUBLIC_API_URL}/api/webinars/${webinarId}/recording`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          setUploadProgress(Math.round((e.loaded / e.total) * 99));
        }
      };
      xhr.onload = () => {
        setUploadProgress(100);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.ontimeout = () => reject(new Error('Upload timed out'));
      xhr.timeout = 10 * 60 * 1000; // 10 min max
      xhr.send(form);
    });
  }, [webinarId]);

  // ── Stop recording ─────────────────────────────────────────────────────────
  const handleStopRecording = useCallback(async () => {
    if (!recordingActiveRef.current) return; // prevent double-call
    recordingActiveRef.current = false;

    const recorder = mediaRecorderRef.current;

    // Stop capture streams first so no more data comes in
    captureStreamRef.current?.getTracks().forEach((t) => t.stop());
    captureStreamRef.current = null;

    // Close audio context
    try { audioCtxRef.current?.close(); } catch {}
    audioCtxRef.current = null;

    // Notify other participants
    socket?.emit('stopRecording', { webinarId }, () => {});

    if (!recorder || recorder.state === 'inactive') return;

    // Collect all chunks: those already accumulated + the final flush from stop()
    // IMPORTANT: do NOT clear chunksRef before stop() — the existing chunks contain
    // the WebM initialization segment (EBML header). Clearing them first produces
    // a corrupt file that FFmpeg cannot parse.
    const finalChunks = await new Promise((resolve) => {
      recorder.onstop = () => {
        const all = [...chunksRef.current];
        chunksRef.current = []; // clear after collecting
        resolve(all);
      };
      mediaRecorderRef.current = null;
      recorder.stop(); // triggers final ondataavailable, then onstop
    });

    if (finalChunks.length === 0) {
      toast.error('Recording was empty — no data captured');
      return;
    }

    const blob = new Blob(finalChunks, { type: 'video/webm' });
    if (blob.size < 1024) { // less than 1KB is definitely empty
      toast.error('Recording too small — something went wrong');
      return;
    }

    console.log(`[Recording] Blob size: ${(blob.size / 1024 / 1024).toFixed(1)} MB`);

    const title = useRoomStore.getState().webinarTitle;

    setUploadProgress(1);
    toast.info('Uploading recording...');

    try {
      await uploadRecording(blob, title);
      setUploadProgress(0);
      toast.success('Recording saved! Download from dashboard.');
    } catch (uploadErr) {
      setUploadProgress(0);
      console.error('[Recording] Upload failed:', uploadErr.message);
      // Fallback: download directly in browser as WebM
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const safeName = title ? title.replace(/[^a-z0-9]/gi, '_') : 'webinar-recording';
      a.download = `${safeName}_${Date.now()}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast.warn('Upload failed — recording downloaded locally as .webm');
    }
  }, [socket, webinarId, uploadRecording]);

  // ── Start recording ─────────────────────────────────────────────────────────
  const handleStartRecording = useCallback(async () => {
    if (recordingActiveRef.current) return; // already recording

    try {
      const { localStream, screenStream } = useRoomStore.getState();

      // Step 1: Determine video source
      // Case A: screen share already active — reuse its tracks (NO second dialog, NO second banner)
      // Case B: no screen share — call getDisplayMedia once
      let videoTracks = [];
      let tabAudioTracks = [];

      const liveScreenTracks = screenStream?.getVideoTracks().filter((t) => t.readyState === 'live') || [];

      if (liveScreenTracks.length > 0) {
        // Case A: reuse existing screen share session
        videoTracks = liveScreenTracks;
        console.log('[Recording] Reusing existing screen share — no new capture dialog');
        toast.info('Recording the active screen share.');
      } else {
        // Case B: no active screen share — show dialog once
        try {
          const tabStream = await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 30, displaySurface: 'browser' },
            audio: {
              echoCancellation: false,
              noiseSuppression: false,
              autoGainControl:  false,
            },
            preferCurrentTab: true,
            selfBrowserSurface: 'include',
          });
          captureStreamRef.current = tabStream;
          videoTracks    = tabStream.getVideoTracks();
          tabAudioTracks = tabStream.getAudioTracks();
        } catch (err) {
          if (err.name === 'NotAllowedError') {
            toast.error('Screen capture denied. Please allow screen sharing.');
          } else {
            toast.error('Could not start capture: ' + err.message);
          }
          return;
        }

        if (tabAudioTracks.length === 0) {
          toast.warn('⚠️ No tab audio! In the share dialog, tick "Share tab audio" to record participants.');
        }
      }

      recordingActiveRef.current = true;

      // Step 2: Mix all audio sources via AudioContext
      let finalStream = new MediaStream(videoTracks);

      try {
        const ctx = new AudioContext({ sampleRate: 48000 });
        audioCtxRef.current = ctx;

        // Resume — Chrome suspends AudioContext even on user gesture sometimes
        if (ctx.state === 'suspended') await ctx.resume();

        const dest       = ctx.createMediaStreamDestination();
        const masterGain = ctx.createGain();
        masterGain.gain.value = 1.0;
        masterGain.connect(dest);

        let sourcesConnected = 0;

        const connectTrack = (track, gainValue = 1.0, label = '') => {
          if (!track || track.readyState !== 'live') return;
          try {
            const source = ctx.createMediaStreamSource(new MediaStream([track]));
            const gain   = ctx.createGain();
            gain.gain.value = gainValue;
            source.connect(gain);
            gain.connect(masterGain);
            sourcesConnected++;
            console.log(`[Recording] Connected audio: ${label}`);
          } catch (e) {
            console.warn(`[Recording] Failed to connect ${label}:`, e.message);
          }
        };

        // Tab audio — all remote WebRTC participants (plays via <audio> elements in the page)
        tabAudioTracks.forEach((t) => connectTrack(t, 1.0, 'tab-audio'));

        // Host microphone — captured separately (NOT in tab audio, no echo risk since muted in <video>)
        localStream?.getAudioTracks().forEach((t) => connectTrack(t, 1.0, 'host-mic'));

        // Screen share audio — YouTube, system audio, shared tab audio
        screenStream?.getAudioTracks().forEach((t) => connectTrack(t, 0.9, 'screen-audio'));

        const mixedTracks = dest.stream.getAudioTracks();

        if (mixedTracks.length > 0 && sourcesConnected > 0) {
          finalStream = new MediaStream([...videoTracks, ...mixedTracks]);
          console.log(`[Recording] Audio mix ready — ${sourcesConnected} source(s)`);
        } else {
          // No audio sources at all — still record video (better than nothing)
          console.warn('[Recording] No audio sources connected — recording video only');
          finalStream = new MediaStream(videoTracks);
          toast.warn('No audio sources found. Recording video only.');
        }
      } catch (audioErr) {
        console.warn('[Recording] AudioContext failed, using video + raw tab audio:', audioErr.message);
        finalStream = new MediaStream([...videoTracks, ...tabAudioTracks]);
      }

      // Step 3: Pick best codec (prefer vp9+opus for quality, fall back gracefully)
      const mimeType = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=h264,opus',
        'video/webm',
      ].find((m) => MediaRecorder.isTypeSupported(m)) || '';

      console.log('[Recording] Using mimeType:', mimeType || '(browser default)');

      // Step 4: Start MediaRecorder
      const recorderOptions = {
        videoBitsPerSecond: 2_500_000, // 2.5 Mbps video
        audioBitsPerSecond:   128_000, // 128 kbps audio
      };
      if (mimeType) recorderOptions.mimeType = mimeType;

      const recorder = new MediaRecorder(finalStream, recorderOptions);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onerror = (e) => {
        console.error('[Recording] MediaRecorder error:', e.error);
        toast.error('Recording error: ' + (e.error?.message || 'unknown'));
        recordingActiveRef.current = false;
      };

      // Collect data every second — smaller chunks = less data loss on crash
      recorder.start(1000);
      mediaRecorderRef.current = recorder;

      // Auto-stop when user ends the capture from Chrome's "Stop sharing" button
      // Only applies in Case B (we own the stream) — in Case A the screen share manages its own lifecycle
      if (captureStreamRef.current && videoTracks[0]) {
        videoTracks[0].onended = () => {
          if (recordingActiveRef.current) {
            console.log('[Recording] Capture ended — auto-stopping recording');
            handleStopRecording();
          }
        };
      }

      // Notify server — broadcasts recordingStarted to all participants
      socket?.emit('startRecording', { webinarId }, (res) => {
        if (!res?.success) {
          toast.error('Recording broadcast failed: ' + (res?.error || ''));
        }
      });

      toast.success('Recording started');
    } catch (err) {
      recordingActiveRef.current = false;
      console.error('[Recording] Start failed:', err);
      toast.error('Recording failed: ' + err.message);
    }
  }, [socket, webinarId, handleStopRecording]);

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
        <>
          <div className="flex items-center gap-1.5 bg-gray-800 text-gray-400 text-xs px-3 py-2 rounded-full">
            <span>🔇</span><span>Muted</span>
          </div>
          <button onClick={handleRaiseHand}
            className={`text-white text-sm px-4 py-2 rounded-full transition-colors ${
              handRaised ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-gray-700 hover:bg-gray-600'
            }`}>
            {handRaised ? '✋ Hand Raised' : '✋ Raise Hand'}
          </button>
        </>
      )}

      {/* Emoji reactions */}
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
              <button key={e} onClick={() => sendReaction(e)}
                className="text-xl hover:scale-125 transition-transform leading-none p-1">
                {e}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Recording — host only */}
      {role === 'host' && (
        uploadProgress > 0 ? (
          // Upload in progress
          <div className="flex items-center gap-2 bg-gray-800 text-white text-xs px-3 py-2 rounded-full">
            <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="font-mono tabular-nums">
              {uploadProgress < 100 ? `Uploading ${uploadProgress}%` : 'Converting...'}
            </span>
          </div>
        ) : isRecording ? (
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
