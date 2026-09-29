import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let editingExamId = null;    // set when ?edit_id=... — updates that row in place
let duplicateSourceId = null; // set when ?duplicate_id=... — loads its questions/theme/comment/duration but leaves Title/Activity blank

function currentAdminName() {
    try {
        const raw = sessionStorage.getItem('ibra_admin_session');
        const session = raw ? JSON.parse(raw) : null;
        return (session && (session.fullName || session.username)) || 'Unknown admin';
    } catch {
        return 'Unknown admin';
    }
}

// ============================================================================
// Removing an already-saved question (one with a real `id`) while editing an
// exam is the one action here that can permanently destroy participant
// answers — pushExamQuestions()'s upsert keeps every kept question's answers
// intact (see js/create-evaluation.js's identical pushEvalQuestions for the
// full rationale), so removing one prompts for confirmation (and, if it
// already has real answers, a reason). Nothing is actually deleted from the
// DB at that click — only from examQuestions in memory — so this list of
// confirmed removals is logged to deletion_audit_log only once Save has
// actually persisted them (see handleFormSubmission).
// ============================================================================
let pendingQuestionRemovals = []; // [{ question_text, question_type, answerCount, reason }]

// ============================================================================
// Questions builder — same 8 types/shape/CSS classes as Create Evaluation
// (.custom-question-card, .cq-*), plus two exam-only fields per question:
// `points` (its score weight) and `correct_answer` (the auto-grading key —
// shape depends on question_type, see sql/activity-exams.sql's comment on
// activity_exam_questions.correct_answer for the exact per-type shape).
// ============================================================================
let examQuestions = []; // [{ id?, question_type, question_text, options, grid_rows, grid_columns, points, correct_answer, page_number }]
let examContents = [];  // [{ id?, title, content, page_number }]
let examPageTitles = {}; // { "1": "Intro", "2": "Follow-up Questions" }

const QUESTION_TYPE_LABELS = {
    multiple_choice: 'Multiple Choice',
    text: 'Text',
    checkbox: 'Checkbox',
    list: 'List',
    multiple_choice_grid: 'Multiple Choice Grid',
    checkbox_grid: 'Checkbox Grid',
    time: 'Time',
    date: 'Date'
};
const OPTION_BASED_TYPES = ['multiple_choice', 'checkbox', 'list'];
const GRID_TYPES = ['multiple_choice_grid', 'checkbox_grid'];
const PLAIN_INPUT_TYPES = ['text', 'time', 'date'];

// ============================================================================
// Page numbers — identical rule to Create Evaluation: every question AND
// every page-content block belongs to a page, defaulting to 1, and pages
// must be used sequentially across BOTH lists combined.
// ============================================================================
function highestExamPageNumberUsed(excludeList, excludeIdx) {
    let max = 1;
    examQuestions.forEach((q, idx) => {
        if (excludeList === examQuestions && idx === excludeIdx) return;
        max = Math.max(max, q.page_number || 1);
    });
    examContents.forEach((c, idx) => {
        if (excludeList === examContents && idx === excludeIdx) return;
        max = Math.max(max, c.page_number || 1);
    });
    return max;
}

function validateNoExamPageGaps() {
    const pages = Array.from(new Set([
        ...examQuestions.filter(q => (q.question_text || '').trim()).map(q => q.page_number || 1),
        ...examContents.filter(c => (c.content || '').trim()).map(c => c.page_number || 1)
    ])).sort((a, b) => a - b);
    for (let i = 0; i < pages.length; i++) {
        if (pages[i] !== i + 1) return false;
    }
    return true;
}

// ============================================================================
// Correct Answer control — rendered differently per question_type, kept in
// sync with the question's current Options/Rows/Columns every time the
// question list is re-rendered (same re-render-on-change pattern already
// used for the rest of the builder).
// ============================================================================
// ============================================================================
// A question worth 0 points is excluded from grading entirely (see
// gradeExamAnswer in js/exam-public.js) — its Correct Answer control is
// still rendered (so switching Points back to a nonzero value doesn't lose
// whatever was configured) but disabled, with a small note explaining why.
// zeroPointsNote() is shared by every branch below; disabledAttr is applied
// to every input/select inside the block.
// ============================================================================
function zeroPointsNote(isZeroPoints) {
    return isZeroPoints
        ? `<p class="cq-zero-points-note section-hint" style="margin:6px 0 0; color:#94a3b8; font-style:italic;">Worth 0 points — this question won't be graded.</p>`
        : '';
}

