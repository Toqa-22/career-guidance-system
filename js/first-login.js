import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const AUTH_STORAGE_KEY = 'ibra_admin_session';
const PENDING_KEY = 'ibra_pending_first_login'; // set by hub-login.js right after verify_login succeeds

// No pending first-login in progress — nothing to do here, back to the
// real login instead of leaving a dead-end page.
let pending = null;
try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
} catch { /* treat as missing */ }
if (!pending || !pending.username || !pending.role) {
    location.replace('index.html');
}

function setupToggle(btnId, inputId) {
    const EYE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
    const EYE_OFF_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';
    document.getElementById(btnId).addEventListener('click', () => {
        const input = document.getElementById(inputId);
        const btn = document.getElementById(btnId);
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.innerHTML = showing ? EYE_ICON : EYE_OFF_ICON;
        btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    });
}
setupToggle('toggleNewPasswordBtn', 'newPassword');
setupToggle('toggleConfirmPasswordBtn', 'confirmPassword');

async function attemptSetPassword() {
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const submitBtn = document.getElementById('loginSubmitBtn');
    const errorBox = document.getElementById('loginError');
    errorBox.style.display = 'none';

    if (!newPassword || newPassword.length < 6) {
        errorBox.innerText = 'Please choose a password with at least 6 characters.';
        errorBox.style.display = 'block';
        return;
    }
    if (newPassword !== confirmPassword) {
        errorBox.innerText = "Passwords don't match — please enter the same password in both boxes.";
        errorBox.style.display = 'block';
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerText = 'Saving...';

    try {
        const { error } = await client.rpc('change_own_password', {
            p_username: pending.username,
            p_new_password: newPassword
        });
        if (error) throw error;

        // Password set — now actually complete the login the same way a
        // normal sign-in would: real session, routed by role.
        sessionStorage.removeItem(PENDING_KEY);
        localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ username: pending.username, role: pending.role, fullName: pending.fullName || null, loginAt: Date.now() }));
        window.location.href = pending.role === 'admin' ? 'admin/users.html' : 'hub.html';
    } catch (err) {
        errorBox.innerText = 'Could not set your password: ' + err.message;
        errorBox.style.display = 'block';
        submitBtn.disabled = false;
        submitBtn.innerText = 'Save & Continue';
    }
}

document.getElementById('newPassword').focus();
window.attemptSetPassword = attemptSetPassword;
