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

const session = getSession();
if (!session) {
    location.replace('index.html');
} else {
    const el = document.getElementById('hubWelcome');
    if (el) el.textContent = 'Welcome, ' + (session.fullName || session.username);
}

// The hub's own logout is the ONLY logout that goes to the real login page —
// logging out from inside Workshops or Training instead returns here, to
// this 2-card picker, so the person can jump straight to the other system
// without having to sign in twice.
function logoutHub() {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    location.href = 'index.html';
}
window.logoutHub = logoutHub;
