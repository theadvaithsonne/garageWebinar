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
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 48000 },
    });
    setLocalStream(stream);

    const vt = stream.getVideoTracks()[0];
    const at = stream.getAudioTracks()[0];

    if (vt) {
      const vp = await sendTransportRef.current.produce({
        track: vt,
        encodings: [
          { maxBitrate: 100000, scaleResolutionDownBy: 4 },
          { maxBitrate: 300000, scaleResolutionDownBy: 2 },
          { maxBitrate: 900000 },
        ],
        codecOptions: { videoGoogleStartBitrate: 1000 },
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
    ['screen', 'screenAudio'].forEach((key) => {
      const p = producersRef.current[key];
      if (p && !p.closed) { try { p.close(); } catch {} delete producersRef.current[key]; }
    });
    const { screenStream: ss } = useRoomStore.getState();
    ss?.getTracks().forEach((t) => t.stop());
    setScreenStream(null);
    setScreenSharing(false);
  }, [setScreenStream, setScreenSharing]);

  // ── Consume remote stream ─────────────────────────────────────────────────
  const consume = useCallback(async (producerId, producerSocketId, kind, appData) => {
    if (!recvTransportRef.current) return;
    const socket = socketRef.current;
    if (!socket) return;
    try {
      const { consumer, stream } = await consumeStream(socket, webinarId, recvTransportRef.current, producerId);
      consumersRef.current[producerId] = consumer;

      // Route to correct stream slot based on appData type
      const type = appData?.type || consumer.appData?.type;
      const slot = (type === 'screen' || type === 'screenAudio') ? 'screen' : kind;
      updatePeerStream(producerSocketId, stream, slot);
    } catch (err) {
      console.error('[consume] error:', err.message);
    }
  }, [socketRef, webinarId, updatePeerStream]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    Object.values(producersRef.current).forEach((p) => { try { p.close(); } catch {} });
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
