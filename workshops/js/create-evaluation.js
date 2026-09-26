import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let editingEvaluationId = null; // set when ?edit_id=... — updates that row in place
let duplicateSourceId = null;   // set when ?duplicate_id=... — loads its questions/theme/comment but leaves Title/Activity blank

// ============================================================================
// Questions builder — same 8 types, same shape and styling as Create
// Activity's Custom Questions (course_questions), reusing its exact CSS
// classes (.custom-question-card, .cq-*) so it looks and behaves
// identically. The one difference: at least one question is REQUIRED here
// before the evaluation can be saved (enforced in handleFormSubmission).
// ============================================================================
let evalQuestions = []; // [{ id?, question_type, question_text, options: [], grid_rows: [], grid_columns: [], page_number }]
let evalContents = []; // [{ id?, title, content, page_number }]
let evalPageTitles = {}; // { "1": "Intro", "2": "Follow-up Questions" }

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

// ============================================================================
// Page numbers — every question AND every page-content block belongs to a
// page, defaulting to 1. Pages must be used sequentially across BOTH lists
// combined: nothing can be set to page N+1 until at least one question OR
// content block already exists on page N, so the public evaluation page
// never has to skip a gap. Same idea as Create Activity's Custom Questions
// (js/create-course.js).
// ============================================================================

// The highest page number currently in use across every question and every
// content block, optionally excluding one item (identified by list + index)
// that's in the middle of being changed.
function highestEvalPageNumberUsed(excludeList, excludeIdx) {
    let max = 1;
    evalQuestions.forEach((q, idx) => {
        if (excludeList === evalQuestions && idx === excludeIdx) return;
        max = Math.max(max, q.page_number || 1);
    });
    evalContents.forEach((c, idx) => {
        if (excludeList === evalContents && idx === excludeIdx) return;
        max = Math.max(max, c.page_number || 1);
    });
    return max;
}

// Final defensive check, run right before saving. Considers only
// questions/content blocks that will actually be saved (non-empty).
function validateNoEvalPageGaps() {
    const pages = Array.from(new Set([
        ...evalQuestions.filter(q => (q.question_text || '').trim()).map(q => q.page_number || 1),
        ...evalContents.filter(c => (c.content || '').trim()).map(c => c.page_number || 1)
    ])).sort((a, b) => a - b);
    for (let i = 0; i < pages.length; i++) {
        if (pages[i] !== i + 1) return false;
    }
    return true;
}

