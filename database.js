// ============================================================
//  DATABASE LAYER — Lightweight JSON file-based storage
//  No native dependencies needed — works everywhere!
//  Tables: users, messages
// ============================================================

const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'chat_data.json');

// -------------------- DB Core --------------------
class Database {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { users: [], messages: [], nextUserId: 1, nextMsgId: 1 };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(raw);
      }
    } catch (err) {
      console.error('DB load error, starting fresh:', err.message);
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error('DB save error:', err.message);
    }
  }
}

const db = new Database(DB_FILE);

// -------------------- USER FUNCTIONS --------------------

function createUser(username, email, password) {
  const id = db.data.nextUserId++;
  const user = {
    id,
    username,
    email,
    password,
    avatar_url: null,
    status: 'offline',
    bio: '',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  db.data.users.push(user);
  db.save();
  return { lastInsertRowid: id };
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}

function findUserByUsername(username) {
  const user = db.data.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  return sanitizeUser(user);
}

function findUserByEmail(email) {
  const user = db.data.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  return sanitizeUser(user);
}

function findUserById(id) {
  const user = db.data.users.find(u => u.id === id);
  return sanitizeUser(user);
}

function findUserWithPassword(username) {
  return db.data.users.find(u => u.username.toLowerCase() === username.toLowerCase()) || null;
}

function findUserWithPasswordByEmail(email) {
  return db.data.users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

function updateUserStatus(status, userId) {
  const user = db.data.users.find(u => u.id === userId);
  if (user) {
    user.status = status;
    user.updated_at = new Date().toISOString();
    db.save();
  }
}

function updateUserProfile(bio, avatar_url, userId) {
  const user = db.data.users.find(u => u.id === userId);
  if (user) {
    user.bio = bio;
    user.avatar_url = avatar_url;
    user.updated_at = new Date().toISOString();
    db.save();
  }
}

function searchUsers(query, excludeId) {
  const q = query.replace(/%/g, '').toLowerCase();
  return db.data.users
    .filter(u => u.id !== excludeId && u.username.toLowerCase().includes(q))
    .slice(0, 20)
    .map(sanitizeUser);
}

function getAllUsersExcept(excludeId) {
  return db.data.users
    .filter(u => u.id !== excludeId)
    .sort((a, b) => a.username.localeCompare(b.username))
    .map(u => ({ id: u.id, username: u.username, avatar_url: u.avatar_url, status: u.status, bio: u.bio }));
}

// -------------------- MESSAGE FUNCTIONS --------------------

function insertMessage(senderId, receiverId, text) {
  const id = db.data.nextMsgId++;
  const msg = {
    id,
    sender_id: senderId,
    receiver_id: receiverId,
    text,
    read: 0,
    created_at: new Date().toISOString()
  };
  db.data.messages.push(msg);
  db.save();
  return { lastInsertRowid: id };
}

function getConversation(userId1, userId2) {
  const messages = db.data.messages
    .filter(m =>
      (m.sender_id === userId1 && m.receiver_id === userId2) ||
      (m.sender_id === userId2 && m.receiver_id === userId1)
    )
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .slice(-200);

  return messages.map(m => {
    const sender = db.data.users.find(u => u.id === m.sender_id);
    const receiver = db.data.users.find(u => u.id === m.receiver_id);
    return {
      ...m,
      sender_name: sender?.username || 'Unknown',
      sender_avatar: sender?.avatar_url || null,
      receiver_name: receiver?.username || 'Unknown',
      receiver_avatar: receiver?.avatar_url || null
    };
  });
}

function getRecentConversations(userId) {
  const userMessages = db.data.messages.filter(
    m => m.sender_id === userId || m.receiver_id === userId
  );

  const otherUserIds = new Set();
  userMessages.forEach(m => {
    if (m.sender_id === userId) otherUserIds.add(m.receiver_id);
    else otherUserIds.add(m.sender_id);
  });

  const conversations = [];
  otherUserIds.forEach(otherId => {
    const otherUser = db.data.users.find(u => u.id === otherId);
    if (!otherUser) return;

    const convoMessages = db.data.messages.filter(
      m => (m.sender_id === userId && m.receiver_id === otherId) ||
           (m.sender_id === otherId && m.receiver_id === userId)
    ).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const lastMsg = convoMessages[0];
    const unreadCount = db.data.messages.filter(
      m => m.sender_id === otherId && m.receiver_id === userId && m.read === 0
    ).length;

    conversations.push({
      other_user_id: otherId,
      other_username: otherUser.username,
      other_avatar: otherUser.avatar_url,
      other_status: otherUser.status,
      last_message: lastMsg?.text || '',
      last_message_time: lastMsg?.created_at || '',
      unread_count: unreadCount
    });
  });

  conversations.sort((a, b) => new Date(b.last_message_time) - new Date(a.last_message_time));
  return conversations;
}

function markMessagesRead(senderId, receiverId) {
  let changed = false;
  db.data.messages.forEach(m => {
    if (m.sender_id === senderId && m.receiver_id === receiverId && m.read === 0) {
      m.read = 1;
      changed = true;
    }
  });
  if (changed) db.save();
}

function getUnreadCount(userId) {
  const count = db.data.messages.filter(m => m.receiver_id === userId && m.read === 0).length;
  return { count };
}

// -------------------- AUTO-PURGE OLD MESSAGES --------------------
function purgeOldMessages(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const before = db.data.messages.length;
  db.data.messages = db.data.messages.filter(m => m.created_at >= cutoff);
  const deleted = before - db.data.messages.length;
  if (deleted > 0) {
    db.save();
    console.log(`🗑️  Purged ${deleted} messages older than ${days} days`);
  }
  return deleted;
}

// -------------------- EXPORTS --------------------
// Wrapped to mimic prepared-statement .get()/.all()/.run() API
module.exports = {
  db,
  createUser:                 { run: (username, email, password) => createUser(username, email, password) },
  findUserByUsername:         { get: (username) => findUserByUsername(username) },
  findUserByEmail:            { get: (email) => findUserByEmail(email) },
  findUserById:               { get: (id) => findUserById(id) },
  findUserWithPassword:       { get: (username) => findUserWithPassword(username) },
  findUserWithPasswordByEmail:{ get: (email) => findUserWithPasswordByEmail(email) },
  updateUserStatus:           { run: (status, userId) => updateUserStatus(status, userId) },
  updateUserProfile:          { run: (bio, avatar_url, userId) => updateUserProfile(bio, avatar_url, userId) },
  searchUsers:                { all: (query, excludeId) => searchUsers(query, excludeId) },
  getAllUsersExcept:           { all: (excludeId) => getAllUsersExcept(excludeId) },
  insertMessage:              { run: (senderId, receiverId, text) => insertMessage(senderId, receiverId, text) },
  getConversation:            { all: (u1, u2, _u2, _u1) => getConversation(u1, u2) },
  getRecentConversations:     { all: (userId) => getRecentConversations(userId) },
  markMessagesRead:           { run: (senderId, receiverId) => markMessagesRead(senderId, receiverId) },
  getUnreadCount:             { get: (userId) => getUnreadCount(userId) },
  purgeOldMessages
};
