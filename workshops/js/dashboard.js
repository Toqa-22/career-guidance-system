import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PAGE_SIZE = 10;
let allCoursesCached = [];
let dashboardCurrentPage = 1;

// Shared by this page and Participant Registrations — builds a row of
// page-number buttons (with Prev/Next) below a table, and calls onChange
// with the new page number whenever one is clicked.
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

// Newest-to-oldest by CREATION TIME by default (display_order set via the
// manual "position" input in the table still wins when present — that's
// the admin deliberately pinning a course somewhere specific). A course
// that's never been through the reorder feature (display_order still NULL,
// e.g. one created before sql/add-course-display-order.sql was run, or any
// brand-new course — see create-course.js's bumpNewCourseToTopOfDashboard,
// which also gives every new course an explicit display_order of 1) falls
// back to its real `created_at` timestamp, newest first — NOT `id`, since
// the ask is specifically to order by creation time.
function sortCoursesForDisplay(courses) {
    return courses.slice().sort((a, b) => {
        const ao = a.display_order, bo = b.display_order;
        if (ao != null && bo != null) return ao - bo;
        if (ao != null) return -1;
        if (bo != null) return 1;
        const at = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (at !== bt) return bt - at;
        return b.id - a.id; // final tiebreak if created_at is identical/missing on both
    });
}

async function reloadAdminConsoleDashboard() {
    const { data: courses, error: errC } = await client.from('courses').select('*');
    const tbody = document.getElementById('coursesMainTableBody');
    if (errC) {
        tbody.innerHTML = `<tr><td colspan="11" style="color:#dc2626; text-align:center; padding: 20px;">Error indexing courses table data arrays.</td></tr>`;
        return;
    }
    allCoursesCached = sortCoursesForDisplay(courses || []);
    if (dashboardCurrentPage > Math.ceil(allCoursesCached.length / PAGE_SIZE)) dashboardCurrentPage = 1;
    renderCoursesPage();
}

// Moves the course to the 1-based position the admin typed, then renumbers
// EVERY course's display_order sequentially (1, 2, 3, ...) to match the new
// order — not just the two rows that swapped — so the ordering stays
// consistent no matter how many times this gets used, and a course that
// was never manually touched still gets a real display_order the next time
// anything nearby moves.
async function reorderCourseToPosition(courseId, rawPosition) {
    const currentIndex = allCoursesCached.findIndex(c => c.id === courseId);
    if (currentIndex === -1) return;

    let targetIndex = Math.round(Number(rawPosition)) - 1;
    if (!Number.isFinite(targetIndex)) targetIndex = currentIndex;
    targetIndex = Math.max(0, Math.min(allCoursesCached.length - 1, targetIndex));

    if (targetIndex === currentIndex) {
        renderCoursesPage(); // just redraws the input back to its correct number
        return;
    }

    const reordered = allCoursesCached.slice();
    const [moved] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, moved);

    allCoursesCached = reordered;
    renderCoursesPage(); // reflect the new order immediately, before the save round-trip

    const updates = reordered.map((c, i) => ({ id: c.id, display_order: i + 1 }));
    const results = await Promise.all(updates.map(u =>
        client.from('courses').update({ display_order: u.display_order }).eq('id', u.id)
    ));
    const failed = results.find(r => r.error);
    if (failed) {
        alert('Could not save the new order: ' + failed.error.message);
        reloadAdminConsoleDashboard();
        return;
    }
    reordered.forEach((c, i) => { c.display_order = i + 1; });
}

