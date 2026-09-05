// ============================================================================
// dashboard.js
// منطق لوحة إدارة المتدربين (dashboard.html) بالكامل: بطاقات الأقسام، شريط
// تصفية الفئات، لوحة الفلاتر التسعة، الجدول القابل للفرز/التوسيع/الترقيم،
// أزرار التعديل والحذف والتقرير والتقييم لكل سجل.
//
// الاعتماديات المطلوب تحميلها قبل هذا الملف (بنفس الترتيب في dashboard.html):
//   1) js/config.js       — بيانات الاتصال بـ Supabase
//   2) js/departments.js  — يوفر CATEGORIES و groupStudentsByDepartment()
//   3) js/ui.js           — يوفر showToast, showConfirm, showEditStudentModal,
//                            calcDurationDays, formatDurationLabel, getTrainingStatus...
//   4) js/supabase.js     — يوفر fetchAllStudents, updateStudentRecord, deleteStudentsByIds
//   5) js/report.js       — يوفر openStudentReport() و openBulkStudentsReport()
//   6) js/evaluation.js   — يوفر showEvaluationModal() (زر «📋 تقييم» لكل صف)
//
// كل البيانات تُجلب مرة واحدة فقط عند تحميل الصفحة (loadStudents) وتُخزَّن في
// state.allStudents؛ أي فلترة أو فرز أو تعديل أو حذف لاحق يعمل محلياً على هذه
// النسخة المخزَّنة في المتصفح دون طلب بيانات جديدة من الخادم في كل مرة.
// ============================================================================

const PAGE_SIZE = 10;

const state = {
  allStudents: [],
  activeDepartment: "",   // فلتر بطاقة القسم النشطة
  activeCategory: "",     // فلتر شريحة الفئة النشطة (id من CATEGORIES)
  sortField: "created_at",
  sortDir: "desc",
  page: 1,
};

document.addEventListener("DOMContentLoaded", async () => {
  renderCategoryChips();
  populateCategoryFilterOptions();
  bindStaticEvents();
  await loadStudents();
});

// ---------------------------------------------------------------------------
// تحميل البيانات من Supabase
// ---------------------------------------------------------------------------
/**
 * جلب كل سجلات المتدربين من Supabase عبر fetchAllStudents() وتخزينها في state.allStudents،
 * ثم إعادة رسم بطاقات الأقسام، تعبئة قائمة فلتر الأقسام، ورسم الجدول.
 * تُستدعى مرة واحدة عند تحميل الصفحة؛ أي تعديل/حذف/إضافة لاحق يُحدّث state.allStudents
 * محلياً مباشرة بدل إعادة الجلب الكامل من الخادم في كل مرة.
 */
async function loadStudents(){
  try {
    state.allStudents = await fetchAllStudents();
  } catch (err){
    console.error(err);
    showToast("تعذر تحميل بيانات المتدربين", "error");
    state.allStudents = [];
  }
  renderDepartmentCards();
  populateDepartmentFilterOptions();
  renderTable();
}

// ---------------------------------------------------------------------------
// شرائح تصفية الفئة الرئيسية (تُطبَّق على بطاقات الأقسام والجدول معاً)
// ---------------------------------------------------------------------------
/**
 * رسم شريط شرائح تصفية الفئة الرئيسية أعلى بطاقات الأقسام (الكل + الفئات الأربع).
 * الضغط على شريحة يُحدّث state.activeCategory ويُزامن قائمة فلتر الفئة المنسدلة معه،
 * ثم يعيد رسم بطاقات الأقسام وقائمة فلتر الأقسام (لأنها تعتمد على الفئة النشطة).
 */
function renderCategoryChips(){
  const row = document.getElementById("categoryChipRow");
  const chips = [`<div class="category-chip ${state.activeCategory === "" ? "active" : ""}" data-cat="">الكل</div>`]
    .concat(CATEGORIES.map(cat => `
      <div class="category-chip ${state.activeCategory === cat.id ? "active" : ""}" data-cat="${cat.id}">
        <span class="chip-icon">${cat.icon}</span>${escapeHtml(cat.name)}
      </div>`));
  row.innerHTML = chips.join("");

  row.querySelectorAll(".category-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      state.activeCategory = chip.dataset.cat;
      document.getElementById("f_category").value = state.activeCategory;
      // إعادة ضبط فلتر القسم إن كان لا ينتمي للفئة الجديدة
      const deptSelect = document.getElementById("f_department");
      if (state.activeCategory && deptSelect.value){
        const cat = CATEGORIES.find(c => c.id === state.activeCategory);
        if (!cat.departments.includes(deptSelect.value)){
          deptSelect.value = "";
          state.activeDepartment = "";
        }
      }
      state.page = 1;
      renderCategoryChips();
      renderDepartmentCards();
      populateDepartmentFilterOptions();
      renderTable();
    });
  });
}

