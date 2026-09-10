// Runs at the top of every admin page.
// Checks the SAME shared session the hub login (../index.html) and the
// Training project both use — one login now covers both systems. Bounces
// to the hub's login page if there's no valid session.
(function () {
    var AUTH_KEY = "ibra_admin_session";
    var MAX_HOURS = 12;
    var session = null;
    try {
        var raw = sessionStorage.getItem(AUTH_KEY);
        session = raw ? JSON.parse(raw) : null;
        var valid = !!(session && session.username && session.loginAt && session.sessionToken &&
            ((Date.now() - session.loginAt) / 3600000 <= MAX_HOURS));
        if (!valid) {
            sessionStorage.removeItem(AUTH_KEY);
            window.location.href = '../../index.html';
            return;
        }
    } catch (e) {
        window.location.href = '../../index.html';
        return;
    }

    // Fire-and-forget server-side re-check — renders immediately from the
    // local session (matching the fast synchronous check above), but
    // revokes access shortly after if the database says this token isn't
    // actually valid anymore (deleted account, reset password, expired
    // server-side). This is a plain script (not a module, since it must
    // run synchronously/immediately for the check above), so a direct
    // fetch() is used here instead of importing the supabase-js client —
    // these are the same public URL/anon key already visible in
    // js/config.js, not a secret duplicated unsafely.
    var SUPABASE_URL = "https://wldrxargdqrthizeomio.supabase.co";
    var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsZHJ4YXJnZHFydGhpemVvbWlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxMDQ3MDQsImV4cCI6MjEwMzY4MDcwNH0.Uap9b7lRLSxx1SgFCI9IkMGH_jV1yB5RW3ETW23Wgrw";
    fetch(SUPABASE_URL + '/rest/v1/rpc/validate_session', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_session_token: session.sessionToken })
    }).then(function (res) { return res.json(); }).then(function (data) {
        if (!data) {
            sessionStorage.removeItem(AUTH_KEY);
            window.location.href = '../../index.html';
        }
    }, function () { /* network hiccup — don't bounce the admin out over a transient failure */ });
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
        var raw = sessionStorage.getItem('ibra_admin_session');
        var session = raw ? JSON.parse(raw) : null;
        if (session && session.username) el.textContent = 'Welcome, ' + (session.fullName || session.username);
    } catch (e) { /* no session — leave it blank */ }
});