function renderCoursesPage() {
    const tbody = document.getElementById('coursesMainTableBody');
    const start = (dashboardCurrentPage - 1) * PAGE_SIZE;
    const courses = allCoursesCached.slice(start, start + PAGE_SIZE);

    renderPagination('dashboardPagination', allCoursesCached.length, dashboardCurrentPage, (page) => {
        dashboardCurrentPage = page;
        renderCoursesPage();
        document.getElementById('coursesMainTableBody').closest('table').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    if (courses.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:#64748b; padding: 20px;">No tracked courses inside live configuration space.</td></tr>`;
    } else {
        tbody.innerHTML = courses.map(c => {
            let fileLabels = [];
            let fileExamples = [];
            try {
                if (Array.isArray(c.file_labels)) {
                    fileLabels = c.file_labels;
                } else if (typeof c.file_labels === 'string') {
                    fileLabels = JSON.parse(c.file_labels);
                }
            } catch (e) { fileLabels = []; }

            try {
                if (Array.isArray(c.file_examples)) {
                    fileExamples = c.file_examples;
                } else if (typeof c.file_examples === 'string') {
                    fileExamples = JSON.parse(c.file_examples);
                }
            } catch (e) { fileExamples = []; }

            if (!Array.isArray(fileLabels)) fileLabels = [];
            if (!Array.isArray(fileExamples)) fileExamples = [];

            const badgeHtml = fileLabels.map((l, idx) => {
                const imgUrl = fileExamples[idx] || '';
                const imgMarkup = imgUrl ? `
                    <div style="margin-top: 4px;">
                        <a href="${imgUrl}" target="_blank">
                            <img src="${imgUrl}" style="width:40px; height:40px; object-fit:cover; border-radius:4px; border:1px solid #cbd5e1;" onerror="this.style.display='none'">
                        </a>
                    </div>` : '';
                return `
                    <div style="margin-bottom: 8px; display: inline-block; vertical-align: top; margin-right: 8px; text-align: center;">
                        <span class="badge-info">${l}</span>
                        ${imgMarkup}
                    </div>`;
            }).join('') || '<span class="badge-info" style="background:#f1f5f9; color:#94a3b8;">None Required</span>';

            const regUrl = new URL('../register.html', window.location.href);
            regUrl.searchParams.set('course', c.id);
            const regLink = regUrl.toString();

            const attendanceUrl = new URL('../attendance.html', window.location.href);
            attendanceUrl.searchParams.set('course_id', c.id);
            const attendanceLink = attendanceUrl.toString();

            const activityLogUrl = new URL('../activity-log.html', window.location.href);
            activityLogUrl.searchParams.set('course_id', c.id);
            const activityLogLink = activityLogUrl.toString();
            const isAttendanceRequired = c.attendance_required !== false;

            const sexAllowed = c.allowed_sex || 'Both';
            const availableSeats = c.unlimited_seats ? 'Unlimited' : (c.seats !== undefined && c.seats !== null ? c.seats : 0);
            const courseNameClean = c.name || 'Unnamed Course';
            const courseDateClean = c.course_date || 'N/A';

            let desigArr = [];
            try {
                if (Array.isArray(c.allowed_designations)) {
                    desigArr = c.allowed_designations;
                } else if (typeof c.allowed_designations === 'string' && c.allowed_designations.trim() !== '') {
                    desigArr = JSON.parse(c.allowed_designations);
                }
            } catch (e) { desigArr = []; }

            let desigSeats = {};
            try {
                if (c.designation_seats && typeof c.designation_seats === 'object') {
                    desigSeats = c.designation_seats;
                } else if (typeof c.designation_seats === 'string' && c.designation_seats.trim() !== '') {
                    desigSeats = JSON.parse(c.designation_seats);
                }
            } catch (e) { desigSeats = {}; }

            const desigMarkup = (!desigArr || desigArr.length === 0 || desigArr.includes('All'))
                ? `<span class="badge-info" style="background:#f0fdf4; color:#16a34a;">All Roles</span>`
                : desigArr.map(d => {
                    const seatNote = desigSeats && desigSeats[d] ? ` (${desigSeats[d]} seats)` : '';
                    return `<span class="badge-info" style="background:#e0f2fe; color:#0369a1;">${d}${seatNote}</span>`;
                }).join(' ');

            const globalPosition = start + courses.indexOf(c) + 1;

            return `
                <tr>
                    <td><input type="number" class="order-input" data-course-id="${c.id}" value="${globalPosition}" min="1" style="width:60px; padding:4px 6px; border:1px solid #d1d5db; border-radius:6px; font-size:13px; text-align:center;"></td>
                    <td><b>${courseNameClean}</b></td>
                    <td>${courseDateClean}</td>
                    <td>${availableSeats}${c.unlimited_seats ? '' : ' seats'}</td>
                    <td>
                        <div style="margin-bottom: 4px;"><span class="badge-info" style="background:#f5f3ff; color:#7c3aed;">Gender: ${sexAllowed}</span></div>
                        <div>${desigMarkup}</div>
                    </td>
                    <td>${badgeHtml}</td>
                    <td><a class="btn-tbl-view" href="students.html?course_id=${c.id}">Participants</a></td>
                    <td>
                        ${isAttendanceRequired
                            ? `<div style="display:flex; flex-direction:column; gap:6px; align-items:flex-start;">
                                <a class="btn-tbl-view" href="${regLink}" target="_blank" rel="noopener">Open Link</a>
                                <button type="button" class="btn-tbl-edit" data-copy-reg-link="${regLink}">Copy Link</button>
                                <button type="button" class="btn-tbl-edit" data-qr-link="${regLink}" data-qr-title="${courseNameClean.replace(/"/g, '&quot;')} — Registration">QR</button>
                               </div>`
                            : '<span style="color:#94a3b8; font-size:12px;">Use the Activity Log link →</span>'}
                    </td>
                    <td>
                        ${isAttendanceRequired
                            ? `<div style="display:flex; flex-direction:column; gap:6px; align-items:flex-start;">
                                <a class="btn-tbl-view" href="${attendanceLink}" target="_blank" rel="noopener">Open Link</a>
                                <button type="button" class="btn-tbl-edit" data-copy-reg-link="${attendanceLink}">Copy Link</button>
                                <button type="button" class="btn-tbl-edit" data-qr-link="${attendanceLink}" data-qr-title="${courseNameClean.replace(/"/g, '&quot;')} — Attendance">QR</button>
                               </div>`
                            : '<span style="color:#94a3b8; font-size:12px;">N/A — attendance not required</span>'}
                    </td>
                    <td>
                        ${isAttendanceRequired
                            ? '<span style="color:#94a3b8; font-size:12px;">N/A — attendance required</span>'
                            : `<div style="display:flex; flex-direction:column; gap:6px; align-items:flex-start;">
                                <a class="btn-tbl-view" href="${activityLogLink}" target="_blank" rel="noopener">Open Link</a>
                                <button type="button" class="btn-tbl-edit" data-copy-reg-link="${activityLogLink}">Copy Link</button>
                                <button type="button" class="btn-tbl-edit" data-qr-link="${activityLogLink}" data-qr-title="${courseNameClean.replace(/"/g, '&quot;')} — Activity Log">QR</button>
                               </div>`}
                    </td>
                    <td class="action-cell">
                        <a class="btn-tbl-edit" href="create-course.html?edit_id=${c.id}">Edit</a>
                        <button class="btn-tbl-edit ${c.links_closed ? 'btn-links-closed' : 'btn-links-open'}" data-action="toggle-links" data-id="${c.id}" data-closed="${!!c.links_closed}">${c.links_closed ? 'Open' : 'Close'}</button>
                        <button class="btn-tbl-delete" data-id="${c.id}" data-name="${courseNameClean.replace(/"/g, '&quot;')}">Remove</button>
                    </td>
                </tr>
            `;
        }).join('');

        document.querySelectorAll('.btn-tbl-delete').forEach(b => b.addEventListener('click', () => deleteTargetCourseTrack(b.getAttribute('data-id'), b.getAttribute('data-name'))));
        document.querySelectorAll('[data-action="toggle-links"]').forEach(b => b.addEventListener('click', () => toggleActivityLinks(b)));
        document.querySelectorAll('.order-input').forEach(input => input.addEventListener('change', () => {
            reorderCourseToPosition(Number(input.dataset.courseId), input.value);
        }));
        document.querySelectorAll('[data-copy-reg-link]').forEach(b => b.addEventListener('click', async () => {
            const link = b.getAttribute('data-copy-reg-link');
            try {
                await navigator.clipboard.writeText(link);
                alert('Registration link copied to clipboard!\n\n' + link);
            } catch (e) {
                prompt('Copy this registration link:', link);
            }
        }));
        document.querySelectorAll('[data-qr-link]').forEach(b => b.addEventListener('click', () => {
            showLinkQrModal(b.getAttribute('data-qr-link'), b.getAttribute('data-qr-title'));
        }));
    }
}

