'use client';

import { useEffect, useRef } from 'react';
import { connectSocket, disconnectSocket } from '../lib/socket';
import useRoomStore from '../store/useRoomStore';
import useAuthStore from '../store/useAuthStore';

export function useSocket(webinarId) {
  const socketRef = useRef(null);
  const { token } = useAuthStore();
  const {
    addPeer,
    removePeer,
    addMessage,
    addQuestion,
    updateQuestion,
    addPoll,
    updatePoll,
    updatePeerRole,
    updateHandRaised,
    setIsRecording,
  } = useRoomStore();

  useEffect(() => {
    if (!token || !webinarId) return;

    const socket = connectSocket(token);
    socketRef.current = socket;

    return () => {
      // Don't disconnect here — managed by the room page
    };
  }, [token, webinarId]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleNewMessage = (msg) => addMessage(msg);
    const handleNewQA = (qa) => addQuestion(qa);
    const handleQAUpdated = (qa) => updateQuestion(qa);
    const handleNewPoll = (poll) => addPoll(poll);
    const handlePollUpdated = (poll) => updatePoll(poll);
    const handlePeerJoined = (peer) => addPeer(peer);
    const handlePeerLeft = ({ socketId }) => removePeer(socketId);
    const handlePeerRoleChanged = ({ socketId, role }) => updatePeerRole(socketId, role);
    const handleHandRaised = ({ socketId, raised }) => updateHandRaised(socketId, raised);
    const handleRecordingStarted = () => setIsRecording(true);
    const handleRecordingStopped = () => setIsRecording(false);

    socket.on('newMessage', handleNewMessage);
    socket.on('newQA', handleNewQA);
    socket.on('qaUpdated', handleQAUpdated);
    socket.on('newPoll', handleNewPoll);
    socket.on('pollUpdated', handlePollUpdated);
    socket.on('peerJoined', handlePeerJoined);
    socket.on('peerLeft', handlePeerLeft);
    socket.on('peerRoleChanged', handlePeerRoleChanged);
    socket.on('handRaised', handleHandRaised);
    socket.on('recordingStarted', handleRecordingStarted);
    socket.on('recordingStopped', handleRecordingStopped);

    return () => {
      socket.off('newMessage', handleNewMessage);
      socket.off('newQA', handleNewQA);
      socket.off('qaUpdated', handleQAUpdated);
      socket.off('newPoll', handleNewPoll);
      socket.off('pollUpdated', handlePollUpdated);
      socket.off('peerJoined', handlePeerJoined);
      socket.off('peerLeft', handlePeerLeft);
      socket.off('peerRoleChanged', handlePeerRoleChanged);
      socket.off('handRaised', handleHandRaised);
      socket.off('recordingStarted', handleRecordingStarted);
      socket.off('recordingStopped', handleRecordingStopped);
    };
  }, [
    addMessage, addQuestion, updateQuestion, addPoll, updatePoll,
    addPeer, removePeer, updatePeerRole, updateHandRaised, setIsRecording,
  ]);

  return socketRef;
}
