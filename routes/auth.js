// ============================================================
//  AUTH ROUTES — Register, Login, Logout, Profile
// ============================================================

const express = require('express');
const bcrypt = require('bcryptjs');
const xss = require('xss');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();

const {
  createUser,
  findUserByUsername,
  findUserByEmail,
  findUserWithPassword,
  findUserWithPasswordByEmail,
  findUserWithPasswordById,
  findUserById,
  updateUserProfile,
  updateUserPassword
} = require('../database');

const { generateToken, authenticate } = require('../middleware/auth');

const AVATAR_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'avatars');
if (!fs.existsSync(AVATAR_UPLOAD_DIR)) {
  fs.mkdirSync(AVATAR_UPLOAD_DIR, { recursive: true });
}

const avatarStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AVATAR_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    cb(null, `avatar-${req.user.id}-${Date.now()}${ext}`);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if ((file.mimetype || '').startsWith('image/')) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  }
});

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

// -------------------- UPLOAD PROFILE PHOTO --------------------
router.post('/profile/photo', authenticate, avatarUpload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No profile photo uploaded' });
    }

    const user = await findUserById(req.user.id);
    const nextBio = user?.bio || '';
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    await updateUserProfile(nextBio, avatarUrl, req.user.id);
    const updatedUser = await findUserById(req.user.id);

    res.json({ message: 'Profile photo updated', user: updatedUser });
  } catch (err) {
    console.error('Profile photo upload error:', err);
    res.status(500).json({ error: 'Failed to upload profile photo' });
  }
});

// -------------------- CHANGE PASSWORD --------------------
router.put('/change-password', authenticate, async (req, res) => {
  try {
    let { currentPassword, newPassword } = req.body;
    currentPassword = String(currentPassword || '');
    newPassword = String(newPassword || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }

    const user = await findUserWithPasswordById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(currentPassword, user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await updateUserPassword(req.user.id, hashed);

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
