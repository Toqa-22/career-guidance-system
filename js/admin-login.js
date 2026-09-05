import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Deliberately a SEPARATE key from the general hub session — reaching the
// admin panel always requires entering credentials here, even if the
// person is already signed into the hub/Workshops/Training.
const ADMIN_PANEL_KEY = 'ibra_admin_panel_session';
const ADMIN_PANEL_HOURS = 12;

function getAdminPanelSession() {
    try {
        const raw = localStorage.getItem(ADMIN_PANEL_KEY);
        if (!raw) return null;
        const session = JSON.parse(raw);
        if (!session || !session.username || !session.loginAt) return null;
        if ((Date.now() - session.loginAt) / 3600000 > ADMIN_PANEL_HOURS) return null;
        return session;
    } catch {
        return null;
    }
}

if (getAdminPanelSession()) {
    location.replace('users.html');
}

async function attemptAdminPanelLogin() {
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
        const { data, error } = await client.rpc('verify_admin_login', {
            p_username: u,
            p_password: p
        });

        if (error) throw error;

        if (data === true) {
            localStorage.setItem(ADMIN_PANEL_KEY, JSON.stringify({ username: u, loginAt: Date.now() }));
            // Best-effort — a failed log write shouldn't block the actual
            // login. supabase-js's .rpc() returns a "thenable" builder, not
            // a real Promise, so .catch() isn't a method on it directly —
            // .then(onFulfilled, onRejected) is the safe way to swallow a
            // failure here.
            client.rpc('record_admin_login', { p_username: u }).then(() => {}, () => {});
            window.location.href = 'users.html';
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
    if (e.key === 'Enter') attemptAdminPanelLogin();
});
document.getElementById('loginUsername').addEventListener('keydown', e => {
    if (e.key === 'Enter') attemptAdminPanelLogin();
});

window.attemptAdminPanelLogin = attemptAdminPanelLogin;