// ============================================================================
// QR Code popup for the Registration/Attendance/Activity Log links — none of
// these links expire on their own (they stay open until the admin closes
// the Activity's links or removes the Activity), so a QR code printed once
// keeps working for anyone who scans it. Uses the "qrcode" library loaded
// as a plain global (QRCode) in dashboard.html, not the module import —
// that script must stay a non-module <script> tag for the global to exist.
// ============================================================================
function showLinkQrModal(link, title) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed; inset:0; background:rgba(15,15,25,0.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';

    const box = document.createElement('div');
    box.style.cssText = 'background:#fff; border-radius:16px; padding:28px; max-width:360px; width:100%; text-align:center; box-shadow:0 20px 60px rgba(0,0,0,0.3);';
    box.innerHTML = `
        <h3 style="margin:0 0 4px; font-size:16px; color:#25233A;">${title}</h3>
        <p style="margin:0 0 16px; font-size:12px; color:#64748b;">Scan to open this link.</p>
        <canvas id="linkQrCanvas" style="max-width:100%; height:auto;"></canvas>
        <p style="margin:14px 0 0; font-size:11px; word-break:break-all; color:#94a3b8;">${link}</p>
        <div style="display:flex; gap:10px; margin-top:18px;">
            <button type="button" id="linkQrDownloadBtn" class="btn-flex btn-primary-action" style="flex:1;">Download PNG</button>
            <button type="button" id="linkQrCloseBtn" class="btn-flex btn-secondary" style="flex:1;">Close</button>
        </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const canvas = box.querySelector('#linkQrCanvas');
    QRCode.toCanvas(canvas, link, { width: 260, margin: 2 }, (err) => {
        if (err) console.error('QR code generation failed:', err);
    });

    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    box.querySelector('#linkQrCloseBtn').addEventListener('click', close);
    box.querySelector('#linkQrDownloadBtn').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `qr-${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
        a.click();
    });
}

