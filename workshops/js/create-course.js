import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

        const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        let editingCourseId = null;
        // The description field was removed from the UI, but we still don't want
        // to wipe out an existing course's description on save — this holds
        // whatever value was already there (null for a brand new course).
        let preservedDescription = null;
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
        let customQuestions = []; // [{ id?, question_type, question_text, options: [], grid_rows: [], grid_columns: [] }]

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
            box.querySelectorAll('.cq-remove-question-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    customQuestions.splice(Number(e.target.dataset.qidx), 1);
                    renderCustomQuestionsList();
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
            customQuestions.push({ question_type: 'text', question_text: '', options: [], grid_rows: [], grid_columns: [] });
            renderCustomQuestionsList();
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
                options: ['In-Person Attendance', 'Virtual', 'Hybrid']
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
            row.innerHTML = `
                <div style="display: flex; gap: 10px; align-items: center; width: 100%;">
                    <input type="text" class="file-label-item" placeholder="Document Label (e.g. ACLS Card)" value="${labelVal}" required style="flex: 1;">
                    <input type="text" class="file-example-item" placeholder="Reference Guide Image URL" value="${exampleVal}" style="flex: 1;">
                    <button type="button" class="btn-remove">✕</button>
                </div>
                <div class="row-image-preview-box" style="margin-top: 8px; display: ${exampleVal ? 'block' : 'none'};">
                    <img src="${exampleVal || ''}" style="max-width: 100px; max-height: 100px; object-fit: contain; border-radius: 6px; border: 1px solid #cbd5e1; display: block;"
                    onerror="this.parentElement.style.display='none'">
                </div>
            `;
            const linkInput = row.querySelector('.file-example-item');
            const previewBox = row.querySelector('.row-image-preview-box');
            const previewImg = previewBox.querySelector('img');
            linkInput.addEventListener('input', () => {
                const url = linkInput.value.trim();
                if (url) {
                    previewImg.src = url;
                    previewBox.style.display = 'block';
                } else {
                    previewBox.style.display = 'none';
                    previewImg.src = '';
                }
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
            const existingNames = new Set((existing || []).map(i => i.name));
            const missing = masterInstitutionsAndDepartments.filter(name => !existingNames.has(name));

            if (missing.length > 0) {
                await client.from('institutions').insert(missing.map(name => ({ name })));
            }

            const { data: updated } = await client.from('institutions').select('*');
            globalInstitutionsList = updated || existing || [];
            // Temporary diagnostic — if a newly-added institution still
            // doesn't appear in the picker, check this in DevTools Console
            // and report the count/names shown here, since code review alone
            // hasn't turned up why it wouldn't.
            console.log('[institutions] loaded', globalInstitutionsList.length, 'total:', globalInstitutionsList.map(i => i.name));
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

        document.getElementById('unlimitedSeatsToggle').addEventListener('change', (e) => {
            const seatsInput = document.getElementById('courseSeats');
            if (e.target.checked) {
                seatsInput.classList.add('hidden-element');
                seatsInput.value = '';
            } else {
                seatsInput.classList.remove('hidden-element');
            }
        });

        document.getElementById('bookHallToggle').addEventListener('change', (e) => {
            document.getElementById('bookHallFields').classList.toggle('hidden-element', !e.target.checked);
        });

        // Auto-fill "Entrance Name" from whoever is currently signed in,
        // same as the standalone Hall Reservation form — still editable.
        try {
            const raw = localStorage.getItem('ibra_admin_session');
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
            document.getElementById('courseRegOpenDate').value = course.registration_opens_date || '';
            const isUnlimited = !!course.unlimited_seats;
            document.getElementById('unlimitedSeatsToggle').checked = isUnlimited;
            document.getElementById('courseSeats').value = isUnlimited ? '' : (course.seats !== undefined ? course.seats : '');
            document.getElementById('courseSeats').classList.toggle('hidden-element', isUnlimited);
            document.getElementById('courseGender').value = course.allowed_sex || 'Both';
            document.getElementById('courseInstructorName').value = course.instructor_name || '';
            document.getElementById('courseParticipantCount').value = course.participant_count || '';
            document.getElementById('courseAttendanceRequired').checked = course.attendance_required !== false;
            document.getElementById('courseEndDate').value = course.course_end_date || '';
            preservedDescription = course.description || null;

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
                grid_columns: Array.isArray(q.grid_columns) ? q.grid_columns : []
            }));
            renderCustomQuestionsList();

            populateTargetingSelections(course);
        }

        function exitEditOperationalMode() {
            window.location.href = 'dashboard.html';
        }

        // Sentinel used internally when a course has unlimited seats, so the
        // existing ">0" checks and per-registration decrement elsewhere in the
        // app keep working unmodified. The UI always reads unlimited_seats
        // (not this number) to decide what to display.
        const UNLIMITED_SEATS_SENTINEL = 999999;

        async function handleFormSubmission(e) {
            e.preventDefault();
            const name = document.getElementById('courseName').value.trim();
            const course_date = document.getElementById('courseDate').value;
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
            const description = preservedDescription;
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
                const labelElements = document.querySelectorAll('.file-label-item');
                const exampleElements = document.querySelectorAll('.file-example-item');
                
                labelElements.forEach((el, index) => {
                    const labelVal = el.value.trim();
                    if(labelVal) {
                        file_labels.push(labelVal);
                        file_examples.push(exampleElements[index] ? exampleElements[index].value.trim() : '');
                    }
                });
                required_files = file_labels.length;
            }

            const targetingSelections = collectTargetingSelections();
            if (!targetingSelections) return;

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
                    name, course_date, seats, required_files, file_labels, file_examples, allowed_sex, allowed_designations, instructor_name, participant_count, attendance_required, course_end_date, registration_opens_date, description,
                    designation_seats, theme_color, image_url, unlimited_seats, ...targetingSelections
                }).eq('id', editingCourseId);
                if (updErr) {
                    alert("Matrix transaction insertion execution error: " + updErr.message);
                    return;
                }

                await client.from('course_institutions').delete().eq('course_id', editingCourseId);
                await pushAllocationRecords(editingCourseId);
                await pushCustomQuestions(editingCourseId);
                await bookHallIfRequested(name);

                alert("Course configurations updated successfully.");
                setTimeout(exitEditOperationalMode, 1200);
            } else {
                const { data: newCourse, error: insErr } = await client.from('courses').insert({
                    name, course_date, seats, required_files, file_labels, file_examples, allowed_sex, allowed_designations, instructor_name, participant_count, attendance_required, course_end_date, registration_opens_date, description,
                    designation_seats, theme_color, image_url, unlimited_seats, ...targetingSelections
                }).select().single();
                if (insErr) {
                    alert("Creation module error pipeline rejection: " + insErr.message);
                    return;
                }

                await pushAllocationRecords(newCourse.id);
                await pushCustomQuestions(newCourse.id);
                await bookHallIfRequested(name);
                alert("New managed course added successfully.");
                
                document.getElementById('courseDate').value = '';
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
            const date_from = document.getElementById('chDateFrom').value;
            const date_to = document.getElementById('chDateTo').value || date_from;
            const start_time = document.getElementById('chStartTime').value;
            const end_time = document.getElementById('chEndTime').value;

            if (!date_from || !start_time || !end_time) {
                alert("Activity saved, but the hall wasn't booked — date and both times are required for that part.");
                return;
            }
            if (date_to < date_from || start_time >= end_time) {
                alert("Activity saved, but the hall wasn't booked — check that the date range and times are valid.");
                return;
            }

            const dates = [];
            let cursor = date_from;
            let guard = 0;
            while (cursor <= date_to && guard < 366) {
                dates.push(cursor);
                const [y, m, d] = cursor.split('-').map(Number);
                const next = new Date(y, m - 1, d + 1);
                cursor = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
                guard++;
            }

            const { data: existingInRange, error: checkErr } = await client
                .from('hall_reservations')
                .select('reservation_date, start_time, end_time, course_name')
                .eq('hall', hall)
                .gte('reservation_date', date_from)
                .lte('reservation_date', date_to);
            if (checkErr) {
                alert("Activity saved, but couldn't check hall availability: " + checkErr.message);
                return;
            }
            const clash = (existingInRange || []).find(r => start_time < r.end_time && end_time > r.start_time);
            if (clash) {
                alert(`Activity saved, but ${hall} is already booked on ${clash.reservation_date} from ${clash.start_time} to ${clash.end_time} (${clash.course_name}) — book it separately from the Hall Reservation page once that's resolved.`);
                return;
            }

            const booking_group_id = dates.length > 1 ? crypto.randomUUID() : null;
            const rows = dates.map(reservation_date => ({
                hall, course_name: activityName, reservation_type, writer_name, organizer_name, phone_number,
                reservation_date, start_time, end_time, booking_group_id
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
                    const max_slots = slotsInput ? parseInt(slotsInput.value, 10) || 1 : 1;
                    
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

        // Always deletes and re-inserts, same pattern as allocations — simpler
        // and safer than diffing which questions changed, since edits here
        // are infrequent and the whole set is small.
        async function pushCustomQuestions(courseId) {
            await client.from('course_questions').delete().eq('course_id', courseId);

            const rows = customQuestions
                .filter(q => q.question_text.trim())
                .map((q, idx) => ({
                    course_id: courseId,
                    question_type: q.question_type,
                    question_text: q.question_text.trim(),
                    options: OPTION_BASED_TYPES.includes(q.question_type) ? q.options.filter(o => o.trim()) : [],
                    grid_rows: GRID_TYPES.includes(q.question_type) ? q.grid_rows.filter(r => r.trim()) : [],
                    grid_columns: GRID_TYPES.includes(q.question_type) ? q.grid_columns.filter(c => c.trim()) : [],
                    display_order: idx
                }));

            if (rows.length > 0) {
                await client.from('course_questions').insert(rows);
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
        document.getElementById('courseConfigForm').addEventListener('submit', handleFormSubmission);
        
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
            renderCustomQuestionsList();
            renderDesignationCheckboxGrid();
            renderAllTargetingFieldGroups();
            wireTargetingFieldEvents();

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
            preservedDescription = null;
        
            document.getElementById('customDesignationsBox').classList.add('hidden-element');
            document.getElementById('documentRulesConfigContainer').classList.add('hidden-element');
            document.getElementById('allocationSectionBody').classList.add('hidden-element');
            customQuestions = [];
            renderCustomQuestionsList();
        
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
            resetTargetingSelections();
            alert("Form cleared successfully.");
        };