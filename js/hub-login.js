import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Shared session format/key — both workshops/js/auth-guard.js and every
// guarded page in training/ check this exact same localStorage entry, so
// signing in once here is what lets both projects skip their own login.
const AUTH_STORAGE_KEY = 'ibra_admin_session';
const AUTH_SESSION_HOURS = 12;

function getSession() {
    try {
        const raw = localStorage.getItem(AUTH_STORAGE_KEY);
        if (!raw) return null;
        const session = JSON.parse(raw);
        if (!session || !session.username || !session.loginAt) return null;
        if ((Date.now() - session.loginAt) / 3600000 > AUTH_SESSION_HOURS) return null;
        return session;
    } catch {
        return null;
    }
}

function setSession(username, role, fullName) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ username, role, fullName: fullName || null, loginAt: Date.now() }));
}

// Already signed in this session — skip straight to the right place.
const existing = getSession();
if (existing) {
    location.replace(existing.role === 'admin' ? 'admin/users.html' : 'hub.html');
}

async function attemptAdminLogin() {
    const u = document.getElementById('loginUsername').value.trim();
    const p = document.getElementById('loginPassword').value;
    const submitBtn = document.getElementById('loginSubmitBtn');
    const errorBox = document.getElementById('loginError');
    errorBox.style.display = 'none';

    if (!u || !p) {
        errorBox.innerText = 'Please enter both a username and password.';
        errorBox.style.display = 'block';
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerText = 'Checking...';

    try {
        // verify_login returns { role, full_name } as JSON on success, or
        // null on a wrong username/password — this one check is now the
        // ONLY login step; where it sends you next depends on the role.
        const { data: loginResult, error } = await client.rpc('verify_login', {
            p_username: u,
            p_password: p
        });

        if (error) throw error;

        if (loginResult) {
            const role = loginResult.role;
            const fullName = loginResult.full_name;

            // Best-effort — a failed log write shouldn't block the actual
            // login. supabase-js's .rpc() returns a "thenable" builder, not
            // a real Promise, so .catch() isn't a method on it directly —
            // .then(onFulfilled, onRejected) is the safe way to swallow a
            // failure here.
            client.rpc('record_admin_login', { p_username: u }).then(() => {}, () => {});

            const { data: mustChange } = await client.rpc('must_change_password', { p_username: u });
            if (mustChange) {
                // First time signing in — hold off on creating the real
                // session until they've set their own password.
                sessionStorage.setItem('ibra_pending_first_login', JSON.stringify({ username: u, role, fullName }));
                window.location.href = 'first-login.html';
                return;
            }

            setSession(u, role, fullName);
            window.location.href = role === 'admin' ? 'admin/users.html' : 'hub.html';
        } else {
            errorBox.innerText = 'Incorrect username or password.';
            errorBox.style.display = 'block';
        }
    } catch (err) {
        errorBox.innerText = 'Login check failed: ' + err.message;
        errorBox.style.display = 'block';
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = 'Enter';
    }
}

document.getElementById('loginUsername').focus();
document.getElementById('loginPassword').addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptAdminLogin();
});
document.getElementById('loginUsername').addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptAdminLogin();
});

const EYE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/></svg>';

document.getElementById('togglePasswordBtn').addEventListener('click', () => {
    const pwd = document.getElementById('loginPassword');
    const btn = document.getElementById('togglePasswordBtn');
    const showing = pwd.type === 'text';
    pwd.type = showing ? 'password' : 'text';
    btn.innerHTML = showing ? EYE_ICON : EYE_OFF_ICON;
    btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
});

window.attemptAdminLogin = attemptAdminLogin;