/**
 * تعبئة القائمة المنسدلة «الفئة الرئيسية» في لوحة الفلاتر بكل الفئات الأربع الثابتة
 * (بخلاف قائمة الأقسام، الفئات لا تتغيّر حسب البيانات فهي دائماً نفس الأربع).
 */
function populateCategoryFilterOptions(){
  const select = document.getElementById("f_category");
  select.innerHTML = `<option value="">جميع الفئات</option>` +
    CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${escapeHtml(c.name)}</option>`).join("");
}

// ---------------------------------------------------------------------------
// بطاقات الأقسام
// ---------------------------------------------------------------------------
/**
 * رسم بطاقات الأقسام في أعلى لوحة التحكم. **مهم:** العدد المعروض في كل بطاقة
 * هو عدد الطلاب «قيد التدريب حالياً» فقط (تاريخ اليوم بين بداية ونهاية تدريبهم)،
 * وليس إجمالي كل من سجّل في هذا القسم عبر كل الوقت. إن كانت هناك فئة نشطة،
 * تُعرض فقط بطاقات الأقسام التابعة لتلك الفئة.
 */
function renderDepartmentCards(){
  const grid = document.getElementById("deptGrid");
  const activeStudents = state.allStudents.filter(s => getTrainingStatus(s.training_start, s.training_end).key === "active");
  let groups = groupStudentsByDepartment(activeStudents);

  if (state.activeCategory){
    const cat = CATEGORIES.find(c => c.id === state.activeCategory);
    groups = groups.filter(g => cat.departments.includes(g.department));
  }

  if (groups.length === 0){
    grid.innerHTML = `
      <div class="empty-state">
        <div class="e-icon">📋</div>
        <p>لا توجد بيانات متدربين مسجلة حالياً.</p>
      </div>`;
    return;
  }

  grid.innerHTML = groups.map((g) => `
    <div class="dept-card ${g.department === state.activeDepartment ? "active" : ""}" data-dept="${escapeHtml(g.department)}">
      <div class="dept-icon">${getDepartmentIcon(g.department)}</div>
      <div class="dept-name">${escapeHtml(g.department)}</div>
      <div class="dept-count-row">
        <span class="dept-badge">${formatTraineeCount(g.count)}</span>
      </div>
    </div>
  `).join("");

  grid.querySelectorAll(".dept-card").forEach(card => {
    card.addEventListener("click", () => {
      const dept = card.dataset.dept;
      state.activeDepartment = state.activeDepartment === dept ? "" : dept;
      document.getElementById("f_department").value = state.activeDepartment;
      state.page = 1;
      renderDepartmentCards();
      renderTable();
    });
  });
}

/**
 * تعبئة القائمة المنسدلة «القسم» في لوحة الفلاتر بالأقسام التي لديها سجلات فعلية
 * فقط (بخلاف بطاقات الأقسام، هذه القائمة تُبنى من كل السجلات وليس النشطة فقط،
 * ليتمكن المستخدم من البحث حتى عن أقسام ليس فيها متدرب حالياً). إن كانت هناك
 * فئة نشطة، تُقتصر الخيارات على أقسام تلك الفئة فقط.
 */
function populateDepartmentFilterOptions(){
  const select = document.getElementById("f_department");
  const current = select.value;
  let groups = groupStudentsByDepartment(state.allStudents);

  if (state.activeCategory){
    const cat = CATEGORIES.find(c => c.id === state.activeCategory);
    groups = groups.filter(g => cat.departments.includes(g.department));
  }

  select.innerHTML = `<option value="">جميع الأقسام</option>` +
    groups.map(g => `<option value="${escapeHtml(g.department)}">${escapeHtml(g.department)}</option>`).join("");
  select.value = groups.some(g => g.department === current) ? current : (state.activeDepartment || "");
}

// ---------------------------------------------------------------------------
// الأحداث الثابتة (الفلاتر، الفرز، التصدير)
// ---------------------------------------------------------------------------
/**
 * ربط كل مستمعي الأحداث الثابتة في الصفحة (لا تتغيّر مع كل رسم): حقول البحث
 * التسعة (بحث فوري مع تأخير debounce)، زر إعادة تعيين الفلاتر، الفرز بالضغط على
 * رؤوس الأعمدة، وزر «طباعة التقرير» في لوحة الفترة المستقلة. تُستدعى مرة
 * واحدة فقط عند تحميل الصفحة؛ أزرار كل صف في الجدول (تعديل/حذف/تقرير) تُربط
 * بشكل منفصل داخل renderTable() لأنها تُعاد كتابتها مع كل إعادة رسم.
 */
function bindStaticEvents(){
  const filterIds = ["f_name", "f_phone", "f_spec", "f_category", "f_department", "f_start", "f_end", "f_regdate", "f_status"];
  filterIds.forEach(id => {
    const el = document.getElementById(id);
    const handler = debounce(() => {
      if (id === "f_category"){
        state.activeCategory = el.value;
        renderCategoryChips();
        renderDepartmentCards();
        populateDepartmentFilterOptions();
      }
      if (id === "f_department"){
        state.activeDepartment = el.value;
        renderDepartmentCards();
      }
      state.page = 1;
      renderTable();
    }, 200);
    el.addEventListener("input", handler);
    el.addEventListener("change", handler);
  });

  document.getElementById("resetFiltersBtn").addEventListener("click", () => {
    filterIds.forEach(id => { document.getElementById(id).value = ""; });
    state.activeDepartment = "";
    state.activeCategory = "";
    state.page = 1;
    renderCategoryChips();
    renderDepartmentCards();
    populateDepartmentFilterOptions();
    renderTable();
  });

  document.querySelectorAll("#studentsTable thead th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const field = th.dataset.sort;
      if (state.sortField === field){
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortField = field;
        state.sortDir = "asc";
      }
      renderTable();
    });
  });

}

// ---------------------------------------------------------------------------
// تطبيق الفلاتر على البيانات الخام (تشمل الفئة الرئيسية والقسم معاً)
// ---------------------------------------------------------------------------
/**
 * تطبيق كل الفلاتر النشطة دفعة واحدة (الاسم، الهاتف، التخصص، الفئة، القسم،
 * فترة بداية التدريب، تاريخ التسجيل، حالة التدريب) على القائمة الكاملة
 * state.allStudents، وإرجاع فقط السجلات المطابقة للجميع معاً (AND منطقي).
 * @returns {Array} السجلات المطابقة لكل الفلاتر الحالية
 */
function getFilteredStudents(){
  const name = document.getElementById("f_name").value.trim().toLowerCase();
  const phone = document.getElementById("f_phone").value.trim();
  const spec = document.getElementById("f_spec").value.trim().toLowerCase();
  const category = state.activeCategory;
  const dept = state.activeDepartment;
  const start = document.getElementById("f_start").value;
  const end = document.getElementById("f_end").value;
  const regdate = document.getElementById("f_regdate").value;
  const status = document.getElementById("f_status").value;

  const categoryObj = category ? CATEGORIES.find(c => c.id === category) : null;

  return state.allStudents.filter(s => {
    if (name && !(s.student_name || "").toLowerCase().includes(name)) return false;
    if (phone && !(s.phone || "").includes(phone)) return false;
    if (spec && !(s.specialization || "").toLowerCase().includes(spec)) return false;
    if (categoryObj && !categoryObj.departments.includes(s.department)) return false;
    if (dept && s.department !== dept) return false;
    if (start && s.training_start !== start) return false;
    if (end && s.training_end !== end) return false;
    if (regdate && s.registration_date !== regdate) return false;
    if (status){
      const st = getTrainingStatus(s.training_start, s.training_end).key;
      if (st !== status) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// تجميع السجلات المتطابقة (نفس الاسم + نفس الهاتف) دون حذف أي سجل
// ---------------------------------------------------------------------------
/**
 * تجميع السجلات المتطابقة في (نفس الاسم + نفس رقم الهاتف، بعد تجاهل حالة الأحرف
 * والمسافات الزائدة) في مجموعة واحدة، لأن الطالب الذي سجّل في أكثر من قسم
 * يملك عدة سجلات منفصلة في القاعدة بنفس اسمه وهاتفه. لا يُحذف أو يُدمج أي سجل،
 * فقط يُعاد ترتيبها بصرياً معاً مع فرز فترات كل طالب من الأحدث للأقدم.
 * @param {Array} students - السجلات المطلوب تجميعها
 * @returns {Array} مصفوفة مجموعات {student_name, phone, records[]}
 */
function groupDuplicateStudents(students){
  const map = new Map();
  students.forEach(s => {
    const key = `${(s.student_name || "").trim().toLowerCase()}|${(s.phone || "").trim()}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  });
  return Array.from(map.values()).map(records => ({
    student_name: records[0].student_name,
    phone: records[0].phone,
    records: records.sort((a, b) => new Date(b.training_start) - new Date(a.training_start)),
  }));
}

