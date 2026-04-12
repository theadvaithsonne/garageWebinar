'use client';

import { useState, useEffect, useRef } from 'react';
import useRoomStore from '../store/useRoomStore';
import useAuthStore from '../store/useAuthStore';
import { toast } from './Toast';

export default function ChatPanel({ socket, webinarId }) {
  const [input,      setInput]      = useState('');
  const [sending,    setSending]    = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef    = useRef(null);
  const scrollRef    = useRef(null);
  const { messages, myUserId } = useRoomStore();
  const { user }     = useAuthStore();

  // Auto-scroll to bottom on new messages, unless user scrolled up
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, autoScroll]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    setAutoScroll(atBottom);
  };

  const sendMessage = () => {
    if (!input.trim() || !socket || sending) return;
    const text = input.trim().slice(0, 1000);
    setSending(true);
    setInput('');
    socket.emit('sendMessage', { webinarId, text }, (res) => {
      setSending(false);
      if (!res?.success) {
        toast.error(res?.error || 'Failed to send message');
        setInput(text); // restore
      }
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  const formatTime = (ts) =>
    new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {!autoScroll && (
        <button
          onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
          className="mx-3 mt-1 text-xs text-blue-400 bg-blue-900/30 hover:bg-blue-900/50 px-3 py-1 rounded-full transition-colors"
        >
          ↓ New messages
        </button>
      )}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <span className="text-2xl mb-2">💬</span>
            <p className="text-gray-500 text-sm">No messages yet</p>
            <p className="text-gray-600 text-xs mt-1">Be the first to say hi!</p>
          </div>
        )}

        {messages.map((msg, i) => {
          const isOwn = msg.userId === (myUserId || user?.id);
          const showName = i === 0 || messages[i - 1]?.userId !== msg.userId;

          return (
            <div key={msg.id || i} className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}>
              {showName && (
                <span className={`text-xs font-medium mb-1 px-1 ${isOwn ? 'text-blue-400' : 'text-green-400'}`}>
                  {isOwn ? 'You' : msg.userName}
                </span>
              )}
              <div className={`max-w-[85%] px-3 py-2 rounded-xl text-sm leading-snug break-words ${
                isOwn
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-gray-800 text-gray-100 rounded-bl-sm'
              }`}>
                {msg.text}
              </div>
              <span className="text-gray-600 text-xs mt-0.5 px-1">{formatTime(msg.timestamp)}</span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="px-3 py-3 border-t border-gray-700 space-y-1.5">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            maxLength={1000}
            disabled={sending}
            className="flex-1 bg-gray-800 text-white text-sm px-3 py-2 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-500 disabled:opacity-60"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || sending}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 active:scale-95 text-white px-3 py-2 rounded-lg text-sm transition-all"
          >
            {sending ? '...' : '↑'}
          </button>
        </div>
        {input.length > 800 && (
          <p className={`text-xs text-right ${input.length >= 1000 ? 'text-red-400' : 'text-gray-500'}`}>
            {input.length}/1000
          </p>
        )}
      </div>
    </div>
  );
}
