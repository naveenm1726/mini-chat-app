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
const { updateUserStatus, insertMessage, findUserById, purgeOldMessages } = require('./database');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', credentials: true }
});

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
      const text = xss(data.text?.trim());
      const receiverId = parseInt(data.receiverId);

      if (!text || !receiverId || text.length > 2000) return;

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
║       🚀  Mini Chat App is LIVE!             ║
║                                              ║
║       Open: http://localhost:${PORT}            ║
║                                              ║
╚══════════════════════════════════════════════╝
  `);
});
