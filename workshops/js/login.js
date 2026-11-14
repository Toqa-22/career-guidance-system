import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function clearLoginFields() {
    document.getElementById('loginError').style.display = 'none';
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
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
        // The username/password pair lives in a database table — checked
        // through a Postgres function (verify_admin_login) so the browser
        // never sees the stored password or its hash, only a true/false
        // answer.
        const { data, error } = await client.rpc('verify_admin_login', {
            p_username: u,
            p_password: p
        });

        if (error) throw error;

        if (data === true) {
            sessionStorage.setItem('isAdminAuthed', '1');
            window.location.href = 'admin/chart.html';
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

window.closeAdminLogin = clearLoginFields;
window.attemptAdminLogin = attemptAdminLogin;
