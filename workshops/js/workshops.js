import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

        const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

        let coursesCached = [];
        let courseInstitutionsMapCached = [];
        let registrationLogsCached = [];
        let institutionsByNameCached = new Map();

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

        // Parses courses.section_pages — which page each of the 8 targeting
        // fields, plus "documents" (Required Documents) and "allocations"
        // (Institutional Allocations / Chair Mapping, which has no
        // participant-facing content of its own — see the "Page Content"
        // block comment above beginRegistrationPaging), is configured for.
        // A key missing from this object means page 1 (every activity
        // created before this feature exists looks exactly like this).
        function getSectionPages(course) {
            let sp = {};
            try {
                const raw = course ? course.section_pages : null;
                sp = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
            } catch (e) { sp = {}; }
            return (sp && typeof sp === 'object') ? sp : {};
        }

        // Parses courses.page_titles — { "1": "Getting Started", "2": "..." },
        // string keys since JSON object keys always are. A page with no key
        // here shows no heading at all.
        function getPageTitles(course) {
            let pt = {};
            try {
                const raw = course ? course.page_titles : null;
                pt = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : {};
            } catch (e) { pt = {}; }
            return (pt && typeof pt === 'object') ? pt : {};
        }

        // Fields that only appear once a course has been chosen
        const REST_OF_FORM_IDS = [
            'staffName', 'staffNumber', 'phoneNumber', 'sexSelect',
            'designationFieldWrapper', 'specializationInput',
            'institutionFieldWrapper', 'submitRowContainer',
            ...TARGETING_FIELDS.map(f => 'regFieldWrapper_' + f.key)
        ];
        // Same list minus the Register button — used wherever ALL of these
        // fields need to be shown/hidden together regardless of which of
        // the two sub-steps below they belong to (switching activities,
        // closing the form entirely).
        const IDENTITY_FIELD_IDS = REST_OF_FORM_IDS.filter(id => id !== 'submitRowContainer');
        // The "identity" step used to be one single reveal covering both of
        // these groups at once — split so Activity Content can be anchored
        // between them too (matching Create Activity's own "Basic Course
        // Information" vs "Target Designations & Seats" sections): the
        // participant's own name/phone/institution fields (now handled per
        // page by IDENTITY_FIELD_PAGE_MAP / applyIdentityFieldPageVisibility
        // below) vs the eligibility/targeting fields the admin configured
        // per-course (targeting) — see buildRegistrationSteps.
        const TARGETING_FIELD_IDS = TARGETING_FIELDS.map(f => 'regFieldWrapper_' + f.key);

        function toggleFormVisibility(show) {
            REST_OF_FORM_IDS.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.classList.toggle('hidden-element', !show);
            });
            const uploads = document.getElementById('dynamicUploadsContainer');
            if (uploads) uploads.classList.toggle('hidden-element', !show);
            document.querySelectorAll('[id^="cqStepWrapper_"]').forEach(el => el.classList.toggle('hidden-element', !show));
            // Closing the rest of the form (closed activity, no course
            // chosen, already registered, not eligible) also closes the
            // page-navigation footer left open from a previous selection —
            // re-opening it is beginRegistrationPaging's own job.
            if (!show) {
                const nav = document.getElementById('regPageNavContainer');
                if (nav) nav.classList.add('hidden-element');
                regPages = [];
                regPageIndex = 0;
                regPagesResolvedForCourse = null;
                regPagesActiveCourse = null;

                const heading = document.getElementById('regPageHeadingWrapper');
                if (heading) heading.classList.add('hidden-element');
                const pcContainer = document.getElementById('pageContentContainer');
                if (pcContainer) pcContainer.innerHTML = '';
                pageContentCache = [];
            }
        }

        // ====================================================================
        // Registration Form paging — every Custom Question (course_questions)
        // and Page Content block (activity_contents) has a "page" number set
        // in Create Activity, defaulting to 1; each of the 8 targeting
        // fields, the Required Documents section, and the Institutional
        // Allocations section (courses.section_pages — the latter has no
        // participant-facing content of its own, see loadPageContentForCourse
        // below) also each carry their own page number this same way. Page 1
        // always contains the fixed Basic Course Information identity
        // fields, plus whichever of the above are configured for page 1 —
        // this reveals right away exactly as it always has. If anything is
        // configured for page 2 or later, a Next/Previous footer walks the
        // participant through those extra pages one at a time, with the
        // Register button only appearing on the last page. An Activity with
        // everything on page 1 (or nothing page-configurable at all) behaves
        // exactly as before — no footer, nothing to pause on.
        // ====================================================================
        let regPages = []; // e.g. [1, 2, 3] — the page numbers actually in use for this course
        let regPageIndex = 0; // index into regPages of the page currently shown
        let regPagesResolvedForCourse = null; // the courseId already fully walked (reached its last page) this visit
        let regPagesActiveCourse = null; // the courseId currently being built/walked for
        let pageContentCache = []; // this course's activity_contents rows (Page Content blocks), fetched once per course selection

        function highestQuestionPage(questions) {
            return (questions || []).reduce((max, q) => Math.max(max, q.page_number || 1), 1);
        }

        // The overall page ceiling for this course — the largest page
        // number configured ANYWHERE: Custom Questions, Page Content
        // blocks, or any of the 8 targeting fields / Required Documents /
        // Institutional Allocations (courses.section_pages).
        function highestPageOverall(courseId) {
            const course = coursesCached.find(c => c.id === courseId);
            const sectionPages = getSectionPages(course);
            let max = highestQuestionPage(customQuestionsCache);
            Object.values(sectionPages).forEach(v => {
                const n = Number(v);
                if (Number.isFinite(n)) max = Math.max(max, n);
            });
            pageContentCache.forEach(b => { max = Math.max(max, b.page_number || 1); });
            return max;
        }

        // Fetches this course's optional Page Content blocks (Title + body
        // text tied to a page number — see sql/course-page-content.sql).
        // Cached the same way customQuestionsCache is, so revealing a page
        // doesn't need its own round trip.
        async function loadPageContentForCourse(courseId) {
            if (!courseId) { pageContentCache = []; return; }
            const { data, error } = await client
                .from('activity_contents')
                .select('*')
                .eq('course_id', courseId)
                .order('content_order', { ascending: true });
            if (error) {
                console.error('Could not load page content for course', courseId, error);
                pageContentCache = [];
                return;
            }
            pageContentCache = data || [];
        }

        // Renders whichever Page Content blocks belong to the page
        // currently on screen — deliberately placed in the DOM (see
        // register.html) before the per-page targeting fields and Custom
        // Questions, so content reads as an intro to that page rather than
        // trailing after its fields.
        function renderPageContentBlocksForPage(pageNum) {
            const container = document.getElementById('pageContentContainer');
            if (!container) return;
            const blocks = pageContentCache.filter(b => (b.page_number || 1) === pageNum);
            if (blocks.length === 0) { container.innerHTML = ''; return; }
            container.innerHTML = blocks.map(b => `
                <div class="reg-page-content-block" style="margin-bottom:16px;">
                    ${b.title ? `<h4 style="margin:0 0 6px; font-size:15px; font-weight:800; color:#0f172a;">${b.title}</h4>` : ''}
                    <div style="font-size:14px; line-height:1.6; color:#334155; white-space:pre-line;">${b.content || ''}</div>
                </div>
            `).join('');
        }

        // The registrant's own fixed identity fields (Full Name, Staff
        // Number, Gender, Designation, Current Post, Phone Number,
        // Department) used to always reveal on page 1 and then stay visible
        // for every later page too — see IDENTITY_FIELD_PAGE_MAP below and
        // Create Activity's Section 1 "Registrant Information Fields" for
        // where an admin sets each one's page (courses.section_pages, same
        // keys). Defaults to page 1 when unset, so an activity that's never
        // touched this still behaves exactly as before.
        const IDENTITY_FIELD_PAGE_MAP = {
            staffName: 'name',
            staffNumber: 'staff_number',
            phoneNumber: 'phone',
            sexSelect: 'gender',
            designationFieldWrapper: 'designation',
            specializationInput: 'specialization',
            institutionFieldWrapper: 'department'
        };
        function applyIdentityFieldPageVisibility(courseId, pageNum) {
            const course = coursesCached.find(c => c.id === courseId);
            const sectionPages = getSectionPages(course);
            Object.entries(IDENTITY_FIELD_PAGE_MAP).forEach(([id, key]) => {
                const el = document.getElementById(id);
                if (!el) return;
                const fieldPage = sectionPages[key] || 1;
                el.classList.toggle('hidden-element', fieldPage !== pageNum);
            });

            // departmentContainer ("Select Department") and
            // otherInstitutionContainer are siblings of institutionFieldWrapper,
            // not children of it — renderInstitutionFields() reveals whichever
            // one matches the chosen Institution type, but nothing re-hides
            // them again when the page changes, so they used to keep showing
            // on every later page once opened once. Tied to the same
            // "department" page as institutionFieldWrapper here: hidden
            // outright off that page, and restored to whichever one actually
            // matches the current Institution selection when back on it.
            const onDeptPage = (sectionPages.department || 1) === pageNum;
            const deptContainer = document.getElementById('departmentContainer');
            const otherContainer = document.getElementById('otherInstitutionContainer');
            if (!onDeptPage) {
                if (deptContainer) deptContainer.classList.add('hidden-element');
                if (otherContainer) otherContainer.classList.add('hidden-element');
            } else {
                renderInstitutionFields();
            }
        }

        // Whether a targeting field's wrapper should be treated as hidden
        // for THIS course entirely (its "Show to registrants" toggle is
        // off, or no course is selected) — set by
        // updateTargetingSelectOptionsForCourse, read by
        // applyTargetingFieldPageVisibility below. Kept as a data attribute
        // (rather than just hidden-element itself) so the two concerns —
        // "is this field offered on this course at all" vs. "is this the
        // page it's configured for" — don't fight over the same class.
        function applyTargetingFieldPageVisibility(courseId, pageNum) {
            const course = coursesCached.find(c => c.id === courseId);
            const sectionPages = getSectionPages(course);
            TARGETING_FIELDS.forEach(field => {
                const wrapper = document.getElementById('regFieldWrapper_' + field.key);
                if (!wrapper) return;
                if (wrapper.dataset.hiddenForCourse === 'true') {
                    wrapper.classList.add('hidden-element');
                    return;
                }
                const fieldPage = sectionPages[field.key] || 1;
                wrapper.classList.toggle('hidden-element', fieldPage !== pageNum);
            });
        }

        // Reveals exactly one page's worth of content: the matching Page
        // Content blocks, identity fields, targeting fields, Required
        // Documents section, and Custom Questions — hiding every other
        // page's. Each identity field (Full Name, Staff Number, ...) now
        // shows ONLY on its own configured page (default page 1), same as
        // the targeting fields — a page no longer keeps showing every
        // earlier page's fields alongside its own.
        function revealRegistrationPage(courseId, pageNum) {
            const course = coursesCached.find(c => c.id === courseId);
            const sectionPages = getSectionPages(course);
            const pageTitles = getPageTitles(course);

            if (pageNum === 1) {
                // Rebuilds each targeting select's option list and re-applies
                // per-field "Show to registrants" rules — only needs doing
                // once, when page 1 first reveals (the option lists
                // themselves don't change per page, only which page a
                // field's wrapper is visible on, handled below).
                updateTargetingSelectOptionsForCourse(courseId);
            }

            applyIdentityFieldPageVisibility(courseId, pageNum);
            applyTargetingFieldPageVisibility(courseId, pageNum);

            const docs = document.getElementById('dynamicUploadsContainer');
            if (docs) {
                const docsPage = sectionPages.documents || 1;
                docs.classList.toggle('hidden-element', docsPage !== pageNum);
            }

            customQuestionsCache.forEach((q, idx) => {
                const el = document.getElementById('cqStepWrapper_' + idx);
                if (!el) return;
                el.classList.toggle('hidden-element', (q.page_number || 1) !== pageNum);
            });

            renderPageContentBlocksForPage(pageNum);

            const headingWrapper = document.getElementById('regPageHeadingWrapper');
            const heading = document.getElementById('regPageHeading');
            if (headingWrapper && heading) {
                const title = pageTitles[String(pageNum)];
                if (title) {
                    heading.textContent = title;
                    headingWrapper.classList.remove('hidden-element');
                } else {
                    headingWrapper.classList.add('hidden-element');
                }
            }
        }

        // Checks everything actually SHOWN on the current registration page
        // has been filled in — called by the Next button so a participant
        // can't skip ahead leaving something on an earlier page blank.
        // Deliberately not native HTML5 validation (there's no <form>
        // element here, and even if there were, a required field hidden on
        // a different page can't be focused for the native validation
        // bubble, which silently blocks everything — the exact bug fixed
        // in Create Activity's hall booking rows). This mirrors the same
        // required-field rules handleSubmit() checks right before saving —
        // nothing here is stricter than what Submit already requires, it
        // just catches it earlier, one page at a time.
        function validateCurrentRegPage() {
            const missing = [];

            Object.keys(IDENTITY_FIELD_PAGE_MAP).forEach(id => {
                const el = document.getElementById(id);
                if (!el || el.classList.contains('hidden-element')) return;
                if (id === 'staffName') {
                    const v = document.getElementById('staffName').value.trim();
                    if (!v) missing.push('Full Name');
                    else if (v.split(/\s+/).filter(Boolean).length < 2) missing.push('Full Name (first and last name)');
                } else if (id === 'staffNumber') {
                    if (!document.getElementById('staffNumber').value.trim()) missing.push('Staff Number');
                } else if (id === 'phoneNumber') {
                    if (!document.getElementById('phoneNumber').value.trim()) missing.push('Phone Number');
                } else if (id === 'sexSelect') {
                    if (!document.getElementById('sexSelect').value) missing.push('Gender');
                } else if (id === 'designationFieldWrapper') {
                    const sel = document.getElementById('designationSelect').value;
                    if (!sel) missing.push('Designation');
                    else if (sel === 'Other' && !document.getElementById('otherDesignationInput').value.trim()) missing.push('Designation (please specify)');
                } else if (id === 'specializationInput') {
                    if (!document.getElementById('specializationInput').value.trim()) missing.push('Current Post');
                } else if (id === 'institutionFieldWrapper') {
                    const instType = document.getElementById('institutionTypeSelect').value;
                    if (!instType) {
                        missing.push('Department');
                    } else if (instType === 'Ibra') {
                        if (!document.getElementById('departmentSelect').value) missing.push('Department');
                    } else {
                        const otherText = document.getElementById('otherInstitutionInput').value;
                        if (!otherText) missing.push('Institution');
                        else if (otherText === OTHER_CATCHALL_NAME && !document.getElementById('otherInstitutionFreeText').value.trim()) missing.push('Institution name');
                    }
                }
            });

            for (const field of TARGETING_FIELDS) {
                const wrapper = document.getElementById('regFieldWrapper_' + field.key);
                if (!wrapper || wrapper.classList.contains('hidden-element')) continue;
                const select = document.getElementById('reg_' + field.key);
                if (select && !select.value) missing.push(field.label);
            }

            const uploads = document.getElementById('dynamicUploadsContainer');
            if (uploads && !uploads.classList.contains('hidden-element')) {
                uploads.querySelectorAll('.custom-file-target').forEach(input => {
                    if (!input.files || input.files.length === 0) missing.push(`Document: ${input.getAttribute('data-label')}`);
                });
            }

            missing.push(...getMissingCustomQuestionLabels(true));

            return missing;
        }

        function updateRegPageNav(courseId) {
            const nav = document.getElementById('regPageNavContainer');
            const prevBtn = document.getElementById('regPagePrevBtn');
            const nextBtn = document.getElementById('regPageNextBtn');
            const submitRow = document.getElementById('submitRowContainer');
            const isLast = regPageIndex === regPages.length - 1;

            prevBtn.classList.toggle('hidden-element', regPageIndex === 0);
            nextBtn.classList.toggle('hidden-element', isLast);
            if (submitRow) submitRow.classList.toggle('hidden-element', !isLast);
            if (isLast) regPagesResolvedForCourse = courseId;

            prevBtn.onclick = () => {
                if (regPageIndex === 0) return;
                regPageIndex--;
                revealRegistrationPage(courseId, regPages[regPageIndex]);
                updateRegPageNav(courseId);
            };
            nextBtn.onclick = () => {
                if (regPageIndex >= regPages.length - 1) return;
                const missing = validateCurrentRegPage();
                if (missing.length > 0) {
                    alert(`Please complete before continuing: ${missing.join(', ')}.`);
                    return;
                }
                regPageIndex++;
                revealRegistrationPage(courseId, regPages[regPageIndex]);
                updateRegPageNav(courseId);
            };

            nav.classList.remove('hidden-element');
        }

        function beginRegistrationPaging(courseId) {
            if (regPagesResolvedForCourse === courseId) {
                // Already walked all the way to this Activity's last page
                // this visit (e.g. handleCourseSelectionChange re-ran
                // because a targeting field changed) — everything real
                // stays exactly as revealed.
                return;
            }

            if (regPagesActiveCourse !== courseId) {
                // A genuinely different Activity than whatever was mid-walk
                // before — hide everything real first so nothing from the
                // previous Activity's pages stays visible underneath the
                // new one's.
                IDENTITY_FIELD_IDS.forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.classList.add('hidden-element');
                });
                const uploads = document.getElementById('dynamicUploadsContainer');
                if (uploads) uploads.classList.add('hidden-element');
                document.querySelectorAll('[id^="cqStepWrapper_"]').forEach(el => el.classList.add('hidden-element'));
                const submitRow = document.getElementById('submitRowContainer');
                if (submitRow) submitRow.classList.add('hidden-element');
                const nav = document.getElementById('regPageNavContainer');
                if (nav) nav.classList.add('hidden-element');
                const headingWrapper = document.getElementById('regPageHeadingWrapper');
                if (headingWrapper) headingWrapper.classList.add('hidden-element');
                const pcContainer = document.getElementById('pageContentContainer');
                if (pcContainer) pcContainer.innerHTML = '';
            }
            regPagesActiveCourse = courseId;

            const maxPage = highestPageOverall(courseId);
            regPages = [];
            for (let p = 1; p <= maxPage; p++) regPages.push(p);
            regPageIndex = 0;

            // Page 1's fixed sections + page-1 questions reveal immediately,
            // same as always.
            revealRegistrationPage(courseId, 1);

            if (regPages.length <= 1) {
                // Nothing past page 1 — no footer needed, Register button
                // shows right away exactly as before paging existed.
                const submitRow = document.getElementById('submitRowContainer');
                if (submitRow) submitRow.classList.remove('hidden-element');
                regPagesResolvedForCourse = courseId;
            } else {
                updateRegPageNav(courseId);
            }
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
            document.getElementById('firstLogDateFrom').value = '';
            document.getElementById('firstLogDateTo').value = '';
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

            // No institution mapping has been configured for this course AT
            // ALL — the admin never restricted it to specific
            // institutions/departments, meaning every department is
            // allowed. This must match the registration-time check further
            // down (courseHasNoMappingConfigured), or a department that's
            // selectable here can still get rejected at submit.
            const mappingsForCourse = courseId ? courseInstitutionsMapCached.filter(m => m.course_id === courseId) : [];
            const courseHasNoMappingConfigured = courseId && mappingsForCourse.length === 0;

            let html = '<option value="">-- Choose Department --</option>';
            departmentsList.forEach(dept => {
                let chairsLeftStr = '';
                let isFull = false;
                let isUnconfigured = false;

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
                            if (chairsLeft <= 0) isFull = true;
                        }
                    } else if (course && (course.unlimited_seats || courseHasNoMappingConfigured)) {
                        // No allocation row at all for this institution on
                        // this specific course. Treated as OPEN (no cap)
                        // when either the course itself is unlimited-seats,
                        // or — more generally — the admin never configured
                        // ANY institution restriction for this course at
                        // all, meaning "allow everyone". This happens for
                        // any institution added to the global list AFTER
                        // this course was created/saved too, since a row
                        // only gets written at save time.
                    } else {
                        // A restriction WAS configured for this course, and
                        // this department specifically wasn't included in
                        // it — it must not appear as an option at all
                        // rather than showing disabled and then failing
                        // later at submission.
                        isUnconfigured = true;
                    }
                }

                if (isUnconfigured) return;

                const selectedAttr = (dept === currentSelected) ? 'selected' : '';
                if (!isFull) {
                    html += `<option value="${dept}" ${selectedAttr}>${dept}${chairsLeftStr}</option>`;
                } else {
                    html += `<option value="${dept}" disabled style="color:#cbd5e1;" ${selectedAttr}>${dept} (FULL)</option>`;
                }
            });
            deptDropdown.innerHTML = html;
        }

        function filterOtherInstitutions(courseId) {
            const otherDropdown = document.getElementById('otherInstitutionInput');
            const currentSelected = otherDropdown.value;
            const options = Array.from(otherDropdown.options);
            const course = coursesCached.find(c => c.id === courseId);

            // No institution mapping has been configured for this course AT
            // ALL — matches the same fallback used in filterIbraDepartments
            // and at registration-submit time: no restriction configured
            // means every institution is allowed.
            const mappingsForCourse = courseId ? courseInstitutionsMapCached.filter(m => m.course_id === courseId) : [];
            const courseHasNoMappingConfigured = courseId && mappingsForCourse.length === 0;

            let html = '';
            options.forEach(opt => {
                if (opt.value === "") { html += opt.outerHTML; return; }
                let isFull = false;
                let isUnconfigured = false;
                let label = opt.value;

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
                            label = `${opt.value} (${chairsLeft} chairs remaining)`;
                            if (chairsLeft <= 0) isFull = true;
                        }
                    } else if (course && (course.unlimited_seats || courseHasNoMappingConfigured)) {
                        // No allocation row at all for this institution on
                        // this course, but the course is either
                        // unlimited-seats or has no institution restriction
                        // configured at all ("allow everyone") — treated as
                        // open, same as an explicit 0. Also covers any
                        // institution added to the global list after this
                        // course was created.
                    } else {
                        // A restriction WAS configured for this course and
                        // this institution wasn't included in it — must not
                        // appear as an option at all.
                        isUnconfigured = true;
                    }
                }

                if (isUnconfigured) return;

                const selectedAttr = (opt.value === currentSelected) ? ' selected' : '';
                if (isFull) {
                    html += `<option value="${opt.value}" disabled style="color:#cbd5e1;"${selectedAttr}>${opt.value} (FULL)</option>`;
                } else {
                    html += `<option value="${opt.value}"${selectedAttr}>${label}</option>`;
                }
            });
            otherDropdown.innerHTML = html;
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
                // Recorded as a data attribute rather than toggled directly
                // here: applyTargetingFieldPageVisibility (called for every
                // page reveal, not just page 1) is what actually decides
                // hidden-element, combining this "hidden for the course at
                // all" flag with "is this the page it's configured for".
                const isHiddenForThisCourse = course && Array.isArray(savedArr) && savedArr.length === 0;
                if (wrapper) wrapper.dataset.hiddenForCourse = (isHiddenForThisCourse || !course) ? 'true' : 'false';
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

                // Text/Date/Time/List answers sit inline with their
                // question (one row); Multiple Choice, Checkbox, and both
                // grid types keep the stacked layout — several radio/
                // checkbox options or a full table read badly crammed
                // onto a single line the way one plain input doesn't.
                const isInlineType = ['text', 'date', 'time', 'list'].includes(q.question_type);

                // Wrapped in its own step div, hidden by default — Activity
                // Content sections can be anchored "before Question N", which
                // needs each question individually revealable as the
                // participant steps through the form (see
                // advanceRegistrationSteps). A course with no content
                // anchored between its questions reveals all of them at once
                // the moment the step before them resolves, so this changes
                // nothing visually for the common case.
                return `
                    <div id="cqStepWrapper_${index}" class="hidden-element">
                        <div class="cq-registration-field${isInlineType ? ' cq-inline-field' : ''}">
                            <label class="cq-question-text"><span class="cq-question-number">${index + 1}</span>${q.question_text} <span style="color:#dc2626;">*</span></label>
                            ${fieldHtml}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Reads every answered custom question into the shape
        // question_responses.response_value expects: a plain string for
        // Text/Date/Time/List/Multiple Choice, an array for Checkbox, and a
        // { rowLabel: answer } map for the two grid types. Every custom
        // question is now required (see validateCurrentRegPage /
        // getMissingCustomQuestionLabels), so by the time this runs every
        // question should already have an answer — but it still only
        // collects whatever is actually filled in, same as before.
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

        // Every Custom Question is required — this is the one shared check
        // both validateCurrentRegPage (per-page, on Next) and handleSubmit
        // (a final backstop covering every page, same as the file-upload
        // and first-log-entry checks there) call into, so the rule only
        // has to be defined once. onlyVisible=true scopes it to whatever
        // question steps are actually revealed right now (used per-page);
        // handleSubmit calls it with onlyVisible=false since by then every
        // page should already have been walked.
        function getMissingCustomQuestionLabels(onlyVisible) {
            const missing = [];
            customQuestionsCache.forEach((q, idx) => {
                if (onlyVisible) {
                    const wrapper = document.getElementById('cqStepWrapper_' + idx);
                    if (!wrapper || wrapper.classList.contains('hidden-element')) return;
                }
                const label = `Question ${idx + 1}`;
                if (q.question_type === 'text' || q.question_type === 'date' || q.question_type === 'time' || q.question_type === 'list') {
                    const input = document.querySelector(`.cq-answer-input[data-qid="${q.id}"]`);
                    if (!input || !input.value) missing.push(label);
                } else if (q.question_type === 'multiple_choice') {
                    const checked = document.querySelector(`.cq-answer-radio[data-qid="${q.id}"]:checked`);
                    if (!checked) missing.push(label);
                } else if (q.question_type === 'checkbox') {
                    const checked = document.querySelectorAll(`.cq-answer-checkbox[data-qid="${q.id}"]:checked`);
                    if (checked.length === 0) missing.push(label);
                } else if (q.question_type === 'multiple_choice_grid' || q.question_type === 'checkbox_grid') {
                    const rowMap = {};
                    document.querySelectorAll(`.cq-answer-grid[data-qid="${q.id}"]:checked`).forEach(el => { rowMap[el.dataset.row] = true; });
                    const totalRows = Array.isArray(q.grid_rows) ? q.grid_rows.length : 0;
                    if (totalRows === 0 || Object.keys(rowMap).length < totalRows) missing.push(label);
                }
            });
            return missing;
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
            // Awaited — beginRegistrationPaging needs customQuestionsCache
            // already populated to know each question's page number.
            await renderCustomQuestionsForRegistration(courseId);
            await loadPageContentForCourse(courseId);

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
            } else {
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

            // Runs dead last, once every field above (prefill, uploads) has
            // been populated — reveals page 1 (identity fields, Required
            // Documents, page-1 questions) right away, and sets up the
            // Previous/Next footer if this course's questions span more
            // than one page.
            beginRegistrationPaging(courseId);
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
                client.from('institutions').select('id, name')
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
            // Lets registration proceed against the actual institution row
            // even when NO course_institutions allocation row exists for it
            // (an unrestricted/unlimited course — see the "not authorized"
            // fix above) — allocationConfig.institution_id isn't available
            // in that case, so this is the fallback source of truth for the
            // real institution id to save against the registration/participant.
            institutionsByNameCached = new Map((institutionsData || []).map(i => [i.name, i.id]));
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
                    const closedDescEl = document.getElementById('featuredDescription');
                    closedDescEl.textContent = registrationStatusMessage(closedDirectCourse);
                    closedDescEl.classList.remove('has-comment');
                    document.getElementById('featuredMeta').innerHTML = `<span>📅 ${closedDirectCourse.course_date}</span>`;
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
            const descEl = document.getElementById('featuredDescription');
            descEl.innerHTML = description
                ? `<span class="comment-pin-icon">📌</span> <span class="comment-shimmer-text">${description}</span>`
                : `Open registration — ${featured.unlimited_seats ? 'unlimited chairs' : featured.seats + ' chair' + (featured.seats === 1 ? '' : 's')} available.`;
            descEl.classList.toggle('has-comment', Boolean(description));

            const metaParts = [`<span>📅 ${featured.course_date}</span>`];
            if ((featured.instructor_name || '').trim()) metaParts.push(`<span>🎓 ${featured.instructor_name}</span>`);
            metaParts.push(`<span>🪑 ${featured.unlimited_seats ? 'Unlimited' : featured.seats} available</span>`);
            document.getElementById('featuredMeta').innerHTML = metaParts.join('');

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
                const firstLogDateFromVal = document.getElementById('firstLogDateFrom').value;
                const firstLogDateToVal = document.getElementById('firstLogDateTo').value;
                if (!firstLogTitleVal || !firstLogDeptVal || !firstLogDateFromVal || !firstLogDateToVal) {
                    alert("Please fill in the title, organized by, and date range for your first session.");
                    return;
                }
                if (firstLogDateToVal < firstLogDateFromVal) {
                    alert('The "To" date can\'t be before the "From" date.');
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

            // Final backstop covering every page, same reasoning as the
            // file-upload check right below — the per-page Next button
            // already blocks this one page at a time, but a single-page
            // course with no Next click at all still needs to be caught
            // here before the registration actually saves.
            const missingQuestions = getMissingCustomQuestionLabels(false);
            if (missingQuestions.length > 0) {
                alert(`Please answer every question — missing: ${missingQuestions.join(', ')}.`);
                return;
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

                // Mirrors the exact same "open when unconfigured" rule the
                // dropdowns already apply (filterIbraDepartments /
                // filterOtherInstitutions): a missing allocation row is only
                // a real problem when the course actually HAS a
                // restriction configured and this institution just isn't
                // part of it. If the course was never restricted to
                // specific institutions at all (no rows), or the course is
                // unlimited-seats, there's nothing to be "not authorized"
                // for — every institution is allowed and uncapped. Without
                // this, an institution that the dropdown itself offered as
                // open could still be rejected here.
                const mappingsForCourse = courseInstitutionsMapCached.filter(m => m.course_id === courseId);
                const courseHasNoMappingConfigured = mappingsForCourse.length === 0;

                if (!allocationConfig && !courseHasNoMappingConfigured && !(currentCourse && currentCourse.unlimited_seats)) {
                    throw new Error("This institution/department is not authorized or assigned slots for this specific course framework.");
                }

                // allocationConfig.institution_id is only available when a
                // course_institutions row actually exists for this
                // institution — which, per the fix above, is no longer
                // guaranteed (an unrestricted/unlimited course can register
                // an institution with no allocation row at all). Falls back
                // to looking the institution up directly by name so the
                // real institution id is still saved either way.
                const resolvedInstitutionId = allocationConfig ? allocationConfig.institution_id : (institutionsByNameCached.get(allocationLookupName) ?? null);

                if (allocationConfig) {
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
                }
                // No allocationConfig row AND the course is open (unlimited
                // or unrestricted) — no cap to check against, registration
                // proceeds uncapped for this institution.

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
                    p_institution_id: resolvedInstitutionId,
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
                const firstLogDateFrom = document.getElementById('firstLogDateFrom').value;
                const firstLogDateTo = document.getElementById('firstLogDateTo').value;
                const hasFirstLogEntry = firstLogTitle && firstLogDept && firstLogDateFrom && firstLogDateTo;

                // .maybeSingle() throws (and silently comes back with
                // newReg === null, since the error here isn't checked) the
                // moment this course_id + staff_number pair ever matches
                // MORE than one row — which is exactly what silently
                // skipped the whole block below (custom answers, the
                // first Logged Entry, and the participant link) for some
                // participants, even though they'd filled in the form
                // correctly. Ordering by newest and taking the first row
                // instead of maybeSingle() means a stray duplicate can
                // never again make this lookup come back empty.
                const { data: newRegRows } = await client
                    .from('registrations')
                    .select('id')
                    .eq('course_id', courseId)
                    .ilike('staff_number', staffNumber)
                    .order('created_at', { ascending: false })
                    .limit(1);
                const newReg = (newRegRows && newRegRows[0]) || null;

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

                        // department was missing here — the entry's own
                        // "Organized By" choice (firstLogDept) was applied
                        // to the registration's institution_name_snapshot
                        // just above, but never saved onto the entry row
                        // itself, so the Participant Registrations page's
                        // "Logged Entries (Title / Date / Department)"
                        // column and the Courses-per-Department report
                        // both had to fall back to guessing it.
                        await client.from('activity_log_entries').insert({
                            registration_id: newReg.id, title: firstLogTitle,
                            entry_date_from: firstLogDateFrom, entry_date_to: firstLogDateTo,
                            department: firstLogDept
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
                            institution_id: resolvedInstitutionId,
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
                document.getElementById('firstLogDateFrom').value = '';
                document.getElementById('firstLogDateTo').value = '';
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