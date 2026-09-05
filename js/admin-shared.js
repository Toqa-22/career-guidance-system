// One login now (the hub's index.html) routes admin accounts straight here
// and everyone else to hub.html — no separate admin re-login step anymore.
// This guard just confirms the shared session exists AND has the admin role.
const AUTH_STORAGE_KEY = 'ibra_admin_session';
const AUTH_SESSION_HOURS = 12;

export function getSession() {
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

export function requireSession() {
    const session = getSession();
    if (!session || session.role !== 'admin') {
        location.replace('../index.html');
    }
    return session;
}

window.logoutHubAdmin = function () {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    location.href = '../index.html';
};
