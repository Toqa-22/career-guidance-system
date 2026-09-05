// ============================================================================
// reports.js
// منطق صفحة التقارير (reports.html) بالكامل: جلب بيانات المتدربين (بلا فترة
// تدريب محددة مستبعدة تلقائياً عبر fetchAllStudents())، فلترة محلية حسب
// الفترة المشتركة (تاريخ بداية التدريب)، ثم بناء وطباعة كل تقرير من التقارير
// الأربعة عبر printReportHTML() (المعرَّفة في js/report.js — نفس آلية طباعة
// لوحة الإدارة وتقرير كل متدرب، بلا نافذة منفصلة).
//
// الاعتماديات المطلوب تحميلها قبل هذا الملف (بنفس الترتيب في reports.html):
//   1) js/config.js       — بيانات الاتصال بـ Supabase
//   2) js/departments.js  — يوفر CATEGORIES وfindCategoryForDepartment() (لتقرير الفئات)
//   3) js/ui.js            — يوفر showToast
//   4) js/supabase.js      — يوفر fetchAllStudents() وescapeHtml()
//   5) js/report.js        — يوفر printReportHTML() وLOGO_IMAGE_DATA_URI
//                             وHOSPITAL_NAME وHOSPITAL_SUBTITLE
// ============================================================================

const reportsState = {
  allStudents: [], // كل المتدربين ذوي فترة تدريب محددة (بلا قائمة الانتظار)
};

document.addEventListener("DOMContentLoaded", async () => {
  bindReportButtons();
  try {
    reportsState.allStudents = await fetchAllStudents();
  } catch (err){
    console.error("تعذر تحميل بيانات المتدربين:", err);
    showToast("تعذر تحميل بيانات المتدربين", "error");
    reportsState.allStudents = [];
  }
});

// ---------------------------------------------------------------------------
// فلترة الفترة المشتركة (حسب تاريخ بداية التدريب فقط)
// ---------------------------------------------------------------------------
/**
 * تُرجع قائمة المتدربين الذين تبدأ فترة تدريبهم ضمن الفترة المحددة في حقلي
 * repFrom/repTo أعلى الصفحة. حقل فارغ (من أو إلى أو كلاهما) يعني عدم تحديد
 * حد لتلك الجهة — فترة فارغة بالكامل تعني كل السجلات دون استثناء.
 * @returns {{list:Array, periodFrom:string, periodTo:string}}
 */
function getFilteredReportStudents(){
  const from = document.getElementById("repFrom").value;
  const to = document.getElementById("repTo").value;

  const list = reportsState.allStudents.filter(s => {
    if (!s.training_start) return false;
    if (from && s.training_start < from) return false;
    if (to && s.training_start > to) return false;
    return true;
  });

  return { list, periodFrom: from, periodTo: to };
}

/**
 * نص وصف الفترة المختارة، لعرضه في شريط الملخص أعلى كل تقرير.
 */
function reportPeriodLabel(periodFrom, periodTo){
  if (!periodFrom && !periodTo) return "جميع الفترات";
  return `الفترة: من ${periodFrom ? formatDateShort(periodFrom) : "البداية"} إلى ${periodTo ? formatDateShort(periodTo) : "الآن"}`;
}

// ---------------------------------------------------------------------------
// ربط أزرار التقارير الأربعة
// ---------------------------------------------------------------------------
function bindReportButtons(){
  document.getElementById("printDeptsReportBtn").addEventListener("click", () => {
    printDepartmentsReport();
  });
  document.getElementById("printCategoriesReportBtn").addEventListener("click", () => {
    printCategoriesReport();
  });
  document.getElementById("printCollegesReportBtn").addEventListener("click", () => {
    printCollegesReport();
  });
  document.getElementById("printDetailedReportBtn").addEventListener("click", () => {
    printDetailedReport();
  });
  document.getElementById("exportKashf3Btn").addEventListener("click", () => {
    exportKashf3Report();
  });
}

// ---------------------------------------------------------------------------
// دالة مساعدة عامة: تجميع عدد المتدربين حسب حقل معيّن (القسم أو الكلية)
// ---------------------------------------------------------------------------
/**
 * تُجمِّع قائمة متدربين حسب قيمة حقل معيّن (مثلاً department أو college)،
 * وتُرجع مصفوفة {label, count} مرتبة أبجدياً عربياً. count هنا هو عدد صفوف
 * الالتحاق الفعلي بهذا القسم/الكلية تحديداً (وهو الصحيح لهذا السياق: صف
 * واحد = التحاق فعلي واحد بذلك القسم)، وليس عدد الأفراد الفريدين — لحساب
 * الإجمالي الكلي الصحيح (متدرب واحد يُحتسب مرة واحدة حتى لو التحق بأكثر من
 * قسم) استخدم countUniqueStudents() على القائمة كاملة بدل الاعتماد على
 * total المُرجَعة من هنا. القيم الفارغة/الناقصة تُجمَّع تحت تسمية "غير محدد"
 * بدل إسقاطها من التقرير.
 * @param {Array} list - قائمة سجلات المتدربين
 * @param {string} field - اسم الحقل المطلوب التجميع بحسبه
 * @returns {{rows:Array<{label:string,count:number}>}}
 */
function groupCountByField(list, field){
  const map = new Map();
  list.forEach(s => {
    const key = (s[field] || "").trim() || "غير محدد";
    map.set(key, (map.get(key) || 0) + 1);
  });
  const rows = Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label, "ar"));
  return { rows };
}

