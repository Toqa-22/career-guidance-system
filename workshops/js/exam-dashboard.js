import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PAGE_SIZE = 10;
let allExams = [];
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

// Preview-only — no staff/mode params means exam.html renders the read-only
// preview (see js/exam-public.js). Solve-mode links are never generated
// here; they only ever come from the registration gate (js/workshops.js).
function buildPreviewLink(slug) {
    const url = new URL('../exam.html', window.location.href);
    url.searchParams.set('slug', slug);
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

// Same shared row-of-page-buttons builder used across the admin (dashboard.js,
// students.js, evaluations-dashboard.js).
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

async function loadExams() {
    const tbody = document.getElementById('examsTableBody');

    const [{ data: exams, error: examErr }, { data: questions }, { data: attempts }] = await Promise.all([
        client.from('activity_exams').select('*, courses(name)').order('created_at', { ascending: false }),
        client.from('activity_exam_questions').select('exam_id'),
        client.from('activity_exam_attempts').select('exam_id, status')
    ]);
    // "Responses" (below) counts every attempt ever started (in_progress or
    // submitted) — "Scores"/submittedCount only counts the ones actually
    // finished, since only those have a real score to view.

    if (examErr) {
        tbody.innerHTML = `<tr><td colspan="8" style="color:#dc2626; text-align:center; padding:20px;">Error loading exams: ${examErr.message}</td></tr>`;
        return;
    }

    const questionCountByExam = new Map();
    (questions || []).forEach(q => questionCountByExam.set(q.exam_id, (questionCountByExam.get(q.exam_id) || 0) + 1));
    const submittedCountByExam = new Map();
    const responseCountByExam = new Map();
    (attempts || []).forEach(a => {
        responseCountByExam.set(a.exam_id, (responseCountByExam.get(a.exam_id) || 0) + 1);
        if (a.status === 'submitted') submittedCountByExam.set(a.exam_id, (submittedCountByExam.get(a.exam_id) || 0) + 1);
    });

    allExams = (exams || []).map(ex => ({
        ...ex,
        questionCount: questionCountByExam.get(ex.id) || 0,
        submittedCount: submittedCountByExam.get(ex.id) || 0,
        responseCount: responseCountByExam.get(ex.id) || 0
    }));

    if (currentPage > Math.ceil(allExams.length / PAGE_SIZE)) currentPage = 1;
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('examsTableBody');

    if (allExams.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#64748b; padding:20px;">No exams created yet.</td></tr>`;
        document.getElementById('examsPagination').innerHTML = '';
        return;
    }

    renderPagination('examsPagination', allExams.length, currentPage, (page) => {
        currentPage = page;
        renderTable();
        tbody.closest('table').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRows = allExams.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = pageRows.map(ex => {
        const activityName = ex.courses?.name || '<span style="color:#94a3b8;">Deleted Activity</span>';
        const titleClean = escapeHtml(ex.title).replace(/"/g, '&quot;');
        const link = ex.public_slug ? buildPreviewLink(ex.public_slug) : null;
        const linkCell = link
            ? `<a class="btn-tbl-edit" href="${link}" target="_blank" rel="noopener">Open</a>`
            : '<span style="color:#94a3b8; font-size:12px;">Not published</span>';

        return `
            <tr>
                <td>
                    <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${ex.theme_color || '#7C3AED'}; margin-right:6px;"></span>
                    <b>${escapeHtml(ex.title)}</b>
                </td>
                <td>${activityName}</td>
                <td>${ex.comment ? escapeHtml(ex.comment) : '<span style="color:#94a3b8;">—</span>'}</td>
                <td>${ex.questionCount}</td>
                <td>${ex.responseCount}</td>
                <td>
                    <a class="btn-tbl-view" href="exam-participants.html?exam_id=${ex.id}">View Scores</a>
                    ${ex.submittedCount > 0 ? `<span style="display:block; font-size:11px; color:#94a3b8; margin-top:4px;">${ex.submittedCount} submitted</span>` : ''}
                </td>
                <td>${linkCell}</td>
                <td class="action-cell">
                    <a class="btn-tbl-edit" href="create-exam.html?edit_id=${ex.id}">Edit</a>
                    <a class="btn-tbl-edit" style="background:var(--dynamic-light1, #F5F3FF); border-color:var(--dynamic-light3, #DDD6FE); color:var(--dynamic-primary, #7C3AED);" href="create-exam.html?duplicate_id=${ex.id}">Duplicate</a>
                    <a class="btn-tbl-edit" style="background:#eff6ff; border-color:#bfdbfe; color:#2563eb;" href="exam-participants.html?exam_id=${ex.id}">Report</a>
                    <button class="btn-tbl-delete" data-id="${ex.id}" data-title="${titleClean}" data-activity="${escapeHtml(ex.courses?.name || 'Deleted Activity').replace(/"/g, '&quot;')}">Delete</button>
                </td>
            </tr>
        `;
    }).join('');

    document.querySelectorAll('.btn-tbl-delete').forEach(btn => {
        btn.addEventListener('click', () => deleteExam(
            btn.getAttribute('data-id'),
            btn.getAttribute('data-title'),
            btn.getAttribute('data-activity')
        ));
    });
}

// ============================================================================
// Delete — same two-step "reason required, then confirm" pattern as deleting
// an Evaluation (js/evaluations-dashboard.js). Cascades away every attempt
// and answer ever recorded for this exam, so the warning says so plainly.
// ============================================================================
async function deleteExam(id, title, activityName) {
    try {
        if (typeof formCard !== 'function' || typeof confirmCard !== 'function') {
            alert('This page needs a fresh copy of a required file — please hard-refresh (Ctrl+Shift+R) and try again.');
            return;
        }

        const result = await formCard('Delete Exam', [
            { name: 'reason', label: `Why are you deleting "${title}"?`, placeholder: 'Reason for deletion' }
        ], { okLabel: 'Continue' });
        if (!result) return;
        if (!result.reason) { alert('Please enter a reason.'); return; }
        if (!(await confirmCard(`Are you absolutely sure you want to delete "${title}"? This permanently deletes every attempt and answer already recorded for it, and cannot be undone.`))) return;

        const { error: delErr } = await client.from('activity_exams').delete().eq('id', id);
        if (delErr) {
            alert('Delete failed: ' + delErr.message);
            return;
        }

        await client.from('deletion_audit_log').insert({
            admin_username: currentAdminName(),
            entity_type: 'exam',
            entity_label: `${title} — ${activityName}`,
            reason: result.reason
        });

        alert('Exam deleted.');
        loadExams();
    } catch (err) {
        alert('Something went wrong: ' + err.message);
    }
}

// ============================================================================
// Export All Submitted Answers (Excel) — long format (one row per question
// per submitted attempt), same idea as evaluations-dashboard.js's report,
// with the exam-specific Score/Max Score/Correct? columns added.
// ============================================================================
async function buildAndDownloadReport() {
    const btn = document.getElementById('exportAllAnswersBtn');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Building…';

    try {
        const [{ data: exams }, { data: attempts }, { data: questions }] = await Promise.all([
            client.from('activity_exams').select('id, title, courses(name)'),
            client.from('activity_exam_attempts').select('id, exam_id, staff_number, staff_name, total_score, max_score, submitted_at').eq('status', 'submitted'),
            client.from('activity_exam_questions').select('id, exam_id, question_text, display_order')
        ]);

        const examById = new Map((exams || []).map(e => [e.id, e]));
        const questionById = new Map((questions || []).map(q => [q.id, q]));
        const attemptById = new Map((attempts || []).map(a => [a.id, a]));
        const attemptIds = (attempts || []).map(a => a.id);

        const { data: answers } = attemptIds.length > 0
            ? await client.from('activity_exam_answers').select('attempt_id, question_id, answer_value, is_correct').in('attempt_id', attemptIds)
            : { data: [] };

        function formatAnswer(value) {
            if (Array.isArray(value)) return value.join(', ');
            if (value && typeof value === 'object') {
                return Object.entries(value).map(([row, ans]) => `${row}: ${Array.isArray(ans) ? ans.join(', ') : ans}`).join(' | ');
            }
            return value || '';
        }

        const rows = (answers || [])
            .map(a => {
                const attempt = attemptById.get(a.attempt_id);
                const question = questionById.get(a.question_id);
                if (!attempt || !question) return null;
                const exam = examById.get(attempt.exam_id);
                return [
                    exam ? exam.title : 'Deleted Exam',
                    exam && exam.courses ? exam.courses.name : 'Deleted Activity',
                    attempt.staff_number || '',
                    attempt.staff_name || '',
                    attempt.total_score ?? '',
                    attempt.max_score ?? '',
                    attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString() : '',
                    question.question_text || '',
                    formatAnswer(a.answer_value),
                    a.is_correct === null ? 'Not graded' : (a.is_correct ? 'Yes' : 'No')
                ];
            })
            .filter(Boolean)
            .sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]) || a[6].localeCompare(b[6]));

        if (rows.length === 0) {
            alert('No submitted answers yet.');
            return;
        }

        const headers = ['Exam', 'Activity', 'Staff Number', 'Staff Name', 'Score', 'Max Score', 'Submitted At', 'Question', 'Answer', 'Correct?'];
        window.exportStyledExcel(headers, rows, 'exam-responses', 'Responses', [2]);
    } catch (err) {
        alert('Could not build the report: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

document.getElementById('exportAllAnswersBtn').addEventListener('click', buildAndDownloadReport);

loadExams();
