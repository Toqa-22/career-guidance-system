import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

        const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        let editingCourseId = null;
        let globalInstitutionsList = [];

        // Featured image: holds a freshly-picked File pending upload on save,
        // and the already-saved public URL (when editing / unchanged).
        let pendingCourseImageFile = null;
        let existingCourseImageUrl = null;

        // ====================================================================
        // Custom Questions (optional) — 8 question types, added/edited here,
        // saved to course_questions on submit, rendered dynamically on the
        // registration page.
        // ====================================================================
        let customQuestions = []; // [{ id?, question_type, question_text, options: [], grid_rows: [], grid_columns: [], page_number }]

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

        // ====================================================================
        // Page numbers (replaces the old Activity Content anchor system) —
        // now spans every numberable item in this form, not just Custom
        // Questions: each of the 8 targeting fields (Section 2), the whole
        // Required Documents section (Section 3), the whole Institutional
        // Allocations section (Section 4), each Custom Question (Section 6),
        // and each Page Content block (Section 7) carries its own "Page"
        // number, defaulting to 1. Pages must be used sequentially across
        // ALL of these together: nothing can jump to page N+2 while page
        // N+1 is unused anywhere, so the public registration form never has
        // a gap to skip over. Every one of these inputs shares the
        // .page-number-input class specifically so the two functions below
        // can scan them all at once regardless of which section they live
        // in — see also renderPageTitlesSummary(), which uses the same
        // "highest value currently set" scan to show one title box per page
        // in use.
        // ====================================================================
        // The registrant's own fixed identity fields (Full Name, Staff
        // Number, Gender, Designation, Current Post, Phone Number,
        // Department) used to always show on page 1 of the registration
        // form and stay visible on every later page too — which is exactly
        // why a multi-page activity looked "messy": every page repeated the
        // same identity fields alongside whatever was actually configured
        // for that page. Each one is now page-configurable too, same as the
        // 8 targeting fields, via these small inputs in Section 1 (Basic
        // Course Information) — see .identity-page-input in
        // create-course.html. Keys match courses.section_pages and what
        // js/workshops.js's revealRegistrationPage() reads.
        const IDENTITY_PAGE_FIELDS = [
            { key: 'name', id: 'namePageInput' },
            { key: 'staff_number', id: 'staffNumberPageInput' },
            { key: 'gender', id: 'genderPageInput' },
            { key: 'designation', id: 'designationPageInput' },
            { key: 'specialization', id: 'specializationPageInput' },
            { key: 'phone', id: 'phonePageInput' },
            { key: 'department', id: 'departmentPageInput' }
        ];

        function highestPageNumberUsedAnywhere(excludeEl) {
            let max = 1;
            document.querySelectorAll('.page-number-input').forEach(el => {
                if (el === excludeEl) return;
                const v = parseInt(el.value, 10);
                if (Number.isFinite(v)) max = Math.max(max, v);
            });
            return max;
        }

        // Final defensive check, run right before saving — catches a stale
        // UI state or anything that slipped past an input's own change
        // handler. The set of pages actually in use must be exactly 1..N
        // with nothing skipped. Custom Questions and Page Content blocks
        // only count when they have real content (same filter their own
        // push* functions apply when saving) — a still-blank one shouldn't
        // force a page to "exist". The 8 targeting fields and the Required
        // Documents / Institutional Allocations sections always count,
        // since they always exist on every activity.
        function validateNoPageGapsAnywhere() {
            const pagesInUse = new Set([1]);

            customQuestions
                .filter(q => (q.question_text || '').trim())
                .forEach(q => pagesInUse.add(q.page_number || 1));
            pageContentBlocks
                .filter(b => (b.content || '').trim())
                .forEach(b => pagesInUse.add(b.page_number || 1));

            TARGETING_FIELDS.forEach(field => {
                const input = document.querySelector(`.targeting-page-input[data-field="${field.key}"]`);
                pagesInUse.add(input ? (parseInt(input.value, 10) || 1) : 1);
            });
            const docsInput = document.getElementById('documentsPageInput');
            pagesInUse.add(docsInput ? (parseInt(docsInput.value, 10) || 1) : 1);
            const allocInput = document.getElementById('allocationsPageInput');
            pagesInUse.add(allocInput ? (parseInt(allocInput.value, 10) || 1) : 1);
            IDENTITY_PAGE_FIELDS.forEach(field => {
                const input = document.getElementById(field.id);
                pagesInUse.add(input ? (parseInt(input.value, 10) || 1) : 1);
            });

            const pages = Array.from(pagesInUse).sort((a, b) => a - b);
            for (let i = 0; i < pages.length; i++) {
                if (pages[i] !== i + 1) return false;
            }
            return true;
        }

        // Live-computed "This activity has N page(s)" summary at the end of
        // the form — one title input per page number currently in use
        // anywhere (Section 8). Recomputed any time a page-number input
        // changes, or a question/content block is added/removed, so a
        // freshly-added page 2 immediately gets its own title box.
        let pageTitlesMap = {}; // { "1": "Getting Started", "2": "..." } — string keys, since these end up as courses.page_titles JSON keys
        function renderPageTitlesSummary() {
            const highest = highestPageNumberUsedAnywhere(null);
            const hint = document.getElementById('pageTitlesSummaryHint');
            if (hint) hint.textContent = `This activity has ${highest} page${highest === 1 ? '' : 's'}.`;

            const container = document.getElementById('pageTitlesContainer');
            if (!container) return;
            let html = '';
            for (let p = 1; p <= highest; p++) {
                const val = (pageTitlesMap[String(p)] || '').replace(/"/g, '&quot;');
                html += `
                    <div class="page-title-row">
                        <label>Page ${p} Title</label>
                        <input type="text" class="page-title-input" data-page="${p}" placeholder="(optional — shown as a heading at the top of this page)" value="${val}">
                    </div>
                `;
            }
            container.innerHTML = html;
            container.querySelectorAll('.page-title-input').forEach(input => {
                input.addEventListener('input', (e) => {
                    pageTitlesMap[e.target.getAttribute('data-page')] = e.target.value;
                });
            });
        }

        // Wires a single, static (not re-rendered) "Page" number input —
        // Required Documents' and Institutional Allocations' whole-section
        // page numbers — with the same skip-ahead guard as every other
        // page-number input.
        function wirePlainSectionPageInput(id) {
            const input = document.getElementById(id);
            if (!input) return;
            input.dataset.prevValue = input.value || '1';
            input.addEventListener('change', (e) => {
                let newVal = parseInt(e.target.value, 10);
                if (!Number.isFinite(newVal) || newVal < 1) newVal = 1;
                const maxAllowed = highestPageNumberUsedAnywhere(e.target) + 1;
                if (newVal > maxAllowed) {
                    alert(`Page numbers can't skip ahead — page ${maxAllowed} is the next page available. Add at least one item to page ${maxAllowed} before using page ${newVal}.`);
                    e.target.value = e.target.dataset.prevValue || 1;
                    return;
                }
                e.target.value = newVal;
                e.target.dataset.prevValue = newVal;
                renderPageTitlesSummary();
            });
        }

        function collectSectionPages() {
            const sp = {};
            TARGETING_FIELDS.forEach(field => {
                const input = document.querySelector(`.targeting-page-input[data-field="${field.key}"]`);
                const v = input ? parseInt(input.value, 10) : 1;
                sp[field.key] = (Number.isFinite(v) && v >= 1) ? v : 1;
            });
            const docsInput = document.getElementById('documentsPageInput');
            const docsV = docsInput ? parseInt(docsInput.value, 10) : 1;
            sp.documents = (Number.isFinite(docsV) && docsV >= 1) ? docsV : 1;
            const allocInput = document.getElementById('allocationsPageInput');
            const allocV = allocInput ? parseInt(allocInput.value, 10) : 1;
            sp.allocations = (Number.isFinite(allocV) && allocV >= 1) ? allocV : 1;
            IDENTITY_PAGE_FIELDS.forEach(field => {
                const input = document.getElementById(field.id);
                const v = input ? parseInt(input.value, 10) : 1;
                sp[field.key] = (Number.isFinite(v) && v >= 1) ? v : 1;
            });
            return sp;
        }

        // Only keeps titles for pages that still exist and actually have
        // text — trims a stale entry left over from a page that no longer
        // has anything on it (e.g. after removing the last item that used
        // to be on page 3).
        function collectPageTitles() {
            const highest = highestPageNumberUsedAnywhere(null);
            const result = {};
            for (let p = 1; p <= highest; p++) {
                const val = (pageTitlesMap[String(p)] || '').trim();
                if (val) result[String(p)] = val;
            }
            return result;
        }

        function populateSectionPages(course) {
            let sp = {};
            try {
                const raw = course.section_pages;
                sp = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
            } catch (e) { sp = {}; }
            if (!sp || typeof sp !== 'object') sp = {};

            TARGETING_FIELDS.forEach(field => {
                const input = document.querySelector(`.targeting-page-input[data-field="${field.key}"]`);
                if (!input) return;
                const v = sp[field.key] || 1;
                input.value = v;
                input.dataset.prevValue = v;
            });
            const docsInput = document.getElementById('documentsPageInput');
            if (docsInput) { docsInput.value = sp.documents || 1; docsInput.dataset.prevValue = sp.documents || 1; }
            const allocInput = document.getElementById('allocationsPageInput');
            if (allocInput) { allocInput.value = sp.allocations || 1; allocInput.dataset.prevValue = sp.allocations || 1; }
            IDENTITY_PAGE_FIELDS.forEach(field => {
                const input = document.getElementById(field.id);
                if (!input) return;
                const v = sp[field.key] || 1;
                input.value = v;
                input.dataset.prevValue = v;
            });
        }

        function populatePageTitles(course) {
            let pt = {};
            try {
                const raw = course.page_titles;
                pt = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
            } catch (e) { pt = {}; }
            pageTitlesMap = (pt && typeof pt === 'object') ? { ...pt } : {};
        }

        function renderCustomQuestionsList() {
            const box = document.getElementById('customQuestionsList');
            if (customQuestions.length === 0) {
                box.innerHTML = '<p class="section-hint" style="margin:0;">No custom questions yet.</p>';
                return;
            }

            box.innerHTML = customQuestions.map((q, qIdx) => {
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
                                <input type="number" class="cq-page-input page-number-input" data-qidx="${qIdx}" min="1" value="${q.page_number || 1}" style="width:56px; padding:6px 8px; border-radius:8px; border:1px solid #d1d5db; font-size:12px;" title="Which page of the registration form this question appears on">
                            </label>
                            <button type="button" class="cq-duplicate-question-btn" data-qidx="${qIdx}">Duplicate</button>
                            <button type="button" class="cq-remove-question-btn" data-qidx="${qIdx}">Remove Question</button>
                        </div>
                        <input type="text" class="cq-text-input" data-qidx="${qIdx}" value="${(q.question_text || '').replace(/"/g, '&quot;')}" placeholder="Question text">
                        ${extraFieldsHtml}
                    </div>
                `;
            }).join('');

            wireCustomQuestionEvents();
        }

        function wireCustomQuestionEvents() {
            const box = document.getElementById('customQuestionsList');

            box.querySelectorAll('.cq-type-select').forEach(sel => {
                sel.addEventListener('change', (e) => {
                    const qIdx = Number(e.target.dataset.qidx);
                    customQuestions[qIdx].question_type = e.target.value;
                    // Reset type-specific config when switching types, so
                    // stale options/rows from a previous type don't linger.
                    customQuestions[qIdx].options = [];
                    customQuestions[qIdx].grid_rows = [];
                    customQuestions[qIdx].grid_columns = [];
                    renderCustomQuestionsList();
                });
            });
            box.querySelectorAll('.cq-text-input').forEach(input => {
                input.addEventListener('input', (e) => {
                    customQuestions[Number(e.target.dataset.qidx)].question_text = e.target.value;
                });
            });
            box.querySelectorAll('.cq-page-input').forEach(input => {
                input.addEventListener('change', (e) => {
                    const qIdx = Number(e.target.dataset.qidx);
                    let newVal = parseInt(e.target.value, 10);
                    if (!Number.isFinite(newVal) || newVal < 1) newVal = 1;

                    const maxAllowed = highestPageNumberUsedAnywhere(e.target) + 1;
                    if (newVal > maxAllowed) {
                        alert(`Page numbers can't skip ahead — page ${maxAllowed} is the next page available. Add at least one item to page ${maxAllowed} before using page ${newVal}.`);
                        e.target.value = customQuestions[qIdx].page_number || 1;
                        return;
                    }

                    customQuestions[qIdx].page_number = newVal;
                    e.target.value = newVal;
                    renderPageTitlesSummary();
                });
            });
            box.querySelectorAll('.cq-duplicate-question-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const qIdx = Number(e.target.dataset.qidx);
                    // Deep copy (via JSON) so editing the copy's options/rows
                    // never mutates the original question's arrays.
                    const copy = JSON.parse(JSON.stringify(customQuestions[qIdx]));
                    delete copy.id; // it's a brand-new question, not the same DB row
                    customQuestions.splice(qIdx + 1, 0, copy);
                    renderCustomQuestionsList();
                    renderPageTitlesSummary();
                });
            });
            box.querySelectorAll('.cq-remove-question-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    customQuestions.splice(Number(e.target.dataset.qidx), 1);
                    renderCustomQuestionsList();
                    renderPageTitlesSummary();
                });
            });

            box.querySelectorAll('.cq-option-input').forEach(input => {
                input.addEventListener('input', (e) => {
                    customQuestions[Number(e.target.dataset.qidx)].options[Number(e.target.dataset.oidx)] = e.target.value;
                });
            });
            box.querySelectorAll('.cq-add-option-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    customQuestions[Number(e.target.dataset.qidx)].options.push('');
                    renderCustomQuestionsList();
                });
            });
            box.querySelectorAll('.cq-remove-option-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const qIdx = Number(e.target.dataset.qidx);
                    customQuestions[qIdx].options.splice(Number(e.target.dataset.oidx), 1);
                    renderCustomQuestionsList();
                });
            });

            box.querySelectorAll('.cq-gridrow-input').forEach(input => {
                input.addEventListener('input', (e) => {
                    customQuestions[Number(e.target.dataset.qidx)].grid_rows[Number(e.target.dataset.ridx)] = e.target.value;
                });
            });
            box.querySelectorAll('.cq-add-gridrow-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    customQuestions[Number(e.target.dataset.qidx)].grid_rows.push('');
                    renderCustomQuestionsList();
                });
            });
            box.querySelectorAll('.cq-remove-gridrow-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const qIdx = Number(e.target.dataset.qidx);
                    customQuestions[qIdx].grid_rows.splice(Number(e.target.dataset.ridx), 1);
                    renderCustomQuestionsList();
                });
            });

            box.querySelectorAll('.cq-gridcol-input').forEach(input => {
                input.addEventListener('input', (e) => {
                    customQuestions[Number(e.target.dataset.qidx)].grid_columns[Number(e.target.dataset.cidx)] = e.target.value;
                });
            });
            box.querySelectorAll('.cq-add-gridcol-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    customQuestions[Number(e.target.dataset.qidx)].grid_columns.push('');
                    renderCustomQuestionsList();
                });
            });
            box.querySelectorAll('.cq-remove-gridcol-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const qIdx = Number(e.target.dataset.qidx);
                    customQuestions[qIdx].grid_columns.splice(Number(e.target.dataset.cidx), 1);
                    renderCustomQuestionsList();
                });
            });
        }

        document.getElementById('addQuestionBtn').addEventListener('click', () => {
            customQuestions.push({ question_type: 'text', question_text: '', options: [], grid_rows: [], grid_columns: [], page_number: 1 });
            renderCustomQuestionsList();
            renderPageTitlesSummary();
        });

        // ====================================================================
        // Page Content (optional) — revives the old, deleted "Activity
        // Content" feature's UI shape (Title + body text blocks) for a new
        // purpose: each block is tied to a PAGE NUMBER instead of an anchor
        // position, and is saved to the existing (previously unused since
        // that deletion) activity_contents table via its new page_number
        // column — see sql/course-page-content.sql. Deliberately its own
        // separate array/render/push functions rather than reusing any of
        // the old anchor-system's code paths.
        // ====================================================================
        let pageContentBlocks = []; // [{ id?, title, content, page_number }]

        function renderPageContentList() {
            const box = document.getElementById('pageContentList');
            if (pageContentBlocks.length === 0) {
                box.innerHTML = '<p class="section-hint" style="margin:0;">No page content blocks yet.</p>';
                return;
            }

            box.innerHTML = pageContentBlocks.map((b, pcIdx) => `
                <div class="custom-question-card" data-pcidx="${pcIdx}">
                    <div class="cq-header-row">
                        <label class="field-page-label">
                            Page
                            <input type="number" class="page-number-input pc-page-input" data-pcidx="${pcIdx}" min="1" value="${b.page_number || 1}" title="Which page of the registration form this content block appears on">
                        </label>
                        <button type="button" class="cq-remove-question-btn pc-remove-btn" data-pcidx="${pcIdx}">Remove Block</button>
                    </div>
                    <input type="text" class="cq-text-input pc-title-input" data-pcidx="${pcIdx}" value="${(b.title || '').replace(/"/g, '&quot;')}" placeholder="Title (optional)">
                    <textarea class="ac-body-textarea pc-body-textarea" data-pcidx="${pcIdx}" rows="3" placeholder="Body text shown to registrants on this page">${(b.content || '').replace(/</g, '&lt;')}</textarea>
                </div>
            `).join('');

            wirePageContentEvents();
        }

        function wirePageContentEvents() {
            const box = document.getElementById('pageContentList');

            box.querySelectorAll('.pc-title-input').forEach(input => {
                input.addEventListener('input', (e) => {
                    pageContentBlocks[Number(e.target.dataset.pcidx)].title = e.target.value;
                });
            });
            box.querySelectorAll('.pc-body-textarea').forEach(input => {
                input.addEventListener('input', (e) => {
                    pageContentBlocks[Number(e.target.dataset.pcidx)].content = e.target.value;
                });
            });
            box.querySelectorAll('.pc-page-input').forEach(input => {
                input.addEventListener('change', (e) => {
                    const pcIdx = Number(e.target.dataset.pcidx);
                    let newVal = parseInt(e.target.value, 10);
                    if (!Number.isFinite(newVal) || newVal < 1) newVal = 1;

                    const maxAllowed = highestPageNumberUsedAnywhere(e.target) + 1;
                    if (newVal > maxAllowed) {
                        alert(`Page numbers can't skip ahead — page ${maxAllowed} is the next page available. Add at least one item to page ${maxAllowed} before using page ${newVal}.`);
                        e.target.value = pageContentBlocks[pcIdx].page_number || 1;
                        return;
                    }

                    pageContentBlocks[pcIdx].page_number = newVal;
                    e.target.value = newVal;
                    renderPageTitlesSummary();
                });
            });
            box.querySelectorAll('.pc-remove-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    pageContentBlocks.splice(Number(e.target.dataset.pcidx), 1);
                    renderPageContentList();
                    renderPageTitlesSummary();
                });
            });
        }

        document.getElementById('addPageContentBtn').addEventListener('click', () => {
            pageContentBlocks.push({ title: '', content: '', page_number: 1 });
            renderPageContentList();
            renderPageTitlesSummary();
        });

        // ============================================================================
        // Full set of designation/role options — used to build the "Choose Specific
        // Designations..." checkbox grid (Section 2). This exact same list is
        // duplicated in js/workshops.js as DESIGNATION_OPTIONS for the registration
        // side; keep both in sync if you ever change it.
        // ============================================================================
        const DESIGNATION_ROLE_OPTIONS = [
            'Doctors', 'Nurses', 'Pharmacists', 'Assistant Pharmacists', 'Nutritionists',
            'Radiographers', 'Physiotherapists', 'Laboratory Technicians', 'Dental Assistants',
            'Administrative Staff', 'Finance Staff', 'IT Staff', 'Engineers',
            'Respiratory Therapists', 'Legal Affairs', 'Other'
        ];

        function renderDesignationCheckboxGrid() {
            const grid = document.getElementById('designationGrid');
            grid.innerHTML = DESIGNATION_ROLE_OPTIONS.map(role => `
                <label class="designation-item">
                    <span class="designation-item-label-group"><input type="checkbox" class="desig-checkbox" value="${role}"> ${role}</span>
                    <input type="number" class="desig-seat-input hidden-element" data-designation="${role}" min="1" placeholder="Unlimited" style="width:80px; padding:4px 6px; border-radius:6px; border:1px solid #d1d5db; font-size:12px;">
                </label>
            `).join('');
            document.querySelectorAll('.desig-checkbox').forEach(cb => cb.addEventListener('change', syncDesignationSeatInputVisibility));
        }

        // Lets the admin type in a role that isn't in the predefined list above
        // (e.g. "Social Workers") — appended as one more checked-by-default row
        // with its own seat input, using the exact same markup/behavior.
        function addCustomDesignationRow(roleName, { checked = true, seatValue = '' } = {}) {
            const grid = document.getElementById('designationGrid');
            const exists = [...grid.querySelectorAll('.desig-checkbox')].some(cb => cb.value.toLowerCase() === roleName.toLowerCase());
            if (exists) return;

            const label = document.createElement('label');
            label.className = 'designation-item';
            label.innerHTML = `
                <span class="designation-item-label-group"><input type="checkbox" class="desig-checkbox" value="${roleName}"> ${roleName}</span>
                <input type="number" class="desig-seat-input${checked ? '' : ' hidden-element'}" data-designation="${roleName}" min="1" placeholder="Unlimited" value="${seatValue}" style="width:80px; padding:4px 6px; border-radius:6px; border:1px solid #d1d5db; font-size:12px;">
            `;
            grid.appendChild(label);
            const cb = label.querySelector('.desig-checkbox');
            cb.checked = checked;
            cb.addEventListener('change', syncDesignationSeatInputVisibility);
        }

        // ============================================================================
        // Target Audience & Registration Options — 8 fields. This exact same shape
        // (key + options) is duplicated in js/workshops.js for the registration side;
        // keep both in sync if you ever change the option lists.
        // ============================================================================
        const TARGETING_FIELDS = [
            {
                key: 'job_level',
                label: 'Job Level',
                options: ['General Manager', 'Department Director', 'Head of Department', 'Employee']
            },
            {
                key: 'nationality',
                label: 'Nationality',
                options: ['Omani', 'Non-Omani']
            },
            {
                key: 'education_qualification',
                label: 'Highest Educational Qualification',
                options: [
                    'Less than General Diploma', 'General Diploma or Equivalent', 'Higher Diploma',
                    "Bachelor's Degree", "Master's Degree", 'PhD'
                ]
            },
            {
                key: 'experience_years',
                label: 'Experience Years',
                options: [
                    'Less than 1 year to 5 years', '6–10 years', '11–15 years',
                    '16–20 years', '21–25 years', '26 years or more'
                ]
            },
            {
                key: 'organization',
                label: 'Organization',
                options: ['Ministry of Health (MOH)', 'Other Organization']
            },
            {
                key: 'directorate',
                label: 'Directorate',
                searchable: true,
                options: [
                    "Minister's Office", 'General Directorate of Legal Affairs', 'General Directorate of Internal Audit',
                    'Office of the Undersecretary for Administrative and Financial Affairs', 'General Directorate of Human Resources',
                    'General Directorate of Financial Affairs', 'General Directorate of Medical Supplies',
                    'General Directorate of Projects and Engineering Services', 'Office of the Undersecretary for Health Planning and Organization',
                    'General Directorate of Planning', 'General Directorate of Information Technology and Digital Health',
                    'Quality Assurance Center', 'Drug Safety Center', 'General Directorate of Private Health Institutions',
                    'Office of the Undersecretary for Health Affairs', 'General Directorate of Health Services and Programs',
                    'Disease Control and Prevention Center', "National Center for Women's and Children's Health",
                    'Royal Hospital', 'Khoula Hospital', 'Muscat Governorate', 'Dhofar Governorate', 'Musandam Governorate',
                    'Al Buraimi Governorate', 'Al Dakhiliyah Governorate', 'North Al Batinah Governorate', 'South Al Batinah Governorate',
                    'North Al Sharqiyah Governorate', 'South Al Sharqiyah Governorate', 'Al Dhahirah Governorate', 'Al Wusta Governorate'
                ]
            },
            {
                key: 'program_type',
                label: 'Type of Program',
                options: ['On-the-Job Training', 'Learning from Others', 'Formal Training']
            },
            {
                key: 'attendance_nature',
                label: 'Nature of Attendance',
                options: ['In-person attendance | حضوري', 'Virtual | إفتراضي', 'Hybrid | مدمج']
            }
        ];

        function renderAllTargetingFieldGroups() {
            const container = document.getElementById('targetingFieldsContainer');
            let html = '';
            TARGETING_FIELDS.forEach(field => {
                html += `<div class="targeting-field-block" data-field-block="${field.key}">
                    <div class="targeting-field-header">
                        <label class="targeting-field-label">${field.label}</label>
                        <label class="field-visibility-toggle-label">
                            <input type="checkbox" class="field-visibility-toggle" data-field="${field.key}" checked>
                            Show to registrants
                        </label>
                        <label class="field-page-label">
                            Page
                            <input type="number" class="page-number-input targeting-page-input" data-field="${field.key}" data-prev-value="1" min="1" value="1" title="Which page of the registration form this field appears on">
                        </label>
                    </div>`;
                if (field.searchable) {
                    html += `<input type="text" class="ms-search-input" data-field="${field.key}" placeholder="Search ${field.label}...">`;
                }
                html += `<div class="multiselect-box" data-field="${field.key}">
                    <label class="ms-option ms-all"><input type="checkbox" class="ms-all-checkbox" data-field="${field.key}" value="All" checked> All</label>
                    <div class="ms-options-list" data-field="${field.key}" style="display:none;">`;
                field.options.forEach(opt => {
                    html += `<label class="ms-option" data-searchable-text="${opt.toLowerCase()}"><input type="checkbox" class="ms-item-checkbox" data-field="${field.key}" value="${opt}" disabled> ${opt}</label>`;
                });
                html += `</div></div></div>`;
            });
            container.innerHTML = html;
        }

        function applyFieldVisibilityState(fieldKey) {
            const block = document.querySelector(`.targeting-field-block[data-field-block="${fieldKey}"]`);
            if (!block) return;
            const toggle = block.querySelector('.field-visibility-toggle');
            const box = block.querySelector('.multiselect-box');
            const searchInput = block.querySelector('.ms-search-input');
            const isVisible = toggle.checked;

            box.classList.toggle('field-hidden-from-registrants', !isVisible);
            box.querySelectorAll('input[type="checkbox"]').forEach(cb => { cb.disabled = !isVisible || cb.disabled; });
            // Re-enable exactly the ones that should be enabled when turning visibility back on
            if (isVisible) {
                const allCb = box.querySelector('.ms-all-checkbox');
                allCb.disabled = false;
                box.querySelectorAll('.ms-item-checkbox').forEach(cb => {
                    cb.disabled = allCb.checked;
                });
            }
            if (searchInput) searchInput.disabled = !isVisible;
        }

        function syncOptionsListVisibility(box) {
            const allCb = box.querySelector('.ms-all-checkbox');
            const list = box.querySelector('.ms-options-list');
            if (list) list.style.display = allCb.checked ? 'none' : '';
        }

        function wireTargetingFieldEvents() {
            const container = document.getElementById('targetingFieldsContainer');

            container.addEventListener('change', (e) => {
                const target = e.target;

                if (target.classList.contains('targeting-page-input')) {
                    let newVal = parseInt(target.value, 10);
                    if (!Number.isFinite(newVal) || newVal < 1) newVal = 1;
                    const maxAllowed = highestPageNumberUsedAnywhere(target) + 1;
                    if (newVal > maxAllowed) {
                        alert(`Page numbers can't skip ahead — page ${maxAllowed} is the next page available. Add at least one item to page ${maxAllowed} before using page ${newVal}.`);
                        target.value = target.dataset.prevValue || 1;
                        return;
                    }
                    target.value = newVal;
                    target.dataset.prevValue = newVal;
                    renderPageTitlesSummary();
                    return;
                }

                if (!target.matches('input[type="checkbox"]')) return;

                if (target.classList.contains('field-visibility-toggle')) {
                    applyFieldVisibilityState(target.getAttribute('data-field'));
                    return;
                }

                const field = target.getAttribute('data-field');
                const box = container.querySelector(`.multiselect-box[data-field="${field}"]`);
                const allCb = box.querySelector('.ms-all-checkbox');
                const itemCbs = box.querySelectorAll('.ms-item-checkbox');

                if (target.classList.contains('ms-all-checkbox')) {
                    if (target.checked) {
                        itemCbs.forEach(cb => {
                            cb.checked = false;
                            cb.disabled = true;
                            cb.closest('.ms-option').classList.add('ms-disabled');
                        });
                    } else {
                        itemCbs.forEach(cb => {
                            cb.disabled = false;
                            cb.closest('.ms-option').classList.remove('ms-disabled');
                        });
                    }
                    syncOptionsListVisibility(box);
                } else if (target.checked) {
                    allCb.checked = false;
                    syncOptionsListVisibility(box);
                }
            });

            container.addEventListener('input', (e) => {
                if (!e.target.classList.contains('ms-search-input')) return;
                const field = e.target.getAttribute('data-field');
                const query = e.target.value.trim().toLowerCase();
                const list = container.querySelector(`.ms-options-list[data-field="${field}"]`);
                list.querySelectorAll('.ms-option').forEach(opt => {
                    const text = opt.getAttribute('data-searchable-text') || '';
                    opt.style.display = text.includes(query) ? '' : 'none';
                });
            });
        }

        function collectTargetingSelections() {
            const result = {};
            for (const field of TARGETING_FIELDS) {
                const block = document.querySelector(`.targeting-field-block[data-field-block="${field.key}"]`);
                const toggle = block.querySelector('.field-visibility-toggle');
                if (!toggle.checked) {
                    result[field.key] = [];
                    continue;
                }
                const box = document.querySelector(`.multiselect-box[data-field="${field.key}"]`);
                const allCb = box.querySelector('.ms-all-checkbox');
                if (allCb.checked) {
                    result[field.key] = ['All'];
                    continue;
                }
                const checked = Array.from(box.querySelectorAll('.ms-item-checkbox:checked')).map(cb => cb.value);
                if (checked.length === 0) {
                    alert(`Please select at least one option for "${field.label}", or turn off "Show to registrants" for that field.`);
                    return null;
                }
                result[field.key] = checked;
            }
            return result;
        }

        function populateTargetingSelections(course) {
            for (const field of TARGETING_FIELDS) {
                const block = document.querySelector(`.targeting-field-block[data-field-block="${field.key}"]`);
                const toggle = block.querySelector('.field-visibility-toggle');
                const box = document.querySelector(`.multiselect-box[data-field="${field.key}"]`);
                const allCb = box.querySelector('.ms-all-checkbox');
                const itemCbs = box.querySelectorAll('.ms-item-checkbox');

                let savedArr = [];
                try {
                    const raw = course[field.key];
                    savedArr = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw.trim() !== '' ? JSON.parse(raw) : []);
                } catch (e) {
                    savedArr = [];
                }

                itemCbs.forEach(cb => {
                    cb.checked = false;
                    cb.disabled = false;
                    cb.closest('.ms-option').classList.remove('ms-disabled');
                });

                if (!savedArr || savedArr.length === 0) {
                    // Empty means this field was hidden from registrants entirely.
                    toggle.checked = false;
                    allCb.checked = true;
                    itemCbs.forEach(cb => {
                        cb.disabled = true;
                        cb.closest('.ms-option').classList.add('ms-disabled');
                    });
                } else {
                    toggle.checked = true;
                    if (savedArr.includes('All')) {
                        allCb.checked = true;
                        itemCbs.forEach(cb => {
                            cb.disabled = true;
                            cb.closest('.ms-option').classList.add('ms-disabled');
                        });
                    } else {
                        allCb.checked = false;
                        itemCbs.forEach(cb => { if (savedArr.includes(cb.value)) cb.checked = true; });
                    }
                }
                syncOptionsListVisibility(box);
                applyFieldVisibilityState(field.key);
            }
        }

        function resetTargetingSelections() {
            for (const field of TARGETING_FIELDS) {
                const block = document.querySelector(`.targeting-field-block[data-field-block="${field.key}"]`);
                const box = document.querySelector(`.multiselect-box[data-field="${field.key}"]`);
                if (!box || !block) continue;
                const toggle = block.querySelector('.field-visibility-toggle');
                const allCb = box.querySelector('.ms-all-checkbox');
                const itemCbs = box.querySelectorAll('.ms-item-checkbox');
                toggle.checked = true;
                allCb.checked = true;
                itemCbs.forEach(cb => {
                    cb.checked = false;
                    cb.disabled = true;
                    cb.closest('.ms-option').classList.add('ms-disabled');
                });
                syncOptionsListVisibility(box);
                applyFieldVisibilityState(field.key);

                const pageInput = block.querySelector('.targeting-page-input');
                if (pageInput) { pageInput.value = 1; pageInput.dataset.prevValue = 1; }
            }
        }

        // Shows/hides + defaults the per-designation seat number input based on
        // whether its checkbox is checked. Called after any click AND after any
        // programmatic check (presets, edit-mode loading) since those don't fire
        // a native 'change' event.
        function syncDesignationSeatInputVisibility() {
            document.querySelectorAll('.desig-checkbox').forEach(cb => {
                const seatInput = document.querySelector(`.desig-seat-input[data-designation="${cb.value}"]`);
                if (!seatInput) return;
                if (cb.checked) {
                    seatInput.classList.remove('hidden-element');
                } else {
                    seatInput.classList.add('hidden-element');
                    seatInput.value = '';
                }
            });
        }

        const masterInstitutionsAndDepartments = [
            "Al Mudhaibi Health Center", "Wadi Bani Khalid Hospital", "Sinaw Health Hospital",
            "Ibra Health Center", "Sinaw Health Center", "Al Yahmadi Health Center",
            "Al Mudhaibi Health Center (New)", "Samad Al Shaan Hospital", "Bidiyah Hospital",
            "Al Qabil Health Center", "Wadi Dama Wa At Taiyyin Hospital", "Al Dhahir Health Center",
            "Al Jaza Health Center", "Sumayyan Health Center", "Al Jardaa Health Center",
            "Al Aflaj Health Center", "Miss Health Centre", "Dma Health Centre", "Wadi Naam Health Center", "Other (Please Specify)",
            "Ibra - Emergency Department Doctor", "Ibra - Emergency Department Nurse", "Ibra - Internal Medicine Department", 
            "Ibra - General Surgery Department", "Ibra - Paediatrician", "Ibra - Obstetrics and Gynecology Department", 
            "Ibra - Orthopedics Department", "Ibra - Ophthalmology Department", "Ibra - ENT Department", 
            "Ibra - Anesthesia Department", "Ibra - Dialysis Unit Nurse", "Ibra - Radiology Department", 
            "Ibra - Laboratory Department", "Ibra - Physiotherapy Department", "Ibra - Clinical Nutrition Department", 
            "Ibra - Pharmacy Department", "Ibra - Male Medical and Surgical Ward", "Ibra - Female Medical and Surgical Ward", 
            "Ibra - Pediatrics Ward", "Ibra - Obstetrics and Gynecology Ward", "Ibra - Adult Intensive Care Unit (ICU)", 
            "Ibra - Special Care Baby Unit (SCBU)", "Ibra - OPD", "Ibra - Nephrologist", "Ibra - DS Nurse", 
            "Ibra - OT Nurse", "Ibra - RT"
        ];

        // Each row's example image now comes from an uploaded file rather
        // than a pasted URL. The already-saved URL (when editing an
        // existing rule) lives on the row itself as data-existing-url;
        // a freshly-picked File pending upload lives as row.pendingExampleFile
        // (a plain property, not a data attribute, since a File can't be
        // serialized into one) — both travel with the row if it's reordered,
        // and handleFormSubmission reads whichever one applies at save time.
        function pushFileRuleInputRow(labelVal = '', exampleVal = '') {
            const wrapper = document.getElementById('fileArrayWrapper');
            const row = document.createElement('div');
            row.className = 'array-item-row';
            row.style.flexDirection = 'column';
            row.style.alignItems = 'stretch';
            row.style.background = '#ffffff';
            row.style.padding = '10px';
            row.style.borderRadius = '8px';
            row.style.border = '1px solid #e2e8f0';
            row.style.marginBottom = '10px';
            row.dataset.existingUrl = exampleVal || '';
            row.pendingExampleFile = null;
            row.innerHTML = `
                <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center; width: 100%;">
                    <input type="text" class="file-label-item" placeholder="Document Label (e.g. ACLS Card)" value="${labelVal}" required style="flex: 1 1 160px; min-width: 0;">
                    <input type="file" class="file-example-item" accept="image/*" style="flex: 1 1 160px; min-width: 0;">
                    <button type="button" class="btn-remove">✕</button>
                </div>
                <div class="row-image-preview-box" style="margin-top: 8px; display: ${exampleVal ? 'block' : 'none'};">
                    <img src="${exampleVal || ''}" style="max-width: 100px; max-height: 100px; object-fit: contain; border-radius: 6px; border: 1px solid #cbd5e1; display: block;"
                    onerror="this.parentElement.style.display='none'">
                    <button type="button" class="btn-remove row-remove-example-btn" style="margin-top:6px; display: ${exampleVal ? 'inline-block' : 'none'};">✕ Remove Reference Image</button>
                </div>
            `;
            const fileInput = row.querySelector('.file-example-item');
            const previewBox = row.querySelector('.row-image-preview-box');
            const previewImg = previewBox.querySelector('img');
            const removeExampleBtn = row.querySelector('.row-remove-example-btn');
            fileInput.addEventListener('change', () => {
                const file = fileInput.files && fileInput.files[0];
                if (file) {
                    row.pendingExampleFile = file;
                    row.dataset.existingUrl = '';
                    const reader = new FileReader();
                    reader.onload = () => { previewImg.src = reader.result; };
                    reader.readAsDataURL(file);
                    previewBox.style.display = 'block';
                    removeExampleBtn.style.display = 'inline-block';
                }
            });
            removeExampleBtn.addEventListener('click', () => {
                row.pendingExampleFile = null;
                row.dataset.existingUrl = '';
                fileInput.value = '';
                previewImg.src = '';
                previewBox.style.display = 'none';
                removeExampleBtn.style.display = 'none';
            });
            row.querySelector('.btn-remove').addEventListener('click', () => {
                row.remove();
                if(document.querySelectorAll('.file-label-item').length === 0) {
                    pushFileRuleInputRow('Required Document', '');
                }
            });
            wrapper.appendChild(row);
        }

        async function seedAndFetchMasterInstitutions() {
            const { data: existing } = await client.from('institutions').select('*');

            // Only seed a genuinely EMPTY table (a fresh deployment) —
            // previously this ran on every single page load and
            // re-inserted any individual master-list name missing from
            // the database, which meant an admin deliberately deleting
            // one of these institutions (e.g. from the Ibra Department
            // admin page) had it silently recreated the next time anyone
            // simply opened this page. Deleting an institution should be
            // permanent, not undone by the next visit here.
            if (!existing || existing.length === 0) {
                await client.from('institutions').insert(masterInstitutionsAndDepartments.map(name => ({ name })));
            }

            const { data: updated } = await client.from('institutions').select('*');
            globalInstitutionsList = updated || existing || [];
        }

        function renderAllocationMappingFramework(currentMap = []) {
            const ibraContainer = document.getElementById('allocationWrapperIbra');
            const otherContainer = document.getElementById('allocationWrapperOther');

            let ibraHtml = [];
            let otherHtml = [];

            globalInstitutionsList.forEach(inst => {
                const match = currentMap.find(m => m.institution_id === inst.id);
                const defaultSlots = match ? match.max_slots : (inst.name.startsWith("Ibra - ") ? 3 : 1);
                const currentCount = match ? match.registered_count : 0;
                const checkedStatus = match || currentMap.length === 0 ? 'checked' : '';
                const categoryType = inst.name.startsWith("Ibra - ") ? "IBRA" : "OTHER";

                const markup = `
                    <div class="allocation-item" data-category="${categoryType}" data-id="${inst.id}">
                        <label class="allocation-item-label-group">
                            <input type="checkbox" class="inst-checkbox-target" data-id="${inst.id}" data-current-count="${currentCount}" ${checkedStatus}>
                            <span>${inst.name}</span>
                        </label>
                        <input type="number" class="inst-slots-target" data-id="${inst.id}" min="0" placeholder="Cap" value="${defaultSlots}">
                    </div>
                `;

                if (categoryType === "IBRA") {
                    ibraHtml.push(markup);
                } else {
                    otherHtml.push(markup);
                }
            });

            ibraContainer.innerHTML = ibraHtml.join('') || '<div style="color:#64748b; font-size:12px; padding:5px;">No records</div>';
            otherContainer.innerHTML = otherHtml.join('') || '<div style="color:#64748b; font-size:12px; padding:5px;">No records</div>';
        }

        function handleBulkSelectionToggle() {
            const selectAction = document.getElementById('allocationBulkSelectAction').value;
            if (!selectAction) return;

            const allItems = document.querySelectorAll('.allocation-item');
            allItems.forEach(item => {
                const checkbox = item.querySelector('.inst-checkbox-target');
                const isHidden = item.classList.contains('hidden-element');
                const cat = item.getAttribute('data-category');
                
                if (checkbox) {
                    if (selectAction === 'ALL' && !isHidden) {
                        checkbox.checked = true;
                    } else if (selectAction === 'IBRA_ALL') {
                        checkbox.checked = (cat === 'IBRA');
                    } else if (selectAction === 'OTHER_ALL') {
                        checkbox.checked = (cat === 'OTHER');
                    } else if (selectAction === 'NONE' && !isHidden) {
                        checkbox.checked = false;
                    }
                }
            });
            document.getElementById('allocationBulkSelectAction').value = ""; 
        }

        function handleBulkSeatsOverride() {
            const bulkValueString = document.getElementById('bulkSeatsCountInput').value;
            if (bulkValueString === "") {
                alert("Please input a valid chair mapping count capacity first.");
                return;
            }
            const seatCount = parseInt(bulkValueString, 10);
            const targetFilter = document.getElementById('bulkSeatsTargetFilter').value;
            const allItems = document.querySelectorAll('.allocation-item');
            let directCount = 0;

            allItems.forEach(item => {
                const checkbox = item.querySelector('.inst-checkbox-target');
                const slotsInput = item.querySelector('.inst-slots-target');
                const isHidden = item.classList.contains('hidden-element');
                const cat = item.getAttribute('data-category');

                if (checkbox && slotsInput) {
                    let shouldApply = false;
                    
                    if (targetFilter === 'VISIBLE' && !isHidden && checkbox.checked) {
                        shouldApply = true;
                    } else if (targetFilter === 'IBRA' && cat === 'IBRA' && checkbox.checked) {
                        shouldApply = true;
                    } else if (targetFilter === 'OTHER' && cat === 'OTHER' && checkbox.checked) {
                        shouldApply = true;
                    }

                    if (shouldApply) {
                        slotsInput.value = seatCount;
                        directCount++;
                    }
                }
            });
            alert(`Successfully updated localized seats to ${seatCount} for ${directCount} chosen institutions.`);
        }

        /* Preset Template Loader Logic */
        function loadCoursePreset(type) {
            // Setup automated dates helper
            const today = new Date();
            today.setDate(today.getDate() + 30); // Default to a month from now
            const defaultDateString = today.toISOString().split('T')[0];

            if (type === 'BLS') {
                document.getElementById('courseName').value = 'BLS';
                document.getElementById('courseDate').value = defaultDateString;
                document.getElementById('courseSeats').value = '30';
                document.getElementById('courseGender').value = 'Both';
                
                // Target Criteria: Designations Allowed
                document.getElementById('designationModeSelect').value = 'All';
                document.getElementById('customDesignationsBox').classList.add('hidden-element');
                document.querySelectorAll('.desig-checkbox').forEach(cb => cb.checked = false);
                syncDesignationSeatInputVisibility();
                
                // Dynamic Files Mapping
                document.getElementById('documentRequirementSelect').value = 'Yes';
                document.getElementById('documentRulesConfigContainer').classList.remove('hidden-element');
                document.getElementById('fileArrayWrapper').innerHTML = '';
                pushFileRuleInputRow('Purchase bill', 'https://pqgkdnxdsybcfamwadrf.supabase.co/storage/v1/object/public/blueprints/BLS_bill.jpeg');
                pushFileRuleInputRow('Heart code online certificate', 'https://pqgkdnxdsybcfamwadrf.supabase.co/storage/v1/object/public/blueprints/BLS_certification.jpeg');

                // Institutional Allocations Pre-configurations
                const allItems = document.querySelectorAll('.allocation-item');
                allItems.forEach(item => {
                    const checkbox = item.querySelector('.inst-checkbox-target');
                    const slotsInput = item.querySelector('.inst-slots-target');
                    const cat = item.getAttribute('data-category');
                    if(checkbox && slotsInput) {
                        checkbox.checked = true;
                        slotsInput.value = (cat === 'IBRA') ? '5' : '2';
                    }
                });

            } else if (type === 'ACLS') {
                document.getElementById('courseName').value = 'ACLS';
                document.getElementById('courseDate').value = defaultDateString;
                document.getElementById('courseSeats').value = '15';
                document.getElementById('courseGender').value = 'Both';
                
                // Target Criteria: Custom Designations Criteria Setup
                document.getElementById('designationModeSelect').value = 'Custom';
                document.getElementById('customDesignationsBox').classList.remove('hidden-element');
                document.querySelectorAll('.desig-checkbox').forEach(cb => {
                    cb.checked = (cb.value === 'Doctors' || cb.value === 'Nurses');
                });
                syncDesignationSeatInputVisibility();

                // Dynamic Files Mapping Setup
                document.getElementById('documentRequirementSelect').value = 'Yes';
                document.getElementById('documentRulesConfigContainer').classList.remove('hidden-element');
                document.getElementById('fileArrayWrapper').innerHTML = '';
                pushFileRuleInputRow('Purchase bill', 'https://pqgkdnxdsybcfamwadrf.supabase.co/storage/v1/object/public/blueprints/ACLS_BILL.jpeg');
                pushFileRuleInputRow('Valid BLS', 'https://pqgkdnxdsybcfamwadrf.supabase.co/storage/v1/object/public/blueprints/BLS_certification.jpeg');
                pushFileRuleInputRow('pretest score', 'https://pqgkdnxdsybcfamwadrf.supabase.co/storage/v1/object/public/blueprints/ACLS_SCORE.jpeg');
                pushFileRuleInputRow('Online course video completed certificate', 'https://pqgkdnxdsybcfamwadrf.supabase.co/storage/v1/object/public/blueprints/ACLS_certification.jpeg');

                // Institutional Allocations Pre-configurations
                const allItems = document.querySelectorAll('.allocation-item');
                allItems.forEach(item => {
                    const checkbox = item.querySelector('.inst-checkbox-target');
                    const slotsInput = item.querySelector('.inst-slots-target');
                    const cat = item.getAttribute('data-category');
                    if(checkbox && slotsInput) {
                        if(cat === 'IBRA') {
                            checkbox.checked = true;
                            slotsInput.value = '3';
                        } else {
                            checkbox.checked = false; // Restrict outside institutions for ACLS by default
                            slotsInput.value = '0';
                        }
                    }
                });
            }
            alert(`${type} Full Template Framework Loaded successfully with complete criteria details.`);
        }

        document.getElementById('addCustomDesignationBtn').addEventListener('click', () => {
            const input = document.getElementById('customDesignationNameInput');
            const name = input.value.trim();
            if (!name) return;
            addCustomDesignationRow(name, { checked: true });
            input.value = '';
        });

        // Shared by the checkbox's own change handler AND by init() below —
        // the checkbox is checked BY DEFAULT in the HTML for a new
        // activity, so no 'change' event ever fires for that initial
        // state (browsers only fire 'change' on an actual user
        // interaction, never just because an element starts out checked).
        // Without calling this explicitly once at init too, a brand new
        // activity's institution fields never got zeroed/locked despite
        // Unlimited Seats showing checked from the very first render.
        function applyUnlimitedSeatsStateToInstitutions(isUnlimited) {
            if (isUnlimited) {
                // Also check every institution's own checkbox, not just
                // zero its chair count — pushAllocationRecords() only
                // saves a course_institutions row for CHECKED institutions,
                // so an unchecked one (left over from before this course
                // was made unlimited, or just never explicitly reviewed)
                // would get no row at all and show as "CLOSED / NOT
                // ALLOCATED" on the registration form, even with its chair
                // field showing 0.
                document.querySelectorAll('.inst-checkbox-target').forEach(checkbox => { checkbox.checked = true; checkbox.disabled = true; });
                document.querySelectorAll('.inst-slots-target').forEach(input => {
                    input.value = 0;
                    input.disabled = true;
                });
            } else {
                document.querySelectorAll('.inst-checkbox-target').forEach(checkbox => { checkbox.disabled = false; });
                document.querySelectorAll('.inst-slots-target').forEach(input => { input.disabled = false; });
            }
        }

        document.getElementById('unlimitedSeatsToggle').addEventListener('change', (e) => {
            const seatsInput = document.getElementById('courseSeats');
            if (e.target.checked) {
                seatsInput.classList.add('hidden-element');
                seatsInput.value = '';
            } else {
                seatsInput.classList.remove('hidden-element');
            }
            // 0 in an institution's own chair field means UNLIMITED for
            // that institution (see workshops.js's
            // filterIbraDepartments/filterOtherInstitutions) — with the
            // whole activity now unlimited, every institution's field
            // is forced to 0 and locked, since any other per-institution
            // cap would be meaningless (and confusing to look at) once
            // the activity itself has no overall limit.
            applyUnlimitedSeatsStateToInstitutions(e.target.checked);
        });

        document.getElementById('bookHallToggle').addEventListener('change', (e) => {
            document.getElementById('bookHallFields').classList.toggle('hidden-element', !e.target.checked);
        });

        // ============================================================
        // Book a Hall — multi-date entries + weekly repeat, same as the
        // standalone Hall Reservation page's New Reservation form.
        // ============================================================
        function pad2(n) { return String(n).padStart(2, '0'); }
        function chDateKey(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }
        function chAddDays(dateStr, n) {
            const [y, m, d] = dateStr.split('-').map(Number);
            const dt = new Date(y, m - 1, d + n);
            return chDateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
        }

        function createChDateEntryRow(dateFromValue, dateToValue, startTime, endTime) {
            const row = document.createElement('div');
            row.className = 'hall-date-entry-row';
            // No `required` here on purpose: this row starts out hidden
            // inside #bookHallFields (the hall-booking section is optional
            // and collapsed until "Also reserve a hall" is checked). A
            // `required` field inside a display:none ancestor still blocks
            // native form submission when Save is clicked — the browser
            // tries to focus it for validation, can't (it's not visible),
            // logs "An invalid form control ... is not focusable.", and
            // silently aborts the submit with no error shown to the admin.
            // bookHallIfRequested() below already validates these fields
            // itself, but only when the hall toggle is actually checked.
            row.innerHTML = `
                <div class="hall-date-entry-dates">
                    <input type="date" class="ch-entry-date-from" value="${dateFromValue || ''}">
                    <span>to</span>
                    <input type="date" class="ch-entry-date-to" value="${dateToValue || dateFromValue || ''}">
                </div>
                <div class="hall-date-entry-times">
                    <input type="time" class="ch-entry-start" value="${startTime || ''}">
                    <span>to</span>
                    <input type="time" class="ch-entry-end" value="${endTime || ''}">
                    <button type="button" class="hall-date-entry-remove-btn">Remove</button>
                </div>
            `;
            row.querySelector('.hall-date-entry-remove-btn').addEventListener('click', () => {
                row.remove();
                updateChDateEntryRemoveButtons();
            });
            return row;
        }

        function updateChDateEntryRemoveButtons() {
            const rows = document.querySelectorAll('#chDatesContainer .hall-date-entry-row');
            rows.forEach(row => {
                row.querySelector('.hall-date-entry-remove-btn').classList.toggle('hidden-element', rows.length <= 1);
            });
        }

        function addChDateEntryRow(dateFromValue, dateToValue, startTime, endTime) {
            document.getElementById('chDatesContainer').appendChild(createChDateEntryRow(dateFromValue, dateToValue, startTime, endTime));
            updateChDateEntryRemoveButtons();
        }

        // Starts with one empty row ready, same as the standalone page
        // defaulting to today when its form first loads.
        addChDateEntryRow('', '', '', '');

        document.getElementById('chAddDateBtn').addEventListener('click', () => addChDateEntryRow());

        document.getElementById('chWeeklyRepeatToggle').addEventListener('change', (e) => {
            const isWeekly = e.target.checked;
            document.getElementById('chWeeklyRepeatBox').classList.toggle('hidden-element', !isWeekly);
            document.getElementById('chWeeklyHint').style.display = isWeekly ? 'block' : 'none';
            document.getElementById('chDatesContainer').classList.toggle('hidden-element', isWeekly);
            document.getElementById('chAddDateBtn').classList.toggle('hidden-element', isWeekly);
        });

        // Same shape as collectChDateEntries() below — everything
        // downstream doesn't need to know which mode produced the list.
        function collectChWeeklyRepeatEntries() {
            const startDate = document.getElementById('chWeeklyStartDate').value;
            const start_time = document.getElementById('chWeeklyStartTime').value;
            const end_time = document.getElementById('chWeeklyEndTime').value;
            const weekCount = parseInt(document.getElementById('chWeeklyCount').value, 10) || 0;
            if (!startDate || !start_time || !end_time || weekCount < 1) return [];

            const entries = [];
            let cursor = startDate;
            for (let i = 0; i < weekCount; i++) {
                entries.push({ reservation_date: cursor, start_time, end_time });
                cursor = chAddDays(cursor, 7);
            }
            return entries;
        }

        // Each row can itself be a date RANGE (one shared time for that
        // whole range) — expanded into one entry per actual day here, so
        // conflict-checking and insertion never need to know about ranges.
        function collectChDateEntries() {
            const entries = [];
            document.querySelectorAll('#chDatesContainer .hall-date-entry-row').forEach(row => {
                const dateFrom = row.querySelector('.ch-entry-date-from').value;
                const dateTo = row.querySelector('.ch-entry-date-to').value || dateFrom;
                const start_time = row.querySelector('.ch-entry-start').value;
                const end_time = row.querySelector('.ch-entry-end').value;

                if (!dateFrom) { entries.push({ reservation_date: '', start_time, end_time }); return; }
                let cursor = dateFrom;
                let guard = 0;
                while (cursor <= dateTo && guard < 366) {
                    entries.push({ reservation_date: cursor, start_time, end_time });
                    cursor = chAddDays(cursor, 1);
                    guard++;
                }
            });
            return entries;
        }

        // Auto-fill "Entrance Name" from whoever is currently signed in,
        // same as the standalone Hall Reservation form — still editable.
        try {
            const raw = sessionStorage.getItem('ibra_admin_session');
            const session = raw ? JSON.parse(raw) : null;
            if (session && session.username) {
                document.getElementById('chEntranceName').value = session.username;
            }
        } catch { /* no session — leave the field blank */ }

        document.getElementById('designationModeSelect').addEventListener('change', (e) => {
            const box = document.getElementById('customDesignationsBox');
            if (e.target.value === 'Custom') {
                box.classList.remove('hidden-element');
            } else {
                box.classList.add('hidden-element');
                document.querySelectorAll('.desig-checkbox').forEach(cb => cb.checked = false);
                syncDesignationSeatInputVisibility();
            }
        });
        document.getElementById('documentRequirementSelect').addEventListener('change', (e) => {
            const targetContainer = document.getElementById('documentRulesConfigContainer');
            if (e.target.value === 'Yes') {
                targetContainer.classList.remove('hidden-element');
            } else {
                targetContainer.classList.add('hidden-element');
            }
        });

        async function triggerEditOperationalMode(id) {
            editingCourseId = Number(id);
            document.getElementById('formPanelTitle').innerText = "Modify Activity Details";
            document.getElementById('cancelEditBtn').classList.remove('hidden-element');

            const { data: course } = await client.from('courses').select('*').eq('id', editingCourseId).single();
            if (!course) return;
            document.getElementById('courseName').value = course.name || '';
            document.getElementById('courseDate').value = course.course_date || '';
            document.getElementById('activityEndDate').value = course.activity_end_date || '';
            document.getElementById('activityDateOrderHint').classList.add('hidden-element');
            document.getElementById('courseRegOpenDate').value = course.registration_opens_date || '';
            const isUnlimited = !!course.unlimited_seats;
            document.getElementById('unlimitedSeatsToggle').checked = isUnlimited;
            document.getElementById('courseSeats').value = isUnlimited ? '' : (course.seats !== undefined ? course.seats : '');
            document.getElementById('courseSeats').classList.toggle('hidden-element', isUnlimited);
            document.getElementById('courseGender').value = course.allowed_sex || 'Both';
            // Type of Activity is required now, but an activity created
            // before that change (and not yet covered by
            // sql/default-activity-type-to-course.sql) has activity_type
            // = null in the database — loading that as an empty string
            // left the field on its blank placeholder option, which is
            // invalid for a required field. The browser's own native
            // validation then silently blocked the Save button from ever
            // submitting at all (no error message, just a tooltip that's
            // easy to miss), which is exactly what "editing an activity
            // and Save doesn't work" was. Defaulting to "Course" here
            // keeps the form valid regardless of whether that SQL
            // migration has actually been run yet.
            document.getElementById('courseActivityType').value = course.activity_type || 'Course';
            document.getElementById('courseInstructorName').value = course.instructor_name || '';
            document.getElementById('courseParticipantCount').value = course.participant_count || '';
            document.getElementById('courseAttendanceRequired').checked = course.attendance_required !== false;
            document.getElementById('courseEndDate').value = course.course_end_date || '';
            document.getElementById('courseComment').value = course.description || '';

            document.getElementById('courseThemeColor').value = course.theme_color || '#7C3AED';
            document.getElementById('courseThemeColorPreview').textContent = (course.theme_color || '#7C3AED').toUpperCase();

            pendingCourseImageFile = null;
            existingCourseImageUrl = course.image_url || null;
            document.getElementById('courseImageInput').value = '';
            showCourseImagePreview(existingCourseImageUrl);

            let desigArr = [];
            try {
                if (Array.isArray(course.allowed_designations)) {
                    desigArr = course.allowed_designations;
                } else if (typeof course.allowed_designations === 'string' && course.allowed_designations.trim() !== '') {
                    desigArr = JSON.parse(course.allowed_designations);
                }
            } catch(e) { desigArr = []; }

            const modeSelect = document.getElementById('designationModeSelect');
            const box = document.getElementById('customDesignationsBox');
            document.querySelectorAll('.desig-checkbox').forEach(cb => cb.checked = false);

            // Any saved designation not in the predefined list was added by
            // the admin via "+ Add" on a previous edit — recreate its row.
            desigArr.forEach(role => {
                if (role === 'All') return;
                if (!document.querySelector(`.desig-checkbox[value="${CSS.escape(role)}"]`)) {
                    addCustomDesignationRow(role, { checked: false });
                }
            });

            if (!desigArr || desigArr.length === 0 || desigArr.includes('All')) {
                modeSelect.value = 'All';
                box.classList.add('hidden-element');
            } else {
                modeSelect.value = 'Custom';
                box.classList.remove('hidden-element');
                document.querySelectorAll('.desig-checkbox').forEach(cb => {
                    if (desigArr.includes(cb.value)) cb.checked = true;
                });
            }
            syncDesignationSeatInputVisibility();

            let savedSeats = {};
            try {
                const raw = course.designation_seats;
                savedSeats = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
            } catch (e) {
                savedSeats = {};
            }
            document.querySelectorAll('.desig-seat-input').forEach(input => {
                const key = input.getAttribute('data-designation');
                if (!input.classList.contains('hidden-element') && savedSeats[key]) {
                    input.value = savedSeats[key];
                }
            });

            document.getElementById('fileArrayWrapper').innerHTML = '';
            
            let labels = [];
            let examples = [];
            try {
                labels = Array.isArray(course.file_labels) ? course.file_labels : (typeof course.file_labels === 'string' ? JSON.parse(course.file_labels) : []);
                examples = Array.isArray(course.file_examples) ? course.file_examples : (typeof course.file_examples === 'string' ? JSON.parse(course.file_examples) : []);
            } catch(e) {
                labels = [];
                examples = [];
            }
            
            if(!Array.isArray(labels)) labels = [];
            if(!Array.isArray(examples)) examples = [];

            const docSelect = document.getElementById('documentRequirementSelect');
            const docContainer = document.getElementById('documentRulesConfigContainer');
            if (labels.length === 0) {
                docSelect.value = 'No';
                docContainer.classList.add('hidden-element');
                pushFileRuleInputRow('Required Document', '');
            } else {
                docSelect.value = 'Yes';
                docContainer.classList.remove('hidden-element');
                labels.forEach((lbl, idx) => pushFileRuleInputRow(lbl, examples[idx] || ''));
            }

            const { data: mappingAllocations } = await client.from('course_institutions').select('*').eq('course_id', editingCourseId);
            renderAllocationMappingFramework(mappingAllocations || []);
            applyUnlimitedSeatsStateToInstitutions(isUnlimited);
            // Pre-open the section when editing a course that already has
            // allocations set — otherwise it stays collapsed like new.
            const hasExistingAllocations = (mappingAllocations || []).length > 0;
            document.getElementById('allocationSectionToggle').checked = hasExistingAllocations;
            document.getElementById('allocationSectionBody').classList.toggle('hidden-element', !hasExistingAllocations);

            const { data: existingQuestions } = await client.from('course_questions').select('*').eq('course_id', editingCourseId).order('display_order', { ascending: true });
            customQuestions = (existingQuestions || []).map(q => ({
                id: q.id, question_type: q.question_type, question_text: q.question_text,
                options: Array.isArray(q.options) ? q.options : [],
                grid_rows: Array.isArray(q.grid_rows) ? q.grid_rows : [],
                grid_columns: Array.isArray(q.grid_columns) ? q.grid_columns : [],
                page_number: q.page_number || 1
            }));
            renderCustomQuestionsList();

            const { data: existingPageContent } = await client.from('activity_contents').select('*').eq('course_id', editingCourseId).order('content_order', { ascending: true });
            pageContentBlocks = (existingPageContent || []).map(b => ({
                id: b.id, title: b.title || '', content: b.content || '', page_number: b.page_number || 1
            }));
            renderPageContentList();

            populateTargetingSelections(course);
            populateSectionPages(course);
            populatePageTitles(course);
            renderPageTitlesSummary();
        }

        function exitEditOperationalMode() {
            window.location.href = 'dashboard.html';
        }

        // Sentinel used internally when a course has unlimited seats, so the
        // existing ">0" checks and per-registration decrement elsewhere in the
        // app keep working unmodified. The UI always reads unlimited_seats
        // (not this number) to decide what to display.
        const UNLIMITED_SEATS_SENTINEL = 999999;

        // The Activity Dashboard (js/dashboard.js) sorts by `display_order`
        // when it's set, with a "newest id first" fallback only for courses
        // that have never gone through its manual "move to position" reorder
        // feature — so once ANY course has a display_order, a brand-new
        // course (born with display_order = null) would rank BELOW every
        // already-ordered course instead of on top of the list. This gives
        // every newly-created course display_order = 1 and pushes every
        // other course down one, using the exact same ordering rule the
        // dashboard itself uses to decide who was "already on top" — so a
        // freshly created activity always lands at the very top of the list,
        // while the admin's own manual ordering of the rest is preserved.
        async function bumpNewCourseToTopOfDashboard(newCourseId) {
            const { data: rest, error } = await client.from('courses').select('id, display_order').neq('id', newCourseId);
            if (error || !rest) return; // best-effort — never block the save over this
            const sorted = rest.slice().sort((a, b) => {
                const ao = a.display_order, bo = b.display_order;
                if (ao != null && bo != null) return ao - bo;
                if (ao != null) return -1;
                if (bo != null) return 1;
                return b.id - a.id;
            });
            const updates = [
                { id: newCourseId, display_order: 1 },
                ...sorted.map((c, i) => ({ id: c.id, display_order: i + 2 }))
            ];
            await Promise.all(updates.map(u => client.from('courses').update({ display_order: u.display_order }).eq('id', u.id)));
        }

        async function handleFormSubmission(e) {
            e.preventDefault();
            const name = document.getElementById('courseName').value.trim();
            const course_date = document.getElementById('courseDate').value;
            const activity_end_date = document.getElementById('activityEndDate').value || null;
            document.getElementById('activityDateOrderHint').classList.add('hidden-element');
            if (activity_end_date && activity_end_date < course_date) {
                document.getElementById('activityDateOrderHint').classList.remove('hidden-element');
                alert('"Activity Date (To)" can\'t be before "Activity Date (From)".');
                return;
            }
            const unlimited_seats = document.getElementById('unlimitedSeatsToggle').checked;
            let seats;
            if (unlimited_seats) {
                seats = UNLIMITED_SEATS_SENTINEL;
            } else {
                seats = parseInt(document.getElementById('courseSeats').value, 10);
                if (!Number.isFinite(seats) || seats < 0) {
                    alert("Please enter a chairs limit, or turn on Unlimited Seats.");
                    return;
                }
            }
            const allowed_sex = document.getElementById('courseGender').value;
            const activity_type = document.getElementById('courseActivityType').value || null;
            const instructor_name = document.getElementById('courseInstructorName').value.trim() || null;
            const participantCountRaw = document.getElementById('courseParticipantCount').value;
            const participant_count = participantCountRaw === '' ? null : parseInt(participantCountRaw, 10);
            const attendance_required = document.getElementById('courseAttendanceRequired').checked;
            const course_end_date = document.getElementById('courseEndDate').value || null;
            const registration_opens_date = document.getElementById('courseRegOpenDate').value || null;
            if (registration_opens_date && course_end_date && registration_opens_date > course_end_date) {
                alert("Registration Opens date must be on or before Registration Closes date.");
                return;
            }
            const description = document.getElementById('courseComment').value.trim() || null;
            const modeSelect = document.getElementById('designationModeSelect').value;
            let allowed_designations = ['All'];
            
            if (modeSelect === 'Custom') {
                const checkedBoxes = document.querySelectorAll('.desig-checkbox:checked');
                if (checkedBoxes.length === 0) {
                    alert("Please select at least one Designation role parameter when setting customized criteria restrictions.");
                    return;
                }
                allowed_designations = Array.from(checkedBoxes).map(cb => cb.value);
            }

            // A blank seat box for a checked designation means "unlimited for
            // that role" — we simply omit its key from designation_seats, and
            // the registration-time cap check (js/workshops.js) already treats
            // a missing key as no cap.
            let designation_seats = {};
            if (modeSelect === 'Custom') {
                for (const cb of document.querySelectorAll('.desig-checkbox:checked')) {
                    const seatInput = document.querySelector(`.desig-seat-input[data-designation="${cb.value}"]`);
                    const seatVal = seatInput ? parseInt(seatInput.value, 10) : NaN;
                    if (Number.isFinite(seatVal) && seatVal > 0) {
                        designation_seats[cb.value] = seatVal;
                    }
                }
            }

            const docRequirement = document.getElementById('documentRequirementSelect').value;
            let file_labels = [];
            let file_examples = [];
            let required_files = 0;

            if (docRequirement === 'Yes') {
                // Each row's reference image is now an uploaded file rather
                // than a pasted URL — a freshly-picked one (row.pendingExampleFile)
                // gets uploaded here (reusing the same public 'course-images'
                // bucket the Event Poster uses), otherwise the row keeps
                // whatever URL it already had (data-existing-url) from a
                // previous save.
                const rows = Array.from(document.querySelectorAll('#fileArrayWrapper .array-item-row'));
                for (let i = 0; i < rows.length; i++) {
                    const row = rows[i];
                    const labelVal = row.querySelector('.file-label-item').value.trim();
                    if (!labelVal) continue;

                    let exampleUrl = row.dataset.existingUrl || '';
                    if (row.pendingExampleFile) {
                        const file = row.pendingExampleFile;
                        const ext = file.name.split('.').pop();
                        const fileName = `docexample_${editingCourseId || 'new'}_${i}_${Date.now()}.${ext}`;
                        const { error: exUpErr } = await client.storage.from('course-images').upload(fileName, file, { upsert: true });
                        if (exUpErr) {
                            alert(`Reference image upload failed for "${labelVal}": ` + exUpErr.message);
                            return;
                        }
                        exampleUrl = client.storage.from('course-images').getPublicUrl(fileName).data.publicUrl;
                    }

                    file_labels.push(labelVal);
                    file_examples.push(exampleUrl);
                }
                required_files = file_labels.length;
            }

            const targetingSelections = collectTargetingSelections();
            if (!targetingSelections) return;

            // Defensive re-check right before saving — each page-number
            // input's own change handler already blocks a skipped page as
            // it's typed, but this catches any stale UI state (e.g. a
            // question removed after another was already set to a
            // now-unreachable page). Spans every numberable item across
            // Target Designations, Required Documents, Institutional
            // Allocations, Custom Questions, and Page Content together.
            if (!validateNoPageGapsAnywhere()) {
                alert("Page numbers must be sequential with no gaps — make sure page 1, then page 2, and so on are each used before assigning the next page number.");
                return;
            }

            const section_pages = collectSectionPages();
            const page_titles = collectPageTitles();

            const theme_color = document.getElementById('courseThemeColor').value || '#7C3AED';

            let image_url = existingCourseImageUrl || null;
            if (pendingCourseImageFile) {
                const ext = pendingCourseImageFile.name.split('.').pop();
                const fileName = `course_${editingCourseId || 'new'}_${Date.now()}.${ext}`;
                const { error: imgUpErr } = await client.storage.from('course-images').upload(fileName, pendingCourseImageFile, { upsert: true });
                if (imgUpErr) {
                    alert("Featured image upload failed: " + imgUpErr.message);
                    return;
                }
                image_url = client.storage.from('course-images').getPublicUrl(fileName).data.publicUrl;
            }

            if (editingCourseId) {
                const { error: updErr } = await client.from('courses').update({
                    name, course_date, activity_end_date, seats, required_files, file_labels, file_examples, allowed_sex, allowed_designations, instructor_name, participant_count, attendance_required, activity_type, course_end_date, registration_opens_date, description,
                    designation_seats, theme_color, image_url, unlimited_seats, ...targetingSelections,
                    section_pages, page_titles
                }).eq('id', editingCourseId);
                if (updErr) {
                    alert("Matrix transaction insertion execution error: " + updErr.message);
                    return;
                }

                await client.from('course_institutions').delete().eq('course_id', editingCourseId);
                await pushAllocationRecords(editingCourseId);
                await pushCustomQuestions(editingCourseId);
                await pushPageContentBlocks(editingCourseId);
                await bookHallIfRequested(name);

                alert("Course configurations updated successfully.");
                setTimeout(exitEditOperationalMode, 1200);
            } else {
                const { data: newCourse, error: insErr } = await client.from('courses').insert({
                    name, course_date, activity_end_date, seats, required_files, file_labels, file_examples, allowed_sex, allowed_designations, instructor_name, participant_count, attendance_required, activity_type, course_end_date, registration_opens_date, description,
                    designation_seats, theme_color, image_url, unlimited_seats, ...targetingSelections,
                    section_pages, page_titles
                }).select().single();
                if (insErr) {
                    alert("Creation module error pipeline rejection: " + insErr.message);
                    return;
                }

                await bumpNewCourseToTopOfDashboard(newCourse.id);
                await pushAllocationRecords(newCourse.id);
                await pushCustomQuestions(newCourse.id);
                await pushPageContentBlocks(newCourse.id);
                await bookHallIfRequested(name);
                alert("New managed course added successfully.");

                // Same pattern as exitEditOperationalMode() below (used after
                // an edit) — a brief pause so the success toast is visible,
                // then straight to the Activity Dashboard to see it listed.
                setTimeout(() => { window.location.href = 'dashboard.html'; }, 1200);
            }
        }

        // ============================================================================
        // Optional hall booking from within Create Activity — reuses the exact
        // same rules as the standalone Hall Reservation page (per-day rows so
        // the existing overlap protection keeps working unmodified, a shared
        // booking_group_id for multi-day ranges, and the same friendly
        // pre-check). A failure here does NOT roll back the course that was
        // just saved — the course save already succeeded, so this only ever
        // shows its own separate message rather than pretending the whole
        // operation failed.
        // ============================================================================
        async function bookHallIfRequested(activityName) {
            if (!document.getElementById('bookHallToggle').checked) return;

            const hall = document.getElementById('chBallSelect').value;
            const reservation_type = document.getElementById('chReservationType').value;
            const writer_name = document.getElementById('chEntranceName').value.trim() || null;
            const organizer_name = document.getElementById('chOrganizerName').value.trim() || null;
            const phone_number = document.getElementById('chPhoneNumber').value.trim() || null;

            const isWeeklyRepeat = document.getElementById('chWeeklyRepeatToggle').checked;
            let entries;

            if (isWeeklyRepeat) {
                const startDate = document.getElementById('chWeeklyStartDate').value;
                const weeklyStart = document.getElementById('chWeeklyStartTime').value;
                const weeklyEnd = document.getElementById('chWeeklyEndTime').value;
                const weekCount = parseInt(document.getElementById('chWeeklyCount').value, 10) || 0;
                if (!startDate || !weeklyStart || !weeklyEnd) {
                    alert("Activity saved, but the hall wasn't booked — please fill in the first date and both times for the weekly repeat.");
                    return;
                }
                if (weeklyStart >= weeklyEnd) {
                    alert("Activity saved, but the hall wasn't booked — end time must be after start time.");
                    return;
                }
                if (weekCount < 1) {
                    alert("Activity saved, but the hall wasn't booked — please enter at least 1 week.");
                    return;
                }
                entries = collectChWeeklyRepeatEntries();
            } else {
                // Checked directly on the rows (not the expanded entries) —
                // a backwards range (To before From) would otherwise just
                // silently produce zero days for that row.
                const rows = document.querySelectorAll('#chDatesContainer .hall-date-entry-row');
                for (const row of rows) {
                    const dateFrom = row.querySelector('.ch-entry-date-from').value;
                    const dateTo = row.querySelector('.ch-entry-date-to').value;
                    if (!dateFrom || !dateTo) {
                        alert("Activity saved, but the hall wasn't booked — please fill in both dates for every entry.");
                        return;
                    }
                    if (dateTo < dateFrom) {
                        alert(`Activity saved, but the hall wasn't booked — "To" date must be on or after "From" date (${dateFrom}).`);
                        return;
                    }
                }
                entries = collectChDateEntries();
            }

            for (const entry of entries) {
                if (!entry.reservation_date || !entry.start_time || !entry.end_time) {
                    alert("Activity saved, but the hall wasn't booked — please fill in every date and both times for each entry.");
                    return;
                }
                if (entry.start_time >= entry.end_time) {
                    alert(`Activity saved, but the hall wasn't booked — end time must be after start time (${entry.reservation_date}).`);
                    return;
                }
            }
            // Two entries in the SAME submission clashing with each other.
            for (let i = 0; i < entries.length; i++) {
                for (let j = i + 1; j < entries.length; j++) {
                    if (entries[i].reservation_date === entries[j].reservation_date &&
                        entries[i].start_time < entries[j].end_time && entries[i].end_time > entries[j].start_time) {
                        alert(`Activity saved, but the hall wasn't booked — two of your own entries overlap on ${entries[i].reservation_date}.`);
                        return;
                    }
                }
            }

            const dates = entries.map(en => en.reservation_date);
            const { data: existingOnDates, error: checkErr } = await client
                .from('hall_reservations')
                .select('reservation_date, start_time, end_time, course_name')
                .eq('hall', hall)
                .in('reservation_date', dates);
            if (checkErr) {
                alert("Activity saved, but couldn't check hall availability: " + checkErr.message);
                return;
            }
            for (const entry of entries) {
                const clash = (existingOnDates || []).find(r =>
                    r.reservation_date === entry.reservation_date &&
                    entry.start_time < r.end_time && entry.end_time > r.start_time
                );
                if (clash) {
                    alert(`Activity saved, but ${hall} is already booked on ${clash.reservation_date} from ${clash.start_time} to ${clash.end_time} (${clash.course_name}) — book it separately from the Hall Reservation page once that's resolved.`);
                    return;
                }
            }

            const booking_group_id = entries.length > 1 ? crypto.randomUUID() : null;
            const rows = entries.map(entry => ({
                hall, course_name: activityName, reservation_type, writer_name, organizer_name, phone_number,
                reservation_date: entry.reservation_date, start_time: entry.start_time, end_time: entry.end_time,
                booking_group_id
            }));

            const { error: insErr } = await client.from('hall_reservations').insert(rows);
            if (insErr) {
                if (insErr.code === '23P01') {
                    alert(`Activity saved, but ${hall} was just booked for an overlapping time by someone else — book it separately from the Hall Reservation page.`);
                } else {
                    alert("Activity saved, but the hall booking failed: " + insErr.message);
                }
            }
        }

        async function pushAllocationRecords(courseId) {
            const allocationRows = [];
            const checkboxes = document.querySelectorAll('.inst-checkbox-target');
            
            checkboxes.forEach(chk => {
                if (chk.checked) {
                    const instId = Number(chk.getAttribute('data-id'));
                    const currentCount = parseInt(chk.getAttribute('data-current-count'), 10) || 0;
                    const slotsInput = document.querySelector(`.inst-slots-target[data-id="${instId}"]`);
                    // BUG FIXED: `parseInt(...) || 1` silently turned an
                    // intentional 0 (meaning "unlimited for this
                    // institution") into 1, since 0 is falsy in JS and `||`
                    // falls through to the default for ANY falsy value, not
                    // just NaN/missing. Checking Number.isFinite explicitly
                    // instead preserves a real 0 while still falling back
                    // to 1 for a genuinely empty/invalid field.
                    const parsedSlots = slotsInput ? parseInt(slotsInput.value, 10) : NaN;
                    const max_slots = Number.isFinite(parsedSlots) ? parsedSlots : 1;
                    
                    allocationRows.push({
                        course_id: courseId,
                        institution_id: instId,
                        max_slots: max_slots,
                        registered_count: currentCount
                    });
                }
            });
            if (allocationRows.length > 0) {
                await client.from('course_institutions').insert(allocationRows);
            }
        }

        // A real sync, NOT delete-and-reinsert. This used to delete every
        // question row for this course and reinsert them fresh on every
        // single save — including a save that changed nothing about the
        // questions at all (just the course title, dates, etc.). Every
        // participant's submitted answer references its question by id
        // with `on delete cascade` (sql/course-custom-questions.sql /
        // workshops.sql), so that blanket delete silently wiped every
        // registrant's custom-question answers on ANY edit to the course.
        //
        // Now: a question that's kept (`q.id` still set, even with edited
        // text/options) is UPSERTED onto its own existing row, so its id —
        // and every answer already submitted against it — survives. Only a
        // question actually removed from the form gets deleted, which is
        // the one case where cascading away its answers is correct. A
        // brand-new question (no `q.id` yet) is inserted fresh, as before.
        async function pushCustomQuestions(courseId) {
            const rows = customQuestions
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

            let deleteQuery = client.from('course_questions').delete().eq('course_id', courseId);
            if (keptIds.length > 0) deleteQuery = deleteQuery.not('id', 'in', `(${keptIds.join(',')})`);
            await deleteQuery;

            if (keptRows.length > 0) {
                await client.from('course_questions')
                    .upsert(keptRows.map(r => ({ ...r, course_id: courseId })), { onConflict: 'id' });
            }
            if (newRows.length > 0) {
                await client.from('course_questions')
                    .insert(newRows.map(r => ({ ...r, course_id: courseId })));
            }
        }

        // Same delete-and-reinsert pattern as pushCustomQuestions/
        // pushAllocationRecords — the revived activity_contents table
        // (see sql/course-page-content.sql), now keyed by page_number
        // instead of the old content_order-only anchor scheme.
        // content_order still controls display order for multiple blocks
        // sharing the same page.
        async function pushPageContentBlocks(courseId) {
            await client.from('activity_contents').delete().eq('course_id', courseId);

            const rows = pageContentBlocks
                .filter(b => (b.content || '').trim())
                .map((b, idx) => ({
                    course_id: courseId,
                    title: (b.title || '').trim() || null,
                    content: b.content.trim(),
                    content_order: idx,
                    page_number: Math.max(1, b.page_number || 1)
                }));

            if (rows.length > 0) {
                await client.from('activity_contents').insert(rows);
            }
        }

        function showCourseImagePreview(url) {
            const box = document.getElementById('courseImagePreviewBox');
            const img = document.getElementById('courseImagePreview');
            if (url) {
                img.src = url;
                box.style.display = 'block';
            } else {
                img.src = '';
                box.style.display = 'none';
            }
        }

        document.getElementById('courseThemeColor').addEventListener('input', (e) => {
            document.getElementById('courseThemeColorPreview').textContent = e.target.value.toUpperCase();
        });

        document.getElementById('courseImageInput').addEventListener('change', (e) => {
            const file = e.target.files[0] || null;
            pendingCourseImageFile = file;
            if (file) {
                showCourseImagePreview(URL.createObjectURL(file));
            } else if (existingCourseImageUrl) {
                showCourseImagePreview(existingCourseImageUrl);
            }
        });

        document.getElementById('removeCourseImageBtn').addEventListener('click', () => {
            pendingCourseImageFile = null;
            existingCourseImageUrl = null;
            document.getElementById('courseImageInput').value = '';
            showCourseImagePreview(null);
        });

        window.pushFileRuleInputRow = pushFileRuleInputRow;
        document.getElementById('addFileRuleRowBtn').addEventListener('click', () => pushFileRuleInputRow('', ''));
        document.getElementById('cancelEditBtn').addEventListener('click', exitEditOperationalMode);
        document.getElementById('courseConfigForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = document.getElementById('submitFormBtn');
            // Clicking Save more than once before the first submission
            // finishes previously had no protection at all — each click
            // independently ran the full save logic, including its own
            // separate insert, which is exactly how an activity ended up
            // saved twice. Ignoring any click while one is already in
            // flight, rather than trying to guard every early-return
            // validation check inside handleFormSubmission individually,
            // keeps this fix isolated to the one place that actually needs
            // it.
            if (submitBtn.disabled) return;
            submitBtn.disabled = true;
            const originalBtnText = submitBtn.textContent;
            submitBtn.textContent = editingCourseId ? 'Updating…' : 'Saving…';
            try {
                await handleFormSubmission(e);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
            }
        });
        
        document.getElementById('allocationBulkSelectAction').addEventListener('change', handleBulkSelectionToggle);
        document.getElementById('applyBulkSeatsBtn').addEventListener('click', handleBulkSeatsOverride);

        /* Preset Button Event Listeners */
        document.getElementById('loadBlsPresetBtn').addEventListener('click', () => loadCoursePreset('BLS'));
        document.getElementById('loadAclsPresetBtn').addEventListener('click', () => loadCoursePreset('ACLS'));
        
        document.getElementById('allocationSectionToggle').addEventListener('change', (e) => {
            document.getElementById('allocationSectionBody').classList.toggle('hidden-element', !e.target.checked);
        });

        (async function init() {
            await seedAndFetchMasterInstitutions();
            pushFileRuleInputRow('Required Document', '');
            renderAllocationMappingFramework([]);
            // The checkbox is checked BY DEFAULT in the HTML for a new
            // activity — applying its state explicitly here once, rather
            // than only reacting to a future 'change' event, is what
            // actually makes that default consistent with the
            // institution fields from the very first render.
            applyUnlimitedSeatsStateToInstitutions(document.getElementById('unlimitedSeatsToggle').checked);
            renderCustomQuestionsList();
            renderDesignationCheckboxGrid();
            renderAllTargetingFieldGroups();
            wireTargetingFieldEvents();
            renderPageContentList();
            wirePlainSectionPageInput('documentsPageInput');
            wirePlainSectionPageInput('allocationsPageInput');
            IDENTITY_PAGE_FIELDS.forEach(field => wirePlainSectionPageInput(field.id));
            renderPageTitlesSummary();

            const params = new URLSearchParams(window.location.search);
            const editId = params.get('edit_id');
            if (editId) {
                await triggerEditOperationalMode(editId);
            }
        })();
        
        window.clearForm = async function() {
            if (!(await confirmCard("⚠️ Are you sure you want to clear all fields? This action cannot be undone."))) {
                return;
            }
        
            const form = document.getElementById('courseConfigForm');
            form.reset();
            document.getElementById('courseComment').value = '';

            // form.reset() alone doesn't clean up the dynamically-built
            // date entries or the weekly-repeat panel's visibility state —
            // those are managed by JS, not native form fields.
            document.getElementById('chDatesContainer').innerHTML = '';
            addChDateEntryRow('', '', '', '');
            document.getElementById('chWeeklyRepeatBox').classList.add('hidden-element');
            document.getElementById('chWeeklyHint').style.display = 'none';
            document.getElementById('chDatesContainer').classList.remove('hidden-element');
            document.getElementById('chAddDateBtn').classList.remove('hidden-element');
            document.getElementById('chWeeklyCount').value = 4;
        
            document.getElementById('customDesignationsBox').classList.add('hidden-element');
            document.getElementById('documentRulesConfigContainer').classList.add('hidden-element');
            document.getElementById('allocationSectionBody').classList.add('hidden-element');
            customQuestions = [];
            renderCustomQuestionsList();
            pageContentBlocks = [];
            renderPageContentList();
            pageTitlesMap = {};

            const fileWrapper = document.getElementById('fileArrayWrapper');
            if (fileWrapper) { fileWrapper.innerHTML = ''; }
        
            document.getElementById('designationModeSelect').value = 'All';
            document.getElementById('documentRequirementSelect').value = 'No';
            renderDesignationCheckboxGrid();
            syncDesignationSeatInputVisibility();

            document.getElementById('courseSeats').classList.add('hidden-element');
            document.getElementById('courseSeats').value = '';

            document.getElementById('bookHallFields').classList.add('hidden-element');

            document.getElementById('courseThemeColor').value = '#7C3AED';
            document.getElementById('courseThemeColorPreview').textContent = '#7C3AED';
            pendingCourseImageFile = null;
            existingCourseImageUrl = null;
            document.getElementById('courseImageInput').value = '';
            showCourseImagePreview(null);
            
            // Re-render empty selection map
            renderAllocationMappingFramework([]);
            // form.reset() above restores the checkbox to its checked-by-
            // default HTML state, same as a fresh page load — this keeps
            // the institution fields consistent with that.
            applyUnlimitedSeatsStateToInstitutions(document.getElementById('unlimitedSeatsToggle').checked);
            resetTargetingSelections();

            // resetTargetingSelections() already zeroes each targeting
            // field's own page input back to 1 — only the two static,
            // whole-section ones (Required Documents / Institutional
            // Allocations) need resetting here.
            const docsPageInput = document.getElementById('documentsPageInput');
            if (docsPageInput) { docsPageInput.value = 1; docsPageInput.dataset.prevValue = 1; }
            const allocPageInput = document.getElementById('allocationsPageInput');
            if (allocPageInput) { allocPageInput.value = 1; allocPageInput.dataset.prevValue = 1; }
            renderPageTitlesSummary();

            alert("Form cleared successfully.");
        };