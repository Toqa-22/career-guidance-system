import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const params = new URLSearchParams(window.location.search);
const publicSlug = params.get('e');
// Set from the evaluations dashboard's "Open" link (see js/evaluations-dashboard.js)
// — shows the form exactly as a participant would see it, with no staff
// number gate and nothing ever recorded, purely so an admin can check how
// it looks. See showPreviewBanner()/previewMode checks below.
const previewMode = params.get('preview') === '1';

let evaluation = null;
let evalQuestionsCache = [];
let evalContentsCache = [];
let matchedRegistration = null; // { id, staff_name } — the registrations row this staff number resolved to
let verifiedStaffNumber = null;

// Same small HSL helpers as js/workshops.js's shadeColor/hexToHsl/hslToHex —
// duplicated here (rather than imported) since this is a separate entry
// page with its own bundle. Used to build a real light-to-dark gradient
// from the activity's one theme color, e.g. for .reg-page-heading-banner.
function hexToHsl(hex) {
    hex = (hex || '').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) {
        h = s = 0;
    } else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            default: h = (r - g) / d + 4;
        }
        h /= 6;
    }
    return { h: h * 360, s: s * 100, l: l * 100 };
}
function hslToHex(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    const toHex = v => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
function shadeColor(hex, lightnessDeltaPct) {
    const hsl = hexToHsl(hex);
    if (!hsl) return hex;
    const l = Math.min(96, Math.max(6, hsl.l + lightnessDeltaPct));
    return hslToHex(hsl.h, hsl.s, l);
}

function applyEvalTheme(rawColor) {
    const base = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(rawColor || '') ? rawColor : '#7C3AED';
    const root = document.documentElement.style;
    root.setProperty('--course-theme', base);
    root.setProperty('--course-theme-light', shadeColor(base, 16));
    root.setProperty('--course-theme-dark', shadeColor(base, -16));
    // Same fade-in pattern register.html uses (see "theme-loading" in
    // css/workshops.css) — hides the default-purple-then-real-color flash.
    document.body.classList.remove('theme-loading');
}

function showFatalError(message) {
    document.getElementById('evalFatalError').textContent = message;
    document.getElementById('evalFatalError').classList.remove('hidden-element');
    document.getElementById('evalStaffGateWrapper').classList.add('hidden-element');
}

async function init() {
    if (!publicSlug) {
        showFatalError('This evaluation link is invalid or incomplete.');
        return;
    }

    const { data, error } = await client
        .from('activity_evaluations')
        .select('*, courses(name)')
        .eq('public_slug', publicSlug)
        .maybeSingle();

    if (error || !data) {
        showFatalError('This evaluation link could not be found. Please check the link and try again.');
        return;
    }

    evaluation = data;
    document.getElementById('evalPageTitle').textContent = evaluation.title;
    document.getElementById('evalPageActivity').textContent = evaluation.courses?.name || 'Evaluation / Exam';
    applyEvalTheme(evaluation.theme_color);

    if (evaluation.comment && evaluation.comment.trim()) {
        const commentEl = document.getElementById('evalComment');
        commentEl.textContent = evaluation.comment;
        commentEl.classList.remove('hidden-element');
    }

    const [{ data: questions }, { data: contents }] = await Promise.all([
        client.from('activity_evaluation_questions').select('*').eq('evaluation_id', evaluation.id).order('display_order', { ascending: true }),
        client.from('activity_evaluation_contents').select('*').eq('evaluation_id', evaluation.id).order('content_order', { ascending: true })
    ]);
    evalQuestionsCache = questions || [];
    evalContentsCache = contents || [];

    // Admin preview (from the evaluations dashboard's "Open" link) — skip
    // the staff number gate entirely and just show the form as a
    // participant would see it, page by page. Nothing here is ever
    // submitted (see the evalSubmitBtn handler below) and Next isn't
    // blocked by unanswered questions, since there's no real participant
    // filling anything in.
    if (previewMode) {
        showPreviewBanner();
        document.getElementById('evalStaffGateWrapper').classList.add('hidden-element');

        if (evalQuestionsCache.length === 0) {
            document.getElementById('evalAlreadyDoneNotice').textContent = 'This evaluation currently has no questions yet.';
            document.getElementById('evalAlreadyDoneNotice').classList.remove('hidden-element');
            return;
        }

        renderEvalQuestions();
        document.getElementById('evalQuestionsWrapper').classList.remove('hidden-element');
        evalPageSegments = buildEvalPageSegments(evalContentsCache, evalQuestionsCache);
        goToEvalPage(0);
        return;
    }

    // Opened from the certificate page's "Complete <requirement>" button
    // (see the pendingRequirementBtn click handler in js/certificate-public.js),
    // which already knows the participant's verified staff number and
    // passes it along as ?s= — skip making them re-type it here and verify
    // straight away. Falls back to the normal manual staff-number step for
    // a plain evaluation link with no ?s= (e.g. shared directly).
    const carriedStaffNumber = params.get('s');
    if (carriedStaffNumber) {
        document.getElementById('evalStaffNumberInput').value = carriedStaffNumber;
        verifyStaffNumberAndProceed(carriedStaffNumber);
    }
}

// Banner shown only in previewMode, right above the course card, making it
// obvious this is a look-only view — no staff number needed, nothing typed
// here is ever recorded.
function showPreviewBanner() {
    const banner = document.createElement('div');
    banner.style.cssText = 'max-width:600px; margin:0 auto 16px; padding:12px 18px; background:#EFF6FF; border:1px solid #BFDBFE; color:#1E40AF; border-radius:12px; font-weight:700; font-size:13.5px; text-align:center;';
    banner.textContent = '👁 Preview only — this is how the form looks to participants. Nothing here is submitted or recorded.';
    const container = document.querySelector('.container');
    if (container) container.insertBefore(banner, container.firstChild);
}

// ============================================================================
// Question rendering / answer collection — same markup, CSS classes, and
// response_value shape as the registration form's Custom Questions
// (js/workshops.js renderCustomQuestionsForRegistration / collectCustomQuestionAnswers),
// reused here so it looks and behaves identically. The one difference:
// every question here is REQUIRED — see validateAllAnswered() below.
// ============================================================================
function renderEvalQuestions() {
    const box = document.getElementById('evalQuestionsContainer');
    box.innerHTML = evalQuestionsCache.map((q, index) => {
        const options = Array.isArray(q.options) ? q.options : [];
        const gridRows = Array.isArray(q.grid_rows) ? q.grid_rows : [];
        const gridCols = Array.isArray(q.grid_columns) ? q.grid_columns : [];
        let fieldHtml = '';

        if (q.question_type === 'text') {
            fieldHtml = `<input type="text" class="cq-answer-input" data-qid="${q.id}">`;
        } else if (q.question_type === 'date') {
            fieldHtml = `<input type="date" class="cq-answer-input" data-qid="${q.id}">`;
        } else if (q.question_type === 'time') {
            fieldHtml = `<input type="time" class="cq-answer-input" data-qid="${q.id}">`;
        } else if (q.question_type === 'list') {
            fieldHtml = `<select class="cq-answer-input" data-qid="${q.id}">
                <option value="">-- Select --</option>
                ${options.map(o => `<option value="${o}">${o}</option>`).join('')}
            </select>`;
        } else if (q.question_type === 'multiple_choice') {
            fieldHtml = options.map(o => `
                <label class="cq-choice-label">
                    <input type="radio" name="cq_${q.id}" class="cq-answer-radio" data-qid="${q.id}" value="${o}">
                    ${o}
                </label>`).join('');
        } else if (q.question_type === 'checkbox') {
            fieldHtml = options.map(o => `
                <label class="cq-choice-label">
                    <input type="checkbox" class="cq-answer-checkbox" data-qid="${q.id}" value="${o}">
                    ${o}
                </label>`).join('');
        } else if (q.question_type === 'multiple_choice_grid' || q.question_type === 'checkbox_grid') {
            const inputType = q.question_type === 'multiple_choice_grid' ? 'radio' : 'checkbox';
            fieldHtml = `
                <div class="cq-grid-scroll-wrapper">
                <table class="cq-grid-table">
                    <thead><tr><th></th>${gridCols.map(c => `<th>${c}</th>`).join('')}</tr></thead>
                    <tbody>
                        ${gridRows.map(row => `
                            <tr>
                                <td class="cq-grid-row-label">${row}</td>
                                ${gridCols.map(col => `
                                    <td><input type="${inputType}" name="cq_${q.id}_${row}" class="cq-answer-grid" data-qid="${q.id}" data-row="${row}" value="${col}"></td>
                                `).join('')}
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                </div>`;
        }

        const isInlineType = ['text', 'date', 'time', 'list'].includes(q.question_type);

        // Wrapped in its own step div, hidden by default — each page's
        // content blocks are shown before that page's questions (see
        // buildEvalPageSegments), so each question needs to be individually
        // revealable as the participant steps through. An evaluation with no
        // content blocks reveals a page's questions all at once, same as
        // before.
        return `
            <div id="evalQStepWrapper_${index}" class="hidden-element">
                <div class="cq-registration-field${isInlineType ? ' cq-inline-field' : ''}">
                    <label class="cq-question-text"><span class="cq-question-number">${index + 1}</span>${q.question_text} <span style="color:#dc2626;">*</span></label>
                    ${fieldHtml}
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================================
// Step-through — same idea as the Registration Form's (js/workshops.js
// buildRegistrationPaging/revealRegistrationPage): questions are grouped by
// page_number (defaulting to 1) into ordered segments, each walked as a
// list of steps that reveal plain sections instantly and pause at a batch
// of Content cards until Continue is clicked. Once a page's segment is
// fully revealed, Previous/Next move between pages — Next only appears
// once the current page's segment (including any content batches) has
// finished; Submit only appears on the last page. An evaluation whose
// questions are all on page 1 (or that has none) behaves exactly as
// before — one segment, no page nav shown.
// ============================================================================
let evalPageSegments = [[]]; // array of pages, each an ordered list of steps
let evalPageIdx = 0;
let evalStepIndex = 0; // index within the current page's segment
let evalBatchIndex = 0;

function buildEvalPageSegments(contents, questions) {
    const maxPage = Math.max(
        questions.reduce((max, q) => Math.max(max, q.page_number || 1), 1),
        (contents || []).reduce((max, c) => Math.max(max, c.page_number || 1), 1)
    );
    const segments = [];
    for (let p = 1; p <= maxPage; p++) {
        const steps = [];
        const pageContents = (contents || []).filter(c => (c.page_number || 1) === p);
        // Content blocks for this page are shown first, before that page's
        // questions — same ordering convention as Create Activity's version.
        if (pageContents.length) steps.push({ type: 'content_batch', items: pageContents });
        for (let k = 0; k < questions.length; k++) {
            if ((questions[k].page_number || 1) !== p) continue;
            steps.push({ type: 'question', index: k });
        }
        segments.push(steps);
    }
    return segments.length > 0 ? segments : [[]];
}

function advanceEvalPageSteps() {
    const steps = evalPageSegments[evalPageIdx] || [];
    while (evalStepIndex < steps.length) {
        const step = steps[evalStepIndex];
        if (step.type === 'content_batch') {
            evalBatchIndex = 0;
            showEvalContentBatch(step.items);
            return; // paused — waits for Continue
        }
        if (step.type === 'question') {
            const el = document.getElementById('evalQStepWrapper_' + step.index);
            if (el) el.classList.remove('hidden-element');
        }
        evalStepIndex++;
    }
    // Reached the end of this page's own steps — show the page nav
    // (Previous/Next) or, on the last page, the Submit button.
    updateEvalPageNav();
}

// Checks only the questions belonging to the CURRENT page (evalPageIdx) —
// same per-type rules as collectAndValidateAnswers() above, but scoped so
// Next can be blocked one page at a time instead of only at final Submit.
// Returns an array of 1-based question numbers (within the whole
// evaluation) that are still unanswered on this page; empty means OK to
// advance.
function validateCurrentEvalPage() {
    const missing = [];
    evalQuestionsCache.forEach((q, index) => {
        if ((q.page_number || 1) !== (evalPageIdx + 1)) return;
        if (q.question_type === 'text' || q.question_type === 'date' || q.question_type === 'time' || q.question_type === 'list') {
            const input = document.querySelector(`.cq-answer-input[data-qid="${q.id}"]`);
            if (!input || !input.value) missing.push(index + 1);
        } else if (q.question_type === 'multiple_choice') {
            const checked = document.querySelector(`.cq-answer-radio[data-qid="${q.id}"]:checked`);
            if (!checked) missing.push(index + 1);
        } else if (q.question_type === 'checkbox') {
            const checked = document.querySelectorAll(`.cq-answer-checkbox[data-qid="${q.id}"]:checked`);
            if (checked.length === 0) missing.push(index + 1);
        } else if (q.question_type === 'multiple_choice_grid' || q.question_type === 'checkbox_grid') {
            const rowMap = {};
            document.querySelectorAll(`.cq-answer-grid[data-qid="${q.id}"]:checked`).forEach(el => {
                rowMap[el.dataset.row] = true;
            });
            const totalRows = Array.isArray(q.grid_rows) ? q.grid_rows.length : 0;
            if (totalRows === 0 || Object.keys(rowMap).length < totalRows) missing.push(index + 1);
        }
    });
    return missing;
}

function updateEvalPageNav() {
    const nav = document.getElementById('evalPageNavContainer');
    const prevBtn = document.getElementById('evalPagePrevBtn');
    const nextBtn = document.getElementById('evalPageNextBtn');
    const submitBtn = document.getElementById('evalSubmitBtn');
    const isLast = evalPageIdx === evalPageSegments.length - 1;

    if (evalPageSegments.length <= 1) {
        // Everything on one page — no nav needed, Submit shows right away
        // exactly as before paging existed.
        if (nav) nav.classList.add('hidden-element');
        submitBtn.classList.remove('hidden-element');
        return;
    }

    prevBtn.classList.toggle('hidden-element', evalPageIdx === 0);
    nextBtn.classList.toggle('hidden-element', isLast);
    submitBtn.classList.toggle('hidden-element', !isLast);
    if (nav) nav.classList.remove('hidden-element');

    prevBtn.onclick = () => {
        if (evalPageIdx === 0) return;
        goToEvalPage(evalPageIdx - 1);
    };
    nextBtn.onclick = () => {
        if (evalPageIdx >= evalPageSegments.length - 1) return;
        // Nothing to validate in preview mode — there's no real participant
        // answering, so Next just walks through the pages freely.
        if (!previewMode) {
            const missing = validateCurrentEvalPage();
            if (missing.length > 0) {
                alert(`Please answer question${missing.length > 1 ? 's' : ''} ${missing.join(', ')} before continuing.`);
                return;
            }
        }
        goToEvalPage(evalPageIdx + 1);
    };
}

// Hides every question wrapper first, then walks the target page's own
// segment from scratch — only that page's questions end up revealed.
// Answers already typed on other pages are untouched (hiding a wrapper
// never clears the inputs inside it).
function goToEvalPage(pageIdx) {
    document.querySelectorAll('[id^="evalQStepWrapper_"]').forEach(el => el.classList.add('hidden-element'));
    evalPageIdx = pageIdx;
    evalStepIndex = 0;
    updateEvalPageHeading();
    advanceEvalPageSteps();
}

// Shows this page's custom title (activity_evaluations.page_titles, keyed
// by page number as a string) as a heading at the top of the page, if one
// was set — hidden entirely otherwise.
function updateEvalPageHeading() {
    const headingEl = document.getElementById('evalPageHeading');
    const wrapperEl = document.getElementById('evalPageHeadingWrapper') || headingEl;
    if (!headingEl || !wrapperEl) return;
    const pageTitles = (evaluation && evaluation.page_titles && typeof evaluation.page_titles === 'object') ? evaluation.page_titles : {};
    const title = pageTitles[String(evalPageIdx + 1)];
    if (title && title.trim()) {
        headingEl.textContent = title;
        wrapperEl.classList.remove('hidden-element');
    } else {
        headingEl.textContent = '';
        wrapperEl.classList.add('hidden-element');
    }
}

function showEvalContentBatch(items) {
    const viewer = document.getElementById('evalContentViewer');
    const total = items.length;
    const current = items[evalBatchIndex];

    document.getElementById('evalContentIndicator').textContent = `Content ${evalBatchIndex + 1} of ${total}`;

    const titleEl = document.getElementById('evalContentTitle');
    const hasTitle = !!(current.title && current.title.trim());
    titleEl.textContent = hasTitle ? current.title : '';
    titleEl.classList.toggle('hidden-element', !hasTitle);

    document.getElementById('evalContentBody').textContent = current.content || '';

    const prevBtn = document.getElementById('evalContentPrevBtn');
    const nextBtn = document.getElementById('evalContentNextBtn');
    const continueBtn = document.getElementById('evalContentContinueBtn');
    const isLast = evalBatchIndex === total - 1;

    prevBtn.classList.toggle('hidden-element', evalBatchIndex === 0);
    nextBtn.classList.toggle('hidden-element', isLast);
    continueBtn.classList.toggle('hidden-element', !isLast);

    prevBtn.onclick = () => {
        if (evalBatchIndex === 0) return;
        evalBatchIndex--;
        showEvalContentBatch(items);
    };
    nextBtn.onclick = () => {
        if (evalBatchIndex >= total - 1) return;
        evalBatchIndex++;
        showEvalContentBatch(items);
    };
    continueBtn.onclick = () => {
        viewer.classList.add('hidden-element');
        evalStepIndex++;
        advanceEvalPageSteps();
    };

    viewer.classList.remove('hidden-element');
}

// Every question must be answered — unlike the optional Custom Questions on
// registration, this exam/evaluation has no optional ones. Returns null (and
// leaves the error box showing) if anything is missing, otherwise the array
// of { question_id, response_value } rows ready to insert.
function collectAndValidateAnswers() {
    const answers = [];
    const missing = [];

    evalQuestionsCache.forEach((q, index) => {
        if (q.question_type === 'text' || q.question_type === 'date' || q.question_type === 'time' || q.question_type === 'list') {
            const input = document.querySelector(`.cq-answer-input[data-qid="${q.id}"]`);
            if (input && input.value) {
                answers.push({ question_id: q.id, answer_value: input.value });
            } else {
                missing.push(index + 1);
            }
        } else if (q.question_type === 'multiple_choice') {
            const checked = document.querySelector(`.cq-answer-radio[data-qid="${q.id}"]:checked`);
            if (checked) {
                answers.push({ question_id: q.id, answer_value: checked.value });
            } else {
                missing.push(index + 1);
            }
        } else if (q.question_type === 'checkbox') {
            const checked = Array.from(document.querySelectorAll(`.cq-answer-checkbox[data-qid="${q.id}"]:checked`)).map(el => el.value);
            if (checked.length > 0) {
                answers.push({ question_id: q.id, answer_value: checked });
            } else {
                missing.push(index + 1);
            }
        } else if (q.question_type === 'multiple_choice_grid' || q.question_type === 'checkbox_grid') {
            const rowMap = {};
            document.querySelectorAll(`.cq-answer-grid[data-qid="${q.id}"]:checked`).forEach(el => {
                const row = el.dataset.row;
                if (q.question_type === 'checkbox_grid') {
                    if (!rowMap[row]) rowMap[row] = [];
                    rowMap[row].push(el.value);
                } else {
                    rowMap[row] = el.value;
                }
            });
            // Every row of the grid needs an answer, not just one — a
            // partially-filled grid is still an unanswered question.
            if (Object.keys(rowMap).length >= (Array.isArray(q.grid_rows) ? q.grid_rows.length : 0) && Object.keys(rowMap).length > 0) {
                answers.push({ question_id: q.id, answer_value: rowMap });
            } else {
                missing.push(index + 1);
            }
        }
    });

    const errorBox = document.getElementById('evalSubmitError');
    if (missing.length > 0) {
        errorBox.textContent = `Please answer question${missing.length > 1 ? 's' : ''} ${missing.join(', ')} before submitting.`;
        errorBox.classList.remove('hidden-element');
        return null;
    }
    errorBox.classList.add('hidden-element');
    return answers;
}

document.getElementById('evalStaffGateContinueBtn').addEventListener('click', () => {
    verifyStaffNumberAndProceed(document.getElementById('evalStaffNumberInput').value.trim());
});

// Pulled out of the button's click handler so it can also run automatically
// when this evaluation was opened from the certificate page's "Complete
// <requirement>" button (see carriedStaffNumber in init() below) — the
// participant already typed their staff number there once, so there's no
// reason to make them type it again here.
async function verifyStaffNumberAndProceed(raw) {
    const messageBox = document.getElementById('evalStaffGateMessage');
    messageBox.classList.add('hidden-element');

    if (!raw) {
        messageBox.textContent = 'Please enter your staff number.';
        messageBox.classList.remove('hidden-element');
        return;
    }
    if (!evaluation) return;

    const btn = document.getElementById('evalStaffGateContinueBtn');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Checking…';

    try {
        // Only someone registered for the linked Activity can take its
        // evaluation — same lookup shape used for certificates
        // (check-registration), done directly here since register.html's
        // own Staff Number step already queries registrations/participants
        // straight from the client the same way.
        const { data: registration } = await client
            .from('registrations')
            .select('id, staff_name')
            .eq('course_id', evaluation.course_id)
            .ilike('staff_number', raw)
            .maybeSingle();

        if (!registration) {
            messageBox.innerHTML = 'Staff number not found.<br><br>This staff number is not registered for the Activity this evaluation belongs to. Please use the same staff number you used during registration.';
            messageBox.classList.remove('hidden-element');
            return;
        }

        const { data: existingResponse } = await client
            .from('activity_evaluation_responses')
            .select('id')
            .eq('evaluation_id', evaluation.id)
            .ilike('staff_number', raw)
            .maybeSingle();

        matchedRegistration = registration;
        verifiedStaffNumber = raw;

        document.getElementById('evalStaffGateWrapper').classList.add('hidden-element');

        if (existingResponse) {
            document.getElementById('evalAlreadyDoneNotice').classList.remove('hidden-element');
            return;
        }

        if (evalQuestionsCache.length === 0) {
            // No questions saved for this evaluation — nothing to answer.
            // Rather than show a blank form, treat it the same as already
            // complete so the link never dead-ends.
            document.getElementById('evalAlreadyDoneNotice').textContent = 'This evaluation currently has no questions. Please check back later or contact the training team.';
            document.getElementById('evalAlreadyDoneNotice').classList.remove('hidden-element');
            return;
        }

        renderEvalQuestions();
        document.getElementById('evalQuestionsWrapper').classList.remove('hidden-element');
        evalPageSegments = buildEvalPageSegments(evalContentsCache, evalQuestionsCache);
        goToEvalPage(0);
    } catch (err) {
        messageBox.textContent = 'Something went wrong checking your registration. Please try again.';
        messageBox.classList.remove('hidden-element');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

document.getElementById('evalSubmitBtn').addEventListener('click', async () => {
    if (previewMode) {
        alert("This is preview mode — nothing is submitted or recorded here.");
        return;
    }
    if (!evaluation || !matchedRegistration || !verifiedStaffNumber) return;

    const answers = collectAndValidateAnswers();
    if (!answers) return;

    const btn = document.getElementById('evalSubmitBtn');
    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = 'Submitting…';

    try {
        const { data: response, error: respErr } = await client
            .from('activity_evaluation_responses')
            .insert({
                evaluation_id: evaluation.id,
                course_id: evaluation.course_id,
                registration_id: matchedRegistration.id,
                staff_number: verifiedStaffNumber,
                staff_name: matchedRegistration.staff_name || null
            })
            .select()
            .single();

        if (respErr) {
            // The unique index (one response per staff number per
            // evaluation) is the real backstop against a double-submit
            // from two near-simultaneous requests — surfaced here as a
            // friendly message rather than a raw constraint error.
            if (respErr.code === '23505') {
                document.getElementById('evalQuestionsWrapper').classList.add('hidden-element');
                document.getElementById('evalAlreadyDoneNotice').classList.remove('hidden-element');
                return;
            }
            document.getElementById('evalSubmitError').textContent = 'Could not submit: ' + respErr.message;
            document.getElementById('evalSubmitError').classList.remove('hidden-element');
            return;
        }

        const answerRows = answers.map(a => ({
            response_id: response.id,
            question_id: a.question_id,
            answer_value: a.answer_value
        }));
        const { error: answersErr } = await client.from('activity_evaluation_answers').insert(answerRows);

        if (answersErr) {
            // This insert can fail even though the response row above was
            // created fine — most likely because the participant had this
            // page open while the admin edited/removed a question in the
            // meantime, so a question_id their browser cached no longer
            // matches a real row (foreign key violation). Previously this
            // was never checked: the response row was left behind with zero
            // answers, and the participant still saw the success screen —
            // silent, total data loss for that submission with no visible
            // sign anything went wrong.
            //
            // Now: delete the now-answerless response row (so the unique
            // one-response-per-staff-number index doesn't block a retry),
            // and tell the participant plainly to submit again — reloading
            // first so they get the current, correct set of questions.
            await client.from('activity_evaluation_responses').delete().eq('id', response.id);
            document.getElementById('evalSubmitError').textContent = 'Something changed with this evaluation while you were filling it in, so your answers could not be saved. Please reload this page and submit again.';
            document.getElementById('evalSubmitError').classList.remove('hidden-element');
            return;
        }

        document.getElementById('evalQuestionsWrapper').classList.add('hidden-element');
        document.getElementById('evalSuccessOverlay').classList.remove('hidden-element');
    } catch (err) {
        document.getElementById('evalSubmitError').textContent = 'Something went wrong submitting your answers. Please try again.';
        document.getElementById('evalSubmitError').classList.remove('hidden-element');
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
});

// Closes the tab this evaluation link opened in. window.close() only works
// on a tab the page itself opened/navigated (most browsers silently ignore
// it on a tab the person opened by hand, e.g. pasting the link directly) —
// there's no way to detect that in advance, so this is a best-effort close:
// when the browser allows it the tab disappears; when it doesn't, the modal
// is dismissed instead so the person isn't stuck looking at it either way.
document.getElementById('evalSuccessCloseBtn')?.addEventListener('click', () => {
    window.close();
    document.getElementById('evalSuccessOverlay').classList.add('hidden-element');
});

init();