function renderEvalQuestionsList() {
    const box = document.getElementById('evalQuestionsList');
    if (evalQuestions.length === 0) {
        box.innerHTML = '<p class="section-hint" style="margin:0;">No questions yet — add at least one below.</p>';
        return;
    }

    box.innerHTML = evalQuestions.map((q, qIdx) => {
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
                        <input type="number" class="cq-page-input" data-qidx="${qIdx}" min="1" value="${q.page_number || 1}" style="width:56px; padding:6px 8px; border-radius:8px; border:1px solid #d1d5db; font-size:12px;" title="Which page of the evaluation this question appears on">
                    </label>
                    <button type="button" class="cq-duplicate-question-btn" data-qidx="${qIdx}">Duplicate</button>
                    <button type="button" class="cq-remove-question-btn" data-qidx="${qIdx}">Remove Question</button>
                </div>
                <input type="text" class="cq-text-input" data-qidx="${qIdx}" value="${(q.question_text || '').replace(/"/g, '&quot;')}" placeholder="Question text">
                ${extraFieldsHtml}
            </div>
        `;
    }).join('');

    wireEvalQuestionEvents();
}

function wireEvalQuestionEvents() {
    const box = document.getElementById('evalQuestionsList');

    box.querySelectorAll('.cq-type-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            evalQuestions[qIdx].question_type = e.target.value;
            evalQuestions[qIdx].options = [];
            evalQuestions[qIdx].grid_rows = [];
            evalQuestions[qIdx].grid_columns = [];
            renderEvalQuestionsList();
        });
    });
    box.querySelectorAll('.cq-text-input').forEach(input => {
        input.addEventListener('input', (e) => {
            evalQuestions[Number(e.target.dataset.qidx)].question_text = e.target.value;
        });
    });
    box.querySelectorAll('.cq-page-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            let newVal = parseInt(e.target.value, 10);
            if (!Number.isFinite(newVal) || newVal < 1) newVal = 1;

            const maxAllowed = highestEvalPageNumberUsed(evalQuestions, qIdx) + 1;
            if (newVal > maxAllowed) {
                alert(`Page numbers can't skip ahead — page ${maxAllowed} is the next page available. Add at least one question or content block to page ${maxAllowed} before using page ${newVal}.`);
                e.target.value = evalQuestions[qIdx].page_number || 1;
                return;
            }

            evalQuestions[qIdx].page_number = newVal;
            e.target.value = newVal;
            renderEvalPageTitlesSummary();
        });
    });
    box.querySelectorAll('.cq-duplicate-question-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            // Deep copy (via JSON) so editing the copy's options/rows never
            // mutates the original question's arrays.
            const copy = JSON.parse(JSON.stringify(evalQuestions[qIdx]));
            delete copy.id; // it's a brand-new question, not the same DB row
            evalQuestions.splice(qIdx + 1, 0, copy);
            renderEvalQuestionsList();
            renderEvalPageTitlesSummary();
        });
    });
    box.querySelectorAll('.cq-remove-question-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            evalQuestions.splice(Number(e.target.dataset.qidx), 1);
            renderEvalQuestionsList();
            renderEvalPageTitlesSummary();
        });
    });

    box.querySelectorAll('.cq-option-input').forEach(input => {
        input.addEventListener('input', (e) => {
            evalQuestions[Number(e.target.dataset.qidx)].options[Number(e.target.dataset.oidx)] = e.target.value;
        });
    });
    box.querySelectorAll('.cq-add-option-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            evalQuestions[Number(e.target.dataset.qidx)].options.push('');
            renderEvalQuestionsList();
        });
    });
    box.querySelectorAll('.cq-remove-option-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            evalQuestions[qIdx].options.splice(Number(e.target.dataset.oidx), 1);
            renderEvalQuestionsList();
        });
    });

    box.querySelectorAll('.cq-gridrow-input').forEach(input => {
        input.addEventListener('input', (e) => {
            evalQuestions[Number(e.target.dataset.qidx)].grid_rows[Number(e.target.dataset.ridx)] = e.target.value;
        });
    });
    box.querySelectorAll('.cq-add-gridrow-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            evalQuestions[Number(e.target.dataset.qidx)].grid_rows.push('');
            renderEvalQuestionsList();
        });
    });
    box.querySelectorAll('.cq-remove-gridrow-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            evalQuestions[qIdx].grid_rows.splice(Number(e.target.dataset.ridx), 1);
            renderEvalQuestionsList();
        });
    });

    box.querySelectorAll('.cq-gridcol-input').forEach(input => {
        input.addEventListener('input', (e) => {
            evalQuestions[Number(e.target.dataset.qidx)].grid_columns[Number(e.target.dataset.cidx)] = e.target.value;
        });
    });
    box.querySelectorAll('.cq-add-gridcol-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            evalQuestions[Number(e.target.dataset.qidx)].grid_columns.push('');
            renderEvalQuestionsList();
        });
    });
    box.querySelectorAll('.cq-remove-gridcol-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const qIdx = Number(e.target.dataset.qidx);
            evalQuestions[qIdx].grid_columns.splice(Number(e.target.dataset.cidx), 1);
            renderEvalQuestionsList();
        });
    });
}

document.getElementById('addEvalQuestionBtn').addEventListener('click', () => {
    evalQuestions.push({ question_type: 'text', question_text: '', options: [], grid_rows: [], grid_columns: [], page_number: 1 });
    document.getElementById('evalQuestionsRequiredHint').classList.add('hidden-element');
    renderEvalQuestionsList();
    renderEvalPageTitlesSummary();
});

