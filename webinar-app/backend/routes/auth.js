const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();
const SALT_ROUNDS = 12;

// Simple in-memory rate limiter: max 10 attempts per IP per 15 min
const loginAttempts = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const window = 15 * 60 * 1000;
  const max = 10;

  const entry = loginAttempts.get(ip) || { count: 0, reset: now + window };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + window; }
  entry.count++;
  loginAttempts.set(ip, entry);

  if (entry.count > max) {
    return res.status(429).json({ message: 'Too many attempts. Try again later.' });
  }
  next();
}

// POST /api/auth/register
router.post('/register', rateLimit, async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name?.trim() || !email?.trim() || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }
    if (name.trim().length > 80) {
      return res.status(400).json({ message: 'Name must be 80 characters or less' });
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }
    if (password.length > 128) {
      return res.status(400).json({ message: 'Password too long' });
    }

    const existing = await User.findOne({ email: email.toLowerCase().trim() });
    if (existing) return res.status(409).json({ message: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      role: role === 'host' ? 'host' : 'attendee',
    });

    const token = signToken(user);
    res.status(201).json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', rateLimit, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email?.trim() || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      // Timing-safe: run bcrypt even on miss to prevent enumeration
      await bcrypt.hash(password, SALT_ROUNDS);
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });

    const token = signToken(user);
    res.json({
      token,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

function signToken(user) {
  return jwt.sign(
    { userId: user._id.toString(), name: user.name, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

module.exports = router;
