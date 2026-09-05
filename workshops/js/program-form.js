import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let displayedActivities = []; // whatever's currently shown/filtered, in table order
let detailsByKey = new Map();

function formatPeriod(from, to) {
    if (!from) return '';
    return to && to !== from ? `${from} → ${to}` : from;
}

// Combines Create Activity courses AND Hall Reservation calendar bookings
// into one list. A multi-day hall booking (several per-day rows sharing a
// booking_group_id) collapses into ONE activity here, using its earliest
// and latest date as the period — matching how the calendar already treats
// it as a single booking.
async function loadActivities() {
    const [{ data: courses, error: coursesErr }, { data: hallRows, error: hallErr }, { data: details, error: detailsErr }] = await Promise.all([
        client.from('courses').select('id, name, course_date, course_end_date, participant_count'),
        client.from('hall_reservations').select('id, course_name, reservation_date, booking_group_id, phone_number, participant_count'),
        client.from('program_form_details').select('*')
    ]);

    if (coursesErr) throw coursesErr;
    if (hallErr) throw hallErr;
    if (detailsErr) console.error('Could not load program form details:', detailsErr.message);

    detailsByKey = new Map((details || []).map(d => [d.activity_key, d]));

    const activities = (courses || []).map(c => ({
        activity_key: `course_${c.id}`,
        name: c.name,
        periodFrom: c.course_date,
        periodTo: c.course_end_date || c.course_date,
        suggestedContact: null,
        suggestedParticipantCount: c.participant_count || null
    }));

    const hallGroups = new Map(); // group key -> { name, dates: [], phone, participantCount }
    (hallRows || []).forEach(r => {
        const groupKey = r.booking_group_id || `single_${r.id}`;
        if (!hallGroups.has(groupKey)) hallGroups.set(groupKey, { name: r.course_name, dates: [], phone: r.phone_number, participantCount: r.participant_count });
        hallGroups.get(groupKey).dates.push(r.reservation_date);
    });
    hallGroups.forEach((g, groupKey) => {
        const sortedDates = g.dates.slice().sort();
        activities.push({
            activity_key: `hall_${groupKey}`,
            name: g.name,
            periodFrom: sortedDates[0],
            periodTo: sortedDates[sortedDates.length - 1],
            suggestedContact: g.phone || null,
            suggestedParticipantCount: g.participantCount || null
        });
    });

    activities.sort((a, b) => (a.periodFrom || '').localeCompare(b.periodFrom || ''));
    return activities;
}

function applyPeriodFilter(activities) {
    const from = document.getElementById('pfPeriodFrom').value;
    const to = document.getElementById('pfPeriodTo').value;
    if (!from && !to) return activities;
    return activities.filter(a => {
        if (!a.periodFrom) return false;
        const aFrom = a.periodFrom, aTo = a.periodTo || a.periodFrom;
        if (from && aTo < from) return false;
        if (to && aFrom > to) return false;
        return true;
    });
}

