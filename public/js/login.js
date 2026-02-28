'use strict';

const alertEl = document.getElementById('alert');

function showAlert(msg, type = 'error') {
  alertEl.textContent = msg;
  alertEl.className = `alert ${type} show`;
  setTimeout(() => alertEl.classList.remove('show'), 5000);
}

function setLoading(btn, loading) {
  if (loading) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>Please wait…';
  } else {
    btn.disabled = false;
    btn.textContent = btn.id === 'login-btn' ? 'Sign In' : 'Create Account';
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab + '-section').classList.add('active');
    alertEl.classList.remove('show');
  });
});

document.getElementById('login-2fa-back').addEventListener('click', () => {
  document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
  document.getElementById('login-section').classList.add('active');
  document.getElementById('login-totp').value = '';
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  setLoading(btn, true);
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('login-username').value,
        password: document.getElementById('login-password').value
      })
    });
    const data = await res.json();
    if (res.status === 403 && data['2fa_required']) {
      document.querySelectorAll('.form-section').forEach(s => s.classList.remove('active'));
      document.getElementById('login-2fa-section').classList.add('active');
      document.getElementById('login-totp').focus();
      setLoading(btn, false);
      return;
    }
    if (res.ok) {
      showAlert(`Welcome back, ${data.username}!`, 'success');
      setTimeout(() => window.location.href = '/app', 600);
    } else {
      showAlert(data.error || 'Login failed');
      setLoading(btn, false);
    }
  } catch (_) {
    showAlert('Network error – is the server running?');
    setLoading(btn, false);
  }
});

document.getElementById('login-2fa-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('login-2fa-btn');
  setLoading(btn, true);
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('login-username').value,
        password: document.getElementById('login-password').value,
        totp: document.getElementById('login-totp').value
      })
    });
    const data = await res.json();
    if (res.ok) {
      showAlert(`Welcome back, ${data.username}!`, 'success');
      setTimeout(() => window.location.href = '/app', 600);
    } else {
      showAlert(data.error || 'Login failed');
      setLoading(btn, false);
    }
  } catch (_) {
    showAlert('Network error – is the server running?');
    setLoading(btn, false);
  }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('reg-btn');
  setLoading(btn, true);
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('reg-username').value,
        email: document.getElementById('reg-email').value,
        password: document.getElementById('reg-password').value
      })
    });
    const data = await res.json();
    if (res.ok) {
      showAlert('Account created! Redirecting…', 'success');
      setTimeout(() => window.location.href = '/app', 800);
    } else {
      showAlert(data.error || 'Registration failed');
      setLoading(btn, false);
    }
  } catch (_) {
    showAlert('Network error – is the server running?');
    setLoading(btn, false);
  }
});
