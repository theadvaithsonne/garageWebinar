'use client';

import useRoomStore from '../store/useRoomStore';
import useAuthStore from '../store/useAuthStore';
import { toast } from './Toast';

export default function ParticipantList({ socket, webinarId }) {
  const peers = useRoomStore((s) => s.peers);
  const role  = useRoomStore((s) => s.role);
  const { user } = useAuthStore();

  const total = peers.length + 1;

  const mute    = (id) => socket?.emit('muteParticipant',  { webinarId, targetSocketId: id }, (r) => { if (!r?.success) toast.error(r?.error); });
  const remove  = (id, name) => {
    if (!confirm(`Remove ${name} from the webinar?`)) return;
    socket?.emit('removeParticipant', { webinarId, targetSocketId: id }, (r) => { if (!r?.success) toast.error(r?.error); });
  };
  const promote = (id, name) => {
    if (!confirm(`Promote ${name} to panelist?`)) return;
    socket?.emit('promoteToHost', { webinarId, targetSocketId: id }, (r) => {
      if (r?.success) toast.success(`${name} promoted to panelist`);
      else toast.error(r?.error);
    });
  };

  const roleBadge = {
    host:     'bg-purple-900/50 text-purple-300 border border-purple-700',
    panelist: 'bg-blue-900/50   text-blue-300   border border-blue-700',
    attendee: 'bg-gray-800      text-gray-400',
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="px-4 py-3 border-b border-gray-700">
        <p className="text-white font-semibold text-sm">Participants</p>
        <p className="text-gray-500 text-xs mt-0.5">{total} in room</p>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {/* Self */}
        <ParticipantRow
          name={user?.name || 'You'}
          role={role}
          isSelf
          roleBadge={roleBadge}
        />

        {peers.map((peer) => (
          <ParticipantRow
            key={peer.socketId}
            name={peer.name}
            role={peer.role}
            handRaised={peer.handRaised}
            roleBadge={roleBadge}
            isHost={role === 'host'}
            onMute={()    => mute(peer.socketId)}
            onRemove={()  => remove(peer.socketId, peer.name)}
            onPromote={peer.role === 'attendee' ? () => promote(peer.socketId, peer.name) : null}
          />
        ))}
      </div>
    </div>
  );
}

function ParticipantRow({ name, role, isSelf, handRaised, roleBadge, isHost, onMute, onRemove, onPromote }) {
  const initial = name?.[0]?.toUpperCase() || '?';
  const avatarColor = isSelf ? 'bg-blue-600' : 'bg-gray-600';

  return (
    <div className={`flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-gray-800 group transition-colors ${handRaised ? 'bg-yellow-900/20' : ''}`}>
      <div className={`relative w-8 h-8 rounded-full ${avatarColor} flex items-center justify-center text-sm font-semibold text-white flex-shrink-0 ${handRaised ? 'ring-2 ring-yellow-400 ring-offset-1 ring-offset-gray-900' : ''}`}>
        {initial}
        {handRaised && <span className="absolute -top-1.5 -right-1.5 text-sm animate-bounce">✋</span>}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">
          {name} {isSelf && <span className="text-gray-500 text-xs">(You)</span>}
        </p>
        <span className={`inline-block text-xs px-1.5 py-0 rounded capitalize mt-0.5 ${roleBadge[role] || roleBadge.attendee}`}>
          {role}
        </span>
      </div>

      {isHost && !isSelf && (
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onMute}   title="Mute"   className="text-xs text-yellow-400 hover:text-yellow-300 px-1.5 py-1 rounded hover:bg-gray-700 transition-colors">🔇</button>
          {onPromote && (
            <button onClick={onPromote} title="Promote" className="text-xs text-green-400 hover:text-green-300 px-1.5 py-1 rounded hover:bg-gray-700 transition-colors">⬆️</button>
          )}
          <button onClick={onRemove} title="Remove" className="text-xs text-red-400 hover:text-red-300 px-1.5 py-1 rounded hover:bg-gray-700 transition-colors">✕</button>
        </div>
      )}
    </div>
  );
}
