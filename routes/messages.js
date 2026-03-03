// ============================================================
//  MESSAGE ROUTES — Conversations, Send, Users list
// ============================================================

const express = require('express');
const xss = require('xss');
const router = express.Router();

const { authenticate } = require('../middleware/auth');
const {
  getAllUsersExcept,
  searchUsers,
  getConversation,
  getRecentConversations,
  insertMessage,
  markMessagesRead,
  getUnreadCount,
  findUserById
} = require('../database');

// -------------------- GET ALL USERS (for new chat) --------------------
router.get('/users', authenticate, (req, res) => {
  try {
    const users = getAllUsersExcept.all(req.user.id);
    res.json({ users });
  } catch (err) {
    console.error('Get users error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- SEARCH USERS --------------------
router.get('/users/search', authenticate, (req, res) => {
  try {
    const q = req.query.q?.trim();
    if (!q) return res.json({ users: [] });
    const users = searchUsers.all(`%${q}%`, req.user.id);
    res.json({ users });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- GET RECENT CONVERSATIONS --------------------
router.get('/conversations', authenticate, (req, res) => {
  try {
    const conversations = getRecentConversations.all(req.user.id);
    const unread = getUnreadCount.get(req.user.id);
    res.json({ conversations, totalUnread: unread.count });
  } catch (err) {
    console.error('Conversations error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- GET MESSAGES WITH A USER --------------------
router.get('/messages/:userId', authenticate, (req, res) => {
  try {
    const otherId = parseInt(req.params.userId);
    if (isNaN(otherId)) return res.status(400).json({ error: 'Invalid user ID' });

    const otherUser = findUserById.get(otherId);
    if (!otherUser) return res.status(404).json({ error: 'User not found' });

    const messages = getConversation.all(req.user.id, otherId, otherId, req.user.id);

    // Mark messages from the other user as read
    markMessagesRead.run(otherId, req.user.id);

    res.json({ messages, otherUser });
  } catch (err) {
    console.error('Get messages error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- SEND MESSAGE (REST fallback) --------------------
router.post('/messages', authenticate, (req, res) => {
  try {
    let { receiverId, text } = req.body;
    text = xss(text?.trim());

    if (!receiverId || !text) {
      return res.status(400).json({ error: 'Receiver and message text required' });
    }
    if (text.length > 2000) {
      return res.status(400).json({ error: 'Message too long (max 2000 chars)' });
    }

    const receiver = findUserById.get(receiverId);
    if (!receiver) return res.status(404).json({ error: 'Receiver not found' });

    const result = insertMessage.run(req.user.id, receiverId, text);

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

// -------------------- MARK MESSAGES AS READ --------------------
router.put('/messages/read/:userId', authenticate, (req, res) => {
  try {
    const otherId = parseInt(req.params.userId);
    if (isNaN(otherId)) return res.status(400).json({ error: 'Invalid user ID' });
    markMessagesRead.run(otherId, req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// -------------------- GET UNREAD COUNT --------------------
router.get('/unread', authenticate, (req, res) => {
  try {
    const result = getUnreadCount.get(req.user.id);
    res.json({ count: result.count });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
