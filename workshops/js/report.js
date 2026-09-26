import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// XLSX and exportStyledExcel come from plain <script> tags loaded in
// admin/report.html (xlsx-js-style + js/excel-export.js) — not imported here,
// since xlsx-js-style has to be loaded as a global, not an ES module.

// Every registration, unfiltered, so the two report tools below can
// search across everything by staff number or date range.
let allRegistrationsRaw = [];
let coursesCached = [];

async function loadData() {
    const { data: courses } = await client.from('courses').select('id, name, course_date');
    coursesCached = courses || [];

    const { data: regs, error } = await client.from('registrations').select('*').order('created_at', { ascending: false });

    if (error) return console.error(error);

    allRegistrationsRaw = regs.map(r => {
        const targetCourse = coursesCached.find(c => c.id === r.course_id);
        return {
            ...r,
            course_name: targetCourse ? targetCourse.name : 'Deleted Course',
            course_date: targetCourse ? targetCourse.course_date : 'N/A',
        };
    });

    populateCourseFilterSelects();
}

// Both the Excel "Full Report by Date Range" course filter and the PDF
// "Custom Field Report" course filter share the same course list.
function populateCourseFilterSelects() {
    const options = '<option value="">All Activity</option>' +
        coursesCached.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    ['reportRangeCourse', 'reportFieldsCourse'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = options;
    });
}

function formatDateDDMMYYYY(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr); // fallback if it's not a parseable date
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
}

// Inclusive range check against a record's registration timestamp (created_at).
function isWithinRange(dateStr, fromStr, toStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    if (fromStr) {
        const from = new Date(fromStr + 'T00:00:00');
        if (d < from) return false;
    }
    if (toStr) {
        const to = new Date(toStr + 'T23:59:59');
        if (d > to) return false;
    }
    return true;
}

// ============================================================================
// Excel export
// ============================================================================

const HEADERS = ['#', 'Phone Number', 'Participant Name', 'Staff Number', 'Gender', 'Institution Origin', 'Activity Name', 'Course Date', 'Registered On'];

// Columns that must stay plain text in Excel — otherwise it reinterprets them
// (drops leading zeros on phone/staff numbers, converts dates to serial numbers).
const TEXT_COLUMN_INDEXES = [1, 3, 7, 8];

function buildExcelRows(data) {
    return data.map((r, i) => [
        i + 1,
        r.phone_number || '',
        r.staff_name || '',
        r.staff_number || '',
        r.sex_snapshot || r.sex || 'N/A',
        r.institution_name_snapshot || '',
        r.course_name || '',
        formatDateDDMMYYYY(r.course_date),
        formatDateDDMMYYYY(r.created_at)
    ]);
}

function exportToExcel(data, filenameBase) {
    exportStyledExcel(HEADERS, buildExcelRows(data), filenameBase, 'Registrations', TEXT_COLUMN_INDEXES);
}

// Report tool 1: one staff number, optionally narrowed to a date range.
window.exportStaffReport = async function () {
    const staffNum = document.getElementById('reportStaffNumber').value.trim();
    const fromStr = document.getElementById('reportStaffFrom').value;
    const toStr = document.getElementById('reportStaffTo').value;

    if (!staffNum) {
        alert('Please enter a staff number.');
        return;
    }

    // Refetch fresh rather than relying on the page-load cache — this
    // report shouldn't require a manual page refresh to see a
    // registration someone just submitted a minute ago.
    await loadData();

    const filtered = allRegistrationsRaw.filter(r =>
        (r.staff_number || '').trim() === staffNum &&
        (!(fromStr || toStr) || isWithinRange(r.created_at, fromStr, toStr))
    );

    exportToExcel(filtered, `report_staff_${staffNum.replace(/[^a-z0-9]+/gi, '_')}`);
};

// Same staff-number filter as the Excel export above, but as a PDF listing
// every activity that one person enrolled in, with a total count at the end.
window.exportStaffReportPdf = async function () {
    const staffNum = document.getElementById('reportStaffNumber').value.trim();
    const fromStr = document.getElementById('reportStaffFrom').value;
    const toStr = document.getElementById('reportStaffTo').value;

    if (!staffNum) {
        alert('Please enter a staff number.');
        return;
    }

    await loadData();

    const filtered = allRegistrationsRaw.filter(r =>
        (r.staff_number || '').trim() === staffNum &&
        (!(fromStr || toStr) || isWithinRange(r.created_at, fromStr, toStr))
    );

    if (filtered.length === 0) {
        alert('No registrations match that staff number/date range — nothing to report.');
        return;
    }

    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
        alert('PDF library failed to load — check your internet connection and try again.');
        return;
    }
    const doc = new jsPDF();
    if (typeof doc.autoTable !== 'function') {
        alert('PDF table plugin failed to load — check your internet connection and try again.');
        return;
    }

    const participantName = filtered[0].staff_name || 'Unknown';
    const rangeLabel = (fromStr || toStr) ? `${fromStr || '…'} to ${toStr || '…'}` : 'All time';
    const rows = filtered.map((r, i) => [i + 1, reshapeArabicForPdf(r.course_name || 'Unknown activity'), '1']);

    try {
        const logo = await getLogoBase64().catch(() => null);
        const infoLines = [
            `Staff Number: ${staffNum}`,
            `Participant Name: ${participantName}`,
            `Date range: ${rangeLabel}`,
            `Total activities: ${rows.length}`,
            `Generated: ${new Date().toLocaleString()}`
        ];

        doc.autoTable({
            startY: drawReportHeader(doc, logo, 'Report by Staff Number', infoLines),
            head: [['#', 'Activity Name', 'Number of Courses']],
            body: rows,
            styles: { fontSize: 9, font: 'Amiri' },
            headStyles: { fillColor: [124, 58, 237], font: 'Amiri' },
            bodyStyles: { font: 'Amiri' },
            foot: [[{ content: 'Total', colSpan: 2, styles: { fontStyle: 'bold', font: 'Amiri' } }, { content: String(rows.length), styles: { fontStyle: 'bold', font: 'Amiri' } }]],
            footStyles: { fillColor: [237, 233, 254], textColor: [91, 33, 182], font: 'Amiri' },
            // Without this, autoTable's default repeats the foot row on
            // EVERY page a table spans — only wanted once, at the very end.
            showFoot: 'lastPage',
            // Repeats the logo/title/info-lines header on every page this
            // report spans, not just the first — didDrawPage fires once
            // per page, including subsequent ones.
            didDrawPage: (data) => { if (data.pageNumber > 1) drawMinimalReportHeader(doc, logo); },
            margin: { left: 14, right: 14, top: 66 }
        });

        addPrintedByFooter(doc);
        doc.save(`staff_report_${staffNum.replace(/[^a-z0-9]+/gi, '_')}.pdf`);
    } catch (err) {
        alert('Could not generate PDF: ' + err.message);
    }
};

// Report tool 2: every registration within a date range, any staff member,
// optionally narrowed to one course.
// Shared by both exports below — matches a registration's snapshot
// institution name against the selected category. "Ibra - " prefixed names
// are the Ibra category; everything else is the "Health Center" (Other)
// category, matching the same convention used for institutions everywhere
// else in the app.
function matchesInstitutionCategory(registration, category) {
    if (category === 'BOTH' || !category) return true;
    const isIbra = (registration.institution_name_snapshot || '').startsWith('Ibra - ');
    return category === 'IBRA' ? isIbra : !isIbra;
}

window.exportDateRangeReport = async function () {
    const fromStr = document.getElementById('reportRangeFrom').value;
    const toStr = document.getElementById('reportRangeTo').value;
    const courseId = document.getElementById('reportRangeCourse').value;
    const institutionCategory = document.getElementById('reportRangeInstitution').value;

    if (!fromStr || !toStr) {
        alert('Please choose both a from and to date.');
        return;
    }

    await loadData();

    const filtered = allRegistrationsRaw.filter(r =>
        isWithinRange(r.created_at, fromStr, toStr) &&
        (!courseId || String(r.course_id) === courseId) &&
        matchesInstitutionCategory(r, institutionCategory)
    );

    const courseLabel = courseId ? (coursesCached.find(c => String(c.id) === courseId)?.name || 'course').replace(/[^a-z0-9]+/gi, '_') : 'all_courses';
    exportToExcel(filtered, `report_${courseLabel}_${fromStr}_to_${toStr}`);
};

