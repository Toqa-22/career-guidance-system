// ============================================================================
// Admin > Report: "Activities per Department" PDF for a From–To period.
//
// The SAME counting as the Workshops report card "Activities per Department"
// (workshops/js/report.js v30):
//   - Organized = activities from Create Activity whose "Organized By" is the
//     department (an activity with 2 organizers counts once for each;
//     "without attendance" activities are counted only through their Activity
//     Log entries; "None" activities are not counted).
//   - Activity Log = one department + one date = one course; an entry's own
//     department wins, else the registration's department when it was chosen
//     through the Activity Log.
//   - Only departments / institutions in the Institutions list TODAY are
//     shown: added ones appear (0 included), deleted ones and old typed names
//     are left out and counted in a "Not shown" line.
// Then a details section per department with what is behind each number:
// activity names, and the Activity Log titles, dates, staff name / number /
// phone (a missing name or phone is filled from the person's profile).
//
// The PDF is built with jsPDF + autoTable (like the Workshops reports) and
// downloads straight away. jsPDF cannot shape Arabic by itself, so any text
// that is not plain Latin (Arabic names, titles...) is drawn by the browser
// onto a canvas at high resolution and placed in the PDF as an image — the
// letters join and read right-to-left exactly as on screen.
// ============================================================================
import { requireSession, client } from '../js/admin-shared.js';

requireSession();

const PURPLE = [124, 58, 237];
const PURPLE_DARK = [91, 33, 182];
const LIGHT = [248, 246, 255];
const TEXT = [31, 24, 48];
const MARGIN = 14;
const CONTENT_W = 182;          // A4 210mm - 2 x 14mm
const FONT_PT = 8.5;            // details tables
const PAD = 1.5;                // table cell padding (mm)
const PT_TO_MM = 0.3528;

// ---------- small helpers (same rules as workshops/js/report.js) ----------
function formatDateDDMMYYYY(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}
function isWithinRange(dateStr, fromStr, toStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return false;
    if (fromStr && d < new Date(fromStr + 'T00:00:00')) return false;
    if (toStr && d > new Date(toStr + 'T23:59:59')) return false;
    return true;
}
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const dateRange = (from, to) => !from ? '—'
    : formatDateDDMMYYYY(from) + (to && to !== from ? ' – ' + formatDateDDMMYYYY(to) : '');

// ---------- reading the data (paged past Supabase's 1,000-row limit) ----------
async function fetchAllPaged(buildQuery) {
    const PAGE_SIZE = 1000;
    let rows = [];
    let from = 0;
    while (true) {
        const { data, error } = await buildQuery().range(from, from + PAGE_SIZE - 1);
        if (error) return { data: null, error };
        if (!data || data.length === 0) break;
        rows = rows.concat(data);
        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
    }
    return { data: rows, error: null };
}

// Rows of `table` whose `column` is one of `values` (a few hundred per request).
async function fetchRowsIn(table, columns, column, values) {
    const unique = [...new Set(values.filter(v => v !== null && v !== undefined && v !== ''))];
    let rows = [];
    for (let i = 0; i < unique.length; i += 200) {
        const { data, error } = await client.from(table).select(columns).in(column, unique.slice(i, i + 200));
        if (error) throw error;
        rows = rows.concat(data || []);
    }
    return rows;
}

// Every activity (fewer columns when an older database lacks some).
async function fetchAllCourses() {
    const attempts = [
        'id, name, course_date, course_end_date, instructor_name, organizers, attendance_required',
        'id, name, course_date, instructor_name, organizers, attendance_required',
        'id, name, course_date, instructor_name, attendance_required',
        'id, name, course_date, instructor_name'
    ];
    let last = null;
    for (const columns of attempts) {
        last = await fetchAllPaged(() => client.from('courses').select(columns).order('id', { ascending: true }));
        if (!last.error) return last.data || [];
    }
    throw last.error;
}

