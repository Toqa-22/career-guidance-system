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
    const rows = filtered.map((r, i) => [i + 1, r.course_name || 'Unknown activity', '1']);

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
            styles: { fontSize: 9 },
            headStyles: { fillColor: [124, 58, 237] },
            foot: [[{ content: 'Total', colSpan: 2, styles: { fontStyle: 'bold' } }, { content: String(rows.length), styles: { fontStyle: 'bold' } }]],
            footStyles: { fillColor: [237, 233, 254], textColor: [91, 33, 182] },
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
        .map(p => [p.staff_number, p.staff_name, p.courseIds.size])
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
            styles: { fontSize: 9 },
            headStyles: { fillColor: [124, 58, 237] },
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
                    body: [...rows.map(([i, value, count]) => [i, value, String(count)]), [{ content: 'Total', colSpan: 2 }, String(total)]],
                    theme: 'grid',
                    headStyles: { fillColor: [124, 58, 237] },
                    didParseCell: (data) => {
                        if (data.row.index === rows.length && data.section === 'body') {
                            data.cell.styles.fontStyle = 'bold';
                            data.cell.styles.fillColor = [237, 233, 254];
                            data.cell.styles.textColor = [91, 33, 182];
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
    if (logo) doc.addImage(logo, 'PNG', 90, 10, 30, 30);
    doc.setFontSize(16);
    doc.setTextColor(20);
    doc.text('Ibra Hospital', 105, 48, { align: 'center' });
    doc.setFontSize(12);
    doc.setTextColor(90);
    doc.text('Professional Development and Career Guidance', 105, 56, { align: 'center' });

    doc.setFontSize(16);
    doc.setTextColor(20);
    doc.text(title, 14, 68);
    doc.setFontSize(10);
    doc.setTextColor(90);
    infoLines.forEach((line, i) => doc.text(line, 14, 76 + i * 6));

    return 76 + infoLines.length * 6 + 6;
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
            body: percentRows.map((p, i) => [i + 1, rows[i].name, String(rows[i].total), String(rows[i].attended), `${p.pct}%`]),
            theme: 'grid',
            headStyles: { fillColor: [124, 58, 237] },
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
            body: rows.map((r, i) => [i + 1, r.name, String(r.attended)]),
            theme: 'grid',
            headStyles: { fillColor: [16, 185, 129] },
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

// Courses per Department (PDF) — each activity log title logged counts as
// one course taken, per "the number of title is the number of courses".
// Grouped by each participant's CURRENT department (institution_name_snapshot
// on their registration), same convention as every other Ibra-department
// report in this file.
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
        // entry_date (the session's own date, not created_at) is what the
        // From/To period filters against — that's what "when was this
        // course actually taken" means for this report.
        const PAGE_SIZE = 1000;
        let entries = [];
        let from = 0;
        while (true) {
            const { data: page, error: entriesErr } = await client
                .from('activity_log_entries')
                .select('registration_id, title, entry_date')
                .range(from, from + PAGE_SIZE - 1);
            if (entriesErr) throw entriesErr;
            if (!page || page.length === 0) break;
            entries = entries.concat(page);
            if (page.length < PAGE_SIZE) break;
            from += PAGE_SIZE;
        }
        if (fromStr || toStr) {
            entries = entries.filter(e => isWithinRange(e.entry_date, fromStr, toStr));
        }

        const { data: allInsts, error: instErr } = await client.from('institutions').select('name');
        if (instErr) throw instErr;
        const allDepts = (allInsts || []).filter(i => i.name.startsWith('Ibra - ')).map(i => i.name.replace('Ibra - ', ''));
        if (allDepts.length === 0) {
            note.textContent = 'No Ibra departments exist yet.';
            return;
        }

        const countByDept = new Map();
        (entries || []).forEach(e => {
            const dept = deptByRegId.get(e.registration_id);
            if (!dept) return; // logged entry belongs to a registration outside Ibra departments, or one where the department was never confirmed through Activity Log -- not counted here
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
            body: rows.map((r, i) => [i + 1, r.dept, String(r.count)]),
            theme: 'grid',
            headStyles: { fillColor: [124, 58, 237] },
            foot: [[{ content: 'Total', colSpan: 2, styles: { fontStyle: 'bold' } }, { content: String(totalCourses), styles: { fontStyle: 'bold' } }]],
            footStyles: { fillColor: [237, 233, 254], textColor: [91, 33, 182] },
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
