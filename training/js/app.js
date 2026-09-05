// ============================================================================
// app.js
// منطق صفحة التسجيل (register.html): اختيار الفئة → الأقسام (متعدد الاختيار)
// + فترة تدريب مستقلة لكل قسم مختار + التحقق من الحقول + إرسال البيانات.
//
// الاعتماديات المطلوب تحميلها قبل هذا الملف (بنفس الترتيب في register.html):
//   1) js/config.js       — بيانات الاتصال بـ Supabase
//   2) js/departments.js  — يوفر CATEGORIES و getDepartmentIcon()
//   3) js/ui.js           — يوفر showToast, escapeHtml (عبر supabase.js), calcDurationDays...
//   4) js/supabase.js     — يوفر insertStudentsWithPeriods() و describeSupabaseError()
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  initDeptPicker();
  bindTrainingModeToggle();
  bindPlaceOfTrainingToggle();
  bindNationalityToggle();
  initFormSubmit();
});

/**
 * ربط قائمة «الجنسية» المنسدلة بإظهار/إخفاء حقل نص حر بديل عند اختيار
 * "أخرى" تحديداً — خيار Omani قيمة ثابتة جاهزة فلا حاجة لأي حقل إضافي معه.
 * الحقل البديل يُصفَّر تلقائياً عند التبديل بعيداً عن "أخرى" حتى لا تبقى
 * قيمة قديمة مخفية تُرسَل خطأً لاحقاً. نفس نمط bindPlaceOfTrainingToggle
 * أدناه تماماً.
 */
function bindNationalityToggle(){
  const select = document.getElementById("nationality");
  const otherInput = document.getElementById("nationality_other");

  select.addEventListener("change", () => {
    const isOther = select.value === "أخرى";
    otherInput.style.display = isOther ? "block" : "none";
    if (!isOther) otherInput.value = "";
    clearFieldError("nationality");
  });
}

/**
 * ربط قائمة «مكان التدريب» المنسدلة بإظهار/إخفاء حقل نص حر بديل عند اختيار
 * "أخرى" تحديداً — بقية الخيارات (طب / الإدارة) قيم ثابتة جاهزة فلا حاجة
 * لأي حقل إضافي معها. الحقل البديل يُصفَّر تلقائياً عند التبديل بعيداً عن
 * "أخرى" حتى لا تبقى قيمة قديمة مخفية تُرسَل خطأً لاحقاً.
 */
function bindPlaceOfTrainingToggle(){
  const select = document.getElementById("place_of_training");
  const otherInput = document.getElementById("place_of_training_other");

  select.addEventListener("change", () => {
    const isOther = select.value === "أخرى";
    otherInput.style.display = isOther ? "block" : "none";
    if (!isOther) otherInput.value = "";
    clearFieldError("place_of_training");
  });
}

// ---------------------------------------------------------------------------
// منتقي الفئة → الأقسام (اختيار متعدد عبر فئة واحدة أو أكثر)
// كل قسم مختار له فترة تدريب (بداية/نهاية) مستقلة عن بقية الأقسام
// ---------------------------------------------------------------------------
const deptPickerState = {
  activeCategoryId: null,
  selected: new Set(),      // أسماء الأقسام المختارة، بترتيب الاختيار
  dates: new Map(),         // dep -> { start: "yyyy-mm-dd", end: "yyyy-mm-dd" }
  mode: "dated",            // اختيار عام لكل الطالب (وليس لكل قسم): "dated" = تحديد فترة كل قسم الآن، "waitlist" = إضافة الطالب لقائمة الانتظار في كل الأقسام المختارة
};

/**
 * تهيئة منتقي «الفئة → الأقسام» بالكامل عند تحميل صفحة التسجيل.
 * ترسم بطاقات الفئات الأربع، قائمة الأقسام (فارغة حتى يتم اختيار فئة)،
 * ملخص الأقسام المختارة، وصفوف الفترة التدريبية لكل قسم.
 * تُستدعى مرة واحدة فقط من مستمع DOMContentLoaded.
 */
function initDeptPicker(){
  renderCategoryCards();
  renderDeptChecklist();
  renderSelectedSummary();
  renderPeriods();
}

