const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const multer    = require('multer');
const { spawn } = require('child_process');
const mongoose  = require('mongoose');
const Webinar   = require('../models/Webinar');
const { verifyToken } = require('../middleware/auth');

// Middleware: validate :id is a proper MongoDB ObjectId
function validateId(req, res, next) {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({ message: 'Invalid webinar ID' });
  }
  next();
}

let ffmpegPath = 'ffmpeg';
try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; } catch {}

function convertToMp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, [
      '-y', '-i', inputPath,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      outputPath,
    ]);
    let err = '';
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('FFmpeg conversion failed:\n' + err.slice(-500)));
    });
    ff.on('error', reject);
  });
}

const router = express.Router();
const recordingsDir = path.join(__dirname, '../recordings');
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: recordingsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.webm';
    cb(null, `${req.params.id}_${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } }); // 2 GB max

// Sanitize filename — only allow alphanumeric, underscores, hyphens, dots
function isSafeFilename(filename) {
  return /^[a-zA-Z0-9_\-\.]+$/.test(filename) && !filename.includes('..');
}

// POST /api/webinars
router.post('/', verifyToken, async (req, res) => {
  try {
    const { title, description, scheduledAt } = req.body;

    if (!title?.trim()) return res.status(400).json({ message: 'Title is required' });
    if (!scheduledAt)   return res.status(400).json({ message: 'scheduledAt is required' });
    if (isNaN(Date.parse(scheduledAt))) return res.status(400).json({ message: 'Invalid date' });
    if (title.trim().length > 200) return res.status(400).json({ message: 'Title too long' });

    const webinar = await Webinar.create({
      title: title.trim(),
      description: description?.trim() || '',
      scheduledAt,
      hostId: req.user.userId,
      status: 'scheduled',
    });

    res.status(201).json(webinar);
  } catch (err) {
    console.error('Create webinar error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/webinars
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

// GET /api/webinars/:id
router.get('/:id', verifyToken, validateId, async (req, res) => {
  try {
    const webinar = await Webinar.findById(req.params.id)
      .populate('hostId', 'name email')
      .lean();
    if (!webinar) return res.status(404).json({ message: 'Webinar not found' });

    // Only expose panelistLink to the host
    if (webinar.hostId._id?.toString() !== req.user.userId) {
      delete webinar.panelistLink;
    }
    res.json(webinar);
  } catch (err) {
    console.error('Get webinar error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/webinars/:id
router.delete('/:id', verifyToken, validateId, async (req, res) => {
  try {
    const webinar = await Webinar.findById(req.params.id);
    if (!webinar) return res.status(404).json({ message: 'Webinar not found' });
    if (webinar.hostId.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    // Clean up recording file if exists
    if (webinar.recordingFile && isSafeFilename(webinar.recordingFile)) {
      const recPath = path.join(recordingsDir, webinar.recordingFile);
      if (fs.existsSync(recPath)) fs.unlinkSync(recPath);
    }

    await webinar.deleteOne();
    res.json({ message: 'Webinar deleted' });
  } catch (err) {
    console.error('Delete webinar error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/webinars/:id/recording
router.get('/:id/recording', verifyToken, validateId, async (req, res) => {
  try {
    const webinar = await Webinar.findById(req.params.id).lean();
    if (!webinar) return res.status(404).json({ message: 'Webinar not found' });

    // Only host can access recording info
    if (webinar.hostId.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    if (!webinar.recordingFile) {
      return res.status(404).json({ message: 'No recording available' });
    }

    // Security: validate filename before serving
    if (!isSafeFilename(webinar.recordingFile)) {
      return res.status(400).json({ message: 'Invalid recording filename' });
    }

    const recordingPath = path.join(recordingsDir, webinar.recordingFile);
    if (!fs.existsSync(recordingPath)) {
      return res.status(404).json({ message: 'Recording file not found on disk' });
    }

    res.json({
      downloadUrl: `/recordings/${webinar.recordingFile}`,
      filename: webinar.recordingFile,
    });
  } catch (err) {
    console.error('Get recording error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/webinars/:id/recording  — upload WebM, convert to MP4
router.post('/:id/recording', verifyToken, validateId, upload.single('recording'), async (req, res) => {
  try {
    const webinar = await Webinar.findById(req.params.id);
    if (!webinar) return res.status(404).json({ message: 'Webinar not found' });
    if (webinar.hostId.toString() !== req.user.userId) {
      return res.status(403).json({ message: 'Forbidden' });
    }
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });

    const webmPath  = req.file.path;
    const mp4Name   = req.file.filename.replace(/\.\w+$/, '') + '.mp4';
    const mp4Path   = path.join(recordingsDir, mp4Name);

    console.log(`[Recording] Converting ${req.file.filename} → ${mp4Name} ...`);
    try {
      await convertToMp4(webmPath, mp4Path);
      fs.unlinkSync(webmPath); // remove original WebM after conversion
      console.log(`[Recording] Conversion done: ${mp4Name}`);
    } catch (convErr) {
      console.error('[Recording] Conversion failed, keeping WebM:', convErr.message);
      // Keep the WebM if conversion fails — still downloadable
    }

    const finalFile = fs.existsSync(mp4Path) ? mp4Name : req.file.filename;

    // Remove old recording if exists
    if (webinar.recordingFile && isSafeFilename(webinar.recordingFile)) {
      const old = path.join(recordingsDir, webinar.recordingFile);
      if (fs.existsSync(old)) try { fs.unlinkSync(old); } catch {}
    }

    await Webinar.findByIdAndUpdate(req.params.id, { recordingFile: finalFile });
    console.log('[Recording] Saved:', finalFile);
    res.json({ filename: finalFile });
  } catch (err) {
    console.error('Upload recording error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