// Activity Log courses per department (one department + one date = one
// course), with the entries behind each one and who logged them.
async function fetchActivityLog(fromStr, toStr) {
    const regsRes = await fetchAllPaged(() => client.from('registrations')
        .select('id, institution_name_snapshot, department_chosen_via_log')
        .like('institution_name_snapshot', 'Ibra - %').order('id', { ascending: true }));
    if (regsRes.error) throw regsRes.error;
    const deptByRegId = new Map((regsRes.data || [])
        .filter(r => r.department_chosen_via_log)
        .map(r => [r.id, r.institution_name_snapshot.replace('Ibra - ', '')]));

    const entriesRes = await fetchAllPaged(() => client.from('activity_log_entries')
        .select('id, registration_id, title, entry_date_from, entry_date_to, department').order('id', { ascending: true }));
    if (entriesRes.error) throw entriesRes.error;
    let entries = entriesRes.data || [];
    if (fromStr || toStr) entries = entries.filter(e => isWithinRange(e.entry_date_from, fromStr, toStr));

    const groupByDeptDate = new Map();
    const countByDept = new Map();
    const groupsByDept = new Map();
    entries.forEach(e => {
        const dept = e.department || deptByRegId.get(e.registration_id);
        if (!dept) return;
        const key = `${dept}|${e.entry_date_from}`;
        let group = groupByDeptDate.get(key);
        if (!group) {
            group = { date: e.entry_date_from, entries: [] };
            groupByDeptDate.set(key, group);
            countByDept.set(dept, (countByDept.get(dept) || 0) + 1);
            if (!groupsByDept.has(dept)) groupsByDept.set(dept, []);
            groupsByDept.get(dept).push(group);
        }
        group.entries.push(e);
    });

    // Who logged each counted entry; a missing name / phone on the
    // registration comes from the person's profile. If this lookup fails the
    // report is still made, with "—" in those cells.
    try {
        const counted = [...groupByDeptDate.values()].flatMap(g => g.entries);
        const regs = await fetchRowsIn('registrations', 'id, staff_name, staff_number, phone_number, participant_id',
            'id', counted.map(e => e.registration_id));
        const regById = new Map(regs.map(r => [r.id, r]));
        const incomplete = regs.filter(r => !clean(r.staff_name) || !clean(r.phone_number));
        const cols = 'id, staff_name, phone_number, staff_number_normalized';
        const byPid = await fetchRowsIn('participants', cols, 'id', incomplete.map(r => r.participant_id).filter(Boolean));
        const byNum = await fetchRowsIn('participants', cols, 'staff_number_normalized',
            incomplete.filter(r => !r.participant_id).map(r => clean(r.staff_number).toLowerCase()).filter(Boolean));
        const profileById = new Map(byPid.map(p => [p.id, p]));
        const profileByNum = new Map(byNum.map(p => [p.staff_number_normalized, p]));
        counted.forEach(e => {
            const r = regById.get(e.registration_id) || {};
            const p = (r.participant_id ? profileById.get(r.participant_id) : null)
                || profileByNum.get(clean(r.staff_number).toLowerCase()) || {};
            e.staffName = clean(r.staff_name) || clean(p.staff_name);
            e.staffNumber = clean(r.staff_number);
            e.phone = clean(r.phone_number) || clean(p.phone_number);
        });
    } catch (lookupErr) {
        console.warn('Report: staff details lookup failed:', lookupErr);
    }
    return { countByDept, groupsByDept };
}

