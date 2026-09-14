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

            if (courseFilterId) {
                mappedData = mappedData.filter(r => r.course_id === courseFilterId);
            }

            const attendanceFilterValue = document.getElementById('attendanceFilter').value;
            if (attendanceFilterValue === 'attended') {
                mappedData = mappedData.filter(r => r.attended);
            } else if (attendanceFilterValue === 'not_attended') {
                mappedData = mappedData.filter(r => !r.attended);
            }

            allData = mappedData;

            document.getElementById('stats').innerHTML = `
                <div class="stat-card">
                    <div class="stat-label">${courseFilterId ? 'Registrations for This Course' : 'Total Participants'}</div>
                    <div class="stat-number">${allData.length}</div>
                </div>
            `;

            if (allData.length === 0) {
                tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; color:#64748b; padding:20px;">No student registrations found${courseFilterId ? ' for this course' : ''}.</td></tr>`;
                document.getElementById('studentsPagination').innerHTML = '';
                return;
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

                return `
                    <tr>
                        <td><b>${pageStart + i + 1}</b></td>
                        <td>${r.phone_number || 'N/A'}</td>
                        <td>${r.staff_name}</td>
                        <td>${r.staff_number}</td>
                        <td><span class="gender-badge">${r.sex_snapshot || r.sex || 'N/A'}</span></td>
                        <td><span class="inst-badge">${r.institution_name_snapshot}</span></td>
                        <td><span class="course-badge">${r.course_name}</span></td>
                        <td>${r.course_date}</td>
                        <td>${attendanceCell}</td>
                        <td>${answersCell}</td>
                        <td>
                            <button class="btn-delete" onclick="handleDeleteRegistration(${r.id}, ${r.course_id}, ${r.institution_id}, '${(r.staff_name || '').replace(/'/g, "\\'")}', '${(r.course_name || '').replace(/'/g, "\\'")}')">
                                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                Remove
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');

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
        function formatEntryTime(timeStr) {
            const [h, m] = timeStr.split(':').map(Number);
            const period = h >= 12 ? 'PM' : 'AM';
            const hour12 = h % 12 === 0 ? 12 : h % 12;
            return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
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
                .select('title, entry_date, entry_time')
                .eq('registration_id', registrationId)
                .order('entry_date', { ascending: false })
                .order('entry_time', { ascending: false });

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
                        <th style="padding:6px 8px; border-bottom:2px solid #f1f5f9;">Time</th>
                        <th style="padding:6px 8px; border-bottom:2px solid #f1f5f9;">Department</th>
                    </tr></thead>
                    <tbody>
                        ${data.map(e => `
                            <tr>
                                <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${e.title}</td>
                                <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${formatEntryDate(e.entry_date)}</td>
                                <td style="padding:8px; border-bottom:1px solid #f1f5f9;">${formatEntryTime(e.entry_time)}</td>
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

        window.exportCSV = async function () {
            const btn = document.getElementById('exportCSVBtn');
            const originalLabel = btn.textContent;
            btn.disabled = true;
            btn.textContent = 'Preparing…';
            try {

            // ================================================================
            // Ministry-standard template ("مديرية شمال الشرقية - سجل بيانات
            // التدريب"), replicated exactly: same 22 columns, same two-row
            // bilingual header with merges, same colors/fonts/RTL/borders/row
            // striping. "Training Domains" (M) and "included in the approved
            // HRD plan" (V) have no corresponding field anywhere in this
            // system, so those two columns stay structurally present but
            // empty for every row — not a bug, there's simply nothing to
            // put there. "Program end date" (Q-S) is deliberately left
            // empty per instruction, even though it has a real data source
            // (course_date) the start-date columns already use.
            // ================================================================

            const GREEN_DARK = 'FF548135';
            const GREEN_LIGHT = 'FFA8D08D';
            const WHITE = 'FFFFFFFF';
            const STRIPE_GRAY = 'FFF8F9FA';
            const RED = 'FFFF0000';

            const thinBorder = { top: { style: 'thin', color: { rgb: 'FF000000' } }, bottom: { style: 'thin', color: { rgb: 'FF000000' } }, left: { style: 'thin', color: { rgb: 'FF000000' } }, right: { style: 'thin', color: { rgb: 'FF000000' } } };
            const centerWrap = { horizontal: 'center', vertical: 'center', wrapText: true };

            function cellStyle({ bold = false, size = 12, color = 'FF000000', fill = null, border = thinBorder } = {}) {
                const style = {
                    font: { name: 'Times New Roman', sz: size, bold, color: { rgb: color } },
                    alignment: centerWrap,
                    border
                };
                if (fill) style.fill = { fgColor: { rgb: fill }, patternType: 'solid' };
                return style;
            }

            // Row 1: plain banner row, dark green across every column, only
            // the first cell carries text — matches the template exactly.
            const row1 = ['*/', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
            // Row 2: the 18 real column groups (bilingual Arabic/English) —
            // date groups occupy 3 columns each (day/month/year), the rest
            // occupy 1 column spanning both header rows.
            const row2 = [
                'Full Name /   الاسم الكامل', 'Staff Number/ الرقم الوظيفي', 'المسمى الوظيفي / DESIGNATION ',
                'المستوى الوظيفي / Job Level', 'Gender/الجنس', 'الجنسية / NATIONALITY ',
                'أعلى مؤهل دراسي / Highest educational qualification', 'سنوات الخبرة/ experience years',
                'جهة العمل / Employer', 'المديرية/ directorate', 'عنوان البرنامج | TITLE OF PROGRAM',
                'نوع البرنامج| Type of Program', 'المجالات التدريبية  / Training Domains',
                'تاريخ بدء البرنامج / program start date', '', '',
                'تاريخ إنتهاء البرنامج / program end date', '', '',
                'طبيعة الحضور | Nature of Attendance', '',
                'هل البرنامج مدرج في خطة تنمية الموارد البشرية المعتمدة | included in the approved HRD plan'
            ];
            const row3 = ['', '', '', '', '', '', '', '', '', '', '', '', '',
                'اليوم/ Day ', 'الشهر / month', 'السنة / year',
                'اليوم/ Day ', 'الشهر / month', 'السنة / year',
                '', '', ''];

            const singleColIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 19, 20, 21]; // every column except the two 3-wide date groups
            const merges = [
                { s: { r: 1, c: 13 }, e: { r: 1, c: 15 } }, // program start date (N2:P2)
                { s: { r: 1, c: 16 }, e: { r: 1, c: 18 } }, // program end date (Q2:S2)
                ...singleColIndexes.map(c => ({ s: { r: 1, c }, e: { r: 2, c } }))
            ];

            const rows = allData.map(r => {
                const startDate = r.course_date ? new Date(r.course_date + 'T00:00:00') : null;
                return [
                    r.staff_name || '',
                    r.staff_number || '',
                    r.designation_snapshot || '',
                    r.job_level_snapshot || '',
                    r.sex_snapshot || r.sex || '',
                    r.nationality_snapshot || '',
                    r.education_qualification_snapshot || '',
                    r.experience_years_snapshot || '',
                    r.organization_snapshot || '',
                    r.directorate_snapshot || '',
                    r.course_name || '',
                    r.program_type_snapshot || '',
                    '', // Training Domains — no source field in this system
                    startDate ? startDate.getDate() : '',
                    startDate ? startDate.getMonth() + 1 : '',
                    startDate ? startDate.getFullYear() : '',
                    '', '', '', // program end date — left empty on purpose
                    r.attendance_nature_snapshot || '',
                    '', // unlabeled spacer column, matches the template
                    ''  // HRD plan inclusion — no source field in this system
                ];
            });

            const worksheet = XLSX.utils.aoa_to_sheet([row1, row2, row3, ...rows]);
            worksheet['!merges'] = merges;

            const totalCols = row2.length;
            for (let c = 0; c < totalCols; c++) {
                const ref1 = XLSX.utils.encode_cell({ r: 0, c });
                if (!worksheet[ref1]) worksheet[ref1] = { t: 's', v: '' };
                worksheet[ref1].s = cellStyle({ bold: false, fill: GREEN_DARK });

                const ref2 = XLSX.utils.encode_cell({ r: 1, c });
                if (!worksheet[ref2]) worksheet[ref2] = { t: 's', v: '' };
                worksheet[ref2].s = cellStyle({ bold: true, fill: GREEN_LIGHT });

                const ref3 = XLSX.utils.encode_cell({ r: 2, c });
                if (!worksheet[ref3]) worksheet[ref3] = { t: 's', v: '' };
                // Day/Month/Year sub-header text is all red, matching the
                // "month" column's color across both date groups.
                const isRedSubheader = [13, 14, 15, 16, 17, 18].includes(c);
                worksheet[ref3].s = cellStyle({ bold: true, fill: GREEN_LIGHT, color: isRedSubheader ? RED : 'FF000000' });
            }

            // Data rows: alternating white/light-gray striping, same as the
            // template, starting from the first data row (row index 3).
            for (let r = 0; r < rows.length; r++) {
                const excelRow = 3 + r;
                const stripeFill = (r % 2 === 0) ? WHITE : STRIPE_GRAY;
                for (let c = 0; c < totalCols; c++) {
                    const ref = XLSX.utils.encode_cell({ r: excelRow, c });
                    if (!worksheet[ref]) worksheet[ref] = { t: 's', v: '' };
                    worksheet[ref].s = cellStyle({ bold: false, size: 13, fill: stripeFill });
                }
            }

            worksheet['!cols'] = [
                { wch: 34 }, { wch: 15 }, { wch: 28 }, { wch: 16 }, { wch: 16 },
                { wch: 18 }, { wch: 26 }, { wch: 20 }, { wch: 22 }, { wch: 34 },
                { wch: 36 }, { wch: 28 }, { wch: 32 }, { wch: 8 }, { wch: 8 },
                { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 24 },
                { wch: 10 }, { wch: 34 }
            ];

            // Row height grows or shrinks to fit whatever the row actually
            // holds, instead of one fixed height for every row — a short
            // "Female" and a long wrapped qualification string end up in
            // very different places otherwise: either the tall content
            // gets clipped, or every row is stretched to fit the longest
            // one in the whole sheet. Estimates how many lines the widest
            // cell in each row will actually wrap to, at that column's
            // real width, and sizes the row for exactly that.
            function estimateWrappedLineCount(text, colWchWidth) {
                const str = String(text == null ? '' : text);
                if (!str) return 1;
                // ~1 "wch" unit holds roughly 1 character at this font/size;
                // a little slack (0.9) since bold/Arabic glyphs run wider.
                const charsPerLine = Math.max(4, colWchWidth * 0.9);
                return Math.max(1, Math.ceil(str.length / charsPerLine));
            }
            function rowHeightForContent(rowValues, colWidths, ptPerLine, minPt) {
                let maxLines = 1;
                rowValues.forEach((val, c) => {
                    const lines = estimateWrappedLineCount(val, colWidths[c]?.wch || 10);
                    if (lines > maxLines) maxLines = lines;
                });
                return Math.max(minPt, maxLines * ptPerLine + 4);
            }
            const colWidths = worksheet['!cols'];
            worksheet['!rows'] = [
                { hpt: rowHeightForContent(row1, colWidths, 15, 15) },
                { hpt: rowHeightForContent(row2, colWidths, 15, 22) },
                { hpt: rowHeightForContent(row3, colWidths, 15, 22) },
                ...rows.map(rowValues => ({ hpt: rowHeightForContent(rowValues, colWidths, 16, 20) }))
            ];

            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'بيانات المشاركين | Participant');

            const courseFilterId = getCourseFilterIdFromUrl();
            const filteredCourseName = courseFilterId ? (allData[0]?.course_name || 'course') : null;
            const safeName = filteredCourseName ? filteredCourseName.replace(/[^a-z0-9]+/gi, '_').toLowerCase() : null;
            const fileName = (safeName ? `students_${safeName}` : 'students_report') + `_${excelTodayStamp()}.xlsx`;

            // xlsx-js-style has no support at all for RTL sheet view (its
            // Workbook.Views mechanism silently writes nothing — confirmed
            // by inspecting its own source) — so the flag is patched
            // directly into the generated file's internal XML afterward,
            // the same way the original template has it, rather than
            // relying on a library option that doesn't actually exist.
            const wbout = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
            const zip = await JSZip.loadAsync(wbout);
            const sheetPath = 'xl/worksheets/sheet1.xml';
            const sheetXmlFile = zip.file(sheetPath);
            if (sheetXmlFile) {
                let sheetXml = await sheetXmlFile.async('string');
                if (sheetXml.includes('<sheetView ')) {
                    sheetXml = sheetXml.replace('<sheetView ', '<sheetView rightToLeft="1" ');
                } else if (sheetXml.includes('<sheetView/>')) {
                    sheetXml = sheetXml.replace('<sheetView/>', '<sheetView rightToLeft="1"/>');
                }
                zip.file(sheetPath, sheetXml);
            }
            const patchedBlob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

            const downloadUrl = URL.createObjectURL(patchedBlob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(downloadUrl);

            alert(`Exported ${rows.length} record${rows.length === 1 ? '' : 's'} successfully.`);

            } finally {
                btn.disabled = false;
                btn.textContent = originalLabel;
            }
        };

        loadData();
