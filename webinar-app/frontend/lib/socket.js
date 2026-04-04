import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
  if (!socket) {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    socket = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000', {
      auth: { token },
      transports: ['websocket'],
      autoConnect: false,
    });
  }
  return socket;
}

export function connectSocket(token) {
  const s = getSocket();
  if (token) {
    s.auth = { token };
  }
  if (!s.connected) {
    s.connect();
  }
  return s;
}

export function disconnectSocket() {
  if (socket?.connected) {
    socket.disconnect();
  }
  socket = null;
}