// ============================================================================
// Page Content (optional) — informational reading shown on the public exam
// page, grouped onto a page alongside that page's questions (content first,
// then questions — see buildEvalPageSegments in evaluation-public.js). Same
// card-list visual style as the questions above and as the old anchor-based
// content cards this replaces.
// ============================================================================
function renderEvalContentList() {
    const box = document.getElementById('evalContentList');
    if (evalContents.length === 0) {
        box.innerHTML = '<p class="section-hint" style="margin:0;">No page content yet.</p>';
        return;
    }

    box.innerHTML = evalContents.map((c, idx) => `
        <div class="custom-question-card">
            <div class="cq-header-row">
                <span class="ac-order-badge">Content ${idx + 1} of ${evalContents.length}</span>
                <label class="cq-page-label" style="display:flex; align-items:center; gap:6px; font-size:12px; font-weight:700; color:#64748b;">
                    Page
                    <input type="number" class="ac-content-page-input" data-idx="${idx}" min="1" value="${c.page_number || 1}" style="width:56px; padding:6px 8px; border-radius:8px; border:1px solid #d1d5db; font-size:12px;" title="Which page of the evaluation this content block appears on">
                </label>
                <button type="button" class="cq-remove-question-btn" data-remove-idx="${idx}">Remove</button>
            </div>
            <input type="text" class="cq-text-input" data-title-idx="${idx}" value="${(c.title || '').replace(/"/g, '&quot;')}" placeholder="Optional Title">
            <textarea class="ac-body-textarea" data-content-idx="${idx}" placeholder="Content" rows="4">${c.content || ''}</textarea>
        </div>
    `).join('');

    wireEvalContentEvents();
}

function wireEvalContentEvents() {
    const box = document.getElementById('evalContentList');

    box.querySelectorAll('[data-title-idx]').forEach(input => {
        input.addEventListener('input', (e) => {
            evalContents[Number(e.target.dataset.titleIdx)].title = e.target.value;
        });
    });
    box.querySelectorAll('[data-content-idx]').forEach(textarea => {
        textarea.addEventListener('input', (e) => {
            evalContents[Number(e.target.dataset.contentIdx)].content = e.target.value;
        });
    });
    box.querySelectorAll('.ac-content-page-input').forEach(input => {
        input.addEventListener('change', (e) => {
            const idx = Number(e.target.dataset.idx);
            let newVal = parseInt(e.target.value, 10);
            if (!Number.isFinite(newVal) || newVal < 1) newVal = 1;

            const maxAllowed = highestEvalPageNumberUsed(evalContents, idx) + 1;
            if (newVal > maxAllowed) {
                alert(`Page numbers can't skip ahead — page ${maxAllowed} is the next page available. Add at least one question or content block to page ${maxAllowed} before using page ${newVal}.`);
                e.target.value = evalContents[idx].page_number || 1;
                return;
            }

            evalContents[idx].page_number = newVal;
            e.target.value = newVal;
            renderEvalPageTitlesSummary();
        });
    });
    box.querySelectorAll('[data-remove-idx]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            evalContents.splice(Number(e.target.dataset.removeIdx), 1);
            renderEvalContentList();
            renderEvalPageTitlesSummary();
        });
    });
}

document.getElementById('addEvalContentBtn').addEventListener('click', () => {
    evalContents.push({ title: '', content: '', page_number: 1 });
    renderEvalContentList();
    renderEvalPageTitlesSummary();
});