// "Report (Excel) — All Activities" — exports every PARTICIPANT across
// EVERY activity/course (not the list of activities itself), in the same
// green Ministry bilingual template used by Participant Registrations (see
// js/excel-export.js's exportGreenTemplateExcel). Column mapping mirrors
// js/students.js's exportCSV exactly — same snapshot fields off
// `registrations`, same course_date/course_end_date off `courses` — just
// across the whole registrations table instead of one filtered view.
window.exportAllActivities = async function () {
    const btn = document.getElementById('exportAllActivitiesBtn');
    const originalLabel = btn.textContent;
    // Optional period filter — "From"/"To" date pickers next to the export
    // button. Left blank (the default), every participant is exported, same
    // as before this filter existed. When set, only participants whose
    // activity/entry start_date falls inside the chosen period are kept.
    const periodFromEl = document.getElementById('exportPeriodFrom');
    const periodToEl = document.getElementById('exportPeriodTo');
    const periodFrom = periodFromEl && periodFromEl.value ? periodFromEl.value : '';
    const periodTo = periodToEl && periodToEl.value ? periodToEl.value : '';
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    try {
        const { data: regs, error: regsErr } = await client
            .from('registrations')
            .select('*')
            .order('created_at', { ascending: false });
        if (regsErr) {
            alert('Could not load participants: ' + regsErr.message);
            return;
        }

        const coursesById = new Map(allCoursesCached.map(c => [c.id, c]));
        // allCoursesCached only holds courses' non-date-sensitive fields
        // already loaded for the table above, but course_date/
        // course_end_date/attendance_required are part of `select('*')`
        // there too, so no second query is needed here.

        // Self-log ("without attendance") courses: Title/Start/End date
        // come from each individually logged entry (activity_log_entries),
        // not the course's own fixed name/dates — a participant with
        // several logged entries gets one row per entry. Same rule as
        // js/students.js's exportCSV, just across every course instead of
        // one filtered view.
        const selfLogRegIds = (regs || [])
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

        // Institutions are stored as "Ibra - <Department>" for Ibra's own
        // departments (same convention as js/activity-log.js's "Organized
        // By" dropdown) — stripped here for display in the export's
        // Department column.
        const stripIbraPrefix = (name) => !name ? '' : (name.startsWith('Ibra - ') ? name.replace('Ibra - ', '') : name);

        const participants = [];
        (regs || []).forEach(r => {
            const course = coursesById.get(r.course_id);
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

            if (course && course.attendance_required === false) {
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
                    program_title: course ? (course.name || '') : (r.course_id ? 'Deleted Course' : ''),
                    start_date: course ? (course.course_date || '') : '',
                    end_date: course ? (course.course_end_date || '') : '',
                    department: stripIbraPrefix(r.institution_name_snapshot)
                });
            }
        });

        // Apply the period filter, if the admin chose one — matched against
        // each participant row's own start_date (the activity's date, or
        // for self-log courses, that specific logged entry's date), so a
        // course spanning several entries can have some entries included
        // and others excluded depending on when they actually happened.
        let filteredParticipants = participants;
        if (periodFrom || periodTo) {
            filteredParticipants = participants.filter(p => {
                if (!p.start_date) return false; // no date to compare — excluded once a period is set
                if (periodFrom && p.start_date < periodFrom) return false;
                if (periodTo && p.start_date > periodTo) return false;
                return true;
            });
        }

        if (filteredParticipants.length === 0) {
            alert('No participants found in that period.');
            return;
        }

        exportGreenTemplateExcel(filteredParticipants, 'all_participants_report');
    } catch (err) {
        alert('Could not build the report: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
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

async function toggleActivityLinks(btn) {
    const id = btn.dataset.id;
    const isCurrentlyClosed = btn.dataset.closed === 'true';
    const newValue = !isCurrentlyClosed;
    const label = newValue ? 'close' : 'open';
    if (!(await confirmCard(`Are you sure you want to ${label} this activity's public links? ${newValue ? 'Registration, attendance check-in, and the activity log will all stop working for it.' : 'Registration, attendance check-in, and the activity log will all work again.'}`))) return;

    btn.disabled = true;
    const { error } = await client.from('courses').update({ links_closed: newValue }).eq('id', Number(id));
    btn.disabled = false;
    if (error) {
        alert('Could not update: ' + error.message);
        return;
    }
    alert(newValue ? 'Activity closed — its public links are now blocked.' : 'Activity reopened — its public links work again.');
    reloadAdminConsoleDashboard();
}

async function deleteTargetCourseTrack(id, courseName) {
    try {
        if (typeof formCard !== 'function' || typeof confirmCard !== 'function') {
            alert('This page needs a fresh copy of a required file — please hard-refresh (Ctrl+Shift+R) and try again.');
            return;
        }

        const result = await formCard('Remove Course', [
            { name: 'reason', label: `Why are you removing "${courseName}"?`, placeholder: 'Reason for deletion' }
        ], { okLabel: 'Continue' });
        if (!result) return;
        if (!result.reason) { alert('Please enter a reason.'); return; }
        if (!(await confirmCard("Are you absolutely sure you want to remove this course configuration track from the database?"))) return;

        // Fetch the certificate template's file paths BEFORE deleting the
        // course — the certificates row cascades away the instant the
        // course does, so this is the last chance to know which storage
        // files need cleaning up. Deleting the DB row alone leaves the
        // actual image/file sitting in the bucket forever.
        const { data: certRow } = await client.from('certificates')
            .select('preview_image_path, pptx_path')
            .eq('course_id', Number(id))
            .maybeSingle();

        const { error } = await client.from('courses').delete().eq('id', Number(id));
        if (!error) {
            if (certRow) {
                // Paths are stored as full public URLs, not bare filenames —
                // the actual storage object key is just the last path segment.
                if (certRow.preview_image_path) {
                    const fileName = certRow.preview_image_path.split('/').pop();
                    client.storage.from('certificate-previews').remove([fileName]).then(() => {}, () => {});
                }
                if (certRow.pptx_path) {
                    const fileName = certRow.pptx_path.split('/').pop();
                    client.storage.from('certificate-templates').remove([fileName]).then(() => {}, () => {});
                }
            }

            client.from('deletion_audit_log').insert({
                admin_username: currentAdminName(), entity_type: 'course',
                entity_label: courseName || `Course #${id}`, reason: result.reason
            }).then(() => {}, () => {}); // best-effort — shouldn't block the actual deletion
            alert("Course successfully removed.");
            reloadAdminConsoleDashboard();
        } else {
            alert("Removal error: " + error.message);
        }
    } catch (err) {
        console.error('deleteTargetCourseTrack failed:', err);
        alert('Something unexpected went wrong removing this course: ' + err.message);
    }
}

reloadAdminConsoleDashboard();
