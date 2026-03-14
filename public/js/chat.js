// ============================================================
//  CHAT.JS — Real-Time Chat Logic with Socket.io
// ============================================================

const Chat = (() => {
  const ATTACHMENT_PREFIX = '__ATTACHMENT__';

  let socket = null;
  let currentChatUserId = null;
  let currentMessages = [];
  let activeMessageSearch = '';
  let onlineUsersSet = new Set();
  let typingTimeout = null;
  let isTyping = false;
  let messageActionsBound = false;

  let peerConnection = null;
  let localStream = null;
  let currentCallPeerId = null;
  let pendingIncomingCall = null;

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
      markVisibleMessagesRead(readBy);
    });

    socket.on('message_edited', (msg) => {
      const existing = currentMessages.find(m => m.id === msg.id);
      if (!existing) return;

      existing.text = msg.text;
      existing.edited = true;
      if (typeof msg.read !== 'undefined') {
        existing.read = msg.read;
      }

      if (isMessageInActiveChat(existing)) {
        applyMessageSearch(activeMessageSearch);
      }
    });

    socket.on('message_deleted', (msg) => {
      const existing = currentMessages.find(m => m.id === msg.id);
      if (!existing) return;

      currentMessages = currentMessages.filter(m => m.id !== msg.id);
      if (isMessageInActiveChat(existing)) {
        applyMessageSearch(activeMessageSearch);
      }
    });

    socket.on('incoming_call', async (data) => {
      pendingIncomingCall = data;
      showCallModal('Incoming voice call', `${data.callerName} is calling...`, true);
    });

    socket.on('call_answered', async (data) => {
      if (!peerConnection) return;
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      showCallModal('Voice call', 'Connected', false, true);
    });

    socket.on('call_rejected', () => {
      showToast('Call rejected', 'info');
      cleanupCall();
    });

    socket.on('ice_candidate', async (data) => {
      if (!peerConnection || !data.candidate) return;
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (e) {
        console.error('ICE add error:', e);
      }
    });

    socket.on('call_ended', () => {
      showToast('Call ended', 'info');
      cleanupCall();
    });

    bindMessageActions();
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
            <span>${escapeHtml(truncate(conversationPreview(c.last_message), 40))}</span>
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

  function conversationPreview(text) {
    const payload = parseMessagePayload(text);
    if (payload.kind === 'text') return payload.text;
    const kind = payload.attachment?.kind || 'file';
    if (kind === 'image') return '[Image]';
    if (kind === 'video') return '[Video]';
    if (kind === 'audio') return '[Audio]';
    return '[File]';
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

  async function findUserByExactUsername(username) {
    try {
      const data = await Auth.apiCall(`/api/users/username/${encodeURIComponent(username)}`);
      return data.user || null;
    } catch (err) {
      return null;
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
      currentMessages = data.messages;
      activeMessageSearch = '';
      renderMessages(currentMessages);
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
    const editedLabel = msg.edited ? ' • edited' : '';
    const statusText = type === 'sent' ? (msg.read ? '✓✓ Read' : '✓ Sent') : '';
    const payload = parseMessagePayload(msg.text);
    const bubbleContent = renderMessageContent(payload);

    return `
      <div class="message-row ${type}" data-message-id="${msg.id}" data-sender-id="${msg.sender_id}" data-receiver-id="${msg.receiver_id}">
        <div>
          <div class="message-bubble-wrap">
            <div class="message-bubble" data-raw-text="${escapeHtml(msg.text)}">${bubbleContent}</div>
            ${type === 'sent' ? `
              <div class="message-actions">
                <button class="message-action-btn" data-action="edit" title="Edit message">✏️</button>
                <button class="message-action-btn" data-action="delete" title="Delete message">🗑️</button>
              </div>
            ` : ''}
          </div>
          <div class="message-time">${formatMessageTime(msg.created_at)}${editedLabel}${statusText ? ` • <span class="message-status">${statusText}</span>` : ''}</div>
        </div>
      </div>
    `;
  }

  function appendMessage(msg, type) {
    currentMessages.push(msg);
    applyMessageSearch(activeMessageSearch);
  }

  function parseMessagePayload(text) {
    if (!text) return { kind: 'text', text: '' };
    if (!text.startsWith(ATTACHMENT_PREFIX)) return { kind: 'text', text };

    try {
      const json = text.slice(ATTACHMENT_PREFIX.length);
      const attachment = JSON.parse(json);
      return { kind: 'attachment', attachment };
    } catch {
      return { kind: 'text', text };
    }
  }

  function renderMessageContent(payload) {
    if (payload.kind === 'text') {
      return escapeHtml(payload.text);
    }

    const file = payload.attachment || {};
    const safeName = escapeHtml(file.name || 'file');
    const safeUrl = escapeHtml(file.url || '#');

    if (file.kind === 'image') {
      return `<a href="${safeUrl}" target="_blank" rel="noopener"><img class="message-media" src="${safeUrl}" alt="${safeName}" /></a><div>${safeName}</div>`;
    }

    if (file.kind === 'video') {
      return `<video class="message-media" controls src="${safeUrl}"></video><div>${safeName}</div>`;
    }

    if (file.kind === 'audio') {
      return `<audio class="message-media" controls src="${safeUrl}"></audio><div>${safeName}</div>`;
    }

    return `<a class="message-file-link" href="${safeUrl}" target="_blank" rel="noopener">📎 ${safeName}</a>`;
  }

  // -------------------- Send Message --------------------
  function sendMessage(text, options = {}) {
    const value = options.raw ? text : text.trim();
    if (!socket || !currentChatUserId || !value) return;

    socket.emit('send_message', {
      receiverId: currentChatUserId,
      text: value
    });

    // Stop typing
    if (isTyping) {
      socket.emit('stop_typing', { receiverId: currentChatUserId });
      isTyping = false;
    }
  }

  async function uploadAndSendAttachment(file) {
    if (!currentChatUserId) throw new Error('Open a chat first');

    const token = Auth.getToken();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('receiverId', currentChatUserId);

    const res = await fetch('/api/messages/upload', {
      method: 'POST',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` })
      },
      body: formData
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    const payloadText = `${ATTACHMENT_PREFIX}${JSON.stringify(data.attachment)}`;
    sendMessage(payloadText, { raw: true });
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

  function bindMessageActions() {
    if (messageActionsBound) return;

    const container = document.getElementById('messages-container');
    if (!container) return;

    container.addEventListener('click', (e) => {
      const actionBtn = e.target.closest('.message-action-btn');
      if (!actionBtn) return;

      const row = actionBtn.closest('.message-row');
      if (!row) return;

      const messageId = parseInt(row.dataset.messageId);
      if (!messageId) return;

      const action = actionBtn.dataset.action;
      if (action === 'edit') {
        startEditMessage(messageId);
      }

      if (action === 'delete') {
        const confirmed = window.confirm('Delete this message?');
        if (confirmed) {
          deleteMessage(messageId);
        }
      }
    });

    messageActionsBound = true;
  }

  function startEditMessage(messageId) {
    const message = currentMessages.find(m => m.id === messageId);
    if (!message) return;

    const updatedText = window.prompt('Edit your message:', message.text);
    if (updatedText === null) return;

    const trimmed = updatedText.trim();
    if (!trimmed || trimmed === message.text) return;
    editMessage(messageId, trimmed);
  }

  function editMessage(messageId, text) {
    if (!socket) return;
    socket.emit('edit_message', { messageId, text });
  }

  function deleteMessage(messageId) {
    if (!socket) return;
    socket.emit('delete_message', { messageId });
  }

  function filterCurrentMessages(query) {
    activeMessageSearch = (query || '').trim().toLowerCase();
    applyMessageSearch(activeMessageSearch);
  }

  function applyMessageSearch(normalizedQuery) {
    if (!normalizedQuery) {
      renderMessages(currentMessages);
      return;
    }

    const filtered = currentMessages.filter(m => {
      const payload = parseMessagePayload(m.text);
      const haystack = payload.kind === 'text'
        ? payload.text
        : `${payload.attachment?.name || ''} ${payload.attachment?.kind || ''}`;

      return haystack.toLowerCase().includes(normalizedQuery);
    });

    renderMessages(filtered);
  }

  function markVisibleMessagesRead(readBy) {
    let changed = false;
    currentMessages = currentMessages.map(m => {
      if (m.sender_id === Auth.getUser().id && m.receiver_id === readBy && !m.read) {
        changed = true;
        return { ...m, read: 1 };
      }
      return m;
    });

    if (changed && currentChatUserId === readBy) {
      applyMessageSearch(activeMessageSearch);
    }
  }

  function isMessageInActiveChat(msg) {
    if (!currentChatUserId) return false;
    const me = Auth.getUser();
    return (
      (msg.sender_id === me.id && msg.receiver_id === currentChatUserId) ||
      (msg.sender_id === currentChatUserId && msg.receiver_id === me.id)
    );
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

  function showCallModal(title, status, showIncomingActions = false, showEnd = false) {
    const modal = document.getElementById('voice-call-modal');
    document.getElementById('call-modal-title').textContent = title;
    document.getElementById('call-modal-status').textContent = status;

    document.getElementById('call-accept-btn').classList.toggle('hidden', !showIncomingActions);
    document.getElementById('call-decline-btn').classList.toggle('hidden', !showIncomingActions && !showEnd);
    document.getElementById('call-end-btn').classList.toggle('hidden', !showEnd);

    modal.classList.remove('hidden');
  }

  function hideCallModal() {
    document.getElementById('voice-call-modal').classList.add('hidden');
  }

  async function createPeer(targetUserId) {
    currentCallPeerId = targetUserId;
    peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate || !socket || !currentCallPeerId) return;
      socket.emit('ice_candidate', {
        receiverId: currentCallPeerId,
        candidate: event.candidate
      });
    };

    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }

    localStream.getTracks().forEach(track => {
      peerConnection.addTrack(track, localStream);
    });

    peerConnection.ontrack = (event) => {
      const audio = document.getElementById('remote-audio') || document.createElement('audio');
      audio.id = 'remote-audio';
      audio.autoplay = true;
      audio.srcObject = event.streams[0];
      document.body.appendChild(audio);
    };
  }

  async function startVoiceCall() {
    if (!currentChatUserId) throw new Error('Open a chat first');
    if (!socket) throw new Error('Not connected');

    await createPeer(currentChatUserId);
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);

    socket.emit('call_offer', {
      receiverId: currentChatUserId,
      offer
    });

    showCallModal('Voice call', 'Calling...', false, true);
  }

  async function acceptIncomingCall() {
    if (!pendingIncomingCall || !socket) return;

    await createPeer(pendingIncomingCall.callerId);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(pendingIncomingCall.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    socket.emit('call_answer', {
      receiverId: pendingIncomingCall.callerId,
      answer
    });

    showCallModal('Voice call', 'Connected', false, true);
    pendingIncomingCall = null;
  }

  function declineIncomingCall() {
    if (!pendingIncomingCall || !socket) return;
    socket.emit('call_reject', { receiverId: pendingIncomingCall.callerId });
    pendingIncomingCall = null;
    hideCallModal();
  }

  function endVoiceCall() {
    if (socket && currentCallPeerId) {
      socket.emit('call_end', { receiverId: currentCallPeerId });
    }
    cleanupCall();
  }

  function cleanupCall() {
    try {
      if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
      }
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
        localStream = null;
      }
      currentCallPeerId = null;
      pendingIncomingCall = null;
      hideCallModal();
    } catch (e) {
      console.error('Cleanup call error:', e);
    }
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
    findUserByExactUsername,
    openChat,
    sendMessage,
    uploadAndSendAttachment,
    emitTyping,
    filterCurrentMessages,
    startVoiceCall,
    acceptIncomingCall,
    declineIncomingCall,
    endVoiceCall,
    getCurrentChatUserId,
    isOnline,
    scrollToBottom
  };
})();