// ============================================================================
// Page titles — a live summary of every page currently in use (across both
// questions and content blocks), each with a text input for a custom title
// shown as a heading at the top of that page on the public evaluation page.
// Recomputed whenever any page-number input changes, or a question/content
// block is added or removed.
// ============================================================================
function renderEvalPageTitlesSummary() {
    const box = document.getElementById('evalPageTitlesSummary');
    if (!box) return;

    const maxPage = highestEvalPageNumberUsed(null, null);
    const heading = `<p class="section-hint" style="margin:0 0 10px;">This evaluation has ${maxPage} page${maxPage === 1 ? '' : 's'}. Optionally give any page a title — it's shown as a heading at the top of that page when a participant takes the evaluation.</p>`;

    let rows = '';
    for (let p = 1; p <= maxPage; p++) {
        const val = (evalPageTitles[String(p)] || '');
        rows += `
            <div class="input-row" style="grid-template-columns: 100px 1fr; align-items:center; margin-bottom:8px;">
                <span style="font-size:13px; font-weight:700; color:#334155;">Page ${p}</span>
                <input type="text" class="eval-page-title-input" data-page="${p}" value="${val.replace(/"/g, '&quot;')}" placeholder="Optional page title">
            </div>
        `;
    }

    box.innerHTML = heading + rows;

    box.querySelectorAll('.eval-page-title-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const page = e.target.dataset.page;
            const val = e.target.value;
            if (val.trim()) {
                evalPageTitles[page] = val;
            } else {
                delete evalPageTitles[page];
            }
        });
    });
}

document.getElementById('evalThemeColor').addEventListener('input', (e) => {
    document.getElementById('evalThemeColorPreview').textContent = e.target.value.toUpperCase();
});

// ============================================================================
// Load the Activity picker — every course, newest activity date first, same
// as the course dropdowns elsewhere in the admin.
// ============================================================================
async function loadCourseOptions(selectedCourseId) {
    const { data: courses, error } = await client.from('courses').select('id, name, course_date').order('course_date', { ascending: false });
    const select = document.getElementById('evalCourseSelect');
    if (error) {
        select.innerHTML = '<option value="">-- Could not load activities --</option>';
        return;
    }
    select.innerHTML = '<option value="">-- Choose Activity --</option>' +
        (courses || []).map(c => `<option value="${c.id}" ${selectedCourseId && Number(selectedCourseId) === c.id ? 'selected' : ''}>${c.name} (🗓️ ${c.course_date || 'N/A'})</option>`).join('');
}

// ============================================================================
// Edit / Duplicate — both load an existing evaluation's questions, theme
// color and comment. Duplicate additionally leaves Title and Activity
// blank so the admin picks a fresh pair before saving, and never touches
// the id it copied from (a plain create, not an update).
// ============================================================================
async function loadEvaluationForEdit(id, isDuplicate) {
    const { data: evaluation, error } = await client.from('activity_evaluations').select('*').eq('id', id).maybeSingle();
    if (error || !evaluation) {
        alert('Could not load that evaluation.');
        window.location.href = 'evaluations-dashboard.html';
        return;
    }

    document.getElementById('formPanelTitle').textContent = isDuplicate ? 'Duplicate Evaluation / Exam' : 'Edit Evaluation / Exam';
    document.getElementById('evalThemeColor').value = evaluation.theme_color || '#7C3AED';
    document.getElementById('evalThemeColorPreview').textContent = (evaluation.theme_color || '#7C3AED').toUpperCase();
    document.getElementById('evalComment').value = evaluation.comment || '';
    evalPageTitles = (evaluation.page_titles && typeof evaluation.page_titles === 'object') ? { ...evaluation.page_titles } : {};

    if (isDuplicate) {
        // Title and Activity stay blank — the whole point of Duplicate is
        // reusing the questions for a DIFFERENT title/activity pair.
        document.getElementById('evalTitle').value = '';
        await loadCourseOptions(null);
    } else {
        document.getElementById('evalTitle').value = evaluation.title || '';
        await loadCourseOptions(evaluation.course_id);
    }

    const { data: existingQuestions } = await client.from('activity_evaluation_questions').select('*').eq('evaluation_id', id).order('display_order', { ascending: true });
    evalQuestions = (existingQuestions || []).map(q => ({
        // Duplicate copies the QUESTIONS, not their identity — omitting id
        // here means pushActivityContents-style save below inserts them as
        // brand new rows under the new evaluation, never touching the
        // source evaluation's own questions.
        id: isDuplicate ? undefined : q.id,
        question_type: q.question_type, question_text: q.question_text,
        options: Array.isArray(q.options) ? q.options : [],
        grid_rows: Array.isArray(q.grid_rows) ? q.grid_rows : [],
        grid_columns: Array.isArray(q.grid_columns) ? q.grid_columns : [],
        page_number: q.page_number || 1
    }));
    renderEvalQuestionsList();

    const { data: existingContents } = await client.from('activity_evaluation_contents').select('*').eq('evaluation_id', id).order('content_order', { ascending: true });
    evalContents = (existingContents || []).map(c => ({
        id: isDuplicate ? undefined : c.id,
        title: c.title || '',
        content: c.content || '',
        page_number: c.page_number || 1
    }));
    renderEvalContentList();
    renderEvalPageTitlesSummary();
}