/**
 * مفتاح تمييز فريد لكل متدرب (شخص حقيقي واحد)، بحسب رقم الهاتف (حقل إلزامي
 * وأكثر الحقول موثوقية لتمييز شخص عن آخر عند التسجيل)، مع رجوع احتياطي
 * لاسم الطالب فقط في الحالة النادرة لسجل بلا رقم هاتف. تُستخدم داخلياً من
 * countUniqueStudents() وcomputeUniqueDetailedTotals() فقط.
 * @param {object} s - سجل متدرب واحد
 * @returns {string} مفتاح فريد لهذا الشخص
 */
function studentUniqueKey(s){
  const phone = (s.phone || "").trim();
  return phone || `name:${(s.student_name || "").trim()}`;
}

/**
 * عدّ عدد الأفراد الفريدين (لا عدد صفوف التسجيل) ضمن قائمة سجلات متدربين.
 * كل متدرب مُلتحق بأكثر من قسم يُنشئ له سجلاً منفصلاً لكل قسم (راجع
 * insertStudentsWithPeriods في js/supabase.js)، فعدّ الصفوف مباشرة (list.length)
 * يُضاعِف عدد نفس الشخص بعدد الأقسام التي التحق بها. تُستخدم لحساب الإجمالي
 * الكلي المعروض أعلى كل تقرير وفي صف "الإجمالي" في التقارير الثلاثة الأولى
 * فقط (الأقسام/الفئات/الجامعات) — أما عدد المتدربين داخل كل قسم/فئة/كلية
 * على حدة فيبقى عدد صفوف كما هو (كل صف = التحاق فعلي بذلك القسم تحديداً).
 * @param {Array} list - قائمة سجلات المتدربين
 * @returns {number} عدد الأفراد الفريدين
 */
function countUniqueStudents(list){
  const keys = new Set();
  list.forEach(s => keys.add(studentUniqueKey(s)));
  return keys.size;
}

// ---------------------------------------------------------------------------
// الترويسة المشتركة لكل تقرير (الشعار + اسم المستشفى + اسم القسم + عنوان التقرير)
// ---------------------------------------------------------------------------
/**
 * ترويسة موحّدة أعلى كل تقرير من التقارير الثلاثة: شعار المستشفى، اسم
 * المستشفى، اسم قسم التطوير والتوجيه المهني، ثم عنوان التقرير نفسه وتاريخ
 * إصداره. تُستخدم داخلياً من دوال بناء التقارير الثلاثة فقط.
 * @param {string} title - عنوان التقرير المطلوب عرضه
 * @returns {string} نص HTML لعنصر .report-header جاهز للتضمين
 */
function reportHeaderHTML(title){
  const generatedOn = new Date().toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
  return `
  <div class="report-header">
    <img src="${LOGO_IMAGE_DATA_URI}" alt="شعار المستشفى" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'logo-fallback',textContent:'إ'}))">
    <h1>${HOSPITAL_NAME}</h1>
    <h2>${HOSPITAL_SUBTITLE}</h2>
    <div class="r-title">${escapeHtml(title)}</div>
    <div class="r-date">تاريخ إصدار التقرير: ${generatedOn}</div>
  </div>`;
}

/**
 * تُغلِّف جدول تقرير جاهز داخل صفحة HTML كاملة قابلة للطباعة مباشرة عبر
 * printReportHTML()، بنفس تنسيق تقرير لوحة الإدارة العام (buildBulkReportHTML
 * في js/report.js) لكن بحجم صفحة قابل للتخصيص (عمودي للتقريرين الأول
 * والثاني، أفقي للتقرير التفصيلي بسبب عدد أعمدته).
 * @param {string} title - عنوان التقرير (يُستخدم أيضاً كعنوان مستند الطباعة)
 * @param {string} periodLabel - نص وصف الفترة المختارة لعرضه في شريط الملخص
 * @param {number} total - إجمالي عدد السجلات، لعرضه في شريط الملخص
 * @param {string} tableHtml - نص HTML كامل لعنصر <table> التقرير (colgroup/thead/tbody)
 * @param {"portrait"|"landscape"} orientation - اتجاه صفحة الطباعة
 * @returns {string} نص HTML كامل جاهز لتمريره إلى printReportHTML()
 */
