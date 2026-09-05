import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/config.js';
import { requireSession } from '../js/admin-shared.js';

requireSession();
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function loadLogins() {
    const tbody = document.getElementById('loginsTableBody');
    const { data, error } = await client.rpc('admin_list_logins', { p_limit: 50 });

    if (error) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="3">Couldn't load login history: ${error.message}</td></tr>`;
        return;
    }
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="3">No sign-ins recorded yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(row => `
        <tr>
            <td>${row.username}</td>
            <td>${row.full_name || '—'}</td>
            <td>${new Date(row.logged_in_at).toLocaleString()}</td>
        </tr>
    `).join('');
}

loadLogins();
