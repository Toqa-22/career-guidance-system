// js/excel-export.js
//
// Shared by admin/report.js and admin/students.js. Loaded as a plain
// <script> (not type="module") because it depends on the global `XLSX`
// object exposed by xlsx-js-style's browser bundle — that library has to be
// loaded the same way (a plain <script src=".../xlsx.bundle.js">), NOT via
// an ES-module import. The plain 'xlsx' package's free/community build
// silently drops all cell styling (bold, fill color, borders — that's a
// SheetJS Pro-only feature), which is why this project uses this fork
// instead just for the styling support.

const EXCEL_HEADER_STYLE = {
    font: { bold: true, color: { rgb: '374151' } },
    fill: { fgColor: { rgb: 'E5E7EB' } }, // light gray
    alignment: { horizontal: 'center', vertical: 'center' },
    border: {
        top: { style: 'thin', color: { rgb: 'D1D5DB' } },
        bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
        left: { style: 'thin', color: { rgb: 'D1D5DB' } },
        right: { style: 'thin', color: { rgb: 'D1D5DB' } }
    }
};

const EXCEL_CELL_STYLE = {
    alignment: { vertical: 'center' },
    border: {
        top: { style: 'thin', color: { rgb: 'E5E7EB' } },
        bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
        left: { style: 'thin', color: { rgb: 'E5E7EB' } },
        right: { style: 'thin', color: { rgb: 'E5E7EB' } }
    }
};

function excelTodayStamp() {
    const d = new Date();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
}

// headers: string[]
// rows: array of arrays (same column order as headers)
// filenameBase: file name without extension or date (the date is added automatically)
// sheetName: worksheet tab name
// textColumnIndexes: column indexes that must stay plain text (phone numbers,
//   staff numbers, dates) so Excel doesn't reinterpret/reformat them.
// columnAlignments: optional { [colIndex]: { horizontal?: 'left'|'center'|'right', wrapText?: boolean } }
//   overrides for DATA cells only (the header row keeps its own centered
//   style regardless) — e.g. forcing a numeric "#" column left instead of
//   Excel's default right-alignment for numbers, or wrapping a cell that
//   holds several lines of text.
function exportStyledExcel(headers, rows, filenameBase, sheetName, textColumnIndexes = [], columnAlignments = {}) {
    if (!rows || rows.length === 0) {
        alert('No records found to export.');
        return false;
    }

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const range = XLSX.utils.decode_range(worksheet['!ref']);

    // Auto-size every column to fit its longest piece of content (header
    // included), with extra breathing room so text never feels cramped.
    worksheet['!cols'] = headers.map((header, colIndex) => {
        let maxLen = String(header).length;
        rows.forEach(row => {
            const len = String(row[colIndex] ?? '').length;
            if (len > maxLen) maxLen = len;
        });
        return { wch: maxLen + 4 };
    });

    // Taller rows read far better than Excel's cramped default height —
    // and taller still for any row whose wrapText column holds multiple
    // lines (see columnAlignments), so wrapped text isn't visually clipped
    // by a fixed single-line row height.
    const wrapTextColumns = Object.keys(columnAlignments).filter(c => columnAlignments[c].wrapText).map(Number);
    worksheet['!rows'] = [{ hpt: 24 }, ...rows.map(row => {
        let maxLines = 1;
        wrapTextColumns.forEach(colIndex => {
            const lines = String(row[colIndex] ?? '').split('\n').length;
            if (lines > maxLines) maxLines = lines;
        });
        return { hpt: 21 * maxLines };
    })];

    // Style the header row: bold dark-gray text on a light gray fill, centered.
    for (let col = range.s.c; col <= range.e.c; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
        if (worksheet[cellRef]) worksheet[cellRef].s = EXCEL_HEADER_STYLE;
    }

    // Border every data cell so the table reads as one bounded block rather
    // than blending into Excel's default infinite gridlines. Any column-
    // specific alignment/wrapText override (columnAlignments) is merged in
    // per cell here.
    for (let row = range.s.r + 1; row <= range.e.r; row++) {
        for (let col = range.s.c; col <= range.e.c; col++) {
            const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
            if (worksheet[cellRef]) {
                const override = columnAlignments[col];
                worksheet[cellRef].s = override
                    ? { ...EXCEL_CELL_STYLE, alignment: { ...EXCEL_CELL_STYLE.alignment, ...override } }
                    : EXCEL_CELL_STYLE;
            }
        }
    }

    // Excel draws its gridlines through every cell that has no fill color —
    // that's what makes an exported sheet look like it's floating in an
    // infinite empty grid. Painting a plain white (borderless) fill over a
    // generous area beyond the actual table covers those gridlines there,
    // so opening the file looks like a clean white page with just the
    // bordered data table on it, instead of the table blending into rows
    // and columns of empty gridlines.
    const EXTRA_COLS_BEYOND_DATA = 10;
    const EXTRA_ROWS_BEYOND_DATA = 60;
    const totalCols = range.e.c + 1 + EXTRA_COLS_BEYOND_DATA;
    const totalRows = range.e.r + 1 + EXTRA_ROWS_BEYOND_DATA;

    for (let r = 0; r < totalRows; r++) {
        for (let c = 0; c < totalCols; c++) {
            if (r <= range.e.r && c <= range.e.c) continue; // leave the real table alone
            const cellRef = XLSX.utils.encode_cell({ r, c });
            if (!worksheet[cellRef]) worksheet[cellRef] = { t: 's', v: '' };
            worksheet[cellRef].s = { fill: { fgColor: { rgb: 'FFFFFF' } } };
        }
    }
    worksheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRows - 1, c: totalCols - 1 } });

    // Force the text-only columns to stay as strings.
    textColumnIndexes.forEach(colIndex => {
        for (let row = range.s.r + 1; row <= range.e.r; row++) {
            const cellRef = XLSX.utils.encode_cell({ r: row, c: colIndex });
            if (worksheet[cellRef]) worksheet[cellRef].t = 's';
        }
    });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    XLSX.writeFile(workbook, `${filenameBase}_${excelTodayStamp()}.xlsx`);

    alert(`Exported ${rows.length} record${rows.length === 1 ? '' : 's'} successfully.`);
    return true;
}

