const mediasoup = require('mediasoup');
const mediasoupConfig = require('../config/mediasoup');

let worker = null;

// Map of webinarId -> { router, peers: Map<socketId, peerData> }
const rooms = new Map();
// Pending room creation promises — prevents duplicate routers on concurrent joins
const pendingRooms = new Map();

async function createWorker() {
  worker = await mediasoup.createWorker(mediasoupConfig.worker);

  worker.on('died', (error) => {
    console.error('mediasoup Worker died, exiting in 2 seconds... [pid:%d] [error:%o]', worker.pid, error);
    setTimeout(() => process.exit(1), 2000);
  });

  console.log('mediasoup Worker created [pid:%d]', worker.pid);
  return worker;
}

async function getOrCreateRoom(webinarId) {
  if (rooms.has(webinarId)) return rooms.get(webinarId);
  if (pendingRooms.has(webinarId)) return pendingRooms.get(webinarId);

  const promise = (async () => {
    const router = await worker.createRouter({ mediaCodecs: mediasoupConfig.router.mediaCodecs });
    const room = {
      router,
      peers: new Map(), // socketId -> { socket, userId, name, role, producers: Map, consumers: Map, transports: Map }
      chatMessages: [],
      qaQuestions: [],
      polls: [],
      recording: false,
    };
    rooms.set(webinarId, room);
    pendingRooms.delete(webinarId);
    console.log('Room created for webinar:', webinarId);
    return room;
  })();

  pendingRooms.set(webinarId, promise);
  return promise;
}

function getRoom(webinarId) {
  return rooms.get(webinarId);
}

function removeRoom(webinarId) {
  const room = rooms.get(webinarId);
  if (room) {
    room.router.close();
    rooms.delete(webinarId);
    console.log('Room removed for webinar:', webinarId);
  }
}

function getWorker() {
  return worker;
}

module.exports = { createWorker, getOrCreateRoom, getRoom, removeRoom, getWorker, rooms };
