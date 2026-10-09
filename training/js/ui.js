// ============================================================================
// ui.js
// عناصر واجهة مشتركة تُستخدم من كل من register.html وdashboard.html:
// التنبيهات المنبثقة (Toast)، نافذة التأكيد المخصصة، نافذة تعديل بيانات
// المتدرب، بالإضافة إلى دوال تنسيق التواريخ والمدة (بأسبوع عمل من الأحد
// للخميس)، حساب حالة التدريب، وترجمة أخطاء Supabase لرسائل عربية مفهومة.
//
// لا يوجد أي استخدام لـ alert() أو confirm() الأصليتين في المتصفح؛ كل تفاعل
// مع المستخدم يمر عبر showToast()، showConfirm()، أو showEditStudentModal().
//
// يجب تحميل هذا الملف *قبل* supabase.js وapp.js وdashboard.js وreport.js
// لأنهم جميعاً يعتمدون على الدوال المعرَّفة هنا.
// ============================================================================

/**
 * التأكد من وجود حاوية التنبيهات المنبثقة (toast-stack) في الصفحة، وإنشاؤها
 * إن لم تكن موجودة بعد. تُستدعى داخلياً من showToast() فقط.
 * @returns {HTMLElement} عنصر الحاوية
 */
function ensureToastStack(){
  let stack = document.querySelector(".toast-stack");
  if (!stack){
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

const TOAST_ICONS = { success: "✅", error: "⚠️", warning: "⏳" };

/**
 * عرض تنبيه منبثق قصير للمستخدم (نجاح/خطأ/تحذير) في أسفل يسار الشاشة، يختفي
 * تلقائياً بعد مدة محددة أو عند الضغط على زر الإغلاق. الاستبدال الوحيد
 * لـ alert() في هذا المشروع لعرض رسائل النجاح/الفشل.
 * @param {string} message - نص الرسالة (يُعقَّم تلقائياً عبر escapeHtml)
 * @param {'success'|'error'|'warning'} type - نوع التنبيه ولونه
 * @param {number} duration - المدة بالمللي ثانية قبل الاختفاء التلقائي (0 = لا يختفي تلقائياً)
 */
function showToast(message, type = "success", duration = 3600){
  const stack = ensureToastStack();
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="icon">${TOAST_ICONS[type] || "ℹ️"}</span>
    <span class="msg">${escapeHtml(message)}</span>
    <button class="close-toast" aria-label="إغلاق">✕</button>
  `;
  stack.appendChild(toast);

  const remove = () => {
    toast.classList.add("hide");
    setTimeout(() => toast.remove(), 200);
  };
  toast.querySelector(".close-toast").addEventListener("click", remove);
  if (duration > 0) setTimeout(remove, duration);
}

// -------- نافذة تأكيد مخصصة (بديل لـ confirm()) --------
/**
 * التأكد من وجود نافذة التأكيد المنبثقة (confirm modal) في الصفحة، وإنشاؤها
 * إن لم تكن موجودة بعد. تُستدعى داخلياً من showConfirm() فقط.
 * @returns {HTMLElement} عنصر الطبقة الخلفية (overlay) للنافذة
 */
function ensureModal(){
  let overlay = document.querySelector(".modal-overlay");
  if (!overlay){
    overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-box">
        <div class="m-icon">❔</div>
        <h4 class="m-title"></h4>
        <p class="m-text"></p>
        <div class="modal-actions">
          <button class="m-cancel">إلغاء</button>
          <button class="m-confirm">تأكيد</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }
  return overlay;
}

/**
 * عرض نافذة تأكيد مخصصة (بديل alert/confirm الأصليين في المتصفح) وإرجاع وعد
 * (Promise) ينتظر قرار المستخدم. تُستخدم قبل أي عملية حساسة كالحذف النهائي.
 * @param {{title?:string, text?:string, confirmLabel?:string}} options - نصوص النافذة القابلة للتخصيص
 * @returns {Promise<boolean>} true إذا ضغط المستخدم تأكيد، false إذا ألغى
 */
function showConfirm({ title = "تأكيد العملية", text = "", confirmLabel = "تأكيد" } = {}){
  return new Promise(resolve => {
    const overlay = ensureModal();
    overlay.querySelector(".m-title").textContent = title;
    overlay.querySelector(".m-text").textContent = text;
    overlay.querySelector(".m-confirm").textContent = confirmLabel;
    overlay.classList.add("show");

    const cancelBtn = overlay.querySelector(".m-cancel");
    const confirmBtn = overlay.querySelector(".m-confirm");

    const cleanup = (result) => {
      overlay.classList.remove("show");
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      resolve(result);
    };
    const onCancel = () => cleanup(false);
    const onConfirm = () => cleanup(true);

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
  });
}

// -------- نافذة إدخال نص إلزامي (مثل سبب إرجاع طالب لقائمة الانتظار) --------
/**
 * التأكد من وجود نافذة "إدخال نص إلزامي" في الصفحة، وإنشاؤها إن لم تكن
 * موجودة بعد. تُستخدم داخلياً من showReasonPrompt() فقط.
 * @returns {HTMLElement} عنصر الطبقة الخلفية (overlay) لهذه النافذة
 */
function ensureReasonPromptModal(){
  let overlay = document.querySelector(".reason-prompt-modal-overlay");
  if (!overlay){
    overlay = document.createElement("div");
    overlay.className = "modal-overlay reason-prompt-modal-overlay";
    overlay.innerHTML = `
      <div class="modal-box reason-prompt-box">
        <h4 class="m-title"></h4>
        <p class="m-text"></p>
        <textarea class="reason-input" rows="3" maxlength="300"></textarea>
        <p class="e-error"></p>
        <div class="modal-actions">
          <button class="m-cancel">إلغاء</button>
          <button class="m-confirm">تأكيد</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }
  return overlay;
}

/**
 * عرض نافذة تطلب من المستخدم كتابة نص إلزامي (مثل سبب إرجاع طالب لقائمة
 * الانتظار) قبل تنفيذ إجراء ما — لا يُقبل التأكيد بنص فارغ، وتظهر رسالة خطأ
 * أسفل الحقل عند المحاولة بلا كتابة شيء.
 * @param {{title?:string, text?:string, placeholder?:string, confirmLabel?:string}} [options]
 * @returns {Promise<string|null>} النص المُدخَل (مقصوص من الفراغات الطرفية) عند التأكيد، أو null عند الإلغاء
 */
function showReasonPrompt({ title = "", text = "", placeholder = "", confirmLabel = "تأكيد" } = {}){
  return new Promise(resolve => {
    const overlay = ensureReasonPromptModal();
    const input = overlay.querySelector(".reason-input");
    const errorEl = overlay.querySelector(".e-error");

    overlay.querySelector(".m-title").textContent = title;
    overlay.querySelector(".m-text").textContent = text;
    overlay.querySelector(".m-confirm").textContent = confirmLabel;
    input.value = "";
    input.placeholder = placeholder;
    errorEl.textContent = "";
    errorEl.classList.remove("show");
    overlay.classList.add("show");

    const cancelBtn2 = overlay.querySelector(".m-cancel");
    const confirmBtn2 = overlay.querySelector(".m-confirm");

    const cleanup = (result) => {
      overlay.classList.remove("show");
      cancelBtn2.removeEventListener("click", onCancel);
      confirmBtn2.removeEventListener("click", onConfirm);
      resolve(result);
    };
    const onCancel = () => cleanup(null);
    const onConfirm = () => {
      const value = input.value.trim();
      if (!value){
        errorEl.textContent = "يرجى كتابة السبب أولاً";
        errorEl.classList.add("show");
        return;
      }
      cleanup(value);
    };

    cancelBtn2.addEventListener("click", onCancel);
    confirmBtn2.addEventListener("click", onConfirm);
  });
}

// -------- نافذة تعديل بيانات متدرب (سجل واحد) --------
/**
 * التأكد من وجود نافذة تعديل بيانات المتدرب في الصفحة، وإنشاؤها بكل حقولها
 * (الاسم، الهاتف، الكلية، التخصص، الجنس، نوع التدريب، القسم، تاريخي البداية
 * والنهاية) إن لم تكن موجودة بعد. تُستدعى داخلياً من showEditStudentModal() فقط.
 * @returns {HTMLElement} عنصر الطبقة الخلفية (overlay) لنافذة التعديل
 */
function ensureEditModal(){
  let overlay = document.querySelector(".edit-modal-overlay");
  if (!overlay){
    overlay = document.createElement("div");
    overlay.className = "modal-overlay edit-modal-overlay";
    overlay.innerHTML = `
      <div class="modal-box edit-modal-box">
        <h4 class="m-title">تعديل بيانات المتدرب</h4>
        <div class="edit-form">
          <div class="e-field">
            <label>اسم الطالب</label>
            <input type="text" class="e-name">
          </div>
          <div class="e-field">
            <label>رقم الهاتف</label>
            <input type="text" class="e-phone" inputmode="numeric">
          </div>
          <div class="e-field">
            <label>الكلية / الجامعة</label>
            <input type="text" class="e-college">
          </div>
          <div class="e-field">
            <label>التخصص</label>
            <input type="text" class="e-spec">
          </div>
          <div class="e-field">
            <label>الجنس</label>
            <select class="e-gender">
              <option value="">اختر</option>
              <option value="ذكر">ذكر</option>
              <option value="انثى">انثى</option>
            </select>
          </div>
          <div class="e-field">
            <label>الجنسية</label>
            <input type="text" class="e-nationality">
          </div>
          <div class="e-field">
            <label>السنة الدراسية</label>
            <input type="text" class="e-year">
          </div>
          <div class="e-field">
            <label>مكان التدريب</label>
            <input type="text" class="e-place">
          </div>
          <div class="e-field">
            <label>نوع التدريب</label>
            <select class="e-training-type">
              <option value="">اختر</option>
              <option value="تدريب إلزامي">تدريب إلزامي</option>
              <option value="تدريب تطوعي">تدريب تطوعي</option>
            </select>
          </div>
          <div class="e-field">
            <label>المرحلة الدراسية</label>
            <select class="e-academic-stage">
              <option value="">اختر</option>
              <option value="طالب">طالب</option>
              <option value="خريج">خريج</option>
            </select>
          </div>
          <div class="e-field full">
            <label>القسم</label>
            <select class="e-dept"></select>
          </div>
          <div class="e-field">
            <label>بداية التدريب</label>
            <input type="date" class="e-start">
          </div>
          <div class="e-field">
            <label>نهاية التدريب</label>
            <input type="date" class="e-end">
          </div>
        </div>
        <p class="e-error"></p>
        <div class="modal-actions">
          <button class="m-cancel">إلغاء</button>
          <button class="m-confirm m-save">حفظ التعديلات</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }
  return overlay;
}

/**
 * عرض نافذة تعديل مُعبّأة مسبقاً بقيم سجل معيّن، مع تحقق فوري من صحة الحقول
 * (كلها إلزامية، الهاتف أرقام فقط، تاريخ النهاية لا يسبق البداية) قبل قبول
 * الحفظ. تُرجع وعداً ينتظر قرار المستخدم.
 *
 * تُستخدم في مكانين بنفس المنطق تماماً: (١) «✏️ تعديل» في لوحة التحكم لسجل
 * له فترة محددة أصلاً، و(٢) «📅 تحديد الفترة» في صفحة قائمة الانتظار لسجل بلا
 * فترة بعد (حقلا التاريخ يبدآن فارغين، والتحقق يفرض تعبئتهما قبل القبول).
 * خياران نصيّان اختياريان يخصّصان العنوان وزر الحفظ حسب سياق الاستخدام.
 * @param {object} record - السجل الحالي المطلوب تعديله (لتعبئة الحقول بقيمه)
 * @param {{title?:string, confirmLabel?:string}} options - نصوص قابلة للتخصيص حسب سياق الاستدعاء
 * @returns {Promise<object|null>} كائن القيم الجديدة عند الحفظ، أو null عند الإلغاء
 */
function showEditStudentModal(record, options = {}){
  const { title = "تعديل بيانات المتدرب", confirmLabel = "حفظ التعديلات" } = options;
  return new Promise(resolve => {
    const overlay = ensureEditModal();
    const titleEl = overlay.querySelector(".m-title");
    const nameInput = overlay.querySelector(".e-name");
    const phoneInput = overlay.querySelector(".e-phone");
    const collegeInput = overlay.querySelector(".e-college");
    const specInput = overlay.querySelector(".e-spec");
    const genderSelect = overlay.querySelector(".e-gender");
    const nationalityInput = overlay.querySelector(".e-nationality");
    const yearInput = overlay.querySelector(".e-year");
    const placeInput = overlay.querySelector(".e-place");
    const trainingTypeSelect = overlay.querySelector(".e-training-type");
    const academicStageSelect = overlay.querySelector(".e-academic-stage");
    const deptSelect = overlay.querySelector(".e-dept");
    const startInput = overlay.querySelector(".e-start");
    const endInput = overlay.querySelector(".e-end");
    const errorEl = overlay.querySelector(".e-error");

    titleEl.textContent = title;
    nameInput.value = record.student_name || "";
    phoneInput.value = record.phone || "";
    collegeInput.value = record.college || "";
    specInput.value = record.specialization || "";
    genderSelect.value = record.gender || "";
    nationalityInput.value = record.nationality || "";
    yearInput.value = record.year_of_study || "";
    placeInput.value = record.place_of_training || "";
    trainingTypeSelect.value = record.training_type || "";
    academicStageSelect.value = record.academic_stage || "";
    deptSelect.innerHTML = DEPARTMENTS.map(d => `<option value="${escapeHtml(d)}" ${d === record.department ? "selected" : ""}>${escapeHtml(d)}</option>`).join("");
    startInput.value = record.training_start || "";
    endInput.value = record.training_end || "";
    errorEl.textContent = "";
    errorEl.classList.remove("show");

    overlay.classList.add("show");

    const cancelBtn = overlay.querySelector(".m-cancel");
    const confirmBtn = overlay.querySelector(".m-save");
    confirmBtn.textContent = confirmLabel;

    const cleanup = (result) => {
      overlay.classList.remove("show");
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      resolve(result);
    };
    const onCancel = () => cleanup(null);
    const onConfirm = () => {
      const student_name = nameInput.value.trim();
      const phone = phoneInput.value.trim();
      const college = collegeInput.value.trim();
      const specialization = specInput.value.trim();
      const gender = genderSelect.value;
      const nationality = nationalityInput.value.trim();
      const year_of_study = yearInput.value.trim();
      const place_of_training = placeInput.value.trim();
      const training_type = trainingTypeSelect.value;
      const academic_stage = academicStageSelect.value;
      const department = deptSelect.value;
      const training_start = startInput.value;
      const training_end = endInput.value;

      if (!student_name || !phone || !specialization || !gender || !nationality || !year_of_study || !place_of_training || !training_type || !academic_stage || !department || !training_start || !training_end){
        errorEl.textContent = "يرجى تعبئة جميع الحقول المطلوبة";
        errorEl.classList.add("show");
        return;
      }
      if (!/^[0-9]+$/.test(phone)){
        errorEl.textContent = "رقم الهاتف يجب أن يحتوي أرقاماً فقط";
        errorEl.classList.add("show");
        return;
      }
      if (new Date(training_end) < new Date(training_start)){
        errorEl.textContent = "تاريخ النهاية لا يمكن أن يسبق تاريخ البداية";
        errorEl.classList.add("show");
        return;
      }

      cleanup({ student_name, phone, college, specialization, gender, nationality, year_of_study, place_of_training, training_type, academic_stage, department, training_start, training_end });
    };

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
  });
}

// -------- نافذة تحديد فترات التدريب لكل أقسام طالب قائمة انتظار دفعة واحدة --------
/**
 * التأكد من وجود نافذة «تحديد فترات التدريب» في الصفحة، وإنشاؤها إن لم تكن
 * موجودة بعد. تُستدعى داخلياً من showAssignMultiPeriodModal() فقط.
 * @returns {HTMLElement} عنصر الطبقة الخلفية (overlay) لهذه النافذة
 */
function ensureAssignPeriodsModal(){
  let overlay = document.querySelector(".assign-periods-modal-overlay");
  if (!overlay){
    overlay = document.createElement("div");
    overlay.className = "modal-overlay assign-periods-modal-overlay";
    overlay.innerHTML = `
      <div class="modal-box edit-modal-box assign-periods-box">
        <h4 class="m-title">تحديد فترات التدريب ونقل الطالب</h4>
        <div class="assign-student-summary">
          <div class="as-name"></div>
          <div class="as-phone"></div>
        </div>
        <div class="periods-list"></div>
        <div class="as-note-field">
          <label for="asNote">ملاحظة</label>
          <textarea id="asNote" class="as-note" rows="3" maxlength="300" placeholder="أي ملاحظة بخصوص هذا الطالب..."></textarea>
        </div>
        <p class="e-error"></p>
        <div class="modal-actions assign-periods-actions">
          <button class="m-cancel">إلغاء</button>
          <button class="m-confirm m-save-only">حفظ</button>
          <button class="m-confirm m-transfer">نقل إلى لوحة الإدارة</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }
  return overlay;
}

/**
 * عرض نافذة تحديد فترة تدريب مستقلة لكل قسم من أقسام طالب واحد في قائمة
 * الانتظار دفعة واحدة (تُستخدم حصرياً من زر «📅 تحديد الفترات ونقل الطالب»
 * في صفحة قائمة الانتظار waiting.html). الطالب قد يكون مسجَّلاً في أكثر من
 * قسم معاً (كلها بلا فترة بعد)؛ هذه النافذة تعرض صفاً مستقلاً بنفس تصميم
 * صفوف الفترة في نموذج التسجيل (period-row) لكل قسم من أقسامه، وتفرض تحديد
 * فترة صحيحة لكل قسم منها قبل قبول الحفظ — فلا يُحفظ شيء حتى تكتمل كل الأقسام.
 * تعرض أيضاً حقل «ملاحظة» واحد (مُعبَّأ من ملاحظة أول سجل من سجلات الطالب،
 * إن وُجدت) قابل للتعديل، تُحفظ نفس القيمة المعدَّلة لكل سجل من سجلات هذا
 * الطالب معاً عند الحفظ (الملاحظة تخص الطالب نفسه، وليست لكل قسم على حدة).
 *
 * زران منفصلان تماماً (وليس زر واحد يجمع العمليتين):
 *   - «حفظ»: لا يتطلب تحديد فترة صحيحة لكل قسم — يكفي كتابة ملاحظة (سبب
 *     التأخير، تحديث حالة...) لقبول الحفظ حتى بلا أي تاريخ. يحفظ الفترات
 *     (كما هي، محددة أو فارغة) والملاحظة في قاعدة البيانات، ويُبقي الطالب في
 *     قائمة الانتظار (is_waitlist لا يتغيّر). يمكن إعادة فتح نفس النافذة
 *     لاحقاً فتظهر القيم المحفوظة تماماً.
 *   - «نقل إلى لوحة الإدارة»: يفرض تحديد فترة صحيحة لكل قسم (النقل الفعلي
 *     يتطلب تواريخ حقيقية)، ويستخدم نفس الفترات المعروضة حالياً في النموذج
 *     (سواء كانت محفوظة مسبقاً أو أُدخلت للتو دون ضغط حفظ أولاً) وينقل الطالب
 *     فعلياً (is_waitlist=false) — هذا الزر فقط هو المسؤول عن النقل.
 * @param {{student_name:string, phone:string, records:Array}} group - مجموعة سجلات الطالب في قائمة الانتظار (سجل واحد لكل قسم)
 * @returns {Promise<{action:"save"|"transfer", updates:Array<{id:string, training_start:string, training_end:string, waitlist_note:string}>}|null>} نتيجة العملية المختارة، أو null عند الإلغاء
 */
function showAssignMultiPeriodModal(group){
  return new Promise(resolve => {
    const overlay = ensureAssignPeriodsModal();
    const nameEl = overlay.querySelector(".as-name");
    const phoneEl = overlay.querySelector(".as-phone");
    const listEl = overlay.querySelector(".periods-list");
    const noteEl = overlay.querySelector(".as-note");
    const errorEl = overlay.querySelector(".e-error");

    nameEl.textContent = group.student_name || "";
    phoneEl.textContent = group.phone || "";
    noteEl.value = (group.records[0] && group.records[0].waitlist_note) || "";
    errorEl.textContent = "";
    errorEl.classList.remove("show");

    // نسخة محلية قابلة للتعديل من تواريخ كل سجل (مفتاحها id السجل)، حتى
    // لا تُعدَّل بيانات الصفحة الفعلية إلا بعد الضغط على "حفظ" بنجاح
    const localDates = new Map(group.records.map(r => [r.id, {
      start: r.training_start || "",
      end: r.training_end || "",
    }]));

    function renderRows(){
      listEl.innerHTML = group.records.map(r => {
        const d = localDates.get(r.id);
        return `
          <div class="period-row" data-id="${r.id}">
            <div class="period-row-head">
              <span class="period-dept-name"><span class="dept-tag-icon">${getDepartmentIcon(r.department)}</span>${escapeHtml(r.department)}</span>
            </div>
            <div class="period-fields">
              <div class="p-field">
                <label>تاريخ بداية التدريب <span class="req">*</span></label>
                <input type="date" class="p-start" value="${d.start}">
              </div>
              <div class="p-field">
                <label>تاريخ نهاية التدريب <span class="req">*</span></label>
                <input type="date" class="p-end" value="${d.end}">
              </div>
            </div>
            <div class="period-duration" data-role="duration"><span>⏱ مدة التدريب:</span><span class="num"></span></div>
            <div class="period-error-inline">تاريخ النهاية لا يمكن أن يسبق تاريخ البداية</div>
          </div>`;
      }).join("");

      listEl.querySelectorAll(".period-row").forEach(row => {
        const id = row.dataset.id;
        const startInput = row.querySelector(".p-start");
        const endInput = row.querySelector(".p-end");
        const durationEl = row.querySelector(".period-duration");
        const durationNum = durationEl.querySelector(".num");

        function updateRow(){
          const start = startInput.value;
          const end = endInput.value;
          localDates.set(id, { start, end });

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
          durationNum.textContent = formatDurationLabel(calcDurationDays(start, end));
          durationEl.classList.add("show");
          errorEl.classList.remove("show");
        }

        startInput.addEventListener("change", updateRow);
        endInput.addEventListener("change", updateRow);
      });
    }

    renderRows();
    overlay.classList.add("show");

    const cancelBtn = overlay.querySelector(".m-cancel");
    const saveBtn = overlay.querySelector(".m-save-only");
    const transferBtn = overlay.querySelector(".m-transfer");

    const cleanup = (result) => {
      overlay.classList.remove("show");
      cancelBtn.removeEventListener("click", onCancel);
      saveBtn.removeEventListener("click", onSave);
      transferBtn.removeEventListener("click", onTransfer);
      resolve(result);
    };
    const onCancel = () => cleanup(null);

    /**
     * يتحقق من صحة فترة كل قسم ويبني مصفوفة التحديثات — تُستخدم حصرياً من
     * زر «نقل إلى لوحة الإدارة» أدناه (النقل الفعلي يتطلب فترة صحيحة لكل
     * قسم). زر «حفظ» له مسار مستقل أخف (onSave أدناه) لا يفرض هذا الشرط.
     * @returns {Array|null} مصفوفة التحديثات إن كانت كل الفترات صحيحة، أو null
     */
    const collectValidUpdates = () => {
      let allValid = true;
      const updates = [];
      const noteValue = noteEl.value.trim();

      group.records.forEach(r => {
        const d = localDates.get(r.id) || {};
        const ok = d.start && d.end && new Date(d.end) >= new Date(d.start);
        if (!ok) allValid = false;
        updates.push({ id: r.id, training_start: d.start || null, training_end: d.end || null, waitlist_note: noteValue });
      });

      if (!allValid){
        listEl.querySelectorAll(".period-row").forEach(row => {
          const d = localDates.get(row.dataset.id) || {};
          const ok = d.start && d.end && new Date(d.end) >= new Date(d.start);
          row.classList.toggle("has-error", !ok);
        });
        errorEl.textContent = "يرجى تحديد فترة تدريب صحيحة لكل قسم";
        errorEl.classList.add("show");
        return null;
      }
      return updates;
    };

    const onSave = () => {
      // «حفظ» لا يتطلب فترة تدريب صحيحة لكل قسم — يكفي كتابة ملاحظة فقط
      // (مثلاً سبب التأخير أو أي تحديث آخر) دون الحاجة لتحديد التواريخ الآن.
      // التحقق الصارم من الفترات مطلوب فقط عند «نقل إلى لوحة الإدارة» أدناه.
      const noteValue = noteEl.value.trim();
      if (!noteValue){
        errorEl.textContent = "يرجى كتابة ملاحظة قبل الحفظ";
        errorEl.classList.add("show");
        return;
      }
      errorEl.classList.remove("show");

      const updates = group.records.map(r => {
        const d = localDates.get(r.id) || {};
        return { id: r.id, training_start: d.start || null, training_end: d.end || null, waitlist_note: noteValue };
      });
      cleanup({ action: "save", updates });
    };
    const onTransfer = () => {
      const updates = collectValidUpdates();
      if (!updates) return;
      cleanup({ action: "transfer", updates });
    };

    cancelBtn.addEventListener("click", onCancel);
    saveBtn.addEventListener("click", onSave);
    transferBtn.addEventListener("click", onTransfer);
  });
}


/**
 * تبديل شكل أي زر بين حالته العادية وحالة «جارٍ التحميل» (تعطيل الزر + إظهار
 * دوّارة تحميل صغيرة بداخله). تُستخدم أثناء انتظار رد Supabase لمنع النقر
 * المتكرر ولإعطاء المستخدم إشارة بصرية أن العملية قيد التنفيذ.
 * @param {HTMLElement} btn - عنصر الزر المطلوب تبديل حالته
 * @param {boolean} isLoading - true لتفعيل حالة التحميل، false لإعادته لحالته الطبيعية
 */
function setButtonLoading(btn, isLoading, labelEl){
  btn.disabled = isLoading;
  btn.classList.toggle("loading", isLoading);
}

// -------- تنسيق التاريخ الميلادي بشكل عربي مقروء --------
/**
 * تنسيق تاريخ (بصيغة yyyy-mm-dd) إلى نص عربي طويل مقروء (مثال: ٦ أغسطس ٢٠٢٦).
 * @param {string} dateStr - التاريخ بصيغة yyyy-mm-dd
 * @returns {string} التاريخ بصيغة عربية طويلة، أو «—» إن كانت القيمة فارغة
 */
function formatArabicDate(dateStr){
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * تنسيق تاريخ (بصيغة yyyy-mm-dd أو كائن Date) إلى صيغة مختصرة يوم/شهر/سنة
 * (مثال: 06/08/2026)، تُستخدم في كل الجداول والتقارير لاختصار المساحة.
 * @param {string|Date} dateStr - التاريخ المطلوب تنسيقه
 * @returns {string} التاريخ بصيغة dd/mm/yyyy، أو «—» إن كانت القيمة فارغة
 */
function formatDateShort(dateStr){
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

// -------- حساب مدة التدريب بأيام العمل فقط (الأحد إلى الخميس، باستثناء الجمعة والسبت) --------
/**
 * حساب عدد أيام العمل الفعلية بين تاريخي بداية ونهاية، باعتبار أسبوع العمل
 * من الأحد إلى الخميس فقط (٥ أيام) — أي يوم جمعة أو سبت يقع ضمن الفترة
 * لا يُحتسب ضمن المدة المعروضة للمستخدم، مهما كان عدد الأيام التقويمية الفعلي.
 * @param {string} start - تاريخ البداية بصيغة yyyy-mm-dd
 * @param {string} end - تاريخ النهاية بصيغة yyyy-mm-dd
 * @returns {number} عدد أيام العمل (الأحد-الخميس) ضمن الفترة، شاملاً يومي البداية والنهاية
 */
function calcDurationDays(start, end){
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  let count = 0;
  const cur = new Date(s);
  while (cur <= e){
    const day = cur.getDay(); // 0=الأحد … 5=الجمعة، 6=السبت
    if (day !== 5 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// -------- صياغة عربية لعدد الأيام (تُستخدم كاحتياط لما دون الأسبوع، ولبقية الأيام) --------
/**
 * صياغة عربية نحوياً صحيحة لعدد أيام (يوم واحد / يومان / ٣-١٠ أيام / أكثر).
 * تُستخدم كجزء من formatDurationLabel() لعرض الأيام المتبقية بعد الأسابيع الكاملة.
 * @param {number} days - عدد الأيام
 * @returns {string} النص العربي المناسب للعدد
 */
function formatDaysArabic(days){
  if (days === 1) return "يوم واحد";
  if (days === 2) return "يومان";
  if (days >= 3 && days <= 10) return `${days} أيام`;
  return `${days} يوم`;
}

// -------- صياغة عربية لعدد الأسابيع --------
/**
 * صياغة عربية نحوياً صحيحة لعدد أسابيع العمل (أسبوع واحد / أسبوعان / ٣-١٠ أسابيع / أكثر).
 * «الأسبوع» هنا يعني أسبوع عمل من الأحد للخميس (٥ أيام)، وليس أسبوعاً تقويمياً كاملاً.
 * @param {number} weeks - عدد الأسابيع
 * @returns {string} النص العربي المناسب للعدد
 */
function formatWeeksArabic(weeks){
  if (weeks === 1) return "أسبوع واحد";
  if (weeks === 2) return "أسبوعان";
  if (weeks >= 3 && weeks <= 10) return `${weeks} أسابيع`;
  return `${weeks} أسبوعاً`;
}

// -------- صياغة مدة التدريب بأسابيع العمل (٥ أيام: الأحد–الخميس)، مع أيام متبقية إن وُجدت --------
/**
 * الدالة الرئيسية لعرض مدة التدريب للمستخدم: تحوّل عدد أيام العمل (الناتج من
 * calcDurationDays) إلى صياغة عربية مركّبة من أسابيع وأيام متبقية معاً
 * (مثال: «٤ أسابيع ويومان»)، أو أيام فقط إن كانت المدة أقل من أسبوع كامل.
 * تُستخدم في كل مكان تظهر فيه «مدة التدريب» بالمشروع (النموذج، الجدول، التقارير).
 * @param {number} workingDays - عدد أيام العمل (ناتج calcDurationDays)
 * @returns {string} نص المدة بصياغة عربية، أو «—» إن كانت القيمة صفر أو أقل
 */
function formatDurationLabel(workingDays){
  if (workingDays <= 0) return "—";

  const weeks = Math.floor(workingDays / 5);
  const remainingDays = workingDays % 5;

  if (weeks === 0) return formatDaysArabic(remainingDays);
  if (remainingDays === 0) return formatWeeksArabic(weeks);
  return `${formatWeeksArabic(weeks)} و${formatDaysArabic(remainingDays)}`;
}

// -------- تحديد حالة التدريب بناءً على تاريخ اليوم --------
/**
 * تحديد حالة تدريب سجل واحد بمقارنة تاريخ اليوم بفترة البداية والنهاية:
 * «لم يبدأ» إن كان اليوم قبل البداية، «انتهى» إن كان بعد النهاية،
 * وإلا «قيد التدريب». تُستخدم لعرض شارة الحالة الملوّنة في كل مكان بالمشروع.
 * @param {string} start - تاريخ بداية التدريب بصيغة yyyy-mm-dd
 * @param {string} end - تاريخ نهاية التدريب بصيغة yyyy-mm-dd
 * @returns {{key:string, label:string, cls:string}} مفتاح الحالة، نصها العربي، وصنف CSS الخاص بلونها
 */
function getTrainingStatus(start, end){
  const today = new Date(); today.setHours(0,0,0,0);
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  if (today < s) return { key: "upcoming", label: "لم يبدأ", cls: "status-upcoming" };
  if (today > e) return { key: "ended", label: "انتهى", cls: "status-ended" };
  return { key: "active", label: "قيد التدريب", cls: "status-active" };
}

// -------- بديل شعار الشريط العلوي في حال عدم وجود assets/logo.png --------
/**
 * معالج حدث onerror لصورة الشعار (assets/logo.png): إن تعذّر تحميل الصورة
 * (غير موجودة أو الرابط خاطئ)، تُستبدل تلقائياً بشارة نصية بديلة («ت»)
 * بنفس أبعاد وصنف CSS الصورة الأصلية، بدل ترك أيقونة صورة مكسورة في الواجهة.
 * @param {HTMLImageElement} img - عنصر الصورة الذي فشل تحميله
 */
function handleLogoImgError(img){
  const fallback = document.createElement("div");
  fallback.className = img.className;
  fallback.textContent = "ت";
  img.replaceWith(fallback);
}

// -------- تأخير بسيط لمنع النقر المتكرر --------
/**
 * تأخير تنفيذ دالة حتى تتوقف الاستدعاءات المتكررة لمدة معينة، لمنع تنفيذ
 * منطق مكلف (كإعادة رسم الجدول بالكامل) مع كل ضغطة مفتاح أثناء الكتابة
 * في حقول البحث الفورية. كل استدعاء جديد قبل انتهاء المهلة يُلغي المؤقت السابق.
 * @param {Function} fn - الدالة المطلوب تأخيرها
 * @param {number} wait - مدة الانتظار بالمللي ثانية بعد آخر استدعاء
 * @returns {Function} نسخة مؤخَّرة (debounced) من الدالة الأصلية
 */
function debounce(fn, wait = 250){
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// -------- ترجمة أخطاء Supabase الشائعة إلى رسائل عربية واضحة وقابلة للتصرف --------
// actionLabel: فعل العملية التي فشلت، مثل "تعذر إتمام التسجيل" أو "تعذر حذف الطالب"
/**
 * ترجمة كائن خطأ خام قادم من Supabase (بعد فشل أي طلب insert/update/delete)
 * إلى رسالة عربية واضحة وقابلة للتصرف، بمطابقة أكواد/رسائل الأخطاء الشائعة
 * (سياسات RLS، جدول غير موجود، مخالفة قيد تاريخي، مفتاح API خاطئ، عدم تحديث
 * config.js بعد...). تُستخدم في كل مكان يُعرض فيه خطأ فشل عملية للمستخدم،
 * مع طباعة الخطأ الكامل في Console دائماً لتسهيل التشخيص الفني.
 * @param {object} err - كائن الخطأ كما أرجعه عميل Supabase
 * @param {string} actionLabel - وصف العملية التي فشلت (مثال: «تعذر حذف الطالب»)
 * @returns {string} رسالة عربية جاهزة للعرض في Toast
 */
function describeSupabaseError(err, actionLabel = "تعذرت العملية"){
  const code = err && err.code;
  const msg = (err && (err.message || err.error_description || err.hint)) || "";
  const lower = msg.toLowerCase();

  if (code === "42501" || lower.includes("row-level security") || lower.includes("policy")){
    return `${actionLabel} بسبب سياسات RLS — تأكد من تفعيل السياسة المناسبة (قراءة/إدراج/حذف) في مشروع Supabase`;
  }
  if (code === "42P01" || lower.includes("does not exist") || lower.includes("relation")){
    return "الجدول students غير موجود — تأكد من تنفيذ sql/full_setup.sql في مشروع Supabase";
  }
  if (code === "23514" || lower.includes("chk_training_dates") || lower.includes("check constraint")){
    return "تاريخ النهاية يجب ألا يسبق تاريخ البداية لأحد الأقسام المختارة";
  }
  if (lower.includes("failed to fetch") || lower.includes("networkerror") || lower.includes("network request failed")){
    return "تعذر الاتصال بـ Supabase — تحقق من اتصالك بالإنترنت ومن صحة SUPABASE_URL في js/config.js";
  }
  if (lower.includes("invalid api key") || lower.includes("apikey") || lower.includes("jwt")){
    return "مفتاح Supabase غير صحيح — تحقق من SUPABASE_ANON_KEY في js/config.js";
  }
  if (lower.includes("your-project-ref") || lower.includes("your-public-anon-key")){
    return "لم يتم تحديث js/config.js بعد — ضع بيانات مشروعك الحقيقية بدل القيم الافتراضية";
  }

  // احتياطي: أظهر رسالة Supabase الأصلية إن وُجدت لتسهيل التشخيص
  return msg ? `${actionLabel}: ${msg}` : `${actionLabel}، يرجى المحاولة مرة أخرى`;
}