function renderCorrectAnswerControl(q, qIdx) {
    const options = Array.isArray(q.options) ? q.options : [];
    const gridRows = Array.isArray(q.grid_rows) ? q.grid_rows : [];
    const gridCols = Array.isArray(q.grid_columns) ? q.grid_columns : [];
    const isZeroPoints = (Number(q.points) || 0) === 0;
    const disabledAttr = isZeroPoints ? 'disabled' : '';

    if (q.question_type === 'multiple_choice' || q.question_type === 'list') {
        const current = typeof q.correct_answer === 'string' ? q.correct_answer : '';
        return `
            <div class="cq-correct-answer-block" style="margin-top:10px;">
                <label class="cq-grid-label">Correct Answer</label>
                <select class="cq-correct-select" data-qidx="${qIdx}" ${disabledAttr}>
                    <option value="">-- Select correct option --</option>
                    ${options.map(o => `<option value="${(o || '').replace(/"/g, '&quot;')}" ${current === o ? 'selected' : ''}>${o}</option>`).join('')}
                </select>
                ${zeroPointsNote(isZeroPoints)}
            </div>
        `;
    }

    if (q.question_type === 'checkbox') {
        const current = Array.isArray(q.correct_answer) ? q.correct_answer : [];
        return `
            <div class="cq-correct-answer-block" style="margin-top:10px;">
                <label class="cq-grid-label">Correct Answer(s)</label>
                ${options.map((o, oIdx) => `
                    <label class="cq-choice-label" style="display:block;">
                        <input type="checkbox" class="cq-correct-checkbox" data-qidx="${qIdx}" data-oidx="${oIdx}" value="${(o || '').replace(/"/g, '&quot;')}" ${current.includes(o) ? 'checked' : ''} ${disabledAttr}>
                        ${o}
                    </label>
                `).join('')}
                ${zeroPointsNote(isZeroPoints)}
            </div>
        `;
    }

    if (q.question_type === 'multiple_choice_grid') {
        const current = (q.correct_answer && typeof q.correct_answer === 'object' && !Array.isArray(q.correct_answer)) ? q.correct_answer : {};
        return `
            <div class="cq-correct-answer-block" style="margin-top:10px;">
                <label class="cq-grid-label">Correct Answer (per row)</label>
                ${gridRows.map(row => `
                    <div class="input-row" style="grid-template-columns: 140px 1fr; align-items:center; margin-bottom:6px;">
                        <span style="font-size:12.5px; color:#334155;">${row}</span>
                        <select class="cq-correct-grid-select" data-qidx="${qIdx}" data-row="${(row || '').replace(/"/g, '&quot;')}" ${disabledAttr}>
                            <option value="">-- Select column --</option>
                            ${gridCols.map(c => `<option value="${(c || '').replace(/"/g, '&quot;')}" ${current[row] === c ? 'selected' : ''}>${c}</option>`).join('')}
                        </select>
                    </div>
                `).join('')}
                ${zeroPointsNote(isZeroPoints)}
            </div>
        `;
    }

    if (q.question_type === 'checkbox_grid') {
        const current = (q.correct_answer && typeof q.correct_answer === 'object' && !Array.isArray(q.correct_answer)) ? q.correct_answer : {};
        return `
            <div class="cq-correct-answer-block" style="margin-top:10px;">
                <label class="cq-grid-label">Correct Answer(s) (per row)</label>
                ${gridRows.map(row => `
                    <div style="margin-bottom:8px;">
                        <span style="font-size:12.5px; color:#334155; display:block; margin-bottom:4px;">${row}</span>
                        ${gridCols.map(col => `
                            <label class="cq-choice-label" style="display:inline-flex; margin-right:10px;">
                                <input type="checkbox" class="cq-correct-grid-checkbox" data-qidx="${qIdx}" data-row="${(row || '').replace(/"/g, '&quot;')}" value="${(col || '').replace(/"/g, '&quot;')}" ${Array.isArray(current[row]) && current[row].includes(col) ? 'checked' : ''} ${disabledAttr}>
                                ${col}
                            </label>
                        `).join('')}
                    </div>
                `).join('')}
                ${zeroPointsNote(isZeroPoints)}
            </div>
        `;
    }

    // text / time / date — a plain expected-answer input, matched
    // case-insensitively/trimmed at grading time (see gradeExamAnswer in
    // js/exam-public.js).
    const inputType = q.question_type === 'time' ? 'time' : (q.question_type === 'date' ? 'date' : 'text');
    const current = typeof q.correct_answer === 'string' ? q.correct_answer : '';
    return `
        <div class="cq-correct-answer-block" style="margin-top:10px;">
            <label class="cq-grid-label">Correct Answer</label>
            <input type="${inputType}" class="cq-correct-plain-input" data-qidx="${qIdx}" value="${current.replace(/"/g, '&quot;')}" placeholder="Expected answer" ${disabledAttr}>
            ${zeroPointsNote(isZeroPoints)}
        </div>
    `;
}

// ============================================================================
// Live update as the admin types into the Points field — toggling every
// input/select inside that question's Correct Answer block (and the
// explanatory note) directly, rather than re-rendering the whole question
// list on every keystroke (which would steal focus from the Points input
// itself, same reasoning as the rest of this codebase's "input" handlers
// that only touch data, not markup).
// ============================================================================
function syncCorrectAnswerDisabledUi(qIdx) {
    const cards = document.querySelectorAll('#examQuestionsList .custom-question-card');
    const card = cards[qIdx];
    if (!card) return;
    const block = card.querySelector('.cq-correct-answer-block');
    if (!block) return;

    const isZeroPoints = (Number(examQuestions[qIdx].points) || 0) === 0;
    block.querySelectorAll('input, select').forEach(el => { el.disabled = isZeroPoints; });

    let note = block.querySelector('.cq-zero-points-note');
    if (isZeroPoints && !note) {
        block.insertAdjacentHTML('beforeend', zeroPointsNote(true));
    } else if (!isZeroPoints && note) {
        note.remove();
    }
}