/**
 * ترتيب أولوية حالة التدريب لمجموعة طالب واحدة: قيد التدريب (0) أولاً، ثم لم
 * يبدأ (1)، ثم انتهى (2) أخيراً — بنفس منطق أولوية getGroupStatusSummary
 * أعلاه (وجود قسم واحد نشط يكفي لاعتبار كل المجموعة "قيد التدريب"، وهكذا).
 * تُستخدم كمعيار فرز أساسي دائم في sortGroups() أدناه، يُطبَّق قبل أي عمود
 * يختاره المستخدم للفرز — فتبقى الحالات الثلاث دائماً مُجمَّعة بهذا الترتيب
 * بصرياً بغض النظر عن العمود/الاتجاه المُفعَّل حالياً، والذي يُستخدم فقط
 * كفارز ثانوي داخل كل مجموعة حالة على حدة.
 * @param {{records:Array}} group - مجموعة سجلات طالب واحد
 * @returns {number} 0 لقيد التدريب، 1 للم يبدأ، 2 لانتهى
 */
function statusRank(group){
  const statuses = group.records.map(r => getTrainingStatus(r.training_start, r.training_end).key);
  if (statuses.includes("active")) return 0;
  if (statuses.includes("upcoming")) return 1;
  return 2;
}

/**
 * فرز مجموعات الطلاب (بعد التجميع) حسب العمود والاتجاه المختارين حالياً في
 * state.sortField و state.sortDir. بالنسبة لأعمدة خاصة بسجل واحد (كالقسم أو
 * التخصص)، يُستخدم أحدث سجل في كل مجموعة كمرجع للفرز. حالة التدريب (قيد
 * التدريب/لم يبدأ/انتهى — راجع statusRank أعلاه) هي دائماً المعيار الأساسي
 * الأول للفرز بغض النظر عن اختيار المستخدم، والعمود المختار يُستخدم كفارز
 * ثانوي فقط داخل كل مجموعة حالة.
 * @param {Array} groups - مجموعات الطلاب الناتجة من groupDuplicateStudents
 * @returns {Array} نفس المجموعات بعد الفرز
 */
