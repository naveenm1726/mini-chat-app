// ============================================================
//  AUTH.JS — Frontend Authentication Logic
// ============================================================

const Auth = (() => {
  let currentUser = null;
  let authToken = null;

  // -------------------- API Calls --------------------
  async function apiCall(url, options = {}) {
    const token = getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers
    };

    const res = await fetch(url, { ...options, headers });
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Something went wrong');
    }
    return data;
  }

  // -------------------- Token Management --------------------
  function getToken() {
    if (authToken) return authToken;
    return localStorage.getItem('chat_app_token') || localStorage.getItem('mini_chat_token');
  }

  function setToken(token) {
    authToken = token;
    localStorage.setItem('chat_app_token', token);
    localStorage.removeItem('mini_chat_token');
  }

  function clearToken() {
    authToken = null;
    localStorage.removeItem('chat_app_token');
    localStorage.removeItem('chat_app_user');
    localStorage.removeItem('mini_chat_token');
    localStorage.removeItem('mini_chat_user');
  }

  function setUser(user) {
    currentUser = user;
    localStorage.setItem('chat_app_user', JSON.stringify(user));
    localStorage.removeItem('mini_chat_user');
  }

  function getUser() {
    if (currentUser) return currentUser;
    const stored = localStorage.getItem('chat_app_user') || localStorage.getItem('mini_chat_user');
    if (stored) {
      currentUser = JSON.parse(stored);
      return currentUser;
    }
    return null;
  }

  // -------------------- Register --------------------
  async function register(username, email, password) {
    const data = await apiCall('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, email, password })
    });
    setToken(data.token);
    setUser(data.user);
    return data;
  }

  // -------------------- Login --------------------
  async function login(login, password) {
    const data = await apiCall('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ login, password })
    });
    setToken(data.token);
    setUser(data.user);
    return data;
  }

  // -------------------- Logout --------------------
  async function logout() {
    try {
      await apiCall('/api/auth/logout', { method: 'POST' });
    } catch (e) { /* ignore */ }
    clearToken();
    currentUser = null;
  }

  // -------------------- Check if logged in --------------------
  async function checkAuth() {
    const token = getToken();
    if (!token) return false;

    try {
      const data = await apiCall('/api/auth/me');
      setUser(data.user);
      return true;
    } catch (e) {
      clearToken();
      return false;
    }
  }

  // -------------------- Update profile --------------------
  async function updateProfile(bio, avatar_url) {
    const data = await apiCall('/api/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({ bio, avatar_url })
    });
    setUser(data.user);
    return data;
  }

  async function changePassword(currentPassword, newPassword) {
    return apiCall('/api/auth/change-password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword })
    });
  }

  async function uploadProfilePhoto(file) {
    const token = getToken();
    const formData = new FormData();
    formData.append('avatar', file);

    const res = await fetch('/api/auth/profile/photo', {
      method: 'POST',
      headers: {
        ...(token && { Authorization: `Bearer ${token}` })
      },
      body: formData
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to upload profile photo');
    }

    setUser(data.user);
    return data;
  }

  return {
    apiCall,
    getToken,
    getUser,
    register,
    login,
    logout,
    checkAuth,
    updateProfile,
    changePassword,
    uploadProfilePhoto
  };
})();