// ---------- the counting (same as generateCoursesPerOrganizerPdf) ----------
function buildReportData(instNames, courses, log, fromStr, toStr) {
    const ibraDepts = instNames.filter(n => n.startsWith('Ibra - ')).map(n => n.replace('Ibra - ', '').trim());
    const otherInsts = instNames.filter(n => !n.startsWith('Ibra - ') && n !== 'Other (Please Specify)');
    const findCI = (list, name) => list.find(n => n.toLowerCase() === String(name || '').trim().toLowerCase());
    const organizerRow = (type, rawName) => {
        const name = String(rawName || '').replace(/^Ibra - /i, '').trim();
        if (!name) return null;
        const ibraHit = type !== 'Other' ? findCI(ibraDepts, name) : undefined;
        if (ibraHit) return { key: 'Ibra|' + ibraHit, label: ibraHit };
        const otherHit = type !== 'Ibra' ? findCI(otherInsts, name) : undefined;
        if (otherHit) return { key: 'Other|' + otherHit, label: otherHit };
        return { removed: true, name: name.toLowerCase(), label: name };
    };

    const organizedByKey = new Map();
    const organizedCoursesByKey = new Map();
    const labelByKey = new Map();
    let noOrganizerCount = 0;
    let notShownCount = 0;
    courses
        .filter(c => c.attendance_required !== false)
        .filter(c => !(fromStr || toStr) || isWithinRange(c.course_date, fromStr, toStr))
        .forEach(c => {
            let list = c.organizers;
            try { if (typeof list === 'string') list = JSON.parse(list); } catch (e) { list = null; }
            let rowsForCourse = [];
            if (Array.isArray(list) && list.length > 0) {
                rowsForCourse = list.map(o => o && organizerRow(o.type, o.name)).filter(Boolean);
            } else if (String(c.instructor_name || '').trim()) {
                const r = organizerRow('', c.instructor_name);
                if (r) rowsForCourse = [r];
            }
            if (rowsForCourse.length === 0) { noOrganizerCount++; return; }
            const everyOrganizer = rowsForCourse;
            notShownCount += new Set(rowsForCourse.filter(r => r.removed).map(r => r.name)).size;
            rowsForCourse = rowsForCourse.filter(r => !r.removed);
            if (rowsForCourse.length === 0) return;
            new Set(rowsForCourse.map(r => r.key)).forEach(key => {
                organizedByKey.set(key, (organizedByKey.get(key) || 0) + 1);
                const others = [...new Set(everyOrganizer.filter(r => r.key !== key).map(r => r.label))];
                if (!organizedCoursesByKey.has(key)) organizedCoursesByKey.set(key, []);
                organizedCoursesByKey.get(key).push({ name: c.name, date: c.course_date, endDate: c.course_end_date, others });
            });
            rowsForCourse.forEach(r => labelByKey.set(r.key, r.label));
        });

    const loggedByKey = new Map();
    const loggedGroupsByKey = new Map();
    log.countByDept.forEach((count, dept) => {
        const name = String(dept).replace(/^Ibra - /i, '').trim();
        if (!name) return;
        const hit = findCI(ibraDepts, name);
        if (!hit) { notShownCount += count; return; }
        const key = 'Ibra|' + hit;
        loggedByKey.set(key, (loggedByKey.get(key) || 0) + count);
        if (!loggedGroupsByKey.has(key)) loggedGroupsByKey.set(key, []);
        loggedGroupsByKey.get(key).push(...(log.groupsByDept.get(dept) || []));
        if (!labelByKey.has(key)) labelByKey.set(key, hit);
    });

    const makeRow = (key, dept) => {
        const organized = organizedByKey.get(key) || 0;
        const logged = loggedByKey.get(key) || 0;
        return { key, dept, organized, logged, total: organized + logged };
    };
    const rows = ibraDepts.map(d => makeRow('Ibra|' + d, d));
    new Set([...organizedByKey.keys(), ...loggedByKey.keys()]).forEach(key => {
        if (!key.startsWith('Ibra|') || !ibraDepts.includes(key.slice(5))) {
            rows.push(makeRow(key, labelByKey.get(key) || key.split('|')[1]));
        }
    });
    rows.sort((a, b) => b.total - a.total || a.dept.localeCompare(b.dept));
    return { rows, ibraDepts, organizedCoursesByKey, loggedGroupsByKey, noOrganizerCount, notShownCount };
}

