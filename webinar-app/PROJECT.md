# WebinarApp — Full-Stack WebRTC Webinar Platform

## Overview

WebinarApp is a production-ready, full-stack webinar application built with modern web technologies. It enables users to host professional webinars with real-time video/audio streaming, interactive features like chat, Q&A, polls, and participant management. The application uses WebRTC via mediasoup for high-quality media streaming and supports screen sharing, recording, and role-based access control.

## Architecture

### Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 14 (App Router), React 18, Tailwind CSS | User interface and client-side logic |
| **Backend** | Node.js, Express.js | REST API and WebSocket server |
| **Real-time** | Socket.io | Bidirectional communication for chat, Q&A, polls |
| **Video/Audio** | mediasoup (WebRTC SFU) + mediasoup-client | High-performance media streaming |
| **Database** | MongoDB + Mongoose | Data persistence |
| **Recording** | FFmpeg + fluent-ffmpeg | Video recording and conversion |
| **Authentication** | JWT + bcrypt | Secure user authentication |
| **State Management** | Zustand | Client-side state management |

### System Architecture

```
┌─────────────────┐    HTTP/WebSocket    ┌─────────────────┐
│   Browser       │◄────────────────────┤   Express.js     │
│   (Next.js)     │    (REST + Socket.io)│   Server         │
│                 │                     │                 │
│ • Video Grid    │                     │ • Auth Routes    │
│ • Chat Panel    │                     │ • Webinar Routes │
│ • Control Bar   │                     │ • Socket Handlers│
│ • Participant   │                     │ • Media Server   │
│   List          │                     │   (mediasoup)    │
└─────────────────┘                     └─────────┬───────┘
                                                  │
                                        ┌─────────▼───────┐
                                        │   MongoDB       │
                                        │ • Users         │
                                        │ • Webinars      │
                                        │ • Messages      │
                                        └─────────────────┘
```

## Features

### Core Functionality

#### User Roles & Permissions
- **Host**: Full control over webinar, can create/manage webinars, control participants, start/stop recording, end webinar
- **Panelist**: Can share video/audio/screen, promoted by host from attendee
- **Attendee**: View-only access, can chat, ask Q&A questions, vote in polls, raise hand

#### Real-time Communication
- **WebRTC Video/Audio**: High-quality streaming via mediasoup SFU
- **Screen Sharing**: Desktop/application sharing with audio
- **Live Chat**: Real-time messaging with message history
- **Q&A System**: Questions with upvotes and answered marking
- **Polls**: Real-time voting with live results
- **Emoji Reactions**: Quick reactions (👍, ❤️, 😂, etc.)
- **Raise Hand**: Participants can signal for attention

#### Webinar Management
- **Create Webinars**: Schedule webinars with title, description, date/time
- **Join Links**: Separate links for host, panelists, and attendees
- **Participant Controls**: Mute, remove, promote/demote participants
- **Recording**: Host-controlled recording with MP4 export
- **End Webinar**: Graceful webinar termination

### Technical Features
- **JWT Authentication**: Secure login/registration
- **Rate Limiting**: Prevents spam in chat/Q&A/polls
- **File Upload**: Recording upload and processing
- **Responsive Design**: Mobile-friendly interface
- **Real-time Updates**: Live participant count, status changes

## Project Structure

```
webinar-app/
├── README.md                    # Project documentation
├── backend/                     # Node.js/Express server
│   ├── package.json            # Backend dependencies
│   ├── server.js               # Main server entry point
│   ├── config/
│   │   └── mediasoup.js        # mediasoup codec configuration
│   ├── mediasoup/
│   │   ├── server.js           # Worker/Router management
│   │   └── transports.js       # WebRTC transport helpers
│   ├── middleware/
│   │   └── auth.js             # JWT authentication middleware
│   ├── models/                 # Mongoose data models
│   │   ├── User.js             # User schema
│   │   ├── Webinar.js          # Webinar schema
│   │   └── Message.js          # Chat message schema
│   ├── recording/
│   │   └── recorder.js         # FFmpeg recording utilities
│   ├── routes/                 # REST API routes
│   │   ├── auth.js             # Authentication endpoints
│   │   └── webinars.js         # Webinar CRUD operations
│   ├── socket/
│   │   └── handlers.js         # Socket.io event handlers
│   ├── recordings/             # Stored webinar recordings
│   └── tests/                  # Backend tests
│
└── frontend/                    # Next.js application
    ├── package.json            # Frontend dependencies
    ├── next.config.js          # Next.js configuration
    ├── tailwind.config.js      # Tailwind CSS config
    ├── postcss.config.js       # PostCSS configuration
    ├── app/                    # Next.js App Router pages
    │   ├── globals.css         # Global styles
    │   ├── layout.js           # Root layout
    │   ├── page.js             # Home page
    │   ├── auth/
    │   │   ├── login/page.js   # Login page
    │   │   └── register/page.js# Registration page
    │   ├── dashboard/page.js   # User dashboard
    │   ├── join/[id]/page.js   # Join webinar page
    │   ├── room/[id]/page.js   # Webinar room
    │   └── webinar/
    │       └── create/page.js  # Create webinar page
    ├── components/             # React components
    │   ├── Navbar.jsx          # Navigation bar
    │   ├── ChatPanel.jsx       # Chat interface
    │   ├── ControlBar.jsx      # Host controls
    │   ├── VideoGrid.jsx       # Video stream layout
    │   ├── VideoTile.jsx       # Individual video stream
    │   ├── ParticipantList.jsx # Participant management
    │   ├── QAPanel.jsx         # Q&A interface
    │   ├── PollWidget.jsx      # Poll voting interface
    │   ├── Toast.jsx           # Notification component
    │   └── ...
    ├── hooks/                  # Custom React hooks
    │   ├── useMediasoup.js     # mediasoup client logic
    │   └── useSocket.js        # Socket.io client logic
    ├── lib/                    # Utility libraries
    │   ├── axios.js            # HTTP client configuration
    │   ├── socket.js           # Socket.io client setup
    │   └── mediasoupClient.js  # mediasoup client utilities
    ├── store/                  # Zustand state stores
    │   ├── useAuthStore.js     # Authentication state
    │   └── useRoomStore.js     # Room/webinar state
    └── public/                 # Static assets
```