function wireCorrectAnswerEvents() {
    const box = document.getElementById('examQuestionsList');

    box.querySelectorAll('.cq-correct-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            examQuestions[Number(e.target.dataset.qidx)].correct_answer = e.target.value || null;
        });
    });
    box.querySelectorAll('.cq-correct-plain-input').forEach(input => {
        input.addEventListener('input', (e) => {
            examQuestions[Number(e.target.dataset.qidx)].correct_answer = e.target.value || null;
        });
    });
    box.querySelectorAll('.cq-correct-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            const q = examQuestions[qIdx];
            const current = new Set(Array.isArray(q.correct_answer) ? q.correct_answer : []);
            if (e.target.checked) current.add(e.target.value); else current.delete(e.target.value);
            q.correct_answer = Array.from(current);
        });
    });
    box.querySelectorAll('.cq-correct-grid-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            const q = examQuestions[qIdx];
            const current = (q.correct_answer && typeof q.correct_answer === 'object' && !Array.isArray(q.correct_answer)) ? { ...q.correct_answer } : {};
            if (e.target.value) current[e.target.dataset.row] = e.target.value; else delete current[e.target.dataset.row];
            q.correct_answer = current;
        });
    });
    box.querySelectorAll('.cq-correct-grid-checkbox').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            const q = examQuestions[qIdx];
            const current = (q.correct_answer && typeof q.correct_answer === 'object' && !Array.isArray(q.correct_answer)) ? { ...q.correct_answer } : {};
            const row = e.target.dataset.row;
            const set = new Set(Array.isArray(current[row]) ? current[row] : []);
            if (e.target.checked) set.add(e.target.value); else set.delete(e.target.value);
            current[row] = Array.from(set);
            q.correct_answer = current;
        });
    });
    box.querySelectorAll('.cq-points-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            const qIdx = Number(e.target.dataset.qidx);
            examQuestions[qIdx].points = Number.isFinite(val) ? val : 0;
            syncCorrectAnswerDisabledUi(qIdx);
        });
    });
}

function renderExamQuestionsList() {
    const box = document.getElementById('examQuestionsList');
    if (examQuestions.length === 0) {
        box.innerHTML = '<p class="section-hint" style="margin:0;">No questions yet — add at least one below.</p>';
        return;
    }

    box.innerHTML = examQuestions.map((q, qIdx) => {
        const typeOptions = Object.entries(QUESTION_TYPE_LABELS)
            .map(([val, label]) => `<option value="${val}" ${q.question_type === val ? 'selected' : ''}>${label}</option>`).join('');

        let extraFieldsHtml = '';
        if (OPTION_BASED_TYPES.includes(q.question_type)) {
            extraFieldsHtml = `
                <div class="cq-options-list" data-qidx="${qIdx}">
                    ${q.options.map((opt, oIdx) => `
                        <div class="cq-option-row">
                            <input type="text" class="cq-option-input" data-qidx="${qIdx}" data-oidx="${oIdx}" value="${(opt || '').replace(/"/g, '&quot;')}" placeholder="Option ${oIdx + 1}">
                            <button type="button" class="cq-remove-option-btn" data-qidx="${qIdx}" data-oidx="${oIdx}">✕</button>
                        </div>
                    `).join('')}
                </div>
                <button type="button" class="cq-add-option-btn" data-qidx="${qIdx}">+ Add Option</button>
            `;
        } else if (GRID_TYPES.includes(q.question_type)) {
            extraFieldsHtml = `
                <div class="cq-grid-config">
                    <div>
                        <label class="cq-grid-label">Rows</label>
                        ${q.grid_rows.map((row, rIdx) => `
                            <div class="cq-option-row">
                                <input type="text" class="cq-gridrow-input" data-qidx="${qIdx}" data-ridx="${rIdx}" value="${(row || '').replace(/"/g, '&quot;')}" placeholder="Row ${rIdx + 1}">
                                <button type="button" class="cq-remove-gridrow-btn" data-qidx="${qIdx}" data-ridx="${rIdx}">✕</button>
                            </div>
                        `).join('')}
                        <button type="button" class="cq-add-gridrow-btn" data-qidx="${qIdx}">+ Add Row</button>
                    </div>
                    <div>
                        <label class="cq-grid-label">Columns</label>
                        ${q.grid_columns.map((col, cIdx) => `
                            <div class="cq-option-row">
                                <input type="text" class="cq-gridcol-input" data-qidx="${qIdx}" data-cidx="${cIdx}" value="${(col || '').replace(/"/g, '&quot;')}" placeholder="Column ${cIdx + 1}">
                                <button type="button" class="cq-remove-gridcol-btn" data-qidx="${qIdx}" data-cidx="${cIdx}">✕</button>
                            </div>
                        `).join('')}
                        <button type="button" class="cq-add-gridcol-btn" data-qidx="${qIdx}">+ Add Column</button>
                    </div>
                </div>
            `;
        }

        return `
            <div class="custom-question-card">
                <div class="cq-header-row">
                    <select class="cq-type-select" data-qidx="${qIdx}">${typeOptions}</select>
                    <label class="cq-page-label" style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:#64748b;">
                        Page
                        <input type="number" class="cq-page-input" data-qidx="${qIdx}" min="1" value="${q.page_number || 1}" style="width:56px; padding:6px 8px; border-radius:8px; border:1px solid #d1d5db; font-size:12px;" title="Which page of the exam this question appears on">
                    </label>
                    <label class="cq-page-label" style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:#64748b;">
                        Points
                        <input type="number" class="cq-points-input" data-qidx="${qIdx}" min="0" step="any" value="${q.points ?? 1}" style="width:64px; padding:6px 8px; border-radius:8px; border:1px solid #d1d5db; font-size:12px;" title="How many points this question is worth">
                    </label>
                    <button type="button" class="cq-duplicate-question-btn" data-qidx="${qIdx}">Duplicate</button>
                    <button type="button" class="cq-remove-question-btn" data-qidx="${qIdx}">Remove Question</button>
                </div>
                <input type="text" class="cq-text-input" data-qidx="${qIdx}" value="${(q.question_text || '').replace(/"/g, '&quot;')}" placeholder="Question text">
                ${extraFieldsHtml}
                ${renderCorrectAnswerControl(q, qIdx)}
            </div>
        `;
    }).join('');

    wireExamQuestionEvents();
    wireCorrectAnswerEvents();
}