function sortGroups(groups){
  const field = state.sortField;
  const dir = state.sortDir === "asc" ? 1 : -1;

  const keyFor = (group) => {
    const latest = group.records[0]; // الأحدث بعد الفرز أعلاه
    if (field === "student_name") return group.student_name || "";
    if (field === "phone") return group.phone || "";
    if (["specialization", "college", "department", "training_start", "training_end", "registration_date", "created_at"].includes(field)){
      return latest[field] || "";
    }
    return "";
  };

  return groups.slice().sort((a, b) => {
    const ra = statusRank(a), rb = statusRank(b);
    if (ra !== rb) return ra - rb;

    const ka = keyFor(a), kb = keyFor(b);
    if (ka < kb) return -1 * dir;
    if (ka > kb) return 1 * dir;
    return 0;
  });
}

// تحديد حالة تمثيلية واحدة لمجموعة أقسام متعددة لنفس الطالب:
// الأولوية لـ"قيد التدريب" إن وُجد قسم واحد جارٍ حالياً، ثم "لم يبدأ"، وأخيراً "انتهى" إن انتهت كل الأقسام
/**
 * اختيار حالة تدريب واحدة «تمثيلية» لعرضها في الصف المُجمَّع (قبل التوسيع)
 * لطالب لديه أكثر من قسم بحالات مختلفة. الأولوية: إن وُجد قسم واحد على الأقل
 * «قيد التدريب» تُعرض هذه الحالة، وإلا فإن وُجد قسم «لم يبدأ» تُعرض هي،
 * وإلا (كل الأقسام منتهية) تُعرض «انتهى».
 * @param {Array} records - كل سجلات (أقسام) الطالب الواحد
 * @returns {{label:string, cls:string}} تسمية وصنف CSS لحالة العرض
 */
function getGroupStatusSummary(records){
  const statuses = records.map(r => getTrainingStatus(r.training_start, r.training_end).key);
  if (statuses.includes("active")) return { label: "قيد التدريب", cls: "status-active" };
  if (statuses.includes("upcoming")) return { label: "لم يبدأ", cls: "status-upcoming" };
  return { label: "انتهى", cls: "status-ended" };
}

// ---------------------------------------------------------------------------
// رسم الجدول (مع الفرز، الترقيم، الصفوف القابلة للتوسيع، وزر التقرير)
// ---------------------------------------------------------------------------
const REPORT_COLSPAN = 9;