async function loadAndRender() {
    const tbody = document.getElementById('pfTableBody');
    tbody.innerHTML = `<tr class="pf-empty-row"><td colspan="13">Loading…</td></tr>`;

    let all;
    try {
        all = await loadActivities();
    } catch (err) {
        tbody.innerHTML = `<tr class="pf-empty-row"><td colspan="13">Couldn't load activities: ${err.message}</td></tr>`;
        return;
    }

    displayedActivities = applyPeriodFilter(all);

    if (displayedActivities.length === 0) {
        tbody.innerHTML = `<tr class="pf-empty-row"><td colspan="13">No activities in this period.</td></tr>`;
        return;
    }

    tbody.innerHTML = displayedActivities.map((a, i) => {
        const d = detailsByKey.get(a.activity_key) || {};
        const contactValue = d.contact_number != null ? d.contact_number : (a.suggestedContact || '');
        const traineeCountValue = d.trainee_count != null ? d.trainee_count : (a.suggestedParticipantCount || '');
        return `
        <tr data-activity-key="${a.activity_key}">
            <td class="pf-readonly">${i + 1}</td>
            <td class="pf-readonly">${a.name}</td>
            <td class="pf-readonly">${formatPeriod(a.periodFrom, a.periodTo)}</td>
            <td><input type="text" class="pf-contact-number" value="${contactValue}" placeholder="Enter manually"></td>
            <td><input type="text" class="pf-executing-entity" value="${d.executing_entity || ''}"></td>
            <td><input type="text" class="pf-program-hours" value="${d.program_hours || ''}"></td>
            <td><input type="text" class="pf-actual-cost" value="${d.actual_cost || ''}"></td>
            <td><input type="text" class="pf-catering-type" value="${d.catering_type || ''}"></td>
            <td><input type="text" class="pf-stationery" value="${d.stationery || ''}"></td>
            <td><input type="text" class="pf-trainee-count" value="${traineeCountValue}"></td>
            <td><input type="text" class="pf-execution-place" value="${d.execution_place || ''}"></td>
            <td>
                <select class="pf-in-annual-plan">
                    <option value="" ${!d.in_annual_plan ? 'selected' : ''}>—</option>
                    <option value="نعم" ${d.in_annual_plan === 'نعم' ? 'selected' : ''}>نعم</option>
                    <option value="لا" ${d.in_annual_plan === 'لا' ? 'selected' : ''}>لا</option>
                </select>
            </td>
            <td><button type="button" class="pf-btn pf-btn-small" data-action="save">Save</button></td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('[data-action="save"]').forEach(btn => {
        btn.addEventListener('click', () => saveRow(btn.closest('tr')));
    });
}

function setNote(message, isError) {
    const note = document.getElementById('pfNote');
    note.textContent = message || '';
    note.className = `pf-note${isError ? ' error' : ' success'}`;
}

async function saveRow(tr) {
    const activity_key = tr.dataset.activityKey;
    const payload = {
        activity_key,
        contact_number: tr.querySelector('.pf-contact-number').value.trim() || null,
        executing_entity: tr.querySelector('.pf-executing-entity').value.trim() || null,
        program_hours: tr.querySelector('.pf-program-hours').value.trim() || null,
        actual_cost: tr.querySelector('.pf-actual-cost').value.trim() || null,
        catering_type: tr.querySelector('.pf-catering-type').value || null,
        stationery: tr.querySelector('.pf-stationery').value || null,
        trainee_count: tr.querySelector('.pf-trainee-count').value.trim() || null,
        execution_place: tr.querySelector('.pf-execution-place').value.trim() || null,
        in_annual_plan: tr.querySelector('.pf-in-annual-plan').value || null,
        updated_at: new Date().toISOString()
    };

    const btn = tr.querySelector('[data-action="save"]');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    const { error } = await client.from('program_form_details').upsert(payload, { onConflict: 'activity_key' });
    btn.disabled = false;
    btn.textContent = 'Save';

    if (error) {
        setNote('Could not save: ' + error.message, true);
        return;
    }
    detailsByKey.set(activity_key, payload);
    setNote('Saved.', false);
}

document.getElementById('pfPeriodFrom').addEventListener('change', loadAndRender);
document.getElementById('pfPeriodTo').addEventListener('change', loadAndRender);
document.getElementById('pfPeriodClearBtn').addEventListener('click', () => {
    document.getElementById('pfPeriodFrom').value = '';
    document.getElementById('pfPeriodTo').value = '';
    loadAndRender();
});

// ============================================================================
// Excel export — replicates the official template exactly: title block
// (light gray, theme "Background 2" darkened ~10%), a two-row merged column
// header (light green, theme "Accent 6" lightened ~80%), thin borders
// everywhere, and the same column widths — one row per DISPLAYED activity
// (i.e. respecting the Period filter above), in the same order as the table.
//
// Honest note: the original template's header font is "Khalid Art Bold", a
// custom Arabic display font, which can't be embedded in a generated .xlsx —
// Excel will fall back to a similar bold font on whatever machine opens it.
// ============================================================================
const TITLE_FILL = 'D0CECE';
const HEADER_FILL = 'E2F0D9';
const THIN_BORDER = { style: 'thin', color: { rgb: '000000' } };
const ALL_BORDERS = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };

function titleStyle(size) {
    return { font: { bold: true, sz: size }, fill: { fgColor: { rgb: TITLE_FILL } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: ALL_BORDERS };
}
function headerStyle(size = 14) {
    return { font: { bold: true, sz: size }, fill: { fgColor: { rgb: HEADER_FILL } }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: ALL_BORDERS };
}
function dataStyle() {
    return { font: { sz: 12 }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true }, border: ALL_BORDERS };
}
function setCell(ws, addr, value, style) {
    ws[addr] = { v: value == null ? '' : value, t: 's', s: style };
}

document.getElementById('pfExportBtn').addEventListener('click', () => {
    if (displayedActivities.length === 0) {
        alert('No activities in the selected period to export.');
        return;
    }

    const fromStr = document.getElementById('pfPeriodFrom').value;
    const toStr = document.getElementById('pfPeriodTo').value;
    const periodLabel = (fromStr || toStr)
        ? `من ${fromStr || '...'} إلى ${toStr || '...'}`
        : new Date().toLocaleDateString('ar', { month: 'long', year: 'numeric' });

    const ws = {};
    setCell(ws, 'A1', 'المديرية العامة للخدمات الصحية بشمال الشرقية قسم تنمية الموارد البشرية', titleStyle(24));
    setCell(ws, 'A4', `استمارة البرامج التدريبية - ${periodLabel}`, titleStyle(18));

    const headerRow6 = {
        A6: 'م', B6: 'الجهة المنفذة', C6: 'اسم البرنامج', D6: 'فترة تنفيذ البرنامج',
        F6: 'عدد ساعات البرنامج', G6: 'التكلفة الفعلية', I6: 'عدد المتدربين', J6: 'مكان التنفيذ',
        K6: 'هل البرانامج ضمن الخطة السنوية المعتمدة لعام 2026', L6: 'رقم التواصل'
    };
    Object.entries(headerRow6).forEach(([addr, val]) => setCell(ws, addr, val, headerStyle(addr.startsWith('K') || addr.startsWith('L') ? 13 : 16)));
    setCell(ws, 'D7', 'من', headerStyle(16));
    setCell(ws, 'E7', 'الى', headerStyle(16));
    setCell(ws, 'G7', 'نوع التغذية', headerStyle(16));
    setCell(ws, 'H7', 'القرطاسية', headerStyle(16));
    ['A7', 'B7', 'C7', 'F7', 'I7', 'J7', 'K7', 'L7'].forEach(addr => setCell(ws, addr, '', headerStyle(14)));

    let row = 8;
    displayedActivities.forEach((a, i) => {
        const d = detailsByKey.get(a.activity_key) || {};
        const contactValue = d.contact_number != null ? d.contact_number : (a.suggestedContact || '');
        const traineeCountValue = d.trainee_count != null ? d.trainee_count : (a.suggestedParticipantCount || '');
        const rowVals = {
            [`A${row}`]: i + 1,
            [`B${row}`]: d.executing_entity || '',
            [`C${row}`]: a.name || '',
            [`D${row}`]: a.periodFrom || '',
            [`E${row}`]: a.periodTo || a.periodFrom || '',
            [`F${row}`]: d.program_hours || '',
            [`G${row}`]: d.actual_cost || '',
            [`H${row}`]: d.stationery || '',
            [`I${row}`]: traineeCountValue,
            [`J${row}`]: d.execution_place || '',
            [`K${row}`]: d.in_annual_plan || '',
            [`L${row}`]: contactValue
        };
        Object.entries(rowVals).forEach(([addr, val]) => setCell(ws, addr, val, dataStyle()));
        if (d.catering_type) {
            ws[`G${row}`].v = `${d.actual_cost || ''}${d.actual_cost ? ' — ' : ''}${d.catering_type}`;
        }
        row++;
    });

    const lastRow = row - 1;
    ws['!ref'] = `A1:M${lastRow}`;
    ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 2, c: 11 } },
        { s: { r: 3, c: 0 }, e: { r: 4, c: 11 } },
        { s: { r: 5, c: 0 }, e: { r: 6, c: 0 } },
        { s: { r: 5, c: 1 }, e: { r: 6, c: 1 } },
        { s: { r: 5, c: 2 }, e: { r: 6, c: 2 } },
        { s: { r: 5, c: 3 }, e: { r: 5, c: 4 } },
        { s: { r: 5, c: 5 }, e: { r: 6, c: 5 } },
        { s: { r: 5, c: 6 }, e: { r: 5, c: 7 } },
        { s: { r: 5, c: 8 }, e: { r: 6, c: 8 } },
        { s: { r: 5, c: 9 }, e: { r: 6, c: 9 } },
        { s: { r: 5, c: 10 }, e: { r: 6, c: 10 } },
        { s: { r: 5, c: 11 }, e: { r: 6, c: 11 } }
    ];
    ws['!cols'] = [
        { wch: 6.5 }, { wch: 19 }, { wch: 41 }, { wch: 19.2 }, { wch: 19.2 },
        { wch: 15.4 }, { wch: 20.2 }, { wch: 12 }, { wch: 19.5 }, { wch: 24.8 },
        { wch: 30.2 }, { wch: 14 }, { wch: 9.2 }
    ];
    ws['!rows'] = [
        { hpt: 30 }, { hpt: 30 }, { hpt: 30 }, { hpt: 20.25 }, { hpt: 20.25 },
        { hpt: 41.25 }, { hpt: 41.25 }
    ];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, ws, 'Sheet1');
    workbook.Sheets['Sheet1']['!dir'] = 'rtl';
    if (!workbook.Workbook) workbook.Workbook = {};
    workbook.Workbook.Views = [{ RTL: true }];

    XLSX.writeFile(workbook, `Program_Form_${new Date().toISOString().slice(0, 10)}.xlsx`);
});

loadAndRender();