function wireExamQuestionEvents() {
    const box = document.getElementById('examQuestionsList');

    box.querySelectorAll('.cq-type-select').forEach(sel => {
        sel.addEventListener('change', async (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            const q = examQuestions[qIdx];
            const newType = e.target.value;

            // Changing the type of an already-saved question that already has
            // real submitted answers resets its options/grid rows/columns AND
            // its correct answer — warn first, same as create-evaluation.js.
            if (q.id != null && editingExamId) {
                const { count } = await client
                    .from('activity_exam_answers')
                    .select('id', { count: 'exact', head: true })
                    .eq('question_id', q.id);
                if (count > 0) {
                    const ok = await confirmCard(
                        `"${q.question_text || 'This question'}" already has ${count} submitted answer${count === 1 ? '' : 's'}. Changing its type resets its options/rows and correct answer, so those existing answers may no longer display or grade correctly. Change the type anyway?`,
                        { okLabel: 'Change Type', cancelLabel: 'Cancel' }
                    );
                    if (!ok) {
                        e.target.value = q.question_type; // revert the dropdown
                        return;
                    }
                }
            }

            q.question_type = newType;
            q.options = [];
            q.grid_rows = [];
            q.grid_columns = [];
            q.correct_answer = null;
            renderExamQuestionsList();
        });
    });
    box.querySelectorAll('.cq-text-input').forEach(input => {
        input.addEventListener('input', (e) => {
            examQuestions[Number(e.target.dataset.qidx)].question_text = e.target.value;
        });
    });
    box.querySelectorAll('.cq-page-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            let newVal = parseInt(e.target.value, 10);
            if (!Number.isFinite(newVal) || newVal < 1) newVal = 1;

            const maxAllowed = highestExamPageNumberUsed(examQuestions, qIdx) + 1;
            if (newVal > maxAllowed) {
                alert(`Page numbers can't skip ahead — page ${maxAllowed} is the next page available. Add at least one question or content block to page ${maxAllowed} before using page ${newVal}.`);
                e.target.value = examQuestions[qIdx].page_number || 1;
                return;
            }

            examQuestions[qIdx].page_number = newVal;
            e.target.value = newVal;
            renderExamPageTitlesSummary();
        });
    });
    box.querySelectorAll('.cq-duplicate-question-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            // Deep copy (via JSON) so editing the copy's options/rows/correct
            // answer never mutates the original question's data — points and
            // correct_answer are plain fields on the same object, so this
            // copies them too, same as everything else.
            const copy = JSON.parse(JSON.stringify(examQuestions[qIdx]));
            delete copy.id; // it's a brand-new question, not the same DB row
            examQuestions.splice(qIdx + 1, 0, copy);
            renderExamQuestionsList();
            renderExamPageTitlesSummary();
        });
    });
    box.querySelectorAll('.cq-remove-question-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            const q = examQuestions[qIdx];

            // A brand-new question (never saved) or removing one while
            // CREATING a new exam has nothing in the DB to lose — remove it
            // immediately.
            if (q.id == null || !editingExamId) {
                examQuestions.splice(qIdx, 1);
                renderExamQuestionsList();
                renderExamPageTitlesSummary();
                return;
            }

            if (typeof formCard !== 'function' || typeof confirmCard !== 'function') {
                alert('This page needs a fresh copy of a required file — please hard-refresh (Ctrl+Shift+R) and try again.');
                return;
            }

            const { count } = await client
                .from('activity_exam_answers')
                .select('id', { count: 'exact', head: true })
                .eq('question_id', q.id);
            const answerCount = count || 0;

            const warning = answerCount > 0
                ? `Removing "${q.question_text || 'this question'}" will permanently delete the ${answerCount} answer${answerCount === 1 ? '' : 's'} already submitted for it, and this cannot be undone once saved.`
                : `Remove "${q.question_text || 'this question'}"? It has no submitted answers yet, but this can't be undone once you save.`;

            const result = await formCard('Remove Question', [
                { name: 'reason', label: `Why are you removing this question?`, placeholder: 'Reason for removing' }
            ], { okLabel: 'Continue' });
            if (!result) return;
            if (!result.reason) { alert('Please enter a reason.'); return; }
            if (!(await confirmCard(warning))) return;

            pendingQuestionRemovals.push({
                question_text: q.question_text || '(untitled question)',
                question_type: q.question_type,
                answerCount,
                reason: result.reason
            });

            examQuestions.splice(qIdx, 1);
            renderExamQuestionsList();
            renderExamPageTitlesSummary();
        });
    });

    box.querySelectorAll('.cq-option-input').forEach(input => {
        input.addEventListener('input', (e) => {
            examQuestions[Number(e.target.dataset.qidx)].options[Number(e.target.dataset.oidx)] = e.target.value;
        });
    });
    box.querySelectorAll('.cq-add-option-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            examQuestions[Number(e.target.dataset.qidx)].options.push('');
            renderExamQuestionsList();
        });
    });
    box.querySelectorAll('.cq-remove-option-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            examQuestions[qIdx].options.splice(Number(e.target.dataset.oidx), 1);
            renderExamQuestionsList();
        });
    });

    box.querySelectorAll('.cq-gridrow-input').forEach(input => {
        input.addEventListener('input', (e) => {
            examQuestions[Number(e.target.dataset.qidx)].grid_rows[Number(e.target.dataset.ridx)] = e.target.value;
        });
    });
    box.querySelectorAll('.cq-add-gridrow-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            examQuestions[Number(e.target.dataset.qidx)].grid_rows.push('');
            renderExamQuestionsList();
        });
    });
    box.querySelectorAll('.cq-remove-gridrow-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            examQuestions[qIdx].grid_rows.splice(Number(e.target.dataset.ridx), 1);
            renderExamQuestionsList();
        });
    });

    box.querySelectorAll('.cq-gridcol-input').forEach(input => {
        input.addEventListener('input', (e) => {
            examQuestions[Number(e.target.dataset.qidx)].grid_columns[Number(e.target.dataset.cidx)] = e.target.value;
        });
    });
    box.querySelectorAll('.cq-add-gridcol-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            examQuestions[Number(e.target.dataset.qidx)].grid_columns.push('');
            renderExamQuestionsList();
        });
    });
    box.querySelectorAll('.cq-remove-gridcol-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            examQuestions[qIdx].grid_columns.splice(Number(e.target.dataset.cidx), 1);
            renderExamQuestionsList();
        });
    });
}