/**
 * تقسيم نص إلى عدة أسطر داخل خلية الجدول: كل سطر يحوي كلمتين فقط (وليس أول
 * كلمتين ثم الباقي في سطر واحد) — يُستخدم لأعمدة اسم الطالب/القسم وداخل كل
 * من الكلية/التخصص في العمود المدمج buildCollegeSpecCell أدناه، لأنها تحوي
 * غالباً عبارات طويلة (مثل "قسم تقنية المعلومات والإحصاء")، فيمنع هذا
 * التقسيم توسّع عرض العمود بشكل مبالغ فيه مع إبقاء النص كاملاً ومقروءاً.
 * نصوص من كلمة أو كلمتين فقط تُعرض في سطر واحد كما هي دون أي تقسيم.
 * @param {string} text - النص المطلوب عرضه داخل الخلية
 * @returns {string} نص HTML جاهز (مُهرَّب عبر escapeHtml) بفواصل <br> بين كل سطرين
 */
function breakAfterTwoWords(text){
  const value = (text || "").trim();
  if (!value) return "—";
  const words = value.split(/\s+/);
  if (words.length <= 2) return escapeHtml(value);
  const lines = [];
  for (let i = 0; i < words.length; i += 2){
    lines.push(words.slice(i, i + 2).join(" "));
  }
  return lines.map(line => escapeHtml(line)).join("<br>");
}

/**
 * بناء محتوى خلية "الكلية / التخصص" المدمجة: الكلية أعلى (كل سطرين من
 * كلماتها على سطر منفصل عبر breakAfterTwoWords)، ثم فاصل "---" في سطر
 * مستقل، ثم التخصص بنفس أسلوب التقسيم أسفله. يُستخدم في كل من الصف العادي
 * والصف الفرعي (سجل قسم واحد لكل منهما).
 * @param {string} college - اسم الكلية/الجامعة
 * @param {string} specialization - التخصص
 * @returns {string} نص HTML جاهز لعرضه داخل خلية <td> واحدة
 */
function buildCollegeSpecCell(college, specialization){
  return `${breakAfterTwoWords(college)}<br>---<br>${breakAfterTwoWords(specialization)}`;
}

/**
 * الدالة الرئيسية والأكبر في لوحة التحكم: تُطبّق الفلاتر، تُجمّع السجلات المتكررة،
 * تفرزها، ترقّمها إلى صفحات، ثم تبني HTML الجدول بالكامل — صف عادي لكل طالب
 * بقسم واحد، أو صف ملخّص قابل للتوسيع + صف فرعي مخفي لكل قسم لطالب متعدد
 * الأقسام. بعد إدراج HTML، تربط كل مستمعي أحداث الأزرار من جديد (تعديل، حذف،
 * تقرير، توسيع/طي) لأن innerHTML الجديد يفقد أي مستمعين سابقين.
 * تُستدعى بعد أي تغيير يؤثر على البيانات المعروضة (فلترة، فرز، تصفّح، حذف، تعديل).
 */