/**
 * ربط مفتاحي التبديل «تحديد الفترة الآن» / «إضافة إلى قائمة الانتظار» أعلى
 * قسم الفترات: اختيار عام واحد لكل الطالب (وليس لكل قسم على حدة) يحدد كيف
 * تُدرَج كل الأقسام المختارة معاً — إما جميعها بفترة محددة، أو جميعها في
 * قائمة الانتظار بلا فترة (تُحدَّد لاحقاً دفعة واحدة من صفحة قائمة الانتظار).
 * تُستدعى مرة واحدة فقط عند تحميل الصفحة.
 */
function bindTrainingModeToggle(){
  const buttons = document.querySelectorAll("#trainingModeToggle .mode-btn");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      if (deptPickerState.mode === btn.dataset.mode) return;
      deptPickerState.mode = btn.dataset.mode;
      buttons.forEach(b => b.classList.toggle("active", b === btn));
      renderPeriods();
      clearFieldError("periods");
      clearFieldError("waitlist_note");
    });
  });
}

/**
 * رسم بطاقات الفئات الرئيسية الأربع (طبية / طبية مساعدة / إدارية / هندسة وصيانة).
 * كل بطاقة تعرض شارة صغيرة بعدد الأقسام المختارة من نفس الفئة (إن وُجد)،
 * وتصبح الفئة «نشطة» (تُبرز شريط أقسامها أسفلها) عند الضغط عليها،
 * مع إمكانية إلغاء التنشيط بالضغط مرة أخرى على نفس الفئة.
 */
function renderCategoryCards(){
  const grid = document.getElementById("categoryGrid");
  grid.innerHTML = CATEGORIES.map(cat => {
    const countInCat = cat.departments.filter(d => deptPickerState.selected.has(d)).length;
    return `
      <div class="category-card ${cat.id === deptPickerState.activeCategoryId ? "active" : ""}" data-cat="${cat.id}">
        <span class="cat-badge ${countInCat > 0 ? "show" : ""}">${countInCat}</span>
        <div class="cat-icon">${cat.icon}</div>
        <div class="cat-name">${escapeHtml(cat.name)}</div>
      </div>`;
  }).join("");

  grid.querySelectorAll(".category-card").forEach(card => {
    card.addEventListener("click", () => {
      const catId = card.dataset.cat;
      deptPickerState.activeCategoryId = deptPickerState.activeCategoryId === catId ? null : catId;
      renderCategoryCards();
      renderDeptChecklist();
    });
  });
}

/**
 * رسم قائمة الأقسام التابعة للفئة النشطة حالياً كبطاقات قابلة للتحديد (checkbox).
 * إذا لم تكن هناك فئة نشطة، تُعرض رسالة إرشادية بدل القائمة.
 * كل ضغطة على قسم تستدعي toggleDepartment() لإضافته أو إزالته من الاختيار.
 */
function renderDeptChecklist(){
  const hint = document.getElementById("categoryHint");
  const list = document.getElementById("deptChecklist");
  const cat = CATEGORIES.find(c => c.id === deptPickerState.activeCategoryId);

  if (!cat){
    hint.style.display = "block";
    hint.textContent = "اختر فئة أعلاه لعرض أقسامها";
    list.innerHTML = "";
    return;
  }

  hint.style.display = "none";
  list.innerHTML = cat.departments.map(dep => `
    <div class="dept-check-card ${deptPickerState.selected.has(dep) ? "checked" : ""}" data-dep="${escapeHtml(dep)}">
      <span class="box">${deptPickerState.selected.has(dep) ? "✓" : ""}</span>
      <span>${escapeHtml(dep)}</span>
    </div>
  `).join("");

  list.querySelectorAll(".dept-check-card").forEach(card => {
    card.addEventListener("click", () => {
      toggleDepartment(card.dataset.dep);
    });
  });
}

