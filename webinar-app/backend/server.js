require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const { Server } = require('socket.io');

const authRoutes = require('./routes/auth');
const webinarRoutes = require('./routes/webinars');
const { setupSocketHandlers } = require('./socket/handlers');
const { createWorker } = require('./mediasoup/server');

const app = express();
const server = http.createServer(app);

// ── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Recordings — force download, never play in browser ───────────────────
app.use('/recordings', (req, res, next) => {
  // Sanitize filename: strip directory traversal and control chars
  const filename = path.basename(req.path).replace(/[^\w.\-]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  next();
}, express.static(path.join(__dirname, 'recordings')));

// ── Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/webinars', webinarRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── Socket.io ─────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

setupSocketHandlers(io);

// ── MongoDB + Server Start ─────────────────────────────────────────────────
const PORT = process.env.PORT || 4000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected');

    server.listen(PORT, async () => {
      console.log(`Server listening on port ${PORT}`);

      // Create mediasoup Worker AFTER server starts
      await createWorker();
      console.log('mediasoup Worker ready');
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

module.exports = { app, server, io };
