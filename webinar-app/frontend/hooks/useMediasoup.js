'use client';

import { useRef, useCallback } from 'react';
import { loadDevice, createSendTransport, createRecvTransport, consumeStream } from '../lib/mediasoupClient';
import useRoomStore from '../store/useRoomStore';

export function useMediasoup(socketRef, webinarId) {
  const sendTransportRef        = useRef(null);
  const sendTransportPendingRef = useRef(null);
  const recvTransportRef        = useRef(null);
  const producersRef            = useRef({});  // { video, audio, screen, screenAudio }
  const consumersRef            = useRef({});  // { [producerId]: consumer }

  const { setLocalStream, setScreenStream, setMicEnabled, setCamEnabled, setScreenSharing, updatePeerStream } = useRoomStore();

  // ── Init device ──────────────────────────────────────────────────────────
  const initDevice = useCallback(async (rtpCapabilities) => {
    const socket = socketRef.current;
    if (!socket) throw new Error('Socket not connected');
    await loadDevice(rtpCapabilities);

    recvTransportRef.current = await createRecvTransport(socket, webinarId);

    const role = useRoomStore.getState().role;
    if (role === 'host' || role === 'panelist') {
      sendTransportRef.current = await createSendTransport(socket, webinarId);
    }
  }, [socketRef, webinarId]);

  // ── Ensure send transport (for late-promoted panelists) ──────────────────
  // Uses a pending ref to prevent duplicate transports on concurrent calls.
  const ensureSendTransport = useCallback(async () => {
    if (sendTransportRef.current) return;
    if (sendTransportPendingRef.current) return sendTransportPendingRef.current;
    const socket = socketRef.current;
    if (!socket) throw new Error('Not connected');
    sendTransportPendingRef.current = createSendTransport(socket, webinarId)
      .then((t) => { sendTransportRef.current = t; sendTransportPendingRef.current = null; })
      .catch((err) => { sendTransportPendingRef.current = null; throw err; });
    return sendTransportPendingRef.current;
  }, [socketRef, webinarId]);

  // ── Start camera + mic ───────────────────────────────────────────────────
  const startMedia = useCallback(async () => {
    // Stop any existing local stream tracks before requesting new ones
    const existing = useRoomStore.getState().localStream;
    if (existing) existing.getTracks().forEach((t) => t.stop());

    await ensureSendTransport();

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width:     { ideal: 1920, min: 640 },
        height:    { ideal: 1080, min: 480 },
        frameRate: { ideal: 30,   min: 15  },
        facingMode: 'user',
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
        sampleRate: 48000,
        channelCount: 2,
      },
    });
    setLocalStream(stream);

    const vt = stream.getVideoTracks()[0];
    const at = stream.getAudioTracks()[0];

    if (vt) {
      const settings = vt.getSettings();
      console.log(`[Camera] ${settings.width}x${settings.height} @ ${settings.frameRate}fps`);

      const vp = await sendTransportRef.current.produce({
        track: vt,
        encodings: [
          { rid: 'r0', maxBitrate:  300_000, scaleResolutionDownBy: 4, scalabilityMode: 'S1T3' },
          { rid: 'r1', maxBitrate:  800_000, scaleResolutionDownBy: 2, scalabilityMode: 'S1T3' },
          { rid: 'r2', maxBitrate: 2_500_000, scaleResolutionDownBy: 1, scalabilityMode: 'S1T3' },
        ],
        codecOptions: {
          videoGoogleStartBitrate: 1000,
          videoGoogleMaxBitrate:   2500,
          videoGoogleMinBitrate:   100,
        },
        appData: { type: 'camera' },
      });
      producersRef.current.video = vp;
      setCamEnabled(true);

      vt.onended = () => { vp.close(); delete producersRef.current.video; setCamEnabled(false); };
    }

    if (at) {
      const ap = await sendTransportRef.current.produce({
        track: at,
        appData: { type: 'audio' },
      });
      producersRef.current.audio = ap;
      setMicEnabled(true);
    }

    return stream;
  }, [ensureSendTransport, setLocalStream, setCamEnabled, setMicEnabled]);

  // ── Toggle mic ───────────────────────────────────────────────────────────
  const toggleMic = useCallback(() => {
    const p = producersRef.current.audio;
    if (!p) return;
    if (p.paused) { p.resume(); setMicEnabled(true); }
    else          { p.pause();  setMicEnabled(false); }
  }, [setMicEnabled]);

  // ── Force mute (called by host) ──────────────────────────────────────────
  const forceMute = useCallback(() => {
    const p = producersRef.current.audio;
    if (p && !p.paused) { p.pause(); setMicEnabled(false); }
  }, [setMicEnabled]);

  // ── Toggle camera ────────────────────────────────────────────────────────
  const toggleCam = useCallback(() => {
    const p = producersRef.current.video;
    if (!p) return;
    if (p.paused) { p.resume(); setCamEnabled(true); }
    else          { p.pause();  setCamEnabled(false); }
  }, [setCamEnabled]);

  // ── Share screen ─────────────────────────────────────────────────────────
  const shareScreen = useCallback(async () => {
    await ensureSendTransport();
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 15 } },
      audio: true,
    });

    setScreenStream(stream);
    setScreenSharing(true);

    const vt = stream.getVideoTracks()[0];
    if (vt) {
      const sp = await sendTransportRef.current.produce({ track: vt, appData: { type: 'screen' } });
      producersRef.current.screen = sp;
      vt.onended = () => stopScreenShare();
    }

    const at = stream.getAudioTracks()[0];
    if (at) {
      const sap = await sendTransportRef.current.produce({ track: at, appData: { type: 'screenAudio' } });
      producersRef.current.screenAudio = sap;
    }
    return stream;
  }, [ensureSendTransport, setScreenStream, setScreenSharing]);

  // ── Stop screen share ─────────────────────────────────────────────────────
  const stopScreenShare = useCallback(() => {
    const socket = socketRef.current;
    ['screen', 'screenAudio'].forEach((key) => {
      const p = producersRef.current[key];
      if (p && !p.closed) {
        // Notify server to close producer — triggers consumerClosed on all consumers
        socket?.emit('closeProducer', { webinarId, producerId: p.id });
        try { p.close(); } catch {}
        delete producersRef.current[key];
      }
    });
    const { screenStream: ss } = useRoomStore.getState();
    ss?.getTracks().forEach((t) => t.stop());
    setScreenStream(null);
    setScreenSharing(false);
  }, [socketRef, webinarId, setScreenStream, setScreenSharing]);

  // ── Consume remote stream ─────────────────────────────────────────────────
  const consume = useCallback(async (producerId, producerSocketId, kind, appData) => {
    if (!recvTransportRef.current) return;
    const socket = socketRef.current;
    if (!socket) return;
    try {
      const { consumer, stream } = await consumeStream(socket, webinarId, recvTransportRef.current, producerId);
      consumersRef.current[producerId] = consumer;

      // Route to correct stream slot based on appData type
      // IMPORTANT: screen video and screenAudio must use SEPARATE slots
      // otherwise screenAudio overwrites the screen video stream
      const type = appData?.type || consumer.appData?.type;
      const slot = type === 'screen'      ? 'screen'
                 : type === 'screenAudio' ? 'screenAudio'
                 : kind; // 'video' or 'audio'
      updatePeerStream(producerSocketId, stream, slot);
    } catch (err) {
      console.error('[consume] error:', err.message);
    }
  }, [socketRef, webinarId, updatePeerStream]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    const socket = socketRef.current;
    Object.entries(producersRef.current).forEach(([, p]) => {
      if (p && !p.closed) {
        socket?.emit('closeProducer', { webinarId, producerId: p.id });
        try { p.close(); } catch {}
      }
    });
    Object.values(consumersRef.current).forEach((c) => { try { c.close(); } catch {} });
    try { sendTransportRef.current?.close(); } catch {}
    try { recvTransportRef.current?.close(); } catch {}
    producersRef.current        = {};
    consumersRef.current        = {};
    sendTransportRef.current    = null;
    sendTransportPendingRef.current = null;
    recvTransportRef.current    = null;
  }, []);

  return { initDevice, startMedia, toggleMic, forceMute, toggleCam, shareScreen, stopScreenShare, consume, cleanup };
}
