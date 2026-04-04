# WebinarApp — Full-Stack WebRTC Webinar Platform

A production-ready webinar application built with Next.js 14, Node.js, mediasoup, Socket.io, and MongoDB.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), Tailwind CSS, Zustand |
| Backend | Node.js, Express.js |
| Real-time | Socket.io |
| Video/Audio | mediasoup (WebRTC SFU) + mediasoup-client |
| Database | MongoDB + Mongoose |
| Recording | FFmpeg + fluent-ffmpeg |
| Auth | JWT + bcrypt |

## Quick Start

### Prerequisites

- Node.js 18+
- MongoDB Atlas account (or local MongoDB)
- FFmpeg installed on your system
- On Windows: `npm install --global windows-build-tools` (required for mediasoup)
- On Linux/Mac: build tools installed (`apt install build-essential` or Xcode CLI tools)

### 1. Backend Setup

```bash
cd webinar-app/backend
npm install
```

Edit `.env`:
```env
PORT=4000
MONGO_URI=mongodb+srv://youruser:yourpass@cluster.mongodb.net/webinardb
JWT_SECRET=some_long_random_secret_key_here
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=127.0.0.1
FRONTEND_URL=http://localhost:3000
```

Start the server:
```bash
npm run dev
```

### 2. Frontend Setup

```bash
cd webinar-app/frontend
npm install
```

Edit `.env.local`:
```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
```

Start the dev server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Features

### Roles
- **Host** — Creates/controls the webinar. Can mute/remove/promote participants, start/stop recording, end webinar.
- **Panelist** — Can share video, audio, and screen. Promoted from attendee by host.
- **Attendee** — View-only. Can chat, ask Q&A questions, upvote, vote in polls, raise hand.

### Implemented Features
- [x] JWT authentication (register/login)
- [x] Create/list/delete webinars
- [x] WebRTC video/audio via mediasoup SFU
- [x] Screen sharing
- [x] Live chat (persisted to MongoDB)
- [x] Q&A with upvotes and answered marking
- [x] Real-time polls with live results
- [x] Participant list with host controls (mute/remove/promote)
- [x] Raise hand
- [x] Recording to MP4 via FFmpeg
- [x] Download recording from dashboard

---

## Architecture

```
Browser (Next.js)
    │  HTTP (REST API)     ┌─────────────┐
    ├─────────────────────▶│  Express.js  │
    │  WebSocket (Socket.io)│             │
    ├─────────────────────▶│  Socket.io   │
    │  WebRTC (UDP/TCP)    │             │
    └─────────────────────▶│  mediasoup   │
                           │  SFU Router  │
                           └──────┬──────┘
                                  │
                           ┌──────▼──────┐
                           │   MongoDB   │
                           └─────────────┘
```

### mediasoup Flow

1. Client connects → server creates Router per webinar room
2. Client calls `createWebRtcTransport` → gets ICE/DTLS params
3. Client creates send transport → produces audio/video tracks
4. Other clients create recv transports → consume those tracks
5. Server pipes audio/video to FFmpeg via PlainTransport for recording

---

## Environment Variables

### Backend (.env)

| Variable | Description |
|----------|-------------|
| `PORT` | Express server port (default: 4000) |
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret key for JWT signing |
| `MEDIASOUP_LISTEN_IP` | IP to listen on (use 0.0.0.0) |
| `MEDIASOUP_ANNOUNCED_IP` | Public IP for WebRTC (127.0.0.1 for local) |
| `FRONTEND_URL` | Frontend origin for CORS |

### Frontend (.env.local)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Backend API base URL |
| `NEXT_PUBLIC_SOCKET_URL` | Socket.io server URL |

---

## Production Deployment

1. Set `MEDIASOUP_ANNOUNCED_IP` to your server's public IP
2. Open UDP ports 10000-10100 in your firewall (mediasoup RTP range)
3. Use HTTPS — WebRTC requires secure context in production
4. Configure Nginx/Caddy as a reverse proxy
5. Use PM2 for process management: `pm2 start server.js --name webinar-backend`

---

## Folder Structure

```
webinar-app/
├── backend/
│   ├── config/mediasoup.js     ← mediasoup codecs config
│   ├── mediasoup/
│   │   ├── server.js           ← Worker + Router management
│   │   └── transports.js       ← WebRTC transport helpers
│   ├── middleware/auth.js       ← JWT middleware
│   ├── models/                  ← Mongoose models
│   ├── recording/recorder.js   ← FFmpeg recording
│   ├── routes/                  ← REST API routes
│   ├── socket/handlers.js       ← All Socket.io events
│   └── server.js               ← Entry point
│
└── frontend/
    ├── app/                     ← Next.js App Router pages
    ├── components/              ← UI components
    ├── hooks/                   ← Custom hooks
    ├── lib/                     ← axios, socket, mediasoup client
    └── store/                   ← Zustand state stores
```