## Data Models

### User Model
```javascript
{
  name: String (required, 1-80 chars),
  email: String (required, unique, validated),
  passwordHash: String (required),
  role: String (enum: ['host', 'attendee'], default: 'attendee'),
  timestamps: true
}
```

### Webinar Model
```javascript
{
  title: String (required, 1-200 chars),
  description: String (optional, 0-2000 chars),
  hostId: ObjectId (ref: User, required),
  scheduledAt: Date (required),
  status: String (enum: ['scheduled', 'live', 'ended'], default: 'scheduled'),
  participantCount: Number (default: 0),
  hostLink: String (unique, auto-generated),
  attendeeLink: String (unique, auto-generated),
  panelistLink: String (unique, auto-generated),
  recordingFile: String (optional),
  timestamps: true
}
```

### Message Model
```javascript
{
  webinarId: ObjectId (ref: Webinar, required),
  userId: ObjectId (ref: User, required),
  userName: String (required),
  text: String (required, 1-1000 chars),
  timestamp: Date (default: now),
  index: { webinarId: 1, timestamp: 1 }
}
```

## MongoDB Usage & Migration Guide

### Current MongoDB Implementation

The application uses MongoDB with Mongoose ODM for all data persistence. Below are all files and locations where MongoDB/Mongoose is used:

#### Backend Dependencies
- **package.json**: `mongoose: "^8.0.3"` - MongoDB ODM library

#### Database Connection
- **backend/server.js**: MongoDB connection setup with `mongoose.connect()`
- **Environment**: `MONGO_URI` environment variable for connection string

#### Data Models (Mongoose Schemas)
- **backend/models/User.js**: User schema definition and model export
- **backend/models/Webinar.js**: Webinar schema definition and model export
- **backend/models/Message.js**: Message schema definition and model export

#### API Routes (Database Operations)
- **backend/routes/auth.js**:
  - `User.create()` - User registration
  - `User.findOne()` - User login validation

- **backend/routes/webinars.js**:
  - `Webinar.create()` - Create new webinar
  - `Webinar.find()` - List user's webinars
  - `Webinar.findById()` - Get webinar details
  - `Webinar.findByIdAndUpdate()` - Update webinar status/recording
  - `Webinar.findById().lean()` - Get webinar for recording upload
  - `Webinar.deleteOne()` - Delete webinar

#### Socket Handlers (Real-time Database Operations)
- **backend/socket/handlers.js**:
  - `mongoose.isValidObjectId()` - ObjectId validation
  - `Webinar.findById()` - Webinar lookup for room joining
  - `Webinar.findByIdAndUpdate()` - Update webinar status/participant count
  - `Message.find()` - Load chat history
  - `Message.create()` - Save new chat messages

#### Database Indexes
- **User Model**: `{ email: 1 }` - Unique email index
- **Webinar Model**: `{ hostId: 1, createdAt: -1 }` and `{ status: 1 }` - Query optimization
- **Message Model**: `{ webinarId: 1, timestamp: 1 }` - Chat history queries

### Migrating to Cloud Storage (AWS S3, Google Cloud Storage, etc.)

If you want to replace MongoDB with cloud storage solutions, here's how to approach the migration:

#### Step 1: Choose Cloud Storage Provider
- **AWS S3**: Most popular, good integration with other AWS services
- **Google Cloud Storage**: Good for Google Cloud Platform users
- **Azure Blob Storage**: Good for Microsoft ecosystem
- **Cloudflare R2**: Cost-effective S3-compatible storage

#### Step 2: Data Structure Changes
Instead of MongoDB collections, you'll store data as JSON files in cloud storage:

```
bucket-name/
├── users/
│   ├── user-{userId}.json
│   └── ...
├── webinars/
│   ├── webinar-{webinarId}.json
│   └── ...
├── messages/
│   ├── webinar-{webinarId}/
│   │   ├── message-{timestamp}-{messageId}.json
│   │   └── ...
│   └── ...
└── indexes/
    ├── users-by-email.json
    ├── webinars-by-host.json
    └── ...
```

#### Step 3: Replace Mongoose Operations

**Connection Setup** (replace `backend/server.js`):
```javascript
// Remove mongoose connection
// const mongoose = require('mongoose');
// mongoose.connect(process.env.MONGO_URI)...

// Add cloud storage client
const { S3Client } = require('@aws-sdk/client-s3');
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
```

**Data Models** (replace Mongoose schemas):
```javascript
// Instead of Mongoose models, create service classes
class UserService {
  static async findByEmail(email) {
    const key = `indexes/users-by-email.json`;
    const indexData = await this.getFromStorage(key);
    const userId = indexData[email];
    if (!userId) return null;
    return await this.getFromStorage(`users/user-${userId}.json`);
  }

  static async create(userData) {
    const userId = generateId();
    const user = { ...userData, _id: userId, createdAt: new Date() };

    // Save user data
    await this.saveToStorage(`users/user-${userId}.json`, user);

    // Update email index
    const indexKey = `indexes/users-by-email.json`;
    const indexData = await this.getFromStorage(indexKey) || {};
    indexData[user.email] = userId;
    await this.saveToStorage(indexKey, indexData);

    return user;
  }

  static async getFromStorage(key) {
    // Implement S3 getObject logic
  }

  static async saveToStorage(key, data) {
    // Implement S3 putObject logic
  }
}
```

**API Routes Migration**:
```javascript
// Replace Mongoose operations in routes/auth.js
// const user = await User.create({...});
// becomes:
const user = await UserService.create({...});

// Replace in routes/webinars.js
// const webinars = await Webinar.find({ hostId: req.user.userId });
// becomes:
const webinars = await WebinarService.findByHostId(req.user.userId);
```

**Socket Handlers Migration**:
```javascript
// Replace in socket/handlers.js
// const webinar = await Webinar.findById(webinarId);
// becomes:
const webinar = await WebinarService.findById(webinarId);

// const msg = await Message.create({...});
// becomes:
const msg = await MessageService.create({...});
```

#### Step 4: Handle Relationships & Queries
- **References**: Store related IDs as strings instead of ObjectIds
- **Queries**: Implement indexing through separate index files
- **Sorting**: Handle sorting in application code or use cloud database services
- **Transactions**: Use cloud storage conditional operations or external transaction management

#### Step 5: Environment Variables
Replace MongoDB env vars with cloud storage credentials:
```env
# Remove
MONGO_URI=mongodb+srv://...

# Add (for AWS S3)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
S3_BUCKET_NAME=your-webinar-bucket

# Or for Google Cloud Storage
GOOGLE_CLOUD_PROJECT_ID=your-project
GOOGLE_CLOUD_KEY_FILE=path/to/key.json
GCS_BUCKET_NAME=your-bucket
```

#### Step 6: Performance Considerations
- **Caching**: Implement Redis or in-memory caching for frequently accessed data
- **CDN**: Use CDN for static assets and cached data
- **Batch Operations**: Group multiple storage operations to reduce API calls
- **Indexing Strategy**: Pre-compute and cache common query results

#### Step 7: Backup & Recovery
- **Automated Backups**: Set up cross-region replication
- **Versioning**: Enable object versioning for data recovery
- **Monitoring**: Implement monitoring for storage costs and performance

