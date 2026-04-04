const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    webinarId: { type: mongoose.Schema.Types.ObjectId, ref: 'Webinar', required: true },
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    userName:  { type: String, required: true, maxlength: 80 },
    text:      { type: String, required: true, trim: true, maxlength: 1000 },
    timestamp: { type: Date, default: Date.now },
  }
);

// Index for fast room chat history queries
messageSchema.index({ webinarId: 1, timestamp: 1 });

module.exports = mongoose.model('Message', messageSchema);