/**
 * تبديل حالة اختيار قسم واحد (إضافة أو إزالة) ضمن مجموعة الأقسام المختارة.
 * عند الإضافة: يُنشأ مُدخل فارغ لفترة التدريب الخاصة بهذا القسم في deptPickerState.dates.
 * عند الإزالة: يُحذف القسم وفترته المرتبطة به معاً.
 * تُعيد رسم كل من: بطاقات الفئات، قائمة الأقسام، ملخص الاختيار، وصفوف الفترات،
 * لأن أياً من هذه الأجزاء قد يتأثر بتغيّر قائمة الأقسام المختارة.
 * @param {string} dep - اسم القسم المطلوب تبديل حالته
 */
function toggleDepartment(dep){
  if (deptPickerState.selected.has(dep)){
    deptPickerState.selected.delete(dep);
    deptPickerState.dates.delete(dep);
  } else {
    deptPickerState.selected.add(dep);
    deptPickerState.dates.set(dep, { start: "", end: "" });
  }
  renderCategoryCards();
  renderDeptChecklist();
  renderSelectedSummary();
  renderPeriods();
  if (deptPickerState.selected.size > 0) clearFieldError("department");
}

/**
 * رسم شريط ملخص الأقسام المختارة أعلى قسم الفترات: عدد الأقسام بصياغة عربية صحيحة،
 * وشرائح (chips) قابلة للحذف لكل قسم مختار — الضغط على «✕» في أي شريحة
 * يستدعي toggleDepartment() لإزالة ذلك القسم بنفس منطق إزالته من القائمة.
 */
function renderSelectedSummary(){
  const summary = document.getElementById("selectedSummary");
  const countEl = document.getElementById("selectedCount");
  const chipsEl = document.getElementById("selectedChips");
  const n = deptPickerState.selected.size;

  summary.classList.toggle("has-selection", n > 0);
  countEl.textContent = n === 0 ? "لم يتم اختيار أي قسم بعد" : `تم اختيار ${formatSelectedDeptCount(n)}`;

  chipsEl.innerHTML = Array.from(deptPickerState.selected).map(dep => `
    <span class="dept-chip" data-dep="${escapeHtml(dep)}">
      ${escapeHtml(dep)}
      <button type="button" aria-label="إزالة">✕</button>
    </span>
  `).join("");

  chipsEl.querySelectorAll(".dept-chip button").forEach(btn => {
    btn.addEventListener("click", () => {
      toggleDepartment(btn.parentElement.dataset.dep);
    });
  });
}

// صياغة عربية لعدد الأقسام المختارة (قسم واحد / قسمان / أقسام)
/**
 * صياغة عربية نحوياً صحيحة لعدد الأقسام المختارة (قسم واحد / قسمان / ٣-١٠ أقسام / أكثر).
 * @param {number} n - عدد الأقسام المختارة
 * @returns {string} النص العربي المناسب للعدد
 */
function formatSelectedDeptCount(n){
  if (n === 1) return "قسم واحد";
  if (n === 2) return "قسمان";
  if (n >= 3 && n <= 10) return `${n} أقسام`;
  return `${n} قسماً`;
}

// ---------------------------------------------------------------------------
// فترة تدريب مستقلة لكل قسم مختار
// ---------------------------------------------------------------------------
/**
 * رسم قسم الفترة التدريبية بحسب الاختيار العام الحالي (deptPickerState.mode):
 *
 * - وضع "dated" (تحديد الفترة الآن): يرسم صفاً مستقلاً لكل قسم مختار (تاريخ
 *   بداية + نهاية + مدة محسوبة تلقائياً)، بنفس السلوك السابق تماماً.
 * - وضع "waitlist" (قائمة الانتظار): يُخفي صفوف التواريخ بالكامل ويعرض
 *   رسالة توضيحية واحدة بدلاً منها — لأن الاختيار هنا عام لكل الأقسام معاً،
 *   وليس لكل قسم على حدة؛ كل الأقسام المختارة ستُضاف كسجل واحد للطالب في
 *   قائمة الانتظار (راجع insertWaitlistStudents في js/supabase.js)، وتُحدَّد
 *   فترة كل قسم منها لاحقاً دفعة واحدة من صفحة قائمة الانتظار (waiting.html)،
 *   وعندها ينتقل الطالب تلقائياً إلى لوحة الإدارة بكل أقسامه معاً.
 *
 * في وضع "dated" فقط: كل صف يملك مستمعي أحداث خاصة به لتحديث
 * deptPickerState.dates عند تغيير التاريخ، وللتحقق الفوري من أن تاريخ
 * النهاية لا يسبق تاريخ البداية، وزر لحذف القسم بالكامل من الصف مباشرة.
 */
