import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function pad2(n) { return String(n).padStart(2, '0'); }
function formatTime12(t) {
    const [h, m] = t.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${pad2(m)} ${period}`;
}
function currentAdminName() {
    try {
        const raw = localStorage.getItem('ibra_admin_session');
        const session = raw ? JSON.parse(raw) : null;
        return (session && (session.fullName || session.username)) || 'Admin';
    } catch {
        return 'Admin';
    }
}

// Points at the public request page in this same project — adjust here if
// this page is ever moved.
document.getElementById('requestLinkInput').value =
    window.location.origin + window.location.pathname.replace('admin/department-hall-requests.html', 'department-hall-request.html');

document.getElementById('copyLinkBtn').addEventListener('click', async () => {
    try {
        await navigator.clipboard.writeText(document.getElementById('requestLinkInput').value);
        alert('Link copied!');
    } catch {
        alert('Could not copy automatically — please select and copy the link manually.');
    }
});

async function loadRequests() {
    const box = document.getElementById('requestsList');
    const { data, error } = await client
        .from('hall_requests')
        .select('*')
        .eq('status', 'pending')
        .order('requested_at', { ascending: true });

    if (error) {
        box.innerHTML = `<p style="color:#dc2626; font-size:13px;">Couldn't load requests: ${error.message}</p>`;
        return;
    }
    if (!data || data.length === 0) {
        box.innerHTML = '<p class="hall-day-detail-placeholder">No pending requests right now.</p>';
        return;
    }

    // Group multi-day requests together (same booking_group_id) so they
    // show and get approved/declined as one request, not several.
    const groups = new Map();
    data.forEach(r => {
        const key = r.booking_group_id || `single_${r.id}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    });

    box.innerHTML = Array.from(groups.values()).map(rows => {
        const first = rows[0];
        const sortedRows = rows.slice().sort((a, b) => a.reservation_date.localeCompare(b.reservation_date));
        const dateLines = sortedRows.map(r =>
            `<span>${r.reservation_date}: ${formatTime12(r.start_time)} to ${formatTime12(r.end_time)}</span>`
        ).join('');
        return `
        <div class="hall-day-detail-item" style="border-left-color:#7C3AED;" data-group-key="${first.booking_group_id || ''}" data-ids="${rows.map(r => r.id).join(',')}">
            <strong>${first.hall}${rows.length > 1 ? ` — ${rows.length} dates` : ''}</strong>
            <span>${first.course_name}${first.reservation_type ? ` (${first.reservation_type})` : ''}</span>
            ${dateLines}
            <span>Organizer: ${first.organizer_name}</span>
            <span>Phone: ${first.phone_number}</span>
            ${first.participant_count ? `<span>Participants: ${first.participant_count}</span>` : ''}
            <div class="hall-day-detail-actions">
                <button type="button" class="hall-detail-edit-btn" data-action="approve">Approve</button>
                <button type="button" class="hall-detail-delete-btn" data-action="decline">Decline</button>
            </div>
        </div>`;
    }).join('');

    box.querySelectorAll('[data-action="approve"]').forEach(btn => {
        btn.addEventListener('click', () => approveGroup(btn.closest('[data-ids]')));
    });
    box.querySelectorAll('[data-action="decline"]').forEach(btn => {
        btn.addEventListener('click', () => declineGroup(btn.closest('[data-ids]')));
    });
}

async function approveGroup(el) {
    const ids = el.dataset.ids.split(',').map(Number);
    if (!(await confirmCard('Approve this request? It will become a confirmed booking.'))) return;

    const { data: rows, error: fetchErr } = await client.from('hall_requests').select('*').in('id', ids);
    if (fetchErr) { alert('Could not load the request: ' + fetchErr.message); return; }

    const writer_name = currentAdminName();
    const insertRows = rows.map(r => ({
        hall: r.hall, course_name: r.course_name, reservation_type: r.reservation_type,
        writer_name, organizer_name: r.organizer_name, phone_number: r.phone_number,
        participant_count: r.participant_count, reservation_date: r.reservation_date,
        start_time: r.start_time, end_time: r.end_time, booking_group_id: r.booking_group_id
    }));

    const { error: insertErr } = await client.from('hall_reservations').insert(insertRows);
    if (insertErr) {
        if (insertErr.code === '23P01') {
            alert('Could not approve — this slot has already been booked or approved elsewhere. Please decline or ask the department to pick a different time.');
        } else {
            alert('Could not approve: ' + insertErr.message);
        }
        return;
    }

    const { error: updErr } = await client.from('hall_requests')
        .update({ status: 'approved', reviewed_by: writer_name, reviewed_at: new Date().toISOString() })
        .in('id', ids);
    if (updErr) console.error('Approved the booking but failed to update the request status:', updErr.message);

    alert('Request approved!');
    loadRequests();
}

async function declineGroup(el) {
    const ids = el.dataset.ids.split(',').map(Number);
    const result = await formCard('Decline Request', [
        { name: 'reason', label: 'Reason for declining', placeholder: 'e.g. Hall already committed for maintenance that week' }
    ], { okLabel: 'Decline' });
    if (!result) return;
    if (!result.reason) { alert('Please enter a reason.'); return; }
    if (!(await confirmCard('Decline this request?'))) return;

    const { error } = await client.from('hall_requests')
        .update({ status: 'declined', decline_reason: result.reason, reviewed_by: currentAdminName(), reviewed_at: new Date().toISOString() })
        .in('id', ids);
    if (error) { alert('Could not decline: ' + error.message); return; }

    alert('Request declined.');
    loadRequests();
}

loadRequests();
