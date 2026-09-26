// ============================================================================
// idle-timeout.js
// Logs the signed-in user out and returns to the login page after
// IDLE_TIMEOUT_MS of no activity at all -- no mouse movement, click, key
// press, scroll, or touch. The timer resets on any of those events, so it
// only fires after a genuine period of inactivity, never mid-use.
//
// Include on every protected page with:
//   <script src="PATH/idle-timeout.js" data-login-path="../../index.html"></script>
// data-login-path is the relative path FROM THAT PAGE back to the hub's
// login page (index.html) -- this varies by how deep the including page
// sits (workshops/admin/*.html needs "../../index.html", training/*.html
// needs "../index.html", hub.html itself needs just "index.html").
//
// This is a plain (non-module) script deliberately, so it can be dropped
// into any page -- including Training's pages, which don't use ES modules
// -- without changing how anything else on that page loads. Uses a direct
// fetch() to Supabase's REST RPC endpoint for the same reason auth-guard.js
// does: no import available in a non-module script. Same public URL/anon
// key already visible in js/config.js -- not a secret duplicated unsafely.
// ============================================================================
(function () {
    var IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    var AUTH_KEY = 'ibra_admin_session';
    var SUPABASE_URL = 'https://wldrxargdqrthizeomio.supabase.co';
    var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndsZHJ4YXJnZHFydGhpemVvbWlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxMDQ3MDQsImV4cCI6MjEwMzY4MDcwNH0.Uap9b7lRLSxx1SgFCI9IkMGH_jV1yB5RW3ETW23Wgrw';
    var loginPath = (document.currentScript && document.currentScript.getAttribute('data-login-path')) || 'index.html';

    var timer = null;
    var loggedOut = false;

    function doIdleLogout() {
        if (loggedOut) return; // avoid double-firing/double-redirect
        loggedOut = true;

        var raw = sessionStorage.getItem(AUTH_KEY);
        sessionStorage.removeItem(AUTH_KEY);

        if (raw) {
            try {
                var session = JSON.parse(raw);
                if (session && session.sessionToken) {
                    // Best-effort revoke server-side too, not just cleared
                    // locally -- keepalive lets this finish even as the
                    // page navigates away right after.
                    fetch(SUPABASE_URL + '/rest/v1/rpc/logout_session', {
                        method: 'POST',
                        headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ p_session_token: session.sessionToken }),
                        keepalive: true
                    }).then(function () {}, function () {});
                }
            } catch (e) { /* nothing valid to revoke */ }
        }

        window.location.href = loginPath;
    }

    function resetIdleTimer() {
        if (loggedOut) return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(doIdleLogout, IDLE_TIMEOUT_MS);
    }

    ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach(function (evt) {
        document.addEventListener(evt, resetIdleTimer, { passive: true });
    });

    resetIdleTimer();
})();