// ---------- text the PDF fonts can't draw (Arabic...) -> browser-drawn image ----------
const PX_PER_MM = 12; // ~300 dpi
const CANVAS_FONT = '"Noto Sans Arabic", "Segoe UI", Tahoma, Arial, sans-serif';
const scratch = document.createElement('canvas').getContext('2d');
const needsImage = s => /[^\x00-\xFF–—‘’“”…]/.test(s);
const isRtl = s => { const m = s.match(/[A-Za-zÀ-ɏ֐-ࣿיִ-﻿]/); return !!m && /[֐-ࣿיִ-﻿]/.test(m[0]); };
const canvasFont = (pt, bold) => `${bold ? 700 : 400} ${(pt * PT_TO_MM * PX_PER_MM).toFixed(1)}px ${CANVAS_FONT}`;
const lineHeightMm = pt => pt * PT_TO_MM * 1.4;

function wrapCanvasText(text, widthMm, pt, bold) {
    scratch.font = canvasFont(pt, bold);
    const maxPx = widthMm * PX_PER_MM;
    const lines = [];
    let line = '';
    text.split(' ').forEach(word => {
        const test = line ? line + ' ' + word : word;
        if (!line || scratch.measureText(test).width <= maxPx) line = test;
        else { lines.push(line); line = word; }
    });
    if (line) lines.push(line);
    return lines;
}
const imageCache = new Map();
// Draws lines of text into a PNG and returns { url, alias, w, h } (mm).
function textImage(lines, widthMm, pt, color, align, bold) {
    const key = [lines.join('\n'), widthMm.toFixed(2), pt, color.join(','), align, bold ? 1 : 0].join('|');
    if (imageCache.has(key)) return imageCache.get(key);
    const lh = lineHeightMm(pt);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(widthMm * PX_PER_MM));
    canvas.height = Math.max(1, Math.ceil(lines.length * lh * PX_PER_MM));
    const ctx = canvas.getContext('2d');
    ctx.font = canvasFont(pt, bold);
    ctx.fillStyle = `rgb(${color.join(',')})`;
    ctx.textBaseline = 'middle';
    lines.forEach((ln, i) => {
        ctx.direction = isRtl(ln) ? 'rtl' : 'ltr';
        ctx.textAlign = align;
        const x = align === 'right' ? canvas.width : align === 'center' ? canvas.width / 2 : 0;
        ctx.fillText(ln, x, (i + 0.5) * lh * PX_PER_MM, canvas.width); // shrinks a too-long word to fit
    });
    const img = { url: canvas.toDataURL('image/png'), alias: 'txt' + imageCache.size, w: widthMm, h: lines.length * lh };
    imageCache.set(key, img);
    return img;
}

// One line of text at (x, baseline y) — real PDF text when the PDF font can
// draw it, otherwise an image. align: left | right | center.
function drawText(doc, text, x, y, { pt = 10, color = TEXT, align = 'left', bold = false, maxWidth = null } = {}) {
    const s = clean(text);
    if (!s) return;
    if (!needsImage(s)) {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(pt);
        doc.setTextColor(...color);
        let t = s;
        if (maxWidth && doc.getTextWidth(t) > maxWidth) {
            while (t.length > 1 && doc.getTextWidth(t + '…') > maxWidth) t = t.slice(0, -1);
            t = t.trimEnd() + '…';
        }
        doc.text(t, x, y, { align });
        return;
    }
    scratch.font = canvasFont(pt, bold);
    const natural = scratch.measureText(s).width / PX_PER_MM + 0.5;
    const w = maxWidth ? Math.min(maxWidth, natural) : natural;
    const img = textImage([s], w, pt, color, isRtl(s) ? 'right' : 'left', bold);
    const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    const middle = y - pt * PT_TO_MM * 0.35;
    doc.addImage(img.url, 'PNG', left, middle - img.h / 2, img.w, img.h, img.alias, 'FAST');
}