function renderPeriods(){
  const hint = document.getElementById("periodsHint");
  const list = document.getElementById("periodsList");
  const notice = document.getElementById("waitlistModeNotice");
  const depts = Array.from(deptPickerState.selected);

  // وضع قائمة الانتظار: لا حاجة لأي صفوف تواريخ — رسالة توضيحية واحدة (تتضمن
  // حقل الملاحظة الإلزامي) تظهر فقط بعد اختيار قسم واحد على الأقل، فلا معنى
  // لإظهارها قبل أن يختار المستخدم أي قسم بعد.
  if (deptPickerState.mode === "waitlist"){
    hint.style.display = "none";
    list.style.display = "none";
    list.innerHTML = "";
    notice.style.display = depts.length > 0 ? "block" : "none";
    return;
  }

  // وضع تحديد الفترة الآن: نفس السلوك الأصلي (صف تواريخ مستقل لكل قسم)
  notice.style.display = "none";
  list.style.display = "";

  if (depts.length === 0){
    hint.style.display = "block";
    list.innerHTML = "";
    return;
  }
  hint.style.display = "none";

  list.innerHTML = depts.map(dep => {
    const d = deptPickerState.dates.get(dep) || { start: "", end: "" };
    return `
      <div class="period-row" data-dep="${escapeHtml(dep)}">
        <div class="period-row-head">
          <span class="period-dept-name"><span class="dept-tag-icon">${getDepartmentIcon(dep)}</span>${escapeHtml(dep)}</span>
          <button type="button" class="period-row-remove" aria-label="إزالة القسم">✕</button>
        </div>
        <div class="period-fields">
          <div class="p-field">
            <label>تاريخ بداية التدريب <span class="req">*</span></label>
            <input type="date" class="p-start" value="${d.start || ""}">
          </div>
          <div class="p-field">
            <label>تاريخ نهاية التدريب <span class="req">*</span></label>
            <input type="date" class="p-end" value="${d.end || ""}">
          </div>
        </div>
        <div class="period-duration" data-role="duration"><span>⏱ مدة التدريب:</span><span class="num"></span></div>
        <div class="period-error-inline">تاريخ النهاية لا يمكن أن يسبق تاريخ البداية</div>
      </div>`;
  }).join("");

  list.querySelectorAll(".period-row").forEach(row => {
    const dep = row.dataset.dep;
    const startInput = row.querySelector(".p-start");
    const endInput = row.querySelector(".p-end");
    const durationEl = row.querySelector(".period-duration");
    const durationNum = durationEl.querySelector(".num");

    function updateRow(){
      const start = startInput.value;
      const end = endInput.value;
      deptPickerState.dates.set(dep, { start, end });

      if (!start || !end){
        durationEl.classList.remove("show");
        row.classList.remove("has-error");
        return;
      }
      if (new Date(end) < new Date(start)){
        row.classList.add("has-error");
        durationEl.classList.remove("show");
        return;
      }
      row.classList.remove("has-error");
      const days = calcDurationDays(start, end);
      durationNum.textContent = formatDurationLabel(days);
      durationEl.classList.add("show");
      clearFieldError("periods");
    }

    startInput.addEventListener("change", updateRow);
    endInput.addEventListener("change", updateRow);

    row.querySelector(".period-row-remove").addEventListener("click", () => {
      toggleDepartment(dep);
    });
  });
}

// ---------------------------------------------------------------------------
// أدوات التحقق من الحقول
// ---------------------------------------------------------------------------
/**
 * إظهار حالة الخطأ البصرية (حدود حمراء + رسالة الخطأ) لحقل معيّن في النموذج.
 * @param {string} name - قيمة data-field الخاصة بالحقل المطلوب تمييزه كخاطئ
 */
