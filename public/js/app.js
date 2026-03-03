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
    const saved = localStorage.getItem('mini_chat_theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('mini_chat_theme', next);
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
    }
    $('#profile-modal').classList.remove('hidden');
  });

  $('#close-profile-modal').addEventListener('click', () => {
    $('#profile-modal').classList.add('hidden');
  });

  $('#profile-modal .modal-backdrop').addEventListener('click', () => {
    $('#profile-modal').classList.add('hidden');
  });

  $('#save-profile-btn').addEventListener('click', async () => {
    try {
      const bio = $('#profile-bio').value;
      await Auth.updateProfile(bio, '');
      showToast('Profile updated!', 'success');
      $('#profile-modal').classList.add('hidden');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // -------------------- New Chat Button --------------------
  $('#new-chat-btn').addEventListener('click', () => {
    $('#conversations-list').classList.add('hidden');
    $('#users-list-panel').classList.remove('hidden');
    Chat.loadAllUsers();
  });

  $('#back-to-convos').addEventListener('click', () => {
    $('#users-list-panel').classList.add('hidden');
    $('#conversations-list').classList.remove('hidden');
  });

  // -------------------- Search Users --------------------
  let searchDebounce = null;
  $('#search-users').addEventListener('input', (e) => {
    clearTimeout(searchDebounce);
    const query = e.target.value.trim();

    if (!query) {
      // Show conversations again
      $('#users-list-panel').classList.add('hidden');
      $('#conversations-list').classList.remove('hidden');
      return;
    }

    searchDebounce = setTimeout(async () => {
      // Show users panel with search results
      $('#conversations-list').classList.add('hidden');
      $('#users-list-panel').classList.remove('hidden');

      const users = await Chat.searchUsers(query);
      const container = document.getElementById('all-users-items');

      if (users.length === 0) {
        container.innerHTML = `
          <div style="text-align:center; padding:40px 20px; color:var(--text-tertiary);">
            <p style="font-size:0.88rem;">No users found for "${query}"</p>
          </div>
        `;
        return;
      }

      container.innerHTML = users.map(u => `
        <div class="conversation-item" data-user-id="${u.id}" data-username="${u.username}">
          <div class="avatar avatar-md">
            <span class="avatar-letter">${u.username[0]}</span>
          </div>
          <div class="convo-info">
            <div class="convo-name"><span>${u.username}</span></div>
          </div>
        </div>
      `).join('');

      container.querySelectorAll('.conversation-item').forEach(item => {
        item.addEventListener('click', () => {
          Chat.openChat(parseInt(item.dataset.userId), item.dataset.username);
          $('#users-list-panel').classList.add('hidden');
          $('#conversations-list').classList.remove('hidden');
          $('#search-users').value = '';
        });
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
