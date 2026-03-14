// ============================================================
//  MAIN SERVER — Express + Socket.io Real-Time Chat
// ============================================================

require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const helmet     = require('helmet');
const cors       = require('cors');
const cookieParser = require('cookie-parser');
const rateLimit  = require('express-rate-limit');
const path       = require('path');
const xss        = require('xss');

const authRoutes    = require('./routes/auth');
const messageRoutes = require('./routes/messages');
const { authenticateSocket } = require('./middleware/auth');
const {
  updateUserStatus,
  insertMessage,
  updateMessageText,
  deleteMessageById,
  purgeOldMessages
} = require('./database');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', credentials: true }
});

const ATTACHMENT_PREFIX = '__ATTACHMENT__';

const PORT = process.env.PORT || 3000;

// -------------------- SECURITY MIDDLEWARE --------------------
app.use(helmet({
  contentSecurityPolicy: false  // Allow inline styles/scripts for our SPA
}));
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  message: { error: 'Too many requests, slow down!' }
});
app.use('/api/', limiter);

// Stricter limiter for auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many attempts. Try again later.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// -------------------- STATIC FILES --------------------
app.use(express.static(path.join(__dirname, 'public')));

// -------------------- API ROUTES --------------------
app.use('/api/auth', authRoutes);
app.use('/api', messageRoutes);

// -------------------- HEALTH CHECK --------------------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'chat-app', timestamp: new Date().toISOString() });
});

