'use client';

import { create } from 'zustand';

const useRoomStore = create((set, get) => ({
  // Room info
  webinarId: null,
  webinarTitle: '',
  role: 'attendee', // host | panelist | attendee
  guestName: null,  // set when joining as guest (no auth)
  myUserId: null,   // server-assigned userId (works for both auth and guest users)

  // Peers: { socketId, userId, name, role, stream?: MediaStream }
  peers: [],

  // Local streams
  localStream: null,
  screenStream: null,

  // Media state
  micEnabled: false,
  camEnabled: false,
  screenSharing: false,
  isRecording: false,
  handRaised: false,

  // Chat
  messages: [],
  unreadChatCount: 0,
  chatTabActive: true,

  // Q&A
  qaQuestions: [],

  // Polls
  polls: [],

  // Emoji reactions (transient, for animation)
  reactions: [],

  // Producers (kept as refs, not in Zustand state directly)
  producers: {},

  setWebinarId: (id) => set({ webinarId: id }),
  setWebinarTitle: (title) => set({ webinarTitle: title }),
  setRole: (role) => set({ role }),
  setGuestName: (name) => set({ guestName: name }),
  setMyUserId: (id) => set({ myUserId: id }),

  setLocalStream: (stream) => set({ localStream: stream }),
  setScreenStream: (stream) => set({ screenStream: stream }),

  setMicEnabled: (v) => set({ micEnabled: v }),
  setCamEnabled: (v) => set({ camEnabled: v }),
  setScreenSharing: (v) => set({ screenSharing: v }),
  setIsRecording: (v) => set({ isRecording: v }),

  // Peers
  addPeer: (peer) =>
    set((state) => ({
      peers: [...state.peers.filter((p) => p.socketId !== peer.socketId), peer],
    })),

  removePeer: (socketId) =>
    set((state) => ({ peers: state.peers.filter((p) => p.socketId !== socketId) })),

  updatePeerStream: (socketId, stream, kind) =>
    set((state) => ({
      peers: state.peers.map((p) => {
        if (p.socketId !== socketId) return p;
        const streams = p.streams || {};
        return { ...p, streams: { ...streams, [kind]: stream } };
      }),
    })),

  updatePeerRole: (socketId, role) =>
    set((state) => ({
      peers: state.peers.map((p) => (p.socketId === socketId ? { ...p, role } : p)),
    })),

  updatePeerName: (socketId, name) =>
    set((state) => ({
      peers: state.peers.map((p) => (p.socketId === socketId ? { ...p, name } : p)),
    })),

  updateHandRaised: (socketId, raised) =>
    set((state) => ({
      peers: state.peers.map((p) => (p.socketId === socketId ? { ...p, handRaised: raised } : p)),
    })),

  updatePeerMuted: (socketId, muted) =>
    set((state) => ({
      peers: state.peers.map((p) => (p.socketId === socketId ? { ...p, isMuted: muted } : p)),
    })),

  // Chat
  addMessage: (msg) => set((state) => ({
    messages: [...state.messages, msg],
    unreadChatCount: state.chatTabActive ? 0 : state.unreadChatCount + 1,
  })),
  setMessages: (messages) => set({ messages }),
  setChatTabActive: (v) => set({ chatTabActive: v, ...(v ? { unreadChatCount: 0 } : {}) }),

  // Q&A
  addQuestion: (qa) => set((state) => ({ qaQuestions: [...state.qaQuestions, qa] })),
  updateQuestion: (qa) =>
    set((state) => ({
      qaQuestions: state.qaQuestions.map((q) => (q.id === qa.id ? qa : q)),
    })),
  setQuestions: (qaQuestions) => set({ qaQuestions }),

  // Reactions
  addReaction: (reaction) => {
    // Fix left position at creation time so it doesn't re-randomize on re-renders
    const withPos = { ...reaction, left: 10 + Math.random() * 60 };
    set((state) => ({ reactions: [...state.reactions, withPos] }));
    // Auto-remove after 4s
    setTimeout(() => {
      set((state) => ({ reactions: state.reactions.filter((r) => r.id !== withPos.id) }));
    }, 4000);
  },

  // Polls
  addPoll: (poll) => set((state) => ({ polls: [...state.polls, poll] })),
  updatePoll: (poll) =>
    set((state) => ({
      polls: state.polls.map((p) => (p.id === poll.id ? poll : p)),
    })),
  setPolls: (polls) => set({ polls }),

  // Reset — stops all local media tracks before clearing state
  resetRoom: () => {
    const { localStream, screenStream } = get();
    try { localStream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { screenStream?.getTracks().forEach((t) => t.stop()); } catch {}
    set({
      webinarId: null,
      webinarTitle: '',
      role: 'attendee',
      guestName: null,
      myUserId: null,
      peers: [],
      localStream: null,
      screenStream: null,
      micEnabled: false,
      camEnabled: false,
      screenSharing: false,
      isRecording: false,
      handRaised: false,
      messages: [],
      unreadChatCount: 0,
      chatTabActive: true,
      qaQuestions: [],
      polls: [],
      reactions: [],
      producers: {},
    });
  },
}));

export default useRoomStore;