document.getElementById('addExamQuestionBtn').addEventListener('click', () => {
    examQuestions.push({ question_type: 'text', question_text: '', options: [], grid_rows: [], grid_columns: [], points: 1, correct_answer: null, page_number: 1 });
    document.getElementById('examQuestionsRequiredHint').classList.add('hidden-element');
    renderExamQuestionsList();
    renderExamPageTitlesSummary();
});

// ============================================================================
// Page Content (optional) — identical mechanics to Create Evaluation's
// evalContents.
// ============================================================================
function renderExamContentList() {
    const box = document.getElementById('examContentList');
    if (examContents.length === 0) {
        box.innerHTML = '<p class="section-hint" style="margin:0;">No page content yet.</p>';
        return;
    }

    box.innerHTML = examContents.map((c, idx) => `
        <div class="custom-question-card">
            <div class="cq-header-row">
                <span class="ac-order-badge">Content ${idx + 1} of ${examContents.length}</span>
                <label class="cq-page-label" style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:#64748b;">
                    Page
                    <input type="number" class="ac-content-page-input" data-idx="${idx}" min="1" value="${c.page_number || 1}" style="width:56px; padding:6px 8px; border-radius:8px; border:1px solid #d1d5db; font-size:12px;" title="Which page of the exam this content block appears on">
                </label>
                <button type="button" class="cq-remove-question-btn" data-remove-idx="${idx}">Remove</button>
            </div>
            <input type="text" class="cq-text-input" data-title-idx="${idx}" value="${(c.title || '').replace(/"/g, '&quot;')}" placeholder="Optional Title">
            <textarea class="ac-body-textarea" data-content-idx="${idx}" placeholder="Content" rows="4">${c.content || ''}</textarea>
        </div>
    `).join('');

    wireExamContentEvents();
}

function wireExamContentEvents() {
    const box = document.getElementById('examContentList');

    box.querySelectorAll('[data-title-idx]').forEach(input => {
        input.addEventListener('input', (e) => {
            examContents[Number(e.target.dataset.titleIdx)].title = e.target.value;
        });
    });
    box.querySelectorAll('[data-content-idx]').forEach(textarea => {
        textarea.addEventListener('input', (e) => {
            examContents[Number(e.target.dataset.contentIdx)].content = e.target.value;
        });
    });
    box.querySelectorAll('.ac-content-page-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = Number(e.target.dataset.idx);
            let newVal = parseInt(e.target.value, 10);
            if (!Number.isFinite(newVal) || newVal < 1) newVal = 1;

            const maxAllowed = highestExamPageNumberUsed(examContents, idx) + 1;
            if (newVal > maxAllowed) {
                alert(`Page numbers can't skip ahead — page ${maxAllowed} is the next page available. Add at least one question or content block to page ${maxAllowed} before using page ${newVal}.`);
                e.target.value = examContents[idx].page_number || 1;
                return;
            }

            examContents[idx].page_number = newVal;
            e.target.value = newVal;
            renderExamPageTitlesSummary();
        });
    });
    box.querySelectorAll('[data-remove-idx]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            examContents.splice(Number(e.target.dataset.removeIdx), 1);
            renderExamContentList();
            renderExamPageTitlesSummary();
        });
    });
}

document.getElementById('addExamContentBtn').addEventListener('click', () => {
    examContents.push({ title: '', content: '', page_number: 1 });
    renderExamContentList();
    renderExamPageTitlesSummary();
});

