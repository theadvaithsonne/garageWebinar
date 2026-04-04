const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [80, 'Name too long'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['host', 'attendee'], default: 'attendee' },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 });

module.exports = mongoose.model('User', userSchema);
