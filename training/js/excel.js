// ============================================================================
// excel.js
// تصدير بيانات المتدربين إلى ملف Excel باستخدام SheetJS
// ============================================================================

const EXCEL_HEADERS = [
  "اسم الطالب",
  "رقم الهاتف",
  "التخصص",
  "القسم",
  "بداية التدريب",
  "نهاية التدريب",
  "مدة التدريب",
  "تاريخ التسجيل",
];

function buildExcelRows(students){
  return students.map(s => ([
    s.student_name || "",
    s.phone || "",
    s.specialization || "",
    s.department || "",
    formatDateShort(s.training_start),
    formatDateShort(s.training_end),
    formatDurationLabel(calcDurationDays(s.training_start, s.training_end)),
    formatDateShort(s.registration_date),
  ]));
}

function exportStudentsToExcel(students){
  if (!students || students.length === 0){
    showToast("لا توجد بيانات لتصديرها", "warning");
    return;
  }

  const rows = [EXCEL_HEADERS, ...buildExcelRows(students)];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);

  // عرض أعمدة تلقائي بحسب أطول محتوى في كل عمود
  const colWidths = EXCEL_HEADERS.map((header, colIndex) => {
    let maxLen = header.length;
    rows.forEach(row => {
      const cell = row[colIndex] ? String(row[colIndex]) : "";
      maxLen = Math.max(maxLen, cell.length);
    });
    return { wch: maxLen + 4 };
  });
  worksheet["!cols"] = colWidths;

  // اتجاه الورقة من اليمين لليسار
  worksheet["!dir"] = "rtl";

  // تنسيق الرأس بخط عريض
  const headerRange = XLSX.utils.decode_range(worksheet["!ref"]);
  for (let col = headerRange.s.c; col <= headerRange.e.c; col++){
    const cellRef = XLSX.utils.encode_cell({ r: 0, c: col });
    if (!worksheet[cellRef]) continue;
    worksheet[cellRef].s = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "0F6CBD" } },
      alignment: { horizontal: "center", vertical: "center" },
    };
  }

  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(workbook, worksheet, "سجل المتدربين");

  const fileName = `سجل_المتدربين_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(workbook, fileName, { cellStyles: true });

  showToast("تم تصدير ملف Excel بنجاح", "success");
}
