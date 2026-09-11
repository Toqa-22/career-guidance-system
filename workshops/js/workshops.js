import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

        const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        let coursesCached = [];
        let courseInstitutionsMapCached = [];
        let registrationLogsCached = [];

        const departmentsList = [
            "Emergency Department Doctor", "Emergency Department Nurse", "Internal Medicine Department", "General Surgery Department",
            "Paediatrician", "Obstetrics and Gynecology Department", "Orthopedics Department",
            "Ophthalmology Department", "ENT Department", "Anesthesia Department",
            "Dialysis Unit Nurse", "Radiology Department", "Laboratory Department",
            "Physiotherapy Department", "Clinical Nutrition Department", "Pharmacy Department",
            "Male Medical and Surgical Ward", "Female Medical and Surgical Ward", "Pediatrics Ward",
            "Obstetrics and Gynecology Ward", "Adult Intensive Care Unit (ICU)", "Special Care Baby Unit (SCBU)",
            "OPD", "Nephrologist", "DS Nurse", "OT Nurse", "RT"
        ];

        const DESIGNATION_OPTIONS = [
            'Doctors', 'Nurses', 'Pharmacists', 'Assistant Pharmacists', 'Nutritionists',
            'Radiographers', 'Physiotherapists', 'Laboratory Technicians', 'Dental Assistants',
            'Administrative Staff', 'Finance Staff', 'IT Staff', 'Engineers',
            'Respiratory Therapists', 'Legal Affairs', 'Other'
        ];
        const OTHER_CATCHALL_NAME = "Other (Please Specify)";

        // ============================================================================
        // Per-course theme color — the admin picks one base color in Create Course;
        // here we derive a light/dark range from it (via HSL) and push those as CSS
        // custom properties so buttons/accents across this page follow it.
        // ============================================================================
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

        const DEFAULT_THEME_COLOR = '#7C3AED';

        // A course's registration window closes once its (optional)
        // "Registration Closes On" date has passed — course_end_date is the
        // literal column set in Create Course; if it isn't set, registration
        // just stays open (no course_date fallback, since course_date is the
        // event date itself, not a deadline).
        function isRegistrationOpen(course) {
            const now = new Date();
            if (course.registration_opens_date) {
                const opens = new Date(course.registration_opens_date + 'T00:00:00');
                if (now < opens) return false;
            }
            if (course.course_end_date) {
                const deadline = new Date(course.course_end_date + 'T23:59:59');
                if (now > deadline) return false;
            }
            return true;
        }

        // Distinguishes *why* registration isn't open, for the closed-state
        // message on the Featured card — "not open yet" vs. "already ended"
        // are different situations worth telling the admin/visitor apart.
        function registrationStatusMessage(course) {
            const now = new Date();
            if (course.registration_opens_date) {
                const opens = new Date(course.registration_opens_date + 'T00:00:00');
                if (now < opens) return `Registration opens on ${course.registration_opens_date}.`;
            }
            return 'Registration for this course has ended.';
        }

        function hasOpenSeats(course) {
            return !!course.unlimited_seats || course.seats > 0;
        }

        function seatsLabel(course) {
            return course.unlimited_seats ? 'Unlimited seats' : `${course.seats} total seats left`;
        }

        function applyCourseTheme(rawColor) {
            const base = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(rawColor || '') ? rawColor : DEFAULT_THEME_COLOR;
            const root = document.documentElement.style;
            root.setProperty('--course-theme', base);
            root.setProperty('--course-theme-light', shadeColor(base, 16));
            root.setProperty('--course-theme-dark', shadeColor(base, -16));
        }

        // The hero starts hidden (see the "theme-loading" class in the HTML/CSS)
        // so the visitor never sees the default purple flash before the real
        // course color is known — this reveals it once that color is applied.
        // The timeout is a failsafe in case the initial fetch is ever slow.
        function revealHero() {
            document.body.classList.remove('theme-loading');
        }
        setTimeout(revealHero, 1800);

        // ============================================================================
        // Click-to-enlarge image lightbox — used by the Featured Workshop image.
        // ============================================================================
        function openImageLightbox(url, altText) {
            const overlay = document.createElement('div');
            overlay.className = 'image-lightbox-overlay';
            overlay.innerHTML = `<button type="button" class="image-lightbox-close" aria-label="Close">✕</button><img src="${url}" alt="${(altText || '').replace(/"/g, '&quot;')}">`;
            const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
            const onKey = (ev) => { if (ev.key === 'Escape') close(); };
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay || e.target.classList.contains('image-lightbox-close')) close();
            });
            document.addEventListener('keydown', onKey);
            document.body.appendChild(overlay);
        }

        document.addEventListener('click', (e) => {
            const trigger = e.target.closest('[data-lightbox-img]');
            if (trigger) openImageLightbox(trigger.getAttribute('data-lightbox-img'), trigger.getAttribute('alt'));
        });

        // ============================================================================
        // Target Audience & Registration Options — 8 fields. This exact same shape
        // (key + options) is duplicated in js/create-course.js for the admin allocation side;
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

        // Fields that only appear once a course has been chosen
        const REST_OF_FORM_IDS = [
            'staffName', 'staffNumber', 'phoneNumber', 'sexSelect',
            'designationFieldWrapper', 'specializationInput',
            'institutionFieldWrapper', 'submitRowContainer',
            ...TARGETING_FIELDS.map(f => 'regFieldWrapper_' + f.key)
        ];

        function toggleFormVisibility(show) {
            REST_OF_FORM_IDS.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.toggle('hidden-element', !show);
            });
        }

        // ====================================================================
        // Staff Number step — "one participant, one staff number, one
        // participant record, many course registrations" (see sql/participants.sql).
        // A course selection reveals ONLY this step first; the rest of the
        // form (REST_OF_FORM_IDS above) only appears once this resolves —
        // either an existing participant is found and their saved info is
        // loaded, or the staff number is new and the form opens blank, same
        // as it always has.
        // ====================================================================
        let matchedParticipant = null; // the participants row found for the entered staff number, or null for a brand-new one
        let enteredStaffNumberRaw = ''; // what they actually typed at the gate, for the brand-new (no match) case

        function normalizeStaffNumber(raw) {
            return (raw || '').trim().toLowerCase();
        }

        function setAlreadyRegisteredNoticeVisible(show) {
            document.getElementById('alreadyRegisteredNotice').classList.toggle('hidden-element', !show);
            document.getElementById('closeAlreadyRegisteredBtn').classList.toggle('hidden-element', !show);
        }

        function setNotEligibleNotice(message) {
            const box = document.getElementById('notEligibleNotice');
            box.textContent = message || '';
            box.classList.toggle('hidden-element', !message);
            document.getElementById('closeNotEligibleBtn').classList.toggle('hidden-element', !message);
        }

        // Checks a RETURNING participant's own saved profile against this
        // course's eligibility rules — a brand-new (unmatched) staff number
        // has nothing saved to conflict with yet, so this only ever runs
        // for a match. Course-specific answers (the 8 targeting fields,
        // designation, institution) are only a real restriction when the
        // course actually narrows them — an untouched "All"/empty value
        // means anyone qualifies, so those are skipped rather than flagged.
        function getEligibilityBlockReason(participant, course, courseId) {
            if (course.allowed_sex === 'Male' && participant.sex && participant.sex !== 'Male') {
                return 'This activity is open to Male participants only, and your saved profile has you as Female.';
            }
            if (course.allowed_sex === 'Female' && participant.sex && participant.sex !== 'Female') {
                return 'This activity is open to Female participants only, and your saved profile has you as Male.';
            }

            if (course.allowed_designations) {
                let list;
                try {
                    list = Array.isArray(course.allowed_designations) ? course.allowed_designations : JSON.parse(course.allowed_designations);
                } catch (e) { list = null; }
                if (Array.isArray(list) && list.length > 0 && !list.includes('All') && participant.designation_category && !list.includes(participant.designation_category)) {
                    return `This activity is limited to specific designations, and your saved designation (${participant.designation_category}) isn't one of them.`;
                }
            }

            const mappingsForCourse = courseInstitutionsMapCached.filter(m => m.course_id === courseId);
            if (mappingsForCourse.length > 0 && participant.institution_id) {
                const isAllowed = mappingsForCourse.some(m => m.institution_id === participant.institution_id);
                if (!isAllowed) {
                    return 'This activity is limited to specific institutions/departments, and your saved institution isn\'t one of them.';
                }
            }

            for (const field of TARGETING_FIELDS) {
                let list;
                try {
                    const raw = course[field.key];
                    list = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw.trim() !== '' ? JSON.parse(raw) : []);
                } catch (e) { list = []; }
                if (list.length === 0 || list.includes('All')) continue;
                const participantValue = participant[field.key];
                if (participantValue && !list.includes(participantValue)) {
                    return `This activity requires a specific ${field.label}, and your saved ${field.label} (${participantValue}) doesn't match.`;
                }
            }

            return null;
        }

        function resetStaffGate() {
            matchedParticipant = null;
            enteredStaffNumberRaw = '';
            document.getElementById('staffNumberGateInput').value = '';
            document.getElementById('staffGateMessage').classList.add('hidden-element');
            document.getElementById('staffGateSummary').classList.add('hidden-element');
            document.getElementById('staffGateWrapper').classList.remove('hidden-element');
            document.getElementById('courseSelectWrapper').classList.add('hidden-element');
            setAlreadyRegisteredNoticeVisible(false);
            setNotEligibleNotice(null);
            // A direct activity link locks the dropdown to one course (see
            // applyDirectCourseLinkFromUrl) — that choice isn't the
            // participant's to change, so it's left alone here; only the
            // free-choice picker gets cleared back to blank.
            const courseDropdown = document.getElementById('courseSelect');
            if (!courseDropdown.disabled) courseDropdown.value = '';
            toggleFormVisibility(false);

            // Not part of REST_OF_FORM_IDS (it only shows for non-attendance
            // courses, toggled separately in handleCourseSelectionChange),
            // so without this it — and whatever was typed into it — would
            // keep showing after "Change staff number" even though the
            // rest of the form just closed.
            document.getElementById('firstLogEntryContainer').classList.add('hidden-element');
            document.getElementById('firstLogTitle').value = '';
            document.getElementById('firstLogDept').value = '';
            document.getElementById('firstLogDate').value = '';
            document.getElementById('firstLogTime').value = '';
        }

        // Loads a matched participant's saved info into the (still-hidden)
        // rest-of-form fields. Institution/department options are filtered
        // per-course (filterIbraDepartments/filterOtherInstitutions), so a
        // saved institution that isn't offered for THIS course is simply
        // left for the participant to re-pick rather than forced in —
        // graceful degradation instead of a broken/invisible selection.
        function prefillFromParticipant(p) {
            document.getElementById('staffName').value = p.staff_name || '';
            document.getElementById('phoneNumber').value = p.phone_number || '';
            document.getElementById('sexSelect').value = p.sex || '';
            document.getElementById('specializationInput').value = p.specialization || '';

            const isIbra = (p.institution_name || '').startsWith('Ibra - ');
            document.getElementById('institutionTypeSelect').value = isIbra ? 'Ibra' : (p.institution_name ? 'Other' : '');
            renderInstitutionFields();
            if (isIbra) {
                const dept = (p.institution_name || '').replace('Ibra - ', '');
                const deptSelect = document.getElementById('departmentSelect');
                if (Array.from(deptSelect.options).some(o => o.value === dept)) deptSelect.value = dept;
            } else if (p.institution_name) {
                const otherSelect = document.getElementById('otherInstitutionInput');
                if (Array.from(otherSelect.options).some(o => o.value === p.institution_name)) {
                    otherSelect.value = p.institution_name;
                    handleOtherInstitutionChange();
                }
            }

            const designationSelect = document.getElementById('designationSelect');
            if (p.designation_category && Array.from(designationSelect.options).some(o => o.value === p.designation_category)) {
                designationSelect.value = p.designation_category;
            } else if (p.designation) {
                designationSelect.value = 'Other';
                document.getElementById('otherDesignationInput').value = p.designation;
            }
            handleDesignationChange();

            // Job Level, Nationality, Highest Educational Qualification,
            // Experience Years, Organization, Directorate, Type of
            // Program, Nature of Attendance — same graceful-degradation
            // rule as institution/department above: only set if this
            // course actually offers that value as an option (its
            // available options are course-specific, populated just
            // before this by updateTargetingSelectOptionsForCourse), left
            // blank for the participant to fill in themselves otherwise.
            TARGETING_FIELDS.forEach(field => {
                const select = document.getElementById('reg_' + field.key);
                const savedValue = p[field.key];
                if (select && savedValue && Array.from(select.options).some(o => o.value === savedValue)) {
                    select.value = savedValue;
                }
            });
        }

        async function handleStaffGateContinue() {
            const btn = document.getElementById('staffGateContinueBtn');
            const messageBox = document.getElementById('staffGateMessage');
            const raw = document.getElementById('staffNumberGateInput').value.trim();
            const normalized = normalizeStaffNumber(raw);
            messageBox.classList.add('hidden-element');

            if (!raw) {
                messageBox.textContent = 'Please enter your staff number.';
                messageBox.classList.remove('hidden-element');
                return;
            }

            btn.disabled = true;
            const originalText = btn.textContent;
            btn.textContent = 'Checking…';

            try {
                const { data: participant } = await client
                    .from('participants')
                    .select('*')
                    .eq('staff_number_normalized', normalized)
                    .maybeSingle();

                // Which course they're already registered for (if any) isn't
                // knowable yet — course selection comes AFTER this step now.
                // That check happens in handleCourseSelectionChange instead,
                // once both the participant and a chosen course are known.
                matchedParticipant = participant || null;
                enteredStaffNumberRaw = raw;

                document.getElementById('staffGateWrapper').classList.add('hidden-element');
                const summary = document.getElementById('staffGateSummary');
                document.getElementById('staffGateSummaryText').textContent = participant
                    ? `Registering as ${participant.staff_name || participant.staff_number} (${participant.staff_number})`
                    : `Staff Number: ${raw} (new registrant)`;
                summary.classList.remove('hidden-element');
                document.getElementById('courseSelectWrapper').classList.remove('hidden-element');

                // A direct activity link (?course=...) pre-selects and locks
                // the course dropdown BEFORE the staff gate even shows (see
                // applyDirectCourseLinkFromUrl) — in that case a course is
                // already chosen, so continue straight into course-specific
                // setup instead of waiting for a 'change' event that will
                // never fire on an already-correct, disabled dropdown.
                if (document.getElementById('courseSelect').value) {
                    handleCourseSelectionChange();
                }
            } catch (err) {
                messageBox.textContent = 'Something went wrong looking up that staff number — please try again.';
                messageBox.classList.remove('hidden-element');
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        }

        function updateGenderOptionsForCourse(courseId) {
            const select = document.getElementById('sexSelect');
            const currentValue = select.value;
            const course = coursesCached.find(c => c.id === courseId);
            const allowedSex = course ? course.allowed_sex : null;

            let allowed;
            if (allowedSex === 'Male') {
                allowed = [{ v: 'Male', t: 'Male' }];
            } else if (allowedSex === 'Female') {
                allowed = [{ v: 'Female', t: 'Female' }];
            } else {
                allowed = [{ v: 'Male', t: 'Male' }, { v: 'Female', t: 'Female' }];
            }

            let optionsHtml = '<option value="">-- Gender --</option>';
            optionsHtml += allowed.map(o => `<option value="${o.v}">${o.t}</option>`).join('');
            select.innerHTML = optionsHtml;

            select.value = allowed.some(o => o.v === currentValue) ? currentValue : '';
        }

        function updateInstitutionTypeOptionsForCourse(courseId) {
            const select = document.getElementById('institutionTypeSelect');
            const currentValue = select.value;
            const mappingsForCourse = courseInstitutionsMapCached.filter(m => m.course_id === courseId);

            const hasIbra = mappingsForCourse.some(m => m.institutions?.name?.startsWith('Ibra - '));
            const hasOther = mappingsForCourse.some(m => m.institutions?.name && !m.institutions.name.startsWith('Ibra - '));
            // If no allocation has been configured for this course at all, fall back to showing both
            // rather than blocking registration entirely.
            const noMappingConfigured = mappingsForCourse.length === 0;

            let optionsHtml = '<option value="">-- Choose Institution Option --</option>';
            if (hasIbra || noMappingConfigured) optionsHtml += '<option value="Ibra">Ibra hospital</option>';
            if (hasOther || noMappingConfigured) optionsHtml += '<option value="Other">Other hospital and health center</option>';
            select.innerHTML = optionsHtml;

            const stillValid = (currentValue === 'Ibra' && (hasIbra || noMappingConfigured)) ||
                                (currentValue === 'Other' && (hasOther || noMappingConfigured));
            select.value = stillValid ? currentValue : '';
        }

        function updateDesignationOptionsForCourse(courseId) {
            const select = document.getElementById('designationSelect');
            const currentValue = select.value;
            const course = coursesCached.find(c => c.id === courseId);

            let allowed = DESIGNATION_OPTIONS;
            if (course && course.allowed_designations) {
                try {
                    const list = Array.isArray(course.allowed_designations)
                        ? course.allowed_designations
                        : JSON.parse(course.allowed_designations);
                    if (Array.isArray(list) && list.length > 0 && !list.includes('All')) {
                        allowed = DESIGNATION_OPTIONS.filter(d => list.includes(d));
                    }
                } catch (e) {
                    allowed = DESIGNATION_OPTIONS;
                }
            }

            let designationSeatCaps = {};
            try {
                const raw = course ? course.designation_seats : null;
                designationSeatCaps = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
            } catch (e) {
                designationSeatCaps = {};
            }

            let optionsHtml = '<option value="">-- Designation --</option>';
            let stillValidValue = false;
            allowed.forEach(d => {
                const cap = designationSeatCaps && designationSeatCaps[d];
                let isClosed = false;
                let suffix = '';
                if (courseId && cap) {
                    const filled = registrationLogsCached.filter(r => r.course_id === courseId && r.designation_category_snapshot === d).length;
                    const remaining = Math.max(0, cap - filled);
                    suffix = ` (${remaining} seats remaining)`;
                    if (remaining <= 0) isClosed = true;
                }
                if (isClosed) {
                    optionsHtml += `<option value="${d}" disabled style="color:#cbd5e1;">${d}${suffix} (FULL)</option>`;
                } else {
                    optionsHtml += `<option value="${d}">${d}${suffix}</option>`;
                    if (d === currentValue) stillValidValue = true;
                }
            });

            select.innerHTML = optionsHtml;

            if (stillValidValue) {
                select.value = currentValue;
            } else {
                select.value = '';
                const otherInput = document.getElementById('otherDesignationInput');
                otherInput.classList.add('hidden-element');
                otherInput.required = false;
                otherInput.value = '';
            }
        }

        function handleDesignationChange() {
            const select = document.getElementById('designationSelect');
            const otherInput = document.getElementById('otherDesignationInput');
            if (select.value === 'Other') {
                otherInput.classList.remove('hidden-element');
                otherInput.required = true;
            } else {
                otherInput.classList.add('hidden-element');
                otherInput.required = false;
                otherInput.value = '';
            }
            updateSelectableCoursesOptions();
        }

        function renderInstitutionFields() {
            const selectedType = document.getElementById('institutionTypeSelect').value;
            const deptContainer = document.getElementById('departmentContainer');
            const otherContainer = document.getElementById('otherInstitutionContainer');
            const courseId = Number(document.getElementById('courseSelect').value);

            if (selectedType === 'Ibra') {
                deptContainer.classList.remove('hidden-element');
                otherContainer.classList.add('hidden-element');
                document.getElementById('otherInstitutionInput').value = '';
                resetOtherFreeText();
                filterIbraDepartments(courseId);
            } else if (selectedType === 'Other') {
                otherContainer.classList.remove('hidden-element');
                deptContainer.classList.add('hidden-element');
                document.getElementById('departmentSelect').value = '';
                filterOtherInstitutions(courseId);
                handleOtherInstitutionChange();
            } else {
                deptContainer.classList.add('hidden-element');
                otherContainer.classList.add('hidden-element');
                document.getElementById('departmentSelect').value = '';
                document.getElementById('otherInstitutionInput').value = '';
                resetOtherFreeText();
            }
        }

        function resetOtherFreeText() {
            const freeText = document.getElementById('otherInstitutionFreeText');
            freeText.value = '';
            freeText.required = false;
            freeText.classList.add('hidden-element');
        }

        function handleOtherInstitutionChange() {
            const otherDropdown = document.getElementById('otherInstitutionInput');
            const freeText = document.getElementById('otherInstitutionFreeText');
            if (otherDropdown.value === OTHER_CATCHALL_NAME) {
                freeText.classList.remove('hidden-element');
                freeText.required = true;
            } else {
                resetOtherFreeText();
            }
        }

        function filterIbraDepartments(courseId) {
            const deptDropdown = document.getElementById('departmentSelect');
            const currentSelected = deptDropdown.value;
            const course = coursesCached.find(c => c.id === courseId);
            
            let html = '<option value="">-- Choose Department --</option>';
            departmentsList.forEach(dept => {
                let chairsLeftStr = '';
                let isClosed = false;

                if (courseId) {
                    const matchString = `Ibra - ${dept}`;
                    const allocationConfig = courseInstitutionsMapCached.find(m => m.course_id === courseId && m.institutions?.name === matchString);
                    
                    if (allocationConfig) {
                        // 0 means UNLIMITED for this institution specifically
                        // — not zero chairs / closed.
                        if (allocationConfig.max_slots !== 0) {
                            const countFilled = registrationLogsCached.filter(r => r.course_id === courseId && r.institution_name_snapshot === matchString).length;
                            const chairsLeft = Math.max(0, allocationConfig.max_slots - countFilled);
                            chairsLeftStr = ` (${chairsLeft} chairs remaining)`;
                            if (chairsLeft <= 0) isClosed = true;
                        }
                    } else if (course && course.unlimited_seats) {
                        // No allocation row at all for this institution on
                        // this specific course — this happens for any
                        // institution added to the global list AFTER this
                        // course was created/saved, since a row only gets
                        // written at save time. Previously this fell
                        // through to "closed" unconditionally, meaning a
                        // course marked unlimited would still lock out any
                        // institution added later. A missing row on an
                        // unlimited course means open, same as an explicit
                        // 0 — the course itself has no cap either way.
                    } else {
                        isClosed = true; 
                    }
                }

                const selectedAttr = (dept === currentSelected) ? 'selected' : '';

                if (!isClosed) {
                    html += `<option value="${dept}" ${selectedAttr}>${dept}${chairsLeftStr}</option>`;
                } else {
                    html += `<option value="${dept}" disabled style="color:#cbd5e1;" ${selectedAttr}>${dept} (CLOSED / NOT ALLOCATED)</option>`;
                }
            });
            deptDropdown.innerHTML = html;
        }

        function filterOtherInstitutions(courseId) {
            const otherDropdown = document.getElementById('otherInstitutionInput');
            const currentSelected = otherDropdown.value;
            const options = Array.from(otherDropdown.options);
            const course = coursesCached.find(c => c.id === courseId);

            options.forEach(opt => {
                if (opt.value === "") return;
                let isClosed = false;

                if (courseId) {
                    const allocationConfig = courseInstitutionsMapCached.find(m => m.course_id === courseId && m.institutions?.name === opt.value);
                    
                    if (allocationConfig) {
                        // 0 means UNLIMITED for this institution specifically
                        // — not zero chairs / closed.
                        if (allocationConfig.max_slots !== 0) {
                            const countFilled = opt.value === OTHER_CATCHALL_NAME
                                ? registrationLogsCached.filter(r => r.course_id === courseId && r.institution_name_snapshot && r.institution_name_snapshot.startsWith(OTHER_CATCHALL_NAME)).length
                                : registrationLogsCached.filter(r => r.course_id === courseId && r.institution_name_snapshot === opt.value).length;
                            const chairsLeft = Math.max(0, allocationConfig.max_slots - countFilled);
                            opt.text = `${opt.value} (${chairsLeft} chairs remaining)`;
                            if (chairsLeft <= 0) isClosed = true;
                        } else {
                            opt.text = opt.value;
                        }
                    } else if (course && course.unlimited_seats) {
                        // No allocation row at all for this institution on
                        // this course — happens for any institution added
                        // to the global list after this course was
                        // created. A missing row on an unlimited course
                        // means open, same as an explicit 0.
                        opt.text = opt.value;
                    } else {
                        isClosed = true;
                    }
                }

                opt.disabled = isClosed;
                opt.style.color = isClosed ? '#cbd5e1' : '';
                if (isClosed) opt.text = `${opt.value} (CLOSED / NOT ALLOCATED)`;
            });
        }

        function updateTargetingSelectOptionsForCourse(courseId) {
            const course = coursesCached.find(c => c.id === courseId);
            TARGETING_FIELDS.forEach(field => {
                const select = document.getElementById('reg_' + field.key);
                const wrapper = document.getElementById('regFieldWrapper_' + field.key);
                if (!select) return;
                const currentValue = select.value;

                let savedArr = [];
                if (course) {
                    try {
                        const raw = course[field.key];
                        savedArr = Array.isArray(raw) ? raw : (typeof raw === 'string' && raw.trim() !== '' ? JSON.parse(raw) : []);
                    } catch (e) {
                        savedArr = [];
                    }
                }

                // An empty array means the admin turned off "Show to registrants"
                // for this field on this course — hide it entirely and stop
                // requiring it, rather than just filtering its options.
                const isHiddenForThisCourse = course && Array.isArray(savedArr) && savedArr.length === 0;
                if (wrapper) wrapper.classList.toggle('hidden-element', !!isHiddenForThisCourse || !course);
                select.required = !isHiddenForThisCourse;

                let allowed = field.options;
                if (course && !isHiddenForThisCourse && !savedArr.includes('All')) {
                    allowed = field.options.filter(o => savedArr.includes(o));
                }

                let optionsHtml = '<option value="">-- Choose --</option>';
                optionsHtml += allowed.map(o => `<option value="${o}">${o}</option>`).join('');
                select.innerHTML = optionsHtml;
                select.value = allowed.includes(currentValue) ? currentValue : '';
            });
        }

        // ====================================================================
        // Custom Questions (optional) — rendered per-course, one input group
        // per question. All 8 admin-defined types render here; answers are
        // collected at submit time and saved after the registration itself.
        // ====================================================================
        let customQuestionsCache = []; // the currently selected course's questions

        async function renderCustomQuestionsForRegistration(courseId) {
            const box = document.getElementById('customQuestionsContainer');
            if (!courseId) { box.innerHTML = ''; customQuestionsCache = []; return; }

            const { data, error } = await client
                .from('course_questions')
                .select('*')
                .eq('course_id', courseId)
                .order('display_order', { ascending: true });

            if (error) {
                // Surfaced loudly rather than silently showing nothing —
                // a real query failure here (bad RLS policy, a missing
                // column on this database, etc.) previously looked
                // identical to "this course just has no custom
                // questions", making it impossible to tell the two apart.
                console.error('Could not load custom questions for course', courseId, error);
                box.innerHTML = '';
                customQuestionsCache = [];
                return;
            }
            if (!data || data.length === 0) {
                box.innerHTML = '';
                customQuestionsCache = [];
                return;
            }
            customQuestionsCache = data;

            box.innerHTML = `
                <div class="cq-section-heading">
                    Additional Questions
                </div>
            ` + data.map((q, index) => {
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
                    fieldHtml = options.map((o, i) => `
                        <label class="cq-choice-label">
                            <input type="radio" name="cq_${q.id}" class="cq-answer-radio" data-qid="${q.id}" value="${o}">
                            ${o}
                        </label>`).join('');
                } else if (q.question_type === 'checkbox') {
                    fieldHtml = options.map((o, i) => `
                        <label class="cq-choice-label">
                            <input type="checkbox" class="cq-answer-checkbox" data-qid="${q.id}" value="${o}">
                            ${o}
                        </label>`).join('');
                } else if (q.question_type === 'multiple_choice_grid' || q.question_type === 'checkbox_grid') {
                    const inputType = q.question_type === 'multiple_choice_grid' ? 'radio' : 'checkbox';
                    // Wrapped in its own scroll container — a grid question
                    // with several columns has no other way to stay usable
                    // on a narrow phone screen; without this the table was
                    // squeezed down to fit instead of staying readable.
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

                return `
                    <div class="cq-registration-field">
                        <label class="cq-question-text"><span class="cq-question-number">${index + 1}</span>${q.question_text}</label>
                        ${fieldHtml}
                    </div>
                `;
            }).join('');
        }

        // Reads every answered custom question into the shape
        // question_responses.response_value expects: a plain string for
        // Text/Date/Time/List/Multiple Choice, an array for Checkbox, and a
        // { rowLabel: answer } map for the two grid types. Unanswered
        // questions are skipped entirely — every custom question is optional.
        function collectCustomQuestionAnswers() {
            const answers = [];
            customQuestionsCache.forEach(q => {
                if (q.question_type === 'text' || q.question_type === 'date' || q.question_type === 'time' || q.question_type === 'list') {
                    const input = document.querySelector(`.cq-answer-input[data-qid="${q.id}"]`);
                    if (input && input.value) answers.push({ question_id: q.id, response_value: input.value });
                } else if (q.question_type === 'multiple_choice') {
                    const checked = document.querySelector(`.cq-answer-radio[data-qid="${q.id}"]:checked`);
                    if (checked) answers.push({ question_id: q.id, response_value: checked.value });
                } else if (q.question_type === 'checkbox') {
                    const checked = Array.from(document.querySelectorAll(`.cq-answer-checkbox[data-qid="${q.id}"]:checked`)).map(el => el.value);
                    if (checked.length > 0) answers.push({ question_id: q.id, response_value: checked });
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
                    if (Object.keys(rowMap).length > 0) answers.push({ question_id: q.id, response_value: rowMap });
                }
            });
            return answers;
        }

        async function handleCourseSelectionChange() {
            const courseId = Number(document.getElementById('courseSelect').value);
            const container = document.getElementById('dynamicUploadsContainer');
            const selectedCourse = coursesCached.find(c => c.id === courseId);

            // A closed activity shows a notice instead of the rest of the
            // form entirely — registration, custom questions, uploads, none
            // of it is reachable while closed.
            const isClosed = !!selectedCourse && selectedCourse.links_closed === true;
            document.getElementById('courseClosedNotice').classList.toggle('hidden-element', !isClosed);
            document.getElementById('closeClosedNoticeBtn').classList.toggle('hidden-element', !isClosed);
            setAlreadyRegisteredNoticeVisible(false);
            setNotEligibleNotice(null);

            if (isClosed) {
                // These three aren't part of REST_OF_FORM_IDS (toggled by
                // toggleFormVisibility below), so without this they'd keep
                // showing whatever the PREVIOUSLY selected open course
                // rendered — stale custom questions, upload boxes, and
                // first-session fields left sitting on screen underneath
                // the "closed" notice even though the Register button
                // itself is correctly hidden.
                container.innerHTML = '';
                document.getElementById('customQuestionsContainer').innerHTML = '';
                customQuestionsCache = [];
                document.getElementById('firstLogEntryContainer').classList.add('hidden-element');
                toggleFormVisibility(false);
                return;
            }

            if (!courseId) {
                toggleFormVisibility(false);
                return;
            }

            // Already registered for THIS specific activity? Only knowable
            // now that both the participant (Staff Number step, resolved
            // BEFORE course selection) and the course are known — stop
            // here with a clear message instead of opening the rest of the
            // form. The database's own registrations_one_per_activity
            // constraint is still the real backstop (see handleSubmit);
            // this is just the friendly early check.
            if (matchedParticipant) {
                const { data: existingReg } = await client
                    .from('registrations')
                    .select('id')
                    .eq('course_id', courseId)
                    .eq('participant_id', matchedParticipant.id)
                    .maybeSingle();

                if (existingReg) {
                    await client.from('registration_events_log').insert({
                        event_type: 'duplicate_registration_attempt',
                        participant_id: matchedParticipant.id,
                        staff_number: matchedParticipant.staff_number,
                        staff_name: matchedParticipant.staff_name,
                        course_id: courseId,
                        course_name: selectedCourse ? selectedCourse.name : null
                    });
                    setAlreadyRegisteredNoticeVisible(true);
                    toggleFormVisibility(false);
                    return;
                }

                // Their own saved profile might rule them out of THIS
                // specific course even though they're not already
                // registered for it — e.g. a course open to Female
                // participants only, and this staff number's saved sex is
                // Male. A brand-new (unmatched) staff number has nothing
                // saved to conflict with, so this only ever applies here.
                const blockReason = getEligibilityBlockReason(matchedParticipant, selectedCourse, courseId);
                if (blockReason) {
                    setNotEligibleNotice(blockReason);
                    toggleFormVisibility(false);
                    return;
                }
            }

            updateDesignationOptionsForCourse(courseId);
            updateGenderOptionsForCourse(courseId);
            updateInstitutionTypeOptionsForCourse(courseId);
            renderInstitutionFields();
            renderCustomQuestionsForRegistration(courseId);

            applyCourseTheme(selectedCourse ? selectedCourse.theme_color : null);
            document.getElementById('firstLogEntryContainer').classList.toggle('hidden-element', !selectedCourse || selectedCourse.attendance_required !== false);
            const firstLogDeptSelect = document.getElementById('firstLogDept');
            firstLogDeptSelect.innerHTML = '<option value="">-- Choose Organized By --</option>' +
                departmentsList.map(d => `<option value="${d}">${d}</option>`).join('');
            // The certificate-name agreement isn't relevant for a course
            // that doesn't require attendance — certificates for those are
            // gated on attendance anyway, so this promise doesn't apply.
            const isNonAttendanceCourse = !!selectedCourse && selectedCourse.attendance_required === false;
            document.getElementById('certNameAgreementLabel').classList.toggle('hidden-element', isNonAttendanceCourse);
            document.getElementById('certNameAgreement').checked = false;

            toggleFormVisibility(true);
            // Runs AFTER toggleFormVisibility(true) on purpose — that call
            // unconditionally un-hides every element in REST_OF_FORM_IDS,
            // which includes all 8 regFieldWrapper_* targeting fields. Since
            // this decides per-field whether "Show to registrants" is
            // actually off for THIS course, it has to run last, or its
            // hide decision gets silently overwritten the instant
            // toggleFormVisibility reveals the rest of the form — which is
            // exactly why turning a field off never had any visible effect.
            updateTargetingSelectOptionsForCourse(courseId);
            // Load the matched participant's saved info now that the
            // course-specific institution/designation dropdowns above are
            // ready to accept it — a brand-new (unmatched) staff number
            // just gets its typed value carried into the field instead.
            // Either way, the field is locked here — it was already
            // entered once at the Staff Number step; a typo gets fixed by
            // going back via "Not you? Change staff number", not by
            // editing it again down here.
            if (matchedParticipant) {
                prefillFromParticipant(matchedParticipant);
                document.getElementById('staffNumber').value = matchedParticipant.staff_number;
            } else {
                document.getElementById('staffNumber').value = enteredStaffNumberRaw;
            }
            document.getElementById('staffNumber').readOnly = true;

            let labels = [];
            let examples = [];
            try {
                labels = selectedCourse && Array.isArray(selectedCourse.file_labels) ? selectedCourse.file_labels : JSON.parse(selectedCourse.file_labels || "[]");
                examples = selectedCourse && Array.isArray(selectedCourse.file_examples) ? selectedCourse.file_examples : JSON.parse(selectedCourse.file_examples || "[]");
            } catch(e) {
                labels = [];
                examples = [];
            }

            labels = labels.filter(l => l && l.trim() !== "");
            
            if (labels.length === 0) {
                container.innerHTML = '<div class="no-uploads-msg">✅ No document attachments are required for this course session.</div>';
                return;
            }

            container.innerHTML = labels.map((descText, idx) => {
                const exampleUrl = examples[idx] || '';
                
                const exampleImageHtml = exampleUrl ? `
                    <div class="form-blueprint-card">
                        <a href="${exampleUrl}" target="_blank">
                            <img src="${exampleUrl}" alt="Template Reference Guide" onerror="this.parentElement.parentElement.style.display='none'">
                        </a>
                        <div>
                            <b>Example Document Blueprint:</b>
                            Please ensure your copy matches parameters shown here.
                        </div>
                    </div>` : '';

                return `
                    <div class="single-upload-box">
                        <label>Upload Document #${idx + 1}: <span>${descText} *</span></label>
                        ${exampleImageHtml}
                        <input type="file" class="file-input custom-file-target" data-label="${descText}" accept="image/*, .pdf" required>
                    </div>
                `;
            }).join('');
        }

        function updateSelectableCoursesOptions() {
            const userSex = document.getElementById('sexSelect').value;
            let userDesignation = document.getElementById('designationSelect').value;
            
            if (userDesignation === 'Other') {
                userDesignation = document.getElementById('otherDesignationInput').value.trim();
            }
            
            const courseDropdown = document.getElementById('courseSelect');
            const savedSelectedValue = courseDropdown.value;

            let filtered = coursesCached.filter(c => hasOpenSeats(c) && isRegistrationOpen(c));

            if (userSex) {
                filtered = filtered.filter(c => !c.allowed_sex || c.allowed_sex === 'Both' || c.allowed_sex === userSex);
            }

            if (userDesignation) {
                filtered = filtered.filter(c => {
                    if (!c.allowed_designations) return true;
                    try {
                        const targetList = Array.isArray(c.allowed_designations) ? c.allowed_designations : JSON.parse(c.allowed_designations);
                        if (targetList.length === 0 || targetList.includes('All')) return true;
                        return targetList.includes(userDesignation);
                    } catch (e) {
                        return true;
                    }
                });
            }

            let optionsHtml = '<option value="">-- Choose Course --</option>';
            optionsHtml += filtered.map(c => `<option value="${c.id}">${c.name} (🗓️ ${c.course_date}) (${seatsLabel(c)})</option>`).join('');
            
            courseDropdown.innerHTML = optionsHtml;
            
            if (filtered.some(c => c.id === Number(savedSelectedValue))) {
                courseDropdown.value = savedSelectedValue;
            } else {
                courseDropdown.value = "";
                handleCourseSelectionChange();
            }
        }

        async function loadRegistrationFormConfig() {
            const { data: courses, error: courseErr } = await client.from('courses').select('*').order('id', { ascending: true });
            if (courseErr) {
                console.error("Database fetch error:", courseErr);
                revealHero();
                return;
            }
            coursesCached = courses;

            const params = new URLSearchParams(window.location.search);
            const directCourseId = params.get('course') ? Number(params.get('course')) : null;
            const cardsToShow = directCourseId ? courses.filter(c => c.id === directCourseId) : courses;

            // Everything renderFeaturedWorkshop needs (including the theme
            // color) comes from `courses` alone, so reveal right after this —
            // no need to wait on the two heavier queries below first.
            renderFeaturedWorkshop(cardsToShow);
            revealHero();

            // Same master list Create Course seeds into the institutions
            // table — replicated here (not just relying on Create Course
            // having been opened first) so this page shows the full
            // Ibra/Other list even on a completely fresh database.
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
            const { data: existingInstitutions } = await client.from('institutions').select('name');
            // Only seed a genuinely EMPTY table (a fresh deployment) —
            // previously this checked each individual master-list name and
            // re-inserted whichever were missing, on EVERY registration
            // page load — meaning an admin deleting one of these
            // institutions (e.g. from the Ibra Department admin page) had
            // it silently recreated the next time anyone simply opened a
            // registration link, which happens far more often than admin
            // visits. Deleting an institution should be permanent.
            if (!existingInstitutions || existingInstitutions.length === 0) {
                await client.from('institutions').insert(masterInstitutionsAndDepartments.map(name => ({ name })));
            }

            const [{ data: maps, error: mapErr }, { data: registers, error: regErr }, { data: institutionsData, error: instErr }] = await Promise.all([
                client.from('course_institutions').select('*, institutions(name)'),
                // Reads the safe public view (course_id, institution_name_snapshot,
                // designation_category_snapshot only) — the base registrations
                // table itself is admin-only under RLS, since it holds phone
                // numbers and names.
                client.from('public_registration_counts').select('course_id, institution_name_snapshot, designation_category_snapshot'),
                // The two dropdowns below used to be a hardcoded JS array and a
                // static list of <option> tags respectively — meaning an
                // institution added anywhere in the admin (hub or Create
                // Course) could NEVER show up here no matter what, since
                // neither dropdown ever queried this table at all. Fetching
                // it directly here is what actually connects them.
                client.from('institutions').select('name')
            ]);
            if (mapErr) return console.error("Allocation mapping database tracking fail:", mapErr);
            courseInstitutionsMapCached = maps || [];
            // Previously this aborted the ENTIRE function early on any
            // fetch error here (a `return`) — meaning everything after
            // this point, including populating departmentsList and
            // building the institution/department dropdowns, silently
            // never ran at all. That's what actually caused "every
            // institution locked": a 404 on this one table took the
            // whole page's data setup down with it. Now matches the
            // instErr handling right below — log and continue with
            // whatever we have.
            if (regErr) console.error("Logs fetch error:", regErr);
            registrationLogsCached = registers || [];
            if (instErr) console.error("Institutions fetch error:", instErr);
            const allInstitutionNames = (institutionsData || []).map(i => i.name);
            departmentsList.length = 0;
            departmentsList.push(...allInstitutionNames
                .filter(n => n.startsWith('Ibra - '))
                .map(n => n.slice('Ibra - '.length))
                .sort());
            // OTHER_CATCHALL_NAME is already one of the seeded rows above, so
            // it's excluded here and appended once explicitly instead of
            // showing up twice.
            populateOtherInstitutionOptions(allInstitutionNames
                .filter(n => !n.startsWith('Ibra - ') && n !== OTHER_CATCHALL_NAME)
                .sort());

            updateSelectableCoursesOptions();
        }

        // Rebuilds the "Other" institution dropdown's actual <option> list from
        // the institutions table, keeping the free-text catch-all option that
        // isn't a real row in that table.
        function populateOtherInstitutionOptions(names) {
            const dropdown = document.getElementById('otherInstitutionInput');
            const currentSelected = dropdown.value;
            let html = '<option value="">-- Choose Corporate / Academic Entity --</option>';
            names.forEach(name => {
                html += `<option value="${name}">${name}</option>`;
            });
            html += `<option value="${OTHER_CATCHALL_NAME}">${OTHER_CATCHALL_NAME}</option>`;
            dropdown.innerHTML = html;
            if (currentSelected) dropdown.value = currentSelected;
        }

        // Picks the soonest upcoming open course as the Featured Workshop —
        // real data only, never invented. Falls back to the first course with
        // open seats if none are strictly in the future (e.g. all dates already
        // passed but still listed), and hides the section entirely if there's
        // nothing to feature.
        function renderFeaturedWorkshop(courses) {
            const section = document.getElementById('featuredSection');
            const openCourses = courses.filter(c => hasOpenSeats(c) && isRegistrationOpen(c));

            if (openCourses.length === 0) {
                // A direct link (?course=X) to a specific course that's now
                // closed still deserves a clear message, not just a vanished
                // section — but a generic listing with nothing open just hides.
                const closedDirectCourse = courses.find(c => !isRegistrationOpen(c));
                if (courses.length === 1 && closedDirectCourse) {
                    applyCourseTheme(closedDirectCourse.theme_color);
                    const visual = section.querySelector('.featured-visual');
                    if (closedDirectCourse.image_url) {
                        visual.innerHTML = `<img src="${closedDirectCourse.image_url}" alt="${(closedDirectCourse.name || 'Workshop').replace(/"/g, '&quot;')}" class="featured-visual-img" data-lightbox-img="${closedDirectCourse.image_url}">`;
                    } else {
                        visual.innerHTML = `<svg viewBox="0 0 64 64" width="40" height="40" fill="none">
                          <circle cx="32" cy="32" r="22" stroke="white" stroke-width="4"/>
                          <path d="M32 20V33L40 38" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>`;
                    }
                    document.getElementById('featuredTitle').textContent = closedDirectCourse.name;
                    document.getElementById('featuredDescription').textContent = registrationStatusMessage(closedDirectCourse);
                    document.getElementById('featuredMeta').innerHTML = `<span>📅 ${closedDirectCourse.course_date}</span>`;
                    const cta = document.getElementById('featuredCta');
                    const now = new Date();
                    const notYetOpen = closedDirectCourse.registration_opens_date && now < new Date(closedDirectCourse.registration_opens_date + 'T00:00:00');
                    cta.textContent = notYetOpen ? 'Registration Not Open Yet' : 'Registration Closed';
                    cta.disabled = true;
                    cta.onclick = null;
                    section.classList.remove('hidden-element');
                    // Nothing to register for on a closed/not-yet-open course
                    // linked directly — hide the whole "Register for a
                    // Workshop" section (heading + form) rather than show a
                    // form for a course that can't actually be joined.
                    document.getElementById('register').classList.add('hidden-element');
                    return;
                }
                section.classList.add('hidden-element');
                return;
            }

            // Restore the registration section for the normal case (open
            // course) — it may have been hidden by the closed-course branch
            // above on an earlier render.
            document.getElementById('register').classList.remove('hidden-element');

            const today = new Date(); today.setHours(0, 0, 0, 0);
            const upcoming = openCourses
                .filter(c => c.course_date && !isNaN(new Date(c.course_date)))
                .sort((a, b) => new Date(a.course_date) - new Date(b.course_date))
                .find(c => new Date(c.course_date) >= today);
            const featured = upcoming || openCourses[0];

            applyCourseTheme(featured.theme_color);

            const visual = section.querySelector('.featured-visual');
            if (featured.image_url) {
                visual.innerHTML = `<img src="${featured.image_url}" alt="${(featured.name || 'Workshop').replace(/"/g, '&quot;')}" class="featured-visual-img" data-lightbox-img="${featured.image_url}">`;
            } else {
                visual.innerHTML = `<svg viewBox="0 0 64 64" width="40" height="40" fill="none">
                  <circle cx="32" cy="32" r="22" stroke="white" stroke-width="4"/>
                  <path d="M32 20V33L40 38" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>`;
            }

            document.getElementById('featuredTitle').textContent = featured.name;
            const description = (featured.description || '').trim();
            document.getElementById('featuredDescription').textContent = description || `Open registration — ${featured.unlimited_seats ? 'unlimited chairs' : featured.seats + ' chair' + (featured.seats === 1 ? '' : 's')} available.`;

            const metaParts = [`<span>📅 ${featured.course_date}</span>`];
            if ((featured.instructor_name || '').trim()) metaParts.push(`<span>🎓 ${featured.instructor_name}</span>`);
            metaParts.push(`<span>🪑 ${featured.unlimited_seats ? 'Unlimited' : featured.seats} available</span>`);
            document.getElementById('featuredMeta').innerHTML = metaParts.join('');

            const cta = document.getElementById('featuredCta');
            cta.disabled = false;
            cta.textContent = 'View & Register →';
            cta.onclick = () => window.selectCourseAndScroll(featured.id);
            section.classList.remove('hidden-element');
        }

        // Shared by the Featured Workshop CTA and each card's "View ->" link:
        // selects that course in the registration form below and scrolls to it.
        window.selectCourseAndScroll = function (courseId) {
            const select = document.getElementById('courseSelect');
            select.value = String(courseId);
            select.dispatchEvent(new Event('change'));
            document.getElementById('register').scrollIntoView({ behavior: 'smooth', block: 'start' });
        };

        // A simple centered success message with just a Close button — no
        // "go to X" choice, since the first log entry (when the participant
        // filled it in) is already captured as part of this same submission.
        function showSimpleSuccessCard(message) {
            const overlay = document.createElement('div');
            overlay.className = 'form-modal-overlay';
            overlay.innerHTML = `
                <div class="form-modal-card" style="text-align:center;">
                    <div class="form-toast-title" style="font-size:16px;">${message}</div>
                    <button type="button" class="confirm-btn confirm-ok" id="successCloseBtn" style="width:100%; margin-top:10px;">Close</button>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.querySelector('#successCloseBtn').addEventListener('click', () => {
                // Same window.close()-with-fallback pattern used elsewhere
                // in this app (the closed-activity notice, Activity Log's
                // own Close button) — browsers don't allow a script to
                // close a tab it didn't open itself, so this falls back to
                // a plain "you're done" message instead of just dropping
                // the visitor back onto a reset registration form.
                window.close();
                overlay.remove();
                document.querySelector('.container').innerHTML = '<p style="text-align:center; color:#16a34a; font-weight:bold; padding:60px 0;">All done — you can close this page now.</p>';
            });
        }

        async function handleSubmit() {
            const regBtn = document.getElementById('regBtn');
            const courseIdForClosedCheck = Number(document.getElementById('courseSelect').value);
            const { data: freshCourse } = await client.from('courses').select('links_closed').eq('id', courseIdForClosedCheck).maybeSingle();
            if (freshCourse && freshCourse.links_closed) {
                alert('This activity is currently closed for registration.');
                return;
            }

            const phoneNumber = document.getElementById('phoneNumber').value.trim();
            const sexValue    = document.getElementById('sexSelect').value;
            const staffName   = document.getElementById('staffName').value.trim();
            const staffNumber = document.getElementById('staffNumber').value.trim();
            
            const designationCategory = document.getElementById('designationSelect').value;
            let designation = designationCategory;
            if (designation === 'Other') {
                designation = document.getElementById('otherDesignationInput').value.trim();
            }
            
            const specialization = document.getElementById('specializationInput').value.trim();
            const courseId    = Number(document.getElementById('courseSelect').value);

            // One registration per staff number per activity — checked
            // here up front for a fast, clear message before any file
            // uploads happen; the database itself also enforces this via a
            // unique constraint (see sql/prevent-duplicate-registration.sql),
            // which is what actually closes the race-condition case of two
            // near-simultaneous submissions both passing this check.
            if (staffNumber) {
                const { data: existingReg } = await client
                    .from('registrations')
                    .select('id')
                    .eq('course_id', courseId)
                    .ilike('staff_number', staffNumber.trim())
                    .maybeSingle();
                if (existingReg) {
                    alert('This staff number is already registered for this activity.');
                    return;
                }
            }

            const instType    = document.getElementById('institutionTypeSelect').value;
            
            const selectedDept = document.getElementById('departmentSelect').value;
            const otherText    = document.getElementById('otherInstitutionInput').value;
            const otherFreeText = document.getElementById('otherInstitutionFreeText').value.trim();
            const fileInputs   = document.querySelectorAll('.custom-file-target');

            const targetingValues = {};
            for (const field of TARGETING_FIELDS) {
                const select = document.getElementById('reg_' + field.key);
                targetingValues[field.key] = select ? select.value : '';
            }

            if (!phoneNumber || !sexValue || !staffName || !staffNumber || !designation || !specialization || !courseId || !instType) {
                alert("Please complete all text fields and selection items.");
                return;
            }
            if (staffName.trim().split(/\s+/).filter(Boolean).length < 2) {
                alert('Please enter your first and last name — a single name is not enough.');
                return;
            }
            if (!document.getElementById('certNameAgreementLabel').classList.contains('hidden-element') && !document.getElementById('certNameAgreement').checked) {
                alert('Please confirm your full name is correct before submitting — this is what will be printed on your certificate.');
                return;
            }

            // Not part of the main required-fields check above since it only
            // applies when this section is actually shown (no-attendance
            // courses) — hidden entirely for attendance-required ones, where
            // it isn't relevant at all.
            const firstLogVisible = !document.getElementById('firstLogEntryContainer').classList.contains('hidden-element');
            if (firstLogVisible) {
                const firstLogTitleVal = document.getElementById('firstLogTitle').value.trim();
                const firstLogDeptVal = document.getElementById('firstLogDept').value;
                const firstLogDateVal = document.getElementById('firstLogDate').value;
                const firstLogTimeVal = document.getElementById('firstLogTime').value;
                if (!firstLogTitleVal || !firstLogDeptVal || !firstLogDateVal || !firstLogTimeVal) {
                    alert("Please fill in the title, organized by, date, and time for your first session.");
                    return;
                }
            }

            for (const field of TARGETING_FIELDS) {
                const wrapper = document.getElementById('regFieldWrapper_' + field.key);
                const isHidden = wrapper && wrapper.classList.contains('hidden-element');
                if (isHidden) continue;
                if (!targetingValues[field.key]) {
                    alert(`Please select at least one option for "${field.label}".`);
                    return;
                }
            }

            let institutionSnapshotString = '';
            let allocationLookupName = '';
            const isOtherCatchAll = (instType === 'Other' && otherText === OTHER_CATCHALL_NAME);

            if (instType === 'Ibra') {
                if (!selectedDept) { alert("Please select your target department."); return; }
                institutionSnapshotString = `Ibra - ${selectedDept}`;
                allocationLookupName = institutionSnapshotString;
            } else {
                if (!otherText) { alert("Please select your institution name."); return; }
                if (isOtherCatchAll) {
                    if (!otherFreeText) { alert("Please type your institution name."); return; }
                    institutionSnapshotString = `${OTHER_CATCHALL_NAME}: ${otherFreeText}`;
                    allocationLookupName = OTHER_CATCHALL_NAME;
                } else {
                    institutionSnapshotString = otherText;
                    allocationLookupName = otherText;
                }
            }

            const currentCourse = coursesCached.find(c => c.id === courseId);
            for (let input of fileInputs) {
                if (!input.files || input.files.length === 0) {
                    alert(`Registration denied! Missing file target object: "${input.getAttribute('data-label')}"`);
                    return;
                }
            }

            regBtn.disabled = true;
            regBtn.innerText = "Processing server storage sequence uploads...";

            try {
                const allocationConfig = courseInstitutionsMapCached.find(m => m.course_id === courseId && m.institutions?.name === allocationLookupName);
                if (!allocationConfig) {
                    throw new Error("This institution/department is not authorized or assigned slots for this specific course framework.");
                }

                let realTimeQuery = client.from('public_registration_counts')
                    .select('id')
                    .eq('course_id', courseId);
                realTimeQuery = isOtherCatchAll
                    ? realTimeQuery.like('institution_name_snapshot', `${OTHER_CATCHALL_NAME}%`)
                    : realTimeQuery.eq('institution_name_snapshot', institutionSnapshotString);
                const { data: realTimeCheck } = await realTimeQuery;

                // max_slots = 0 means UNLIMITED for this specific
                // institution (same convention used everywhere else in
                // the app) — skip this check entirely in that case,
                // rather than comparing a count against 0 and always
                // failing. This is the actual source of the "cap limit
                // of 0 seats" error — this client-side pre-check runs
                // BEFORE the database RPC is ever reached, so fixing the
                // database function alone had no effect.
                if (allocationConfig.max_slots !== 0 && realTimeCheck && realTimeCheck.length >= allocationConfig.max_slots) {
                    throw new Error(`This department/institution seat room has filled its cap limit of ${allocationConfig.max_slots} seats. Registration locked.`);
                }

                let designationSeatCaps = {};
                try {
                    const raw = currentCourse ? currentCourse.designation_seats : null;
                    designationSeatCaps = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
                } catch (e) {
                    designationSeatCaps = {};
                }
                const designationCap = designationSeatCaps && designationSeatCaps[designationCategory];
                if (designationCap) {
                    const { data: designationRealTimeCheck } = await client.from('public_registration_counts')
                        .select('id')
                        .eq('course_id', courseId)
                        .eq('designation_category_snapshot', designationCategory);
                    if (designationRealTimeCheck && designationRealTimeCheck.length >= designationCap) {
                        throw new Error(`The "${designationCategory}" seat allocation has filled its cap limit of ${designationCap} seats. Registration locked.`);
                    }
                }

                const uploadedUrls = [];
                for (let i = 0; i < fileInputs.length; i++) {
                    const currentFile = fileInputs[i].files[0];
                    const fileExtension = currentFile.name.split('.').pop();
                    const cleanLabel = fileInputs[i].getAttribute('data-label').replace(/[^a-z0-9]/gi, '_').toLowerCase();
                    const uniqueFileName = `${Date.now()}_${cleanLabel}_${Math.random().toString(36).substring(7)}.${fileExtension}`;

                    const { error: uploadError } = await client.storage
                        .from('registration-files')
                        .upload(uniqueFileName, currentFile);

                    if (uploadError) throw new Error(`Upload Failed: ` + uploadError.message);

                    const { data: publicUrlData } = client.storage
                        .from('registration-files')
                        .getPublicUrl(uniqueFileName);

                    uploadedUrls.push(publicUrlData.publicUrl);
                }

                const targetingSnapshotPayload = {};
                TARGETING_FIELDS.forEach(field => {
                    targetingSnapshotPayload[field.key + '_snapshot'] = targetingValues[field.key];
                });

                // A single database function call instead of 3 separate
                // client-side writes (insert + seat decrement + institution
                // count increment). This matters for two reasons, not just
                // one: it's the only way this can work at all once
                // registrations/courses/course_institutions are RLS-locked
                // to admin-only direct access, and it re-verifies every cap
                // against live data with row locks inside one transaction —
                // closing the exact race condition the old 3-step version
                // had (two people registering at once could each read a
                // stale count and both get in over a cap).
                const { error: rpcError } = await client.rpc('submit_registration', {
                    p_course_id: courseId,
                    p_institution_id: allocationConfig.institution_id,
                    p_phone_number: phoneNumber,
                    p_sex: sexValue,
                    p_staff_name: staffName,
                    p_staff_number: staffNumber,
                    p_designation: designation,
                    p_designation_category: designationCategory,
                    p_specialization: specialization,
                    p_institution_name: institutionSnapshotString,
                    p_file_urls: uploadedUrls,
                    p_job_level_snapshot: targetingSnapshotPayload.job_level_snapshot,
                    p_nationality_snapshot: targetingSnapshotPayload.nationality_snapshot,
                    p_education_qualification_snapshot: targetingSnapshotPayload.education_qualification_snapshot,
                    p_experience_years_snapshot: targetingSnapshotPayload.experience_years_snapshot,
                    p_organization_snapshot: targetingSnapshotPayload.organization_snapshot,
                    p_directorate_snapshot: targetingSnapshotPayload.directorate_snapshot,
                    p_program_type_snapshot: targetingSnapshotPayload.program_type_snapshot,
                    p_attendance_nature_snapshot: targetingSnapshotPayload.attendance_nature_snapshot
                });

                if (rpcError) {
                    // Postgres error code 23505 = unique_violation — this is
                    // the database's own backstop against the exact
                    // race-condition case the proactive check above can't
                    // close on its own (two submissions landing within
                    // milliseconds of each other).
                    if (rpcError.code === '23505' || /registrations_one_per_activity/.test(rpcError.message || '')) {
                        throw new Error('This staff number is already registered for this activity.');
                    }
                    throw new Error(rpcError.message);
                }

                // submit_registration doesn't return the new row's ID (it's
                // an atomic all-in-one function, deliberately not touched
                // here) — a follow-up lookup by course_id + staff_number is
                // safe since that pair is what actually identifies this
                // registration, same lookup pattern already used for
                // attendance check-in and certificate generation.
                // submit_registration doesn't return the new row's ID (it's
                // an atomic all-in-one function, deliberately not touched
                // here) — a follow-up lookup by course_id + staff_number is
                // safe since that pair is what actually identifies this
                // registration, same lookup pattern already used for
                // attendance check-in and certificate generation. Now also
                // used to link the new row to its participant record (see
                // sql/participants.sql) — the participant upsert itself
                // happens as a separate step here rather than inside
                // submit_registration, since that RPC's source isn't
                // touchable.
                const customAnswers = collectCustomQuestionAnswers();
                const firstLogTitle = document.getElementById('firstLogTitle').value.trim();
                const firstLogDept = document.getElementById('firstLogDept').value;
                const firstLogDate = document.getElementById('firstLogDate').value;
                const firstLogTime = document.getElementById('firstLogTime').value;
                const hasFirstLogEntry = firstLogTitle && firstLogDept && firstLogDate && firstLogTime;

                const { data: newReg } = await client
                    .from('registrations')
                    .select('id')
                    .eq('course_id', courseId)
                    .ilike('staff_number', staffNumber)
                    .maybeSingle();

                if (newReg) {
                    if (customAnswers.length > 0) {
                        await client.from('question_responses').insert(
                            customAnswers.map(a => ({ registration_id: newReg.id, question_id: a.question_id, response_value: a.response_value }))
                        );
                    }
                    if (hasFirstLogEntry) {
                        // Same "Organized By" convention as Activity Log's
                        // own entry form — updates the registration's
                        // department and marks it confirmed, so this
                        // first entry counts correctly in the "Courses
                        // per Department" report from the very start.
                        const newSnapshot = `Ibra - ${firstLogDept}`;
                        const { data: matchingInst } = await client.from('institutions').select('id').eq('name', newSnapshot).maybeSingle();
                        await client.from('registrations').update({
                            institution_name_snapshot: newSnapshot,
                            institution_id: matchingInst ? matchingInst.id : null,
                            department_chosen_via_log: true
                        }).eq('id', newReg.id);

                        await client.from('activity_log_entries').insert({
                            registration_id: newReg.id, title: firstLogTitle,
                            entry_date: firstLogDate, entry_time: firstLogTime
                        });
                    }

                    // Participant identity: one row per staff number,
                    // reused across every course registration. This uses
                    // the participant's OWN institution/department as
                    // entered at registration (institutionSnapshotString),
                    // independent of the "Organized By" override just
                    // above — that override is about crediting whichever
                    // department ran THIS session, not the participant's
                    // home institution. Failures here are logged but never
                    // block the registration itself, which the RPC above
                    // has already committed — sql/participants.sql's own
                    // backfill query can always repair a missed link later.
                    try {
                        const participantFields = {
                            staff_name: staffName,
                            phone_number: phoneNumber,
                            sex: sexValue,
                            designation: designation,
                            designation_category: designationCategory,
                            specialization: specialization,
                            institution_id: allocationConfig.institution_id,
                            institution_name: institutionSnapshotString
                        };
                        // Job Level, Nationality, etc. — only included when
                        // this course actually asked for them (a course
                        // that doesn't show/require a given field leaves it
                        // out of targetingValues as an empty string, and
                        // blindly saving that would erase a value a PAST
                        // course's registration already captured).
                        const targetingLabelByKey = {};
                        TARGETING_FIELDS.forEach(field => {
                            targetingLabelByKey[field.key] = field.label;
                            if (targetingValues[field.key]) participantFields[field.key] = targetingValues[field.key];
                        });

                        let participantId;
                        if (matchedParticipant) {
                            const changedLabels = [];
                            const labelByField = {
                                staff_name: 'Name', phone_number: 'Phone', sex: 'Gender',
                                designation: 'Designation', designation_category: 'Designation Category',
                                specialization: 'Specialization', institution_name: 'Institution',
                                ...targetingLabelByKey
                            };
                            Object.keys(participantFields).forEach(key => {
                                if ((matchedParticipant[key] || '') !== (participantFields[key] || '')) changedLabels.push(labelByField[key] || key);
                            });

                            participantId = matchedParticipant.id;
                            await client.from('participants').update(participantFields).eq('id', participantId);

                            await client.from('registration_events_log').insert({
                                event_type: 'existing_participant_enrolled',
                                participant_id: participantId, staff_number: staffNumber, staff_name: staffName,
                                course_id: courseId, course_name: currentCourse ? currentCourse.name : null
                            });
                            if (changedLabels.length > 0) {
                                await client.from('registration_events_log').insert({
                                    event_type: 'participant_info_updated',
                                    participant_id: participantId, staff_number: staffNumber, staff_name: staffName,
                                    course_id: courseId, course_name: currentCourse ? currentCourse.name : null,
                                    details: `Changed: ${changedLabels.join(', ')}`
                                });
                            }
                        } else {
                            const { data: newParticipant, error: participantInsertErr } = await client
                                .from('participants')
                                .insert({ staff_number: staffNumber, ...participantFields })
                                .select('id')
                                .single();
                            if (participantInsertErr) throw participantInsertErr;
                            participantId = newParticipant.id;

                            await client.from('registration_events_log').insert({
                                event_type: 'new_participant',
                                participant_id: participantId, staff_number: staffNumber, staff_name: staffName,
                                course_id: courseId, course_name: currentCourse ? currentCourse.name : null
                            });
                        }

                        await client.from('registrations').update({ participant_id: participantId }).eq('id', newReg.id);
                    } catch (participantLinkErr) {
                        console.error('Participant link failed (registration itself still succeeded):', participantLinkErr);
                    }
                }

                document.getElementById('customQuestionsContainer').innerHTML = '';
                customQuestionsCache = [];
                document.getElementById('firstLogTitle').value = '';
                document.getElementById('firstLogDept').value = '';
                document.getElementById('firstLogDate').value = '';
                document.getElementById('firstLogTime').value = '';
                showSimpleSuccessCard('You are registered successfully!');
                
                document.getElementById('phoneNumber').value = '';
                document.getElementById('sexSelect').value = '';
                document.getElementById('staffName').value   = '';
                document.getElementById('certNameAgreement').checked = false;
                document.getElementById('staffNumber').value = '';
                document.getElementById('staffNumber').readOnly = false;
                document.getElementById('designationSelect').value = '';
                document.getElementById('otherDesignationInput').value = '';
                document.getElementById('otherDesignationInput').classList.add('hidden-element');
                document.getElementById('specializationInput').value = '';
                document.getElementById('institutionTypeSelect').value = '';
                document.getElementById('departmentSelect').value = '';
                document.getElementById('otherInstitutionInput').value = '';
                resetOtherFreeText();
                // Neither of these is toggled by toggleFormVisibility —
                // departmentContainer/otherInstitutionContainer follow
                // institutionTypeSelect via renderInstitutionFields(), and
                // dynamicUploadsContainer holds whatever the previous
                // course's upload requirements rendered. Without this,
                // both stayed visible under the freshly-reset Staff Number
                // step after a successful submission.
                renderInstitutionFields();
                document.getElementById('dynamicUploadsContainer').innerHTML = '';
                TARGETING_FIELDS.forEach(field => {
                    const select = document.getElementById('reg_' + field.key);
                    if (select) select.value = '';
                });
                document.getElementById('courseSelect').value = '';
                resetStaffGate();
                
                await loadRegistrationFormConfig();
                applyDirectCourseLinkFromUrl();

            } catch (err) {
                alert(err.message || "An error occurred.");
            } finally {
                regBtn.disabled = false;
                regBtn.innerText = "Register Now";
            }
        }

        document.getElementById('institutionTypeSelect').addEventListener('change', renderInstitutionFields);
        document.getElementById('otherInstitutionInput').addEventListener('change', handleOtherInstitutionChange);
        document.getElementById('courseSelect').addEventListener('change', handleCourseSelectionChange);
        document.getElementById('staffGateContinueBtn').addEventListener('click', handleStaffGateContinue);
        document.getElementById('staffNumberGateInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); handleStaffGateContinue(); }
        });
        document.getElementById('staffGateChangeBtn').addEventListener('click', () => {
            resetStaffGate();
        });
        
        document.getElementById('sexSelect').addEventListener('change', updateSelectableCoursesOptions);
        document.getElementById('designationSelect').addEventListener('change', handleDesignationChange);
        function applyDirectCourseLinkFromUrl() {
            const params = new URLSearchParams(window.location.search);
            const raw = params.get('course');
            const courseId = raw ? Number(raw) : null;
            if (!courseId) return;

            const courseDropdown = document.getElementById('courseSelect');
            const exists = Array.from(courseDropdown.options).some(opt => Number(opt.value) === courseId);
            if (!exists) return; // course not currently open/available — leave the normal picker as-is

            courseDropdown.value = String(courseId);
            courseDropdown.disabled = true;
            // Doesn't call handleCourseSelectionChange() here — the Staff
            // Number step now comes BEFORE course selection, so this just
            // pre-selects and locks the dropdown; handleStaffGateContinue
            // picks up from here and continues into course-specific setup
            // once the staff number is resolved.

            const label = document.querySelector('label[for="courseSelect"]');
            if (label && !label.querySelector('.direct-link-note')) {
                const note = document.createElement('span');
                note.className = 'direct-link-note';
                note.style.cssText = 'font-weight:normal; color:#64748b; font-size:12px;';
                note.textContent = ' (direct registration link — course locked)';
                label.appendChild(note);
            }
        }

        document.getElementById('otherDesignationInput').addEventListener('input', updateSelectableCoursesOptions);

        // A ?staff=... URL param (set by activity-log.js when it redirects
        // a not-yet-registered staff number here) skips the Staff Number
        // step's own manual entry — they already typed it once, on the
        // Activity Log page, so this carries it straight through instead
        // of asking for the same number a second time.
        function applyStaffNumberFromUrl() {
            const params = new URLSearchParams(window.location.search);
            const staffNumber = params.get('staff');
            if (!staffNumber) return;
            document.getElementById('staffNumberGateInput').value = staffNumber;
            handleStaffGateContinue();
        }

        document.getElementById('regBtn').addEventListener('click', handleSubmit);

        document.getElementById('closeClosedNoticeBtn').addEventListener('click', () => {
            // Same window.close()-with-fallback pattern used elsewhere —
            // browsers don't allow a script to close a tab it didn't open
            // itself, so this falls back to a plain "you're done" message.
            window.close();
            document.querySelector('.container').innerHTML = '<p style="text-align:center; color:#16a34a; font-weight:bold; padding:60px 0;">All done — you can close this page now.</p>';
        });

        document.getElementById('closeAlreadyRegisteredBtn').addEventListener('click', () => {
            window.close();
            document.querySelector('.container').innerHTML = '<p style="text-align:center; color:#16a34a; font-weight:bold; padding:60px 0;">All done — you can close this page now.</p>';
        });

        document.getElementById('closeNotEligibleBtn').addEventListener('click', () => {
            window.close();
            document.querySelector('.container').innerHTML = '<p style="text-align:center; color:#16a34a; font-weight:bold; padding:60px 0;">All done — you can close this page now.</p>';
        });

        loadRegistrationFormConfig().then(() => {
            applyDirectCourseLinkFromUrl();
            applyStaffNumberFromUrl();
        });