// Groups the same date-range-filtered registrations by staff number instead
// of listing one row per registration — one row per PERSON, with how many
// distinct activities they enrolled in across the range.
window.exportDateRangeReportPdf = async function () {
    const fromStr = document.getElementById('reportRangeFrom').value;
    const toStr = document.getElementById('reportRangeTo').value;
    const courseId = document.getElementById('reportRangeCourse').value;
    const institutionCategory = document.getElementById('reportRangeInstitution').value;

    if (!fromStr || !toStr) {
        alert('Please choose both a from and to date.');
        return;
    }

    await loadData();

    const filtered = allRegistrationsRaw.filter(r =>
        isWithinRange(r.created_at, fromStr, toStr) &&
        (!courseId || String(r.course_id) === courseId) &&
        matchesInstitutionCategory(r, institutionCategory)
    );

    if (filtered.length === 0) {
        alert('No registrations match that course/date range/institution — nothing to report.');
        return;
    }

    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
        alert('PDF library failed to load — check your internet connection and try again.');
        return;
    }
    const doc = new jsPDF();
    if (typeof doc.autoTable !== 'function') {
        alert('PDF table plugin failed to load — check your internet connection and try again.');
        return;
    }

    // One entry per staff number — the course_id Set counts DISTINCT
    // activities, so re-registering for the same activity twice (if that's
    // even possible) wouldn't inflate the count.
    const byStaff = new Map();
    filtered.forEach(r => {
        const key = (r.staff_number || '').trim() || `(no number) ${r.staff_name}`;
        if (!byStaff.has(key)) {
            byStaff.set(key, { staff_number: r.staff_number || '—', staff_name: r.staff_name || 'Unknown', courseIds: new Set() });
        }
        byStaff.get(key).courseIds.add(r.course_id);
    });
    const rows = Array.from(byStaff.values())
        .map(p => [p.staff_number, reshapeArabicForPdf(p.staff_name), p.courseIds.size])
        .sort((a, b) => b[2] - a[2]) // busiest participants first
        .map((r, i) => [i + 1, ...r]);

    const courseLabel = courseId ? (coursesCached.find(c => String(c.id) === courseId)?.name || 'Unknown course') : 'All Activity';
    const rangeLabel = `${fromStr} to ${toStr}`;

    try {
        const logo = await getLogoBase64().catch(() => null);
        const infoLines = [
            `Course: ${courseLabel}`,
            `Institution: ${institutionCategory === 'IBRA' ? 'Ibra' : institutionCategory === 'OTHER' ? 'Health Center' : 'Both'}`,
            `Date range: ${rangeLabel}`,
            `Total participants: ${rows.length}`,
            `Generated: ${new Date().toLocaleString()}`
        ];

        doc.autoTable({
            startY: drawReportHeader(doc, logo, 'Activity Staff Attendant', infoLines),
            head: [['#', 'Staff Number', 'Participant Name', 'Number of Courses Enrolled']],
            body: rows,
            styles: { fontSize: 9, font: 'Amiri' },
            headStyles: { fillColor: [124, 58, 237], font: 'Amiri' },
            bodyStyles: { font: 'Amiri' },
            didDrawPage: (data) => { if (data.pageNumber > 1) drawMinimalReportHeader(doc, logo); },
            margin: { left: 14, right: 14, top: 66 }
        });

        addPrintedByFooter(doc);
        doc.save(`date_range_report_${fromStr}_to_${toStr}.pdf`);
    } catch (err) {
        alert('Could not generate PDF: ' + err.message);
    }
};

loadData();
loadEvaluationsForReport();

// Populates the Evaluation / Exam Report's picker with every evaluation/exam
// that exists, newest first — same "Title — Activity Name" labelling used
// elsewhere (evaluations-dashboard.js) so an admin can tell apart two
// evaluations that happen to share a title on different activities.
async function loadEvaluationsForReport() {
    const select = document.getElementById('evalReportSelect');
    if (!select) return;
    const { data, error } = await client
        .from('activity_evaluations')
        .select('id, title, courses(name)')
        .order('created_at', { ascending: false });
    if (error) return console.error(error);
    select.innerHTML = '<option value="">-- Choose --</option>' +
        (data || []).map(e => `<option value="${e.id}">${e.title}${e.courses ? ' — ' + e.courses.name : ''}</option>`).join('');
}

// ============================================================================
// Custom Field Report (PDF) — one frequency table per chosen field, each
// showing every value that appears and how many participants picked it, plus
// a total row. Source columns are the existing "snapshot" columns already
// captured on the registrations table at signup time (see sql/setup.sql
// PART 2 and PART 3) — nothing new to fetch or invent.
// ============================================================================
const REPORT_FIELD_DEFINITIONS = [
    { key: 'designation_snapshot', label: 'Designations' },
    { key: 'job_level_snapshot', label: 'Job Level' },
    { key: 'nationality_snapshot', label: 'Nationality' },
    { key: 'education_qualification_snapshot', label: 'Highest Educational Qualification' },
    { key: 'experience_years_snapshot', label: 'Experience Years' },
    { key: 'organization_snapshot', label: 'Organization' },
    { key: 'directorate_snapshot', label: 'Directorate' },
    { key: 'program_type_snapshot', label: 'Type of Program' },
    { key: 'attendance_nature_snapshot', label: 'Nature of Attendance' },
    { key: 'institution_name_snapshot', label: 'Institutional' }
];