// A table cell: plain text when the PDF font can draw it, otherwise an empty
// cell tall enough for the wrapped lines, drawn as an image in didDrawCell.
function cell(text, colWidthMm, fill, pt = FONT_PT) {
    const s = clean(text);
    const styles = fill ? { fillColor: fill } : {};
    if (!s) return { content: '—', styles: { ...styles, textColor: [170, 170, 170] } };
    if (!needsImage(s)) return { content: s, styles };
    const lines = wrapCanvasText(s, colWidthMm - 2 * PAD - 0.4, pt);
    return { content: '', styles: { ...styles, minCellHeight: lines.length * lineHeightMm(pt) + 2 * PAD }, _txt: { lines, rtl: isRtl(s), pt } };
}
function drawImageCell(doc, data) {
    const raw = data.cell.raw;
    if (data.section !== 'body' || !raw || !raw._txt) return;
    const w = data.cell.width - 2 * PAD;
    const img = textImage(raw._txt.lines, w, raw._txt.pt, TEXT, raw._txt.rtl ? 'right' : 'left', false);
    doc.addImage(img.url, 'PNG', data.cell.x + PAD, data.cell.y + (data.cell.height - img.h) / 2, img.w, img.h, img.alias, 'FAST');
}

// ---------- page frame: same header / footer as the Workshops reports ----------
function drawFullHeader(doc, logo, title, infoLines) {
    if (logo) doc.addImage(logo, 'PNG', 90, 10, 30, 30);
    drawText(doc, 'Ibra Hospital', 105, 48, { pt: 16, color: [20, 20, 20], align: 'center' });
    drawText(doc, 'Professional Development and Career Guidance', 105, 56, { pt: 12, color: [90, 90, 90], align: 'center' });
    drawText(doc, title, MARGIN, 68, { pt: 16, color: PURPLE_DARK, bold: true });
    infoLines.forEach((line, i) => drawText(doc, line, MARGIN, 76 + i * 5.5, { pt: 9.5, color: [90, 90, 90] }));
    return 76 + infoLines.length * 5.5 + 4;
}
function drawMinimalHeader(doc, logo) {
    if (logo) doc.addImage(logo, 'PNG', 90, 10, 30, 30);
    drawText(doc, 'Ibra Hospital', 105, 48, { pt: 16, color: [20, 20, 20], align: 'center' });
    drawText(doc, 'Professional Development and Career Guidance', 105, 56, { pt: 12, color: [90, 90, 90], align: 'center' });
    return 66;
}
function addFooters(doc) {
    let printedBy = 'Unknown admin';
    try {
        const session = JSON.parse(sessionStorage.getItem('ibra_admin_session') || 'null');
        if (session) printedBy = session.fullName || session.username || printedBy;
    } catch { /* default above */ }
    const pages = doc.internal.getNumberOfPages();
    const h = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        drawText(doc, `Printed by: ${printedBy}`, MARGIN, h - 10, { pt: 8, color: [150, 150, 150] });
        drawText(doc, `Page ${i} of ${pages}`, 210 - MARGIN, h - 10, { pt: 8, color: [150, 150, 150], align: 'right' });
    }
}
async function getLogo() {
    try {
        const blob = await (await fetch('../assets/logo.png')).blob();
        return await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = reject;
            r.readAsDataURL(blob);
        });
    } catch { return null; }
}

