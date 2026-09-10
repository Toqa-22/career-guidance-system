// ============================================================================
// waiting.js
// منطق صفحة قائمة الانتظار (waiting.html) بالكامل: تحميل سجلات is_waitlist=true
// من Supabase، تجميعها حسب الطالب (نفس الاسم + نفس الهاتف) لأن الطالب الذي
// اختار «إضافة إلى قائمة الانتظار» عند التسجيل يحصل على سجل مستقل لكل قسم من
// أقسامه المختارة (بلا فترة تدريب لأي منها)، فلترة بسيطة بالاسم/القسم، رسم
// الجدول بصف واحد لكل طالب (يعرض كل أقسامه معاً)، وزرا الإجراء الرئيسيان:
//
//   - «📅 تحديد الفترات ونقل الطالب»: يفتح نافذة showAssignMultiPeriodModal
//     (js/ui.js) التي تعرض صفاً مستقلاً لكل قسم من أقسام الطالب، وتفرض تحديد
//     فترة صحيحة لكل قسم منها قبل القبول. النافذة الآن بزرين منفصلين تماماً:
//     «حفظ» يستدعي saveWaitlistPeriods() (يحفظ الفترات فقط، الطالب يبقى في
//     قائمة الانتظار)، و«نقل إلى لوحة الإدارة» يستدعي assignTrainingPeriods()
//     الذي يضبط is_waitlist=false لكل سجلات الطالب معاً — فينتقل بكل أقسامه
//     دفعة واحدة إلى لوحة الإدارة ويختفي من هنا، وليس قسماً تلو الآخر.
//   - «🗑 حذف»: يحذف الطالب نهائياً من قائمة الانتظار (كل سجلاته/أقسامه معاً)،
//     بعد نافذة تأكيد صريحة.
//
// الاعتماديات المطلوب تحميلها قبل هذا الملف (بنفس الترتيب في waiting.html):
//   1) js/config.js       — بيانات الاتصال بـ Supabase
//   2) js/departments.js  — يوفر getDepartmentIcon() (تُستخدم داخل نافذة التحديد)
//   3) js/ui.js           — يوفر showToast, showConfirm, showAssignMultiPeriodModal...
//   4) js/supabase.js     — يوفر fetchWaitlistStudents, saveWaitlistPeriods,
//                            assignTrainingPeriods, deleteStudentsByIds,
//                            describeSupabaseError
//
// كل البيانات تُجلب مرة واحدة عند تحميل الصفحة وتُخزَّن في waitingState.all
// (سجلات خام، سجل واحد لكل قسم)؛ التجميع حسب الطالب يحدث عند كل رسم عبر
// groupWaitlistByStudent(). أي حذف أو نقل لاحق يعمل محلياً على waitingState.all
// دون إعادة جلب كامل من الخادم.
// ============================================================================

const waitingState = {
  all: [],
  filterName: "",
  filterDepartment: "",
};

document.addEventListener("DOMContentLoaded", async () => {
  bindWaitingEvents();
  await loadWaitlist();
});

// ---------------------------------------------------------------------------
// تحميل البيانات من Supabase
// ---------------------------------------------------------------------------
/**
 * جلب كل سجلات قائمة الانتظار من Supabase عبر fetchWaitlistStudents() وتخزينها
 * في waitingState.all، ثم تعبئة قائمة فلتر الأقسام ورسم الجدول. تُستدعى مرة
 * واحدة عند تحميل الصفحة؛ أي نقل/حذف لاحق يُحدّث waitingState.all محلياً
 * مباشرة بدل إعادة الجلب الكامل من الخادم في كل مرة.
 */
async function loadWaitlist(){
  try {
    waitingState.all = await fetchWaitlistStudents();
  } catch (err){
    console.error(err);
    showToast("تعذر تحميل قائمة الانتظار", "error");
    waitingState.all = [];
  }
  populateWaitingDepartmentFilter();
  renderWaitingTable();
}