window.exportStyledExcel = exportStyledExcel;

// ============================================================================
// Green bilingual "Training Data Record" template export — shared by the
// Participant Registrations page (js/students.js, one course/filtered view)
// and the Activity Dashboard's "All Activities" report (js/dashboard.js,
// every participant across every course). This deliberately does NOT reuse
// exportStyledExcel()/EXCEL_HEADER_STYLE above — that helper only ever
// builds a single-row plain header and has no concept of merged multi-row
// headers, so it can't produce this sheet's structure. It stays untouched
// and generic (gray header) for every other export in the project; this is
// a separate, purpose-built sheet matching the official Ministry template:
//   مديرية شمال الشرقية - سجل بيانات التدريب.xlsx
// (RTL sheet, green A8D08D merged bilingual headers, Day/Month/Year split
// date sub-columns). Built manually with aoa-free per-cell placement
// (like js/program-form.js's export) since the structure needs merges the
// generic helper doesn't support.
// ============================================================================
const TEMPLATE_GREEN_FILL = 'A8D08D';
// The official template's top spacer bar (row 1) is a DARKER green than the
// header rows — confirmed by inspecting the reference .xlsx cell-by-cell.
const TEMPLATE_SPACER_FILL = '548135';
const TEMPLATE_RED_FONT = 'FF0000';
const TEMPLATE_THIN_BORDER = { style: 'thin', color: { rgb: '000000' } };
const TEMPLATE_ALL_BORDERS = { top: TEMPLATE_THIN_BORDER, bottom: TEMPLATE_THIN_BORDER, left: TEMPLATE_THIN_BORDER, right: TEMPLATE_THIN_BORDER };