// ---------- the PDF ----------
function buildPdf(report, { fromStr, toStr, logo }) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.getHeight();
    const BOTTOM = pageHeight - 18;
    const { rows, organizedCoursesByKey, loggedGroupsByKey, noOrganizerCount, notShownCount } = report;

    const headed = new Set([1]);
    let continuing = null; // department name shown as "Continued: ..." on a new page
    const pageTop = () => {
        drawMinimalHeader(doc, logo);
        if (!continuing) return 66;
        drawText(doc, 'Continued: ' + continuing, MARGIN, 68, { pt: 9, color: PURPLE, maxWidth: CONTENT_W });
        return 73;
    };
    const newPage = () => { doc.addPage(); headed.add(doc.internal.getNumberOfPages()); return pageTop(); };
    const onTablePage = () => {
        const pg = doc.internal.getCurrentPageInfo().pageNumber;
        if (!headed.has(pg)) { headed.add(pg); pageTop(); }
    };
    const room = (y, needed) => (y + needed > BOTTOM ? newPage() : y);

    // Page 1 header
    const period = (fromStr || toStr)
        ? `${fromStr ? formatDateDDMMYYYY(fromStr) : 'Start'} – ${toStr ? formatDateDDMMYYYY(toStr) : 'Present'}`
        : 'All dates';
    const now = new Date();
    const info = [
        `Generated: ${formatDateDDMMYYYY(now.toISOString())} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        `Period: ${period}`,
        'Organized = activities from Create Activity (Organized By)',
        'Activity Log = courses logged in the Activity Log (one department + one date = one course)'
    ];
    if (noOrganizerCount > 0) info.push(`Activities with no organizer (None): ${noOrganizerCount} — not counted below`);
    if (notShownCount > 0) info.push(`Not shown: ${notShownCount} from departments / institutions no longer in the list (deleted)`);
    let y = drawFullHeader(doc, logo, 'Activities per Department Report', info);

    // Chart: one bar per department, Organized (dark) + Activity Log (light)
    y = room(y, 20);
    drawText(doc, 'Activities per Department', MARGIN, y + 2, { pt: 12, color: [46, 16, 101], bold: true });
    doc.setFillColor(...PURPLE); doc.rect(MARGIN + 62, y - 0.8, 3, 3, 'F');
    drawText(doc, 'Organized', MARGIN + 66.5, y + 1.6, { pt: 8.5, color: [90, 90, 90] });
    doc.setFillColor(196, 181, 253); doc.rect(MARGIN + 84, y - 0.8, 3, 3, 'F');
    drawText(doc, 'Activity Log', MARGIN + 88.5, y + 1.6, { pt: 8.5, color: [90, 90, 90] });
    y += 7;
    const LABEL_W = 68, BAR_X = MARGIN + LABEL_W + 3, BAR_W = CONTENT_W - LABEL_W - 13, ROW_H = 4.6;
    const max = Math.max(1, ...rows.map(r => r.total));
    rows.forEach(r => {
        if (y + ROW_H > BOTTOM) y = newPage() + 2;
        drawText(doc, r.dept, MARGIN + LABEL_W, y + 2.6, { pt: 8, color: [60, 60, 70], align: 'right', maxWidth: LABEL_W });
        doc.setFillColor(243, 240, 251); doc.rect(BAR_X, y + 0.5, BAR_W, 3, 'F');
        const wOrg = BAR_W * r.organized / max, wLog = BAR_W * r.logged / max;
        if (wOrg > 0) { doc.setFillColor(...PURPLE); doc.rect(BAR_X, y + 0.5, wOrg, 3, 'F'); }
        if (wLog > 0) { doc.setFillColor(196, 181, 253); doc.rect(BAR_X + wOrg, y + 0.5, wLog, 3, 'F'); }
        drawText(doc, String(r.total), BAR_X + BAR_W + 2, y + 2.8, { pt: 8, color: TEXT, bold: true });
        y += ROW_H;
    });

    // Summary table
    const sum = f => rows.reduce((a, r) => a + r[f], 0);
    doc.autoTable({
        startY: room(y + 5, 20),
        head: [['#', 'Department', 'Organized', 'Activity Log', 'Total']],
        body: rows.map((r, i) => [String(i + 1), cell(r.dept, 107, null, 9), String(r.organized), String(r.logged), String(r.total)]),
        foot: [[{ content: 'Total', colSpan: 2 }, String(sum('organized')), String(sum('logged')), String(sum('total'))]],
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: 9, cellPadding: PAD, textColor: TEXT, lineColor: [221, 214, 254], lineWidth: 0.2, valign: 'middle' },
        headStyles: { fillColor: PURPLE, textColor: 255, fontStyle: 'bold' },
        footStyles: { fillColor: [237, 233, 254], textColor: PURPLE_DARK, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [250, 248, 255] },
        columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 107 }, 2: { cellWidth: 21, halign: 'center' }, 3: { cellWidth: 23, halign: 'center' }, 4: { cellWidth: 21, halign: 'center', fontStyle: 'bold' } },
        margin: { left: MARGIN, right: MARGIN, top: 66, bottom: 20 },
        rowPageBreak: 'avoid',
        didDrawCell: data => drawImageCell(doc, data),
        didDrawPage: onTablePage
    });

    // Details — where the numbers come from
    const detailRows = rows.filter(r => r.total > 0);
    if (detailRows.length === 0) return doc;
    continuing = null;
    y = newPage();
    drawText(doc, 'Details — where the numbers come from', MARGIN, y + 2, { pt: 14, color: [46, 16, 101], bold: true });
    drawText(doc, 'Organized: every activity counted for the department (Organized By in Create Activity).', MARGIN, y + 9, { pt: 9, color: [90, 90, 90] });
    drawText(doc, 'Activity Log: one department + one date = one course; staff who logged the same department on the same day share one #.', MARGIN, y + 14, { pt: 9, color: [90, 90, 90] });
    y += 22;

    const tableBase = {
        theme: 'grid',
        styles: { font: 'helvetica', fontSize: FONT_PT, cellPadding: PAD, textColor: TEXT, lineColor: [221, 214, 254], lineWidth: 0.2, valign: 'middle' },
        margin: { left: MARGIN, right: MARGIN, top: 73, bottom: 20 },
        rowPageBreak: 'avoid',
        didDrawCell: data => drawImageCell(doc, data),
        didDrawPage: onTablePage
    };
    const byDate = (a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999'));

    detailRows.forEach(r => {
        // Department bar. A small department is kept together on one page.
        continuing = null;
        const orgCount = (organizedCoursesByKey.get(r.key) || []).length;
        const logCount = (loggedGroupsByKey.get(r.key) || []).reduce((n, g) => n + g.entries.length, 0);
        const estimate = 14 + (orgCount ? 12 + orgCount * 6 : 9) + (logCount ? 12 + logCount * 6 : 9);
        y = room(y, estimate < 110 ? estimate : 34);
        doc.setFillColor(237, 233, 254); doc.rect(MARGIN, y, CONTENT_W, 8, 'F');
        doc.setFillColor(...PURPLE); doc.rect(MARGIN, y, 1.2, 8, 'F');
        drawText(doc, `Organized ${r.organized}   |   Activity Log ${r.logged}   |   Total ${r.total}`, MARGIN + CONTENT_W - 3, y + 5.4, { pt: 9, color: PURPLE_DARK, align: 'right' });
        drawText(doc, r.dept, MARGIN + 4, y + 5.6, { pt: 11, color: [76, 29, 149], bold: true, maxWidth: CONTENT_W - 75 });
        continuing = r.dept;
        y += 14;

        // Organized
        const organized = (organizedCoursesByKey.get(r.key) || []).slice()
            .sort((a, b) => byDate(a, b) || String(a.name || '').localeCompare(String(b.name || '')));
        y = room(y, organized.length ? 20 : 9);
        drawText(doc, `Organized (${r.organized})`, MARGIN, y, { pt: 10, color: [109, 40, 217], bold: true });
        if (organized.length === 0) {
            drawText(doc, 'none', MARGIN + 32, y, { pt: 9, color: [140, 140, 150] });
            y += 8;
        } else {
            doc.autoTable({
                ...tableBase,
                startY: y + 2.5,
                head: [['#', 'Activity Name', 'Date', 'Organized With']],
                body: organized.map((a, i) => [String(i + 1), cell(a.name, 82), dateRange(a.date, a.endDate), cell(a.others.join(', '), 58)]),
                headStyles: { fillColor: PURPLE, textColor: 255, fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [250, 248, 255] },
                columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 82 }, 2: { cellWidth: 32 }, 3: { cellWidth: 58 } }
            });
            y = doc.lastAutoTable.finalY + 8;
        }

        // Activity Log: one numbered group per counted course
        const groups = (loggedGroupsByKey.get(r.key) || []).slice().sort(byDate);
        y = room(y, groups.length ? 20 : 9);
        drawText(doc, `Activity Log (${r.logged})`, MARGIN, y, { pt: 10, color: PURPLE, bold: true });
        if (groups.length === 0) {
            drawText(doc, 'none', MARGIN + 36, y, { pt: 9, color: [140, 140, 150] });
            y += 8;
        } else {
            const body = [];
            groups.forEach((g, gi) => {
                const fill = gi % 2 === 1 ? LIGHT : [255, 255, 255];
                const list = g.entries.slice().sort((a, b) => clean(a.staffName).localeCompare(clean(b.staffName)));
                const big = list.length > 12; // a long group: number on every row (a merged cell can't run across pages)
                list.forEach((e, ei) => {
                    const line = [];
                    if (big) line.push({ content: String(gi + 1), styles: { fillColor: fill } });
                    else if (ei === 0) line.push({ content: String(gi + 1), rowSpan: list.length, styles: { fillColor: fill } });
                    line.push(
                        { content: dateRange(e.entry_date_from, e.entry_date_to), styles: { fillColor: fill } },
                        cell(e.title, 56, fill),
                        cell(e.staffName, 44, fill),
                        cell(e.staffNumber, 21, fill),
                        cell(e.phone, 27, fill)
                    );
                    body.push(line);
                });
            });
            doc.autoTable({
                ...tableBase,
                startY: y + 2.5,
                head: [['#', 'Date', 'Title', 'Staff Name', 'Staff No.', 'Phone']],
                body,
                headStyles: { fillColor: [196, 181, 253], textColor: [46, 16, 101], fontStyle: 'bold' },
                columnStyles: { 0: { cellWidth: 10, halign: 'center' }, 1: { cellWidth: 24 }, 2: { cellWidth: 56 }, 3: { cellWidth: 44 }, 4: { cellWidth: 21 }, 5: { cellWidth: 27 } }
            });
            y = doc.lastAutoTable.finalY + 8;
        }
        y += 3;
    });
    continuing = null;
    return doc;
}

// ---------- the button ----------
const note = document.getElementById('adminReportNote');
const btn = document.getElementById('adminReportPrintBtn');
const setNote = (text, isError) => { note.textContent = text || ''; note.className = 'admin-note' + (isError ? ' error' : text ? ' success' : ''); };

btn.addEventListener('click', async () => {
    const fromStr = document.getElementById('adminReportFrom').value;
    const toStr = document.getElementById('adminReportTo').value;
    if (fromStr && toStr && fromStr > toStr) { setNote('"From" is after "To" — please fix the dates.', true); return; }
    if (!window.jspdf || !window.jspdf.jsPDF || !window.jspdf.jsPDF.API.autoTable) { setNote('The PDF tools did not load — check the internet connection and reload the page.', true); return; }

    btn.disabled = true;
    setNote('Building the report…');
    try {
        const [courses, instRes, log, logo] = await Promise.all([
            fetchAllCourses(),
            fetchAllPaged(() => client.from('institutions').select('id, name').order('id', { ascending: true })),
            fetchActivityLog(fromStr, toStr),
            getLogo()
        ]);
        if (instRes.error) throw instRes.error;
        const instNames = (instRes.data || []).map(i => clean(i.name)).filter(Boolean);
        const report = buildReportData(instNames, courses, log, fromStr, toStr);
        if (report.ibraDepts.length === 0) { setNote('No Ibra departments exist yet.', true); return; }

        // Arabic is drawn with Noto Sans Arabic when it loaded (else the system's Arabic font).
        try { await Promise.all([document.fonts.load(`400 20px "Noto Sans Arabic"`, 'ع'), document.fonts.load(`700 20px "Noto Sans Arabic"`, 'ع')]); } catch { /* system font */ }

        const doc = buildPdf(report, { fromStr, toStr, logo });
        addFooters(doc);
        const name = `Activities-per-Department_${fromStr || 'start'}_to_${toStr || 'today'}.pdf`;
        doc.save(name);
        setNote(`Done — ${name} was downloaded (${doc.internal.getNumberOfPages()} pages).`);
    } catch (err) {
        console.error('Admin report failed:', err);
        setNote('Something went wrong: ' + (err && err.message ? err.message : err), true);
    } finally {
        btn.disabled = false;
    }
});
