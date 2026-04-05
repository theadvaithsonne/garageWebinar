const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const multer    = require('multer');
const { spawn } = require('child_process');
const mongoose  = require('mongoose');
const Webinar   = require('../models/Webinar');
const { verifyToken } = require('../middleware/auth');

// ── ObjectId validation ───────────────────────────────────────────────────────
function validateId(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid webinar ID' });
  }
  next();
}

// ── Optional auth (for public webinar info) ───────────────────────────────────
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    const jwt = require('jsonwebtoken');
    try {
      req.user = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    } catch { /* invalid token — treat as unauthenticated */ }
  }
  next();
}

// ── FFmpeg path ───────────────────────────────────────────────────────────────
let ffmpegPath = 'ffmpeg';
try {
  ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
  console.log('[FFmpeg] Using installer path:', ffmpegPath);
} catch {
  console.log('[FFmpeg] Using system ffmpeg');
}

// ── Convert WebM → MP4 with timeout ──────────────────────────────────────────
function convertToMp4(inputPath, outputPath, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, [
      '-y',
      '-i', inputPath,
      // Video: h264, fast encode, web-compatible
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-pix_fmt', 'yuv420p',
      // Audio: AAC 128k stereo — handles mono/stereo/multi-channel input
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ac', '2',              // force stereo output
      '-ar', '48000',          // 48kHz sample rate
      // Optimize for web streaming
      '-movflags', '+faststart',
      outputPath,
    ]);

    let stderr = '';
    const MAX_STDERR = 4096;

    ff.stderr.on('data', (d) => {
      stderr += d.toString();
      // Cap stderr buffer to avoid unbounded memory growth
      if (stderr.length > MAX_STDERR) stderr = stderr.slice(-MAX_STDERR);
    });

    // Kill FFmpeg if it takes too long
    const timer = setTimeout(() => {
      ff.kill('SIGKILL');
      reject(new Error(`FFmpeg timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    ff.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}:\n${stderr.slice(-1000)}`));
      }
    });

    ff.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`FFmpeg spawn error: ${err.message}. Is ffmpeg installed?`));
    });
  });
}

// ── Recordings directory ──────────────────────────────────────────────────────
const recordingsDir = path.join(__dirname, '../recordings');
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

