import { requireSession, client } from '../js/admin-shared.js';

requireSession();

const PAGE_SIZE = 10;
let allRows = [];
let currentPage = 1;

async function loadLog() {
    const tbody = document.getElementById('registrationLogBody');
    const { data, error } = await client
        .from('registration_events_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

    if (error) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="5">Couldn't load the log: ${error.message}</td></tr>`;
        return;
    }

    allRows = data || [];
    renderTable();
}

const typeLabels = {
    new_participant: 'New Participant',
    existing_participant_enrolled: 'Enrolled in Activity',
    participant_info_updated: 'Info Updated',
    duplicate_registration_attempt: 'Duplicate Attempt'
};

function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderTable() {
    const tbody = document.getElementById('registrationLogBody');
    const paginationBox = document.getElementById('registrationLogPagination');

    if (allRows.length === 0) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="5">No registration events yet.</td></tr>`;
        paginationBox.innerHTML = '';
        return;
    }

    const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const pageRows = allRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    tbody.innerHTML = pageRows.map(row => `
        <tr>
            <td>${new Date(row.created_at).toLocaleString()}</td>
            <td>${typeLabels[row.event_type] || row.event_type}</td>
            <td>${escapeHtml(row.staff_name)} (${escapeHtml(row.staff_number)})</td>
            <td>${escapeHtml(row.course_name)}</td>
            <td>${escapeHtml(row.details)}</td>
        </tr>
    `).join('');

    renderPagination(currentPage, totalPages);
}

function renderPagination(page, totalPages) {
    const container = document.getElementById('registrationLogPagination');
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = `<button type="button" class="pg-btn" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>‹ Prev</button>`;
    for (let p = 1; p <= totalPages; p++) {
        html += `<button type="button" class="pg-btn${p === page ? ' active' : ''}" data-page="${p}">${p}</button>`;
    }
    html += `<button type="button" class="pg-btn" data-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}>Next ›</button>`;
    container.innerHTML = html;

    container.querySelectorAll('[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = Number(btn.dataset.page);
            if (p >= 1 && p <= totalPages) {
                currentPage = p;
                renderTable();
            }
        });
    });
}

loadLog();
