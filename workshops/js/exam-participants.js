import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const params = new URLSearchParams(window.location.search);
const examId = Number(params.get('exam_id'));

const PAGE_SIZE = 10;
let allAttempts = [];   // every attempt, with a computed `effectiveStatus`
let visibleAttempts = []; // after the Minimum Mark filter
let currentPage = 1;
let examInfo = null;

function currentAdminName() {
    try {
        const raw = sessionStorage.getItem('ibra_admin_session');
        const session = raw ? JSON.parse(raw) : null;
        return (session && (session.fullName || session.username)) || 'Unknown admin';
    } catch {
        return 'Unknown admin';
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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

// "Expired" is computed client-side, never stored: an in_progress attempt
// whose expires_at has already passed but hasn't been graded/flipped to
// 'submitted' yet (e.g. the participant never reopened the page for the
// countdown's own auto-submit, or the gate-check best-effort path in
// js/exam-public.js hasn't run for it yet).
function computeEffectiveStatus(attempt) {
    if (attempt.status === 'submitted') return 'Submitted';
    if (new Date(attempt.expires_at).getTime() < Date.now()) return 'Expired';
    return 'In Progress';
}

async function loadParticipants() {
    const tbody = document.getElementById('examParticipantsTableBody');

    if (!examId) {
        tbody.innerHTML = `<tr><td colspan="8" style="color:#dc2626; text-align:center; padding:20px;">No exam specified.</td></tr>`;
        return;
    }

    const [{ data: exam }, { data: attempts, error }] = await Promise.all([
        client.from('activity_exams').select('*, courses(name)').eq('id', examId).maybeSingle(),
        client.from('activity_exam_attempts').select('*').eq('exam_id', examId).order('created_at', { ascending: false })
    ]);

    examInfo = exam;
    document.getElementById('examParticipantsTitle').textContent = exam ? `Exam Scores — ${exam.title}` : 'Exam Scores';

    if (error) {
        tbody.innerHTML = `<tr><td colspan="8" style="color:#dc2626; text-align:center; padding:20px;">Error loading participants: ${error.message}</td></tr>`;
        return;
    }

    allAttempts = (attempts || []).map(a => ({ ...a, effectiveStatus: computeEffectiveStatus(a) }));
    applyFilter();
}

function applyFilter() {
    const raw = document.getElementById('minMarkInput').value;
    const minMark = raw !== '' ? Number(raw) : null;
    visibleAttempts = (minMark == null || !Number.isFinite(minMark))
        ? allAttempts
        : allAttempts.filter(a => Number(a.total_score) >= minMark);

    if (currentPage > Math.ceil(visibleAttempts.length / PAGE_SIZE)) currentPage = 1;
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('examParticipantsTableBody');

    if (visibleAttempts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#64748b; padding:20px;">No attempts recorded yet.</td></tr>`;
        document.getElementById('examParticipantsPagination').innerHTML = '';
        return;
    }

    renderPagination('examParticipantsPagination', visibleAttempts.length, currentPage, (page) => {
        currentPage = page;
        renderTable();
        tbody.closest('table').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRows = visibleAttempts.slice(start, start + PAGE_SIZE);

    tbody.innerHTML = pageRows.map(a => {
        const pct = (a.max_score != null && Number(a.max_score) > 0 && a.total_score != null)
            ? `${((Number(a.total_score) / Number(a.max_score)) * 100).toFixed(1)}%`
            : '—';
        const statusColors = {
            'Submitted': '#166534;background:#F0FDF4;border-color:#BBF7D0;',
            'In Progress': '#92400E;background:#FEF3C7;border-color:#FDE68A;',
            'Expired': '#991B1B;background:#FEE2E2;border-color:#FCA5A5;'
        };
        const statusStyle = statusColors[a.effectiveStatus] || '';
        const canRetake = a.effectiveStatus === 'Submitted' || a.effectiveStatus === 'Expired';
        const retakeCell = canRetake
            ? `<button type="button" class="btn-tbl-delete" data-retake-id="${a.id}" data-staff="${escapeHtml(a.staff_number).replace(/"/g, '&quot;')}" data-name="${escapeHtml(a.staff_name || '').replace(/"/g, '&quot;')}">Allow Retake</button>`
            : '<span style="color:#94a3b8; font-size:12px;">—</span>';
        const correctCell = a.effectiveStatus === 'Submitted'
            ? `<button type="button" class="btn-tbl-edit" data-correct-id="${a.id}" data-staff="${escapeHtml(a.staff_number).replace(/"/g, '&quot;')}" data-name="${escapeHtml(a.staff_name || '').replace(/"/g, '&quot;')}">Correct</button>`
            : '';
        // Available on every row regardless of status (unlike Allow Retake,
        // which only makes sense once there's something to retake) — this is
        // a plain "remove this participant's record entirely" action, for
        // when a row was created by mistake or needs to be cleaned up.
        const deleteCell = `<button type="button" class="btn-tbl-delete" data-delete-id="${a.id}" data-staff="${escapeHtml(a.staff_number).replace(/"/g, '&quot;')}" data-name="${escapeHtml(a.staff_name || '').replace(/"/g, '&quot;')}">Delete</button>`;

        return `
            <tr>
                <td><b>${escapeHtml(a.staff_number)}</b></td>
                <td>${escapeHtml(a.staff_name || '—')}</td>
                <td>${a.total_score ?? '—'}</td>
                <td>${a.max_score ?? '—'}</td>
                <td>${pct}</td>
                <td><span style="display:inline-block; padding:3px 10px; border-radius:999px; border:1px solid; font-weight:700; font-size:11.5px; ${statusStyle}">${a.effectiveStatus}</span></td>
                <td>${a.submitted_at ? new Date(a.submitted_at).toLocaleString() : '—'}</td>
                <td class="action-cell">${correctCell}${retakeCell}${deleteCell}</td>
            </tr>
        `;
    }).join('');

    document.querySelectorAll('[data-retake-id]').forEach(btn => {
        btn.addEventListener('click', () => allowRetake(
            btn.getAttribute('data-retake-id'),
            btn.getAttribute('data-staff'),
            btn.getAttribute('data-name')
        ));
    });

    document.querySelectorAll('[data-delete-id]').forEach(btn => {
        btn.addEventListener('click', () => deleteParticipant(
            btn.getAttribute('data-delete-id'),
            btn.getAttribute('data-staff'),
            btn.getAttribute('data-name')
        ));
    });

    document.querySelectorAll('[data-correct-id]').forEach(btn => {
        btn.addEventListener('click', () => openCorrectionPanel(
            btn.getAttribute('data-correct-id'),
            btn.getAttribute('data-staff'),
            btn.getAttribute('data-name')
        ));
    });
}

// ============================================================================
// Delete — removes one participant's attempt (and its answers) from this
// exam entirely, with a required reason, same two-step reason-then-confirm
// pattern as everywhere else destructive in this codebase. Unlike Allow
// Retake, this is offered on every row regardless of status — it's for
// cleaning up a mistaken/unwanted record, not specifically for letting the
// staff number try again (though as a side effect, it does also free that
// staff number to attempt the exam again, since the same unique-index rule
// applies either way). Who deleted it and why is logged to the Deletion Log
// page, same as every other delete in this app.
// ============================================================================
async function deleteParticipant(attemptId, staffNumber, staffName) {
    try {
        if (typeof formCard !== 'function' || typeof confirmCard !== 'function') {
            alert('This page needs a fresh copy of a required file — please hard-refresh (Ctrl+Shift+R) and try again.');
            return;
        }

        const who = staffName ? `${staffName} (${staffNumber})` : staffNumber;
        const result = await formCard('Delete Participant', [
            { name: 'reason', label: `Why are you deleting ${who}'s record for this exam?`, placeholder: 'Reason for deletion' }
        ], { okLabel: 'Continue' });
        if (!result) return;
        if (!result.reason) { alert('Please enter a reason.'); return; }
        if (!(await confirmCard(`This permanently deletes ${who}'s attempt and answers for this exam. This cannot be undone. Continue?`))) return;

        const { error: delErr } = await client.from('activity_exam_attempts').delete().eq('id', attemptId);
        if (delErr) {
            alert('Could not delete: ' + delErr.message);
            return;
        }

        await client.from('deletion_audit_log').insert({
            admin_username: currentAdminName(),
            entity_type: 'exam_attempt',
            entity_label: `${examInfo ? examInfo.title : 'Exam'} — ${who}`,
            reason: result.reason
        });

        alert('Participant deleted.');
        loadParticipants();
    } catch (err) {
        alert('Something went wrong: ' + err.message);
    }
}

// ============================================================================
// Correct — lets an admin open a submitted attempt's questions + the
// participant's own answers, flip any question's Correct/Incorrect call by
// hand (e.g. the auto-grader's exact-text match missed a valid answer), and
// Save recomputes that attempt's total_score from the corrected marks. Only
// offered on Submitted attempts, since that's the only state with a final
// score to correct. 0-point questions are never gradable (see create-exam.js
// "won't be graded" note) so they're shown for context only, with no toggle.
// Who made the correction is recorded in the Deletion Log page (reused here
// as the general admin-action log) so there's always a name attached.
// ============================================================================
function formatAnswerValue(value) {
    if (value === null || value === undefined || value === '') return '<span style="color:#94a3b8;">(no answer)</span>';
    if (Array.isArray(value)) return escapeHtml(value.join(', '));
    if (typeof value === 'object') {
        return escapeHtml(Object.entries(value).map(([row, ans]) => `${row}: ${Array.isArray(ans) ? ans.join(', ') : ans}`).join(' | '));
    }
    return escapeHtml(String(value));
}

async function openCorrectionPanel(attemptId, staffNumber, staffName) {
    const who = staffName ? `${staffName} (${staffNumber})` : staffNumber;

    const [{ data: questions, error: qErr }, { data: answers, error: aErr }] = await Promise.all([
        client.from('activity_exam_questions').select('*').eq('exam_id', examId).order('page_number', { ascending: true }).order('display_order', { ascending: true }),
        client.from('activity_exam_answers').select('*').eq('attempt_id', attemptId)
    ]);

    if (qErr || aErr) {
        alert('Could not load this attempt\'s answers: ' + (qErr || aErr).message);
        return;
    }

    const answerByQuestion = new Map((answers || []).map(a => [a.question_id, a]));
    const gradable = (questions || []).filter(q => Number(q.points) > 0 && answerByQuestion.has(q.id));

    if (gradable.length === 0) {
        alert('This exam has no gradable questions (every question is worth 0 points) — nothing to correct.');
        return;
    }

    // pending[questionId] = the (possibly flipped) is_correct value the admin
    // has chosen so far — seeded from what the auto-grader recorded.
    const pending = new Map(gradable.map(q => [q.id, answerByQuestion.get(q.id).is_correct]));

    const overlay = document.createElement('div');
    overlay.className = 'form-modal-overlay';
    overlay.innerHTML = `
        <div class="form-modal-card" style="max-width:640px; width:92vw; max-height:82vh; overflow-y:auto; text-align:left;">
            <div class="form-toast-title" style="margin-bottom:14px;">Review &amp; Correct Answers — ${escapeHtml(who)}</div>
            <div id="correctionQuestionList"></div>
            <div class="confirm-actions">
                <button type="button" class="confirm-btn confirm-cancel">Cancel</button>
                <button type="button" class="confirm-btn confirm-ok">Save</button>
            </div>
        </div>
    `;

    function renderQuestionList() {
        const list = overlay.querySelector('#correctionQuestionList');
        list.innerHTML = gradable.map((q, i) => {
            const ans = answerByQuestion.get(q.id);
            const isCorrect = pending.get(q.id);
            return `
                <div style="border:1px solid #E2E8F0; border-radius:10px; padding:12px 14px; margin-bottom:10px;">
                    <div style="font-weight:700; font-size:13.5px; margin-bottom:4px;">${i + 1}. ${escapeHtml(q.question_text)} <span style="font-weight:500; color:#64748b; font-size:12px;">(${q.points} pt${Number(q.points) === 1 ? '' : 's'})</span></div>
                    <div style="font-size:13px; color:#334155; margin-bottom:8px;">Answered: ${formatAnswerValue(ans.answer_value)}</div>
                    <div style="display:flex; gap:8px;">
                        <button type="button" class="btn-tbl-edit correction-mark-btn" data-qid="${q.id}" data-mark="true" style="${isCorrect === true ? 'background:#166534; border-color:#166534; color:#fff;' : ''}">✓ Correct</button>
                        <button type="button" class="btn-tbl-delete correction-mark-btn" data-qid="${q.id}" data-mark="false" style="${isCorrect === false ? 'background:#991B1B; border-color:#991B1B; color:#fff;' : ''}">✗ Incorrect</button>
                    </div>
                </div>
            `;
        }).join('');

        list.querySelectorAll('.correction-mark-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                pending.set(Number(btn.getAttribute('data-qid')), btn.getAttribute('data-mark') === 'true');
                renderQuestionList();
            });
        });
    }
    renderQuestionList();

    function close() {
        overlay.classList.add('form-modal-leaving');
        setTimeout(() => overlay.remove(), 180);
        document.removeEventListener('keydown', onKey);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.querySelector('.confirm-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey);

    overlay.querySelector('.confirm-ok').addEventListener('click', async () => {
        const changes = gradable.filter(q => pending.get(q.id) !== answerByQuestion.get(q.id).is_correct);
        if (changes.length === 0) {
            close();
            return;
        }

        const saveBtn = overlay.querySelector('.confirm-ok');
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving…';

        try {
            for (const q of changes) {
                const newCorrect = pending.get(q.id);
                const ans = answerByQuestion.get(q.id);
                const { error } = await client.from('activity_exam_answers')
                    .update({ is_correct: newCorrect, points_earned: newCorrect ? Number(q.points) : 0 })
                    .eq('id', ans.id);
                if (error) throw error;
                ans.is_correct = newCorrect;
                ans.points_earned = newCorrect ? Number(q.points) : 0;
            }

            const { data: allAnswersNow, error: sumErr } = await client
                .from('activity_exam_answers').select('points_earned').eq('attempt_id', attemptId);
            if (sumErr) throw sumErr;
            const newTotal = (allAnswersNow || []).reduce((sum, a) => sum + (Number(a.points_earned) || 0), 0);

            const { error: updErr } = await client.from('activity_exam_attempts')
                .update({ total_score: newTotal }).eq('id', attemptId);
            if (updErr) throw updErr;

            const summary = changes.map(q => {
                const label = q.question_text.length > 60 ? q.question_text.slice(0, 60) + '…' : q.question_text;
                return `"${label}" → ${pending.get(q.id) ? 'Correct' : 'Incorrect'}`;
            }).join('; ');

            await client.from('deletion_audit_log').insert({
                admin_username: currentAdminName(),
                entity_type: 'exam_answer_correction',
                entity_label: `${examInfo ? examInfo.title : 'Exam'} — ${who}`,
                reason: summary
            });

            close();
            alert('Score updated.');
            loadParticipants();
        } catch (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save';
            alert('Could not save the correction: ' + err.message);
        }
    });

    document.body.appendChild(overlay);
}

// ============================================================================
// Allow Retake — permanently deletes this staff number's attempt row
// (cascading away its answers), which is the ONLY way to free a staff
// number that's otherwise locked out forever by the one-attempt-ever unique
// index (see sql/activity-exams.sql). Same two-step reason-then-confirm
// pattern used everywhere else in this codebase for a destructive delete.
// ============================================================================
async function allowRetake(attemptId, staffNumber, staffName) {
    try {
        if (typeof formCard !== 'function' || typeof confirmCard !== 'function') {
            alert('This page needs a fresh copy of a required file — please hard-refresh (Ctrl+Shift+R) and try again.');
            return;
        }

        const who = staffName ? `${staffName} (${staffNumber})` : staffNumber;
        const result = await formCard('Allow Retake', [
            { name: 'reason', label: `Why are you allowing ${who} to retake this exam?`, placeholder: 'Reason for retake' }
        ], { okLabel: 'Continue' });
        if (!result) return;
        if (!result.reason) { alert('Please enter a reason.'); return; }
        if (!(await confirmCard(`This permanently deletes ${who}'s attempt and answers for this exam and lets them start a brand new attempt. This cannot be undone. Continue?`))) return;

        const { error: delErr } = await client.from('activity_exam_attempts').delete().eq('id', attemptId);
        if (delErr) {
            alert('Could not delete the attempt: ' + delErr.message);
            return;
        }

        await client.from('deletion_audit_log').insert({
            admin_username: currentAdminName(),
            entity_type: 'exam_attempt',
            entity_label: `${examInfo ? examInfo.title : 'Exam'} — ${who}`,
            reason: result.reason
        });

        alert('Retake allowed — that staff number can now start this exam again.');
        loadParticipants();
    } catch (err) {
        alert('Something went wrong: ' + err.message);
    }
}

// ============================================================================
// Export (Excel) — every participant recorded for this exam, regardless of
// the Minimum Mark filter or which page the table is currently showing —
// the filter/pagination are just for browsing on screen, not for scoping
// what gets exported.
// ============================================================================
function exportParticipants() {
    if (allAttempts.length === 0) {
        alert('No records found to export.');
        return;
    }
    const rows = allAttempts.map(a => {
        const pct = (a.max_score != null && Number(a.max_score) > 0 && a.total_score != null)
            ? `${((Number(a.total_score) / Number(a.max_score)) * 100).toFixed(1)}%`
            : '';
        return [
            a.staff_number || '',
            a.staff_name || '',
            a.total_score ?? '',
            a.max_score ?? '',
            pct,
            a.effectiveStatus || '',
            a.submitted_at ? new Date(a.submitted_at).toLocaleString() : ''
        ];
    });
    const headers = ['Staff Number', 'Staff Name', 'Score', 'Total Score', 'Percentage', 'Status', 'Submitted At'];
    const filenameBase = `exam-participants-${(examInfo?.title || 'exam').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}`;
    window.exportStyledExcel(headers, rows, filenameBase, 'Participants', [0]);
}

// Filters as you type — no separate Filter button to click.
document.getElementById('minMarkInput').addEventListener('input', applyFilter);
document.getElementById('exportParticipantsBtn').addEventListener('click', exportParticipants);

loadParticipants();
