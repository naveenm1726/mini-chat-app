// ============================================================
//  APP.JS — Main Application Orchestrator
// ============================================================

(function () {
  'use strict';

  // -------------------- DOM Elements --------------------
  const $  = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const loadingScreen   = $('#loading-screen');
  const authPage        = $('#auth-page');
  const chatPage        = $('#chat-page');
  const loginForm       = $('#login-form');
  const registerForm    = $('#register-form');
  const loginSubmit     = $('#login-submit');
  const registerSubmit  = $('#register-submit');
  const loginError      = $('#login-error');
  const registerError   = $('#register-error');
  const registerSuccess = $('#register-success');

  // -------------------- Theme --------------------
  function initTheme() {
    const saved = localStorage.getItem('chat_app_theme') || localStorage.getItem('mini_chat_theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('chat_app_theme', next);
    showToast(`Switched to ${next} mode`, 'info');
  }

  // -------------------- Toast Notifications --------------------
  window.showToast = function (message, type = 'info', duration = 4000) {
    const container = $('#toast-container');
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${message}</span>
      <button class="toast-close">&times;</button>
    `;

    container.appendChild(toast);

    const close = () => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    };

    toast.querySelector('.toast-close').addEventListener('click', close);
    setTimeout(close, duration);
  };

  // -------------------- Show/Hide Pages --------------------
  function showAuth() {
    chatPage.classList.add('hidden');
    authPage.classList.remove('hidden');
  }

  function showChat() {
    authPage.classList.add('hidden');
    chatPage.classList.remove('hidden');
    initChatUI();
  }

  function initChatUI() {
    const user = Auth.getUser();
    if (!user) return;

    // Update sidebar profile
    $('#sidebar-username').textContent = user.username;
    $('#sidebar-avatar-letter').textContent = user.username[0];

    const profileAvatarLetter = $('#profile-avatar-letter');
    const profileAvatarImage = $('#profile-avatar-image');
    if (profileAvatarLetter) {
      profileAvatarLetter.textContent = user.username[0];
    }
    if (profileAvatarImage) {
      if (user.avatar_url) {
        profileAvatarImage.src = user.avatar_url;
        profileAvatarImage.classList.remove('hidden');
        profileAvatarLetter.classList.add('hidden');
      } else {
        profileAvatarImage.classList.add('hidden');
        profileAvatarLetter.classList.remove('hidden');
      }
    }

    // Connect socket
    Chat.connect();
  }

  // -------------------- Auth Form Switching --------------------
  $('#show-register').addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    registerForm.style.animation = 'none';
    requestAnimationFrame(() => registerForm.style.animation = '');
    clearErrors();
  });

  $('#show-login').addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    loginForm.style.animation = 'none';
    requestAnimationFrame(() => loginForm.style.animation = '');
    clearErrors();
  });

  function clearErrors() {
    loginError.classList.add('hidden');
    registerError.classList.add('hidden');
    registerSuccess.classList.add('hidden');
  }

  // -------------------- Login --------------------
  loginSubmit.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = loginSubmit.querySelector('.btn-primary');
    const btnText = btn.querySelector('.btn-text');
    const btnLoader = btn.querySelector('.btn-loader');

    loginError.classList.add('hidden');
    btnText.classList.add('hidden');
    btnLoader.classList.remove('hidden');
    btn.disabled = true;

    try {
      const login = $('#login-input').value.trim();
      const password = $('#login-password').value;
      await Auth.login(login, password);
      showToast('Welcome back! 👋', 'success');
      showChat();
    } catch (err) {
      loginError.textContent = err.message;
      loginError.classList.remove('hidden');
    } finally {
      btnText.classList.remove('hidden');
      btnLoader.classList.add('hidden');
      btn.disabled = false;
    }
  });

  // -------------------- Register --------------------
  registerSubmit.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = registerSubmit.querySelector('.btn-primary');
    const btnText = btn.querySelector('.btn-text');
    const btnLoader = btn.querySelector('.btn-loader');

    registerError.classList.add('hidden');
    registerSuccess.classList.add('hidden');
    btnText.classList.add('hidden');
    btnLoader.classList.remove('hidden');
    btn.disabled = true;

    try {
      const username = $('#reg-username').value.trim();
      const email = $('#reg-email').value.trim();
      const password = $('#reg-password').value;
      await Auth.register(username, email, password);
      showToast('Account created! Welcome! 🎉', 'success');
      showChat();
    } catch (err) {
      registerError.textContent = err.message;
      registerError.classList.remove('hidden');
    } finally {
      btnText.classList.remove('hidden');
      btnLoader.classList.add('hidden');
      btn.disabled = false;
    }
  });

  // -------------------- Password Visibility Toggle --------------------
  $$('.toggle-password').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  });

  // -------------------- Password Strength --------------------
  const regPassword = $('#reg-password');
  const strengthFill = $('#strength-fill');
  const strengthText = $('#strength-text');

  if (regPassword) {
    regPassword.addEventListener('input', () => {
      const val = regPassword.value;
      let strength = 0;
      if (val.length >= 6) strength++;
      if (val.length >= 10) strength++;
      if (/[A-Z]/.test(val) && /[a-z]/.test(val)) strength++;
      if (/[0-9]/.test(val)) strength++;
      if (/[^A-Za-z0-9]/.test(val)) strength++;

      strengthFill.className = 'strength-fill';
      if (val.length === 0) {
        strengthText.textContent = '';
      } else if (strength <= 2) {
        strengthFill.classList.add('weak');
        strengthText.textContent = 'Weak';
        strengthText.style.color = 'var(--error)';
      } else if (strength <= 3) {
        strengthFill.classList.add('medium');
        strengthText.textContent = 'Medium';
        strengthText.style.color = 'var(--warning)';
      } else {
        strengthFill.classList.add('strong');
        strengthText.textContent = 'Strong';
        strengthText.style.color = 'var(--success)';
      }
    });
  }

  // -------------------- Logout --------------------
  function handleLogout() {
    Chat.disconnect();
    Auth.logout();
    showAuth();
    showToast('Logged out successfully', 'info');
    // Reset forms
    loginSubmit.reset();
    registerSubmit.reset();
    clearErrors();
    // Reset chat area
    $('#chat-empty').classList.remove('hidden');
    $('#chat-active').classList.add('hidden');
    $('#conversation-items').innerHTML = '';
  }

  $('#logout-btn').addEventListener('click', handleLogout);
  $('#menu-logout').addEventListener('click', handleLogout);

  // -------------------- Sidebar Dropdown Menu --------------------
  const sidebarDropdown = $('#sidebar-dropdown');
  $('#sidebar-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    sidebarDropdown.style.top = (rect.bottom + 4) + 'px';
    sidebarDropdown.style.left = (rect.left) + 'px';
    sidebarDropdown.classList.toggle('hidden');
  });

  document.addEventListener('click', () => {
    sidebarDropdown.classList.add('hidden');
  });

  $('#menu-theme').addEventListener('click', toggleTheme);

  // -------------------- Profile Modal --------------------
  $('#menu-profile').addEventListener('click', () => {
    const user = Auth.getUser();
    if (user) {
      $('#profile-avatar-letter').textContent = user.username[0];
      $('#profile-bio').value = user.bio || '';
      const avatarImage = $('#profile-avatar-image');
      if (user.avatar_url) {
        avatarImage.src = user.avatar_url;
        avatarImage.classList.remove('hidden');
        $('#profile-avatar-letter').classList.add('hidden');
      } else {
        avatarImage.classList.add('hidden');
        $('#profile-avatar-letter').classList.remove('hidden');
      }
    }
    $('#profile-modal').classList.remove('hidden');
  });

  $('#close-profile-modal').addEventListener('click', () => {
    $('#profile-modal').classList.add('hidden');
  });

  $('#profile-modal .modal-backdrop').addEventListener('click', () => {
    $('#profile-modal').classList.add('hidden');
  });

  const callModalBackdrop = document.querySelector('#voice-call-modal .modal-backdrop');
  if (callModalBackdrop) {
    callModalBackdrop.addEventListener('click', () => {
      Chat.endVoiceCall();
    });
  }

  $('#save-profile-btn').addEventListener('click', async () => {
    try {
      const bio = $('#profile-bio').value;
      const photoInput = $('#profile-photo-input');
      const currentPassword = $('#current-password').value;
      const newPassword = $('#new-password').value;
      const confirmPassword = $('#confirm-password').value;

      if (photoInput.files[0]) {
        await Auth.uploadProfilePhoto(photoInput.files[0]);
      }

      await Auth.updateProfile(bio, '');

      if (currentPassword || newPassword || confirmPassword) {
        if (!currentPassword || !newPassword || !confirmPassword) {
          throw new Error('Fill current/new/confirm password fields to change password');
        }
        if (newPassword !== confirmPassword) {
          throw new Error('New password and confirmation do not match');
        }
        await Auth.changePassword(currentPassword, newPassword);
      }

      showToast('Profile updated!', 'success');
      $('#profile-modal').classList.add('hidden');
      $('#current-password').value = '';
      $('#new-password').value = '';
      $('#confirm-password').value = '';
      $('#profile-photo-input').value = '';
      initChatUI();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // -------------------- New Chat Button --------------------
  $('#new-chat-btn').addEventListener('click', () => {
    $('#conversations-list').classList.add('hidden');
    $('#users-list-panel').classList.remove('hidden');
    const resultContainer = $('#username-search-result');
    resultContainer.innerHTML = `
      <div style="text-align:center; padding:40px 20px; color:var(--text-tertiary);">
        <p style="font-size:0.88rem;">Search by exact username to start chat</p>
      </div>
    `;
    $('#exact-username-input').value = '';
    $('#exact-username-input').focus();
  });

  $('#back-to-convos').addEventListener('click', () => {
    $('#users-list-panel').classList.add('hidden');
    $('#conversations-list').classList.remove('hidden');
  });

  // -------------------- Message Search --------------------
  const messageSearchInput = $('#message-search-input');
  const toggleMessageSearchBtn = $('#toggle-message-search');

  if (toggleMessageSearchBtn && messageSearchInput) {
    toggleMessageSearchBtn.addEventListener('click', () => {
      const wrapper = $('#message-search-wrap');
      wrapper.classList.toggle('hidden');

      if (wrapper.classList.contains('hidden')) {
        messageSearchInput.value = '';
        Chat.filterCurrentMessages('');
      } else {
        messageSearchInput.focus();
      }
    });

    messageSearchInput.addEventListener('input', (e) => {
      Chat.filterCurrentMessages(e.target.value);
    });
  }

  // -------------------- Search Conversations --------------------
  $('#search-users').addEventListener('input', (e) => {
    const query = e.target.value.trim().toLowerCase();
    document.querySelectorAll('#conversation-items .conversation-item').forEach(item => {
      const username = (item.dataset.username || '').toLowerCase();
      const visible = !query || username.includes(query);
      item.style.display = visible ? '' : 'none';
    });
  });

  // -------------------- Exact Username Search --------------------
  let exactSearchDebounce = null;
  $('#exact-username-input').addEventListener('input', (e) => {
    clearTimeout(exactSearchDebounce);
    const username = e.target.value.trim();
    const resultContainer = $('#username-search-result');

    if (!username) {
      resultContainer.innerHTML = `
        <div style="text-align:center; padding:40px 20px; color:var(--text-tertiary);">
          <p style="font-size:0.88rem;">Search by exact username to start chat</p>
        </div>
      `;
      return;
    }

    exactSearchDebounce = setTimeout(async () => {
      const user = await Chat.findUserByExactUsername(username);
      if (!user) {
        resultContainer.innerHTML = `
          <div style="text-align:center; padding:40px 20px; color:var(--text-tertiary);">
            <p style="font-size:0.88rem;">No exact username found</p>
          </div>
        `;
        return;
      }

      resultContainer.innerHTML = `
        <div class="conversation-item" id="exact-user-result" data-user-id="${user.id}" data-username="${user.username}">
          <div class="avatar avatar-md">
            <span class="avatar-letter">${user.username[0]}</span>
            <span class="avatar-status ${Chat.isOnline(user.id) ? 'online' : ''}"></span>
          </div>
          <div class="convo-info">
            <div class="convo-name"><span>${user.username}</span></div>
            <div class="convo-preview"><span>${user.bio || 'No bio'}</span></div>
          </div>
        </div>
      `;

      const card = $('#exact-user-result');
      card.addEventListener('click', () => {
        Chat.openChat(user.id, user.username);
        $('#users-list-panel').classList.add('hidden');
        $('#conversations-list').classList.remove('hidden');
      });
    }, 300);
  });

  // -------------------- Message Input --------------------
  const messageInput = $('#message-input');
  const sendBtn = $('#send-btn');

  messageInput.addEventListener('input', () => {
    // Auto resize
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
    // Enable/disable send
    sendBtn.disabled = !messageInput.value.trim();
    // Emit typing
    Chat.emitTyping();
  });

  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (messageInput.value.trim()) {
        Chat.sendMessage(messageInput.value);
        messageInput.value = '';
        messageInput.style.height = 'auto';
        sendBtn.disabled = true;
      }
    }
  });

  sendBtn.addEventListener('click', () => {
    if (messageInput.value.trim()) {
      Chat.sendMessage(messageInput.value);
      messageInput.value = '';
      messageInput.style.height = 'auto';
      sendBtn.disabled = true;
    }
  });

  // -------------------- Media Upload --------------------
  $('#attach-btn').addEventListener('click', () => {
    $('#media-input').click();
  });

  $('#media-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      await Chat.uploadAndSendAttachment(file);
      showToast('Media sent', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to upload media', 'error');
    } finally {
      e.target.value = '';
    }
  });

  // -------------------- Voice Calls --------------------
  $('#voice-call-btn').addEventListener('click', async () => {
    try {
      await Chat.startVoiceCall();
    } catch (err) {
      showToast(err.message || 'Failed to start call', 'error');
    }
  });

  $('#call-accept-btn').addEventListener('click', () => Chat.acceptIncomingCall());
  $('#call-decline-btn').addEventListener('click', () => Chat.declineIncomingCall());
  $('#call-end-btn').addEventListener('click', () => Chat.endVoiceCall());

  // -------------------- Mobile Back Button --------------------
  $('#mobile-back-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.remove('sidebar-hidden');
    $('#chat-empty').classList.remove('hidden');
    $('#chat-active').classList.add('hidden');
  });

  // -------------------- Emoji Picker --------------------
  const emojis = ['😀','😂','😍','🥰','😎','🤩','😢','😡','👍','👎','❤️','🔥','🎉','🙏','💪','🤔','😏','🥺','👏','💯','✨','🌟','🎊','🤝','😇','🫡','🙌','💀','😭','🤣','😤','🤯','🥳','😴','🤗','💬','📩','✅','⚡','🚀'];

  const emojiGrid = document.querySelector('.emoji-grid');
  emojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      messageInput.value += emoji;
      messageInput.focus();
      sendBtn.disabled = !messageInput.value.trim();
      $('#emoji-picker').classList.add('hidden');
    });
    emojiGrid.appendChild(btn);
  });

  $('#emoji-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#emoji-picker').classList.toggle('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.emoji-picker') && !e.target.closest('#emoji-btn')) {
      $('#emoji-picker').classList.add('hidden');
    }
  });

  // -------------------- Initialize App --------------------
  async function init() {
    initTheme();

    // Check if already logged in
    const isLoggedIn = await Auth.checkAuth();

    // Fade out loading screen
    setTimeout(() => {
      loadingScreen.classList.add('fade-out');
      setTimeout(() => {
        loadingScreen.classList.add('hidden');
      }, 500);

      if (isLoggedIn) {
        showChat();
      } else {
        showAuth();
      }
    }, 800);
  }

  init();
})();