// ============================================================================
// Page titles — identical mechanics to Create Evaluation's evalPageTitles.
// ============================================================================
function renderExamPageTitlesSummary() {
    const box = document.getElementById('examPageTitlesSummary');
    if (!box) return;

    const maxPage = highestExamPageNumberUsed(null, null);
    const heading = `<p class="section-hint" style="margin:0 0 10px;">This exam has ${maxPage} page${maxPage === 1 ? '' : 's'}. Optionally give any page a title — it's shown as a heading at the top of that page when a participant takes the exam.</p>`;

    let rows = '';
    for (let p = 1; p <= maxPage; p++) {
        const val = (examPageTitles[String(p)] || '');
        rows += `
            <div class="input-row" style="grid-template-columns: 100px 1fr; align-items:center; margin-bottom:8px;">
                <span style="font-size:13px; font-weight:700; color:#334155;">Page ${p}</span>
                <input type="text" class="exam-page-title-input" data-page="${p}" value="${val.replace(/"/g, '&quot;')}" placeholder="Optional page title">
            </div>
        `;
    }

    box.innerHTML = heading + rows;

    box.querySelectorAll('.exam-page-title-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const page = e.target.dataset.page;
            const val = e.target.value;
            if (val.trim()) {
                examPageTitles[page] = val;
            } else {
                delete examPageTitles[page];
            }
        });
    });
}

document.getElementById('examThemeColor').addEventListener('input', (e) => {
    document.getElementById('examThemeColorPreview').textContent = e.target.value.toUpperCase();
});

// ============================================================================
// Duration — entered as "minutes.seconds", where the digits after the dot
// are taken LITERALLY as the seconds count, not as a fraction of a minute:
// "2.30" = 2 min 30 sec, "2.5" = 2 min 5 sec (not 2 min 30 sec). No dot
// means whole minutes ("30" = 30 min). Stored/loaded as total seconds
// (activity_exams.duration_seconds) so the rest of the app never has to
// care about this input format.
// ============================================================================
function parseDurationInputToSeconds(raw) {
    const str = String(raw ?? '').trim();
    if (!str) return null;
    const match = str.match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!match) return null;
    const minutes = parseInt(match[1], 10);
    const seconds = match[2] ? parseInt(match[2], 10) : 0;
    if (seconds > 59) return null; // "2.75" isn't a valid seconds count
    return minutes * 60 + seconds;
}

function formatSecondsAsDurationInput(totalSeconds) {
    const total = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return seconds === 0 ? String(minutes) : `${minutes}.${String(seconds).padStart(2, '0')}`;
}

function updateExamDurationPreview() {
    const seconds = parseDurationInputToSeconds(document.getElementById('examDurationInput').value);
    const preview = document.getElementById('examDurationPreview');
    if (seconds == null) {
        preview.textContent = 'Enter as minutes.seconds, e.g. 2.30';
        preview.style.color = '#dc2626';
    } else {
        const m = Math.floor(seconds / 60), s = seconds % 60;
        preview.textContent = `= ${m} min ${String(s).padStart(2, '0')} sec`;
        preview.style.color = '#64748b';
    }
}
document.getElementById('examDurationInput').addEventListener('input', updateExamDurationPreview);
updateExamDurationPreview();

// ============================================================================
// Timer toggle — "Enable Timer" is unchecked by default for a new exam
// (no timer). When unchecked, the Duration row is hidden (not removed from
// the DOM, so its value is preserved if the admin re-enables the timer
// without re-typing it) and its `required` validation is skipped entirely
// in handleFormSubmission below.
// ============================================================================
function updateTimerToggleUi() {
    const enabled = document.getElementById('examTimerEnabled').checked;
    document.getElementById('examDurationRow').classList.toggle('hidden-element', !enabled);
    document.getElementById('examDurationHint').classList.toggle('hidden-element', !enabled);
}
document.getElementById('examTimerEnabled').addEventListener('change', updateTimerToggleUi);
updateTimerToggleUi();

// ============================================================================
// Load the Activity picker — every course, newest activity date first, same
// as create-evaluation.js.
// ============================================================================
async function loadCourseOptions(selectedCourseId) {
    const { data: courses, error } = await client.from('courses').select('id, name, course_date').order('course_date', { ascending: false });
    const select = document.getElementById('examCourseSelect');
    if (error) {
        select.innerHTML = '<option value="">-- Could not load activities --</option>';
        return;
    }
    select.innerHTML = '<option value="">-- Choose Activity --</option>' +
        (courses || []).map(c => `<option value="${c.id}" ${selectedCourseId && Number(selectedCourseId) === c.id ? 'selected' : ''}>${c.name} (🗓️ ${c.course_date || 'N/A'})</option>`).join('');
}