// Group a filtered set of registrations by one snapshot column and count
// participants per value, sorted highest-first so the busiest group leads.
function buildFrequencyRows(records, fieldKey) {
    const counts = new Map();
    records.forEach(r => {
        const value = (r[fieldKey] || '').toString().trim() || 'Not specified';
        counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

window.generateFieldsReportPdf = async function () {
    const courseId = document.getElementById('reportFieldsCourse').value;
    const fromStr = document.getElementById('reportFieldsFrom').value;
    const toStr = document.getElementById('reportFieldsTo').value;
    const checked = [...document.querySelectorAll('.report-field-checkbox:checked')].map(cb => cb.value);

    if (checked.length === 0) {
        alert('Please choose at least one field.');
        return;
    }

    await loadData();

    const filtered = allRegistrationsRaw.filter(r =>
        (!courseId || String(r.course_id) === courseId) &&
        (!(fromStr || toStr) || isWithinRange(r.created_at, fromStr, toStr))
    );

    if (filtered.length === 0) {
        alert('No registrations match that course/date range — nothing to report.');
        return;
    }

    const { jsPDF } = window.jspdf || {};
    if (!jsPDF) {
        document.getElementById('reportFieldsNote').textContent = 'PDF library failed to load — check your internet connection and try again.';
        return;
    }
    const doc = new jsPDF();
    if (typeof doc.autoTable !== 'function') {
        document.getElementById('reportFieldsNote').textContent = 'PDF table plugin failed to load — check your internet connection and try again.';
        return;
    }

    const courseLabel = courseId ? (coursesCached.find(c => String(c.id) === courseId)?.name || 'Unknown course') : 'All Activity';
    const rangeLabel = (fromStr || toStr) ? `${fromStr || '…'} to ${toStr || '…'}` : 'All time';

    try {
        const logo = await getLogoBase64().catch(() => null);
        const infoLines = [
            `Course: ${courseLabel}`,
            `Date range: ${rangeLabel}`,
            `Total participants in range: ${filtered.length}`,
            `Generated: ${new Date().toLocaleString()}`
        ];

        let cursorY = drawReportHeader(doc, logo, 'Participation Report', infoLines);
        REPORT_FIELD_DEFINITIONS
            .filter(f => checked.includes(f.key))
            .forEach(field => {
                const rows = buildFrequencyRows(filtered, field.key).map((r, i) => [i + 1, ...r]);
                const total = rows.reduce((sum, r) => sum + r[2], 0);

                if (cursorY > 260) {
                    doc.addPage();
                    cursorY = drawMinimalReportHeader(doc, logo);
                }
                doc.setFontSize(12);
                doc.setTextColor(20);
                doc.text(field.label, 14, cursorY);

                doc.autoTable({
                    startY: cursorY + 4,
                    head: [['#', field.label, 'Participants']],
                    // Every one of these "snapshot" values is free text the
                    // participant or admin typed in at registration time
                    // (nationality, organization, directorate, etc.) — very
                    // often Arabic — so each one needs the same
                    // reshape+bidi treatment as every other report, or it
                    // renders disconnected/reversed. This is what made this
                    // report specifically look "messy" for Arabic values.
                    body: [...rows.map(([i, value, count]) => [i, reshapeArabicForPdf(value), String(count)]), [{ content: 'Total', colSpan: 2 }, String(total)]],
                    theme: 'grid',
                    // font must be set on styles AND bodyStyles/headStyles
                    // explicitly — jspdf-autotable does not reliably cascade
                    // a top-level styles.font down to body cells on its own,
                    // which is what left this report's Arabic values
                    // rendering in the default (non-Arabic) font even after
                    // the text itself was correctly reshaped.
                    styles: { font: 'Amiri' },
                    headStyles: { fillColor: [124, 58, 237], font: 'Amiri' },
                    bodyStyles: { font: 'Amiri' },
                    didParseCell: (data) => {
                        if (data.row.index === rows.length && data.section === 'body') {
                            data.cell.styles.fontStyle = 'bold';
                            data.cell.styles.fillColor = [237, 233, 254];
                            data.cell.styles.textColor = [91, 33, 182];
                            data.cell.styles.font = 'Amiri';
                        }
                    },
                    // In case a single field's own table is long enough to
                    // span multiple pages on its own (not just the
                    // manual addPage() above between different fields).
                    // data.pageNumber here is absolute (whole document), so
                    // this correctly only skips page 1 itself.
                    didDrawPage: (data) => { if (data.pageNumber > 1) drawMinimalReportHeader(doc, logo); },
                    margin: { left: 14, right: 14, top: 66 }
                });
                cursorY = doc.lastAutoTable.finalY + 14;
            });

        const filenameCourse = courseId ? courseLabel.replace(/[^a-z0-9]+/gi, '_') : 'all_courses';
        doc.setProperties({ title: `Participation Report - ${filenameCourse}` });

        // Open the PDF in a new tab for preview first — the browser's own PDF
        // viewer has a Download button, so the person decides whether to save it
        // instead of it silently landing in their Downloads folder unannounced.
        addPrintedByFooter(doc);
        const blobUrl = doc.output('bloburl');
        const previewTab = window.open(blobUrl, '_blank');
        const note = document.getElementById('reportFieldsNote');
        if (!previewTab) {
            // Pop-up blocked — give a visible fallback link instead of failing silently.
            note.innerHTML = `Your browser blocked the preview pop-up — <a href="${blobUrl}" target="_blank" rel="noopener">click here to open the report</a>.`;
        } else {
            note.textContent = '';
        }
    } catch (err) {
        console.error('PDF generation failed:', err);
        document.getElementById('reportFieldsNote').textContent = 'Something went wrong building the PDF: ' + err.message;
    }
};

// ============================================================================
// Hall Activity Report (PDF) — logo-headed report: hall + type filters,
// a period line, an Activity Name/Date table, and a total-count summary.
// ============================================================================
let logoBase64Cache = null;
// Adds "Printed by: [admin's full name]" at the bottom-left of every page
// in the document — called right before each PDF's final output step
// (doc.save() or doc.output('bloburl')), after all pages already exist, so
// looping through every page here reliably catches all of them.
// Draws the logo + "Ibra Hospital" / subtitle + report title + info lines —
// called from autoTable's didDrawPage callback so it repeats on EVERY page
// a report spans, not just the first. Returns the Y position where the
// table itself should start on the page this was just drawn on.
function drawReportHeader(doc, logo, title, infoLines) {
    // Amiri (registered by amiri-font.js) is the only font loaded here that
    // actually has Arabic glyphs, and it covers Latin characters fine too —
    // set unconditionally so EVERY report (not just the ones that
    // remembered to do this themselves) can safely mix Arabic and English
    // text in its title/info lines. Any Arabic content in `title` or
    // `infoLines` (a staff name, an institution or activity name, etc.)
    // still needs reshaping+bidi via reshapeArabicForPdf — jsPDF has no
    // Arabic contextual shaping or right-to-left layout of its own.
    doc.setFont('Amiri', 'normal');

    if (logo) doc.addImage(logo, 'PNG', 90, 10, 30, 30);
    doc.setFontSize(16);
    doc.setTextColor(20);
    doc.text('Ibra Hospital', 105, 48, { align: 'center' });
    doc.setFontSize(12);
    doc.setTextColor(90);
    doc.text('Professional Development and Career Guidance', 105, 56, { align: 'center' });

    doc.setFontSize(16);
    doc.setTextColor(20);
    // Report titles come straight from an activity/course/evaluation name an
    // admin typed in, with no length limit — a long one (e.g. "Speaker
    // Evaluations [For Environmental Hygiene Upskilling Training...]") used
    // to be drawn as a single line and run straight off the right edge of
    // the A4 page. Wrapped to the page's content width instead, same fix as
    // the per-question text in the Evaluation/Exam report; the info lines
    // below (Activity/Generated/Total Responses, etc.) then start below
    // however many lines the title actually wrapped to, instead of a fixed
    // offset that assumed a one-line title.
    const titleMaxWidth = 182;
    const titleLineHeight = 7;
    const titleLines = doc.splitTextToSize(reshapeArabicForPdf(title), titleMaxWidth);
    doc.text(titleLines, 14, 68);
    const infoStartY = 68 + titleLines.length * titleLineHeight + 2;

    doc.setFontSize(10);
    doc.setTextColor(90);
    infoLines.forEach((line, i) => doc.text(reshapeArabicForPdf(line), 14, infoStartY + i * 6));

    return infoStartY + infoLines.length * 6 + 6;
}

// Page 2 onward show ONLY the logo/hospital name/subtitle — not the report
// title or info lines, which only make sense once, up top on page 1.
// Deliberately a separate function from drawReportHeader (not the same one
// called conditionally) so a didDrawPage callback can tell them apart —
// autoTable fires didDrawPage for EVERY page a table spans, including the
// first one, so page 1 must be skipped there entirely (it was already
// drawn once by the direct drawReportHeader() call used to compute the
// table's startY) or it would draw a second, overlapping copy.
function drawMinimalReportHeader(doc, logo) {
    doc.setFont('Amiri', 'normal'); // see drawReportHeader — same reasoning
    if (logo) doc.addImage(logo, 'PNG', 90, 10, 30, 30);
    doc.setFontSize(16);
    doc.setTextColor(20);
    doc.text('Ibra Hospital', 105, 48, { align: 'center' });
    doc.setFontSize(12);
    doc.setTextColor(90);
    doc.text('Professional Development and Career Guidance', 105, 56, { align: 'center' });
    return 66;
}

function addPrintedByFooter(doc) {
    let printedByName = 'Unknown admin';
    try {
        const raw = sessionStorage.getItem('ibra_admin_session');
        const session = raw ? JSON.parse(raw) : null;
        if (session) printedByName = session.fullName || session.username || printedByName;
    } catch {
        // Falls back to the default above.
    }

    const pageCount = doc.internal.getNumberOfPages();
    const pageHeight = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150);
        doc.text(`Printed by: ${printedByName}`, 14, pageHeight - 10);
    }
}

async function getLogoBase64() {
    if (logoBase64Cache) return logoBase64Cache;
    const res = await fetch('../assets/logo.png');
    const blob = await res.blob();
    logoBase64Cache = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
    return logoBase64Cache;
}

window.generateHallActivityReportPdf = async function () {
    const note = document.getElementById('hallReportNote');
    note.textContent = 'Building report...';

    try {
        const hall = document.getElementById('hallReportHallSelect').value;
        const reservation_type = document.getElementById('hallReportTypeSelect').value;
        const fromStr = document.getElementById('hallReportFrom').value;
        const toStr = document.getElementById('hallReportTo').value;

        let query = client.from('hall_reservations').select('course_name, reservation_date, hall, reservation_type, booking_group_id, id').order('reservation_date', { ascending: true });
        if (hall) query = query.eq('hall', hall);
        if (reservation_type) query = query.eq('reservation_type', reservation_type);
        if (fromStr) query = query.gte('reservation_date', fromStr);
        if (toStr) query = query.lte('reservation_date', toStr);

        const { data, error } = await query;
        if (error) throw error;

        if (!data || data.length === 0) {
            note.textContent = 'No matching bookings in that range.';
            return;
        }

        // Count distinct bookings, not distinct rows — a 3-day booking is
        // one activity, not three, even though it has 3 date rows.
        const distinctBookings = new Set(data.map(r => r.booking_group_id || `single-${r.id}`)).size;

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        // Amiri (registered by amiri-font.js) actually contains Arabic
        // glyphs, unlike jsPDF's default fonts — and it also covers Latin
        // characters fine, so using it for the whole document is safe even
        // though most of this report's own labels are in English.
        doc.setFont('Amiri', 'normal');
        const logo = await getLogoBase64().catch(() => null);

        const hallLabel = hall || 'All Halls';
        const typeLabel = reservation_type || 'All Types';
        const periodLabel = (fromStr || toStr) ? `${fromStr || '…'} to ${toStr || '…'}` : 'All time';
        const infoLines = [`Hall: ${hallLabel}    Type: ${typeLabel}`, `Period: ${periodLabel}`];

        // Group multi-day bookings (same booking_group_id) into ONE row
        // with a From-To date range, instead of one row per day — a 3-day
        // activity should read as one line, not three repeats of the same
        // name.
        const groups = new Map();
        data.forEach(r => {
            const key = r.booking_group_id || `single-${r.id}`;
            if (!groups.has(key)) groups.set(key, { course_name: r.course_name, dates: [] });
            groups.get(key).dates.push(r.reservation_date);
        });
        const groupedRows = Array.from(groups.values()).map(g => {
            const sortedDates = g.dates.slice().sort();
            const dateLabel = sortedDates.length > 1
                ? `${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]}`
                : sortedDates[0];
            return { course_name: g.course_name, dateLabel };
        });

        doc.autoTable({
            startY: drawReportHeader(doc, logo, 'Hall Activity Report', infoLines),
            head: [['#', 'Activity Name', 'Date']],
            body: groupedRows.map((g, i) => {
                const reshaped = (typeof doc.processArabic === 'function')
                    ? doc.processArabic(g.course_name, true)
                    : reshapeArabicForPdf(g.course_name);
                return [i + 1, reshaped, g.dateLabel];
            }),
            theme: 'grid',
            headStyles: { fillColor: [124, 58, 237], font: 'Amiri' },
            bodyStyles: { font: 'Amiri' },
            styles: { font: 'Amiri' },
            didDrawPage: (data) => { if (data.pageNumber > 1) drawMinimalReportHeader(doc, logo); },
            margin: { left: 14, right: 14, top: 76 }
        });

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 14,
            head: [['', '']],
            body: [['Number of Activities', String(distinctBookings)]],
            theme: 'grid',
            showHead: false,
            styles: { fontStyle: 'bold', fillColor: [237, 233, 254], textColor: [91, 33, 182], font: 'Amiri' },
            margin: { left: 14, right: 14 }
        });

        addPrintedByFooter(doc);
        const blobUrl = doc.output('bloburl');
        const previewTab = window.open(blobUrl, '_blank');
        if (!previewTab) {
            note.innerHTML = `Your browser blocked the preview pop-up — <a href="${blobUrl}" target="_blank" rel="noopener">click here to open the report</a>.`;
        } else {
            note.textContent = '';
        }
    } catch (err) {
        console.error('Hall activity report failed:', err);
        note.textContent = 'Something went wrong: ' + err.message;
    }
};

