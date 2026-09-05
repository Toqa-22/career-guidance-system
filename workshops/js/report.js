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
window.exportStaffReport = function () {
    const staffNum = document.getElementById('reportStaffNumber').value.trim();
    const fromStr = document.getElementById('reportStaffFrom').value;
    const toStr = document.getElementById('reportStaffTo').value;

    if (!staffNum) {
        alert('Please enter a staff number.');
        return;
    }

    const filtered = allRegistrationsRaw.filter(r =>
        (r.staff_number || '').trim() === staffNum &&
        (!(fromStr || toStr) || isWithinRange(r.created_at, fromStr, toStr))
    );

    exportToExcel(filtered, `report_staff_${staffNum.replace(/[^a-z0-9]+/gi, '_')}`);
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

window.exportDateRangeReport = function () {
    const fromStr = document.getElementById('reportRangeFrom').value;
    const toStr = document.getElementById('reportRangeTo').value;
    const courseId = document.getElementById('reportRangeCourse').value;
    const institutionCategory = document.getElementById('reportRangeInstitution').value;

    if (!fromStr || !toStr) {
        alert('Please choose both a from and to date.');
        return;
    }

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
        .sort((a, b) => b[2] - a[2]); // busiest participants first

    const courseLabel = courseId ? (coursesCached.find(c => String(c.id) === courseId)?.name || 'Unknown course') : 'All Activity';
    const rangeLabel = `${fromStr} to ${toStr}`;

    try {
        const logo = await getLogoBase64().catch(() => null);
        if (logo) doc.addImage(logo, 'PNG', 90, 10, 30, 30);
        doc.setFontSize(16);
        doc.setTextColor(20);
        doc.text('Ibra Hospital', 105, 48, { align: 'center' });
        doc.setFontSize(12);
        doc.setTextColor(90);
        doc.text('Professional Development and Career Guidance', 105, 56, { align: 'center' });

        doc.setFontSize(16);
        doc.setTextColor(20);
        doc.text('Activity Staff Attendant', 14, 68);
        doc.setFontSize(10);
        doc.setTextColor(90);
        doc.text(`Course: ${courseLabel}`, 14, 76);
        doc.text(`Institution: ${institutionCategory === 'IBRA' ? 'Ibra' : institutionCategory === 'OTHER' ? 'Health Center' : 'Both'}`, 14, 82);
        doc.text(`Date range: ${rangeLabel}`, 14, 88);
        doc.text(`Total participants: ${rows.length}`, 14, 94);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 100);

        doc.autoTable({
            startY: 108,
            head: [['Staff Number', 'Participant Name', 'Number of Courses Enrolled']],
            body: rows,
            styles: { fontSize: 9 },
            headStyles: { fillColor: [124, 58, 237] }
        });

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
        if (logo) doc.addImage(logo, 'PNG', 90, 10, 30, 30);
        doc.setFontSize(16);
        doc.setTextColor(20);
        doc.text('Ibra Hospital', 105, 48, { align: 'center' });
        doc.setFontSize(12);
        doc.setTextColor(90);
        doc.text('Professional Development and Career Guidance', 105, 56, { align: 'center' });

        doc.setFontSize(16);
        doc.setTextColor(20);
        doc.text('Participation Report', 14, 68);
        doc.setFontSize(10);
        doc.setTextColor(90);
        doc.text(`Course: ${courseLabel}`, 14, 76);
        doc.text(`Date range: ${rangeLabel}`, 14, 82);
        doc.text(`Total participants in range: ${filtered.length}`, 14, 88);
        doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 94);

        let cursorY = 102;
        REPORT_FIELD_DEFINITIONS
            .filter(f => checked.includes(f.key))
            .forEach(field => {
                const rows = buildFrequencyRows(filtered, field.key);
                const total = rows.reduce((sum, [, count]) => sum + count, 0);

                if (cursorY > 260) { doc.addPage(); cursorY = 20; }
                doc.setFontSize(12);
                doc.setTextColor(20);
                doc.text(field.label, 14, cursorY);

                doc.autoTable({
                    startY: cursorY + 4,
                    head: [[field.label, 'Participants']],
                    body: [...rows.map(([value, count]) => [value, String(count)]), ['Total', String(total)]],
                    theme: 'grid',
                    headStyles: { fillColor: [124, 58, 237] },
                    didParseCell: (data) => {
                        if (data.row.index === rows.length && data.section === 'body') {
                            data.cell.styles.fontStyle = 'bold';
                        }
                    },
                    margin: { left: 14, right: 14 }
                });
                cursorY = doc.lastAutoTable.finalY + 14;
            });

        const filenameCourse = courseId ? courseLabel.replace(/[^a-z0-9]+/gi, '_') : 'all_courses';
        doc.setProperties({ title: `Participation Report - ${filenameCourse}` });

        // Open the PDF in a new tab for preview first — the browser's own PDF
        // viewer has a Download button, so the person decides whether to save it
        // instead of it silently landing in their Downloads folder unannounced.
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
        const logo = await getLogoBase64().catch(() => null);
        if (logo) doc.addImage(logo, 'PNG', 90, 10, 30, 30);

        doc.setFontSize(16);
        doc.setTextColor(20);
        doc.text('Ibra Hospital', 105, 48, { align: 'center' });
        doc.setFontSize(12);
        doc.setTextColor(90);
        doc.text('Professional Development and Career Guidance', 105, 56, { align: 'center' });

        const hallLabel = hall || 'All Halls';
        const typeLabel = reservation_type || 'All Types';
        const periodLabel = (fromStr || toStr) ? `${fromStr || '…'} to ${toStr || '…'}` : 'All time';
        doc.setFontSize(10);
        doc.setTextColor(60);
        doc.text(`Hall: ${hallLabel}    Type: ${typeLabel}`, 14, 68);
        doc.text(`Period: ${periodLabel}`, 14, 74);

        doc.autoTable({
            startY: 82,
            head: [['Activity Name', 'Date']],
            body: data.map(r => [r.course_name, r.reservation_date]),
            theme: 'grid',
            headStyles: { fillColor: [124, 58, 237] },
            margin: { left: 14, right: 14 }
        });

        doc.autoTable({
            startY: doc.lastAutoTable.finalY + 14,
            head: [['', '']],
            body: [['Number of Activities', String(distinctBookings)]],
            theme: 'grid',
            showHead: false,
            styles: { fontStyle: 'bold', fillColor: [124, 58, 237], textColor: [255, 255, 255] },
            margin: { left: 14, right: 14 }
        });

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
    note.textContent = 'Building chart...';

    try {
        const { data: insts, error: instErr } = await client
            .from('institutions')
            .select('name, staff_count')
            .not('staff_count', 'is', null);
        if (instErr) throw instErr;
        if (!insts || insts.length === 0) {
            note.textContent = 'No institutions have a staff count set yet (see Institutions & Staff in the hub admin panel).';
            return;
        }

        const { data: regs, error: regErr } = await client.from('registrations').select('institution_name_snapshot, staff_number');
        if (regErr) throw regErr;

        const attendedByInstitution = new Map();
        (regs || []).forEach(r => {
            const name = (r.institution_name_snapshot || '').trim();
            if (!name || !r.staff_number) return;
            if (!attendedByInstitution.has(name)) attendedByInstitution.set(name, new Set());
            attendedByInstitution.get(name).add(r.staff_number);
        });

        const rows = insts
            .map(i => ({ name: i.name, total: i.staff_count, attended: (attendedByInstitution.get(i.name.trim()) || new Set()).size }))
            .sort((a, b) => b.total - a.total);

        const canvas = document.getElementById('deptChartOffscreen');
        canvas.style.display = 'block'; // Chart.js needs real layout to measure against

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
                    { label: 'Attended a Workshop', data: rows.map(r => r.attended), backgroundColor: '#7C3AED' }
                ]
            },
            options: {
                responsive: false, animation: false,
                plugins: { legend: { position: 'bottom' }, title: { display: true, text: 'Number of Staff per Department — Ibra Hospital' } },
                scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
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
                scales: { y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } } }
            }
        });

        canvas.style.display = 'none';

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const logo = await getLogoBase64().catch(() => null);
        if (logo) doc.addImage(logo, 'PNG', 90, 10, 30, 30);
        doc.setFontSize(16);
        doc.text('Ibra Hospital', 105, 48, { align: 'center' });
        doc.setFontSize(12);
        doc.setTextColor(90);
        doc.text('Professional Development and Career Guidance', 105, 56, { align: 'center' });
        doc.addImage(countsImage, 'PNG', 14, 66, 182, 101);

        doc.addPage();
        doc.setFontSize(13);
        doc.setTextColor(20);
        doc.text('Attendance Coverage', 14, 18);
        doc.addImage(percentImage, 'PNG', 14, 26, 182, 101);

        doc.autoTable({
            startY: 134,
            head: [['Department', 'Total Staff', 'Attended', 'Coverage']],
            body: percentRows.map((p, i) => [rows[i].name, String(rows[i].total), String(rows[i].attended), `${p.pct}%`]),
            theme: 'grid',
            headStyles: { fillColor: [124, 58, 237] },
            margin: { left: 14, right: 14 }
        });

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
