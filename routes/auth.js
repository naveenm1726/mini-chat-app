// ============================================================
//  AUTH ROUTES — Register, Login, Logout, Profile
// ============================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const xss = require('xss');
const router = express.Router();

const {
  createUser,
  findUserByUsername,
  findUserByEmail,
  findUserWithPassword,
  findUserWithPasswordByEmail,
  findUserById,
  updateUserProfile
} = require('../database');

const { generateToken, authenticate } = require('../middleware/auth');

// -------------------- REGISTER --------------------
router.post('/register', async (req, res) => {
  try {
    let { username, email, password } = req.body;

    // Sanitise
    username = xss(username?.trim());
    email    = xss(email?.trim().toLowerCase());

    // Validate
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ error: 'Username must be 3-30 characters' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check duplicates
    if (await findUserByUsername(username)) {
      return res.status(409).json({ error: 'Username already taken' });
    }
    if (await findUserByEmail(email)) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash & store
    const hashed = await bcrypt.hash(password, 12);
    const result = await createUser(username, email, hashed);

    const user = await findUserById(result.lastInsertRowid);
    const token = generateToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production_https',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.status(201).json({
      message: 'Account created successfully!',
      user: { id: user.id, username: user.username, email: user.email },
      token
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// -------------------- LOGIN --------------------
router.post('/login', async (req, res) => {
  try {
    let { login, password } = req.body;
    login = xss(login?.trim());

    if (!login || !password) {
      return res.status(400).json({ error: 'Username/email and password are required' });
    }

    // Support login by username or email
    let user = await findUserWithPassword(login);
    if (!user) user = await findUserWithPasswordByEmail(login.toLowerCase());

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production_https',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });

    res.json({
      message: 'Login successful!',
      user: { id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, bio: user.bio },
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// -------------------- LOGOUT --------------------
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

// -------------------- GET CURRENT USER --------------------
router.get('/me', authenticate, async (req, res) => {
  const user = await findUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// -------------------- UPDATE PROFILE --------------------
router.put('/profile', authenticate, async (req, res) => {
  try {
    let { bio, avatar_url } = req.body;
    bio = xss(bio?.trim() || '');
    avatar_url = xss(avatar_url?.trim() || '');

    await updateUserProfile(bio, avatar_url, req.user.id);
    const user = await findUserById(req.user.id);
    res.json({ message: 'Profile updated', user });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
