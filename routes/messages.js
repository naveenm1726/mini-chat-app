// ============================================================
//  MESSAGE ROUTES — Conversations, Send, Users list
// ============================================================

const express = require('express');
const xss = require('xss');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const router = express.Router();

const ATTACHMENT_PREFIX = '__ATTACHMENT__';

const { authenticate } = require('../middleware/auth');
const {
  getAllUsersExcept,
  searchUsers,
  findUserByExactUsername,
  getConversation,
  getRecentConversations,
  insertMessage,
  updateMessageText,
  deleteMessageById,
  markMessagesRead,
  getUnreadCount,
  findUserById
} = require('../database');

const CHAT_UPLOAD_DIR = path.join(__dirname, '..', 'public', 'uploads', 'chat');
if (!fs.existsSync(CHAT_UPLOAD_DIR)) {
  fs.mkdirSync(CHAT_UPLOAD_DIR, { recursive: true });
}

const chatStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CHAT_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.bin';
    cb(null, `chat-${req.user.id}-${Date.now()}${ext}`);
  }
});

const chatUpload = multer({
  storage: chatStorage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

// -------------------- GET ALL USERS (for new chat) --------------------
router.get('/users', authenticate, async (req, res) => {
  try {
    const users = await getAllUsersExcept(req.user.id);
    res.json({ users });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- SEARCH USERS --------------------
router.get('/users/search', authenticate, async (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json({ users: [] });
    const users = await searchUsers(q, req.user.id);
    res.json({ users });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- FIND USER BY EXACT USERNAME --------------------
router.get('/users/username/:username', authenticate, async (req, res) => {
  try {
    const username = xss(req.params.username?.trim() || '');
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const user = await findUserByExactUsername(username, req.user.id);
    res.json({ user });
  } catch (err) {
    console.error('Find username error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- GET RECENT CONVERSATIONS --------------------
router.get('/conversations', authenticate, async (req, res) => {
  try {
    const conversations = await getRecentConversations(req.user.id);
    const unread = await getUnreadCount(req.user.id);
    res.json({ conversations, totalUnread: unread.count });
  } catch (err) {
    console.error('Conversations error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- GET MESSAGES WITH A USER --------------------
router.get('/messages/:userId', authenticate, async (req, res) => {
  try {
    const otherId = parseInt(req.params.userId);
    if (isNaN(otherId)) return res.status(400).json({ error: 'Invalid user ID' });

    const otherUser = await findUserById(otherId);
    if (!otherUser) return res.status(404).json({ error: 'User not found' });

    const messages = await getConversation(req.user.id, otherId);

    // Mark messages from the other user as read
    await markMessagesRead(otherId, req.user.id);

    res.json({ messages, otherUser });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- SEND MESSAGE (REST fallback) --------------------
router.post('/messages', authenticate, async (req, res) => {
  try {
    let { receiverId, text } = req.body;
    const rawText = String(text || '').trim();
    text = rawText.startsWith(ATTACHMENT_PREFIX) ? rawText : xss(rawText);

    if (!receiverId || !text) {
      return res.status(400).json({ error: 'Receiver and message text required' });
    }
    if (text.length > 8000) {
      return res.status(400).json({ error: 'Message too long (max 8000 chars)' });
    }

    const receiver = await findUserById(receiverId);
    if (!receiver) return res.status(404).json({ error: 'Receiver not found' });

    const result = await insertMessage(req.user.id, receiverId, text);

    res.status(201).json({
      message: {
        id: result.lastInsertRowid,
        sender_id: req.user.id,
        receiver_id: receiverId,
        text,
        read: 0,
        created_at: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error('Send message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- UPLOAD CHAT FILE --------------------
router.post('/messages/upload', authenticate, chatUpload.single('file'), async (req, res) => {
  try {
    const receiverId = parseInt(req.body.receiverId);
    if (!receiverId || Number.isNaN(receiverId)) {
      return res.status(400).json({ error: 'Receiver ID is required' });
    }

    const receiver = await findUserById(receiverId);
    if (!receiver) return res.status(404).json({ error: 'Receiver not found' });

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const mime = req.file.mimetype || '';
    let kind = 'file';
    if (mime.startsWith('image/')) kind = 'image';
    if (mime.startsWith('video/')) kind = 'video';
    if (mime.startsWith('audio/')) kind = 'audio';

    const attachment = {
      kind,
      url: `/uploads/chat/${req.file.filename}`,
      name: req.file.originalname,
      size: req.file.size,
      mime
    };

    res.json({ attachment });
  } catch (err) {
    console.error('File upload error:', err);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// -------------------- EDIT MESSAGE --------------------
router.put('/messages/:messageId', authenticate, async (req, res) => {
  try {
    const messageId = parseInt(req.params.messageId);
    let { text } = req.body;
    const rawText = String(text || '').trim();
    text = rawText.startsWith(ATTACHMENT_PREFIX) ? rawText : xss(rawText);

    if (isNaN(messageId)) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }
    if (!text) {
      return res.status(400).json({ error: 'Message text required' });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 chars)' });
    }

    const updated = await updateMessageText(messageId, req.user.id, text);
    if (!updated) {
      return res.status(404).json({ error: 'Message not found or not editable' });
    }

    res.json({ message: updated });
  } catch (err) {
    console.error('Edit message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- DELETE MESSAGE --------------------
router.delete('/messages/:messageId', authenticate, async (req, res) => {
  try {
    const messageId = parseInt(req.params.messageId);
    if (isNaN(messageId)) {
      return res.status(400).json({ error: 'Invalid message ID' });
    }

    const deleted = await deleteMessageById(messageId, req.user.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Message not found or not deletable' });
    }

    res.json({ success: true, deleted });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- MARK MESSAGES AS READ --------------------
router.put('/messages/read/:userId', authenticate, async (req, res) => {
  try {
    const otherId = parseInt(req.params.userId);
    if (isNaN(otherId)) return res.status(400).json({ error: 'Invalid user ID' });
    await markMessagesRead(otherId, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- GET UNREAD COUNT --------------------
router.get('/unread', authenticate, async (req, res) => {
  try {
    const result = await getUnreadCount(req.user.id);
    res.json({ count: result.count });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
