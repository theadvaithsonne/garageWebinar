import { Device } from 'mediasoup-client';

let device = null;

export function getDevice() {
  return device;
}

export async function loadDevice(rtpCapabilities) {
  device = new Device();
  await device.load({ routerRtpCapabilities: rtpCapabilities });
  return device;
}

export function resetDevice() {
  device = null;
}

export async function createSendTransport(socket, webinarId) {
  return new Promise((resolve, reject) => {
    socket.emit('createWebRtcTransport', { webinarId, consuming: false }, async (response) => {
      if (!response.success) return reject(new Error(response.error));

      const transport = device.createSendTransport(response.params);

      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        socket.emit(
          'connectTransport',
          { webinarId, transportId: transport.id, dtlsParameters },
          (res) => {
            if (res.success) callback();
            else errback(new Error(res.error));
          }
        );
      });

      transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        socket.emit(
          'produce',
          { webinarId, transportId: transport.id, kind, rtpParameters, appData },
          (res) => {
            if (res.success) callback({ id: res.producerId });
            else errback(new Error(res.error));
          }
        );
      });

      resolve(transport);
    });
  });
}

export async function createRecvTransport(socket, webinarId) {
  return new Promise((resolve, reject) => {
    socket.emit('createWebRtcTransport', { webinarId, consuming: true }, async (response) => {
      if (!response.success) return reject(new Error(response.error));

      const transport = device.createRecvTransport(response.params);

      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        socket.emit(
          'connectTransport',
          { webinarId, transportId: transport.id, dtlsParameters },
          (res) => {
            if (res.success) callback();
            else errback(new Error(res.error));
          }
        );
      });

      resolve(transport);
    });
  });
}

export async function consumeStream(socket, webinarId, recvTransport, producerId) {
  return new Promise((resolve, reject) => {
    socket.emit(
      'consume',
      {
        webinarId,
        transportId: recvTransport.id,
        producerId,
        rtpCapabilities: device.rtpCapabilities,
      },
      async (response) => {
        if (!response.success) return reject(new Error(response.error));

        const consumer = await recvTransport.consume(response.params);

        // Resume the consumer server-side
        socket.emit('resumeConsumer', { webinarId, consumerId: consumer.id }, () => {});

        const stream = new MediaStream([consumer.track]);
        resolve({ consumer, stream });
      }
    );
  });
}