function templateSpacerStyle() {
    return {
        font: { name: 'Times New Roman', sz: 12 },
        fill: { fgColor: { rgb: TEMPLATE_SPACER_FILL } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
    };
}
function templateHeaderStyle(redFont) {
    return {
        font: { name: 'Times New Roman', sz: 12, bold: true, color: { rgb: redFont ? TEMPLATE_RED_FONT : '000000' } },
        fill: { fgColor: { rgb: TEMPLATE_GREEN_FILL } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: TEMPLATE_ALL_BORDERS
    };
}
function templateDataStyle() {
    return {
        font: { name: 'Times New Roman', sz: 13, color: { rgb: '000000' } },
        fill: { fgColor: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: TEMPLATE_ALL_BORDERS
    };
}

// Splits a date (Date object, 'YYYY-MM-DD' string, or any parseable date
// string/timestamp) into the template's separate Day/Month/Year numbers.
// Returns blanks (never fabricated values) when there's nothing to parse.
function templateSplitDate(dateInput) {
    if (!dateInput) return { day: '', month: '', year: '' };
    const d = dateInput instanceof Date ? dateInput : new Date(
        typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput) ? `${dateInput}T00:00:00` : dateInput
    );
    if (isNaN(d.getTime())) return { day: '', month: '', year: '' };
    return { day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() };
}

// participants: array of {
//   staff_name, staff_number, designation, job_level, sex, nationality,
//   education_qualification, experience_years, organization, directorate,
//   program_title, program_type, training_domains, start_date, end_date,
//   attendance_nature, hrd_plan, department
// } — any field with no real data source should be left undefined/'' by the
// caller rather than invented here. `department` is an extra column beyond
// the official template (column W) — the "Organized By" department chosen
// for this row (for a self-log/no-attendance course, one row per logged
// entry — see js/students.js's exportCSV and js/dashboard.js's
// exportAllActivities for how `program_title`/`start_date`/`end_date`/
// `department` are populated per-entry instead of per-course for those).
function exportGreenTemplateExcel(participants, filenameBase) {
    if (!participants || participants.length === 0) {
        alert('No records found to export.');
        return false;
    }

    // Order rows by تاريخ بدء البرنامج / program start date (ascending).
    // Rows with a missing/unparseable start_date sort to the end rather
    // than being dropped, and equal dates keep their original relative
    // order (stable sort) instead of being shuffled.
    const startDateSortKey = (p) => {
        const raw = p && p.start_date;
        if (!raw) return Infinity;
        const d = raw instanceof Date ? raw : new Date(
            typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw
        );
        const t = d.getTime();
        return isNaN(t) ? Infinity : t;
    };
    participants = participants
        .map((p, idx) => ({ p, idx, key: startDateSortKey(p) }))
        .sort((a, b) => (a.key - b.key) || (a.idx - b.idx))
        .map(({ p }) => p);

    const ws = {};
    const setCell = (addr, value, style) => {
        const isNum = typeof value === 'number';
        ws[addr] = { v: value == null ? '' : value, t: isNum ? 'n' : 's', s: style };
    };

    // Row 1 — the official template's decorative top spacer bar: a solid
    // darker-green strip across every column, with a single stray "*/" in
    // A1. This is present in the real reference file exactly as-is (every
    // A1:V1 cell shares the darker fill, only A1 has the text) — reproduced
    // faithfully here since the ask is to match the official file exactly.
    for (const col of 'ABCDEFGHIJKLMNOPQRSTUVW') {
        setCell(`${col}1`, col === 'A' ? '*/' : '', templateSpacerStyle());
    }

    // Row 2 — main bilingual headers (each merged down into row 3 except the
    // split-date group headers, which merge ACROSS into their 3 sub-columns
    // instead and get their own Day/Month/Year captions in row 3).
    const headerRow2 = {
        A2: 'Full Name /   الاسم الكامل',
        B2: 'Staff Number/ الرقم الوظيفي',
        C2: 'المسمى الوظيفي / DESIGNATION ',
        D2: 'المستوى الوظيفي / Job Level',
        E2: 'Gender/الجنس',
        F2: 'الجنسية / NATIONALITY ',
        G2: 'أعلى مؤهل دراسي / Highest educational qualification',
        H2: 'سنوات الخبرة/ experience years',
        I2: 'جهة العمل / Employer',
        J2: 'المديرية/ directorate',
        K2: 'عنوان البرنامج | TITLE OF PROGRAM',
        L2: 'نوع البرنامج| Type of Program',
        M2: 'المجالات التدريبية  / Training Domains',
        N2: 'تاريخ بدء البرنامج / program start date',
        Q2: 'تاريخ إنتهاء البرنامج / program end date',
        T2: 'طبيعة الحضور | Nature of Attendance',
        U2: '',
        V2: 'هل البرنامج مدرج في خطة تنمية الموارد البشرية المعتمدة | included in the approved HRD plan',
        // Not part of the official Ministry template — an extra column the
        // hospital asked for on top of it, showing which department the
        // participant was "Organized By" for this specific title/entry
        // (same list as js/activity-log.js's "Organized By" dropdown).
        W2: 'القسم / Organized By (Department)'
    };
    Object.entries(headerRow2).forEach(([addr, val]) => {
        setCell(addr, val, templateHeaderStyle(false));
    });

    // Every OTHER header (everything except the split-date groups) merges
    // vertically down into row 3 (e.g. A2:A3). A merged range only looks
    // right end-to-end if the covered-but-hidden row-3 cell also carries the
    // same bordered style — otherwise that cell is blank/unstyled and the
    // divider line between two adjacent headers (e.g. the seam between
    // column A and column B) only shows in row 2 and cuts off before row 3.
    // So every one of these columns gets its own row-3 mirror cell here,
    // styled identically to its row-2 header — everything EXCEPT N-S, which
    // aren't a simple vertical merge (they hold the real Day/Month/Year
    // sub-header content instead, handled separately below).
    'ABCDEFGHIJKLM'.split('').concat(['T', 'U', 'V', 'W']).forEach(col => {
        setCell(`${col}3`, '', templateHeaderStyle(false));
    });

    // Row 3 — Day/Month/Year sub-headers under the two split-date groups.
    // All six (Day, Month AND Year) are red font, upright (no rotation),
    // each with its own full thin border on all sides — a separator line
    // between Day/Month/Year, same as between every other pair of columns.
    const headerRow3 = {
        N3: 'اليوم/ Day ', O3: 'الشهر / month', P3: 'السنة / year',
        Q3: 'اليوم/ Day ', R3: 'الشهر / month', S3: 'السنة / year'
    };
    Object.entries(headerRow3).forEach(([addr, val]) => {
        setCell(addr, val, templateHeaderStyle(true));
    });

    let row = 4;
    participants.forEach(p => {
        const start = templateSplitDate(p.start_date);
        const end = templateSplitDate(p.end_date);
        const style = templateDataStyle();
        const vals = {
            [`A${row}`]: p.staff_name || '',
            [`B${row}`]: p.staff_number || '',
            [`C${row}`]: p.designation || '',
            [`D${row}`]: p.job_level || '',
            [`E${row}`]: p.sex || '',
            [`F${row}`]: p.nationality || '',
            [`G${row}`]: p.education_qualification || '',
            [`H${row}`]: p.experience_years || '',
            [`I${row}`]: p.organization || '',
            [`J${row}`]: p.directorate || '',
            [`K${row}`]: p.program_title || '',
            [`L${row}`]: p.program_type || '',
            [`M${row}`]: p.training_domains || '',
            [`N${row}`]: start.day, [`O${row}`]: start.month, [`P${row}`]: start.year,
            [`Q${row}`]: end.day, [`R${row}`]: end.month, [`S${row}`]: end.year,
            [`T${row}`]: p.attendance_nature || '',
            [`V${row}`]: p.hrd_plan || '',
            [`W${row}`]: p.department || ''
        };
        Object.entries(vals).forEach(([addr, val]) => setCell(addr, val, style));
        // Staff number must stay text — otherwise Excel may drop a leading
        // zero or reformat a long numeric-looking staff number.
        ws[`B${row}`].t = 's';
        row++;
    });

    const lastRow = row - 1;
    ws['!ref'] = `A1:W${lastRow}`;
    // Merges are 0-indexed: row 0 = spacer (row 1), row 1 = main headers
    // (row 2), row 2 = Day/Month/Year sub-headers (row 3), row 3+ = data.
    ws['!merges'] = [
        { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },   // A2:A3
        { s: { r: 1, c: 1 }, e: { r: 2, c: 1 } },   // B2:B3
        { s: { r: 1, c: 2 }, e: { r: 2, c: 2 } },   // C2:C3
        { s: { r: 1, c: 3 }, e: { r: 2, c: 3 } },   // D2:D3
        { s: { r: 1, c: 4 }, e: { r: 2, c: 4 } },   // E2:E3
        { s: { r: 1, c: 5 }, e: { r: 2, c: 5 } },   // F2:F3
        { s: { r: 1, c: 6 }, e: { r: 2, c: 6 } },   // G2:G3
        { s: { r: 1, c: 7 }, e: { r: 2, c: 7 } },   // H2:H3
        { s: { r: 1, c: 8 }, e: { r: 2, c: 8 } },   // I2:I3
        { s: { r: 1, c: 9 }, e: { r: 2, c: 9 } },   // J2:J3
        { s: { r: 1, c: 10 }, e: { r: 2, c: 10 } }, // K2:K3
        { s: { r: 1, c: 11 }, e: { r: 2, c: 11 } }, // L2:L3
        { s: { r: 1, c: 12 }, e: { r: 2, c: 12 } }, // M2:M3
        { s: { r: 1, c: 13 }, e: { r: 1, c: 15 } }, // N2:P2
        { s: { r: 1, c: 16 }, e: { r: 1, c: 18 } }, // Q2:S2
        { s: { r: 1, c: 19 }, e: { r: 2, c: 19 } }, // T2:T3
        { s: { r: 1, c: 20 }, e: { r: 2, c: 20 } }, // U2:U3
        { s: { r: 1, c: 21 }, e: { r: 2, c: 21 } }, // V2:V3
        { s: { r: 1, c: 22 }, e: { r: 2, c: 22 } }  // W2:W3 (extra "Organized By" column, not in the official template)
    ];
    // Column widths (A-V) copied EXACTLY from the confirmed reference export
    // (measured cell-by-cell via openpyxl); column W ("Organized By") is the
    // hospital's own extra column, not part of that reference, so it keeps
    // its own separately-chosen width.
    ws['!cols'] = [
        { wch: 34.83 }, { wch: 15.83 }, { wch: 28.83 }, { wch: 16.83 }, { wch: 16.83 },
        { wch: 18.83 }, { wch: 26.83 }, { wch: 20.83 }, { wch: 22.83 }, { wch: 34.83 },
        { wch: 36.83 }, { wch: 28.83 }, { wch: 32.83 }, { wch: 8.83 }, { wch: 8.83 },
        { wch: 10.83 }, { wch: 8.83 }, { wch: 8.83 }, { wch: 10.83 }, { wch: 24.83 },
        { wch: 10.83 }, { wch: 34.83 }, { wch: 22 }
    ];
    // Row heights copied exactly too: row 1 (spacer) 19pt, row 2 (main
    // headers) 94pt, row 3 (Day/Month/Year, upright — no rotation) 34pt,
    // data rows 15.75pt.
    ws['!rows'] = [{ hpt: 19 }, { hpt: 94 }, { hpt: 34 }, ...participants.map(() => ({ hpt: 15.75 }))];

    const workbook = XLSX.utils.book_new();
    const sheetName = 'بيانات المشاركين | Participant';
    XLSX.utils.book_append_sheet(workbook, ws, sheetName);
    workbook.Sheets[sheetName]['!dir'] = 'rtl';
    if (!workbook.Workbook) workbook.Workbook = {};
    workbook.Workbook.Views = [{ RTL: true }];

    XLSX.writeFile(workbook, `${filenameBase}_${excelTodayStamp()}.xlsx`);
    alert(`Exported ${participants.length} record${participants.length === 1 ? '' : 's'} successfully.`);
    return true;
}

window.exportGreenTemplateExcel = exportGreenTemplateExcel;