// ── Multer — only accept video/webm ──────────────────────────────────────────
const storage = multer.diskStorage({
  destination: recordingsDir,
  filename: (req, file, cb) => {
    // Unique name: webinarId_timestamp.webm
    cb(null, `${req.params.id}_${Date.now()}.webm`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB max
  fileFilter: (req, file, cb) => {
    const allowed = ['video/webm', 'video/mp4', 'video/x-matroska', 'application/octet-stream'];
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.webm')) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only WebM video accepted.`));
    }
  },
});

// ── Filename safety check ─────────────────────────────────────────────────────
function isSafeFilename(filename) {
  if (!filename || filename.includes('..')) return false;
  // Only allow exactly one extension, and only mp4/webm/mkv
  return /^[a-zA-Z0-9_\-]+\.(mp4|webm|mkv)$/.test(filename);
}

// ── Safe file delete (async, non-throwing) ────────────────────────────────────
async function safeDelete(filePath) {
  try { await fs.promises.unlink(filePath); } catch {}
}

const router = express.Router();

// ── POST /api/webinars ────────────────────────────────────────────────────────
router.post('/', verifyToken, async (req, res) => {
  try {
    const { title, description, scheduledAt } = req.body;
    if (!title?.trim())   return res.status(400).json({ message: 'Title is required' });
    if (!scheduledAt)     return res.status(400).json({ message: 'scheduledAt is required' });
    if (isNaN(Date.parse(scheduledAt))) return res.status(400).json({ message: 'Invalid date' });
    if (title.trim().length > 200) return res.status(400).json({ message: 'Title too long' });

    const webinar = await Webinar.create({
      title:       title.trim(),
      description: description?.trim() || '',
      scheduledAt,
      hostId:      req.user.userId,
      status:      'scheduled',
    });
    res.status(201).json(webinar);
  } catch (err) {
    console.error('Create webinar error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /api/webinars ─────────────────────────────────────────────────────────
router.get('/', verifyToken, async (req, res) => {
  try {
    const webinars = await Webinar.find({ hostId: req.user.userId })
      .sort({ scheduledAt: -1 })
      .limit(100)
      .lean();
    res.json(webinars);
  } catch (err) {
    console.error('List webinars error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /api/webinars/:id — public (join page) ────────────────────────────────
router.get('/:id', optionalAuth, validateId, async (req, res) => {
  try {
    const webinar = await Webinar.findById(req.params.id)
      .populate('hostId', 'name')
      .lean();
    if (!webinar) return res.status(404).json({ message: 'Webinar not found' });

    const isHost = req.user && webinar.hostId._id?.toString() === req.user.userId;
    if (!isHost) {
      delete webinar.panelistLink;
      delete webinar.hostLink;
      delete webinar.recordingFile;
    }
    res.json(webinar);
  } catch (err) {
    console.error('Get webinar error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── DELETE /api/webinars/:id ──────────────────────────────────────────────────
router.delete('/:id', verifyToken, validateId, async (req, res) => {
  try {
    const webinar = await Webinar.findById(req.params.id);
    if (!webinar) return res.status(404).json({ message: 'Webinar not found' });
    if (webinar.hostId.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (webinar.recordingFile && isSafeFilename(webinar.recordingFile)) {
      await safeDelete(path.join(recordingsDir, webinar.recordingFile));
    }
    await webinar.deleteOne();
    res.json({ message: 'Webinar deleted' });
  } catch (err) {
    console.error('Delete webinar error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── GET /api/webinars/:id/recording ──────────────────────────────────────────
router.get('/:id/recording', verifyToken, validateId, async (req, res) => {
  try {
    const webinar = await Webinar.findById(req.params.id).lean();
    if (!webinar) return res.status(404).json({ message: 'Webinar not found' });
    if (webinar.hostId.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (!webinar.recordingFile) {
      return res.status(404).json({ message: 'No recording available' });
    }
    if (!isSafeFilename(webinar.recordingFile)) {
      return res.status(400).json({ message: 'Invalid recording filename' });
    }
    const filePath = path.join(recordingsDir, webinar.recordingFile);
    try {
      await fs.promises.access(filePath);
    } catch {
      return res.status(404).json({ message: 'Recording file not found on disk' });
    }
    res.json({ downloadUrl: `/recordings/${webinar.recordingFile}`, filename: webinar.recordingFile });
  } catch (err) {
    console.error('Get recording error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ── POST /api/webinars/:id/recording — upload WebM, convert to MP4 ────────────
router.post('/:id/recording', verifyToken, validateId, (req, res, next) => {
  // Run multer and handle its errors explicitly
  upload.single('recording')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ message: 'Recording file too large (max 2 GB)' });
      }
      return res.status(400).json({ message: 'Upload error: ' + err.message });
    }
    if (err) {
      return res.status(400).json({ message: err.message });
    }
    next();
  });
}, async (req, res) => {
  const webmPath = req.file?.path; // track for cleanup on error

  try {
    const webinar = await Webinar.findById(req.params.id);
    if (!webinar) {
      if (webmPath) await safeDelete(webmPath);
      return res.status(404).json({ message: 'Webinar not found' });
    }
    if (webinar.hostId.toString() !== req.user.userId) {
      if (webmPath) await safeDelete(webmPath);
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'No recording file uploaded' });
    }

    const webmSize = req.file.size;
    if (webmSize < 1024) {
      await safeDelete(webmPath);
      return res.status(400).json({ message: 'Recording file is empty' });
    }

    console.log(`[Recording] Received ${(webmSize / 1024 / 1024).toFixed(1)} MB WebM for webinar ${req.params.id}`);

    // Use provided title (from frontend) or fall back to webinarId-based name
    const rawTitle = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const safeName = rawTitle
      ? rawTitle.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase().slice(0, 80)
      : req.params.id;
    const mp4Name = `${safeName}_${Date.now()}.mp4`;
    const mp4Path = path.join(recordingsDir, mp4Name);

    let finalFile = req.file.filename; // default: keep WebM if conversion fails

    try {
      console.log(`[Recording] Converting ${req.file.filename} → ${mp4Name} ...`);
      await convertToMp4(webmPath, mp4Path);

      // Verify MP4 was actually created and has content
      const mp4Stat = await fs.promises.stat(mp4Path).catch(() => null);
      if (mp4Stat && mp4Stat.size > 1024) {
        await safeDelete(webmPath); // clean up WebM
        finalFile = mp4Name;
        console.log(`[Recording] Conversion done: ${mp4Name} (${(mp4Stat.size / 1024 / 1024).toFixed(1)} MB)`);
      } else {
        console.warn('[Recording] MP4 output missing or empty, keeping WebM');
        await safeDelete(mp4Path);
      }
    } catch (convErr) {
      console.error('[Recording] Conversion failed, keeping WebM:', convErr.message);
      await safeDelete(mp4Path).catch(() => {}); // clean up failed mp4
      // finalFile stays as WebM — still downloadable
    }

    // Delete old recording file if replacing
    if (webinar.recordingFile && isSafeFilename(webinar.recordingFile)) {
      const oldPath = path.join(recordingsDir, webinar.recordingFile);
      if (webinar.recordingFile !== finalFile) {
        await safeDelete(oldPath);
      }
    }

    await Webinar.findByIdAndUpdate(req.params.id, { recordingFile: finalFile });
    console.log('[Recording] Saved to DB:', finalFile);

    res.json({ filename: finalFile, converted: finalFile.endsWith('.mp4') });
  } catch (err) {
    console.error('Upload recording error:', err);
    if (webmPath) await safeDelete(webmPath).catch(() => {});
    res.status(500).json({ message: 'Server error processing recording' });
  }
});

module.exports = router;
