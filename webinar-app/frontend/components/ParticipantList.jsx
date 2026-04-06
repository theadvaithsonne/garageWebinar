'use client';

import useRoomStore from '../store/useRoomStore';
import useAuthStore from '../store/useAuthStore';
import { toast } from './Toast';

export default function ParticipantList({ socket, webinarId }) {
  const peers = useRoomStore((s) => s.peers);
  const role  = useRoomStore((s) => s.role);
  const { user } = useAuthStore();

  const total = peers.length + 1;

  const mute    = (id) => socket?.emit('muteParticipant', { webinarId, targetSocketId: id }, (r) => { if (!r?.success) toast.error(r?.error); });
  const remove  = (id, name) => {
    if (!confirm(`Remove ${name} from the webinar?`)) return;
    socket?.emit('removeParticipant', { webinarId, targetSocketId: id }, (r) => { if (!r?.success) toast.error(r?.error); });
  };
  const promote = (id, name) => {
    if (!confirm(`Make ${name} a Co-Host? They will be able to use camera, mic & screen share.`)) return;
    socket?.emit('promoteToHost', { webinarId, targetSocketId: id }, (r) => {
      if (r?.success) toast.success(`${name} is now a Co-Host`);
      else toast.error(r?.error);
    });
  };
  const demote = (id, name) => {
    if (!confirm(`Remove Co-Host role from ${name}? They will become a regular attendee.`)) return;
    socket?.emit('demoteToAttendee', { webinarId, targetSocketId: id }, (r) => {
      if (r?.success) toast.success(`${name} is now an attendee`);
      else toast.error(r?.error || 'Failed to demote');
    });
  };
  const muteAll = () => {
    const attendees = peers.filter((p) => p.role === 'attendee');
    if (!attendees.length) return toast.info('No attendees to mute');
    attendees.forEach((p) => socket?.emit('muteParticipant', { webinarId, targetSocketId: p.socketId }));
    toast.success(`Muted ${attendees.length} attendee${attendees.length > 1 ? 's' : ''}`);
  };

  const roleBadge = {
    host:     'bg-purple-900/50 text-purple-300 border border-purple-700',
    panelist: 'bg-blue-900/50   text-blue-300   border border-blue-700',
    attendee: 'bg-gray-800      text-gray-400',
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div>
          <p className="text-white font-semibold text-sm">Participants</p>
          <p className="text-gray-500 text-xs mt-0.5">{total} in room</p>
        </div>
        {(role === 'host' || role === 'panelist') && peers.length > 0 && (
          <button
            onClick={muteAll}
            className="text-xs text-yellow-400 hover:text-yellow-300 bg-yellow-900/20 hover:bg-yellow-900/40 px-2 py-1 rounded transition-colors"
            title="Mute all attendees"
          >
            🔇 Mute All
          </button>
        )}
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
            isHost={role === 'host' || role === 'panelist'}
            onMute={()    => mute(peer.socketId)}
            onRemove={()  => remove(peer.socketId, peer.name)}
            onPromote={peer.role === 'attendee' ? () => promote(peer.socketId, peer.name) : null}
            onDemote={peer.role === 'panelist' ? () => demote(peer.socketId, peer.name) : null}
          />
        ))}
      </div>
    </div>
  );
}

function ParticipantRow({ name, role, isSelf, handRaised, roleBadge, isHost, onMute, onRemove, onPromote, onDemote }) {
  const initials = (name || '?').split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).slice(0, 2).join('');
  const avatarColor = isSelf ? 'bg-blue-600' : 'bg-gray-600';

  return (
    <div className={`flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-gray-800 group transition-colors ${handRaised ? 'bg-yellow-900/20' : ''}`}>
      <div className={`relative w-8 h-8 rounded-full ${avatarColor} flex items-center justify-center text-xs font-semibold text-white flex-shrink-0 ${handRaised ? 'ring-2 ring-yellow-400 ring-offset-1 ring-offset-gray-900' : ''}`}>
        {initials}
        {handRaised && <span className="absolute -top-1.5 -right-1.5 text-sm animate-bounce">✋</span>}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-white truncate">
          {name} {isSelf && <span className="text-gray-500 text-xs">(You)</span>}
        </p>
        <span className={`inline-block text-xs px-1.5 py-0 rounded capitalize mt-0.5 ${roleBadge[role] || roleBadge.attendee}`}>
          {role === 'panelist' ? 'Co-Host' : role}
        </span>
      </div>

      {isHost && !isSelf && (
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={onMute}   title="Mute"   className="text-xs text-yellow-400 hover:text-yellow-300 px-1.5 py-1 rounded hover:bg-gray-700 transition-colors">🔇</button>
          {onPromote && (
            <button onClick={onPromote} title="Make Co-Host" className="text-xs text-green-400 hover:text-green-300 px-1.5 py-1 rounded hover:bg-gray-700 transition-colors">⬆️</button>
          )}
          {onDemote && (
            <button onClick={onDemote} title="Remove Co-Host" className="text-xs text-orange-400 hover:text-orange-300 px-1.5 py-1 rounded hover:bg-gray-700 transition-colors">⬇️</button>
          )}
          <button onClick={onRemove} title="Kick Out" className="text-xs text-red-400 hover:text-red-300 px-1.5 py-1 rounded hover:bg-gray-700 transition-colors">✕</button>
        </div>
      )}
    </div>
  );
}