// ---------------------------------------------------------------------------
// تجميع سجلات قائمة الانتظار حسب الطالب (نفس الاسم + نفس الهاتف)
// ---------------------------------------------------------------------------
/**
 * تجميع سجلات قائمة الانتظار (سجل واحد لكل قسم) في مجموعة واحدة لكل طالب
 * (بمطابقة الاسم ورقم الهاتف، بعد تجاهل حالة الأحرف والمسافات الزائدة) —
 * لأن الطالب الذي اختار «إضافة إلى قائمة الانتظار» عند التسجيل يحصل على سجل
 * مستقل لكل قسم من أقسامه المختارة معاً، لا سجل واحد بكل الأقسام. لا يُدمج
 * أو يُحذف أي سجل هنا، فقط تُعاد تجميعها بصرياً معاً في صف واحد بالجدول.
 * @param {Array} records - سجلات قائمة الانتظار الخام المطلوب تجميعها
 * @returns {Array} مصفوفة مجموعات {student_name, phone, college, specialization, registration_date, records[]}
 */
function groupWaitlistByStudent(records){
  const map = new Map();
  records.forEach(r => {
    const key = `${(r.student_name || "").trim().toLowerCase()}|${(r.phone || "").trim()}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  return Array.from(map.values()).map(recs => ({
    student_name: recs[0].student_name,
    phone: recs[0].phone,
    college: recs[0].college,
    specialization: recs[0].specialization,
    registration_date: recs[0].registration_date,
    records: recs,
  }));
}

// ---------------------------------------------------------------------------
// أحداث الفلترة (اسم + قسم)
// ---------------------------------------------------------------------------
/**
 * ربط مستمعي أحداث حقلي الفلترة (اسم الطالب، القسم). حقل الاسم يبحث بحثاً
 * جزئياً فورياً مع تأخير debounce، بينما القائمة المنسدلة تطابق مطابقة دقيقة.
 * الفلترة تعمل على مستوى السجلات الخام (كل قسم على حدة) قبل التجميع حسب
 * الطالب، بنفس منطق فلترة القسم في لوحة الإدارة تماماً. تُستدعى مرة واحدة
 * فقط عند تحميل الصفحة.
 */
function bindWaitingEvents(){
  const nameInput = document.getElementById("w_name");
  const deptSelect = document.getElementById("w_department");

  nameInput.addEventListener("input", debounce(() => {
    waitingState.filterName = nameInput.value.trim().toLowerCase();
    renderWaitingTable();
  }, 200));

  deptSelect.addEventListener("change", () => {
    waitingState.filterDepartment = deptSelect.value;
    renderWaitingTable();
  });
}

/**
 * تعبئة القائمة المنسدلة «القسم» بأقسام سجلات قائمة الانتظار الحالية فقط
 * (وليس كل الأقسام الأربعين الممكنة)، لتبقى القائمة قصيرة وذات صلة بما هو
 * موجود فعلياً في قائمة الانتظار الآن.
 */
function populateWaitingDepartmentFilter(){
  const select = document.getElementById("w_department");
  const current = select.value;
  const depts = Array.from(new Set(waitingState.all.map(s => s.department))).sort((a, b) => a.localeCompare(b, "ar"));

  select.innerHTML = `<option value="">جميع الأقسام</option>` +
    depts.map(d => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
  select.value = depts.includes(current) ? current : "";
  waitingState.filterDepartment = select.value;
}

/**
 * تطبيق فلاتر الاسم والقسم معاً (AND منطقي) على السجلات الخام في
 * waitingState.all، قبل تجميعها حسب الطالب. فلتر القسم يقتصر النتيجة على
 * سجل ذلك القسم فقط من كل طالب مطابق (بنفس سلوك فلتر القسم في لوحة الإدارة).
 * @returns {Array} السجلات الخام المطابقة للفلاتر الحالية
 */
function getFilteredWaitlistRecords(){
  return waitingState.all.filter(s => {
    if (waitingState.filterName && !(s.student_name || "").toLowerCase().includes(waitingState.filterName)) return false;
    if (waitingState.filterDepartment && s.department !== waitingState.filterDepartment) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// رسم الجدول
// ---------------------------------------------------------------------------
const WAITING_COLSPAN = 7;

/**
 * رسم جدول قائمة الانتظار بالكامل: تُطبَّق الفلاتر على السجلات الخام أولاً،
 * ثم تُجمَّع النتيجة حسب الطالب — فيظهر صف واحد لكل طالب يحوي كل أقسامه معاً
 * (شارة عدد + أسماء الأقسام)، مع زري «📅 تحديد الفترات ونقل الطالب» و«🗑 حذف».
 * يُحدَّث أيضاً شريط إحصاء عدد الطلاب الإجمالي أعلى الصفحة (بغض النظر عن
 * الفلترة الحالية). تُستدعى بعد أي تغيير يؤثر على البيانات المعروضة (تحميل،
 * فلترة، حذف، نقل بعد تحديد الفترات).
 */
function renderWaitingTable(){
  const tbody = document.getElementById("waitingTableBody");
  const countEl = document.getElementById("waitingCount");
  if (countEl) countEl.textContent = String(groupWaitlistByStudent(waitingState.all).length);

  const groups = groupWaitlistByStudent(getFilteredWaitlistRecords());

  if (groups.length === 0){
    const msg = waitingState.all.length === 0
      ? "لا يوجد متدربون في قائمة الانتظار حالياً."
      : "لا توجد نتائج مطابقة لمعايير البحث الحالية.";
    tbody.innerHTML = `<tr><td colspan="${WAITING_COLSPAN}"><div class="table-empty">${escapeHtml(msg)}</div></td></tr>`;
    return;
  }

  tbody.innerHTML = groups.map((g, idx) => `
    <tr>
      <td>${escapeHtml(g.student_name)}</td>
      <td>${escapeHtml(g.phone)}</td>
      <td>${escapeHtml(g.college || "—")}</td>
      <td>${escapeHtml(g.specialization)}</td>
      <td>
        <span class="count-badge">${formatWaitlistDeptCount(g.records.length)}</span>
        <div class="group-subtext">${g.records.map(r => escapeHtml(r.department)).join("، ")}</div>
      </td>
      <td>${formatDateShort(g.registration_date)}</td>
      <td>
        <div class="actions-cell">
          <button class="btn-edit" data-assign-idx="${idx}">📅 تحديد الفترات ونقل الطالب</button>
          <button class="btn-delete" data-delete-idx="${idx}">🗑 حذف</button>
        </div>
      </td>
    </tr>`).join("");

  tbody.querySelectorAll("[data-assign-idx]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.assignIdx);
      handleAssignPeriods(groups[idx]);
    });
  });

  tbody.querySelectorAll("[data-delete-idx]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.deleteIdx);
      handleDeleteWaitlistGroup(groups[idx]);
    });
  });
}

/**
 * صياغة عربية نحوياً صحيحة لعدد أقسام طالب واحد في قائمة الانتظار
 * (قسم واحد / قسمان / ٣-١٠ أقسام / أكثر).
 * @param {number} n - عدد الأقسام
 * @returns {string} النص العربي المناسب للعدد
 */
function formatWaitlistDeptCount(n){
  if (n === 1) return "قسم واحد";
  if (n === 2) return "قسمان";
  if (n >= 3 && n <= 10) return `${n} أقسام`;
  return `${n} قسماً`;
}

// ---------------------------------------------------------------------------
// تحديد فترات التدريب لكل أقسام الطالب ونقله دفعة واحدة إلى لوحة الإدارة
// ---------------------------------------------------------------------------
/**
 * معالجة الضغط على زر «📅 تحديد الفترات ونقل الطالب»: تفتح نافذة
 * showAssignMultiPeriodModal() (js/ui.js) التي تعرض صفاً مستقلاً لكل قسم من
 * أقسام هذا الطالب، وتفرض تحديد فترة صحيحة لكل قسم منها قبل القبول. النافذة
 * الآن تُرجع action منفصلاً عن التحديثات:
 *   - action === "save": يُستدعى saveWaitlistPeriods() فقط — يحفظ الفترات
 *     والملاحظة دون أي نقل، ويبقى الطالب ظاهراً في قائمة الانتظار بنفس
 *     القيم المحفوظة عند إعادة فتح النافذة لاحقاً.
 *   - action === "transfer": يُستدعى assignTrainingPeriods() الذي يضبط
 *     is_waitlist=false للجميع معاً في طلب واحد، فتختفي كل سجلات الطالب من
 *     waitingState.all محلياً فوراً (وتظهر معاً عند فتح لوحة الإدارة لاحقاً).
 * @param {{student_name:string, phone:string, records:Array}} group - مجموعة سجلات الطالب في قائمة الانتظار
 */
async function handleAssignPeriods(group){
  const result = await showAssignMultiPeriodModal(group);
  if (!result) return;

  const { action, updates } = result;

  try {
    if (action === "save"){
      const saved = await saveWaitlistPeriods(updates);

      // تحديث waitingState.all محلياً بنفس القيم المحفوظة (الفترات + الملاحظة)
      // دون حذف أي سجل — الطالب يبقى في قائمة الانتظار بصريّاً.
      saved.forEach(rec => {
        const idx = waitingState.all.findIndex(s => s.id === rec.id);
        if (idx !== -1) waitingState.all[idx] = { ...waitingState.all[idx], ...rec };
      });

      showToast(`تم حفظ فترات ${group.student_name} في قائمة الانتظار`, "success");
      renderWaitingTable();
      return;
    }

    // action === "transfer"
    await assignTrainingPeriods(updates);

    const ids = group.records.map(r => r.id);
    waitingState.all = waitingState.all.filter(s => !ids.includes(s.id));

    showToast(`تم تحديد فترة التدريب لكل الأقسام، وانتقل ${group.student_name} إلى لوحة الإدارة`, "success");
    populateWaitingDepartmentFilter();
    renderWaitingTable();
  } catch (err){
    console.error("فشل تحديد فترات التدريب من قائمة الانتظار:", err);
    showToast(describeSupabaseError(err, "تعذر حفظ الفترات"), "error");
  }
}

// ---------------------------------------------------------------------------
// حذف طالب (كل أقسامه في قائمة الانتظار معاً) نهائياً
// ---------------------------------------------------------------------------
/**
 * معالجة الضغط على زر «🗑 حذف»: تعرض نافذة تأكيد صريحة أولاً (تذكر عدد
 * الأقسام المطلوب حذفها معاً)، ولا تُنفّذ أي حذف فعلي إلا بعد موافقة
 * المستخدم — بنفس منطق الحذف في لوحة الإدارة تماماً.
 * @param {{student_name:string, phone:string, records:Array}} group - مجموعة سجلات الطالب المطلوب حذفها من قائمة الانتظار
 */
async function handleDeleteWaitlistGroup(group){
  const multi = group.records.length > 1;
  const confirmed = await showConfirm({
    title: "حذف الطالب من قائمة الانتظار",
    text: multi
      ? `سيتم حذف ${escapeHtml(group.student_name)} نهائياً من قائمة الانتظار في جميع أقسامه (${group.records.length} سجلات). لا يمكن التراجع عن هذا الإجراء.`
      : `سيتم حذف ${escapeHtml(group.student_name)} نهائياً من قائمة الانتظار. لا يمكن التراجع عن هذا الإجراء.`,
    confirmLabel: "حذف نهائياً",
  });
  if (!confirmed) return;

  try {
    const ids = group.records.map(r => r.id);
    await deleteStudentsByIds(ids);
    waitingState.all = waitingState.all.filter(s => !ids.includes(s.id));

    showToast("تم حذف الطالب من قائمة الانتظار", "success");
    populateWaitingDepartmentFilter();
    renderWaitingTable();
  } catch (err){
    console.error("فشل حذف طالب من قائمة الانتظار:", err);
    showToast(describeSupabaseError(err, "تعذر الحذف"), "error");
  }
}