function setFieldError(name){
  const field = document.querySelector(`[data-field="${name}"]`);
  if (!field) return;
  field.classList.add("has-error");
  const input = field.querySelector("input, select, textarea");
  if (input) input.classList.add("error");
}
/**
 * إزالة حالة الخطأ البصرية عن حقل معيّن بعد تصحيحه.
 * @param {string} name - قيمة data-field الخاصة بالحقل المطلوب مسح خطأه
 */
function clearFieldError(name){
  const field = document.querySelector(`[data-field="${name}"]`);
  if (!field) return;
  field.classList.remove("has-error");
  const input = field.querySelector("input, select, textarea");
  if (input) input.classList.remove("error");
}

// تتحقق من صلاحية بيانات الطالب الأساسية + كل فترة تدريب لكل قسم مختار
/**
 * التحقق الشامل من صحة كل حقول نموذج التسجيل قبل الإرسال إلى Supabase:
 * الاسم، الهاتف (أرقام فقط)، التخصص، الكلية (إلزامية)، القسم الواحد على الأقل،
 * وفترة تدريب صحيحة (بداية ونهاية) لكل قسم مختار على حدة.
 * تُبرز كل الحقول غير الصالحة دفعة واحدة بدل التوقف عند أول خطأ.
 * @returns {object|null} بيانات النموذج جاهزة للإرسال إن كانت صحيحة، أو null إن وُجد أي خطأ
 */
function validateForm(){
  let valid = true;

  const name = document.getElementById("student_name").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const specialization = document.getElementById("specialization").value.trim();
  const college = document.getElementById("college").value.trim();
  const gender = document.getElementById("gender").value;
  const nationalitySelect = document.getElementById("nationality").value;
  const nationality = nationalitySelect === "أخرى"
    ? document.getElementById("nationality_other").value.trim()
    : nationalitySelect;
  const yearOfStudy = document.getElementById("year_of_study").value.trim();
  const placeOfTrainingSelect = document.getElementById("place_of_training").value;
  const placeOfTraining = placeOfTrainingSelect === "أخرى"
    ? document.getElementById("place_of_training_other").value.trim()
    : placeOfTrainingSelect;
  const trainingType = document.getElementById("training_type").value;
  const academicStage = document.getElementById("academic_stage").value;
  const departments = Array.from(deptPickerState.selected);

  [
    ["student_name", name.length > 0],
    ["phone", phone.length >= 6 && /^[0-9]+$/.test(phone)],
    ["specialization", specialization.length > 0],
    ["college", college.length > 0], // الكلية/الجامعة أصبحت حقلاً إلزامياً
    ["gender", gender.length > 0],
    ["nationality", nationality.length > 0],
    ["year_of_study", yearOfStudy.length > 0],
    ["place_of_training", placeOfTraining.length > 0],
    ["training_type", trainingType.length > 0],
    ["academic_stage", academicStage.length > 0],
    ["department", departments.length > 0],
  ].forEach(([field, ok]) => {
    if (ok) clearFieldError(field); else { setFieldError(field); valid = false; }
  });

  // تحقق من فترة كل قسم على حدة — يُتخطّى بالكامل في وضع قائمة الانتظار،
  // لأن الاختيار هناك عام لكل الأقسام معاً وبلا فترة تدريب محددة بعد.
  let periodsValid = departments.length > 0;
  if (deptPickerState.mode === "dated"){
    document.querySelectorAll(".period-row").forEach(row => {
      const dep = row.dataset.dep;
      const d = deptPickerState.dates.get(dep) || {};
      const ok = d.start && d.end && new Date(d.end) >= new Date(d.start);
      row.classList.toggle("has-error", !ok);
      if (!ok) periodsValid = false;
    });
  }
  if (periodsValid) clearFieldError("periods"); else { setFieldError("periods"); valid = false; }

  // تحقق من إلزامية «الملاحظة» — فقط في وضع قائمة الانتظار وعند اختيار قسم
  // واحد على الأقل (لا معنى لإلزامها إن لم يُختر أي قسم بعد).
  let waitlistNoteValid = true;
  if (deptPickerState.mode === "waitlist" && departments.length > 0){
    const note = document.getElementById("waitlistNote").value.trim();
    waitlistNoteValid = note.length > 0;
  }
  if (waitlistNoteValid) clearFieldError("waitlist_note"); else { setFieldError("waitlist_note"); valid = false; }

  if (!valid) return null;

  const items = departments.map(dep => {
    if (deptPickerState.mode === "waitlist"){
      return { department: dep, waitlist: true };
    }
    const d = deptPickerState.dates.get(dep);
    return { department: dep, start: d.start, end: d.end, waitlist: false };
  });

  return { name, phone, specialization, college, gender, nationality, yearOfStudy, placeOfTraining, trainingType, academicStage, items };
}