// ============================================================================
// Department Staffing Chart (PDF) — same data/logic as the Department
// Coverage chart on the Home page (chart-dashboard.js), rendered here into
// an offscreen canvas and embedded as an image in a one-page PDF.
// ============================================================================
window.generateDepartmentChartPdf = async function () {
    const note = document.getElementById('deptChartNote');
    note.textContent = 'Building report...';
    const fromStr = document.getElementById('deptChartFrom').value;
    const toStr = document.getElementById('deptChartTo').value;

    try {
        const { data: allInsts, error: instErr } = await client
            .from('institutions')
            .select('name, staff_count');
        if (instErr) throw instErr;

        // Ibra only — same "Ibra - " name-prefix convention used
        // everywhere else in the app. Every Ibra department shows up
        // regardless of whether a staff count has been entered for it yet
        // — a missing count is treated as 0 rather than the department
        // being left out entirely, so a newly-added department appears
        // immediately without needing its staff count filled in first.
        const insts = allInsts
            .filter(i => i.name.startsWith('Ibra - '))
            .map(i => ({ name: i.name, staff_count: i.staff_count ?? 0 }));

        if (insts.length === 0) {
            note.textContent = 'No Ibra departments exist yet.';
            return;
        }
        note.textContent = 'Building report...';

        const { data: regs, error: regErr } = await client.from('registrations').select('institution_name_snapshot, staff_number, created_at');
        if (regErr) throw regErr;

        const attendedByInstitution = new Map();
        (regs || [])
            .filter(r => !(fromStr || toStr) || isWithinRange(r.created_at, fromStr, toStr))
            .forEach(r => {
                const name = (r.institution_name_snapshot || '').trim();
                if (!name || !r.staff_number) return;
                if (!attendedByInstitution.has(name)) attendedByInstitution.set(name, new Set());
                attendedByInstitution.get(name).add(r.staff_number);
            });

        const rows = insts
            .map(i => ({ name: i.name, total: i.staff_count, attended: (attendedByInstitution.get(i.name.trim()) || new Set()).size }))
            .sort((a, b) => b.total - a.total);

        const canvas = document.getElementById('deptChartOffscreen');
        // Positioned off-screen (see report.html) rather than
        // display:none, so Chart.js can still measure real layout to
        // render against without the canvas ever actually flashing
        // visible on screen while this runs.

        function renderChart(config) {
            const existing = Chart.getChart(canvas);
            if (existing) existing.destroy();
            return new Chart(canvas, config);
        }

        // Chart.js renders synchronously with animation:false, but give the
        // browser one paint frame before reading the canvas back out.
        async function captureChartImage(config) {
            renderChart(config);
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            return canvas.toDataURL('image/png');
        }

        const countsImage = await captureChartImage({
            type: 'bar',
            data: {
                labels: rows.map(r => r.name),
                datasets: [
                    { label: 'Total Staff', data: rows.map(r => r.total), backgroundColor: '#DDD6FE' },
                    { label: 'Attendance', data: rows.map(r => r.attended), backgroundColor: '#7C3AED' }
                ]
            },
            options: {
                responsive: false, animation: false,
                plugins: { legend: { position: 'bottom' }, title: { display: true, text: 'Number of Staff per Department — Ibra Hospital' } },
                // With many departments, letting labels overlap horizontally
                // (Chart.js's default) is what made this look "messy" —
                // forcing a fixed rotation keeps every label readable
                // instead of them fighting for the same horizontal space.
                scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 60 } } }
            }
        });

        // Coverage percentage — the same data, expressed as a share of each
        // department's own staff rather than raw counts. attended can
        // exceed total if someone's institution snapshot doesn't perfectly
        // match staff_count's source list (a real possibility since the two
        // come from different admin actions) — capped at 100% for display
        // rather than showing a confusing >100%.
        const percentRows = rows.map(r => ({ name: r.name, pct: r.total > 0 ? Math.min(100, Math.round((r.attended / r.total) * 100)) : 0 }));
        const percentImage = await captureChartImage({
            type: 'bar',
            data: {
                labels: percentRows.map(r => r.name),
                datasets: [{ label: '% of Staff Who Attended', data: percentRows.map(r => r.pct), backgroundColor: '#10B981' }]
            },
            options: {
                responsive: false, animation: false,
                plugins: { legend: { display: false }, title: { display: true, text: 'Workshop Attendance Coverage (%) per Department' } },
                scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } }, x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 60 } } }
            }
        });

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const logo = await getLogoBase64().catch(() => null);
        const generatedLine = [`Generated: ${new Date().toLocaleString()}`];
        if (fromStr || toStr) generatedLine.push(`Period: ${fromStr ? formatDateDDMMYYYY(fromStr) : 'Start'} – ${toStr ? formatDateDDMMYYYY(toStr) : 'Present'}`);

        const page1ImageY = drawReportHeader(doc, logo, 'Ibra Department Staffing Report', generatedLine);
        doc.addImage(countsImage, 'PNG', 14, page1ImageY, 182, 101);

        doc.addPage();
        const page2Y = drawMinimalReportHeader(doc, logo);
        doc.setFontSize(13);
        doc.setTextColor(20);
        doc.text('Attendance Coverage', 14, page2Y);
        doc.addImage(percentImage, 'PNG', 14, page2Y + 8, 182, 101);

        doc.autoTable({
            startY: page2Y + 8 + 101 + 10,
            head: [['#', 'Department', 'Total Staff', 'Attended', 'Coverage']],
            body: percentRows.map((p, i) => [i + 1, reshapeArabicForPdf(rows[i].name), String(rows[i].total), String(rows[i].attended), `${p.pct}%`]),
            theme: 'grid',
            styles: { font: 'Amiri' },
            headStyles: { fillColor: [124, 58, 237], font: 'Amiri' },
            bodyStyles: { font: 'Amiri' },
            // Every page from here on (page 3+) gets the minimal header too
            // — data.pageNumber is absolute, and page 1/2 are already drawn
            // directly above, not through this callback.
            didDrawPage: (data) => { if (data.pageNumber > 2) drawMinimalReportHeader(doc, logo); },
            margin: { left: 14, right: 14, top: 66 }
        });

        // Defensive re-pass: draws the minimal header on any page from 3
        // onward that still doesn't have it. autoTable's own didDrawPage
        // above should already cover this, but re-checking directly against
        // the actual page count here guarantees it regardless of any
        // library-specific timing quirk on exactly which page a callback
        // fires for — same reasoning as addPrintedByFooter() below already
        // re-walking every page rather than trusting a single pass.
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 3; i <= totalPages; i++) {
            doc.setPage(i);
            drawMinimalReportHeader(doc, logo);
        }

        addPrintedByFooter(doc);
        const blobUrl = doc.output('bloburl');
        const previewTab = window.open(blobUrl, '_blank');
        if (!previewTab) {
            note.innerHTML = `Your browser blocked the preview pop-up — <a href="${blobUrl}" target="_blank" rel="noopener">click here to open the report</a>.`;
        } else {
            note.textContent = '';
        }
    } catch (err) {
        console.error('Department chart PDF failed:', err);
        note.textContent = 'Something went wrong: ' + err.message;
    }
};

// Health Center Institution Report (PDF) — chart + table of workshop
// attendance per Health Center institution ("Ibra - " prefix absent, same
// convention used everywhere else). Deliberately simpler than the Ibra
// Department chart above — this is attendance-only, no staff-count
// comparison or coverage percentage, since that's specifically what was
// asked for here.
window.generateHealthCenterAttendancePdf = async function () {
    const note = document.getElementById('healthCenterChartNote');
    note.textContent = 'Building report...';
    const fromStr = document.getElementById('healthCenterChartFrom').value;
    const toStr = document.getElementById('healthCenterChartTo').value;

    try {
        const { data: allInsts, error: instErr } = await client.from('institutions').select('name');
        if (instErr) throw instErr;

        const insts = allInsts.filter(i => !i.name.startsWith('Ibra - '));
        if (insts.length === 0) {
            note.textContent = 'No Health Center institutions exist yet.';
            return;
        }

        const { data: regs, error: regErr } = await client.from('registrations').select('institution_name_snapshot, staff_number, created_at');
        if (regErr) throw regErr;

        const attendedByInstitution = new Map();
        (regs || [])
            .filter(r => !(fromStr || toStr) || isWithinRange(r.created_at, fromStr, toStr))
            .forEach(r => {
                const name = (r.institution_name_snapshot || '').trim();
                if (!name || !r.staff_number) return;
                if (!attendedByInstitution.has(name)) attendedByInstitution.set(name, new Set());
                attendedByInstitution.get(name).add(r.staff_number);
            });

        // "Other (Please Specify)" is the real seeded institution row's
        // exact name (other matching logic elsewhere relies on that exact
        // string) — only the DISPLAY name is shortened to "Other" here,
        // and it's sorted to the end regardless of its attendance count,
        // since it's a catch-all rather than a specific institution.
        const OTHER_CATCHALL = 'Other (Please Specify)';
        const rows = insts
            .map(i => ({
                name: i.name === OTHER_CATCHALL ? 'Other' : i.name,
                isCatchAll: i.name === OTHER_CATCHALL,
                attended: (attendedByInstitution.get(i.name.trim()) || new Set()).size
            }))
            .sort((a, b) => {
                if (a.isCatchAll !== b.isCatchAll) return a.isCatchAll ? 1 : -1;
                return b.attended - a.attended;
            });

        const canvas = document.getElementById('healthCenterChartOffscreen');
        // Positioned off-screen (see report.html) rather than
        // display:none, so Chart.js can measure real layout without ever
        // flashing visible on screen.

        const existing = Chart.getChart(canvas);
        if (existing) existing.destroy();
        new Chart(canvas, {
            type: 'bar',
            data: {
                labels: rows.map(r => r.name),
                datasets: [{ label: 'Attendance', data: rows.map(r => r.attended), backgroundColor: '#10B981' }]
            },
            options: {
                responsive: false, animation: false,
                plugins: { legend: { display: false }, title: { display: true, text: 'Attendance per Health Center Institution' } },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 60 } }
                }
            }
        });
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const chartImage = canvas.toDataURL('image/png');

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const logo = await getLogoBase64().catch(() => null);
        const generatedLine = [`Generated: ${new Date().toLocaleString()}`];
        if (fromStr || toStr) generatedLine.push(`Period: ${fromStr ? formatDateDDMMYYYY(fromStr) : 'Start'} – ${toStr ? formatDateDDMMYYYY(toStr) : 'Present'}`);

        const imageY = drawReportHeader(doc, logo, 'Health Center Institution Report', generatedLine);
        doc.addImage(chartImage, 'PNG', 14, imageY, 182, 101);

        doc.autoTable({
            startY: imageY + 101 + 10,
            head: [['#', 'Health Center', 'Attended']],
            body: rows.map((r, i) => [i + 1, reshapeArabicForPdf(r.name), String(r.attended)]),
            theme: 'grid',
            styles: { font: 'Amiri' },
            headStyles: { fillColor: [16, 185, 129], font: 'Amiri' },
            bodyStyles: { font: 'Amiri' },
            // Repeats the logo/title header on every page this report
            // spans, not just the first — didDrawPage fires once per page,
            // including subsequent ones (page 1 itself is already drawn
            // directly above via drawReportHeader, so only page 2+ needs
            // this callback to draw anything).
            didDrawPage: (data) => { if (data.pageNumber > 1) drawMinimalReportHeader(doc, logo); },
            margin: { left: 14, right: 14, top: 66 }
        });

        addPrintedByFooter(doc);
        const blobUrl = doc.output('bloburl');
        const previewTab = window.open(blobUrl, '_blank');
        if (!previewTab) {
            note.innerHTML = `Your browser blocked the preview pop-up — <a href="${blobUrl}" target="_blank" rel="noopener">click here to open the report</a>.`;
        } else {
            note.textContent = '';
        }
    } catch (err) {
        console.error('Health Center attendance PDF failed:', err);
        note.textContent = 'Something went wrong: ' + err.message;
    }
};