function buildReportPageHTML(title, periodLabel, total, tableHtml, orientation){
  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  @page{ size: A4 ${orientation}; margin: 12mm; }

  *{ box-sizing:border-box; }
  body{
    font-family:'Cairo', Tahoma, sans-serif;
    direction: rtl;
    color:#1B2A3A;
    margin:0 auto;
    padding: 24px 30px;
    max-width: ${orientation === "landscape" ? "1150px" : "760px"};
  }
  .report-header{
    display:flex;
    flex-direction:column;
    align-items:center;
    text-align:center;
    padding-bottom:18px;
    border-bottom: 3px solid #0F6CBD;
    margin-bottom: 20px;
  }
  .report-header img{ width:64px; height:64px; object-fit:contain; margin-bottom:10px; }
  .report-header .logo-fallback{
    width:64px;height:64px;border-radius:14px;
    background: linear-gradient(135deg,#0F6CBD,#0A8F6A);
    color:#fff; font-weight:800; font-size:24px;
    display:flex;align-items:center;justify-content:center;
    margin-bottom:10px;
  }
  .report-header h1{ margin:0; font-size:21px; font-weight:800; color:#0F6CBD; }
  .report-header h2{ margin:4px 0 0; font-size:13.5px; font-weight:700; color:#4B5D71; }
  .report-header .r-title{ margin-top:10px; font-size:15px; font-weight:800; color:#1B2A3A; }
  .report-header .r-date{ margin-top:6px; font-size:11.5px; color:#8A97A6; }

  .summary-bar{
    display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;
    background:#F5F7FA; border-radius:12px; padding:12px 18px; margin-bottom:6px;
    font-size:12.6px; font-weight:700; color:#31465C;
  }
  .summary-bar span.count{ color:#0A8F6A; }
  .unique-note{
    margin:0 4px 20px; font-size:10.5px; color:#8A97A6; font-weight:600;
  }

  table{
    width:100%;
    border-collapse:collapse;
    table-layout: fixed;
    margin-bottom: 20px;
  }
  table, th, td{ border-left:none; border-right:none; border-top:none; }
  thead{ display: table-header-group; }
  tbody{ display: table-row-group; }
  tr{ page-break-inside: avoid; }

  thead th{
    background:#0F6CBD; color:#fff; font-size:11px; font-weight:800;
    padding:9px 6px; text-align:center;
    word-break: break-word;
  }
  tbody td{
    padding:8px 6px; font-size:11px; text-align:center;
    border-bottom:1px solid #E3E8EE;
    word-break: break-word;
  }
  tbody tr:nth-child(even){ background:#FAFCFE; }
  tbody tr.total-row td{
    background:#E9F1FC; color:#0F6CBD; font-weight:800; font-size:11.5px;
    border-top:2px solid #0F6CBD;
  }

  .report-footer{
    text-align:center; font-size:11px; color:#8A97A6; margin-top: 30px;
    border-top:1px dashed #E3E8EE; padding-top:14px;
  }

  @media print{
    body{ padding:0; max-width:none; }
  }

  @media (max-width: 640px){
    body{ padding: 18px 14px; }
    .report-header img, .report-header .logo-fallback{ width:52px; height:52px; }
    .report-header h1{ font-size:18px; }
    thead th, tbody td{ font-size:10px; padding:6px 4px; }
  }
</style>
</head>
<body>

  ${reportHeaderHTML(title)}

  <div class="summary-bar">
    <span>${periodLabel}</span>
    <span>عدد المتدربين: <span class="count">${total}</span></span>
  </div>
  <p class="unique-note">* كل متدرب يُحتسب مرة واحدة في الإجمالي الكلي أعلاه حتى لو التحق بأكثر من قسم</p>

  ${tableHtml}

  <div class="report-footer">
    هذا التقرير صادر آلياً من نظام تسجيل وإدارة المتدربين — ${HOSPITAL_SUBTITLE}
  </div>

</body>
</html>`;
}

// ---------------------------------------------------------------------------
// التقرير الأول: عدد المتدربين بأقسام المستشفى
// ---------------------------------------------------------------------------
function printDepartmentsReport(){
  const { list, periodFrom, periodTo } = getFilteredReportStudents();
  if (list.length === 0){
    showToast("لا يوجد متدربون ضمن هذه الفترة", "warning");
    return;
  }

  const { rows } = groupCountByField(list, "department");
  const total = countUniqueStudents(list);
  const bodyRows = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td>${r.count}</td>
    </tr>`).join("");

  const tableHtml = `
  <table>
    <colgroup>
      <col style="width:70%">
      <col style="width:30%">
    </colgroup>
    <thead>
      <tr>
        <th>القسم</th>
        <th>عدد المتدربين</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="total-row">
        <td>الإجمالي</td>
        <td>${total}</td>
      </tr>
    </tbody>
  </table>`;

  const html = buildReportPageHTML(
    "تقرير عدد المتدربين بأقسام المستشفى",
    reportPeriodLabel(periodFrom, periodTo),
    total,
    tableHtml,
    "portrait"
  );
  printReportHTML(html);
}

// ---------------------------------------------------------------------------
// التقرير الثاني: عدد المتدربين بفئات المستشفى
// ---------------------------------------------------------------------------
/**
 * تُجمِّع قائمة متدربين حسب الفئة الرئيسية التي ينتمي إليها قسم كل متدرب
 * (عبر findCategoryForDepartment() في js/departments.js، بحسب هيكل CATEGORIES
 * الأربع: الفئات الطبية، الفئات الطبية المساعدة، الأقسام الإدارية، أقسام
 * الهندسة والصيانة)، وتُرجع مصفوفة {label, count} مرتبة أبجدياً عربياً.
 * count هنا هو عدد صفوف الالتحاق الفعلي بتلك الفئة (وليس عدد الأفراد
 * الفريدين — راجع تعليق countUniqueStudents أعلاه لتفاصيل الفرق). أي قسم
 * لا ينتمي لأي فئة معروفة (لا يُفترض حدوثه عادة) يُجمَّع تحت تسمية "غير
 * محدد" بدل إسقاطه من التقرير.
 * @param {Array} list - قائمة سجلات المتدربين
 * @returns {{rows:Array<{label:string,count:number}>}}
 */
function groupCountByCategory(list){
  const map = new Map();
  list.forEach(s => {
    const category = findCategoryForDepartment((s.department || "").trim());
    const key = (category && category.name) || "غير محدد";
    map.set(key, (map.get(key) || 0) + 1);
  });
  const rows = Array.from(map.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => a.label.localeCompare(b.label, "ar"));
  return { rows };
}

function printCategoriesReport(){
  const { list, periodFrom, periodTo } = getFilteredReportStudents();
  if (list.length === 0){
    showToast("لا يوجد متدربون ضمن هذه الفترة", "warning");
    return;
  }

  const { rows } = groupCountByCategory(list);
  const total = countUniqueStudents(list);
  const bodyRows = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td>${r.count}</td>
    </tr>`).join("");

  const tableHtml = `
  <table>
    <colgroup>
      <col style="width:70%">
      <col style="width:30%">
    </colgroup>
    <thead>
      <tr>
        <th>الفئة</th>
        <th>عدد المتدربين</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="total-row">
        <td>الإجمالي</td>
        <td>${total}</td>
      </tr>
    </tbody>
  </table>`;

  const html = buildReportPageHTML(
    "تقرير عدد المتدربين بفئات المستشفى",
    reportPeriodLabel(periodFrom, periodTo),
    total,
    tableHtml,
    "portrait"
  );
  printReportHTML(html);
}

// ---------------------------------------------------------------------------
// التقرير الثالث: عدد المتدربين بالجامعات والكليات
// ---------------------------------------------------------------------------
function printCollegesReport(){
  const { list, periodFrom, periodTo } = getFilteredReportStudents();
  if (list.length === 0){
    showToast("لا يوجد متدربون ضمن هذه الفترة", "warning");
    return;
  }

  const { rows } = groupCountByField(list, "college");
  const total = countUniqueStudents(list);
  const bodyRows = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.label)}</td>
      <td>${r.count}</td>
    </tr>`).join("");

  const tableHtml = `
  <table>
    <colgroup>
      <col style="width:70%">
      <col style="width:30%">
    </colgroup>
    <thead>
      <tr>
        <th>الجامعة / الكلية</th>
        <th>عدد المتدربين</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="total-row">
        <td>الإجمالي</td>
        <td>${total}</td>
      </tr>
    </tbody>
  </table>`;

  const html = buildReportPageHTML(
    "تقرير عدد المتدربين بالجامعات والكليات",
    reportPeriodLabel(periodFrom, periodTo),
    total,
    tableHtml,
    "portrait"
  );
  printReportHTML(html);
}

// ---------------------------------------------------------------------------
// التقرير الرابع: تقرير تفصيلي للمتدربين (حسب القسم)
// ---------------------------------------------------------------------------
/**
 * يُجمِّع قائمة متدربين حسب القسم مع تفصيل كل قسم إلى: عدد المتدربين، عدد
 * الذكور، عدد الإناث، عدد التدريب الإلزامي، وعدد التدريب التطوعي. السجلات
 * التي أُنشئت قبل إضافة حقلي الجنس/نوع التدريب (قيمتها فارغة) تُحتسب ضمن
 * إجمالي القسم لكنها لا تُضاف لأي من أعمدة التفصيل الأربعة. عدد كل صف قسم
 * هنا هو عدد صفوف الالتحاق الفعلي بذلك القسم (وليس عدد أفراد فريدين — راجع
 * computeUniqueDetailedTotals() أدناه للإجمالي الكلي الصحيح الذي يُحتسب فيه
 * كل متدرب مرة واحدة فقط).
 * @param {Array} list - قائمة سجلات المتدربين المفلترة حسب الفترة
 * @returns {{rows:Array<object>}}
 */
function groupDetailedByDepartment(list){
  const map = new Map();
  list.forEach(s => {
    const dep = (s.department || "").trim() || "غير محدد";
    if (!map.has(dep)){
      map.set(dep, { department: dep, total: 0, male: 0, female: 0, mandatory: 0, volunteer: 0 });
    }
    const row = map.get(dep);
    row.total += 1;
    if (s.gender === "ذكر") row.male += 1;
    else if (s.gender === "انثى") row.female += 1;
    if (s.training_type === "تدريب إلزامي") row.mandatory += 1;
    else if (s.training_type === "تدريب تطوعي") row.volunteer += 1;
  });

  const rows = Array.from(map.values()).sort((a, b) => a.department.localeCompare(b.department, "ar"));

  return { rows };
}

/**
 * إجمالي كلي صحيح لتقرير التفصيل: كل متدرب فريد (بحسب studentUniqueKey())
 * يُحتسب مرة واحدة فقط حتى لو ظهر في أكثر من صف قسم — بعكس الجمع المباشر
 * لأعمدة rows في groupDetailedByDepartment() الذي يُضاعِف عدد نفس الشخص
 * بعدد الأقسام التي التحق بها. الجنس/نوع التدريب لكل متدرب فريد يُؤخذان من
 * أول سجل ظهر له في القائمة (وهما ثابتان لكل شخص بغض النظر عن القسم عادةً).
 * @param {Array} list - قائمة سجلات المتدربين (غير مجمّعة بعد)
 * @returns {{total:number, male:number, female:number, mandatory:number, volunteer:number}}
 */
function computeUniqueDetailedTotals(list){
  const seen = new Map();
  list.forEach(s => {
    const key = studentUniqueKey(s);
    if (!seen.has(key)) seen.set(key, s);
  });

  const totals = { total: seen.size, male: 0, female: 0, mandatory: 0, volunteer: 0 };
  seen.forEach(s => {
    if (s.gender === "ذكر") totals.male += 1;
    else if (s.gender === "انثى") totals.female += 1;
    if (s.training_type === "تدريب إلزامي") totals.mandatory += 1;
    else if (s.training_type === "تدريب تطوعي") totals.volunteer += 1;
  });
  return totals;
}

function printDetailedReport(){
  const { list, periodFrom, periodTo } = getFilteredReportStudents();
  if (list.length === 0){
    showToast("لا يوجد متدربون ضمن هذه الفترة", "warning");
    return;
  }

  const { rows } = groupDetailedByDepartment(list);
  const totals = computeUniqueDetailedTotals(list);
  const bodyRows = rows.map(r => `
    <tr>
      <td>${escapeHtml(r.department)}</td>
      <td>${r.total}</td>
      <td>${r.male}</td>
      <td>${r.female}</td>
      <td>${r.mandatory}</td>
      <td>${r.volunteer}</td>
    </tr>`).join("");

  const tableHtml = `
  <table>
    <colgroup>
      <col style="width:34%">
      <col style="width:14%">
      <col style="width:13%">
      <col style="width:13%">
      <col style="width:13%">
      <col style="width:13%">
    </colgroup>
    <thead>
      <tr>
        <th>القسم</th>
        <th>عدد المتدربين</th>
        <th>ذكر</th>
        <th>انثى</th>
        <th>تدريب إلزامي</th>
        <th>تدريب تطوعي</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="total-row">
        <td>الإجمالي</td>
        <td>${totals.total}</td>
        <td>${totals.male}</td>
        <td>${totals.female}</td>
        <td>${totals.mandatory}</td>
        <td>${totals.volunteer}</td>
      </tr>
    </tbody>
  </table>`;

  const html = buildReportPageHTML(
    "تقرير تفصيلي للمتدربين",
    reportPeriodLabel(periodFrom, periodTo),
    totals.total,
    tableHtml,
    "landscape"
  );
  printReportHTML(html);
}

// ---------------------------------------------------------------------------
// تصدير Excel (ExcelJS، ملف .xlsx حقيقي) — دوال وثوابت مشتركة
// ---------------------------------------------------------------------------
const EXCEL_THIN_BLACK_BORDER = {
  top: { style: "thin", color: { argb: "FF000000" } },
  left: { style: "thin", color: { argb: "FF000000" } },
  bottom: { style: "thin", color: { argb: "FF000000" } },
  right: { style: "thin", color: { argb: "FF000000" } },
};

/**
 * تنسيق خلية واحدة (خط، محاذاة RTL، تعبئة اختيارية، حدود سوداء رفيعة من كل
 * الجهات) — دالة مساعدة مشتركة تُستدعى لكل خلية مستخدمة في التقرير (عنوان،
 * ترويسة، بيانات) حسب مواصفات تنسيق الإكسل الموحّدة للنظام.
 * @param {import('exceljs').Cell} cell - خلية ExcelJS المطلوب تنسيقها
 * @param {{fill?:string, bold?:boolean, sz?:number, color?:string, wrap?:boolean, align?:string, valign?:string, numFmt?:string}} [opts]
 */
function styleExcelCell(cell, opts = {}){
  const { fill, bold, sz, color, wrap, align, valign, numFmt } = opts;

  cell.font = {
    bold: !!bold,
    size: sz || 11,
    name: "Arial",
    color: { argb: color || "FF000000" },
  };

  // ملاحظة مهمة: القيم الصحيحة لمحاذاة ExcelJS الرأسية هي top/middle/bottom
  // فقط — وليس "center" (تلك خاصة بالمحاذاة الأفقية فقط). أي قيمة "center"
  // تصل هنا (سواء افتراضياً أو من مستدعٍ قديم) تُطبَّع إلى "middle" تلقائياً
  // لضمان التوسيط الرأسي الفعلي داخل الخلية بدل تجاهله بصمت.
  const verticalValue = (!valign || valign === "center") ? "middle" : valign;

  cell.alignment = {
    horizontal: align || "right",
    vertical: verticalValue,
    wrapText: wrap !== false,
    readingOrder: 2,
  };

  if (fill){
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
  }

  cell.border = EXCEL_THIN_BLACK_BORDER;

  if (numFmt) cell.numFmt = numFmt;
}

/**
 * كتابة قيمة في خلية (بحسب رقم الصف والعمود) ثم تنسيقها فوراً عبر
 * styleExcelCell(). القيم الفارغة/غير المعرَّفة تُكتب كنص فارغ بدل "undefined".
 * @param {import('exceljs').Worksheet} ws
 * @param {number} r - رقم الصف (1-indexed)
 * @param {number} c - رقم العمود (1-indexed)
 * @param {*} v - القيمة المطلوب كتابتها
 * @param {object} [opts] - خيارات التنسيق، تُمرَّر مباشرة لـ styleExcelCell
 * @returns {import('exceljs').Cell} الخلية بعد الكتابة والتنسيق
 */
function setExcelCell(ws, r, c, v, opts){
  const cell = ws.getCell(r, c);
  cell.value = (v === null || v === undefined) ? "" : v;
  styleExcelCell(cell, opts);
  return cell;
}

/**
 * كتابة قيمة في نطاق خلايا مدموج أفقياً (صف واحد، من عمود بداية إلى عمود
 * نهاية)، ودمج النطاق فعلياً، مع تطبيق نفس التنسيق (توسيط أفقي ورأسي...) على
 * كل خلية داخل النطاق وليس فقط الخلية الأولى (العليا اليمنى) — بعض برامج
 * الجداول غير Excel (مثل LibreOffice أو Google Sheets) لا تُطبِّق محاذاة
 * الخلية الأولى تلقائياً على كامل النطاق المدموج، فهذا يضمن ظهور العنوان
 * مُوسَّطاً أفقياً ورأسياً بشكل صحيح في كل البرامج. تُستخدم لعنوان التقرير
 * (صف كامل مدموج) ولعنوان "المؤسسة التعليمية" المدموج (عمودان).
 * @param {import('exceljs').Worksheet} ws
 * @param {number} r - رقم الصف
 * @param {number} cStart - أول عمود في النطاق
 * @param {number} cEnd - آخر عمود في النطاق
 * @param {*} v - القيمة المطلوب كتابتها (تُكتب في الخلية الأولى فقط، والخلايا الباقية تبقى فارغة)
 * @param {object} [opts] - خيارات التنسيق، تُمرَّر مباشرة لـ styleExcelCell لكل خلية في النطاق
 */
/**
 * كتابة قيمة في نطاق خلايا مدموج أفقياً (صف واحد، من عمود بداية إلى عمود
 * نهاية)، ودمج النطاق فعلياً، مع تطبيق نفس التنسيق (توسيط أفقي ورأسي...) على
 * كل خلية داخل النطاق وليس فقط الخلية الأولى (العليا اليمنى) — بعض برامج
 * الجداول غير Excel (مثل LibreOffice أو Google Sheets) لا تُطبِّق محاذاة
 * الخلية الأولى تلقائياً على كامل النطاق المدموج، فهذا يضمن ظهور العنوان
 * مُوسَّطاً أفقياً ورأسياً بشكل صحيح في كل البرامج.
 *
 * تنبيه مهم: القيمة (value) تُكتب في خلية المرساة (الأولى) فقط — لا تُكتب أي
 * قيمة (ولو نص فارغ "") في بقية خلايا النطاق المدموج، فهذا يُفسد الدمج نفسه
 * في ExcelJS ويُخفي المحتوى بالكامل (كان هذا سبب اختفاء العنوان وعمود
 * "المؤسسة التعليمية" سابقاً). التنسيق (الخط/الحدود/التعبئة) فقط يُطبَّق على
 * بقية الخلايا، دون أي قيمة.
 * @param {import('exceljs').Worksheet} ws
 * @param {number} r - رقم الصف
 * @param {number} cStart - أول عمود في النطاق
 * @param {number} cEnd - آخر عمود في النطاق
 * @param {*} v - القيمة المطلوب كتابتها في خلية المرساة فقط
 * @param {object} [opts] - خيارات التنسيق، تُمرَّر مباشرة لـ styleExcelCell لكل خلية في النطاق
 */
function setMergedExcelRange(ws, r, cStart, cEnd, v, opts){
  ws.mergeCells(r, cStart, r, cEnd);
  setExcelCell(ws, r, cStart, v, opts);
  for (let c = cStart + 1; c <= cEnd; c++){
    styleExcelCell(ws.getCell(r, c), opts); // تنسيق فقط، بلا أي كتابة قيمة
  }
}

/**
 * تنزيل ملف Workbook فعلياً كملف .xlsx حقيقي عبر Blob ورابط تنزيل مؤقت.
 * @param {import('exceljs').Workbook} wb
 * @param {string} filename - اسم الملف الناتج (بامتداد .xlsx)
 */
function downloadExcelWorkbook(wb, filename){
  wb.calcProperties = { fullCalcOnLoad: true };
  return wb.xlsx.writeBuffer().then(buf => {
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  });
}

/**
 * تجميع قائمة سجلات متدربين (سجل واحد لكل قسم) إلى مجموعات لكل طالب فريد
 * (بحسب studentUniqueKey أعلاه)، مع الحفاظ على ترتيب أول ظهور لكل طالب في
 * القائمة، وترتيب سجلات كل طالب حسب تاريخ بداية التدريب تصاعدياً.
 * @param {Array} list - قائمة سجلات المتدربين المفلترة حسب الفترة
 * @returns {Array<{records:Array}>} مجموعة لكل طالب فريد
 */
function groupStudentsForExcel(list){
  const order = [];
  const map = new Map();
  list.forEach(s => {
    const key = studentUniqueKey(s);
    if (!map.has(key)){
      map.set(key, []);
      order.push(key);
    }
    map.get(key).push(s);
  });
  return order.map(key => {
    const records = map.get(key).slice().sort((a, b) => (a.training_start || "").localeCompare(b.training_start || ""));
    return { records };
  });
}

// ---------------------------------------------------------------------------
// كشف رقم 3 (Excel): كشف بيانات الطلبة والخريجين والمتدربين من خارج الوزارة
// ---------------------------------------------------------------------------
// تخطيط أعمدة الشيت بالضبط كما في النموذج الرسمي المرجعي: 14 عمود (A-N)،
// حيث عمودا E وF مدموجان معاً كعمود منطقي واحد "المؤسسة التعليمية". اللون
// الأزرق الفاتح لصف العناوين هو نفس لون Excel القياسي "Blue, Accent 1,
// Lighter 80%" (DDEBF7 في نظام ألوان Office الافتراضي).
const KASHF3_HEADER_FILL = "FFDDEBF7";
const KASHF3_TITLE = "كشف رقم 3 بيانات الطلبة والخريجين والمتدربين من خارج الوزارة الذين تم تدريبهم في مختلف مؤسسات وزارة الصحة";
const KASHF3_HEADERS = [
  { label: "م", col: 1, span: 1 },
  { label: "اسم المتدرب", col: 2, span: 1 },
  { label: "الجنس", col: 3, span: 1 },
  { label: "الجنسية", col: 4, span: 1 },
  { label: "المؤسسة التعليمية", col: 5, span: 2 }, // E-F مدموجان
  { label: "التخصص", col: 7, span: 1 },
  { label: "المرحلة الدراسية\n(طالب - خريج)", col: 8, span: 1 },
  { label: "مكان التدريب", col: 9, span: 1 },
  { label: "تاريخ بدء التدريب", col: 10, span: 1 },
  { label: "تاريخ انتهاء التدريب", col: 11, span: 1 },
  { label: "عدد الأسابيع", col: 12, span: 1 },
  { label: "عدد الأيام", col: 13, span: 1 },
  { label: "التكلفة\n(إن وجدت)", col: 14, span: 1 },
];
const KASHF3_COLUMN_WIDTHS = [7, 34, 13, 19, 22, 22, 30, 22, 30, 19, 19, 15, 13, 16]; // A إلى N بالترتيب — عريضة للنصوص الطويلة بسطر واحد؛ العمودان H وN أضيق عمداً لأن عنوانيهما مقسَّمان على سطرين
const KASHF3_TOTAL_COLS = 14; // A..N

/**
 * جلب شعار المستشفى (assets/excel_logo.png) كـ ArrayBuffer تمهيداً لتضمينه
 * داخل ملف Excel عبر workbook.addImage()؛ يُستدعى مرة واحدة فقط عند التصدير.
 * @returns {Promise<ArrayBuffer>}
 */
async function loadExcelLogoBuffer(){
  const res = await fetch("assets/excel_logo.png");
  if (!res.ok) throw new Error("تعذر تحميل شعار المستشفى (assets/excel_logo.png)");
  return res.arrayBuffer();
}

/**
 * بناء وتنزيل «كشف رقم 3» بصيغة .xlsx حقيقية عبر ExcelJS: شعار المستشفى أعلى
 * يمين الورقة، عنوان الكشف الكامل مدموج أسفله، ثم صف عناوين الأعمدة (بلون
 * Blue, Accent 1, Lighter 80%)، ثم صف واحد فقط لكل طالب فريد ضمن الفترة
 * المختارة (لا تكرار — طالب التحق بأكثر من قسم يظهر مرة واحدة فقط، وعدد
 * الأسابيع/الأيام هو مجموع كل فتراته التدريبية مجتمعة).
 */
async function exportKashf3Report(){
  const { list, periodFrom, periodTo } = getFilteredReportStudents();
  if (list.length === 0){
    showToast("لا يوجد متدربون ضمن هذه الفترة", "warning");
    return;
  }

  const btn = document.getElementById("exportKashf3Btn");
  setButtonLoading(btn, true);

  try {
    const rows = list.slice().sort((a, b) => (a.training_start || "").localeCompare(b.training_start || ""));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("كشف رقم 3", {
      views: [{ rightToLeft: true, showGridLines: false }],
    });

    // -------- صف 1: شعار المستشفى — مدموج داخل الخليتين B وC معاً تحديداً
    //          (وليس A، وليس عائماً بلا خلية مرجعية)، والصورة مثبَّتة داخل
    //          حدود هذا الدمج بالضبط. --------
    ws.getRow(1).height = 62;
    ws.mergeCells(1, 2, 1, 3); // B1:C1
    try {
      const logoBuffer = await loadExcelLogoBuffer();
      const imageId = wb.addImage({ buffer: logoBuffer, extension: "png" });
      ws.addImage(imageId, {
        tl: { col: 1, row: 0 },
        br: { col: 3, row: 1 },
        editAs: "oneCell",
      });
    } catch (logoErr){
      console.error("تعذر تضمين شعار المستشفى في كشف رقم 3:", logoErr);
      // نُكمل التصدير حتى بدون الشعار بدل إفشال العملية بالكامل
    }

    // -------- صف 2: العنوان الكامل، مدموج عبر كل الأعمدة (A-N)، بلا التفاف
    //          (سطر واحد فقط) بفضل العرض الإجمالي الكبير لكل الأعمدة مجتمعة --------
    setMergedExcelRange(ws, 2, 1, KASHF3_TOTAL_COLS, KASHF3_TITLE, { bold: true, sz: 14, align: "center", valign: "middle", fill: KASHF3_HEADER_FILL, wrap: false });
    ws.getRow(2).height = 32;

    // -------- صف 3: فارغ عمداً (فاصل بصري بين العنوان وجدول البيانات) --------
    ws.getRow(3).height = 10;

    // -------- صف 4: عناوين الأعمدة (مع دمج E-F لعمود "المؤسسة التعليمية") --------
    // معظم العناوين بلا التفاف نص (سطر واحد، الأعمدة مُوسَّعة لتستوعبها)،
    // باستثناء عمودي "المرحلة الدراسية" و"التكلفة" تحديداً: عنوانهما مقسَّم
    // على سطرين عمداً (\n داخل النص + wrap:true هنا فقط) بدل سطر واحد طويل،
    // فقلَّ عرضهما المطلوب تبعاً لذلك (راجع KASHF3_COLUMN_WIDTHS أدناه).
    const HEADER_ROW = 4;
    const TWO_LINE_HEADER_COLS = [8, 14];
    KASHF3_HEADERS.forEach(h => {
      const headerOpts = {
        bold: true, sz: 14, align: "center", valign: "middle", fill: KASHF3_HEADER_FILL,
        wrap: TWO_LINE_HEADER_COLS.includes(h.col),
      };
      if (h.span > 1){
        setMergedExcelRange(ws, HEADER_ROW, h.col, h.col + h.span - 1, h.label, headerOpts);
      } else {
        setExcelCell(ws, HEADER_ROW, h.col, h.label, headerOpts);
      }
    });
    ws.getRow(HEADER_ROW).height = 46;

    // -------- الصفوف 5 فما فوق: صف واحد لكل طالب فريد (بلا تكرار) — تاريخا
    //          البداية/النهاية المعروضان هما أقدم بداية وأحدث نهاية بين كل
    //          فترات تدريبه (قد يكون التحق بأكثر من قسم)، وعدد الأسابيع/الأيام
    //          هو مجموع أيام العمل الفعلية عبر كل فتراته مجتمعة (وليس الفرق
    //          بين أقدم بداية وأحدث نهاية، تجنّباً لاحتساب أي فجوة بين فترتين). --------
    // كل الخلايا: محاذاة أفقية ورأسية في المنتصف تماماً، وبلا التفاف نص (سطر
    // واحد لكل خلية) — الأعمدة مُوسَّعة أدناه (KASHF3_COLUMN_WIDTHS) لتستوعب
    // أطول محتوى متوقع (الاسم، الكلية، التخصص...) بسطر واحد دون قطع.
    const DATA_START_ROW = HEADER_ROW + 1;
    const studentGroups = groupStudentsForExcel(rows);

    studentGroups.forEach((group, i) => {
      const row = DATA_START_ROW + i;
      const first = group.records[0];

      const validPeriods = group.records.filter(r => r.training_start && r.training_end);
      const earliestStart = validPeriods.length
        ? validPeriods.reduce((min, r) => (r.training_start < min ? r.training_start : min), validPeriods[0].training_start)
        : null;
      const latestEnd = validPeriods.length
        ? validPeriods.reduce((max, r) => (r.training_end > max ? r.training_end : max), validPeriods[0].training_end)
        : null;
      const totalWorkingDays = validPeriods.reduce((sum, r) => sum + calcDurationDays(r.training_start, r.training_end), 0);
      const weeks = Math.floor(totalWorkingDays / 5);
      const remainingDays = totalWorkingDays % 5;

      const cellOpts = { align: "center", valign: "middle", wrap: false, sz: 14 };

      setExcelCell(ws, row, 1, i + 1, cellOpts);
      setExcelCell(ws, row, 2, first.student_name || "", cellOpts);
      setExcelCell(ws, row, 3, first.gender || "", cellOpts);
      setExcelCell(ws, row, 4, first.nationality || "", cellOpts);

      setMergedExcelRange(ws, row, 5, 6, first.college || "", cellOpts);

      setExcelCell(ws, row, 7, first.specialization || "", cellOpts);
      setExcelCell(ws, row, 8, first.academic_stage || "", cellOpts);
      setExcelCell(ws, row, 9, first.place_of_training || "", cellOpts);
      setExcelCell(ws, row, 10, formatDateShort(earliestStart), cellOpts);
      setExcelCell(ws, row, 11, formatDateShort(latestEnd), cellOpts);
      setExcelCell(ws, row, 12, weeks, cellOpts);
      setExcelCell(ws, row, 13, remainingDays, cellOpts);
      setExcelCell(ws, row, 14, "", cellOpts);
      ws.getRow(row).height = 22; // ارتفاع أكبر يلائم خط بحجم 14
    });

    const lastRow = HEADER_ROW + studentGroups.length;

    // -------- عرض الأعمدة، إعداد الصفحة، منطقة الطباعة --------
    // الأعمدة مُوسَّعة عمداً (راجع KASHF3_COLUMN_WIDTHS) لضمان ظهور أطول نص
    // متوقع في كل عمود (خصوصاً عنوان "المرحلة الدراسية (طالب - خريج)" والاسم
    // والكلية والتخصص ومكان التدريب) بسطر واحد فقط دون التفاف أو قطع.
    ws.columns.forEach((col, idx) => { col.width = KASHF3_COLUMN_WIDTHS[idx]; });

    ws.pageSetup = {
      orientation: "landscape",
      paperSize: 9, // A4
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      horizontalCentered: true,
      printArea: `A1:${String.fromCharCode(64 + KASHF3_TOTAL_COLS)}${lastRow}`,
    };
    ws.pageSetup.printTitlesRow = `${HEADER_ROW}:${HEADER_ROW}`;

    await downloadExcelWorkbook(wb, "كشف رقم 3.xlsx");
    showToast("تم تصدير كشف رقم 3 بنجاح", "success");
  } catch (err){
    console.error("فشل تصدير كشف رقم 3:", err);
    showToast("تعذر تصدير كشف رقم 3، يرجى المحاولة مرة أخرى", "error");
  } finally {
    setButtonLoading(btn, false);
  }
}
