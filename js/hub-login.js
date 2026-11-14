import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Shared session format/key — both workshops/js/auth-guard.js and every
// guarded page in training/ check this exact same sessionStorage entry, so
// signing in once here is what lets both projects skip their own login.
//
// SECURITY: this session object now carries a server-issued sessionToken —
// NEVER the password, at any point. verify_login() only ever returns a
// token on success; the actual password never leaves the login form except
// as part of the one verify_login call itself (over HTTPS), and is never
// written to any storage.
const AUTH_STORAGE_KEY = 'ibra_admin_session';
const AUTH_SESSION_HOURS = 12;

function getSession() {
    try {
        const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
        if (!raw) return null;
        const session = JSON.parse(raw);
        if (!session || !session.username || !session.loginAt || !session.sessionToken) return null;
        if ((Date.now() - session.loginAt) / 3600000 > AUTH_SESSION_HOURS) return null;
        return session;
    } catch {
        return null;
    }
}

function setSession(username, role, fullName, sessionToken) {
    sessionStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ username, role, fullName: fullName || null, sessionToken, loginAt: Date.now() }));
}

// Deliberately NO auto-redirect here even if a session already exists —
// opening the login page always shows the login form and requires a fresh
// username+password entry, by explicit design. Skipping straight to the
// dashboard because of a leftover session is exactly the "auto login /
// remember me" behavior this project does not want. Any leftover session
// is revoked server-side too (not just removed locally), so an old token
// doesn't remain valid in the database until its natural expiry just
// because nothing in the browser can reach it anymore.
(function clearAnyStaleSession() {
    try {
        const raw = sessionStorage.getItem(AUTH_STORAGE_KEY);
        sessionStorage.removeItem(AUTH_STORAGE_KEY);
        if (!raw) return;
        const stale = JSON.parse(raw);
        if (stale && stale.sessionToken) {
            client.rpc('logout_session', { p_session_token: stale.sessionToken }).then(() => {}, () => {});
        }
    } catch { /* nothing valid to clear */ }
})();

function formatLockedUntil(iso) {
    try {
        const mins = Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000));
        return `Too many failed attempts. Please try again in about ${mins} minute${mins === 1 ? '' : 's'}.`;
    } catch {
        return 'Too many failed attempts. Please try again in a few minutes.';
    }
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
        // verify_login now returns { success, reason, ... } — success:true
        // includes role/full_name/session_token/expires_at/
        // must_change_password; success:false includes reason
        // ('invalid_credentials' or 'locked', with locked_until on the
        // latter). The account lockout after repeated wrong passwords is
        // enforced HERE, server-side, in verify_login itself — this is not
        // a frontend-only check.
        const { data: loginResult, error } = await client.rpc('verify_login', {
            p_username: u,
            p_password: p
        });

        if (error) throw error;

        if (loginResult && loginResult.success) {
            const { role, full_name: fullName, session_token: sessionToken, must_change_password: mustChange } = loginResult;

            // Best-effort — a failed log write shouldn't block the actual
            // login. supabase-js's .rpc() returns a "thenable" builder, not
            // a real Promise, so .catch() isn't a method on it directly —
            // .then(onFulfilled, onRejected) is the safe way to swallow a
            // failure here.
            client.rpc('record_admin_login', { p_session_token: sessionToken }).then(() => {}, () => {});

            if (mustChange) {
                // First time signing in — hold off on creating the real
                // session until they've set their own password. The fresh
                // session token travels with this pending object so
                // first-login.html can call change_own_password
                // authenticated as this exact account, not a bare
                // client-supplied username.
                sessionStorage.setItem('ibra_pending_first_login', JSON.stringify({ username: u, role, fullName, sessionToken }));
                window.location.href = 'first-login.html';
                return;
            }

            setSession(u, role, fullName, sessionToken);
            window.location.href = role === 'admin' ? 'admin/users.html' : 'hub.html';
        } else if (loginResult && loginResult.reason === 'locked') {
            errorBox.innerText = formatLockedUntil(loginResult.locked_until);
            errorBox.style.display = 'block';
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
