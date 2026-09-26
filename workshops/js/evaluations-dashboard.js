import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PAGE_SIZE = 10;
let allEvaluations = [];
let currentPage = 1;

function currentAdminName() {
    try {
        const raw = sessionStorage.getItem('ibra_admin_session');
        const session = raw ? JSON.parse(raw) : null;
        return (session && (session.fullName || session.username)) || 'Unknown admin';
    } catch {
        return 'Unknown admin';
    }
}

function buildPublicLink(slug) {
    const url = new URL('../evaluation.html', window.location.href);
    url.searchParams.set('e', slug);
    return url.toString();
}

function formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}/${month}/${d.getFullYear()}`;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Same shared row-of-page-buttons builder used by Activity Dashboard /
// Participant Registrations (dashboard.js / students.js).
function renderPagination(containerId, totalItems, page, onChange) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
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
            if (p >= 1 && p <= totalPages) onChange(p);
        });
    });
}

async function loadEvaluations() {
    const tbody = document.getElementById('evaluationsTableBody');

    const [{ data: evaluations, error: evalErr }, { data: questions }, { data: responses }] = await Promise.all([
        client.from('activity_evaluations').select('*, courses(name)').order('created_at', { ascending: false }),
        client.from('activity_evaluation_questions').select('evaluation_id'),
        client.from('activity_evaluation_responses').select('evaluation_id')
    ]);

    if (evalErr) {
        tbody.innerHTML = `<tr><td colspan="8" style="color:#dc2626; text-align:center; padding:20px;">Error loading evaluations: ${evalErr.message}</td></tr>`;
        return;
    }

    const questionCountByEval = new Map();
    (questions || []).forEach(q => questionCountByEval.set(q.evaluation_id, (questionCountByEval.get(q.evaluation_id) || 0) + 1));
    const responseCountByEval = new Map();
    (responses || []).forEach(r => responseCountByEval.set(r.evaluation_id, (responseCountByEval.get(r.evaluation_id) || 0) + 1));

    allEvaluations = (evaluations || []).map(ev => ({
        ...ev,
        questionCount: questionCountByEval.get(ev.id) || 0,
        responseCount: responseCountByEval.get(ev.id) || 0
    }));

    if (currentPage > Math.ceil(allEvaluations.length / PAGE_SIZE)) currentPage = 1;
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('evaluationsTableBody');

    if (allEvaluations.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#64748b; padding:20px;">No evaluations or exams created yet.</td></tr>`;
        document.getElementById('evaluationsPagination').innerHTML = '';
        return;
    }

    renderPagination('evaluationsPagination', allEvaluations.length, currentPage, (page) => {
        currentPage = page;
        renderTable();
        tbody.closest('table').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRows = allEvaluations.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = pageRows.map(ev => {
        const activityName = ev.courses?.name || '<span style="color:#94a3b8;">Deleted Activity</span>';
        const link = ev.public_slug ? buildPublicLink(ev.public_slug) : null;
        // Opens in PREVIEW mode (see previewMode in js/evaluation-public.js)
        // — shows the form exactly as a participant would see it, with no
        // staff number gate and nothing ever submitted, purely so an admin
        // can check how it looks.
        const previewLink = link ? `${link}&preview=1` : null;
        const linkCell = previewLink
            ? `<a href="${previewLink}" target="_blank" class="btn-tbl-view">Open</a>`
            : '<span style="color:#94a3b8; font-size:12px;">Not published</span>';

        return `
            <tr>
                <td>
                    <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${ev.theme_color || '#7C3AED'}; margin-right:6px;"></span>
                    <b>${escapeHtml(ev.title)}</b>
                </td>
                <td>${activityName}</td>
                <td style="max-width:220px; white-space:pre-wrap;">${ev.comment ? escapeHtml(ev.comment) : '<span style="color:#94a3b8; font-size:12px;">—</span>'}</td>
                <td>${ev.questionCount}</td>
                <td>${ev.responseCount}</td>
                <td>${formatDate(ev.created_at)}</td>
                <td>${linkCell}</td>
                <td class="action-cell">
                    <a class="btn-tbl-edit" href="create-evaluation.html?edit_id=${ev.id}">Edit</a>
                    <a class="btn-tbl-edit" href="create-evaluation.html?duplicate_id=${ev.id}">Duplicate</a>
                    <button class="btn-tbl-edit btn-row-report" data-report-id="${ev.id}" data-report-title="${escapeHtml(ev.title).replace(/"/g, '&quot;')}">Report</button>
                    <button class="btn-tbl-delete" data-id="${ev.id}" data-title="${escapeHtml(ev.title).replace(/"/g, '&quot;')}">Delete</button>
                </td>
            </tr>
        `;
    }).join('');

    document.querySelectorAll('.btn-tbl-delete').forEach(btn => {
        btn.addEventListener('click', () => deleteEvaluation(btn.getAttribute('data-id'), btn.getAttribute('data-title')));
    });

    document.querySelectorAll('.btn-row-report').forEach(btn => {
        btn.addEventListener('click', () => buildAndDownloadReport(Number(btn.getAttribute('data-report-id')), btn.getAttribute('data-report-title'), btn));
    });
}

// Same "reason required, shown to administration" pattern used for
// deleting an Activity (dashboard.js's deleteTargetCourseTrack) — writes
// to the same shared deletion_audit_log table the hub-wide Deletion Log
// page already reads from.
async function deleteEvaluation(id, title) {
    try {
        if (typeof formCard !== 'function' || typeof confirmCard !== 'function') {
            alert('This page needs a fresh copy of a required file — please hard-refresh (Ctrl+Shift+R) and try again.');
            return;
        }

        const result = await formCard('Delete Evaluation', [
            { name: 'reason', label: `Why are you deleting "${title}"?`, placeholder: 'Reason for deletion' }
        ], { okLabel: 'Continue' });
        if (!result) return;
        if (!result.reason) { alert('Please enter a reason.'); return; }
        if (!(await confirmCard(`Are you absolutely sure you want to delete "${title}"? This also removes every response already submitted to it, and cannot be undone.`))) return;

        const { error: delErr } = await client.from('activity_evaluations').delete().eq('id', id);
        if (delErr) {
            alert('Delete failed: ' + delErr.message);
            return;
        }

        await client.from('deletion_audit_log').insert({
            admin_username: currentAdminName(),
            entity_type: 'evaluation',
            entity_label: title,
            reason: result.reason
        });

        alert('Evaluation deleted.');
        loadEvaluations();
    } catch (err) {
        alert('Something went wrong: ' + err.message);
    }
}

// ============================================================================
// Report (Excel) — every submitted answer. Long format (one row per
// question per response) so nothing needs collapsing — "print all the
// info", not a summary of it. Shared by the top "Report (Excel)" button
// (every evaluation) and each row's own "Report" button (evaluationId set,
// scoped to just that one).
// ============================================================================
async function buildAndDownloadReport(evaluationId, evaluationTitle, triggerBtn) {
    const btn = triggerBtn;
    const originalText = btn ? btn.textContent : null;
    if (btn) { btn.disabled = true; btn.textContent = 'Building…'; }

    try {
        let evalQuery = client.from('activity_evaluations').select('id, title, courses(name)');
        let responseQuery = client.from('activity_evaluation_responses').select('id, evaluation_id, staff_number, staff_name, submitted_at');
        let questionQuery = client.from('activity_evaluation_questions').select('id, evaluation_id, question_text, display_order');
        if (evaluationId) {
            evalQuery = evalQuery.eq('id', evaluationId);
            responseQuery = responseQuery.eq('evaluation_id', evaluationId);
            questionQuery = questionQuery.eq('evaluation_id', evaluationId);
        }

        const [{ data: evaluations }, { data: questions }, { data: responses }] = await Promise.all([evalQuery, questionQuery, responseQuery]);

        const evalById = new Map((evaluations || []).map(e => [e.id, e]));
        const questionById = new Map((questions || []).map(q => [q.id, q]));
        const responseById = new Map((responses || []).map(r => [r.id, r]));
        const responseIds = (responses || []).map(r => r.id);

        const { data: answers } = responseIds.length > 0
            ? await client.from('activity_evaluation_answers').select('response_id, question_id, answer_value').in('response_id', responseIds)
            : { data: [] };

        // Same value-shape handling already used for course_questions
        // answers on the Participant Registrations page (students.js'
        // formatResponseValue) — a plain string for Text/Date/Time/List/
        // Multiple Choice, an array for Checkbox, or a row->answer map for
        // the two grid types.
        function formatAnswer(value) {
            if (Array.isArray(value)) return value.join(', ');
            if (value && typeof value === 'object') {
                return Object.entries(value).map(([row, ans]) => `${row}: ${Array.isArray(ans) ? ans.join(', ') : ans}`).join(' | ');
            }
            return value || '';
        }

        const rows = (answers || [])
            .map(a => {
                const response = responseById.get(a.response_id);
                const question = questionById.get(a.question_id);
                if (!response || !question) return null;
                const evaluation = evalById.get(response.evaluation_id);
                return [
                    evaluation ? evaluation.title : 'Deleted Evaluation',
                    evaluation && evaluation.courses ? evaluation.courses.name : 'Deleted Activity',
                    response.staff_number || '',
                    response.staff_name || '',
                    response.submitted_at ? new Date(response.submitted_at).toLocaleString() : '',
                    question.question_text || '',
                    formatAnswer(a.answer_value)
                ];
            })
            .filter(Boolean)
            // Group by evaluation, then response, then question order — reads
            // like a proper results sheet rather than insertion order.
            .sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]) || a[4].localeCompare(b[4]));

        if (rows.length === 0) {
            alert(evaluationId ? `No submitted answers yet for "${evaluationTitle}".` : 'No submitted answers yet.');
            return;
        }

        const headers = ['Evaluation / Exam', 'Activity', 'Staff Number', 'Staff Name', 'Submitted At', 'Question', 'Answer'];
        const filenameBase = evaluationId
            ? `evaluation-responses-${(evaluationTitle || 'evaluation').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`
            : 'evaluation-responses';
        window.exportStyledExcel(headers, rows, filenameBase, 'Responses', [2]);
    } catch (err) {
        alert('Could not build the report: ' + err.message);
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = originalText; }
    }
}

document.getElementById('exportAllResponsesBtn').addEventListener('click', (e) => buildAndDownloadReport(null, null, e.currentTarget));

loadEvaluations();