// -------------------- SPA FALLBACK --------------------
app.get('*', (req, res) => {
  // If it's an API route that wasn't matched, 404
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Route not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -------------------- SOCKET.IO --------------------
// Track online users: { odId: socketId }
const onlineUsers = new Map();

io.use(authenticateSocket);

io.on('connection', (socket) => {
  const userId = socket.user.id;
  const username = socket.user.username;

  console.log(`⚡ ${username} connected (socket: ${socket.id})`);

  // Mark online
  onlineUsers.set(userId, socket.id);
  updateUserStatus('online', userId);

  // Broadcast online status
  io.emit('user_status', { userId, status: 'online' });

  // Send current online list
  socket.emit('online_users', Array.from(onlineUsers.keys()));

  // ---- SEND MESSAGE (real-time) ----
  socket.on('send_message', async (data) => {
    try {
      const rawText = String(data.text || '').trim();
      const text = rawText.startsWith(ATTACHMENT_PREFIX) ? rawText : xss(rawText);
      const receiverId = parseInt(data.receiverId);

      if (!text || !receiverId || text.length > 8000) return;

      // Save to DB
      const result = await insertMessage(userId, receiverId, text);
      const message = {
        id: result.lastInsertRowid,
        sender_id: userId,
        receiver_id: receiverId,
        sender_name: username,
        text,
        read: 0,
        created_at: new Date().toISOString()
      };

      // Send to receiver if online
      const receiverSocket = onlineUsers.get(receiverId);
      if (receiverSocket) {
        io.to(receiverSocket).emit('new_message', message);
      }

      // Confirm to sender
      socket.emit('message_sent', message);
    } catch (err) {
      console.error('Socket send_message error:', err);
    }
  });

  // ---- VOICE CALL SIGNALING ----
  socket.on('call_offer', (data) => {
    const receiverId = parseInt(data.receiverId);
    const receiverSocket = onlineUsers.get(receiverId);
    if (!receiverSocket) return;

    io.to(receiverSocket).emit('incoming_call', {
      callerId: userId,
      callerName: username,
      offer: data.offer
    });
  });

  socket.on('call_answer', (data) => {
    const receiverId = parseInt(data.receiverId);
    const receiverSocket = onlineUsers.get(receiverId);
    if (!receiverSocket) return;

    io.to(receiverSocket).emit('call_answered', {
      answer: data.answer,
      answeredBy: userId
    });
  });

  socket.on('call_reject', (data) => {
    const receiverId = parseInt(data.receiverId);
    const receiverSocket = onlineUsers.get(receiverId);
    if (!receiverSocket) return;

    io.to(receiverSocket).emit('call_rejected', {
      rejectedBy: userId
    });
  });

  socket.on('ice_candidate', (data) => {
    const receiverId = parseInt(data.receiverId);
    const receiverSocket = onlineUsers.get(receiverId);
    if (!receiverSocket) return;

    io.to(receiverSocket).emit('ice_candidate', {
      candidate: data.candidate,
      fromUserId: userId
    });
  });

  socket.on('call_end', (data) => {
    const receiverId = parseInt(data.receiverId);
    const receiverSocket = onlineUsers.get(receiverId);
    if (!receiverSocket) return;

    io.to(receiverSocket).emit('call_ended', {
      endedBy: userId
    });
  });

  // ---- EDIT MESSAGE ----
  socket.on('edit_message', async (data) => {
    try {
      const messageId = parseInt(data.messageId);
      const rawText = String(data.text || '').trim();
      const text = rawText.startsWith(ATTACHMENT_PREFIX) ? rawText : xss(rawText);

      if (!messageId || !text || text.length > 2000) return;

      const updated = await updateMessageText(messageId, userId, text);
      if (!updated) return;

      const payload = {
        id: updated.id,
        sender_id: updated.sender_id,
        receiver_id: updated.receiver_id,
        text: updated.text,
        read: updated.read,
        created_at: updated.created_at,
        edited: true
      };

      socket.emit('message_edited', payload);
      const receiverSocket = onlineUsers.get(updated.receiver_id);
      if (receiverSocket) {
        io.to(receiverSocket).emit('message_edited', payload);
      }
    } catch (err) {
      console.error('Socket edit_message error:', err);
    }
  });

  // ---- DELETE MESSAGE ----
  socket.on('delete_message', async (data) => {
    try {
      const messageId = parseInt(data.messageId);
      if (!messageId) return;

      const deleted = await deleteMessageById(messageId, userId);
      if (!deleted) return;

      const payload = {
        id: deleted.id,
        sender_id: deleted.sender_id,
        receiver_id: deleted.receiver_id
      };

      socket.emit('message_deleted', payload);
      const receiverSocket = onlineUsers.get(deleted.receiver_id);
      if (receiverSocket) {
        io.to(receiverSocket).emit('message_deleted', payload);
      }
    } catch (err) {
      console.error('Socket delete_message error:', err);
    }
  });

  // ---- TYPING INDICATOR ----
  socket.on('typing', (data) => {
    const receiverSocket = onlineUsers.get(parseInt(data.receiverId));
    if (receiverSocket) {
      io.to(receiverSocket).emit('user_typing', {
        userId,
        username
      });
    }
  });

  socket.on('stop_typing', (data) => {
    const receiverSocket = onlineUsers.get(parseInt(data.receiverId));
    if (receiverSocket) {
      io.to(receiverSocket).emit('user_stop_typing', { userId });
    }
  });

  // ---- MARK MESSAGES READ ----
  socket.on('mark_read', (data) => {
    const senderId = parseInt(data.senderId);
    const senderSocket = onlineUsers.get(senderId);
    if (senderSocket) {
      io.to(senderSocket).emit('messages_read', { readBy: userId });
    }
  });

  // ---- DISCONNECT ----
  socket.on('disconnect', () => {
    console.log(`💤 ${username} disconnected`);
    onlineUsers.delete(userId);
    updateUserStatus('offline', userId);
    io.emit('user_status', { userId, status: 'offline' });
  });
});

// -------------------- AUTO-PURGE OLD MESSAGES --------------------
purgeOldMessages(30);                          // Run once on startup
setInterval(() => purgeOldMessages(30), 24 * 60 * 60 * 1000);  // Then every 24 hours

// -------------------- START SERVER --------------------
server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════╗
║                                              ║
║         🚀  Chat App is LIVE!                ║
║                                              ║
║       Open: http://localhost:${PORT}            ║
║                                              ║
╚══════════════════════════════════════════════╝
  `);
});