// ============================================================================
// Save — a real sync, NOT delete-and-reinsert. It used to delete every
// question row for this evaluation and reinsert them fresh on every single
// save — including a save that only changed the evaluation's own Title and
// touched no question at all. Every submitted answer references its
// question by id with `on delete cascade` (sql/activity-evaluations.sql),
// so that blanket delete silently wiped every participant's submitted
// answers on ANY edit, not just a real question change.
//
// Now: a question the admin kept (`q.id` still set, even if its text/
// options were edited) is UPSERTED onto its own existing row, so its id —
// and every answer already submitted against it — survives. Only a
// question actually removed from the form gets deleted, which is the one
// case where cascading away its answers is correct. A brand-new question
// (no `q.id` yet) is inserted fresh, same as before.
// ============================================================================
async function pushEvalQuestions(evaluationId) {
    const rows = evalQuestions
        .filter(q => q.question_text.trim())
        .map((q, idx) => ({
            id: q.id,
            question_type: q.question_type,
            question_text: q.question_text.trim(),
            options: OPTION_BASED_TYPES.includes(q.question_type) ? q.options.filter(o => o.trim()) : [],
            grid_rows: GRID_TYPES.includes(q.question_type) ? q.grid_rows.filter(r => r.trim()) : [],
            grid_columns: GRID_TYPES.includes(q.question_type) ? q.grid_columns.filter(c => c.trim()) : [],
            display_order: idx,
            page_number: Math.max(1, q.page_number || 1)
        }));

    const keptRows = rows.filter(r => r.id != null);
    const newRows = rows.filter(r => r.id == null).map(({ id, ...rest }) => rest);
    const keptIds = keptRows.map(r => r.id);

    let deleteQuery = client.from('activity_evaluation_questions').delete().eq('evaluation_id', evaluationId);
    if (keptIds.length > 0) deleteQuery = deleteQuery.not('id', 'in', `(${keptIds.join(',')})`);
    await deleteQuery;

    if (keptRows.length > 0) {
        await client.from('activity_evaluation_questions')
            .upsert(keptRows.map(r => ({ ...r, evaluation_id: evaluationId })), { onConflict: 'id' });
    }
    if (newRows.length > 0) {
        await client.from('activity_evaluation_questions')
            .insert(newRows.map(r => ({ ...r, evaluation_id: evaluationId })));
    }
    return rows.length;
}

async function pushEvalContents(evaluationId) {
    await client.from('activity_evaluation_contents').delete().eq('evaluation_id', evaluationId);

    const rows = evalContents
        .filter(c => (c.content || '').trim())
        .map((c, idx) => ({
            evaluation_id: evaluationId,
            content_order: idx,
            title: (c.title || '').trim() || null,
            content: c.content.trim(),
            page_number: Math.max(1, c.page_number || 1)
        }));

    if (rows.length > 0) {
        await client.from('activity_evaluation_contents').insert(rows);
    }
}