#### Benefits of Cloud Storage Migration
- **Scalability**: Virtually unlimited storage capacity
- **Cost**: Pay-as-you-go pricing, often cheaper than MongoDB Atlas
- **Durability**: 99.999999999% (11 9's) durability
- **Global Distribution**: CDN integration for worldwide access
- **Integration**: Better integration with other cloud services

#### Challenges & Considerations
- **Eventual Consistency**: Some operations may have eventual consistency
- **Complex Queries**: Advanced queries need custom implementation
- **Cost Monitoring**: Storage costs can grow unexpectedly
- **Migration Effort**: Significant code changes required
- **Testing**: Thorough testing needed for all data operations

#### Recommended Migration Path
1. Start with non-critical data (messages, recordings metadata)
2. Implement dual-write strategy during migration
3. Gradually migrate user and webinar data
4. Update indexes and caching strategies
5. Full cutover with rollback plan

## API Endpoints

### Authentication Routes (`/api/auth`)
- `POST /register` - User registration
- `POST /login` - User login
- `GET /me` - Get current user info

### Webinar Routes (`/api/webinars`)
- `GET /` - List user's webinars
- `POST /` - Create new webinar
- `GET /:id` - Get webinar details
- `PUT /:id` - Update webinar
- `DELETE /:id` - Delete webinar
- `POST /:id/recording` - Upload recording file

## Socket Events

### Connection & Room Management
- `joinRoom` - Join webinar room with role verification
- `disconnect` - Handle user disconnection and cleanup

### Media Streaming
- `createWebRtcTransport` - Create WebRTC transport
- `connectTransport` - Connect transport with DTLS
- `produce` - Start producing media stream
- `consume` - Start consuming media stream
- `closeProducer` - Stop producing media
- `resumeConsumer` - Resume paused consumer
- `getProducers` - Get available producers

### Interactive Features
- `sendMessage` - Send chat message
- `sendQA` - Ask Q&A question
- `upvoteQA` - Upvote Q&A question
- `answerQA` - Mark Q&A as answered
- `createPoll` - Create poll (host only)
- `submitVote` - Vote in poll
- `sendReaction` - Send emoji reaction
- `raiseHand` - Raise/lower hand

### Host Controls
- `muteParticipant` - Mute participant
- `removeParticipant` - Remove participant from room
- `promoteToHost` - Promote to panelist
- `demoteToAttendee` - Demote to attendee
- `startRecording` - Start webinar recording
- `stopRecording` - Stop webinar recording
- `endWebinar` - End webinar

### Status Updates
- `micState` - Update microphone state
- `updateName` - Update display name

## Key Technologies Explained

### mediasoup (WebRTC SFU)
- **Selective Forwarding Unit** for efficient multi-party video
- Handles WebRTC peer connections, RTP routing, and codec negotiation
- Supports simulcast, SVC, and adaptive bitrate
- Used for video/audio/screen sharing streams

### Socket.io
- Enables real-time, bidirectional communication
- Handles room-based messaging for webinars
- Manages participant state synchronization
- Rate limiting prevents spam/abuse

### FFmpeg Integration
- Records audio/video streams to MP4 format
- Processes uploaded WebM recordings from browser
- Handles codec conversion and file optimization

### JWT Authentication
- Stateless authentication with signed tokens
- Middleware validates requests and socket connections
- Secure user sessions without server-side storage

## Development Setup

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- FFmpeg installed system-wide
- Windows: `windows-build-tools`
- Linux/Mac: build tools

### Backend Setup
```bash
cd backend
npm install
# Configure .env file
npm run dev
```

### Frontend Setup
```bash
cd frontend
npm install
# Configure .env.local
npm run dev
```

### Environment Variables
**Backend (.env):**
- `PORT` - Server port
- `MONGO_URI` - MongoDB connection
- `JWT_SECRET` - JWT signing key
- `MEDIASOUP_LISTEN_IP` - Media server IP
- `MEDIASOUP_ANNOUNCED_IP` - Public IP
- `FRONTEND_URL` - CORS origin

**Frontend (.env.local):**
- `NEXT_PUBLIC_API_URL` - Backend API URL
- `NEXT_PUBLIC_SOCKET_URL` - Socket server URL

## Production Deployment

### Server Requirements
- Public IP with UDP ports 10000-10100 open
- HTTPS required for WebRTC
- FFmpeg installed
- PM2 for process management

### Key Considerations
- Set `MEDIASOUP_ANNOUNCED_IP` to server public IP
- Configure reverse proxy (Nginx/Caddy)
- Enable SSL/TLS
- Set up MongoDB replica set for production
- Configure firewall for WebRTC traffic

## Security Features

- JWT-based authentication
- Rate limiting on real-time events
- Input validation and sanitization
- CORS configuration
- Secure file upload handling
- Role-based access control
- Transport encryption (DTLS/SRTP)

## Performance Optimizations

- mediasoup SFU reduces server bandwidth
- Message history pagination
- Efficient peer state management
- Lazy loading of media consumers
- Connection pooling for database
- Compression for HTTP/WebSocket

## Testing

- Backend unit tests with Jest
- API endpoint testing with Supertest
- Socket event testing
- Recording functionality tests

## Future Enhancements

- Breakout rooms
- Whiteboard integration
- Advanced analytics
- Mobile app development
- Cloud recording storage
- Webinar templates
- Integration with calendar systems
- Advanced moderation tools

---

This project demonstrates modern full-stack development with real-time communication, media streaming, and scalable architecture suitable for production webinar platforms.</content>
<parameter name="filePath">d:\freelance\Webinar\webinar-app\PROJECT.md