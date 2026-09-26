import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

const session = getSession();
if (!session) {
    location.replace('index.html');
} else {
    const el = document.getElementById('hubWelcome');
    if (el) el.textContent = 'Welcome, ' + (session.fullName || session.username);

    // Fire-and-forget server-side re-check, same pattern as admin-shared.js —
    // renders immediately from the local session, but revokes access
    // shortly after if the database says this token isn't actually valid
    // anymore (deleted account, reset password, expired server-side).
    client.rpc('validate_session', { p_session_token: session.sessionToken }).then(({ data }) => {
        if (!data) {
            sessionStorage.removeItem(AUTH_STORAGE_KEY);
            location.replace('index.html');
        }
    }, () => { /* network hiccup — don't bounce the user out over a transient failure */ });
}

// The hub's own logout is the ONLY logout that goes to the real login page —
// logging out from inside Workshops or Training instead returns here, to
// this 2-card picker, so the person can jump straight to the other system
// without having to sign in twice.
async function logoutHub() {
    const current = getSession();
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    if (current && current.sessionToken) {
        try { await client.rpc('logout_session', { p_session_token: current.sessionToken }); } catch { /* already logged out locally regardless */ }
    }
    location.href = 'index.html';
}
window.logoutHub = logoutHub;