function renderTable(){
  const filtered = getFilteredStudents();
  let groups = groupDuplicateStudents(filtered);
  groups = sortGroups(groups);

  updateSortArrows();

  const totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
  state.page = Math.min(state.page, totalPages);
  const pageGroups = groups.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);

  const tbody = document.getElementById("tableBody");

  if (groups.length === 0){
    tbody.innerHTML = `<tr><td colspan="${REPORT_COLSPAN}"><div class="table-empty">لا توجد نتائج مطابقة لمعايير البحث الحالية.</div></td></tr>`;
    renderPagination(0, 1);
    return;
  }

  let html = "";
  pageGroups.forEach((group, gIdx) => {
    const groupId = `grp-${gIdx}`;
    const actionsCell = `
      <div class="actions-cell">
        <button class="btn-report" data-report-idx="${gIdx}">🖨️ طباعة</button>
        <button class="btn-eval" data-eval-idx="${gIdx}">📋 تقييم</button>
        <button class="btn-delete" data-delete-idx="${gIdx}">🗑 حذف</button>
      </div>`;

    if (group.records.length === 1){
      const r = group.records[0];
      const status = getTrainingStatus(r.training_start, r.training_end);
      const singleActionsCell = `
        <div class="actions-cell">
          <button class="btn-report" data-report-idx="${gIdx}">🖨️ طباعة</button>
          <button class="btn-eval" data-eval-idx="${gIdx}">📋 تقييم</button>
          <button class="btn-edit" data-edit-group="${gIdx}" data-edit-record="0">✏️ تعديل</button>
          <button class="btn-waitlist" data-return-waiting-group="${gIdx}" data-return-waiting-record="0">↩️ إرجاع لقائمة الانتظار</button>
          <button class="btn-delete" data-delete-idx="${gIdx}">🗑 حذف</button>
        </div>`;
      html += `
        <tr>
          <td>
            ${breakAfterTwoWords(group.student_name)}
            <div class="group-subtext">${escapeHtml(group.phone)}</div>
          </td>
          <td>${buildCollegeSpecCell(r.college, r.specialization)}</td>
          <td>${breakAfterTwoWords(r.department)}</td>
          <td class="td-date">${formatDateShort(r.registration_date)}</td>
          <td class="td-date">${formatDateShort(r.training_start)}</td>
          <td class="td-date">${formatDateShort(r.training_end)}</td>
          <td>${formatDurationLabel(calcDurationDays(r.training_start, r.training_end))}</td>
          <td><span class="status-pill ${status.cls}">${status.label}</span></td>
          <td>${singleActionsCell}</td>
        </tr>`;
    } else {
      const starts = group.records.map(r => new Date(r.training_start));
      const ends = group.records.map(r => new Date(r.training_end));
      const earliestStart = new Date(Math.min(...starts));
      const latestEnd = new Date(Math.max(...ends));
      const statusSummary = getGroupStatusSummary(group.records);

      html += `
        <tr class="group-row" data-group="${groupId}">
          <td>
            <span class="toggle-caret">▾</span>${breakAfterTwoWords(group.student_name)}
            <div class="group-subtext">${escapeHtml(group.phone)}</div>
          </td>
          <td colspan="2">
            <span class="count-badge">${group.records.length} أقسام</span>
            <span class="expand-hint">اضغط لعرض تفاصيل كل قسم</span>
          </td>
          <td class="td-date">${formatDateShort(group.records[0].registration_date)}</td>
          <td class="td-date" colspan="2">${formatDateShort(earliestStart.toISOString().slice(0, 10))} ← ${formatDateShort(latestEnd.toISOString().slice(0, 10))}</td>
          <td>يختلف حسب القسم</td>
          <td><span class="status-pill ${statusSummary.cls}">${statusSummary.label}</span></td>
          <td>${actionsCell}</td>
        </tr>`;
      group.records.forEach((r, rIdx) => {
        const status = getTrainingStatus(r.training_start, r.training_end);
        html += `
          <tr class="sub-row hidden" data-parent="${groupId}">
            <td></td>
            <td>${buildCollegeSpecCell(r.college, r.specialization)}</td>
            <td>${breakAfterTwoWords(r.department)}</td>
            <td class="td-date">${formatDateShort(r.registration_date)}</td>
            <td class="td-date">${formatDateShort(r.training_start)}</td>
            <td class="td-date">${formatDateShort(r.training_end)}</td>
            <td>${formatDurationLabel(calcDurationDays(r.training_start, r.training_end))}</td>
            <td><span class="status-pill ${status.cls}">${status.label}</span></td>
            <td>
              <div class="actions-cell">
                <button class="btn-edit" data-edit-group="${gIdx}" data-edit-record="${rIdx}">✏️ تعديل</button>
                <button class="btn-waitlist" data-return-waiting-group="${gIdx}" data-return-waiting-record="${rIdx}">↩️ إرجاع لقائمة الانتظار</button>
                <button class="btn-delete" data-delete-record-group="${gIdx}" data-delete-record-idx="${rIdx}">🗑 حذف</button>
              </div>
            </td>
          </tr>`;
      });
    }
  });

  tbody.innerHTML = html;

  tbody.querySelectorAll(".group-row").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return; // لا توسّع الصف عند الضغط على أي زر إجراء
      const id = row.dataset.group;
      row.classList.toggle("expanded");
      tbody.querySelectorAll(`.sub-row[data-parent="${id}"]`).forEach(sr => sr.classList.toggle("hidden"));
    });
  });

  tbody.querySelectorAll("[data-edit-group]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const gIdx = Number(btn.dataset.editGroup);
      const rIdx = Number(btn.dataset.editRecord);
      handleEditStudent(pageGroups[gIdx].records[rIdx]);
    });
  });

  tbody.querySelectorAll("[data-delete-record-group]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const gIdx = Number(btn.dataset.deleteRecordGroup);
      const rIdx = Number(btn.dataset.deleteRecordIdx);
      const record = pageGroups[gIdx].records[rIdx];
      handleDeleteStudent({ student_name: pageGroups[gIdx].student_name, records: [record] });
    });
  });

  tbody.querySelectorAll("[data-report-idx]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.reportIdx);
      try {
        openStudentReport(pageGroups[idx]);
      } catch (err){
        console.error("فشل فتح تقرير الطالب:", err);
        showToast("تعذر فتح التقرير، يرجى المحاولة مرة أخرى", "error");
      }
    });
  });

  tbody.querySelectorAll("[data-eval-idx]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.evalIdx);
      try {
        showEvaluationModal(pageGroups[idx]);
      } catch (err){
        console.error("فشل فتح نافذة التقييم:", err);
        showToast("تعذر فتح نافذة التقييم، يرجى المحاولة مرة أخرى", "error");
      }
    });
  });

  tbody.querySelectorAll("[data-return-waiting-group]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const gIdx = Number(btn.dataset.returnWaitingGroup);
      const rIdx = Number(btn.dataset.returnWaitingRecord);
      handleReturnToWaitlist(pageGroups[gIdx].records[rIdx]);
    });
  });

  tbody.querySelectorAll("[data-delete-idx]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.deleteIdx);
      handleDeleteStudent(pageGroups[idx]);
    });
  });

  renderPagination(groups.length, totalPages);
}