// Courses per Department (PDF) — counts DISTINCT (department, date) pairs,
// not raw log entries. If two different people (or the same person twice)
// log an entry for the same department on the same date, that's still just
// one course taken that day for that department — logging the same session
// twice must not double the count. Grouped by each participant's CURRENT
// department (institution_name_snapshot on their registration), same
// convention as every other Ibra-department report in this file.
window.generateCoursesPerDepartmentPdf = async function () {
    const note = document.getElementById('coursesDeptChartNote');
    note.textContent = 'Building report...';
    const fromStr = document.getElementById('coursesDeptChartFrom').value;
    const toStr = document.getElementById('coursesDeptChartTo').value;

    try {
        const { data: regs, error: regErr } = await client
            .from('registrations')
            .select('id, institution_name_snapshot, department_chosen_via_log')
            .like('institution_name_snapshot', 'Ibra - %');
        if (regErr) throw regErr;

        // Only registrations where the department was actually confirmed
        // THROUGH the Activity Log's own "choose department" step count
        // here — not just whatever department happened to be set at
        // original registration, which every Ibra registration already
        // has regardless of whether anyone has been through that step at
        // all. Correctly shows 0 everywhere until someone actually has.
        const deptByRegId = new Map(
            (regs || [])
                .filter(r => r.department_chosen_via_log)
                .map(r => [r.id, r.institution_name_snapshot.replace('Ibra - ', '')])
        );

        // Same pagination reasoning applied elsewhere in this app already
        // (registrations, students) — an unbounded query silently
        // truncates at Supabase's default row limit as a table grows.
        // entry_date_from (the session's own start date, not created_at) is
        // what the From/To period filters against — that's what "when was
        // this course actually taken" means for this report.
        const PAGE_SIZE = 1000;
        let entries = [];
        let from = 0;
        while (true) {
            const { data: page, error: entriesErr } = await client
                .from('activity_log_entries')
                .select('registration_id, title, entry_date_from, department')
                .range(from, from + PAGE_SIZE - 1);
            if (entriesErr) throw entriesErr;
            if (!page || page.length === 0) break;
            entries = entries.concat(page);
            if (page.length < PAGE_SIZE) break;
            from += PAGE_SIZE;
        }
        if (fromStr || toStr) {
            entries = entries.filter(e => isWithinRange(e.entry_date_from, fromStr, toStr));
        }

        const { data: allInsts, error: instErr } = await client.from('institutions').select('name');
        if (instErr) throw instErr;
        const allDepts = (allInsts || []).filter(i => i.name.startsWith('Ibra - ')).map(i => i.name.replace('Ibra - ', ''));
        if (allDepts.length === 0) {
            note.textContent = 'No Ibra departments exist yet.';
            return;
        }

        // Dedup key is (department, date) — not per-entry, not per-person.
        // Two log entries for the same department on the same date (whether
        // from the same participant logging twice or two different
        // participants) collapse into a single counted course for that day.
        const seenDeptDate = new Set();
        const countByDept = new Map();
        (entries || []).forEach(e => {
            // Each entry's OWN department (set when it was logged, and
            // correctable per-entry from Participant Registrations -> Edit
            // Activity Log -- see js/students.js) always wins when present,
            // since that's the whole point of letting an admin correct it.
            // Only falls back to the registration's current department for
            // older entries logged before this per-entry field existed.
            const dept = e.department || deptByRegId.get(e.registration_id);
            if (!dept) return; // logged entry belongs to a registration outside Ibra departments, or one where the department was never confirmed through Activity Log -- not counted here
            const key = `${dept}|${e.entry_date_from}`;
            if (seenDeptDate.has(key)) return;
            seenDeptDate.add(key);
            countByDept.set(dept, (countByDept.get(dept) || 0) + 1);
        });

        // Every Ibra department shows up, including ones with zero courses
        // logged yet -- same "show everything, don't silently omit"
        // approach used by the other reports in this file. Sourced from
        // the full institutions list, not from deptByRegId, since that
        // map can legitimately be empty (nobody has confirmed a
        // department through Activity Log yet) while departments
        // themselves still exist and should still show up at 0.
        const rows = allDepts
            .map(dept => ({ dept, count: countByDept.get(dept) || 0 }))
            .sort((a, b) => b.count - a.count);

        const canvas = document.getElementById('coursesDeptChartOffscreen');
        const existing = Chart.getChart(canvas);
        if (existing) existing.destroy();
        new Chart(canvas, {
            type: 'bar',
            data: {
                labels: rows.map(r => r.dept),
                datasets: [{ label: 'Courses Taken', data: rows.map(r => r.count), backgroundColor: '#7C3AED' }]
            },
            options: {
                responsive: false, animation: false,
                plugins: { legend: { display: false }, title: { display: true, text: 'Courses Taken per Department' } },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } },
                    x: { ticks: { autoSkip: false, maxRotation: 60, minRotation: 60 } }
                }
            }
        });
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const chartImage = canvas.toDataURL('image/png');

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const logo = await getLogoBase64().catch(() => null);
        const generatedLine = [`Generated: ${new Date().toLocaleString()}`];
        if (fromStr || toStr) generatedLine.push(`Period: ${fromStr ? formatDateDDMMYYYY(fromStr) : 'Start'} – ${toStr ? formatDateDDMMYYYY(toStr) : 'Present'}`);

        const imageY = drawReportHeader(doc, logo, 'Activity Log: Courses per Department Report', generatedLine);
        doc.addImage(chartImage, 'PNG', 14, imageY, 182, 101);

        const totalCourses = rows.reduce((sum, r) => sum + r.count, 0);
        doc.autoTable({
            startY: imageY + 101 + 10,
            head: [['#', 'Department', 'Number of Courses']],
            body: rows.map((r, i) => [i + 1, reshapeArabicForPdf(r.dept), String(r.count)]),
            theme: 'grid',
            styles: { font: 'Amiri' },
            headStyles: { fillColor: [124, 58, 237], font: 'Amiri' },
            bodyStyles: { font: 'Amiri' },
            foot: [[{ content: 'Total', colSpan: 2, styles: { fontStyle: 'bold', font: 'Amiri' } }, { content: String(totalCourses), styles: { fontStyle: 'bold', font: 'Amiri' } }]],
            footStyles: { fillColor: [237, 233, 254], textColor: [91, 33, 182], font: 'Amiri' },
            // Without this, autoTable's default repeats the foot row on
            // EVERY page a table spans — only wanted once, at the very end.
            showFoot: 'lastPage',
            didDrawPage: (data) => { if (data.pageNumber > 1) drawMinimalReportHeader(doc, logo); },
            margin: { left: 14, right: 14, top: 66 }
        });

        addPrintedByFooter(doc);
        const blobUrl = doc.output('bloburl');
        const previewTab = window.open(blobUrl, '_blank');
        if (!previewTab) {
            note.innerHTML = `Your browser blocked the preview pop-up — <a href="${blobUrl}" target="_blank" rel="noopener">click here to open the report</a>.`;
        } else {
            note.textContent = '';
        }
    } catch (err) {
        console.error('Courses per department PDF failed:', err);
        note.textContent = 'Something went wrong: ' + err.message;
    }
};

// ============================================================================
// Evaluation / Exam Report (PDF) — pick one evaluation/exam, get a chart per
// question (shaped to that question's own type) followed by a full table of
// every submitted answer. Mirrors the data-loading shape already used by
// evaluations-dashboard.js's buildAndDownloadReport (same three tables:
// activity_evaluation_questions / _responses / _answers), just rendered as
// charts + a PDF instead of a flat Excel sheet.
// ============================================================================

