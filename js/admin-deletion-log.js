import { requireSession, client } from '../js/admin-shared.js';

requireSession();

const PAGE_SIZE = 10;
let allRows = [];
let currentPage = 1;

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

    allRows = data || [];
    renderTable();
}

const typeLabels = { course: 'Activity', registration: 'Student', hall_reservation: 'Hall Reservation' };

function renderTable() {
    const tbody = document.getElementById('deletionLogBody');
    const paginationBox = document.getElementById('deletionLogPagination');

    if (allRows.length === 0) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="5">Nothing has been deleted yet.</td></tr>`;
        paginationBox.innerHTML = '';
        return;
    }

    const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const pageRows = allRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    tbody.innerHTML = pageRows.map(row => `
        <tr>
            <td>${new Date(row.deleted_at).toLocaleString()}</td>
            <td>${row.admin_username}</td>
            <td>${typeLabels[row.entity_type] || row.entity_type}</td>
            <td>${row.entity_label}</td>
            <td>${row.reason}</td>
        </tr>
    `).join('');

    renderPagination(currentPage, totalPages);
}

function renderPagination(page, totalPages) {
    const container = document.getElementById('deletionLogPagination');
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
