// ============================================================
//  CHAT.JS — Real-Time Chat Logic with Socket.io
// ============================================================

const Chat = (() => {
  let socket = null;
  let currentChatUserId = null;
  let onlineUsersSet = new Set();
  let typingTimeout = null;
  let isTyping = false;

  // -------------------- Connect Socket --------------------
  function connect() {
    const token = Auth.getToken();
    if (!token) return;

    socket = io({
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10
    });

    socket.on('connect', () => {
      console.log('Socket connected');
      loadConversations();
    });

    socket.on('disconnect', () => {
      console.log('Socket disconnected');
    });

    // New message received
    socket.on('new_message', (msg) => {
      // If currently chatting with sender, display it
      if (currentChatUserId === msg.sender_id) {
        appendMessage(msg, 'received');
        scrollToBottom();
        // Mark as read
        socket.emit('mark_read', { senderId: msg.sender_id });
        markReadAPI(msg.sender_id);
      }
      // Refresh conversations
      loadConversations();
      // Show notification if not in that chat
      if (currentChatUserId !== msg.sender_id) {
        showToast(`New message from ${msg.sender_name}`, 'info');
        playNotificationSound();
      }
    });

    // Message sent confirmation
    socket.on('message_sent', (msg) => {
      appendMessage(msg, 'sent');
      scrollToBottom();
      loadConversations();
    });

    // Online status
    socket.on('user_status', ({ userId, status }) => {
      if (status === 'online') {
        onlineUsersSet.add(userId);
      } else {
        onlineUsersSet.delete(userId);
      }
      updateOnlineIndicators();
    });

    socket.on('online_users', (ids) => {
      onlineUsersSet = new Set(ids);
      updateOnlineIndicators();
    });

    // Typing
    socket.on('user_typing', ({ userId, username }) => {
      if (currentChatUserId === userId) {
        showTyping(username);
      }
    });

    socket.on('user_stop_typing', ({ userId }) => {
      if (currentChatUserId === userId) {
        hideTyping();
      }
    });

    // Read receipts
    socket.on('messages_read', ({ readBy }) => {
      // Could update UI to show blue ticks etc.
    });
  }

  function disconnect() {
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }

  // -------------------- Load Conversations --------------------
  async function loadConversations() {
    try {
      const data = await Auth.apiCall('/api/conversations');
      renderConversations(data.conversations);
    } catch (err) {
      console.error('Error loading conversations:', err);
    }
  }

  function renderConversations(conversations) {
    const container = document.getElementById('conversation-items');
    if (conversations.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--text-tertiary);">
          <p style="font-size:2rem; margin-bottom:8px;">💬</p>
          <p style="font-size:0.88rem;">No conversations yet</p>
          <p style="font-size:0.8rem; margin-top:4px;">Click + to start a new chat</p>
        </div>
      `;
      return;
    }

    container.innerHTML = conversations.map(c => `
      <div class="conversation-item ${currentChatUserId === c.other_user_id ? 'active' : ''}" 
           data-user-id="${c.other_user_id}"
           data-username="${escapeHtml(c.other_username)}">
        <div class="avatar avatar-md">
          <span class="avatar-letter">${c.other_username[0]}</span>
          <span class="avatar-status ${onlineUsersSet.has(c.other_user_id) ? 'online' : ''}"></span>
        </div>
        <div class="convo-info">
          <div class="convo-name">
            <span>${escapeHtml(c.other_username)}</span>
            <span class="convo-time">${formatTime(c.last_message_time)}</span>
          </div>
          <div class="convo-preview">
            <span>${escapeHtml(truncate(c.last_message, 40))}</span>
            ${c.unread_count > 0 ? `<span class="unread-badge">${c.unread_count}</span>` : ''}
          </div>
        </div>
      </div>
    `).join('');

    // Add click handlers
    container.querySelectorAll('.conversation-item').forEach(item => {
      item.addEventListener('click', () => {
        const userId = parseInt(item.dataset.userId);
        const username = item.dataset.username;
        openChat(userId, username);
      });
    });
  }

  // -------------------- Load All Users --------------------
  async function loadAllUsers() {
    try {
      const data = await Auth.apiCall('/api/users');
      renderAllUsers(data.users);
    } catch (err) {
      console.error('Error loading users:', err);
    }
  }

  function renderAllUsers(users) {
    const container = document.getElementById('all-users-items');
    if (users.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--text-tertiary);">
          <p style="font-size:0.88rem;">No other users yet</p>
        </div>
      `;
      return;
    }

    container.innerHTML = users.map(u => `
      <div class="conversation-item" data-user-id="${u.id}" data-username="${escapeHtml(u.username)}">
        <div class="avatar avatar-md">
          <span class="avatar-letter">${u.username[0]}</span>
          <span class="avatar-status ${onlineUsersSet.has(u.id) ? 'online' : ''}"></span>
        </div>
        <div class="convo-info">
          <div class="convo-name">
            <span>${escapeHtml(u.username)}</span>
          </div>
          <div class="convo-preview">
            <span style="color:${onlineUsersSet.has(u.id) ? 'var(--success)' : 'var(--text-tertiary)'}">${onlineUsersSet.has(u.id) ? 'Online' : 'Offline'}</span>
          </div>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.conversation-item').forEach(item => {
      item.addEventListener('click', () => {
        const userId = parseInt(item.dataset.userId);
        const username = item.dataset.username;
        openChat(userId, username);
        // Switch back to conversations view
        document.getElementById('users-list-panel').classList.add('hidden');
        document.getElementById('conversations-list').classList.remove('hidden');
      });
    });
  }

  // -------------------- Search Users --------------------
  async function searchUsers(query) {
    try {
      const data = await Auth.apiCall(`/api/users/search?q=${encodeURIComponent(query)}`);
      return data.users;
    } catch (err) {
      return [];
    }
  }

  // -------------------- Open Chat --------------------
  async function openChat(userId, username) {
    currentChatUserId = userId;

    // Show chat area
    document.getElementById('chat-empty').classList.add('hidden');
    document.getElementById('chat-active').classList.remove('hidden');

    // Update header
    document.getElementById('chat-header-name').textContent = username;
    document.getElementById('chat-avatar-letter').textContent = username[0];
    updateChatStatus(userId);

    // On mobile, hide sidebar
    if (window.innerWidth <= 768) {
      document.getElementById('sidebar').classList.add('sidebar-hidden');
    }

    // Clear messages
    document.getElementById('messages-container').innerHTML = `
      <div style="text-align:center; padding:20px; color:var(--text-tertiary); font-size:0.85rem;">
        Loading messages...
      </div>
    `;

    try {
      const data = await Auth.apiCall(`/api/messages/${userId}`);
      renderMessages(data.messages);
      scrollToBottom(false);
      // Mark conversations as active
      highlightConversation(userId);
      loadConversations(); // refresh unread counts
    } catch (err) {
      console.error('Error loading messages:', err);
      showToast('Failed to load messages', 'error');
    }
  }

  function renderMessages(messages) {
    const container = document.getElementById('messages-container');
    const me = Auth.getUser();

    if (messages.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--text-tertiary);">
          <p style="font-size:2.5rem; margin-bottom:12px;">👋</p>
          <p style="font-size:1rem; font-weight:600;">Start the conversation!</p>
          <p style="font-size:0.85rem; margin-top:4px;">Send a message to begin chatting</p>
        </div>
      `;
      return;
    }

    let html = '';
    let lastDate = '';

    messages.forEach(msg => {
      const msgDate = formatDate(msg.created_at);
      if (msgDate !== lastDate) {
        html += `<div class="date-separator"><span>${msgDate}</span></div>`;
        lastDate = msgDate;
      }

      const type = msg.sender_id === me.id ? 'sent' : 'received';
      html += createMessageHTML(msg, type);
    });

    container.innerHTML = html;
  }

  function createMessageHTML(msg, type) {
    return `
      <div class="message-row ${type}">
        <div>
          <div class="message-bubble">${escapeHtml(msg.text)}</div>
          <div class="message-time">${formatMessageTime(msg.created_at)}</div>
        </div>
      </div>
    `;
  }

  function appendMessage(msg, type) {
    const container = document.getElementById('messages-container');
    // Remove "start conversation" placeholder if present
    const placeholder = container.querySelector('[style*="text-align:center"]');
    if (placeholder && container.children.length === 1) {
      container.innerHTML = '';
    }

    const div = document.createElement('div');
    div.innerHTML = createMessageHTML(msg, type);
    container.appendChild(div.firstElementChild);
  }

  // -------------------- Send Message --------------------
  function sendMessage(text) {
    if (!socket || !currentChatUserId || !text.trim()) return;

    socket.emit('send_message', {
      receiverId: currentChatUserId,
      text: text.trim()
    });

    // Stop typing
    if (isTyping) {
      socket.emit('stop_typing', { receiverId: currentChatUserId });
      isTyping = false;
    }
  }

  // -------------------- Typing --------------------
  function emitTyping() {
    if (!socket || !currentChatUserId) return;

    if (!isTyping) {
      isTyping = true;
      socket.emit('typing', { receiverId: currentChatUserId });
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
      isTyping = false;
      socket.emit('stop_typing', { receiverId: currentChatUserId });
    }, 2000);
  }

  function showTyping(username) {
    const indicator = document.getElementById('typing-indicator');
    const name = document.getElementById('typing-name');
    name.textContent = `${username} is typing`;
    indicator.classList.remove('hidden');
    scrollToBottom();
  }

  function hideTyping() {
    document.getElementById('typing-indicator').classList.add('hidden');
  }

  // -------------------- Helpers --------------------
  function updateOnlineIndicators() {
    // Update chat header status
    if (currentChatUserId) {
      updateChatStatus(currentChatUserId);
    }
    // Re-render conversations to update green dots
    loadConversations();
  }

  function updateChatStatus(userId) {
    const statusEl = document.getElementById('chat-header-status');
    const dotEl = document.getElementById('chat-avatar-status');
    if (onlineUsersSet.has(userId)) {
      statusEl.textContent = 'Online';
      statusEl.style.color = 'var(--success)';
      dotEl.classList.add('online');
    } else {
      statusEl.textContent = 'Offline';
      statusEl.style.color = 'var(--text-tertiary)';
      dotEl.classList.remove('online');
    }
  }

  function highlightConversation(userId) {
    document.querySelectorAll('.conversation-item').forEach(item => {
      item.classList.toggle('active', parseInt(item.dataset.userId) === userId);
    });
  }

  async function markReadAPI(senderId) {
    try {
      await Auth.apiCall(`/api/messages/read/${senderId}`, { method: 'PUT' });
    } catch (e) { /* ignore */ }
  }

  function scrollToBottom(smooth = true) {
    const container = document.getElementById('chat-messages');
    setTimeout(() => {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }, 50);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  }

  function formatTime(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / 86400000);

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const diff = Math.floor((today - msgDate) / 86400000);

    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function formatMessageTime(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function playNotificationSound() {
    // Simple beep using Web Audio
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) { /* ignore */ }
  }

  function getCurrentChatUserId() {
    return currentChatUserId;
  }

  function isOnline(userId) {
    return onlineUsersSet.has(userId);
  }

  return {
    connect,
    disconnect,
    loadConversations,
    loadAllUsers,
    searchUsers,
    openChat,
    sendMessage,
    emitTyping,
    getCurrentChatUserId,
    isOnline,
    scrollToBottom
  };
})();