// Purple-based palette for the whole report — several distinguishable
// purple/violet shades for chart series instead of the old mixed
// blue/green/orange/red set, plus the named colors used for cards, badges,
// table styling and typography throughout this file. RGB triplets are kept
// alongside the hex strings since jsPDF's setFillColor/setTextColor/etc.
// take (r, g, b), while Chart.js takes CSS hex strings.
// Chart data colors are a distinguishable multi-color set (purple stays the
// brand/UI accent — cards, badges, table header below — but a chart with
// several categories in one purple shade was hard to read, so each answer
// category now gets its own clearly different color).
// Order requested: purple, green, blue, orange, turquoise, then the rest.
const EVAL_CHART_PALETTE = ['#6C5CE7', '#22C55E', '#3B82F6', '#F59E0B', '#14B8A6', '#EF4444', '#EC4899', '#6366F1', '#06B6D4'];
// Pixels-per-mm used to size each chart's offscreen canvas to match the mm
// box it will be placed into in the PDF (see captureChartImage below) —
// roughly the resolution the previous fixed 1200x650 canvas rendered at.
const EVAL_CHART_PX_PER_MM = 7;
const EVAL_COLORS = {
    primary: [109, 74, 255],       // #6D4AFF
    dark: [75, 46, 131],           // #4B2E83
    light: [241, 237, 255],        // #F1EDFF
    bg: [250, 249, 255],           // #FAF9FF
    text: [37, 35, 58],            // #25233A
    textSecondary: [107, 104, 128],// #6B6880
    border: [229, 225, 242],       // #E5E1F2
    white: [255, 255, 255]
};

// Small rounded pill badge (used for the question-type label and the
// per-question response count) — measures its own text so the badge always
// hugs the text instead of being a fixed guessed width. Returns the width
// actually used, so the caller can place a second badge right after it.
function drawEvalBadge(doc, text, x, y, opts) {
    opts = opts || {};
    const fontSize = opts.fontSize || 8;
    const height = opts.height || 5.5;
    const paddingX = 3;
    doc.setFont('Amiri', 'normal');
    doc.setFontSize(fontSize);
    const width = doc.getTextWidth(text) + paddingX * 2;
    const bg = opts.bg || EVAL_COLORS.light;
    const textColor = opts.textColor || EVAL_COLORS.dark;
    doc.setFillColor(bg[0], bg[1], bg[2]);
    doc.roundedRect(x, y, width, height, height / 2, height / 2, 'F');
    doc.setTextColor(textColor[0], textColor[1], textColor[2]);
    doc.text(text, x + paddingX, y + height / 2 + fontSize * 0.16 + 0.6);
    return width;
}

// The light card background + border drawn behind each question block.
function drawEvalCard(doc, x, y, width, height) {
    doc.setFillColor(EVAL_COLORS.white[0], EVAL_COLORS.white[1], EVAL_COLORS.white[2]);
    doc.setDrawColor(EVAL_COLORS.border[0], EVAL_COLORS.border[1], EVAL_COLORS.border[2]);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, width, height, 3, 3, 'FD');
}

// Static percentage labels on each pie slice — a chart captured to a PNG
// for the PDF has no hover/tooltip, so the percentage has to be drawn
// directly onto the slice itself instead of relying on Chart.js's
// (hover-only) tooltip. Every non-zero slice gets a label, including small
// ones — a smaller font is used once a slice is small so a tiny sliver's
// number doesn't visually overflow onto its neighbors as badly.
const evalPiePercentagePlugin = {
    id: 'evalPiePercentageLabels',
    afterDraw(chart) {
        const meta = chart.getDatasetMeta(0);
        const dataset = chart.data.datasets[0];
        if (!meta || !dataset) return;
        const total = dataset.data.reduce((a, b) => a + b, 0);
        if (!total) return;
        const ctx = chart.ctx;
        meta.data.forEach((arc, i) => {
            const value = dataset.data[i];
            if (!value) return;
            const pct = Math.round((value / total) * 100);
            ctx.save();
            ctx.font = `700 ${pct < 5 ? 14 : 20}px Arial`;
            ctx.fillStyle = '#FFFFFF';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const pos = arc.tooltipPosition();
            ctx.fillText(pct + '%', pos.x, pos.y);
            ctx.restore();
        });
    }
};

// Value count (+ percentage, when the dataset carries a totalRespondents)
// drawn at the end of each horizontal bar (Checkbox chart) — same reasoning
// as the pie percentages above: no hover in a static PNG.
const evalBarValuePlugin = {
    id: 'evalBarValueLabels',
    afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        chart.data.datasets.forEach((dataset, dsIndex) => {
            const meta = chart.getDatasetMeta(dsIndex);
            const total = dataset.totalRespondents;
            meta.data.forEach((bar, i) => {
                const value = dataset.data[i];
                if (value === null || value === undefined) return;
                const label = total
                    ? `${value} (${Math.round((value / total) * 100)}%)`
                    : String(value);
                ctx.save();
                ctx.font = '700 18px Arial';
                ctx.fillStyle = '#4B2E83';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                ctx.fillText(label, bar.x + 10, bar.y);
                ctx.restore();
            });
        });
    }
};

// Percentage label drawn inside each colored segment of the horizontal
// stacked bar (Multiple Choice Grid / Checkbox Grid chart) — the percentage
// is of that segment's OWN ROW total (i.e. "what share of responses to this
// grid question picked this column"), not of the whole chart. Same static-
// label reasoning as the pie/bar plugins above: a captured PNG has no hover.
const evalStackedBarPercentagePlugin = {
    id: 'evalStackedBarPercentageLabels',
    afterDatasetsDraw(chart) {
        const ctx = chart.ctx;
        const datasets = chart.data.datasets;
        const rowCount = chart.data.labels.length;
        // Row totals across all datasets (segments), one per row/category.
        const rowTotals = new Array(rowCount).fill(0);
        datasets.forEach(dataset => {
            dataset.data.forEach((value, i) => {
                rowTotals[i] += Number(value) || 0;
            });
        });
        datasets.forEach((dataset, dsIndex) => {
            const meta = chart.getDatasetMeta(dsIndex);
            meta.data.forEach((segment, i) => {
                const value = Number(dataset.data[i]) || 0;
                if (!value || !rowTotals[i]) return;
                const pct = Math.round((value / rowTotals[i]) * 100);
                // Every non-zero segment gets a label, including small
                // ones — a smaller font for a tiny segment keeps the text
                // from overflowing its neighbors as much.
                const props = segment.getProps ? segment.getProps(['x', 'y', 'base', 'width'], true) : segment;
                const centerX = (props.x + props.base) / 2;
                ctx.save();
                ctx.font = `700 ${pct < 8 ? 11 : 16}px Arial`;
                ctx.fillStyle = '#FFFFFF';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(pct + '%', centerX, props.y);
                ctx.restore();
            });
        });
    }
};

// Same value-shape handling as evaluations-dashboard.js's formatAnswer — a
// plain string for Text/Date/Time/List/Multiple Choice, an array for
// Checkbox, or a row->answer map for the two grid types. Returns an ARRAY
// of lines (used by the answers table below): a question with only one
// answer is a single plain line; a question with several answers (several
// ticked checkboxes, or a grid's several rows) becomes one "• " bullet
// line per answer, all inside that same question's Answer cell.
function buildEvalAnswerLines(value) {
    if (Array.isArray(value)) {
        const items = value.filter(v => v !== null && v !== undefined && v !== '');
        if (items.length > 1) return items.map(v => `• ${v}`);
        return [items[0] || ''];
    }
    if (value && typeof value === 'object') {
        const items = Object.entries(value).map(([row, ans]) => `${row}: ${Array.isArray(ans) ? ans.join(', ') : ans}`);
        return items.length ? items.map(t => `• ${t}`) : [''];
    }
    return [value === null || value === undefined ? '' : String(value)];
}

// Tallies raw answer values against a question's own defined option list
// (so an option nobody picked still shows up as 0 instead of vanishing from
// the chart) while still picking up any value that isn't one of the defined
// options (falls back to whatever values actually occur).
function tallyEvalOptions(values, definedOptions) {
    const counts = new Map();
    (Array.isArray(definedOptions) && definedOptions.length ? definedOptions : [...new Set(values)]).forEach(o => counts.set(o, 0));
    values.forEach(v => {
        if (v === null || v === undefined || v === '') return;
        counts.set(v, (counts.get(v) || 0) + 1);
    });
    return counts;
}

// Chart.js category-axis ticks don't wrap long text on their own, and the
// alternative — shrinking the font or rotating the text — makes long Arabic
// question/option labels hard to read. Instead, a long label is split into
// several lines up front and handed to Chart.js as an array (each array
// item renders as its own line), so it wraps instead of truncating,
// shrinking, or rotating.
function wrapChartLabel(text, maxChars) {
    const words = String(text == null ? '' : text).split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    const lines = [];
    let current = '';
    words.forEach(w => {
        const candidate = current ? current + ' ' + w : w;
        if (candidate.length > maxChars && current) {
            lines.push(current);
            current = w;
        } else {
            current = candidate;
        }
    });
    if (current) lines.push(current);
    return lines;
}

