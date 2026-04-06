'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import VideoGrid from '../../../components/VideoGrid';
import ChatPanel from '../../../components/ChatPanel';
import ParticipantList from '../../../components/ParticipantList';
import ControlBar from '../../../components/ControlBar';
import { connectSocket, disconnectSocket } from '../../../lib/socket';
import { useMediasoup } from '../../../hooks/useMediasoup';
import useRoomStore from '../../../store/useRoomStore';
import useAuthStore from '../../../store/useAuthStore';
import { toast } from '../../../components/Toast';

const TABS = ['Chat', 'People'];

export default function RoomPage() {
  const { id: webinarId } = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { token, user } = useAuthStore();

  const urlRole        = searchParams.get('role') || 'attendee';
  const panelistToken  = searchParams.get('pt') || null;

  const socketRef    = useRef(null);
  const hasJoinedRef = useRef(false);

  const [joined,       setJoined]       = useState(false);
  const [activeTab,    setActiveTab_]    = useState('Chat');
  const setActiveTab = (tab) => { setActiveTab_(tab); setChatTabActive(tab === 'Chat'); };
  const [mediaStarted, setMediaStarted] = useState(false);
  const [joinError,    setJoinError]    = useState('');
  const [connecting,   setConnecting]   = useState(true);
  const [socketStatus, setSocketStatus] = useState('connecting'); // connecting | connected | disconnected
  const [sidebarOpen,  setSidebarOpen]  = useState(true);

  const { setRole, setWebinarId, setWebinarTitle, addPeer, setMessages, resetRoom, setChatTabActive } = useRoomStore();
  const mediasoup = useMediasoup(socketRef, webinarId);

  useEffect(() => {
    if (!token || !webinarId || hasJoinedRef.current) return;
    hasJoinedRef.current = true;

    const socket = connectSocket(token);
    socketRef.current = socket;

    socket.on('connect',       () => setSocketStatus('connected'));
    socket.on('disconnect',    () => setSocketStatus('disconnected'));
    socket.on('connect_error', (err) => {
      console.error('Socket error:', err.message);
      setSocketStatus('disconnected');
      toast.error('Connection lost. Trying to reconnect...');
    });
    socket.on('reconnect', () => {
      setSocketStatus('connected');
      toast.success('Reconnected!');
    });

    // Room events
    socket.on('newMessage',      (msg)  => useRoomStore.getState().addMessage(msg));
    socket.on('recordingStarted',()     => { useRoomStore.getState().setIsRecording(true); toast.info('Recording started'); });
    socket.on('recordingStopped',()     => { useRoomStore.getState().setIsRecording(false); toast.info('Recording stopped'); });

    socket.on('peerJoined', (peer) => {
      if (peer.userId === user?.id) return;
      useRoomStore.getState().addPeer(peer);
      toast.info(`${peer.name} joined`);
    });
    socket.on('peerLeft', ({ socketId }) => {
      const peers = useRoomStore.getState().peers;
      const leaving = peers.find((p) => p.socketId === socketId);
      if (leaving) toast.info(`${leaving.name} left`);
      useRoomStore.getState().removePeer(socketId);
    });
    socket.on('peerRoleChanged', ({ socketId, role }) => useRoomStore.getState().updatePeerRole(socketId, role));
    socket.on('peerNameChanged', ({ socketId, name }) => useRoomStore.getState().updatePeerName(socketId, name));
    socket.on('peerMicState', ({ socketId, muted }) => useRoomStore.getState().updatePeerMuted(socketId, muted));
    socket.on('handRaised',      ({ socketId, name, raised }) => {
      useRoomStore.getState().updateHandRaised(socketId, raised);
      if (raised) toast.info(`${name} raised their hand ✋`);
    });

    socket.on('newProducer', ({ producerId, producerSocketId, kind, appData }) => {
      mediasoup.consume(producerId, producerSocketId, kind, appData);
    });
    socket.on('consumerClosed', ({ consumerId, producerSocketId, kind, appData }) => {
      if (producerSocketId) {
        const type = appData?.type || '';
        const slot = type === 'screen'      ? 'screen'
                   : type === 'screenAudio' ? 'screenAudio'
                   : kind;
        useRoomStore.getState().updatePeerStream(producerSocketId, null, slot);
      }
    });

    // Direct screen share stopped signal — reliable, doesn't depend on consumer chain
    socket.on('screenShareStopped', ({ producerSocketId, type }) => {
      console.log('[screenShareStopped]', producerSocketId, type);
      useRoomStore.getState().updatePeerStream(producerSocketId, null, type === 'screenAudio' ? 'screenAudio' : 'screen');
    });

    socket.on('forceMuted', () => {
      mediasoup.forceMute();
      toast.warn('The host muted your microphone');
    });

    socket.on('reaction', ({ name, emoji }) => {
      useRoomStore.getState().addReaction({ name, emoji, id: Date.now() + Math.random() });
    });

    socket.on('removedFromRoom', () => {
      toast.error('You were removed from the webinar');
      setTimeout(() => { doCleanup(); router.push('/'); }, 1500);
    });

    socket.on('roleChanged', async ({ role: newRole }) => {
      useRoomStore.getState().setRole(newRole);
      if (newRole === 'panelist') {
        toast.success('You are now a Co-Host! You can use camera, mic & screen share.');
        try {
          await mediasoup.startMedia();
          setMediaStarted(true);
        } catch (err) {
          console.warn('Auto media start failed for co-host:', err.message);
        }
      } else if (newRole === 'attendee') {
        // Demoted — stop all media
        mediasoup.stopScreenShare();
        mediasoup.cleanup();
        setMediaStarted(false);
        toast.warn('You have been moved back to attendee.');
      } else {
        toast.success(`Your role changed to ${newRole}`);
      }
    });

    socket.on('webinarEnded', () => {
      toast.info('The webinar has ended');
      // Delay navigation to allow recording upload to continue
      const checkAndNavigate = () => {
        const uploadProgress = document.querySelector('[data-upload-active]');
        if (uploadProgress) {
          toast.info('Waiting for recording upload to finish...');
          setTimeout(checkAndNavigate, 3000);
        } else {
          doCleanup();
          router.push('/dashboard');
        }
      };
      setTimeout(checkAndNavigate, 2000);
    });

    // Join the room
    socket.emit('joinRoom', { webinarId, role: urlRole, panelistToken }, async (response) => {
      setConnecting(false);
      if (!response.success) {
        setJoinError(response.error || 'Failed to join room');
        return;
      }

      setWebinarId(webinarId);
      setWebinarTitle(response.webinarTitle || '');
      setRole(response.role || urlRole);
      setMessages(response.chatHistory || []);
      (response.peers || [])
        .filter((p) => p.userId !== user?.id)
        .forEach((peer) => addPeer(peer));

      try {
        await mediasoup.initDevice(response.rtpCapabilities);

        socket.emit('getProducers', { webinarId }, (producers) => {
          producers.forEach(({ producerId, producerSocketId, kind, appData }) => {
            mediasoup.consume(producerId, producerSocketId, kind, appData);
          });
        });

        setJoined(true);

        // Auto-start camera+mic for host and panelist
        if (response.role === 'host' || response.role === 'panelist') {
          try {
            await mediasoup.startMedia();
            setMediaStarted(true);
          } catch (err) {
            // Permission denied or device unavailable — user can still join manually
            console.warn('Auto media start failed:', err.message);
          }
        }
      } catch (err) {
        console.error('mediasoup init error:', err);
        setJoinError('Failed to initialize video: ' + err.message);
      }
    });

    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, webinarId, urlRole]);

  // Cleanup on unmount
  useEffect(() => () => doCleanup(), []); // eslint-disable-line

  function doCleanup() {
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
    }
    mediasoup.cleanup();
    disconnectSocket();
    resetRoom();
    hasJoinedRef.current = false;
  }

  const handleStartMedia = async () => {
    try {
      await mediasoup.startMedia();
      setMediaStarted(true);
      toast.success('Camera & mic enabled');
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        toast.error('Camera/mic permission denied. Allow access in browser settings.');
      } else {
        toast.error('Could not access camera/mic: ' + err.message);
      }
    }
  };

  const handleShareScreen = async () => {
    const { screenSharing } = useRoomStore.getState();
    if (screenSharing) {
      mediasoup.stopScreenShare();
      toast.info('Screen sharing stopped');
    } else {
      try {
        await mediasoup.shareScreen();
      } catch (err) {
        if (err.name !== 'NotAllowedError') toast.error('Screen share failed: ' + err.message);
      }
    }
  };

  // ── Render states ────────────────────────────────────────────────────────
  if (joinError) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="bg-gray-900 rounded-xl p-8 text-center border border-gray-800 max-w-sm">
          <div className="text-4xl mb-3">🚫</div>
          <p className="text-red-400 text-lg font-semibold mb-2">Failed to join</p>
          <p className="text-gray-400 text-sm mb-5">{joinError}</p>
          <button onClick={() => router.push('/dashboard')} className="bg-gray-700 hover:bg-gray-600 text-white text-sm px-5 py-2 rounded-lg transition-colors">
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-white font-medium">Joining webinar...</p>
          <p className="text-gray-500 text-sm mt-1">Setting up secure connection</p>
        </div>
      </div>
    );
  }

  const renderPanel = () => {
    const socket = socketRef.current;
    switch (activeTab) {
      case 'Chat':   return <ChatPanel        socket={socket} webinarId={webinarId} />;
      case 'People': return <ParticipantList  socket={socket} webinarId={webinarId} />;
    }
  };

  return (
    <div className="h-screen bg-gray-950 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="h-12 bg-gray-900 border-b border-gray-700 flex items-center px-4 gap-3 flex-shrink-0">
        <span className="text-white font-bold text-sm flex-shrink-0">WebinarApp</span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className={`w-2 h-2 rounded-full ${socketStatus === 'connected' ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          <span className={`text-xs font-medium ${socketStatus === 'connected' ? 'text-green-400' : 'text-red-400'}`}>
            {socketStatus === 'connected' ? 'LIVE' : 'RECONNECTING...'}
          </span>
        </div>
        <WebinarTitle />
        <RoleTag />
        <EditableName socket={socketRef.current} webinarId={webinarId} />
        <div className="flex-1" />
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded transition-colors"
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          {sidebarOpen ? '▶' : '◀'}
        </button>
        <InviteButton webinarId={webinarId} />
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video */}
        <div className="flex-1 overflow-hidden bg-gray-950">
          <VideoGrid />
        </div>

        {/* Sidebar */}
        {sidebarOpen && (
        <div className="w-80 flex flex-col border-l border-gray-700 flex-shrink-0 bg-gray-900">
          {/* Tabs */}
          <div className="flex border-b border-gray-700 flex-shrink-0">
            {TABS.map((tab) => (
              <TabButton
                key={tab}
                tab={tab}
                active={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                webinarId={webinarId}
              />
            ))}
          </div>
          <div className="flex-1 overflow-hidden">{renderPanel()}</div>
        </div>
        )}
      </div>

      {/* Controls */}
      <ControlBar
        socket={socketRef.current}
        webinarId={webinarId}
        onToggleMic={mediasoup.toggleMic}
        onToggleCam={mediasoup.toggleCam}
        onShareScreen={handleShareScreen}
        onStartMedia={handleStartMedia}
        mediaStarted={mediaStarted}
      />
    </div>
  );
}

function WebinarTitle() {
  const title = useRoomStore((s) => s.webinarTitle);
  if (!title) return null;
  return (
    <span className="text-gray-300 text-sm font-medium truncate max-w-[200px] hidden sm:block">
      {title}
    </span>
  );
}

function RoleTag() {
  const role = useRoomStore((s) => s.role);
  const colors = { host: 'bg-purple-900/50 text-purple-300', panelist: 'bg-blue-900/50 text-blue-300', attendee: 'bg-gray-800 text-gray-400' };
  return <span className={`text-xs capitalize px-2 py-0.5 rounded-full font-medium ${colors[role] || colors.attendee}`}>{role === 'panelist' ? 'Co-Host' : role}</span>;
}

function EditableName({ socket, webinarId }) {
  const { user } = useAuthStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name || '');

  const save = () => {
    const clean = name.trim();
    if (!clean || clean === user?.name) { setEditing(false); return; }
    socket?.emit('updateName', { webinarId, name: clean }, (res) => {
      if (res?.success) {
        useAuthStore.getState().setAuth({ ...user, name: clean }, localStorage.getItem('auth_token'));
        toast.success('Name updated');
      } else toast.error(res?.error || 'Failed');
    });
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
        maxLength={50}
        className="bg-gray-800 text-white text-xs px-2 py-1 rounded border border-gray-600 w-32 focus:outline-none focus:border-blue-500"
      />
    );
  }
  return (
    <button onClick={() => { setName(user?.name || ''); setEditing(true); }} className="text-gray-400 hover:text-white text-xs px-1.5 py-0.5 rounded hover:bg-gray-800 transition-colors hidden sm:block" title="Edit name">
      {user?.name || 'Anonymous'} ✏️
    </button>
  );
}

function InviteButton({ webinarId }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    const link = `${window.location.origin}/join/${webinarId}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      toast.success('Invite link copied!');
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy} className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white text-xs px-3 py-1.5 rounded-lg transition-colors border border-gray-700">
      {copied ? '✅ Copied!' : '🔗 Invite'}
    </button>
  );
}

function TabButton({ tab, active, onClick, webinarId }) {
  const handCount      = useRoomStore((s) => s.peers.filter((p) => p.handRaised).length);
  const unreadChat     = useRoomStore((s) => s.unreadChatCount);
  const badge = (tab === 'Chat' && !active && unreadChat > 0) ? unreadChat
              : (tab === 'People' && handCount > 0) ? `✋${handCount}`
              : null;

  return (
    <button
      onClick={onClick}
      className={`flex-1 text-xs py-2.5 relative transition-colors ${
        active ? 'text-white border-b-2 border-blue-500' : 'text-gray-400 hover:text-gray-300'
      }`}
    >
      {tab}
      {badge && (
        <span className={`absolute top-1 right-1 min-w-4 h-4 px-0.5 text-white text-xs rounded-full flex items-center justify-center leading-none ${typeof badge === 'number' ? 'bg-blue-600' : 'bg-yellow-600'}`}>
          {typeof badge === 'number' ? (badge > 9 ? '9+' : badge) : badge}
        </span>
      )}
    </button>
  );
}
