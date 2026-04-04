const mediasoupConfig = require('../config/mediasoup');

async function createWebRtcTransport(router) {
  const transport = await router.createWebRtcTransport(mediasoupConfig.webRtcTransport);

  if (mediasoupConfig.webRtcTransport.maxIncomingBitrate) {
    try {
      await transport.setMaxIncomingBitrate(mediasoupConfig.webRtcTransport.maxIncomingBitrate);
    } catch (err) {
      // ignore
    }
  }

  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    },
  };
}

module.exports = { createWebRtcTransport };
