import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// One login now (the hub's index.html) routes admin accounts straight here
// and everyone else to hub.html — no separate admin re-login step anymore.
// This guard confirms the shared session exists locally AND (asynchronously,
// right after) that it's still genuinely valid server-side — an admin may
// have deleted this account or reset its password since the token was
// issued, and a purely client-side check would never know that.
const AUTH_STORAGE_KEY = 'ibra_admin_session';
const AUTH_SESSION_HOURS = 12;

export const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export function getSession() {
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

export function requireSession() {
    const session = getSession();
    if (!session || session.role !== 'admin') {
        location.replace('../index.html');
        return session;
    }

    // Fire-and-forget server-side re-check — does not block the page (the
    // shape-valid local session above is enough to render immediately),
    // but revokes access shortly after if the database says this token is
    // no longer actually valid.
    client.rpc('validate_session', { p_session_token: session.sessionToken }).then(({ data }) => {
        if (!data) {
            sessionStorage.removeItem(AUTH_STORAGE_KEY);
            location.replace('../index.html');
        }
    }, () => { /* network hiccup — don't bounce the admin out over a transient failure */ });

    return session;
}

window.logoutHubAdmin = async function () {
    const session = getSession();
    sessionStorage.removeItem(AUTH_STORAGE_KEY);
    if (session && session.sessionToken) {
        // Best-effort — the local session is already cleared above either way,
        // this just also revokes the token server-side so it can't be reused
        // (e.g. if it had leaked) even though it hasn't expired yet.
        try { await client.rpc('logout_session', { p_session_token: session.sessionToken }); } catch { /* already logged out locally regardless */ }
    }
    location.href = '../index.html';
};