// ---------------------------------------------------------------------------
// تعديل بيانات سجل متدرب واحد بعد تأكيد الحفظ من نافذة التعديل
// ---------------------------------------------------------------------------
/**
 * معالجة الضغط على زر «✏️ تعديل» لسجل واحد: تفتح نافذة التعديل مع تعبئتها
 * بالقيم الحالية، تنتظر قرار المستخدم (حفظ أو إلغاء)، وعند الحفظ تُرسل التعديلات
 * إلى Supabase عبر updateStudentRecord()، ثم تُحدّث state.allStudents محلياً
 * بنفس القيم الجديدة بدل إعادة الجلب الكامل، وتُعيد رسم كل الواجهة المتأثرة.
 * @param {object} record - السجل (القسم الواحد) المطلوب تعديله
 */
async function handleEditStudent(record){
  const updates = await showEditStudentModal(record);
  if (!updates) return;

  try {
    await updateStudentRecord(record.id, updates);

    const idx = state.allStudents.findIndex(s => s.id === record.id);
    if (idx !== -1) state.allStudents[idx] = { ...state.allStudents[idx], ...updates };

    showToast("تم حفظ التعديلات بنجاح", "success");
    renderDepartmentCards();
    populateDepartmentFilterOptions();
    renderTable();
  } catch (err){
    console.error("فشل تعديل بيانات المتدرب:", err);
    showToast(describeSupabaseError(err, "تعذر حفظ التعديلات"), "error");
  }
}

// ---------------------------------------------------------------------------
// إرجاع سجل قسم واحد لطالب من لوحة الإدارة إلى قائمة الانتظار
// ---------------------------------------------------------------------------
/**
 * معالجة الضغط على زر «↩️ إرجاع لقائمة الانتظار»: تطلب من المستخدم كتابة سبب
 * الإرجاع إلزامياً أولاً (عبر showReasonPrompt في js/ui.js — لا نافذة تأكيد
 * بسيطة بعد الآن، بل حقل نص لا يُقبل فارغاً)، ثم تُنفِّذ الإرجاع الفعلي.
 * السبب المكتوب يُحفظ في waitlist_note ويظهر لاحقاً في حقل «ملاحظة» بنافذة
 * «📅 تحديد الفترات ونقل الطالب» في صفحة قائمة الانتظار — راجع
 * returnStudentRecordToWaitlist() في js/supabase.js لتفاصيل الحفظ. لا تُنفَّذ
 * أي تعديل فعلي إلا بعد كتابة سبب فعلي. تعمل على سجل قسم واحد فقط (وليس كل
 * أقسام الطالب دفعة واحدة) — فطالب بعدة أقسام يمكن إرجاع بعضها فقط لقائمة
 * الانتظار مع إبقاء الباقي في لوحة الإدارة.
 * @param {object} record - سجل القسم الواحد المطلوب إرجاعه لقائمة الانتظار
 */
async function handleReturnToWaitlist(record){
  const reason = await showReasonPrompt({
    title: "إرجاع الطالب لقائمة الانتظار",
    text: `سيتم إرجاع ${escapeHtml(record.student_name)} (${escapeHtml(record.department)}) إلى قائمة الانتظار، وسيُحذف تاريخا بداية ونهاية التدريب الحاليان لهذا القسم. يرجى كتابة سبب الإرجاع — سيظهر لاحقاً في صفحة قائمة الانتظار ويمكن تعديله من هناك.`,
    placeholder: "سبب الإرجاع...",
    confirmLabel: "إرجاع لقائمة الانتظار",
  });
  if (!reason) return;

  try {
    await returnStudentRecordToWaitlist(record.id, reason);

    const idx = state.allStudents.findIndex(s => s.id === record.id);
    if (idx !== -1){
      state.allStudents[idx] = {
        ...state.allStudents[idx],
        training_start: null,
        training_end: null,
        is_waitlist: true,
        waitlist_note: reason,
      };
    }

    showToast("تم إرجاع الطالب إلى قائمة الانتظار", "success");
    renderDepartmentCards();
    populateDepartmentFilterOptions();
    renderTable();
  } catch (err){
    console.error("فشل إرجاع الطالب لقائمة الانتظار:", err);
    showToast(describeSupabaseError(err, "تعذر إرجاع الطالب لقائمة الانتظار"), "error");
  }
}

