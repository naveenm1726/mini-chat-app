// ============================================================
//  DATABASE LAYER — Supabase (PostgreSQL)
//  Persistent cloud storage — data survives restarts!
//  Tables: users, messages
// ============================================================

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// -------------------- USER FUNCTIONS --------------------

async function createUser(username, email, password) {
  const { data, error } = await supabase
    .from('users')
    .insert({ username, email, password })
    .select('id')
    .single();
  if (error) throw error;
  return { lastInsertRowid: data.id };
}

function sanitizeUser(user) {
  if (!user) return null;
  const { password, ...safe } = user;
  return safe;
}

async function findUserByUsername(username) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .ilike('username', username)
    .single();
  return sanitizeUser(data);
}

async function findUserByEmail(email) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .ilike('email', email)
    .single();
  return sanitizeUser(data);
}

async function findUserById(id) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single();
  return sanitizeUser(data);
}

async function findUserWithPassword(username) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .ilike('username', username)
    .single();
  return data || null;
}

async function findUserWithPasswordByEmail(email) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .ilike('email', email)
    .single();
  return data || null;
}

async function findUserWithPasswordById(id) {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .single();
  return data || null;
}

async function updateUserStatus(status, userId) {
  await supabase
    .from('users')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', userId);
}

async function updateUserProfile(bio, avatar_url, userId) {
  await supabase
    .from('users')
    .update({ bio, avatar_url, updated_at: new Date().toISOString() })
    .eq('id', userId);
}

async function updateUserPassword(userId, password) {
  await supabase
    .from('users')
    .update({ password, updated_at: new Date().toISOString() })
    .eq('id', userId);
}

async function findUserByExactUsername(username, excludeId) {
  const { data } = await supabase
    .from('users')
    .select('id, username, avatar_url, status, bio')
    .neq('id', excludeId)
    .ilike('username', username)
    .maybeSingle();

  return data || null;
}

async function searchUsers(query, excludeId) {
  const q = query.replace(/%/g, '');
  const { data } = await supabase
    .from('users')
    .select('id, username, email, avatar_url, status, bio, created_at, updated_at')
    .neq('id', excludeId)
    .ilike('username', `%${q}%`)
    .limit(20);
  return data || [];
}

async function getAllUsersExcept(excludeId) {
  const { data } = await supabase
    .from('users')
    .select('id, username, avatar_url, status, bio')
    .neq('id', excludeId)
    .order('username');
  return data || [];
}

// -------------------- MESSAGE FUNCTIONS --------------------

async function insertMessage(senderId, receiverId, text) {
  const { data, error } = await supabase
    .from('messages')
    .insert({ sender_id: senderId, receiver_id: receiverId, text })
    .select('id')
    .single();
  if (error) throw error;
  return { lastInsertRowid: data.id };
}

async function updateMessageText(messageId, senderId, text) {
  const { data, error } = await supabase
    .from('messages')
    .update({ text })
    .eq('id', messageId)
    .eq('sender_id', senderId)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function deleteMessageById(messageId, senderId) {
  const { data, error } = await supabase
    .from('messages')
    .delete()
    .eq('id', messageId)
    .eq('sender_id', senderId)
    .select('id, sender_id, receiver_id')
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function getConversation(userId1, userId2) {
  const { data: messages } = await supabase
    .from('messages')
    .select('*')
    .or(
      `and(sender_id.eq.${userId1},receiver_id.eq.${userId2}),and(sender_id.eq.${userId2},receiver_id.eq.${userId1})`
    )
    .order('created_at', { ascending: true })
    .limit(200);

  if (!messages || messages.length === 0) return [];

  // Get unique user IDs to fetch names
  const userIds = [...new Set(messages.flatMap(m => [m.sender_id, m.receiver_id]))];
  const { data: users } = await supabase
    .from('users')
    .select('id, username, avatar_url')
    .in('id', userIds);

  const userMap = {};
  (users || []).forEach(u => { userMap[u.id] = u; });

  return messages.map(m => ({
    ...m,
    sender_name: userMap[m.sender_id]?.username || 'Unknown',
    sender_avatar: userMap[m.sender_id]?.avatar_url || null,
    receiver_name: userMap[m.receiver_id]?.username || 'Unknown',
    receiver_avatar: userMap[m.receiver_id]?.avatar_url || null
  }));
}

async function getRecentConversations(userId) {
  // Get all messages involving this user
  const { data: userMessages } = await supabase
    .from('messages')
    .select('*')
    .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
    .order('created_at', { ascending: false });

  if (!userMessages || userMessages.length === 0) return [];

  const otherUserIds = new Set();
  userMessages.forEach(m => {
    if (m.sender_id === userId) otherUserIds.add(m.receiver_id);
    else otherUserIds.add(m.sender_id);
  });

  // Fetch other users
  const { data: otherUsers } = await supabase
    .from('users')
    .select('id, username, avatar_url, status')
    .in('id', [...otherUserIds]);

  const userMap = {};
  (otherUsers || []).forEach(u => { userMap[u.id] = u; });

  const conversations = [];
  otherUserIds.forEach(otherId => {
    const otherUser = userMap[otherId];
    if (!otherUser) return;

    const convoMessages = userMessages.filter(
      m => (m.sender_id === userId && m.receiver_id === otherId) ||
           (m.sender_id === otherId && m.receiver_id === userId)
    );

    const lastMsg = convoMessages[0];
    const unreadCount = userMessages.filter(
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

async function markMessagesRead(senderId, receiverId) {
  await supabase
    .from('messages')
    .update({ read: 1 })
    .eq('sender_id', senderId)
    .eq('receiver_id', receiverId)
    .eq('read', 0);
}

async function getUnreadCount(userId) {
  const { count } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('receiver_id', userId)
    .eq('read', 0);
  return { count: count || 0 };
}

// -------------------- AUTO-PURGE OLD MESSAGES --------------------
async function purgeOldMessages(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('messages')
    .delete()
    .lt('created_at', cutoff)
    .select('*', { count: 'exact', head: true });
  if (count && count > 0) {
    console.log(`🗑️  Purged ${count} messages older than ${days} days`);
  }
  return count || 0;
}

// -------------------- EXPORTS --------------------
// All functions are now async — callers must await them
module.exports = {
  supabase,
  createUser,
  findUserByUsername,
  findUserByEmail,
  findUserById,
  findUserWithPassword,
  findUserWithPasswordByEmail,
  findUserWithPasswordById,
  updateUserStatus,
  updateUserProfile,
  updateUserPassword,
  findUserByExactUsername,
  searchUsers,
  getAllUsersExcept,
  insertMessage,
  getConversation,
  getRecentConversations,
  updateMessageText,
  deleteMessageById,
  markMessagesRead,
  getUnreadCount,
  purgeOldMessages
};