async function handleFormSubmission(e) {
    e.preventDefault();

    const title = document.getElementById('evalTitle').value.trim();
    const course_id = Number(document.getElementById('evalCourseSelect').value) || null;
    const theme_color = document.getElementById('evalThemeColor').value || '#7C3AED';
    const comment = document.getElementById('evalComment').value.trim() || null;

    if (!title) { alert('Please enter a title.'); return; }
    if (!course_id) { alert('Please choose the Activity this evaluation belongs to.'); return; }

    const questionsWithText = evalQuestions.filter(q => q.question_text.trim());
    if (questionsWithText.length === 0) {
        document.getElementById('evalQuestionsRequiredHint').classList.remove('hidden-element');
        document.getElementById('evalQuestionsRequiredHint').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    document.getElementById('evalQuestionsRequiredHint').classList.add('hidden-element');

    // Defensive re-check right before saving — the page input's own change
    // handler already blocks a skipped page as it's typed, but this catches
    // any stale UI state. Spans both questions and page-content blocks.
    if (!validateNoEvalPageGaps()) {
        alert("Page numbers must be sequential with no gaps — make sure page 1, then page 2, and so on are each used (by a question or a content block) before assigning the next page number.");
        return;
    }

    // Only keep titles for pages that will actually exist after saving.
    const maxSavedPage = Math.max(1, ...[
        ...evalQuestions.filter(q => q.question_text.trim()).map(q => q.page_number || 1),
        ...evalContents.filter(c => (c.content || '').trim()).map(c => c.page_number || 1)
    ]);
    const page_titles = {};
    Object.keys(evalPageTitles).forEach(k => {
        const p = Number(k);
        if (Number.isInteger(p) && p >= 1 && p <= maxSavedPage && (evalPageTitles[k] || '').trim()) {
            page_titles[k] = evalPageTitles[k].trim();
        }
    });

    const submitBtn = document.getElementById('submitEvalFormBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = editingEvaluationId ? 'Updating…' : 'Saving…';

    try {
        if (editingEvaluationId) {
            const { error: updErr } = await client.from('activity_evaluations').update({
                title, course_id, theme_color, comment, page_titles
            }).eq('id', editingEvaluationId);
            if (updErr) { alert('Could not update: ' + updErr.message); return; }

            await pushEvalQuestions(editingEvaluationId);
            await pushEvalContents(editingEvaluationId);
            alert('Evaluation updated successfully.');
            window.location.href = 'evaluations-dashboard.html';
        } else {
            // A Duplicate is just a Create with no editingEvaluationId set —
            // duplicateSourceId only mattered for loading the starting
            // questions/theme/comment above, never for what gets saved.
            const public_slug = Math.random().toString(36).slice(2, 10);
            const { data: newEvaluation, error: insErr } = await client.from('activity_evaluations').insert({
                title, course_id, theme_color, comment, public_slug, page_titles
            }).select().single();
            if (insErr) { alert('Could not create: ' + insErr.message); return; }

            await pushEvalQuestions(newEvaluation.id);
            await pushEvalContents(newEvaluation.id);
            alert('Evaluation created successfully.');
            window.location.href = 'evaluations-dashboard.html';
        }
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save';
    }
}

document.getElementById('evaluationForm').addEventListener('submit', handleFormSubmission);

(async function init() {
    const params = new URLSearchParams(window.location.search);
    const editId = params.get('edit_id');
    const duplicateId = params.get('duplicate_id');

    if (editId) {
        editingEvaluationId = Number(editId);
        await loadEvaluationForEdit(editingEvaluationId, false);
    } else if (duplicateId) {
        duplicateSourceId = Number(duplicateId);
        await loadEvaluationForEdit(duplicateSourceId, true);
    } else {
        await loadCourseOptions(null);
        renderEvalQuestionsList();
        renderEvalContentList();
        renderEvalPageTitlesSummary();
    }
})();