// ============================================================================
// Edit / Duplicate — both load an existing exam's questions/theme/comment/
// duration. Duplicate additionally leaves Title and Activity blank so the
// admin picks a fresh pair before saving, and never touches the id it copied
// from (a plain create, not an update) — same pattern as create-evaluation.js.
// ============================================================================
async function loadExamForEdit(id, isDuplicate) {
    const { data: exam, error } = await client.from('activity_exams').select('*').eq('id', id).maybeSingle();
    if (error || !exam) {
        alert('Could not load that exam.');
        window.location.href = 'exam-dashboard.html';
        return;
    }

    document.getElementById('formPanelTitle').textContent = isDuplicate ? 'Duplicate Exam' : 'Edit Exam';
    document.getElementById('examThemeColor').value = exam.theme_color || '#7C3AED';
    document.getElementById('examThemeColorPreview').textContent = (exam.theme_color || '#7C3AED').toUpperCase();
    document.getElementById('examComment').value = exam.comment || '';
    document.getElementById('examDurationInput').value = formatSecondsAsDurationInput(exam.duration_seconds || 1800);
    updateExamDurationPreview();
    document.getElementById('examRequireBeforeRegistration').checked = !!exam.require_before_registration;
    document.getElementById('examTimerEnabled').checked = !!exam.timer_enabled;
    updateTimerToggleUi();
    examPageTitles = (exam.page_titles && typeof exam.page_titles === 'object') ? { ...exam.page_titles } : {};

    if (isDuplicate) {
        document.getElementById('examTitle').value = '';
        await loadCourseOptions(null);
    } else {
        document.getElementById('examTitle').value = exam.title || '';
        await loadCourseOptions(exam.course_id);
    }

    const { data: existingQuestions } = await client.from('activity_exam_questions').select('*').eq('exam_id', id).order('display_order', { ascending: true });
    examQuestions = (existingQuestions || []).map(q => ({
        id: isDuplicate ? undefined : q.id,
        question_type: q.question_type, question_text: q.question_text,
        options: Array.isArray(q.options) ? q.options : [],
        grid_rows: Array.isArray(q.grid_rows) ? q.grid_rows : [],
        grid_columns: Array.isArray(q.grid_columns) ? q.grid_columns : [],
        points: q.points != null ? Number(q.points) : 1,
        correct_answer: q.correct_answer != null ? q.correct_answer : null,
        page_number: q.page_number || 1
    }));
    renderExamQuestionsList();

    const { data: existingContents } = await client.from('activity_exam_contents').select('*').eq('exam_id', id).order('content_order', { ascending: true });
    examContents = (existingContents || []).map(c => ({
        id: isDuplicate ? undefined : c.id,
        title: c.title || '',
        content: c.content || '',
        page_number: c.page_number || 1
    }));
    renderExamContentList();
    renderExamPageTitlesSummary();
}

// ============================================================================
// Save — a real sync, NOT delete-and-reinsert, for exactly the same reason
// as create-evaluation.js's pushEvalQuestions: a kept question (`q.id` still
// set) is UPSERTED onto its own existing row so its id — and every answer
// already submitted against it — survives. Only a question actually removed
// from the form gets deleted (cascading away its answers, which is correct
// there). A brand-new question (no `q.id` yet) is inserted fresh.
// ============================================================================
async function pushExamQuestions(examId) {
    const rows = examQuestions
        .filter(q => q.question_text.trim())
        .map((q, idx) => ({
            id: q.id,
            question_type: q.question_type,
            question_text: q.question_text.trim(),
            options: OPTION_BASED_TYPES.includes(q.question_type) ? q.options.filter(o => o.trim()) : [],
            grid_rows: GRID_TYPES.includes(q.question_type) ? q.grid_rows.filter(r => r.trim()) : [],
            grid_columns: GRID_TYPES.includes(q.question_type) ? q.grid_columns.filter(c => c.trim()) : [],
            correct_answer: q.correct_answer ?? null,
            points: Number.isFinite(Number(q.points)) ? Number(q.points) : 1,
            display_order: idx,
            page_number: Math.max(1, q.page_number || 1)
        }));

    const keptRows = rows.filter(r => r.id != null);
    const newRows = rows.filter(r => r.id == null).map(({ id, ...rest }) => rest);
    const keptIds = keptRows.map(r => r.id);

    let deleteQuery = client.from('activity_exam_questions').delete().eq('exam_id', examId);
    if (keptIds.length > 0) deleteQuery = deleteQuery.not('id', 'in', `(${keptIds.join(',')})`);
    const { error: delErr } = await deleteQuery;
    if (delErr) throw new Error('Removing old questions failed: ' + delErr.message);

    // Every write below is error-checked and THROWS on failure — previously
    // these were fire-and-forget, so a rejected write (a bad value, a
    // constraint, anything) failed completely silently: handleFormSubmission
    // would still show "Exam updated successfully" even though nothing
    // actually saved. That's exactly the "I changed a question and saved,
    // but it still shows the old answer" symptom this was fixed for.
    //
    // Kept rows are saved with a plain UPDATE per row, NOT .upsert() —
    // activity_exam_questions.id is `generated always as identity`, and
    // upsert's underlying INSERT...ON CONFLICT statement still tries to
    // insert the explicit id value we pass, which Postgres flatly rejects
    // for a GENERATED ALWAYS identity column ("cannot insert a non-DEFAULT
    // value into column \"id\"") — regardless of the ON CONFLICT clause. A
    // plain UPDATE never inserts anything, so it isn't affected by that
    // restriction at all.
    if (keptRows.length > 0) {
        const results = await Promise.all(keptRows.map(r => {
            const { id, ...fields } = r;
            return client.from('activity_exam_questions').update(fields).eq('id', id);
        }));
        const failed = results.find(r => r.error);
        if (failed) throw new Error('Saving question changes failed: ' + failed.error.message);
    }
    if (newRows.length > 0) {
        const { error: insErr } = await client.from('activity_exam_questions')
            .insert(newRows.map(r => ({ ...r, exam_id: examId })));
        if (insErr) throw new Error('Saving new questions failed: ' + insErr.message);
    }
    return rows.length;
}

async function pushExamContents(examId) {
    const { error: delErr } = await client.from('activity_exam_contents').delete().eq('exam_id', examId);
    if (delErr) throw new Error('Removing old page content failed: ' + delErr.message);

    const rows = examContents
        .filter(c => (c.content || '').trim())
        .map((c, idx) => ({
            exam_id: examId,
            content_order: idx,
            title: (c.title || '').trim() || null,
            content: c.content.trim(),
            page_number: Math.max(1, c.page_number || 1)
        }));

    if (rows.length > 0) {
        const { error: insErr } = await client.from('activity_exam_contents').insert(rows);
        if (insErr) throw new Error('Saving page content failed: ' + insErr.message);
    }
}