// Builds a Chart.js config matched to the question's own type, or null for
// question types that don't chart meaningfully (Text/Date/Time — those are
// covered by the full answers table at the end instead).
function buildEvalQuestionChartConfig(question, answerValues) {
    const type = question.question_type;
    const options = Array.isArray(question.options) ? question.options : [];

    if (type === 'multiple_choice' || type === 'list') {
        const counts = tallyEvalOptions(answerValues, options);
        // Raw (un-reshaped) labels are what the counts map is keyed by —
        // reshaping is only for what actually gets drawn on the canvas.
        const labels = [...counts.keys()];
        const displayLabels = labels.map(l => reshapeArabicForPdf(l));
        return {
            type: 'pie',
            data: {
                labels: displayLabels,
                datasets: [{
                    data: labels.map(l => counts.get(l)),
                    backgroundColor: labels.map((_, i) => EVAL_CHART_PALETTE[i % EVAL_CHART_PALETTE.length]),
                    borderColor: '#FFFFFF', borderWidth: 2, hoverOffset: 6
                }]
            },
            options: {
                responsive: false, animation: false,
                // Legend moved below the pie (rather than a cramped right-
                // hand column) so the larger, more readable text has the
                // chart's full width to wrap across — it drops to a new
                // row on its own once a row of items runs out of room.
                plugins: {
                    legend: { position: 'bottom', labels: { boxWidth: 14, boxHeight: 14, padding: 14, font: { size: 14 }, color: '#25233A' } }
                }
            },
            plugins: [evalPiePercentagePlugin]
        };
    }

    if (type === 'checkbox') {
        // A respondent can tick more than one box, so counts here can add
        // up to more than the number of respondents — that's expected for
        // this question type, unlike Multiple Choice above. The percentage
        // drawn on each bar is still meaningful though: it's this option's
        // share of respondents who answered the question at all (so it can
        // legitimately add up to more than 100% across all bars combined).
        const flatValues = answerValues.flat();
        const counts = tallyEvalOptions(flatValues, options);
        const labels = [...counts.keys()];
        const totalRespondents = answerValues.filter(v => Array.isArray(v) ? v.length > 0 : !!v).length;
        return {
            type: 'bar',
            data: {
                labels: labels.map(l => wrapChartLabel(reshapeArabicForPdf(l), 26)),
                datasets: [{
                    label: 'Responses',
                    data: labels.map(l => counts.get(l)),
                    totalRespondents,
                    backgroundColor: labels.map((_, i) => EVAL_CHART_PALETTE[i % EVAL_CHART_PALETTE.length]),
                    borderRadius: 6, borderSkipped: false,
                    maxBarThickness: 32, categoryPercentage: 0.65, barPercentage: 0.75
                }]
            },
            options: {
                responsive: false, animation: false,
                indexAxis: 'y',
                layout: { padding: { right: 46 } }, // room for the "count (pct%)" label past the end of the longest bar
                plugins: { legend: { display: false } },
                scales: {
                    x: { beginAtZero: true, ticks: { precision: 0, color: '#6B6880', font: { size: 13 } }, grid: { color: '#E5E1F2' } },
                    // autoSkip/rotation off: with wrapped multi-line labels
                    // above, every option stays fully readable, horizontal
                    y: { ticks: { color: '#25233A', font: { size: 13 }, autoSkip: false, maxRotation: 0, minRotation: 0 }, grid: { display: false } }
                }
            },
            plugins: [evalBarValuePlugin]
        };
    }

    if (type === 'multiple_choice_grid' || type === 'checkbox_grid') {
        const rows = Array.isArray(question.grid_rows) ? question.grid_rows : [];
        const cols = Array.isArray(question.grid_columns) ? question.grid_columns : [];
        const countsByRowCol = new Map();
        rows.forEach(r => countsByRowCol.set(r, new Map(cols.map(c => [c, 0]))));
        answerValues.forEach(obj => {
            if (!obj || typeof obj !== 'object') return;
            Object.entries(obj).forEach(([row, val]) => {
                if (!countsByRowCol.has(row)) countsByRowCol.set(row, new Map());
                const rowMap = countsByRowCol.get(row);
                (Array.isArray(val) ? val : [val]).forEach(v => {
                    if (!v) return;
                    rowMap.set(v, (rowMap.get(v) || 0) + 1);
                });
            });
        });
        // A value that doesn't match any of the question's defined columns
        // (e.g. the "No Answer" placeholder used for responses whose real
        // answer was lost — see sql/repair-orphaned-evaluation-answers.sql's
        // history) still gets tallied into countsByRowCol above, but was
        // previously invisible: the dataset loop below only ever drew a bar
        // segment per DEFINED column, so that count just silently vanished
        // from the chart. Collecting those extra values here and appending
        // them as their own column (distinct grey, not part of the palette
        // used for real rating options) makes them show up honestly instead
        // of making the chart look emptier than it should.
        const extraCols = [];
        countsByRowCol.forEach(rowMap => {
            rowMap.forEach((_, col) => {
                if (!cols.includes(col) && !extraCols.includes(col)) extraCols.push(col);
            });
        });
        const allCols = [...cols, ...extraCols];
        // True horizontal stacked bar: each grid QUESTION (row) is a
        // category on the Y axis, and its bar is split into colored
        // segments — one per response option — running along the X axis.
        // (Previously this was a vertical stacked bar with the questions
        // crammed along the bottom axis, which is what made the labels
        // hard to read.)
        return {
            type: 'bar',
            data: {
                labels: rows.map(r => wrapChartLabel(reshapeArabicForPdf(r), 30)),
                // countsByRowCol below is still keyed by the RAW row/col
                // strings (that's what the data came in tallied by) —
                // only the label/legend TEXT that actually gets drawn is
                // reshaped, the lookups stay on the original strings.
                datasets: allCols.map((col, i) => ({
                    label: reshapeArabicForPdf(col),
                    data: rows.map(r => countsByRowCol.get(r)?.get(col) || 0),
                    backgroundColor: i < cols.length ? EVAL_CHART_PALETTE[i % EVAL_CHART_PALETTE.length] : '#B5B2C4',
                    borderRadius: 3, borderSkipped: false,
                    maxBarThickness: 32, categoryPercentage: 0.72, barPercentage: 0.82
                }))
            },
            options: {
                responsive: false, animation: false,
                indexAxis: 'y',
                // Legend above the chart, in its own clearly separated
                // area, rather than squeezed underneath — it wraps onto
                // as many rows as it needs at this larger, readable size.
                plugins: {
                    legend: { position: 'top', align: 'start', labels: { boxWidth: 14, boxHeight: 14, padding: 14, font: { size: 14 }, color: '#25233A' } }
                },
                scales: {
                    x: { stacked: true, beginAtZero: true, ticks: { precision: 0, color: '#6B6880', font: { size: 12 } }, grid: { color: '#E5E1F2' } },
                    // No rotation/skip/truncation for the question labels —
                    // they're pre-wrapped onto multiple lines above instead.
                    y: { stacked: true, ticks: { autoSkip: false, maxRotation: 0, minRotation: 0, color: '#25233A', font: { size: 13 } }, grid: { display: false } }
                }
            },
            plugins: [evalStackedBarPercentagePlugin]
        };
    }

    return null; // Text / Date / Time — no meaningful chart, see the answers table instead
}

const QUESTION_TYPE_LABEL = {
    multiple_choice: 'Multiple Choice', checkbox: 'Checkbox', list: 'Dropdown List',
    text: 'Text', date: 'Date', time: 'Time',
    multiple_choice_grid: 'Multiple Choice Grid', checkbox_grid: 'Checkbox Grid'
};