// ---------------------------------------------------------------------------
// حذف طالب (كل سجلاته عبر جميع الأقسام) بعد تأكيد صريح من المستخدم
// ---------------------------------------------------------------------------
/**
 * معالجة الضغط على زر «🗑 حذف»: تعرض نافذة تأكيد صريحة أولاً (نص مختلف حسب
 * كون الطالب بقسم واحد أو عدة أقسام)، ولا تُنفّذ أي حذف فعلي إلا بعد موافقة
 * المستخدم. عند التأكيد، تُحذف كل السجلات الممرّرة دفعة واحدة عبر
 * deleteStudentsByIds()، وتُزال من state.allStudents محلياً.
 * @param {{student_name:string, records:Array}} group - مجموعة تحتوي سجلاً واحداً
 * (حذف قسم واحد فقط) أو عدة سجلات (حذف الطالب بالكامل من كل أقسامه)
 */
async function handleDeleteStudent(group){
  const multi = group.records.length > 1;
  const confirmed = await showConfirm({
    title: "حذف الطالب نهائياً",
    text: multi
      ? `سيتم حذف ${escapeHtml(group.student_name)} من جميع الأقسام (${group.records.length} سجلات). لا يمكن التراجع عن هذا الإجراء.`
      : `سيتم حذف سجل ${escapeHtml(group.student_name)} نهائياً. لا يمكن التراجع عن هذا الإجراء.`,
    confirmLabel: "حذف نهائياً",
  });
  if (!confirmed) return;

  try {
    const ids = group.records.map(r => r.id);
    await deleteStudentsByIds(ids);
    state.allStudents = state.allStudents.filter(s => !ids.includes(s.id));

    showToast("تم حذف الطالب بنجاح", "success");
    renderDepartmentCards();
    populateDepartmentFilterOptions();
    renderTable();
  } catch (err){
    console.error("فشل حذف الطالب:", err);
    showToast(describeSupabaseError(err, "تعذر حذف الطالب"), "error");
  }
}

/**
 * تحديث رمز السهم (↕ / ▲ / ▼) بجانب كل عمود قابل للفرز في رأس الجدول،
 * ليعكس العمود والاتجاه النشطين حالياً في state.sortField و state.sortDir.
 */
function updateSortArrows(){
  document.querySelectorAll("#studentsTable thead th[data-sort]").forEach(th => {
    const arrow = th.querySelector(".sort-arrow");
    if (th.dataset.sort === state.sortField){
      arrow.textContent = state.sortDir === "asc" ? "▲" : "▼";
    } else {
      arrow.textContent = "↕";
    }
  });
}

/**
 * رسم شريط التنقل أسفل الجدول: نص «عرض X - Y من أصل Z»، أزرار أرقام الصفحات
 * (مع نقاط اختصار «…» عند وجود صفحات كثيرة)، وزري السابق/التالي. يُخفي نفسه
 * كلياً إن لم توجد نتائج.
 * @param {number} totalItems - إجمالي عدد المجموعات (الطلاب) بعد الفلترة
 * @param {number} totalPages - إجمالي عدد الصفحات الناتج
 */
function renderPagination(totalItems, totalPages){
  const el = document.getElementById("pagination");
  if (totalItems === 0){ el.innerHTML = ""; return; }

  const from = (state.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(state.page * PAGE_SIZE, totalItems);

  let buttons = "";
  for (let p = 1; p <= totalPages; p++){
    if (p === 1 || p === totalPages || Math.abs(p - state.page) <= 1){
      buttons += `<button data-page="${p}" class="${p === state.page ? "active" : ""}">${p}</button>`;
    } else if (buttons.slice(-3) !== "…</span>" && (p === state.page - 2 || p === state.page + 2)){
      buttons += `<span style="padding:0 4px;color:var(--text-muted)">…</span>`;
    }
  }

  el.innerHTML = `
    <div class="p-info">عرض ${from} - ${to} من أصل ${totalItems} سجل</div>
    <div class="p-controls">
      <button ${state.page === 1 ? "disabled" : ""} data-page="${state.page - 1}">‹</button>
      ${buttons}
      <button ${state.page === totalPages ? "disabled" : ""} data-page="${state.page + 1}">›</button>
    </div>`;

  el.querySelectorAll("button[data-page]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.page = Number(btn.dataset.page);
      renderTable();
    });
  });
}
