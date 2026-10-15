import { requireSession, client } from '../js/admin-shared.js';

const session = requireSession();

const PAGE_SIZE = 10;
let allRows = [];
let currentPage = 1;

async function loadLogins() {
    const tbody = document.getElementById('loginsTableBody');
    const { data, error } = await client.rpc('admin_list_logins', { p_session_token: session.sessionToken, p_limit: 500 });

    if (error) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="3">Couldn't load login history: ${error.message}</td></tr>`;
        return;
    }

    allRows = data || [];
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('loginsTableBody');
    const paginationBox = document.getElementById('loginsPagination');

    if (allRows.length === 0) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="3">No sign-ins recorded yet.</td></tr>`;
        paginationBox.innerHTML = '';
        return;
    }

    const totalPages = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    const pageRows = allRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

    tbody.innerHTML = pageRows.map(row => `
        <tr>
            <td>${row.username}</td>
            <td>${row.full_name || '—'}</td>
            <td>${new Date(row.logged_in_at).toLocaleString()}</td>
        </tr>
    `).join('');

    renderPagination(currentPage, totalPages);
}

function renderPagination(page, totalPages) {
    const container = document.getElementById('loginsPagination');
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

loadLogins();