window.generateEvaluationReportPdf = async function () {
    const note = document.getElementById('evalReportNote');
    const evaluationId = document.getElementById('evalReportSelect').value;
    if (!evaluationId) {
        note.textContent = 'Please choose an Evaluation / Exam first.';
        return;
    }
    note.textContent = 'Building report...';

    try {
        const [{ data: evalRow, error: evalErr }, { data: questions, error: qErr }, { data: responses, error: rErr }] = await Promise.all([
            client.from('activity_evaluations').select('id, title, courses(name)').eq('id', evaluationId).single(),
            client.from('activity_evaluation_questions').select('id, question_type, question_text, options, grid_rows, grid_columns, display_order').eq('evaluation_id', evaluationId).order('display_order', { ascending: true }),
            client.from('activity_evaluation_responses').select('id, staff_number, staff_name, submitted_at').eq('evaluation_id', evaluationId)
        ]);
        if (evalErr) throw evalErr;
        if (qErr) throw qErr;
        if (rErr) throw rErr;

        if (!responses || responses.length === 0) {
            note.textContent = `No submitted answers yet for "${evalRow.title}".`;
            return;
        }

        const responseIds = responses.map(r => r.id);
        const { data: answers, error: aErr } = await client
            .from('activity_evaluation_answers')
            .select('response_id, question_id, answer_value')
            .in('response_id', responseIds);
        if (aErr) throw aErr;

        const responseById = new Map(responses.map(r => [r.id, r]));
        const answersByQuestion = new Map();
        (answers || []).forEach(a => {
            if (!answersByQuestion.has(a.question_id)) answersByQuestion.set(a.question_id, []);
            answersByQuestion.get(a.question_id).push(a.answer_value);
        });

        const canvas = document.getElementById('evalReportChartOffscreen');
        function renderChart(config) {
            const existing = Chart.getChart(canvas);
            if (existing) existing.destroy();
            return new Chart(canvas, config);
        }
        // pxWidth/pxHeight let each chart render at a resolution that
        // matches the mm box it will actually be placed into (computed in
        // the loop below) instead of always the same fixed canvas size —
        // that's what keeps a tall grid chart with many rows from having
        // its bars/legend squashed into too few pixels, without stretching
        // a short chart's image and going soft.
        async function captureChartImage(config, pxWidth, pxHeight) {
            if (pxWidth && pxHeight) {
                canvas.width = pxWidth;
                canvas.height = pxHeight;
            }
            renderChart(config);
            await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
            return canvas.toDataURL('image/png');
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const logo = await getLogoBase64().catch(() => null);
        const infoLines = [
            `Activity: ${evalRow.courses ? evalRow.courses.name : 'Deleted Activity'}`,
            `Generated: ${new Date().toLocaleString()}`,
            `Total Responses: ${responses.length}`
        ];

        let y = drawReportHeader(doc, logo, evalRow.title, infoLines);
        const pageBottom = 282;
        // Each question is now its own card: a light bordered rounded box
        // (see drawEvalCard) containing the question title, a small purple
        // type badge + a response-count badge, and a compact, appropriately-
        // sized chart — instead of the previous plain text + one big
        // full-width chart. Card width matches the page's 182mm content
        // area (14mm margins on a 210mm A4 page); cardPadding is the
        // breathing room inside that box on every side.
        const cardX = 14;
        const cardWidth = 182;
        const cardPadding = 7;
        const cardGap = 6;
        const titleLineHeight = 5.6;

        for (let i = 0; i < (questions || []).length; i++) {
            const q = questions[i];
            const answerValues = answersByQuestion.get(q.id) || [];
            const chartConfig = buildEvalQuestionChartConfig(q, answerValues);
            // Same "how many of this question's answers are non-empty"
            // count the free-text fallback always used — just also shown as
            // a badge for every question type now, not only Text/Date/Time.
            const responseCount = answerValues.filter(v => v !== null && v !== undefined && v !== '').length;
            const isPie = !!chartConfig && chartConfig.type === 'pie';

            doc.setFont('Amiri', 'normal');
            doc.setFontSize(12.5);
            const questionLines = doc.splitTextToSize(`${i + 1}. ${reshapeArabicForPdf(q.question_text)}`, cardWidth - cardPadding * 2);
            const titleBlockHeight = questionLines.length * titleLineHeight;
            const badgeRowHeight = 8;

            // Chart area height — capped so a question with many options/
            // rows never balloons into a giant chart, but still grows for
            // questions that genuinely have more to show (more legend
            // items to wrap, more grid rows to stack).
            let chartAreaHeight;
            let pieWidth = 105;
            if (!chartConfig) {
                chartAreaHeight = 7; // just the free-text note line
            } else if (isPie) {
                const optionCount = (chartConfig.data.labels || []).length;
                const legendRows = Math.max(1, Math.ceil(optionCount / 2));
                chartAreaHeight = 62 + legendRows * 7.5; // pie itself + wrapped legend below it
            } else if (q.question_type === 'checkbox') {
                const optionCount = (chartConfig.data.labels || []).length;
                chartAreaHeight = Math.min(110, Math.max(46, optionCount * 12 + 20));
            } else {
                // Grid types (horizontal stacked bar): height grows with
                // both the number of question rows and the legend, which
                // now sits above the chart in its own separated area.
                const rowCount = (chartConfig.data.labels || []).length;
                const legendCount = (chartConfig.data.datasets || []).length;
                const legendRows = Math.max(1, Math.ceil(legendCount / 3));
                chartAreaHeight = Math.min(140, Math.max(58, rowCount * 13 + 24 + legendRows * 8));
            }

            const cardContentHeight = titleBlockHeight + 3 + badgeRowHeight + 3 + chartAreaHeight;
            const cardHeight = cardContentHeight + cardPadding * 2;

            if (y + cardHeight + cardGap > pageBottom) {
                doc.addPage();
                y = drawMinimalReportHeader(doc, logo);
            }

            drawEvalCard(doc, cardX, y, cardWidth, cardHeight);

            const innerX = cardX + cardPadding;
            const innerWidth = cardWidth - cardPadding * 2;
            let cy = y + cardPadding;

            doc.setFont('Amiri', 'normal');
            doc.setFontSize(12.5);
            doc.setTextColor(EVAL_COLORS.dark[0], EVAL_COLORS.dark[1], EVAL_COLORS.dark[2]);
            doc.text(questionLines, innerX, cy + titleLineHeight - 1.6);
            cy += titleBlockHeight + 3;

            let badgeX = innerX;
            badgeX += drawEvalBadge(doc, QUESTION_TYPE_LABEL[q.question_type] || q.question_type, badgeX, cy, { bg: EVAL_COLORS.light, textColor: EVAL_COLORS.dark }) + 4;
            drawEvalBadge(doc, `Total Responses: ${responseCount}`, badgeX, cy, { bg: EVAL_COLORS.primary, textColor: EVAL_COLORS.white });
            cy += badgeRowHeight + 3;

            if (chartConfig) {
                // Render each chart at a pixel resolution proportioned to
                // the actual mm box it's about to be placed into (rather
                // than one fixed canvas size for every chart), so a tall
                // chart with many rows/legend items gets proportionally
                // more pixels instead of the same bars/text being squashed
                // into a fixed-height canvas.
                const targetWidthMm = isPie ? pieWidth : innerWidth;
                const chartImage = await captureChartImage(chartConfig, Math.round(targetWidthMm * EVAL_CHART_PX_PER_MM), Math.round(chartAreaHeight * EVAL_CHART_PX_PER_MM));
                if (isPie) {
                    const pieX = cardX + (cardWidth - pieWidth) / 2;
                    doc.addImage(chartImage, 'PNG', pieX, cy, pieWidth, chartAreaHeight);
                } else {
                    doc.addImage(chartImage, 'PNG', innerX, cy, innerWidth, chartAreaHeight);
                }
            } else {
                doc.setFont('Amiri', 'normal');
                doc.setFontSize(9.5);
                doc.setTextColor(EVAL_COLORS.textSecondary[0], EVAL_COLORS.textSecondary[1], EVAL_COLORS.textSecondary[2]);
                // Text questions still get their own numbered table further
                // down the report — Date/Time questions have no table of
                // their own (the combined "All Submitted Answers" table
                // that used to cover them was removed), so the note only
                // points "below" for Text.
                const noteText = q.question_type === 'text'
                    ? 'See the answers table for this question further below.'
                    : `Not shown as a chart — ${responseCount} response${responseCount === 1 ? '' : 's'} submitted.`;
                doc.text(noteText, innerX, cy + 4);
            }

            y += cardHeight + cardGap;
        }

        // The combined "All Submitted Answers" table (every non-Text
        // question, one tall row per participant) was removed — Text-type
        // questions are still shown below, each in its own small numbered
        // table; every other question type is already covered by its own
        // chart earlier in the report.
        const questionById = new Map((questions || []).map(q => [q.id, q]));
        const textAnswersByQuestion = new Map(); // question.id -> { question, answers: [] }
        (answers || []).forEach(a => {
            const response = responseById.get(a.response_id);
            const question = questionById.get(a.question_id);
            if (!response || !question) return;
            if (question.question_type !== 'text') return;

            const text = a.answer_value === null || a.answer_value === undefined ? '' : String(a.answer_value).trim();
            if (!text) return;
            if (!textAnswersByQuestion.has(question.id)) {
                textAnswersByQuestion.set(question.id, { question, answers: [] });
            }
            textAnswersByQuestion.get(question.id).answers.push(text);
        });

        // Text-type questions: their own separate mini-table each — the
        // question text as a heading above the table, and a table with just
        // one "Answer" column (no Staff Number/Staff Name/Submitted At —
        // those don't add anything useful for an open free-text answer).
        const sortedTextQuestions = [...textAnswersByQuestion.values()]
            .sort((a, b) => (a.question.display_order || 0) - (b.question.display_order || 0));
        if (sortedTextQuestions.length) {
            doc.addPage();
            let textY = drawMinimalReportHeader(doc, logo);
            for (const { question, answers } of sortedTextQuestions) {
                doc.setFont('Amiri', 'normal');
                doc.setFontSize(12);
                doc.setTextColor(EVAL_COLORS.dark[0], EVAL_COLORS.dark[1], EVAL_COLORS.dark[2]);
                const headingLines = doc.splitTextToSize(reshapeArabicForPdf(question.question_text || ''), 182);
                if (textY + headingLines.length * 5.5 + 14 > 282) {
                    doc.addPage();
                    textY = drawMinimalReportHeader(doc, logo);
                }
                doc.text(headingLines, 14, textY);
                textY += headingLines.length * 5.5 + 2;

                doc.autoTable({
                    startY: textY,
                    head: [['#', 'Answer']],
                    body: answers.map((ans, idx) => [idx + 1, reshapeArabicForPdf(ans)]),
                    theme: 'grid',
                    styles: {
                        fontSize: 8.5, font: 'Amiri', valign: 'top',
                        lineColor: EVAL_COLORS.border, lineWidth: 0.2,
                        textColor: EVAL_COLORS.text, cellPadding: 3.2
                    },
                    columnStyles: {
                        0: { cellWidth: 10, halign: 'center' }
                    },
                    headStyles: {
                        fillColor: EVAL_COLORS.primary, textColor: EVAL_COLORS.white,
                        font: 'Amiri', fontSize: 9, cellPadding: 3.6
                    },
                    bodyStyles: { font: 'Amiri' },
                    alternateRowStyles: { fillColor: EVAL_COLORS.bg },
                    didDrawPage: (data) => { if (data.pageNumber > 1) drawMinimalReportHeader(doc, logo); },
                    margin: { left: 14, right: 14, top: 66 }
                });
                textY = doc.lastAutoTable.finalY + 10;
            }
        }

        addPrintedByFooter(doc);
        const blobUrl = doc.output('bloburl');
        const previewTab = window.open(blobUrl, '_blank');
        if (!previewTab) {
            note.innerHTML = `Your browser blocked the preview pop-up — <a href="${blobUrl}" target="_blank" rel="noopener">click here to open the report</a>.`;
        } else {
            note.textContent = '';
        }
    } catch (err) {
        console.error('Evaluation report PDF failed:', err);
        note.textContent = 'Something went wrong: ' + err.message;
    }
};
