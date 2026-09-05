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

async function reloadAdminConsoleDashboard() {
    const { data: courses, error: errC } = await client.from('courses').select('*').order('id', { ascending: true });
    const tbody = document.getElementById('coursesMainTableBody');
    if (errC) {
        tbody.innerHTML = `<tr><td colspan="8" style="color:#dc2626; text-align:center; padding: 20px;">Error indexing courses table data arrays.</td></tr>`;
        return;
    }
    allCoursesCached = courses || [];
    if (dashboardCurrentPage > Math.ceil(allCoursesCached.length / PAGE_SIZE)) dashboardCurrentPage = 1;
    renderCoursesPage();
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
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#64748b; padding: 20px;">No tracked courses inside live configuration space.</td></tr>`;
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

            return `
                <tr>
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
                               </div>`
                            : '<span style="color:#94a3b8; font-size:12px;">Use the Activity Log link →</span>'}
                    </td>
                    <td>
                        ${isAttendanceRequired
                            ? `<div style="display:flex; flex-direction:column; gap:6px; align-items:flex-start;">
                                <a class="btn-tbl-view" href="${attendanceLink}" target="_blank" rel="noopener">Open Link</a>
                                <button type="button" class="btn-tbl-edit" data-copy-reg-link="${attendanceLink}">Copy Link</button>
                               </div>`
                            : '<span style="color:#94a3b8; font-size:12px;">N/A — attendance not required</span>'}
                    </td>
                    <td>
                        ${isAttendanceRequired
                            ? '<span style="color:#94a3b8; font-size:12px;">N/A — attendance required</span>'
                            : `<div style="display:flex; flex-direction:column; gap:6px; align-items:flex-start;">
                                <a class="btn-tbl-view" href="${activityLogLink}" target="_blank" rel="noopener">Open Link</a>
                                <button type="button" class="btn-tbl-edit" data-copy-reg-link="${activityLogLink}">Copy Link</button>
                               </div>`}
                    </td>
                    <td class="action-cell">
                        <a class="btn-tbl-edit" href="create-course.html?edit_id=${c.id}">Edit</a>
                        <button class="btn-tbl-delete" data-id="${c.id}" data-name="${courseNameClean.replace(/"/g, '&quot;')}">Remove</button>
                    </td>
                </tr>
            `;
        }).join('');

        document.querySelectorAll('.btn-tbl-delete').forEach(b => b.addEventListener('click', () => deleteTargetCourseTrack(b.getAttribute('data-id'), b.getAttribute('data-name'))));
        document.querySelectorAll('[data-copy-reg-link]').forEach(b => b.addEventListener('click', async () => {
            const link = b.getAttribute('data-copy-reg-link');
            try {
                await navigator.clipboard.writeText(link);
                alert('Registration link copied to clipboard!\n\n' + link);
            } catch (e) {
                prompt('Copy this registration link:', link);
            }
        }));
    }
}

function currentAdminName() {
    try {
        const raw = localStorage.getItem('ibra_admin_session');
        const session = raw ? JSON.parse(raw) : null;
        return (session && (session.fullName || session.username)) || 'Unknown admin';
    } catch {
        return 'Unknown admin';
    }
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
