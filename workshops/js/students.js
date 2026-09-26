import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
// XLSX and exportStyledExcel come from plain <script> tags loaded in
// admin/students.html (xlsx-js-style + js/excel-export.js) — not imported
// here, since xlsx-js-style has to be loaded as a global, not an ES module.
        const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        let allData = [];

        const PAGE_SIZE = 10;
        let studentsCurrentPage = 1;

        function renderPagination(containerId, totalItems, currentPage, onChange) {
            const container = document.getElementById(containerId);
            if (!container) return;
            const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
            if (totalPages <= 1) { container.innerHTML = ''; return; }

            let html = `<button type="button" class="pg-btn" data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''}>‹ Prev</button>`;
            for (let p = 1; p <= totalPages; p++) {
                html += `<button type="button" class="pg-btn${p === currentPage ? ' active' : ''}" data-page="${p}">${p}</button>`;
            }
            html += `<button type="button" class="pg-btn" data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''}>Next ›</button>`;
            container.innerHTML = html;

            container.querySelectorAll('[data-page]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const page = Number(btn.dataset.page);
                    if (page >= 1 && page <= totalPages) onChange(page);
                });
            });
        }

        function getCourseFilterIdFromUrl() {
            const params = new URLSearchParams(window.location.search);
            const raw = params.get('course_id');
            const parsed = raw ? Number(raw) : null;
            return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
        }

        function renderCourseFilterBanner(courseFilterId, courses) {
            const banner = document.getElementById('courseFilterBanner');
            if (!banner) return;
            if (!courseFilterId) {
                banner.innerHTML = '';
                document.getElementById('attendanceFilter').classList.remove('hidden-element');
                return;
            }
            const course = courses.find(c => c.id === courseFilterId);
            const courseName = course ? course.name : 'Unknown / Deleted Course';
            // The attendance filter doesn't mean anything for a course that
            // doesn't track attendance at all.
            const hideAttendanceFilter = !!course && course.attendance_required === false;
            const attendanceFilterEl = document.getElementById('attendanceFilter');
            attendanceFilterEl.classList.toggle('hidden-element', hideAttendanceFilter);
            if (hideAttendanceFilter) attendanceFilterEl.value = 'all';
            banner.innerHTML = `
                <div class="course-filter-banner">
                    <span>📋 Showing registrations for: <strong>${courseName}</strong></span>
                    <a class="btn-clear-filter" href="students.html">Clear filter (view all)</a>
                </div>
            `;
        }

        // The Participant Registrations table shows a different column set
        // when we're filtered to one specific course AND that course
        // doesn't track attendance (a "self-log" activity type) — in that
        // case Activity/Date are redundant (the course is already named in
        // the banner above) and Attended is meaningless, so they're replaced
        // by the participant's logged entries shown inline plus an Edit
        // button. Every other view keeps the original 11-column layout.
        function renderTableHead(noAttendanceFilteredView) {
            const headRow = document.getElementById('studentsTableHeadRow');
            if (!headRow) return;
            headRow.innerHTML = noAttendanceFilteredView
                ? `
                    <th>#</th>
                    <th>Phone Number</th>
                    <th>Participant Name</th>
                    <th>Staff Number</th>
                    <th>Gender</th>
                    <th>Institution Origin</th>
                    <th>Logged Entries (Title / Date / Department)</th>
                    <th>Action</th>
                `
                : `
                    <th>#</th>
                    <th>Phone Number</th>
                    <th>Participant Name</th>
                    <th>Staff Number</th>
                    <th>Gender</th>
                    <th>Institution Origin</th>
                    <th>Activity</th>
                    <th>Date</th>
                    <th>Attended</th>
                    <th>Answers</th>
                    <th>Action</th>
                `;
        }

        function tableColumnCount(noAttendanceFilteredView) {
            return noAttendanceFilteredView ? 8 : 11;
        }

        let logEntriesByRegId = new Map();

        async function loadData() {
            const tbody = document.getElementById('tableBody');
            tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:#64748b; padding:20px;">Loading student registrations...</td></tr>`;

            const { data: courses, error: coursesErr } = await client.from('courses').select('*');
            if (coursesErr) {
                tbody.innerHTML = `<tr><td colspan="11" style="color:#dc2626; text-align:center; padding:20px;">Error loading courses: ${coursesErr.message}</td></tr>`;
                return;
            }

            const { data: regs, error } = await client.from('registrations').select('*').order('created_at', { ascending: false });
            if (error) {
                tbody.innerHTML = `<tr><td colspan="11" style="color:#dc2626; text-align:center; padding:20px;">Error loading registrations: ${error.message}</td></tr>`;
                return;
            }

            // Needed so the admin's "Get Certificate" button can call the
            // same generate-certificate function the public page uses —
            // it's keyed by public_slug, one per course. Certificates are
            // no longer tracked/stored anywhere, so there's nothing to look
            // up here beyond "does this course even have a template".
            let publicSlugByCourseId = new Map();
            try {
                const { data: certTemplates } = await client.from('certificates').select('course_id, public_slug');
                (certTemplates || []).forEach(c => {
                    if (c.public_slug) publicSlugByCourseId.set(c.course_id, c.public_slug);
                });
            } catch (e) {
                // No template info — the button just won't show for anyone.
            }

            // Which courses have any custom questions at all — used to
            // decide whether the "Answers" column shows a View button or
            // just a dash for a given row.
            let coursesWithQuestions = new Set();
            try {
                const { data: questionRows } = await client.from('course_questions').select('course_id');
                (questionRows || []).forEach(q => coursesWithQuestions.add(q.course_id));
            } catch (e) {
                // If this fails, the column just shows dashes for everyone.
            }

            let mappedData = regs.map(r => {
                const targetCourse = courses.find(c => c.id === r.course_id);
                return {
                    ...r,
                    course_name: targetCourse ? targetCourse.name : 'Deleted Course',
                    attendance_required: !targetCourse || targetCourse.attendance_required !== false,
                    course_date: targetCourse ? targetCourse.course_date : 'N/A',
                    course_labels: targetCourse && Array.isArray(targetCourse.file_labels) ? targetCourse.file_labels : []
                };
            });

            const courseFilterId = getCourseFilterIdFromUrl();
            renderCourseFilterBanner(courseFilterId, courses || []);

            const filteredCourse = courseFilterId ? (courses || []).find(c => c.id === courseFilterId) : null;
            const noAttendanceFilteredView = !!filteredCourse && filteredCourse.attendance_required === false;
            renderTableHead(noAttendanceFilteredView);
            const colCount = tableColumnCount(noAttendanceFilteredView);

            if (courseFilterId) {
                mappedData = mappedData.filter(r => r.course_id === courseFilterId);
            }

            const attendanceFilterValue = document.getElementById('attendanceFilter').value;
            if (attendanceFilterValue === 'attended') {
                mappedData = mappedData.filter(r => r.attended);
            } else if (attendanceFilterValue === 'not_attended') {
                mappedData = mappedData.filter(r => !r.attended);
            }

            // Live "as you type" search — same single box, same no-button
            // debounced strategy as before, now matching EITHER the Staff
            // Number (from the START, so "152" matches "1520045" but not
            // "9991520" — same prefix behavior as a phone contacts search)
            // OR the Staff Name (matches anywhere in the name, since a name
            // search is naturally "contains" rather than "starts with").
            const staffSearchEl = document.getElementById('staffNumberSearchInput');
            const staffSearchValue = staffSearchEl ? staffSearchEl.value.trim().toLowerCase() : '';
            if (staffSearchValue) {
                mappedData = mappedData.filter(r =>
                    (r.staff_number || '').toString().toLowerCase().startsWith(staffSearchValue) ||
                    (r.staff_name || '').toLowerCase().includes(staffSearchValue)
                );
            }

            allData = mappedData;

            document.getElementById('stats').innerHTML = `
                <div class="stat-card">
                    <div class="stat-label">${courseFilterId ? 'Registrations for This Course' : 'Total Participants'}</div>
                    <div class="stat-number">${allData.length}</div>
                </div>
            `;

            if (allData.length === 0) {
                const emptyMsg = staffSearchValue
                    ? `No participant matching Staff Number or Name "${staffSearchEl.value.trim()}" found${courseFilterId ? ' in this course' : ''}.`
                    : `No student registrations found${courseFilterId ? ' for this course' : ''}.`;
                tbody.innerHTML = `<tr><td colspan="${colCount}" style="text-align:center; color:#64748b; padding:20px;">${emptyMsg}</td></tr>`;
                document.getElementById('studentsPagination').innerHTML = '';
                return;
            }

            // The inline "Logged Entries" column (self-log courses only)
            // needs every entry for every participant currently in scope —
            // fetched once per loadData call, not per page, since paging
            // only re-renders rows from data already in hand.
            logEntriesByRegId = new Map();
            if (noAttendanceFilteredView) {
                const regIds = allData.map(r => r.id);
                const { data: entries } = await client
                    .from('activity_log_entries')
                    .select('id, registration_id, title, entry_date_from, entry_date_to, department')
                    .in('registration_id', regIds)
                    .order('entry_date_from', { ascending: false });
                (entries || []).forEach(e => {
                    if (!logEntriesByRegId.has(e.registration_id)) logEntriesByRegId.set(e.registration_id, []);
                    logEntriesByRegId.get(e.registration_id).push(e);
                });
            }

            if (studentsCurrentPage > Math.ceil(allData.length / PAGE_SIZE)) studentsCurrentPage = 1;

            renderTableRows();

            function renderTableRows() {
            const pageStart = (studentsCurrentPage - 1) * PAGE_SIZE;
            const pageData = allData.slice(pageStart, pageStart + PAGE_SIZE);

            // Re-rendered on every call (not just the first) — this is what
            // actually keeps the highlighted page number in sync. Previously
            // this ran once outside renderTableRows, so clicking a page
            // button updated the table rows correctly but never rebuilt the
            // pagination bar itself, leaving page 1 permanently highlighted
            // regardless of which page was actually showing.
            renderPagination('studentsPagination', allData.length, studentsCurrentPage, (page) => {
                studentsCurrentPage = page;
                renderTableRows();
                document.getElementById('tableBody').closest('table').scrollIntoView({ behavior: 'smooth', block: 'start' });
            });

            tbody.innerHTML = pageData.map((r, i) => {
                const filesList = Array.isArray(r.file_urls) ? r.file_urls : [];

                const linksHtml = filesList.map((url, idx) => {
                    const label = r.course_labels[idx] || `Attachment #${idx + 1}`;
                    return `<a href="${url}" target="_blank" class="btn-view-file" title="${label}">📄 View ${label}</a>`;
                }).join('');

                const templateSlug = publicSlugByCourseId.get(r.course_id);
                const certCell = templateSlug
                    ? `<button type="button" class="btn-create-cert" data-slug="${templateSlug}" data-staff="${(r.staff_number || '').replace(/"/g, '&quot;')}" onclick="handleCreateCertificate(this)">Get Certificate</button>`
                    : '<span style="color:#94a3b8; font-size:12px;">No template</span>';

                // Attendance and Certificate aren't meaningful for a course
                // that doesn't require attendance — this participant instead
                // self-logs a repeatable list of {title, date, time} entries,
                // viewed here as a table rather than tracked as attended/not.
                const courseForRow = courses.find(c => c.id === r.course_id);
                const isAttendanceRequired = !courseForRow || courseForRow.attendance_required !== false;
                const attendanceCell = isAttendanceRequired
                    ? `<button type="button" class="attendance-toggle-btn ${r.attended ? 'attended-yes' : 'attended-no'}" data-action="toggle-attendance" data-reg-id="${r.id}">${r.attended ? '✓ Attended' : '— Not yet'}</button>`
                    : `<button type="button" class="btn-tbl-view" data-action="view-log" data-reg-id="${r.id}" data-staff-name="${(r.staff_name || '').replace(/"/g, '&quot;')}">View</button>`;
                const certOrLogCell = isAttendanceRequired ? certCell : '<span style="color:#94a3b8; font-size:12px;">—</span>';
                const answersCell = coursesWithQuestions.has(r.course_id)
                    ? `<button type="button" class="btn-tbl-view" data-action="view-answers" data-reg-id="${r.id}" data-staff-name="${(r.staff_name || '').replace(/"/g, '&quot;')}">View</button>`
                    : '<span style="color:#94a3b8; font-size:12px;">—</span>';

                const removeBtnHtml = `
                    <button class="btn-delete" onclick="handleDeleteRegistration(${r.id}, ${r.course_id}, ${r.institution_id}, '${(r.staff_name || '').replace(/'/g, "\\'")}', '${(r.course_name || '').replace(/'/g, "\\'")}')">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                        Remove
                    </button>
                `;

                // Alternate row layout: only when we're filtered to one
                // specific course AND that course doesn't require
                // attendance. Activity/Date/Attended are dropped (redundant
                // once filtered to one course / meaningless without
                // attendance) in favor of the participant's logged entries
                // shown inline (stacked, one line per entry) plus an Edit
                // button. Every other view (no filter, or a filtered course
                // that DOES require attendance) falls through to the
                // original 11-column row below, unchanged.
                if (noAttendanceFilteredView) {
                    const entries = logEntriesByRegId.get(r.id) || [];
                    // "Organized By" (department) is chosen from the same
                    // Ibra-department list used on the participant's own
                    // self-log page (js/activity-log.js's "Organized By"
                    // dropdown) — every entry defaults to whatever
                    // department is already on the registration
                    // (institution_name_snapshot, "Ibra - " prefix
                    // stripped) until an admin explicitly picks a
                    // different one for that entry via Edit.
                    const fallbackDept = stripIbraPrefix(r.institution_name_snapshot);
                    // Capped height + its own scrollbar so a participant
                    // with many entries grows the ROW just a little instead
                    // of stretching the whole table (and the page) taller
                    // than the screen; word-break keeps a long title/
                    // department from forcing the column wider than the
                    // page on a narrow screen.
                    const logEntriesCell = entries.length === 0
                        ? '<span style="color:#94a3b8; font-size:12px;">No entries yet</span>'
                        : `<div style="max-height:140px; overflow-y:auto; min-width:160px; max-width:260px;">` +
                            entries.map(e => `
                                <div style="padding:4px 0; border-bottom:1px dashed #f1f5f9; word-break:break-word;">
                                    <strong>${e.title}</strong><br>
                                    <span style="font-size:12px; color:#64748b;">${formatEntryDateRange(e.entry_date_from, e.entry_date_to)} · ${e.department || fallbackDept || '—'}</span>
                                </div>
                            `).join('') +
                          `</div>`;

                    return `
                        <tr>
                            <td><b>${pageStart + i + 1}</b></td>
                            <td>${r.phone_number || 'N/A'}</td>
                            <td>${r.staff_name}</td>
                            <td>${r.staff_number}</td>
                            <td><span class="gender-badge">${r.sex_snapshot || r.sex || 'N/A'}</span></td>
                            <td><span class="inst-badge">${r.institution_name_snapshot}</span></td>
                            <td>${logEntriesCell}</td>
                            <td>
                                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                    <button type="button" class="btn-tbl-view" data-action="edit-participant" data-reg-id="${r.id}">Edit</button>
                                    ${removeBtnHtml}
                                </div>
                            </td>
                        </tr>
                    `;
                }

                return `
                    <tr>
                        <td><b>${pageStart + i + 1}</b></td>
                        <td>${r.phone_number || 'N/A'}</td>
                        <td>${r.staff_name}</td>
                        <td>${r.staff_number}</td>
                        <td><span class="gender-badge">${r.sex_snapshot || r.sex || 'N/A'}</span></td>
                        <td><span class="inst-badge">${r.institution_name_snapshot}</span></td>
                        <td><span class="course-badge">${r.course_name}</span></td>
                        <td>${r.course_date ? formatEntryDate(r.course_date) : 'N/A'}</td>
                        <td>${attendanceCell}</td>
                        <td>${answersCell}</td>
                        <td>
                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                <button type="button" class="btn-tbl-view" data-action="edit-participant" data-reg-id="${r.id}">Edit</button>
                                ${removeBtnHtml}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');

            tbody.querySelectorAll('[data-action="edit-participant"]').forEach(btn => {
                btn.addEventListener('click', () => showParticipantEditModal(Number(btn.dataset.regId)));
            });

            tbody.querySelectorAll('[data-action="toggle-attendance"]').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const regId = Number(btn.dataset.regId);
                    const currentlyAttended = btn.classList.contains('attended-yes');
                    const newValue = !currentlyAttended;
                    const label = newValue ? 'mark as attended' : 'mark as NOT attended';
                    if (!(await confirmCard(`Are you sure you want to ${label}?`))) return;

                    btn.disabled = true;
                    const { error } = await client.from('registrations')
                        .update({ attended: newValue, attended_at: newValue ? new Date().toISOString() : null })
                        .eq('id', regId);
                    btn.disabled = false;
                    if (error) { alert('Could not update attendance: ' + error.message); return; }
                    alert('Attendance updated!');
                    loadData();
                });
            });

            tbody.querySelectorAll('[data-action="view-log"]').forEach(btn => {
                btn.addEventListener('click', () => showActivityLogModal(Number(btn.dataset.regId), btn.dataset.staffName));
            });
            tbody.querySelectorAll('[data-action="view-answers"]').forEach(btn => {
                btn.addEventListener('click', () => showCustomAnswersModal(Number(btn.dataset.regId), btn.dataset.staffName));
            });
            }
        }

        function formatEntryDate(dateStr) {
            return new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        }
        // Institutions are stored as "Ibra - <Department>" for Ibra's own
        // departments (same convention used everywhere else this app
        // splits institutions this way — see js/activity-log.js). Strips
        // that prefix for display/pre-selecting in the "Organized By" list;
        // non-Ibra institutions (or a blank snapshot) pass through as-is.
        function stripIbraPrefix(name) {
            if (!name) return '';
            return name.startsWith('Ibra - ') ? name.replace('Ibra - ', '') : name;
        }
        let ibraDepartmentOptionsCache = null;
        async function getIbraDepartmentOptions() {
            if (ibraDepartmentOptionsCache) return ibraDepartmentOptionsCache;
            const { data, error } = await client.from('institutions').select('name');
            if (error || !data) return [];
            ibraDepartmentOptionsCache = data.filter(i => i.name.startsWith('Ibra - ')).map(i => i.name.replace('Ibra - ', ''));
            return ibraDepartmentOptionsCache;
        }
        function formatEntryDateRange(fromStr, toStr) {
            if (!toStr || toStr === fromStr) return formatEntryDate(fromStr);
            return `${formatEntryDate(fromStr)} – ${formatEntryDate(toStr)}`;
        }

        async function showActivityLogModal(registrationId, staffName) {
            const overlay = document.createElement('div');
            overlay.className = 'form-modal-overlay';
            overlay.innerHTML = `
                <div class="form-modal-card" style="max-width:520px;">
                    <div class="form-toast-title">Activity Log — ${staffName}</div>
                    <div id="activityLogModalBody">Loading…</div>
                    <div class="confirm-actions" style="margin-top:16px;">
                        <button type="button" class="confirm-btn confirm-ok" id="activityLogCloseBtn" style="flex:none; padding-left:24px; padding-right:24px;">Close</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.querySelector('#activityLogCloseBtn').addEventListener('click', () => overlay.remove());
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

            const { data, error } = await client
                .from('activity_log_entries')
                .select('title, entry_date_from, entry_date_to')
                .eq('registration_id', registrationId)
                .order('entry_date_from', { ascending: false });

            // The department chosen in Activity Log updates the
            // participant's CURRENT institution_name_snapshot directly
            // (not stored per past entry), so this shows their current
            // department alongside their entry history, not a historical
            // per-entry value that doesn't exist.
            const { data: regRow } = await client.from('registrations').select('institution_name_snapshot').eq('id', registrationId).maybeSingle();
            const currentDept = (regRow?.institution_name_snapshot || '').replace('Ibra - ', '') || '—';

            const body = overlay.querySelector('#activityLogModalBody');
            if (error) {
                body.innerHTML = `<p style="color:#dc2626; font-size:13px;">Couldn't load entries: ${error.message}</p>`;
                return;
            }
            if (!data || data.length === 0) {
                body.innerHTML = '<p style="color:#94a3b8; font-size:13px;">No entries logged yet.</p>';
                return;
            }
            body.innerHTML = `
                <table style="width:100%; border-collapse:collapse; font-size:13.5px;">
                    <thead><tr style="text-align:left; color:#64748b; font-size:12px;">
                        <th style="padding:6px 8px; border-bottom:2px solid #f1f5f9;">Title</th>
                        <th style="padding:6px 8px; border-bottom:2px solid #f1f5f9;">Date</th>
                        <th style="padding:6px 8px; border-bottom:2px solid #f1f5f9;">Department</th>
                    </tr></thead>
                    <tbody>
                        ${data.map(e => `
                            <tr>
                                <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${e.title}</td>
                                <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${formatEntryDateRange(e.entry_date_from, e.entry_date_to)}</td>
                                <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${currentDept}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        // Formats a question_responses.response_value for display — its
        // shape depends on the question type: a plain string for Text/Date/
        // Time/List/Multiple Choice, an array for Checkbox, or a
        // { rowLabel: answer } map for the two grid types.
        function formatResponseValue(value) {
            if (Array.isArray(value)) return value.join(', ');
            if (value && typeof value === 'object') {
                return Object.entries(value).map(([row, ans]) => `${row}: ${Array.isArray(ans) ? ans.join(', ') : ans}`).join('<br>');
            }
            return value || '';
        }

        // Editable counterpart to showActivityLogModal — used only from the
        // no-attendance-filtered-course view's Edit button. Lets an admin
        // correct Title / Date From / Date To / Department for each of a
        // participant's self-logged entries and saves them all back to
        // activity_log_entries in one go. Every entry that actually changed
        // gets a best-effort row in deletion_audit_log so the edit shows up
        // on the hub-wide Deletion Log page (js/admin-deletion-log.js).
        // Unified participant editor — replaces the old log-entries-only
        // "Edit" (js/workshops.js's registration form already validates all
        // of this at signup time; this is the admin-side correction tool
        // for after the fact). Edits the REGISTRATION row shown in this
        // table — i.e. this one course's own record — not the shared
        // participants master profile, so correcting a typo here never
        // silently rewrites another course's historical data. For a
        // no-attendance course, the Logged Entries section is folded into
        // the same modal/save action rather than being a separate button,
        // so both are reviewed and saved together.
        async function showParticipantEditModal(registrationId) {
            const row = allData.find(r => r.id === registrationId);
            if (!row) { alert('Could not find that registration — try refreshing the page.'); return; }

            const isNoAttendanceCourse = row.attendance_required === false;

            const overlay = document.createElement('div');
            overlay.className = 'form-modal-overlay';
            overlay.innerHTML = `
                <div class="form-modal-card" style="max-width:min(94vw, 620px); width:100%; max-height:88vh; display:flex; flex-direction:column; box-sizing:border-box;">
                    <div class="form-toast-title">Edit Participant — ${(row.staff_name || '').replace(/</g, '&lt;')}</div>
                    <div id="participantEditModalBody" style="overflow-y:auto; flex:1; min-height:0; padding-right:4px;">Loading…</div>
                    <div class="confirm-actions" style="margin-top:16px; flex-shrink:0;">
                        <button type="button" class="confirm-btn confirm-cancel" id="participantEditCancelBtn">Cancel</button>
                        <button type="button" class="confirm-btn confirm-ok" id="participantEditSaveBtn">Save Changes</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.querySelector('#participantEditCancelBtn').addEventListener('click', () => overlay.remove());
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

            const body = overlay.querySelector('#participantEditModalBody');
            const saveBtn = overlay.querySelector('#participantEditSaveBtn');

            const [departmentOptions, logResult] = await Promise.all([
                getIbraDepartmentOptions(),
                isNoAttendanceCourse
                    ? client.from('activity_log_entries').select('id, title, entry_date_from, entry_date_to, department').eq('registration_id', registrationId).order('entry_date_from', { ascending: false })
                    : Promise.resolve({ data: [] })
            ]);
            const logData = logResult.data || [];

            const isIbra = (row.institution_name_snapshot || '').startsWith('Ibra - ');
            const currentDept = isIbra ? row.institution_name_snapshot.replace('Ibra - ', '') : '';

            // Every field on the registration row an admin might need to
            // correct. Job Level / Nationality / etc. are free-typed
            // rather than dropdowns — this table holds registrations
            // across every activity, each with its own configured option
            // list, so a single generic dropdown here could never match
            // all of them; free text lets an admin fix a typo or fill in
            // something missing without fighting a list that doesn't apply
            // to this activity. Designation Category (the one used for
            // course eligibility rules) is deliberately left out — it's
            // derived from Designation, and editing it separately here
            // could silently desync the two.
            const FIELD_DEFS = [
                { key: 'staff_name', label: 'Full Name', id: 'pe_staff_name', type: 'text' },
                { key: 'staff_number', label: 'Staff Number', id: 'pe_staff_number', type: 'text', readonly: true, note: "The participant's identity key across attendance, certificates and their participant record — can't be changed here." },
                { key: 'phone_number', label: 'Phone Number', id: 'pe_phone_number', type: 'text' },
                { key: 'sex_snapshot', label: 'Gender', id: 'pe_sex', type: 'select', options: ['Male', 'Female'] },
                { key: 'designation_snapshot', label: 'Designation', id: 'pe_designation', type: 'text' },
                { key: 'specialization_snapshot', label: 'Current Post', id: 'pe_specialization', type: 'text' },
                { key: 'job_level_snapshot', label: 'Job Level', id: 'pe_job_level', type: 'text' },
                { key: 'nationality_snapshot', label: 'Nationality', id: 'pe_nationality', type: 'text' },
                { key: 'education_qualification_snapshot', label: 'Highest Educational Qualification', id: 'pe_education', type: 'text' },
                { key: 'experience_years_snapshot', label: 'Experience Years', id: 'pe_experience', type: 'text' },
                { key: 'organization_snapshot', label: 'Organization', id: 'pe_organization', type: 'text' },
                { key: 'directorate_snapshot', label: 'Directorate', id: 'pe_directorate', type: 'text' },
                { key: 'program_type_snapshot', label: 'Type of Program', id: 'pe_program_type', type: 'text' },
                { key: 'attendance_nature_snapshot', label: 'Nature of Attendance', id: 'pe_attendance_nature', type: 'text' }
            ];

            // One field per row, full width, stacked — deliberately not a
            // side-by-side grid: that's exactly the layout that was
            // overflowing on phones elsewhere in this project until
            // min-width:0 got added everywhere. Stacked rows need no such
            // fix — they're phone-safe by construction, at any screen size.
            function fieldRowHtml(def) {
                const value = row[def.key] || '';
                if (def.type === 'select') {
                    const optsHtml = ['<option value="">-- Choose --</option>'].concat(
                        def.options.map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`)
                    ).join('');
                    return `<div style="margin-bottom:12px;"><label style="display:block; font-size:12px; font-weight:700; color:#475569; margin-bottom:4px;">${def.label}</label><select id="${def.id}" class="cq-answer-input" style="width:100%;">${optsHtml}</select></div>`;
                }
                return `<div style="margin-bottom:12px;">
                    <label style="display:block; font-size:12px; font-weight:700; color:#475569; margin-bottom:4px;">${def.label}</label>
                    <input type="text" id="${def.id}" class="cq-answer-input" style="width:100%;${def.readonly ? ' background:#f1f5f9; color:#94a3b8;' : ''}" value="${String(value).replace(/"/g, '&quot;')}" ${def.readonly ? 'readonly disabled' : ''}>
                    ${def.note ? `<p style="font-size:11px; color:#94a3b8; margin:4px 0 0;">${def.note}</p>` : ''}
                </div>`;
            }

            const basicFields = FIELD_DEFS.slice(0, 6);
            const classificationFields = FIELD_DEFS.slice(6);

            body.innerHTML = `
                <div style="font-size:12px; font-weight:800; color:#7C3AED; text-transform:uppercase; letter-spacing:.03em; margin-bottom:8px;">Basic Information</div>
                ${basicFields.map(fieldRowHtml).join('')}

                <div style="margin-bottom:12px;">
                    <label style="display:block; font-size:12px; font-weight:700; color:#475569; margin-bottom:4px;">Institution</label>
                    <select id="pe_institution_type" class="cq-answer-input" style="width:100%; margin-bottom:8px;">
                        <option value="Ibra" ${isIbra ? 'selected' : ''}>Ibra hospital</option>
                        <option value="Other" ${!isIbra ? 'selected' : ''}>Other hospital and health center</option>
                    </select>
                    <div id="pe_ibra_dept_wrap" class="${isIbra ? '' : 'hidden-element'}">
                        <select id="pe_department" class="cq-answer-input" style="width:100%;">
                            <option value="">-- Choose Department --</option>
                            ${departmentOptions.map(d => `<option value="${d}" ${d === currentDept ? 'selected' : ''}>${d}</option>`).join('')}
                        </select>
                    </div>
                    <div id="pe_other_inst_wrap" class="${isIbra ? 'hidden-element' : ''}">
                        <input type="text" id="pe_other_institution" class="cq-answer-input" style="width:100%;" value="${isIbra ? '' : String(row.institution_name_snapshot || '').replace(/"/g, '&quot;')}" placeholder="Institution / health center name">
                    </div>
                </div>

                <div style="font-size:12px; font-weight:800; color:#7C3AED; text-transform:uppercase; letter-spacing:.03em; margin:18px 0 8px;">Targeting / Classification Info</div>
                ${classificationFields.map(fieldRowHtml).join('')}
                ${isNoAttendanceCourse ? `
                    <div style="font-size:12px; font-weight:800; color:#7C3AED; text-transform:uppercase; letter-spacing:.03em; margin:18px 0 8px;">Logged Entries</div>
                    <div id="pe_log_entries_body"></div>
                ` : ''}
            `;

            document.getElementById('pe_institution_type').addEventListener('change', (e) => {
                const isIbraNow = e.target.value === 'Ibra';
                document.getElementById('pe_ibra_dept_wrap').classList.toggle('hidden-element', !isIbraNow);
                document.getElementById('pe_other_inst_wrap').classList.toggle('hidden-element', isIbraNow);
            });

            // ---- Logged Entries sub-section (no-attendance courses only) — same UI/logic as before, just embedded here instead of its own modal. ----
            let newRowSeq = 0;
            function addBlankLogRow() {
                logData.push({ id: `new-${++newRowSeq}`, title: '', entry_date_from: '', entry_date_to: '', department: null, __isNew: true });
                renderLogRows();
            }
            const fallbackDept = currentDept || stripIbraPrefix(row.institution_name_snapshot);
            function renderLogRows() {
                const logBody = document.getElementById('pe_log_entries_body');
                if (!logBody) return;
                const addRowBtnHtml = `<button type="button" id="pe_add_log_entry_btn" class="btn-tbl-view" style="margin-bottom:12px;">+ Add Entry</button>`;
                if (logData.length === 0) {
                    logBody.innerHTML = `<p style="color:#94a3b8; font-size:13px; margin-bottom:12px;">No entries logged yet.</p>${addRowBtnHtml}`;
                } else {
                    logBody.innerHTML = addRowBtnHtml + logData.map(e => {
                        const selected = e.department || (e.__isNew ? '' : fallbackDept) || '';
                        const optionsHtml = ['<option value="">-- Choose Organized By --</option>']
                            .concat(departmentOptions.map(d => `<option value="${d}" ${d === selected ? 'selected' : ''}>${d}</option>`))
                            .join('');
                        return `
                        <div class="activity-log-edit-row" data-entry-id="${e.id}" style="border-bottom:1px solid #f1f5f9; padding:10px 0;">
                            <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:3px;">
                                <label style="font-size:11px; color:#94a3b8;">${e.__isNew ? 'Title (new entry)' : 'Title'}</label>
                                <button type="button" class="btn-delete pe-log-delete-btn" data-entry-id="${e.id}" style="padding:3px 10px; font-size:11px;">Delete</button>
                            </div>
                            <input type="text" class="cq-answer-input pe-log-title" style="width:100%; margin-bottom:8px;" value="${(e.title || '').replace(/"/g, '&quot;')}">
                            <div style="display:flex; gap:10px; margin-bottom:8px; flex-wrap:wrap;">
                                <div style="flex:1; min-width:120px;">
                                    <label style="display:block; font-size:11px; color:#94a3b8; margin-bottom:3px;">From</label>
                                    <input type="date" class="cq-answer-input pe-log-date-from" style="width:100%;" value="${e.entry_date_from || ''}">
                                </div>
                                <div style="flex:1; min-width:120px;">
                                    <label style="display:block; font-size:11px; color:#94a3b8; margin-bottom:3px;">To</label>
                                    <input type="date" class="cq-answer-input pe-log-date-to" style="width:100%;" value="${e.entry_date_to || ''}">
                                </div>
                            </div>
                            <label style="display:block; font-size:11px; color:#94a3b8; margin-bottom:3px;">Organized By (Department)</label>
                            <select class="cq-answer-input pe-log-department" style="width:100%;">${optionsHtml}</select>
                        </div>`;
                    }).join('');
                }
                logBody.querySelectorAll('.pe-log-delete-btn').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const rawId = btn.dataset.entryId;
                        const entry = logData.find(e => String(e.id) === rawId);
                        if (!entry) return;
                        if (entry.__isNew) { logData.splice(logData.indexOf(entry), 1); renderLogRows(); return; }
                        if (!(await confirmCard(`Delete the entry "${entry.title}"? This can't be undone.`))) return;
                        btn.disabled = true;
                        btn.textContent = 'Deleting…';
                        const { error: delErr } = await client.from('activity_log_entries').delete().eq('id', entry.id);
                        if (delErr) { alert('Could not delete entry: ' + delErr.message); btn.disabled = false; btn.textContent = 'Delete'; return; }
                        client.from('deletion_audit_log').insert({
                            admin_username: currentAdminName(),
                            entity_type: 'activity_log_entry_edit',
                            entity_label: `${row.staff_name} — activity log entry '${entry.title}' deleted`,
                            reason: `Deleted entry: '${entry.title}' (${formatEntryDateRange(entry.entry_date_from, entry.entry_date_to)}${entry.department ? ', ' + entry.department : ''})`
                        }).then(() => {}, () => {});
                        logData.splice(logData.indexOf(entry), 1);
                        renderLogRows();
                        loadData();
                    });
                });
                const addBtn = document.getElementById('pe_add_log_entry_btn');
                if (addBtn) addBtn.addEventListener('click', addBlankLogRow);
            }
            if (isNoAttendanceCourse) renderLogRows();

            // ---- Save everything together ----
            saveBtn.addEventListener('click', async () => {
                const originalLabel = saveBtn.textContent;
                saveBtn.disabled = true;
                saveBtn.textContent = 'Saving…';
                try {
                    const changes = []; // { label, oldVal, newVal } — what actually differs, for the summary shown after saving
                    const updatePayload = {};

                    FIELD_DEFS.forEach(def => {
                        if (def.readonly) return;
                        const el = document.getElementById(def.id);
                        if (!el) return;
                        const newVal = el.value.trim();
                        const oldVal = (row[def.key] || '').toString();
                        updatePayload[def.key] = newVal || null;
                        if (newVal !== oldVal) changes.push({ label: def.label, oldVal: oldVal || '(empty)', newVal: newVal || '(empty)' });
                    });

                    const nameVal = document.getElementById('pe_staff_name').value.trim();
                    const phoneVal = document.getElementById('pe_phone_number').value.trim();
                    if (!nameVal || !phoneVal) {
                        alert('Full Name and Phone Number cannot be left empty.');
                        throw new Error('validation');
                    }

                    const instType = document.getElementById('pe_institution_type').value;
                    let newInstitutionName;
                    if (instType === 'Ibra') {
                        const dept = document.getElementById('pe_department').value;
                        if (!dept) { alert('Please choose a department.'); throw new Error('validation'); }
                        newInstitutionName = `Ibra - ${dept}`;
                    } else {
                        const otherName = document.getElementById('pe_other_institution').value.trim();
                        if (!otherName) { alert('Please enter the institution name.'); throw new Error('validation'); }
                        newInstitutionName = otherName;
                    }
                    updatePayload.institution_name_snapshot = newInstitutionName;
                    const oldInstitutionName = row.institution_name_snapshot || '';
                    if (newInstitutionName !== oldInstitutionName) {
                        changes.push({ label: 'Institution / Department', oldVal: oldInstitutionName || '(empty)', newVal: newInstitutionName });
                        // Keeps institution_id in sync for a known,
                        // catalogued institution (every Ibra department
                        // always is) — same lookup already used at
                        // registration time. A brand new free-typed
                        // "Other" name not yet in the catalog just leaves
                        // institution_id as-is rather than silently
                        // creating a new institutions row here.
                        const { data: matchingInst } = await client.from('institutions').select('id').eq('name', newInstitutionName).maybeSingle();
                        if (matchingInst) updatePayload.institution_id = matchingInst.id;
                    }

                    const { error: updateErr } = await client.from('registrations').update(updatePayload).eq('id', registrationId);
                    if (updateErr) throw updateErr;

                    // ---- Log entries (no-attendance courses only) ----
                    const logChanges = [];
                    if (isNoAttendanceCourse) {
                        const logRowEls = document.querySelectorAll('#pe_log_entries_body .activity-log-edit-row');
                        const logUpdates = [];
                        const logInserts = [];
                        for (const rowEl of logRowEls) {
                            const rawId = rowEl.dataset.entryId;
                            const original = logData.find(e => String(e.id) === rawId);
                            if (!original) continue;
                            const newTitle = rowEl.querySelector('.pe-log-title').value.trim();
                            const newFrom = rowEl.querySelector('.pe-log-date-from').value;
                            const newTo = rowEl.querySelector('.pe-log-date-to').value;
                            const newDept = rowEl.querySelector('.pe-log-department').value.trim();
                            if (!newTitle || !newFrom || !newTo) {
                                alert('Title, Date From and Date To are required for every logged entry.');
                                throw new Error('validation');
                            }
                            if (original.__isNew) { logInserts.push({ newTitle, newFrom, newTo, newDept }); continue; }
                            const changed = original.title !== newTitle || original.entry_date_from !== newFrom || original.entry_date_to !== newTo || (original.department || '') !== newDept;
                            if (changed) logUpdates.push({ entryId: original.id, original, newTitle, newFrom, newTo, newDept });
                        }

                        await Promise.all(logUpdates.map(c => client.from('activity_log_entries')
                            .update({ title: c.newTitle, entry_date_from: c.newFrom, entry_date_to: c.newTo, department: c.newDept || null })
                            .eq('id', c.entryId)));

                        if (logInserts.length > 0) {
                            const { error: insertErr } = await client.from('activity_log_entries').insert(
                                logInserts.map(c => ({ registration_id: registrationId, title: c.newTitle, entry_date_from: c.newFrom, entry_date_to: c.newTo, department: c.newDept || null }))
                            );
                            if (insertErr) throw insertErr;
                        }

                        logUpdates.forEach(c => {
                            logChanges.push(`Logged Entry: Title '${c.original.title}' → '${c.newTitle}', Date ${formatEntryDateRange(c.original.entry_date_from, c.original.entry_date_to)} → ${formatEntryDateRange(c.newFrom, c.newTo)}, Department '${c.original.department || ''}' → '${c.newDept || ''}'`);
                            client.from('deletion_audit_log').insert({
                                admin_username: currentAdminName(),
                                entity_type: 'activity_log_entry_edit',
                                entity_label: `${row.staff_name} — activity log entry '${c.newTitle}' edited`,
                                reason: `Title: '${c.original.title}' → '${c.newTitle}'; Date: ${formatEntryDateRange(c.original.entry_date_from, c.original.entry_date_to)} → ${formatEntryDateRange(c.newFrom, c.newTo)}; Department: '${c.original.department || ''}' → '${c.newDept || ''}'`
                            }).then(() => {}, () => {});
                        });
                        logInserts.forEach(c => {
                            logChanges.push(`Logged Entry added: '${c.newTitle}' (${formatEntryDateRange(c.newFrom, c.newTo)}${c.newDept ? ', ' + c.newDept : ''})`);
                            client.from('deletion_audit_log').insert({
                                admin_username: currentAdminName(),
                                entity_type: 'activity_log_entry_edit',
                                entity_label: `${row.staff_name} — activity log entry '${c.newTitle}' added by admin`,
                                reason: `Added manually: '${c.newTitle}' (${formatEntryDateRange(c.newFrom, c.newTo)}${c.newDept ? ', ' + c.newDept : ''})`
                            }).then(() => {}, () => {});
                        });
                    }

                    // Best-effort audit trail for the participant-field changes.
                    if (changes.length > 0) {
                        client.from('deletion_audit_log').insert({
                            admin_username: currentAdminName(),
                            entity_type: 'registration_edit',
                            entity_label: `${row.staff_name} — participant record edited`,
                            reason: changes.map(c => `${c.label}: '${c.oldVal}' → '${c.newVal}'`).join('; ')
                        }).then(() => {}, () => {});
                    }

                    overlay.remove();
                    loadData();
                    showChangeSummaryCard(row.staff_name, changes, logChanges);
                } catch (err) {
                    if (err && err.message !== 'validation') alert('Could not save changes: ' + err.message);
                } finally {
                    saveBtn.disabled = false;
                    saveBtn.textContent = originalLabel;
                }
            });
        }

        // Shown right after a participant edit is saved — lists exactly
        // what changed (field-by-field, old value → new value) instead of
        // just an anonymous "Saved successfully", so the admin can confirm
        // at a glance that what they meant to fix is actually what changed.
        function showChangeSummaryCard(staffName, fieldChanges, logChanges) {
            const overlay = document.createElement('div');
            overlay.className = 'form-modal-overlay';
            const allChanges = [
                ...fieldChanges.map(c => `<strong>${c.label}:</strong> ${c.oldVal} → ${c.newVal}`),
                ...logChanges
            ];
            overlay.innerHTML = `
                <div class="form-modal-card" style="max-width:min(94vw, 480px); width:100%; max-height:80vh; display:flex; flex-direction:column; box-sizing:border-box;">
                    <div class="form-toast-title">${allChanges.length > 0 ? 'Changes Saved' : 'Saved — No Changes Made'}</div>
                    <div style="overflow-y:auto; flex:1; min-height:0; font-size:13px; line-height:1.7; color:#334155;">
                        ${allChanges.length === 0
                            ? `<p style="color:#94a3b8;">Nothing was different from what was already on file for ${staffName}.</p>`
                            : `<p style="margin-bottom:8px; color:#64748b;">Updated for <strong>${staffName}</strong>:</p><ul style="margin:0; padding-left:18px;">${allChanges.map(c => `<li style="margin-bottom:6px;">${c}</li>`).join('')}</ul>`
                        }
                    </div>
                    <div class="confirm-actions" style="margin-top:16px; flex-shrink:0;">
                        <button type="button" class="confirm-btn confirm-ok" id="peChangeSummaryCloseBtn">Close</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.querySelector('#peChangeSummaryCloseBtn').addEventListener('click', () => overlay.remove());
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        }

        async function showCustomAnswersModal(registrationId, staffName) {
            const overlay = document.createElement('div');
            overlay.className = 'form-modal-overlay';
            overlay.innerHTML = `
                <div class="form-modal-card" style="max-width:560px;">
                    <div class="form-toast-title">Custom Question Answers — ${staffName}</div>
                    <div id="customAnswersModalBody">Loading…</div>
                    <div class="confirm-actions" style="margin-top:16px;">
                        <button type="button" class="confirm-btn confirm-ok" id="customAnswersCloseBtn" style="flex:none; padding-left:24px; padding-right:24px;">Close</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            overlay.querySelector('#customAnswersCloseBtn').addEventListener('click', () => overlay.remove());
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

            const { data, error } = await client
                .from('question_responses')
                .select('response_value, course_questions(question_text, display_order)')
                .eq('registration_id', registrationId);

            const body = overlay.querySelector('#customAnswersModalBody');
            if (error) {
                body.innerHTML = `<p style="color:#dc2626; font-size:13px;">Couldn't load answers: ${error.message}</p>`;
                return;
            }
            if (!data || data.length === 0) {
                body.innerHTML = '<p style="color:#94a3b8; font-size:13px;">No questions were answered.</p>';
                return;
            }
            const sorted = data.slice().sort((a, b) => (a.course_questions?.display_order || 0) - (b.course_questions?.display_order || 0));
            body.innerHTML = `
                <table style="width:100%; border-collapse:collapse; font-size:13.5px;">
                    <thead><tr style="text-align:left; color:#64748b; font-size:12px;">
                        <th style="padding:6px 8px; border-bottom:2px solid #f1f5f9;">Question</th>
                        <th style="padding:6px 8px; border-bottom:2px solid #f1f5f9;">Answer</th>
                    </tr></thead>
                    <tbody>
                        ${sorted.map(r => `
                            <tr>
                                <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${r.course_questions ? r.course_questions.question_text : '(deleted question)'}</td>
                                <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${formatResponseValue(r.response_value)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `;
        }

        document.getElementById('attendanceFilter').addEventListener('change', loadData);

        // Staff Number / Staff Name search — one box, filters live as the
        // admin types, no button or Enter needed. Debounced ~200ms so a
        // fast typist doesn't fire a fresh loadData() (which re-queries
        // Supabase) on every single keystroke, while still feeling instant.
        let staffSearchDebounceTimer = null;
        document.getElementById('staffNumberSearchInput').addEventListener('input', () => {
            clearTimeout(staffSearchDebounceTimer);
            staffSearchDebounceTimer = setTimeout(() => {
                studentsCurrentPage = 1;
                loadData();
            }, 200);
        });

        window.handleCreateCertificate = async function(btn) {
            const publicSlug = btn.dataset.slug;
            const staffNumber = btn.dataset.staff;
            const originalLabel = btn.innerHTML;

            btn.disabled = true;
            btn.innerHTML = 'Generating...';

            try {
                const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-certificate`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'apikey': SUPABASE_ANON_KEY
                    },
                    body: JSON.stringify({ public_slug: publicSlug, staff_number: staffNumber })
                });
                const result = await res.json();

                if (!res.ok || !result.success) {
                    alert(result.error || 'Could not create the certificate.');
                    return;
                }

                // Nothing is saved anywhere — the PDF comes back as base64
                // and is downloaded directly here, same as the public page.
                const byteChars = atob(result.pdf_base64);
                const byteNumbers = new Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
                const blob = new Blob([new Uint8Array(byteNumbers)], { type: 'application/pdf' });
                const pdfUrl = URL.createObjectURL(blob);

                const link = document.createElement('a');
                link.href = pdfUrl;
                link.download = `certificate_${result.certificate_number}.pdf`;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                setTimeout(() => URL.revokeObjectURL(pdfUrl), 10000);
            } catch (err) {
                alert('Could not create the certificate: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalLabel;
            }
        };

        function currentAdminName() {
            try {
                const raw = sessionStorage.getItem('ibra_admin_session');
                const session = raw ? JSON.parse(raw) : null;
                return (session && (session.fullName || session.username)) || 'Unknown admin';
            } catch {
                return 'Unknown admin';
            }
        }

        window.handleDeleteRegistration = async function(regId, courseId, instId, staffName, courseName) {
            try {
                if (typeof formCard !== 'function' || typeof confirmCard !== 'function') {
                    alert('This page needs a fresh copy of a required file — please hard-refresh (Ctrl+Shift+R) and try again.');
                    return;
                }

                const result = await formCard('Remove Registration', [
                    { name: 'reason', label: `Why are you removing "${staffName}"'s registration?`, placeholder: 'Reason for deletion' }
                ], { okLabel: 'Continue' });
                if (!result) return;
                if (!result.reason) { alert('Please enter a reason.'); return; }
                if (!(await confirmCard(`Are you sure you want to remove the registration for "${staffName}"?\n\nThis restores course chairs availability (+1) and frees up institutional quota open slots.`))) return;

                const { data: courseData } = await client.from('courses').select('seats, unlimited_seats').eq('id', courseId).single();
                if (courseData && !courseData.unlimited_seats) {
                    await client.from('courses').update({ seats: courseData.seats + 1 }).eq('id', courseId);
                }

                if (courseId && instId) {
                    const { data: mapData } = await client.from('course_institutions')
                        .select('id, registered_count')
                        .eq('course_id', courseId)
                        .eq('institution_id', instId)
                        .maybeSingle();
                    if (mapData && mapData.registered_count > 0) {
                        await client.from('course_institutions')
                            .update({ registered_count: mapData.registered_count - 1 })
                            .eq('id', mapData.id);
                    }
                }

                await client.from('registrations').delete().eq('id', regId);
                client.from('deletion_audit_log').insert({
                    admin_username: currentAdminName(), entity_type: 'registration',
                    entity_label: `${staffName || `Registration #${regId}`} — from ${courseName || 'unknown activity'}`, reason: result.reason
                }).then(() => {}, () => {}); // best-effort — shouldn't block the actual deletion
                alert("Record removed successfully.");
                await loadData();
            } catch (err) {
                console.error('handleDeleteRegistration failed:', err);
                alert("Error during restoration sequence processing: " + err.message);
            }
        };

        function formatDateDDMMYYYY(dateStr) {
            if (!dateStr) return '';
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return String(dateStr);
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}-${month}-${year}`;
        }

        function formatRegistrationTime(createdAt) {
            if (!createdAt) return '';
            const d = new Date(createdAt);
            if (isNaN(d.getTime())) return '';
            return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
        }

        // Exports the SAME scope of rows the table/page already shows
        // (allData — respects the course_id filter from the URL banner and
        // the Attended/Not Attended dropdown) into the official Ministry
        // bilingual template layout (see js/excel-export.js's
        // exportGreenTemplateExcel): green merged bilingual headers, RTL
        // sheet, Day/Month/Year split date columns.
        //
        // Column mapping — real data only, nothing invented:
        //   Full Name/Staff Number   -> staff_name / staff_number
        //   Designation              -> designation_snapshot
        //   Job Level                -> job_level_snapshot
        //   Gender                   -> sex_snapshot (falls back to sex)
        //   Nationality              -> nationality_snapshot
        //   Highest educ. qual.      -> education_qualification_snapshot
        //   Experience years         -> experience_years_snapshot
        //   Employer/Organization    -> organization_snapshot
        //   Directorate              -> directorate_snapshot
        //   Title of Program         -> course_name
        //   Type of Program          -> program_type_snapshot
        //   Training Domains         -> (no source field on registrations
        //                                or courses — left blank)
        //   Program start/end date   -> the COURSE's course_date /
        //                                course_end_date (sql/workshops.sql),
        //                                not the registration's created_at —
        //                                those two columns are the program's
        //                                actual scheduled dates.
        //   Nature of Attendance     -> attendance_nature_snapshot
        //   Included in approved HRD plan -> (no source field — left blank)
        window.exportCSV = async function () {
            const btn = document.getElementById('exportCSVBtn');
            const originalLabel = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Preparing…';
            try {
                const courseIds = [...new Set(allData.map(r => r.course_id).filter(id => id != null))];
                let coursesById = new Map();
                if (courseIds.length > 0) {
                    try {
                        const { data: courseRows } = await client
                            .from('courses')
                            .select('id, course_date, course_end_date, attendance_required')
                            .in('id', courseIds);
                        (courseRows || []).forEach(c => coursesById.set(c.id, c));
                    } catch (e) {
                        // Export still proceeds — start/end date columns just come out blank.
                    }
                }

                // Self-log ("without attendance") courses: the Title/
                // Start/End date columns come from each individually
                // logged entry (activity_log_entries), NOT the course's
                // own fixed name/dates — a participant with 3 logged
                // entries gets 3 rows, one per entry, all other columns
                // repeated. Attendance-tracked courses are unaffected: one
                // row per registration, course name/dates as before.
                const selfLogRegIds = allData
                    .filter(r => { const c = coursesById.get(r.course_id); return c && c.attendance_required === false; })
                    .map(r => r.id);
                let entriesByRegId = new Map();
                if (selfLogRegIds.length > 0) {
                    try {
                        const { data: entryRows } = await client
                            .from('activity_log_entries')
                            .select('registration_id, title, entry_date_from, entry_date_to, department')
                            .in('registration_id', selfLogRegIds)
                            .order('entry_date_from', { ascending: true });
                        (entryRows || []).forEach(e => {
                            if (!entriesByRegId.has(e.registration_id)) entriesByRegId.set(e.registration_id, []);
                            entriesByRegId.get(e.registration_id).push(e);
                        });
                    } catch (e) {
                        // Export still proceeds — self-log rows just fall back to one blank-title row each.
                    }
                }

                const participants = [];
                allData.forEach(r => {
                    const course = coursesById.get(r.course_id) || {};
                    const baseFields = {
                        staff_name: r.staff_name || '',
                        staff_number: r.staff_number || '',
                        designation: r.designation_snapshot || '',
                        job_level: r.job_level_snapshot || '',
                        sex: r.sex_snapshot || r.sex || '',
                        nationality: r.nationality_snapshot || '',
                        education_qualification: r.education_qualification_snapshot || '',
                        experience_years: r.experience_years_snapshot || '',
                        organization: r.organization_snapshot || '',
                        directorate: r.directorate_snapshot || '',
                        program_type: r.program_type_snapshot || '',
                        training_domains: '', // no source field — left blank rather than invented
                        attendance_nature: r.attendance_nature_snapshot || '',
                        hrd_plan: '' // no source field — left blank rather than invented
                    };

                    if (course.attendance_required === false) {
                        const entries = entriesByRegId.get(r.id) || [];
                        const fallbackDept = stripIbraPrefix(r.institution_name_snapshot);
                        if (entries.length === 0) {
                            participants.push({ ...baseFields, program_title: '', start_date: '', end_date: '', department: fallbackDept });
                        } else {
                            entries.forEach(e => {
                                participants.push({
                                    ...baseFields,
                                    program_title: e.title || '',
                                    start_date: e.entry_date_from || '',
                                    end_date: e.entry_date_to || '',
                                    department: e.department || fallbackDept
                                });
                            });
                        }
                    } else {
                        participants.push({
                            ...baseFields,
                            program_title: r.course_name || '',
                            start_date: course.course_date || '',
                            end_date: course.course_end_date || '',
                            department: stripIbraPrefix(r.institution_name_snapshot)
                        });
                    }
                });

                const courseFilterId = getCourseFilterIdFromUrl();
                const filteredCourseName = courseFilterId ? (allData[0]?.course_name || 'course') : null;
                const safeName = filteredCourseName ? filteredCourseName.replace(/[^a-z0-9]+/gi, '_').toLowerCase() : null;
                const fileName = safeName ? `training_record_${safeName}` : 'training_record';

                exportGreenTemplateExcel(participants, fileName);
            } finally {
                btn.disabled = false;
                btn.textContent = originalLabel;
            }
        };

        loadData();
