// Runs at the top of every admin page.
// Checks the SAME shared session the hub login (../index.html) and the
// Training project both use — one login now covers both systems. Bounces
// to the hub's login page if there's no valid session.
(function () {
    var AUTH_KEY = "ibra_admin_session";
    var MAX_HOURS = 12;
    try {
        var raw = localStorage.getItem(AUTH_KEY);
        var session = raw ? JSON.parse(raw) : null;
        var valid = !!(session && session.username && session.loginAt &&
            ((Date.now() - session.loginAt) / 3600000 <= MAX_HOURS));
        if (!valid) {
            localStorage.removeItem(AUTH_KEY);
            window.location.href = '../../index.html';
        }
    } catch (e) {
        window.location.href = '../../index.html';
    }
})();

function logoutAdmin() {
    // This does NOT clear the session — it just returns to the hub's
    // 2-card picker, still signed in, so the other project is one click
    // away. Clearing the session here would immediately bounce straight
    // back to the login page anyway, since hub.html itself requires a
    // valid session to view — only the hub's OWN logout button actually
    // ends the session.
    window.location.href = '../../hub.html';
}
window.logoutAdmin = logoutAdmin;

// Shows who's signed in under the sidebar logo, on every admin page. Runs
// on DOMContentLoaded (not inside the IIFE above) since this script loads
// before the sidebar HTML exists in the DOM.
document.addEventListener('DOMContentLoaded', function () {
    var el = document.getElementById('sidebarUsername');
    if (!el) return;
    try {
        var raw = localStorage.getItem('ibra_admin_session');
        var session = raw ? JSON.parse(raw) : null;
        if (session && session.username) el.textContent = 'Welcome, ' + (session.fullName || session.username);
    } catch (e) { /* no session — leave it blank */ }
});
