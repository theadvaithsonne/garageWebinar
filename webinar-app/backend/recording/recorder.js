const { spawn } = require('child_process');
const path       = require('path');
const fs         = require('fs');
const dgram      = require('dgram');

let ffmpegPath = 'ffmpeg';
try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; } catch {}

const recordingsDir = path.join(__dirname, '../recordings');
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

function toFFmpegPath(p) { return p.replace(/\\/g, '/'); }

// Find a free UDP port pair by actually binding a UDP socket
function findFreeUdpPort(start) {
  return new Promise((resolve, reject) => {
    const sock = dgram.createSocket('udp4');
    sock.bind(start, '127.0.0.1', () => {
      const port = sock.address().port;
      sock.close(() => resolve(port));
    });
    sock.on('error', () => findFreeUdpPort(start + 2).then(resolve, reject));
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

class Recorder {
  constructor(webinarId) {
    this.webinarId    = webinarId;
    this.process      = null;
    this.transports   = [];
    this.consumers    = [];
    this.sdpFile      = null;
    this.filename     = null;
    this._stopResolve = null;
  }

  async start(router, audioProducerId, videoProducerId) {
    const ts      = Date.now();
    this.filename = `${this.webinarId}_${ts}.mp4`;
    const outPath = path.join(recordingsDir, this.filename);
    const sdpPath = path.join(recordingsDir, `${this.webinarId}_${ts}.sdp`);
    this.sdpFile  = sdpPath;

    const tOpts  = { listenIp: { ip: '127.0.0.1' }, rtcpMux: false, comedia: false };
    const streams = [];

    // ── Audio consumer ────────────────────────────────────────────────────
    if (audioProducerId) {
      const port     = await findFreeUdpPort(10000);
      const rtcpPort = port + 1;
      const transport = await router.createPlainTransport(tOpts);
      await transport.connect({ ip: '127.0.0.1', port, rtcpPort });
      const consumer = await transport.consume({
        producerId:      audioProducerId,
        rtpCapabilities: router.rtpCapabilities,
        paused:          true,
      });
      this.transports.push(transport);
      this.consumers.push(consumer);
      streams.push({ kind: 'audio', port, rtpParameters: consumer.rtpParameters });
      console.log(`[Recorder] Audio → UDP port ${port}`);
    }

    // ── Video consumer ────────────────────────────────────────────────────
    if (videoProducerId) {
      const port     = await findFreeUdpPort(12000);
      const rtcpPort = port + 1;
      const transport = await router.createPlainTransport(tOpts);
      await transport.connect({ ip: '127.0.0.1', port, rtcpPort });
      const consumer = await transport.consume({
        producerId:      videoProducerId,
        rtpCapabilities: router.rtpCapabilities,
        paused:          true,
      });
      this.transports.push(transport);
      this.consumers.push(consumer);
      streams.push({ kind: 'video', port, rtpParameters: consumer.rtpParameters, consumer });
      console.log(`[Recorder] Video → UDP port ${port}`);
    }

    if (!streams.length) throw new Error('No streams to record');

    // ── STEP 1: Resume consumers so RTP starts flowing NOW ────────────────
    // Packets will be dropped by OS (no listener yet) but this triggers
    // the browser's encoder to produce frames including keyframes.
    for (const c of this.consumers) {
      await c.resume().catch(() => {});
    }
    console.log('[Recorder] Consumers resumed — RTP flowing');

    // ── STEP 2: Write combined SDP ────────────────────────────────────────
    const sdpLines = [
      'v=0', 'o=- 0 0 IN IP4 127.0.0.1', 's=WebinarRecording',
      'c=IN IP4 127.0.0.1', 't=0 0',
    ];
    const hasAudio = streams.some((s) => s.kind === 'audio');
    const hasVideo = streams.some((s) => s.kind === 'video');

    for (const s of streams) {
      const codec = s.rtpParameters.codecs[0];
      const pt    = codec.payloadType;
      const mime  = codec.mimeType.split('/')[1].toUpperCase();
      if (s.kind === 'audio') {
        const ch = codec.channels || 2;
        sdpLines.push(
          `m=audio ${s.port} RTP/AVP ${pt}`,
          `a=rtpmap:${pt} ${mime}/${codec.clockRate}/${ch}`,
          'a=recvonly',
        );
      } else {
        sdpLines.push(
          `m=video ${s.port} RTP/AVP ${pt}`,
          `a=rtpmap:${pt} ${mime}/${codec.clockRate}`,
          'a=recvonly',
        );
      }
    }
    sdpLines.push('');
    const sdpContent = sdpLines.join('\r\n');
    fs.writeFileSync(sdpPath, sdpContent);
    console.log('[Recorder] SDP written:\n' + sdpContent);

    // ── STEP 3: Spawn FFmpeg immediately — it opens UDP sockets ──────────
    const ffArgs = [
      '-y',
      '-probesize',       '50000000',   // 50 MB probe buffer
      '-analyzeduration', '5000000',    // 5 seconds probe window
      '-protocol_whitelist', 'file,crypto,data,rtp,udp',
      '-f', 'sdp', '-i', toFFmpegPath(sdpPath),
    ];

    // Map streams
    let aIdx = -1, vIdx = -1, i = 0;
    for (const s of streams) {
      if (s.kind === 'audio') aIdx = i;
      else                    vIdx = i;
      i++;
    }
    if (aIdx >= 0) ffArgs.push('-map', `0:${aIdx}`);
    if (vIdx >= 0) ffArgs.push('-map', `0:${vIdx}`);
    if (hasAudio)  ffArgs.push('-c:a', 'aac', '-ar', '48000', '-b:a', '128k');
    if (hasVideo)  ffArgs.push('-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '28', '-pix_fmt', 'yuv420p');
    if (!hasVideo) ffArgs.push('-vn');
    ffArgs.push('-movflags', '+faststart', toFFmpegPath(outPath));

    console.log('[Recorder] Spawning FFmpeg...');
    console.log('[Recorder] Args:', ffArgs.join(' '));

    this.process = spawn(ffmpegPath, ffArgs, { stdio: ['pipe', 'ignore', 'pipe'] });

    let stderrBuf = '';
    this.process.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderrBuf  += chunk;
      if (/frame=|fps=|error|invalid|failed|unspecified/i.test(chunk)) {
        process.stdout.write('[FFmpeg] ' + chunk);
      }
    });

    this.process.on('error', (err) => {
      console.error('[Recorder] FFmpeg spawn error:', err.message);
    });

    this.process.on('close', (code) => {
      console.log(`[Recorder] FFmpeg exited, code=${code}`);
      if (code !== 0) {
        console.error('[Recorder] FFmpeg stderr tail:\n' + stderrBuf.slice(-3000));
      }
      this._cleanSdp();
      if (this._stopResolve) {
        this._stopResolve(this.filename);
        this._stopResolve = null;
      }
    });

    // ── STEP 4: After 500ms FFmpeg has opened UDP sockets.
    //           Request a keyframe so FFmpeg can detect video resolution. ──
    await sleep(500);
    for (const s of streams) {
      if (s.kind === 'video' && s.consumer) {
        await s.consumer.requestKeyFrame().catch(() => {});
        console.log('[Recorder] Keyframe requested from video consumer');
      }
    }

    // ── STEP 5: Wait for FFmpeg to probe & confirm it's alive ─────────────
    await sleep(4000);
    if (!this.process || this.process.exitCode !== null) {
      throw new Error('FFmpeg exited during probe:\n' + stderrBuf.slice(-2000));
    }
    console.log('[Recorder] FFmpeg confirmed running — recording active');
    return this.filename;
  }

  stop() {
    this.consumers.forEach((c)  => { try { c.close();  } catch {} });
    this.transports.forEach((t) => { try { t.close();  } catch {} });
    this.consumers  = [];
    this.transports = [];

    if (!this.process || this.process.exitCode !== null) {
      this._cleanSdp();
      return Promise.resolve(this.filename);
    }

    return new Promise((resolve) => {
      this._stopResolve = resolve;
      try {
        this.process.stdin.write('q\n');
        this.process.stdin.end();
      } catch {}
      // Force kill after 10s if graceful stop fails
      setTimeout(() => {
        if (this.process && this.process.exitCode === null) {
          console.warn('[Recorder] Force-killing FFmpeg');
          try { this.process.kill('SIGKILL'); } catch {}
        }
      }, 10000);
    });
  }

  _cleanSdp() {
    if (this.sdpFile && fs.existsSync(this.sdpFile)) {
      try { fs.unlinkSync(this.sdpFile); } catch {}
    }
    this.sdpFile = null;
  }
}

module.exports = Recorder;
