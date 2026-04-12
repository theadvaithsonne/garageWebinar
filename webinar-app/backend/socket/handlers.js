const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { getOrCreateRoom, getRoom, removeRoom, rooms } = require('../mediasoup/server');
const { createWebRtcTransport } = require('../mediasoup/transports');
const Message = require('../models/Message');
const Webinar = require('../models/Webinar');

// ── Simple per-socket rate limiter ──────────────────────────────────────────
function makeRateLimiter(maxPerMin) {
  const counts = new Map();
  function check(socketId) {
    const now = Date.now();
    const entry = counts.get(socketId) || { count: 0, reset: now + 60000 };
    if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
    entry.count++;
    counts.set(socketId, entry);
    return entry.count <= maxPerMin;
  }
  check.cleanup = (socketId) => counts.delete(socketId);
  return check;
}

const msgRateLimit  = makeRateLimiter(30);  // 30 chat msgs / min
const qaRateLimit   = makeRateLimiter(10);  // 10 questions / min
const voteRateLimit = makeRateLimiter(20);  // 20 votes / min

function setupSocketHandlers(io) {
  // ── Auth middleware (supports JWT users + guest attendees) ────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    const guestName = socket.handshake.auth?.guestName;

    // Authenticated user — verify JWT
    if (token) {
      try {
        socket.user = jwt.verify(token, process.env.JWT_SECRET);
        return next();
      } catch {
        return next(new Error('Invalid or expired token'));
      }
    }

    // Guest user — only needs a display name
    if (guestName && typeof guestName === 'string' && guestName.trim()) {
      socket.user = {
        userId: `guest_${socket.id}`,
        name: guestName.trim().slice(0, 50),
        email: null,
        role: 'attendee',
        isGuest: true,
      };
      return next();
    }

    return next(new Error('Authentication required'));
  });

  io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id} | user: ${socket.user?.name}`);

    // ── JOIN ROOM ──────────────────────────────────────────────────────────
    socket.on('joinRoom', async ({ webinarId, role, panelistToken }, callback) => {
      try {
        if (!webinarId || !mongoose.isValidObjectId(webinarId)) {
          return callback({ success: false, error: 'Invalid webinarId' });
        }

        // Verify role server-side — guests are always attendees
        let verifiedRole = 'attendee';
        const webinar = await Webinar.findById(webinarId);
        if (!webinar) return callback({ success: false, error: 'Webinar not found' });

        if (socket.user.isGuest) {
          verifiedRole = 'attendee'; // guests cannot be host or panelist
        } else if (role === 'host' && webinar.hostId.toString() === socket.user.userId) {
          verifiedRole = 'host';
          if (webinar.status === 'scheduled') {
            await Webinar.findByIdAndUpdate(webinarId, { status: 'live' });
          }
        } else if (panelistToken && webinar.panelistLink === panelistToken) {
          // Valid panelist token → grant panelist role
          verifiedRole = 'panelist';
        }

        const room = await getOrCreateRoom(webinarId);
        socket.join(webinarId);

        room.peers.set(socket.id, {
          socket,
          userId:    socket.user.userId,
          name:      socket.user.name,
          role:      verifiedRole,
          producers: new Map(),
          consumers: new Map(),
          transports: new Map(),
          handRaised: false,
        });

        await Webinar.findByIdAndUpdate(webinarId, { participantCount: room.peers.size });

        socket.to(webinarId).emit('peerJoined', {
          socketId: socket.id,
          userId:   socket.user.userId,
          name:     socket.user.name,
          role:     verifiedRole,
        });

        const messages = await Message.find({ webinarId })
          .sort({ timestamp: 1 })
          .limit(100)
          .lean();

        callback({
          success:         true,
          role:            verifiedRole,
          userId:          socket.user.userId,
          webinarTitle:    webinar.title,
          rtpCapabilities: room.router.rtpCapabilities,
          chatHistory:     messages.map((m) => ({
            id:        m._id.toString(),
            userId:    m.userId.toString(),
            userName:  m.userName,
            text:      m.text,
            timestamp: m.timestamp,
          })),
          qaQuestions: room.qaQuestions,
          polls:       room.polls,
          peers: Array.from(room.peers.entries())
            .filter(([id]) => id !== socket.id)
            .map(([id, p]) => ({
              socketId: id,
              userId:   p.userId,
              name:     p.name,
              role:     p.role,
            })),
        });
      } catch (err) {
        console.error('[joinRoom] error:', err);
        callback({ success: false, error: err.message });
      }
    });

    // ── CREATE WEBRTC TRANSPORT ────────────────────────────────────────────
    socket.on('createWebRtcTransport', async ({ webinarId, consuming }, callback) => {
      try {
        const room = getRoom(webinarId);
        if (!room) return callback({ success: false, error: 'Room not found' });

        const peer = room.peers.get(socket.id);
        if (!peer) return callback({ success: false, error: 'Peer not found in room' });

        const { transport, params } = await createWebRtcTransport(room.router);
        peer.transports.set(transport.id, transport);

        transport.on('dtlsstatechange', (state) => {
          if (state === 'closed') transport.close();
        });

        callback({ success: true, params });
      } catch (err) {
        console.error('[createWebRtcTransport] error:', err);
        callback({ success: false, error: err.message });
      }
    });

    // ── CONNECT TRANSPORT ─────────────────────────────────────────────────
    socket.on('connectTransport', async ({ webinarId, transportId, dtlsParameters }, callback) => {
      try {
        const room = getRoom(webinarId);
        if (!room) return callback({ success: false, error: 'Room not found' });

        const peer = room.peers.get(socket.id);
        const transport = peer?.transports.get(transportId);
        if (!transport) return callback({ success: false, error: 'Transport not found' });

        await transport.connect({ dtlsParameters });
        callback({ success: true });
      } catch (err) {
        console.error('[connectTransport] error:', err);
        callback({ success: false, error: err.message });
      }
    });

    // ── PRODUCE ───────────────────────────────────────────────────────────
    socket.on('produce', async ({ webinarId, transportId, kind, rtpParameters, appData }, callback) => {
      try {
        const room = getRoom(webinarId);
        if (!room) return callback({ success: false, error: 'Room not found' });

        const peer = room.peers.get(socket.id);
        if (!peer) return callback({ success: false, error: 'Peer not found' });

        // Only host/panelist (co-host) can produce media
        if (!['host', 'panelist'].includes(peer.role)) {
          return callback({ success: false, error: 'Attendees cannot produce media' });
        }

        const transport = peer.transports.get(transportId);
        if (!transport) return callback({ success: false, error: 'Transport not found' });

        const producer = await transport.produce({ kind, rtpParameters, appData: appData || {} });
        peer.producers.set(producer.id, producer);

        producer.on('transportclose', () => {
          producer.close();
          peer.producers.delete(producer.id);
        });

        socket.to(webinarId).emit('newProducer', {
          producerId:       producer.id,
          producerSocketId: socket.id,
          kind,
          appData,
        });

        callback({ success: true, producerId: producer.id });
      } catch (err) {
        console.error('[produce] error:', err);
        callback({ success: false, error: err.message });
      }
    });

    // ── CONSUME ───────────────────────────────────────────────────────────
    socket.on('consume', async ({ webinarId, transportId, producerId, rtpCapabilities }, callback) => {
      try {
        if (!producerId || !rtpCapabilities) {
          return callback({ success: false, error: 'Missing producerId or rtpCapabilities' });
        }
        const room = getRoom(webinarId);
        if (!room) return callback({ success: false, error: 'Room not found' });

        if (!room.router.canConsume({ producerId, rtpCapabilities })) {
          return callback({ success: false, error: 'Cannot consume this producer' });
        }

        const peer = room.peers.get(socket.id);
        const transport = peer?.transports.get(transportId);
        if (!transport) return callback({ success: false, error: 'Transport not found' });

        // Look up producer's appData so the consumer inherits it (needed for consumerClosed slot routing)
        let producerAppData = {};
        for (const [, p] of room.peers) {
          const prod = p.producers.get(producerId);
          if (prod) { producerAppData = prod.appData || {}; break; }
        }

        const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true, appData: producerAppData });
        peer.consumers.set(consumer.id, consumer);

        consumer.on('transportclose', () => {
          consumer.close();
          peer.consumers.delete(consumer.id);
        });
        consumer.on('producerclose', () => {
          // Find which peer owned this producer so the client can clean up the right stream
          let producerSocketId = null;
          for (const [sid, p] of room.peers) {
            if (p.producers.has(producerId)) { producerSocketId = sid; break; }
          }
          consumer.close();
          peer.consumers.delete(consumer.id);
          socket.emit('consumerClosed', {
            consumerId: consumer.id,
            producerSocketId,
            kind: consumer.kind,
            appData: consumer.appData,
          });
        });

        callback({
          success: true,
          params: {
            id:            consumer.id,
            producerId,
            kind:          consumer.kind,
            rtpParameters: consumer.rtpParameters,
            appData:       consumer.appData,
          },
        });
      } catch (err) {
        console.error('[consume] error:', err);
        callback({ success: false, error: err.message });
      }
    });

    // ── CLOSE PRODUCER (client explicitly stops a producer) ─────────────
    socket.on('closeProducer', ({ webinarId, producerId }) => {
      try {
        const room = getRoom(webinarId);
        if (!room) return;
        const peer = room.peers.get(socket.id);
        if (!peer) return;
        const producer = peer.producers.get(producerId);
        if (producer) {
          const appDataType = producer.appData?.type;
          producer.close();
          peer.producers.delete(producerId);
          // Direct broadcast for screen share — don't rely on consumer close chain
          if (appDataType === 'screen' || appDataType === 'screenAudio') {
            socket.to(webinarId).emit('screenShareStopped', {
              producerSocketId: socket.id,
              type: appDataType,
            });
          }
        }
      } catch (err) {
        console.error('[closeProducer] error:', err.message);
      }
    });

    // ── RESUME CONSUMER ───────────────────────────────────────────────────
    socket.on('resumeConsumer', async ({ webinarId, consumerId }, callback) => {
      try {
        const room = getRoom(webinarId);
        const peer = room?.peers.get(socket.id);
        const consumer = peer?.consumers.get(consumerId);
        if (consumer) await consumer.resume();
        callback?.({ success: true });
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    // ── GET PRODUCERS ─────────────────────────────────────────────────────
    socket.on('getProducers', ({ webinarId }, callback) => {
      const room = getRoom(webinarId);
      if (!room) return callback([]);

      const producers = [];
      room.peers.forEach((peer, socketId) => {
        if (socketId !== socket.id) {
          peer.producers.forEach((producer) => {
            producers.push({
              producerId:       producer.id,
              producerSocketId: socketId,
              kind:             producer.kind,
              appData:          producer.appData,
            });
          });
        }
      });
      callback(producers);
    });

    // ── CHAT ──────────────────────────────────────────────────────────────
    socket.on('sendMessage', async ({ webinarId, text }, callback) => {
      try {
        if (!msgRateLimit(socket.id)) {
          return callback?.({ success: false, error: 'Sending too fast. Slow down.' });
        }
        if (!text?.trim()) return callback?.({ success: false, error: 'Empty message' });
        const clean = text.trim().slice(0, 1000);

        const msg = await Message.create({
          webinarId,
          userId:   socket.user.userId,
          userName: socket.user.name,
          text:     clean,
        });

        io.to(webinarId).emit('newMessage', {
          id:        msg._id.toString(),
          userId:    socket.user.userId,
          userName:  socket.user.name,
          text:      clean,
          timestamp: msg.timestamp,
        });
        callback?.({ success: true });
      } catch (err) {
        console.error('[sendMessage] error:', err);
        callback?.({ success: false, error: 'Failed to send message' });
      }
    });

    // ── Q&A ───────────────────────────────────────────────────────────────
    socket.on('sendQA', ({ webinarId, question }, callback) => {
      try {
        if (!qaRateLimit(socket.id)) return callback?.({ success: false, error: 'Too many questions' });
        if (!question?.trim()) return callback?.({ success: false, error: 'Empty question' });
        const room = getRoom(webinarId);
        if (!room) return callback?.({ success: false, error: 'Room not found' });

        const qa = {
          id:         `${socket.id}-${Date.now()}`,
          userId:     socket.user.userId,
          userName:   socket.user.name,
          question:   question.trim().slice(0, 500),
          upvotes:    0,
          upvotedBy:  [],
          answered:   false,
          timestamp:  new Date(),
        };
        room.qaQuestions.push(qa);
        io.to(webinarId).emit('newQA', qa);
        callback?.({ success: true, qa });
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    socket.on('upvoteQA', ({ webinarId, questionId }, callback) => {
      const room = getRoom(webinarId);
      if (!room) return callback?.({ success: false });
      const qa = room.qaQuestions.find((q) => q.id === questionId);
      if (qa && !qa.upvotedBy.includes(socket.user.userId)) {
        qa.upvotes++;
        qa.upvotedBy.push(socket.user.userId);
        io.to(webinarId).emit('qaUpdated', qa);
        callback?.({ success: true });
      } else {
        callback?.({ success: false, error: 'Already upvoted' });
      }
    });

    socket.on('answerQA', ({ webinarId, questionId }, callback) => {
      const room = getRoom(webinarId);
      if (!room) return callback?.({ success: false });
      const peer = room.peers.get(socket.id);
      if (!peer || !['host', 'panelist'].includes(peer.role)) {
        return callback?.({ success: false, error: 'Unauthorized' });
      }
      const qa = room.qaQuestions.find((q) => q.id === questionId);
      if (qa) {
        qa.answered = true;
        io.to(webinarId).emit('qaUpdated', qa);
      }
      callback?.({ success: true });
    });

    // ── POLLS ─────────────────────────────────────────────────────────────
    socket.on('createPoll', ({ webinarId, question, options }, callback) => {
      try {
        const room = getRoom(webinarId);
        if (!room) return callback?.({ success: false, error: 'Room not found' });
        const peer = room.peers.get(socket.id);
        if (!peer || peer.role !== 'host') return callback?.({ success: false, error: 'Host only' });

        if (!question?.trim()) return callback?.({ success: false, error: 'Question required' });
        if (!Array.isArray(options) || options.length < 2 || options.length > 10) {
          return callback?.({ success: false, error: '2–10 options required' });
        }

        const poll = {
          id:        `poll-${Date.now()}`,
          question:  question.trim().slice(0, 300),
          options:   options
            .filter((o) => typeof o === 'string' && o.trim())
            .slice(0, 10)
            .map((opt, i) => ({ id: i.toString(), text: opt.trim().slice(0, 200), votes: 0 })),
          votedBy:   [],
          createdAt: new Date(),
        };
        room.polls.push(poll);
        io.to(webinarId).emit('newPoll', poll);
        callback?.({ success: true, poll });
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    socket.on('submitVote', ({ webinarId, pollId, optionId }, callback) => {
      if (!voteRateLimit(socket.id)) return callback?.({ success: false, error: 'Too fast' });
      const room = getRoom(webinarId);
      if (!room) return callback?.({ success: false });
      const poll = room.polls.find((p) => p.id === pollId);
      if (!poll) return callback?.({ success: false, error: 'Poll not found' });
      if (poll.votedBy.includes(socket.user.userId)) {
        return callback?.({ success: false, error: 'Already voted' });
      }
      const option = poll.options.find((o) => o.id === optionId);
      if (!option) return callback?.({ success: false, error: 'Option not found' });
      option.votes++;
      poll.votedBy.push(socket.user.userId);
      io.to(webinarId).emit('pollUpdated', poll);
      callback?.({ success: true });
    });

    // ── HOST CONTROLS ─────────────────────────────────────────────────────
    socket.on('muteParticipant', ({ webinarId, targetSocketId }, callback) => {
      const room = getRoom(webinarId);
      if (!room) return callback?.({ success: false });
      const peer = room.peers.get(socket.id);
      if (!peer || !['host', 'panelist'].includes(peer.role)) return callback?.({ success: false, error: 'Unauthorized' });
      io.to(targetSocketId).emit('forceMuted');
      callback?.({ success: true });
    });

    socket.on('removeParticipant', ({ webinarId, targetSocketId }, callback) => {
      const room = getRoom(webinarId);
      if (!room) return callback?.({ success: false });
      const peer = room.peers.get(socket.id);
      if (!peer || !['host', 'panelist'].includes(peer.role)) return callback?.({ success: false, error: 'Unauthorized' });

      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (targetSocket) {
        targetSocket.emit('removedFromRoom');
        targetSocket.leave(webinarId);
        setTimeout(() => targetSocket.disconnect(true), 500);
      }
      room.peers.delete(targetSocketId);
      io.to(webinarId).emit('peerLeft', { socketId: targetSocketId });
      callback?.({ success: true });
    });

    socket.on('promoteToHost', ({ webinarId, targetSocketId }, callback) => {
      const room = getRoom(webinarId);
      if (!room) return callback?.({ success: false });
      const peer = room.peers.get(socket.id);
      if (!peer || !['host', 'panelist'].includes(peer.role)) return callback?.({ success: false, error: 'Unauthorized' });
      const targetPeer = room.peers.get(targetSocketId);
      if (targetPeer) {
        targetPeer.role = 'panelist';
        io.to(targetSocketId).emit('roleChanged', { role: 'panelist' });
        io.to(webinarId).emit('peerRoleChanged', { socketId: targetSocketId, role: 'panelist' });
      }
      callback?.({ success: true });
    });

    socket.on('demoteToAttendee', ({ webinarId, targetSocketId }, callback) => {
      const room = getRoom(webinarId);
      if (!room) return callback?.({ success: false });
      const peer = room.peers.get(socket.id);
      if (!peer || !['host', 'panelist'].includes(peer.role)) return callback?.({ success: false, error: 'Unauthorized' });
      const targetPeer = room.peers.get(targetSocketId);
      if (targetPeer) {
        targetPeer.role = 'attendee';
        // Close all producers for the demoted user (they lose media rights)
        targetPeer.producers.forEach((producer) => {
          try { producer.close(); } catch {}
        });
        targetPeer.producers.clear();
        io.to(targetSocketId).emit('roleChanged', { role: 'attendee' });
        io.to(webinarId).emit('peerRoleChanged', { socketId: targetSocketId, role: 'attendee' });
      }
      callback?.({ success: true });
    });

    socket.on('raiseHand', ({ webinarId }, callback) => {
      const room = getRoom(webinarId);
      if (!room) return callback?.({ success: false });
      const peer = room.peers.get(socket.id);
      if (peer) {
        peer.handRaised = !peer.handRaised;
        io.to(webinarId).emit('handRaised', {
          socketId: socket.id,
          userId:   socket.user.userId,
          name:     socket.user.name,
          raised:   peer.handRaised,
        });
      }
      callback?.({ success: true });
    });

    // ── MIC STATE (broadcast to peers) ──────────────────────────────────
    socket.on('micState', ({ webinarId, muted }) => {
      socket.to(webinarId).emit('peerMicState', { socketId: socket.id, muted: !!muted });
    });

    // ── UPDATE DISPLAY NAME ──────────────────────────────────────────────
    socket.on('updateName', ({ webinarId, name }, callback) => {
      try {
        const cleanName = (name || '').trim().slice(0, 50);
        if (!cleanName) return callback?.({ success: false, error: 'Name cannot be empty' });
        const room = getRoom(webinarId);
        if (!room) return callback?.({ success: false, error: 'Room not found' });
        const peer = room.peers.get(socket.id);
        if (!peer) return callback?.({ success: false, error: 'Peer not found' });
        peer.name = cleanName;
        socket.user.name = cleanName;
        io.to(webinarId).emit('peerNameChanged', { socketId: socket.id, name: cleanName });
        callback?.({ success: true });
      } catch (err) {
        callback?.({ success: false, error: err.message });
      }
    });

    // ── EMOJI REACTION ────────────────────────────────────────────────────
    socket.on('sendReaction', ({ webinarId, emoji }) => {
      const ALLOWED_EMOJIS = ['👍','❤️','😂','😮','👏','🔥','🎉','💯'];
      if (!ALLOWED_EMOJIS.includes(emoji)) return;
      const room = getRoom(webinarId);
      if (!room) return;
      const peer = room.peers.get(socket.id);
      io.to(webinarId).emit('reaction', {
        socketId: socket.id,
        name:     peer?.name || 'Someone',
        emoji,
      });
    });

    // ── RECORDING ─────────────────────────────────────────────────────────
    // Recording is done client-side via MediaRecorder (tab capture) and
    // uploaded as WebM → converted to MP4 by the /api/webinars/:id/recording route.
    // These handlers only broadcast recording state to all participants.
    socket.on('startRecording', ({ webinarId }, callback) => {
      const room = getRoom(webinarId);
      if (!room) return callback?.({ success: false, error: 'Room not found' });
      const peer = room.peers.get(socket.id);
      if (!peer || peer.role !== 'host') return callback?.({ success: false, error: 'Unauthorized' });
      if (room.recording) return callback?.({ success: false, error: 'Already recording' });

      room.recording = true;
      io.to(webinarId).emit('recordingStarted');
      callback?.({ success: true });
    });

    socket.on('stopRecording', ({ webinarId }, callback) => {
      const room = getRoom(webinarId);
      if (!room) return callback?.({ success: false, error: 'Room not found' });
      const peer = room.peers.get(socket.id);
      if (!peer || peer.role !== 'host') return callback?.({ success: false, error: 'Unauthorized' });
      if (!room.recording) return callback?.({ success: false, error: 'Not recording' });

      room.recording = false;
      io.to(webinarId).emit('recordingStopped');
      callback?.({ success: true });
    });

    // ── END WEBINAR ───────────────────────────────────────────────────────
    socket.on('endWebinar', async ({ webinarId }, callback) => {
      try {
        const room = getRoom(webinarId);
        if (!room) return callback?.({ success: false });
        const peer = room.peers.get(socket.id);
        if (!peer || peer.role !== 'host') return callback?.({ success: false, error: 'Unauthorized' });

        if (room.recording) {
          room.recording = false;
          io.to(webinarId).emit('recordingStopped');
        }
        await Webinar.findByIdAndUpdate(webinarId, { status: 'ended' });
        io.to(webinarId).emit('webinarEnded');
        // Clean up room from memory
        removeRoom(webinarId);
        callback?.({ success: true });
      } catch (err) {
        console.error('[endWebinar] error:', err);
        callback?.({ success: false, error: err.message });
      }
    });

    // ── DISCONNECT ────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
      // Clean up rate limiter entries for this socket
      msgRateLimit.cleanup(socket.id);
      qaRateLimit.cleanup(socket.id);
      voteRateLimit.cleanup(socket.id);
      try {
        for (const [webinarId, room] of rooms.entries()) {
          const peer = room.peers.get(socket.id);
          if (!peer) continue;

          // Close all transports (closes producers/consumers too)
          peer.transports.forEach((t) => { try { t.close(); } catch {} });
          room.peers.delete(socket.id);

          socket.to(webinarId).emit('peerLeft', { socketId: socket.id });
          await Webinar.findByIdAndUpdate(webinarId, { participantCount: room.peers.size })
            .catch(() => {});

          // Remove room from memory when it becomes empty
          if (room.peers.size === 0) {
            removeRoom(webinarId);
            console.log(`[Socket] Room ${webinarId} removed — no peers remaining`);
          }
        }
      } catch (err) {
        console.error('[disconnect] cleanup error:', err);
      }
    });
  });
}

module.exports = { setupSocketHandlers };
