const mongoose = require('mongoose');
const crypto = require('crypto');

const webinarSchema = new mongoose.Schema(
  {
    title:          { type: String, required: true, trim: true, maxlength: 200 },
    description:    { type: String, trim: true, default: '', maxlength: 2000 },
    hostId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    scheduledAt:    { type: Date, required: true },
    status:         { type: String, enum: ['scheduled', 'live', 'ended'], default: 'scheduled' },
    participantCount: { type: Number, default: 0, min: 0 },
    hostLink:       { type: String, unique: true, default: () => crypto.randomBytes(16).toString('hex') },
    attendeeLink:   { type: String, unique: true, default: () => crypto.randomBytes(16).toString('hex') },
    panelistLink:   { type: String, unique: true, default: () => crypto.randomBytes(16).toString('hex') },
    recordingFile:  { type: String, default: null },
  },
  { timestamps: true }
);

webinarSchema.index({ hostId: 1, createdAt: -1 });
webinarSchema.index({ status: 1 });

module.exports = mongoose.model('Webinar', webinarSchema);
