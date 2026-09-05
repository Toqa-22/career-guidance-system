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
function exportStyledExcel(headers, rows, filenameBase, sheetName, textColumnIndexes = []) {
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

    // Taller rows read far better than Excel's cramped default height.
    worksheet['!rows'] = [{ hpt: 24 }, ...rows.map(() => ({ hpt: 21 }))];

    // Style the header row: bold dark-gray text on a light gray fill, centered.
    for (let col = range.s.c; col <= range.e.c; col++) {
        const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
        if (worksheet[cellRef]) worksheet[cellRef].s = EXCEL_HEADER_STYLE;
    }

    // Border every data cell so the table reads as one bounded block rather
    // than blending into Excel's default infinite gridlines.
    for (let row = range.s.r + 1; row <= range.e.r; row++) {
        for (let col = range.s.c; col <= range.e.c; col++) {
            const cellRef = XLSX.utils.encode_cell({ r: row, c: col });
            if (worksheet[cellRef]) worksheet[cellRef].s = EXCEL_CELL_STYLE;
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
