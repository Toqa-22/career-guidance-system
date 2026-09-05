import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/config.js';
import { requireSession } from '../js/admin-shared.js';

requireSession();
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function loadLog() {
    const tbody = document.getElementById('deletionLogBody');
    const { data, error } = await client
        .from('deletion_audit_log')
        .select('*')
        .order('deleted_at', { ascending: false })
        .limit(200);

    if (error) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="5">Couldn't load the log: ${error.message}</td></tr>`;
        return;
    }
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="5">Nothing has been deleted yet.</td></tr>`;
        return;
    }

    const typeLabels = { course: 'Activity', registration: 'Student', hall_reservation: 'Hall Reservation' };
    tbody.innerHTML = data.map(row => `
        <tr>
            <td>${new Date(row.deleted_at).toLocaleString()}</td>
            <td>${row.admin_username}</td>
            <td>${typeLabels[row.entity_type] || row.entity_type}</td>
            <td>${row.entity_label}</td>
            <td>${row.reason}</td>
        </tr>
    `).join('');
}

loadLog();