async function handleFormSubmission(e) {
    e.preventDefault();

    const title = document.getElementById('examTitle').value.trim();
    const course_id = Number(document.getElementById('examCourseSelect').value) || null;
    const theme_color = document.getElementById('examThemeColor').value || '#7C3AED';
    const comment = document.getElementById('examComment').value.trim() || null;
    const require_before_registration = document.getElementById('examRequireBeforeRegistration').checked;
    const timer_enabled = document.getElementById('examTimerEnabled').checked;
    let duration_seconds = parseDurationInputToSeconds(document.getElementById('examDurationInput').value);

    if (!title) { alert('Please enter a title.'); return; }
    // Duration only needs to be a valid, meaningful value when the timer is
    // actually enabled — with the timer off, whatever's stored there is
    // simply never read by the app (see sql/activity-exams.sql's comment on
    // timer_enabled), so an empty/invalid duration input doesn't block
    // saving.
    if (timer_enabled && (duration_seconds == null || duration_seconds < 1)) {
        alert('Please enter a valid duration as minutes.seconds (e.g. 2.30 for 2 min 30 sec), with seconds no higher than 59.');
        document.getElementById('examDurationInput').focus();
        return;
    }
    if (!timer_enabled && (duration_seconds == null || duration_seconds < 1)) {
        duration_seconds = 1800; // keep the NOT NULL column populated even when unused
    }
    if (!course_id) { alert('Please choose the Activity this exam belongs to.'); return; }

    const questionsWithText = examQuestions.filter(q => q.question_text.trim());
    if (questionsWithText.length === 0) {
        document.getElementById('examQuestionsRequiredHint').classList.remove('hidden-element');
        document.getElementById('examQuestionsRequiredHint').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    document.getElementById('examQuestionsRequiredHint').classList.add('hidden-element');

    if (!validateNoExamPageGaps()) {
        alert("Page numbers must be sequential with no gaps — make sure page 1, then page 2, and so on are each used (by a question or a content block) before assigning the next page number.");
        return;
    }

    const maxSavedPage = Math.max(1, ...[
        ...examQuestions.filter(q => q.question_text.trim()).map(q => q.page_number || 1),
        ...examContents.filter(c => (c.content || '').trim()).map(c => c.page_number || 1)
    ]);
    const page_titles = {};
    Object.keys(examPageTitles).forEach(k => {
        const p = Number(k);
        if (Number.isInteger(p) && p >= 1 && p <= maxSavedPage && (examPageTitles[k] || '').trim()) {
            page_titles[k] = examPageTitles[k].trim();
        }
    });

    const submitBtn = document.getElementById('submitExamFormBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = editingExamId ? 'Updating…' : 'Saving…';

    try {
        if (editingExamId) {
            const { error: updErr } = await client.from('activity_exams').update({
                title, course_id, theme_color, comment, duration_seconds, page_titles,
                require_before_registration, timer_enabled
            }).eq('id', editingExamId);
            if (updErr) { alert('Could not update: ' + updErr.message); return; }

            await pushExamQuestions(editingExamId);
            await pushExamContents(editingExamId);

            if (pendingQuestionRemovals.length > 0) {
                const adminName = currentAdminName();
                await Promise.all(pendingQuestionRemovals.map(item => client.from('deletion_audit_log').insert({
                    admin_username: adminName,
                    entity_type: 'exam_question',
                    entity_label: `${title} — "${item.question_text}"${item.answerCount > 0 ? ` (${item.answerCount} answer${item.answerCount === 1 ? '' : 's'} deleted)` : ''}`,
                    reason: item.reason
                })));
                pendingQuestionRemovals = [];
            }

            alert('Exam updated successfully.');
            window.location.href = 'exam-dashboard.html';
        } else {
            // A Duplicate is just a Create with no editingExamId set —
            // duplicateSourceId only mattered for loading the starting
            // questions/theme/comment/duration above, never for what gets
            // saved.
            const public_slug = Math.random().toString(36).slice(2, 10);
            const { data: newExam, error: insErr } = await client.from('activity_exams').insert({
                title, course_id, theme_color, comment, duration_seconds, public_slug, page_titles,
                require_before_registration, timer_enabled
            }).select().single();
            if (insErr) { alert('Could not create: ' + insErr.message); return; }

            await pushExamQuestions(newExam.id);
            await pushExamContents(newExam.id);
            alert('Exam created successfully.');
            window.location.href = 'exam-dashboard.html';
        }
    } catch (err) {
        // pushExamQuestions/pushExamContents now throw instead of failing
        // silently (see their comments) — this is what actually surfaces
        // that failure to you, instead of showing "updated successfully"
        // while nothing was really saved.
        alert('Could not save: ' + err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save';
    }
}

document.getElementById('examForm').addEventListener('submit', handleFormSubmission);

(async function init() {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('edit_id');
    const duplicateId = params.get('duplicate_id');

    if (editId) {
        editingExamId = Number(editId);
        await loadExamForEdit(editingExamId, false);
    } else if (duplicateId) {
        duplicateSourceId = Number(duplicateId);
        await loadExamForEdit(duplicateSourceId, true);
    } else {
        await loadCourseOptions(null);
        renderExamQuestionsList();
        renderExamContentList();
        renderExamPageTitlesSummary();
    }
})();
