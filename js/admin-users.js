import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/config.js';
import { requireSession } from '../js/admin-shared.js';

requireSession();
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function setNote(message, isError) {
    const note = document.getElementById('addUserNote');
    note.textContent = message || '';
    note.className = `admin-note${isError ? ' error' : ' success'}`;
}

async function loadUsers() {
    const tbody = document.getElementById('usersTableBody');
    const { data, error } = await client.rpc('admin_list_users');
    if (error) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="4">Couldn't load users: ${error.message}</td></tr>`;
        return;
    }
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="4">No admin logins yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(u => `
        <tr>
            <td>${u.username}</td>
            <td>${u.full_name || '—'}</td>
            <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}</td>
            <td>
                <div class="admin-row-actions">
                    <button class="admin-btn admin-btn-small admin-btn-secondary" data-action="edit" data-username="${u.username}" data-fullname="${(u.full_name || '').replace(/"/g, '&quot;')}">Edit</button>
                    <button class="admin-btn admin-btn-small admin-btn-secondary" data-action="reset" data-username="${u.username}">Reset Password</button>
                    <button class="admin-btn admin-btn-small admin-btn-danger" data-action="delete" data-username="${u.username}" ${u.username === currentSessionUsername() ? 'disabled title="You can\'t remove your own account"' : ''}>Remove</button>
                </div>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', () => editUser(btn.dataset.username, btn.dataset.fullname));
    });
    tbody.querySelectorAll('[data-action="reset"]').forEach(btn => {
        btn.addEventListener('click', () => resetPassword(btn.dataset.username));
    });
    tbody.querySelectorAll('[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', () => deleteUser(btn.dataset.username));
    });
}

async function editUser(username, currentFullName) {
    const result = await formCard('Edit User', [
        { name: 'username', label: 'Username', value: username },
        { name: 'fullName', label: 'Full name', value: currentFullName || '' }
    ], { okLabel: 'Save' });
    if (!result) return;
    if (!result.username) { alert('Username cannot be empty.'); return; }
    if (!(await confirmCard(`Save these changes for "${username}"?`))) return;

    const { error } = await client.rpc('admin_update_user', {
        p_old_username: username, p_new_username: result.username, p_full_name: result.fullName || null
    });
    if (error) {
        alert('Could not update user: ' + error.message);
        return;
    }
    alert('Updated successfully!');
    loadUsers();
}

async function resetPassword(username) {
    const result = await formCard('Reset Password', [
        { name: 'password', label: `New password for "${username}"`, type: 'password', placeholder: 'New password' }
    ], { okLabel: 'Reset' });
    if (!result) return;
    if (!result.password) { alert('Please enter a new password.'); return; }
    if (!(await confirmCard(`Set this new password for "${username}"?`))) return;
    const { error } = await client.rpc('admin_reset_password', { p_username: username, p_new_password: result.password });
    if (error) {
        alert('Could not reset password: ' + error.message);
        return;
    }
    alert(`Password updated for "${username}"!`);
}

function currentSessionUsername() {
    try {
        const raw = localStorage.getItem('ibra_admin_session');
        const session = raw ? JSON.parse(raw) : null;
        return session ? session.username : null;
    } catch {
        return null;
    }
}

async function deleteUser(username) {
    if (username === currentSessionUsername()) {
        alert("You can't remove your own account while signed in as it.");
        return;
    }
    if (!(await confirmCard(`Remove admin login "${username}"? This cannot be undone.`))) return;
    const { error } = await client.rpc('admin_delete_user', { p_username: username });
    if (error) {
        alert('Could not remove user: ' + error.message);
        return;
    }
    alert('Removed successfully!');
    loadUsers();
}

document.getElementById('addUserBtn').addEventListener('click', async () => {
    const username = document.getElementById('newUsername').value.trim();
    const fullName = document.getElementById('newFullName').value.trim();
    const password = document.getElementById('newPassword').value;
    setNote('', false);

    if (!username || !password) {
        setNote('Username and password are required.', true);
        return;
    }
    if (!(await confirmCard(`Add a new admin login "${username}"?`))) return;

    const btn = document.getElementById('addUserBtn');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
        const { error } = await client.rpc('admin_create_user', {
            p_username: username, p_full_name: fullName || null, p_password: password
        });
        if (error) throw error;
        setNote(`Admin "${username}" added successfully!`, false);
        document.getElementById('newUsername').value = '';
        document.getElementById('newFullName').value = '';
        document.getElementById('newPassword').value = '';
        loadUsers();
    } catch (err) {
        setNote('Could not add admin: ' + err.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = '+ Add';
    }
});

loadUsers();