// ---------------------------------------------------------------------------
// إرسال النموذج إلى Supabase
// ---------------------------------------------------------------------------
/**
 * ربط حدث submit الخاص بنموذج التسجيل: يمنع الإرسال الفتراضي للمتصفح، يمنع النقر
 * المتكرر أثناء الحفظ (isSubmitting)، يتحقق من الحقول، ثم يستدعي
 * insertStudentsWithPeriods() لإنشاء سجل مستقل لكل قسم مختار بنفس بيانات الطالب.
 * عند النجاح: يُفرّغ النموذج بالكامل ويعيد ضبط حالة منتقي الأقسام والفترات.
 */
function initFormSubmit(){
  const form = document.getElementById("registerForm");
  const submitBtn = document.getElementById("submitBtn");
  let isSubmitting = false;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isSubmitting) return; // منع النقر المتكرر

    // رسائل تحقق محددة قبل التحقق الشامل، لإظهار أدق سبب للفشل
    if (deptPickerState.selected.size === 0){
      setFieldError("department");
      showToast("يرجى اختيار قسم واحد على الأقل", "error");
      return;
    }

    const values = validateForm();
    if (!values){
      showToast("يرجى تعبئة جميع الحقول المطلوبة بشكل صحيح", "error");
      return;
    }

    isSubmitting = true;
    setButtonLoading(submitBtn, true);

    try {
      const base = {
        student_name: values.name,
        phone: values.phone,
        specialization: values.specialization,
        college: values.college,
        gender: values.gender,
        nationality: values.nationality,
        year_of_study: values.yearOfStudy,
        place_of_training: values.placeOfTraining,
        training_type: values.trainingType,
        academic_stage: values.academicStage,
      };

      // تقسيم الأقسام المختارة إلى مجموعتين: أقسام بفترة محددة (تُدرج مباشرة
      // بلوحة الإدارة) وأقسام قائمة انتظار (تُدرج بلا فترة، وتُحدَّد لاحقاً
      // من صفحة قائمة الانتظار)
      const datedItems = values.items.filter(i => !i.waitlist);
      const waitlistItems = values.items.filter(i => i.waitlist);

      if (datedItems.length > 0){
        await insertStudentsWithPeriods(base, datedItems);
      }
      if (waitlistItems.length > 0){
        const waitlistNote = document.getElementById("waitlistNote").value.trim();
        await insertWaitlistStudents(base, waitlistItems.map(i => i.department), waitlistNote);
      }

      const parts = [];
      if (datedItems.length > 0) parts.push(`${datedItems.length} بفترة محددة`);
      if (waitlistItems.length > 0) parts.push(`${waitlistItems.length} ضمن قائمة الانتظار`);
      showToast(`تم تسجيل المتدرب بنجاح (${parts.join(" و")})`, "success");

      form.reset();
      deptPickerState.selected.clear();
      deptPickerState.dates.clear();
      deptPickerState.mode = "dated";
      deptPickerState.activeCategoryId = null;
      document.querySelectorAll("#trainingModeToggle .mode-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.mode === "dated");
      });
      document.getElementById("waitlistNote").value = "";
      document.getElementById("place_of_training_other").style.display = "none";
      document.getElementById("nationality_other").style.display = "none";
      renderCategoryCards();
      renderDeptChecklist();
      renderSelectedSummary();
      renderPeriods();
    } catch (err){
      console.error("فشل إدراج بيانات المتدرب:", err);
      showToast(describeSupabaseError(err, "تعذر إتمام التسجيل"), "error");
    } finally {
      isSubmitting = false;
      setButtonLoading(submitBtn, false);
    }
  });
}
