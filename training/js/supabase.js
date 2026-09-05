// ============================================================================
// supabase.js
// تهيئة عميل Supabase + كل طبقة الوصول للبيانات في مكان واحد: جلب كل
// السجلات، إدراج سجل لكل قسم مختار عند التسجيل، تعديل سجل، وحذف سجل أو أكثر.
// كل الأخطاء تُرمى (throw) للأعلى ليتعامل معها المستدعي (عادة عبر
// describeSupabaseError من js/ui.js ثم showToast) بدل التعامل معها هنا.
//
// ⚠️ استخدم فقط Anon Key هنا — لا تضع Service Role Key أبداً في كود الواجهة.
// الحماية الفعلية للبيانات تأتي بالكامل من سياسات RLS في sql/full_setup.sql
// (أو ملفات الترقية الفردية)، وليس من إخفاء مفتاح anon فهو عام بطبيعته.
//
// القيم الفعلية تُقرأ من js/config.js الذي يجب تحميله *قبل* هذا الملف.
// ============================================================================

// القيم الفعلية تُقرأ من js/config.js (ملف غير مرفوع لـ Git — انظر config.example.js)
if (!window.APP_CONFIG || !window.APP_CONFIG.SUPABASE_URL || !window.APP_CONFIG.SUPABASE_ANON_KEY){
  throw new Error(
    "إعدادات Supabase غير موجودة. انسخ js/config.example.js إلى js/config.js وضع بياناتك فيه."
  );
}

const SUPABASE_URL = window.APP_CONFIG.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.APP_CONFIG.SUPABASE_ANON_KEY;

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TABLE_NAME = "students";

// -------- تعقيم النصوص قبل العرض (منع XSS) --------
/**
 * تعقيم أي نص قبل إدراجه داخل innerHTML، بتحويل الرموز الخاصة
 * (& < > " ') إلى كياناتها HTML الآمنة، لمنع هجمات XSS من بيانات
 * قد تحتوي على كود HTML/JS (مثل اسم طالب يحتوي على وسم <script>).
 * تُستخدم في كل مكان بالمشروع يُدرج فيه نص قادم من القاعدة داخل الصفحة.
 * @param {*} str - القيمة المطلوب تعقيمها (تُحوَّل تلقائياً إلى نص)
 * @returns {string} نص آمن للإدراج داخل HTML
 */
function escapeHtml(str){
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// -------- إدراج متدرب جديد --------
/**
 * [دالة قديمة غير مستخدمة حالياً] إدراج سجل متدرب واحد بقسم واحد وفترة واحدة.
 * استُبدلت بـ insertStudentsWithPeriods() التي تدعم عدة أقسام بفترات مستقلة
 * في طلب واحد. أُبقيت هنا للتوافق المرجعي فقط.
 * @param {object} payload - بيانات السجل الواحد
 */
async function insertStudent(payload){
  const today = new Date().toISOString().slice(0, 10);

  const record = {
    student_name: payload.student_name.trim(),
    phone: String(payload.phone).trim(),
    specialization: payload.specialization.trim(),
    department: payload.department.trim(),
    training_start: payload.training_start,
    training_end: payload.training_end,
    registration_date: today,
  };

  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .insert([record])
    .select();

  if (error) throw error;
  return data;
}

// -------- إدراج سجل مستقل لكل قسم مختار (نفس بيانات الطالب والتواريخ) --------
/**
 * [دالة قديمة غير مستخدمة حالياً] إدراج عدة سجلات (قسم لكل سجل) لكنها كانت
 * تفترض فترة تدريب واحدة مشتركة لكل الأقسام. استُبدلت بـ
 * insertStudentsWithPeriods() التي تسمح بفترة مختلفة لكل قسم على حدة.
 * @param {object} base - بيانات الطالب المشتركة
 * @param {Array<string>} departments - أسماء الأقسام المختارة
 */
async function insertStudentsForDepartments(base, departments){
  const today = new Date().toISOString().slice(0, 10);

  const records = departments.map(dep => ({
    student_name: base.student_name.trim(),
    phone: String(base.phone).trim(),
    specialization: base.specialization.trim(),
    department: dep.trim(),
    training_start: base.training_start,
    training_end: base.training_end,
    registration_date: today,
  }));

  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .insert(records)
    .select();

  if (error) throw error;
  return data;
}

// -------- إدراج سجل مستقل لكل قسم مختار، بفترة تدريب خاصة بكل قسم --------
/**
 * الدالة الفعلية المستخدمة عند تسجيل متدرب جديد: تُنشئ سجلاً مستقلاً في قاعدة
 * البيانات لكل قسم مختار، بنفس بيانات الطالب المشتركة (الاسم، الهاتف،
 * التخصص، الكلية)، لكن بفترة تدريب (بداية/نهاية) خاصة بكل قسم على حدة،
 * وبنفس تاريخ التسجيل (اليوم) لكل السجلات المُنشأة معاً في هذا الطلب.
 * @param {{student_name, phone, specialization, college, gender, nationality, year_of_study, place_of_training, training_type}} base - بيانات الطالب المشتركة بين كل السجلات
 * @param {Array<{department, start, end}>} items - قائمة الأقسام المختارة وفترة كل واحد منها
 * @returns {Array} السجلات التي أنشأتها Supabase فعلياً (مع id لكل سجل)
 */
async function insertStudentsWithPeriods(base, items){
  const today = new Date().toISOString().slice(0, 10);

  const records = items.map(item => ({
    student_name: base.student_name.trim(),
    phone: String(base.phone).trim(),
    specialization: base.specialization.trim(),
    college: (base.college || "").trim() || null,
    gender: (base.gender || "").trim() || null,
    nationality: (base.nationality || "").trim() || null,
    year_of_study: (base.year_of_study || "").trim() || null,
    place_of_training: (base.place_of_training || "").trim() || null,
    training_type: (base.training_type || "").trim() || null,
    academic_stage: (base.academic_stage || "").trim() || null,
    department: item.department.trim(),
    training_start: item.start,
    training_end: item.end,
    registration_date: today,
    is_waitlist: false,
  }));

  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .insert(records)
    .select();

  if (error) throw error;
  return data;
}

// -------- إدراج سجل قائمة انتظار مستقل لكل قسم مختار (بدون فترة تدريب) --------
/**
 * تُستخدم عند تسجيل متدرب مع اختيار «إضافة إلى قائمة الانتظار» لقسم واحد أو
 * أكثر بدل تحديد فترة تدريب فورية: تُنشئ سجلاً مستقلاً لكل قسم من هذه الأقسام
 * بنفس بيانات الطالب المشتركة، لكن بدون training_start/training_end (تبقى
 * فارغة حتى تُحدَّد لاحقاً من صفحة waiting.html)، وبعلامة is_waitlist=true
 * التي تُخفيها عن لوحة الإدارة وتُظهرها فقط في قائمة الانتظار.
 * @param {{student_name, phone, specialization, college, gender, nationality, year_of_study, place_of_training, training_type}} base - بيانات الطالب المشتركة
 * @param {Array<string>} departments - أسماء الأقسام المطلوب إضافتها لقائمة الانتظار
 * @param {string} [note] - ملاحظة اختيارية تُنسخ لكل سجل من سجلات هذه الأقسام (حقل waitlist_note)
 * @returns {Array} السجلات التي أنشأتها Supabase فعلياً (مع id لكل سجل)
 */
async function insertWaitlistStudents(base, departments, note){
  const today = new Date().toISOString().slice(0, 10);
  const waitlistNote = (note || "").trim() || null;

  const records = departments.map(dep => ({
    student_name: base.student_name.trim(),
    phone: String(base.phone).trim(),
    specialization: base.specialization.trim(),
    college: (base.college || "").trim() || null,
    gender: (base.gender || "").trim() || null,
    nationality: (base.nationality || "").trim() || null,
    year_of_study: (base.year_of_study || "").trim() || null,
    place_of_training: (base.place_of_training || "").trim() || null,
    training_type: (base.training_type || "").trim() || null,
    academic_stage: (base.academic_stage || "").trim() || null,
    department: dep.trim(),
    training_start: null,
    training_end: null,
    registration_date: today,
    is_waitlist: true,
    waitlist_note: waitlistNote,
  }));

  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .insert(records)
    .select();

  if (error) throw error;
  return data;
}

// -------- تعديل سجل متدرب واحد --------
/**
 * تعديل سجل متدرب واحد موجود مسبقاً (تُستخدم من نافذة «✏️ تعديل» في لوحة
 * التحكم). تستبدل كل الحقول القابلة للتعديل دفعة واحدة. تضبط is_waitlist=false
 * صراحة كإجراء احترازي فقط (السجلات التي تصل لهذه الدالة من لوحة التحكم
 * أصلاً غير موجودة في قائمة الانتظار)؛ لا علاقة لها بمنطق قائمة الانتظار
 * الفعلي — راجع assignTrainingPeriods() أدناه لذلك.
 * تتطلب أن تكون سياسة RLS الخاصة بالتعديل (allow_update_students) مفعّلة.
 * @param {string} id - معرّف UUID للسجل المطلوب تعديله
 * @param {object} updates - القيم الجديدة لكل الحقول القابلة للتعديل
 * @returns {Array} السجل بعد التعديل كما أرجعته Supabase
 */
async function updateStudentRecord(id, updates){
  const payload = {
    student_name: updates.student_name.trim(),
    phone: String(updates.phone).trim(),
    specialization: updates.specialization.trim(),
    college: (updates.college || "").trim() || null,
    gender: (updates.gender || "").trim() || null,
    nationality: (updates.nationality || "").trim() || null,
    year_of_study: (updates.year_of_study || "").trim() || null,
    place_of_training: (updates.place_of_training || "").trim() || null,
    training_type: (updates.training_type || "").trim() || null,
    academic_stage: (updates.academic_stage || "").trim() || null,
    department: updates.department.trim(),
    training_start: updates.training_start,
    training_end: updates.training_end,
    is_waitlist: false,
  };

  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .update(payload)
    .eq("id", id)
    .select();

  if (error) throw error;
  return data;
}

// -------- إرجاع سجل متدرب واحد إلى قائمة الانتظار --------
/**
 * إرجاع سجل قسم واحد لطالب من لوحة الإدارة إلى قائمة الانتظار (waiting.html):
 * تضبط is_waitlist=true وتمسح تاريخي بداية/نهاية التدريب (null لكليهما، لأن
 * قائمة الانتظار بلا فترة محددة بعد بحسب تصميم المشروع — راجع
 * insertWaitlistStudents أعلاه لنفس القاعدة عند الإنشاء المبدئي)، وتُسجِّل
 * سبب الإرجاع في حقل waitlist_note (يظهر لاحقاً في حقل «ملاحظة» بنافذة «📅
 * تحديد الفترات ونقل الطالب» بصفحة قائمة الانتظار، ويمكن تعديله من هناك).
 * لا تُعدِّل أي حقل آخر (الاسم، الهاتف، القسم، الكلية...) فهذه تبقى كما هي —
 * عكس تام لما تفعله assignTrainingPeriods() أعلاه عند نقل السجل من الانتظار
 * للوحة الإدارة. تُستخدم حصرياً من زر «↩️ إرجاع لقائمة الانتظار» في لوحة
 * الإدارة، بعد أن يكتب المستخدم سبب الإرجاع إلزامياً (راجع showReasonPrompt
 * في js/ui.js).
 * تتطلب أن تكون سياسة RLS الخاصة بالتعديل (allow_update_students) مفعّلة.
 * @param {string} id - معرّف UUID للسجل المطلوب إرجاعه لقائمة الانتظار
 * @param {string} reason - سبب الإرجاع، يُحفظ في waitlist_note
 * @returns {Array} السجل بعد التعديل كما أرجعته Supabase
 */
async function returnStudentRecordToWaitlist(id, reason){
  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .update({
      training_start: null,
      training_end: null,
      is_waitlist: true,
      waitlist_note: (reason || "").trim() || null,
    })
    .eq("id", id)
    .select();

  if (error) throw error;
  return data;
}

// -------- حفظ فترات قائمة الانتظار فقط (بلا نقل) --------
/**
 * تُستخدم حصرياً من زر «حفظ» في نافذة «تحديد الفترات ونقل الطالب» بصفحة
 * قائمة الانتظار (waiting.html): تُحدِّث فترة تدريب (بداية/نهاية) والملاحظة
 * لكل سجل من سجلات طالب واحد، دون المساس بحقل is_waitlist إطلاقاً (لا يُذكر
 * في payload أصلاً) — فيبقى الطالب في قائمة الانتظار كما هو، وتظهر له
 * الفترات المحفوظة عند إعادة فتح نفس النافذة لاحقاً. عكس تام لـ
 * assignTrainingPeriods() أدناه التي تضبط is_waitlist=false وتُستخدم للنقل
 * الفعلي فقط. لا تنقل الطالب مهما تكرر الضغط على الزر.
 * تتطلب أن تكون سياسة RLS الخاصة بالتعديل (allow_update_students) مفعّلة.
 * @param {Array<{id:string, training_start:string, training_end:string, waitlist_note?:string}>} updates - تحديث فترة (والملاحظة اختيارياً) كل سجل عبر معرّفه
 * @returns {Array} كل السجلات بعد التعديل كما أرجعتها Supabase
 */
async function saveWaitlistPeriods(updates){
  const results = await Promise.all(updates.map(u =>
    supabaseClient
      .from(TABLE_NAME)
      .update({
        training_start: u.training_start,
        training_end: u.training_end,
        waitlist_note: (u.waitlist_note || "").trim() || null,
      })
      .eq("id", u.id)
      .select()
  ));

  const failed = results.find(r => r.error);
  if (failed) throw failed.error;

  return results.flatMap(r => r.data || []);
}

// -------- تحديد فترة تدريب لكل أقسام طالب واحد في قائمة الانتظار دفعة واحدة --------
/**
 * تُستخدم حصرياً من زر «نقل إلى لوحة الإدارة» في نافذة «تحديد الفترات ونقل
 * الطالب» بصفحة قائمة الانتظار (waiting.html): تُحدِّث فترة تدريب
 * (بداية/نهاية) كل سجل من سجلات طالب واحد (سجل واحد لكل قسم من أقسامه) في
 * طلب واحد، وتضبط is_waitlist=false لكل سجل منها — فتنتقل كل أقسام الطالب
 * معاً من قائمة الانتظار إلى لوحة الإدارة دفعة واحدة، بدل الانتقال قسماً تلو
 * الآخر. تُحدِّث أيضاً حقل الملاحظة (waitlist_note) لكل سجل. هذا التحديث
 * (UPDATE بمعرّف كل سجل، وليس INSERT) يجعل الضغط على الزر أكثر من مرة آمناً
 * تماماً — لا يُنشئ أي سجل مكرر، فقط يُعيد ضبط نفس القيم على نفس السجلات.
 * راجع saveWaitlistPeriods() أعلاه لعملية الحفظ المستقلة (بلا نقل).
 * تتطلب أن تكون سياسة RLS الخاصة بالتعديل (allow_update_students) مفعّلة.
 * @param {Array<{id:string, training_start:string, training_end:string, waitlist_note?:string}>} updates - تحديث فترة (والملاحظة اختيارياً) كل سجل عبر معرّفه
 * @returns {Array} كل السجلات بعد التعديل كما أرجعتها Supabase
 */
async function assignTrainingPeriods(updates){
  const results = await Promise.all(updates.map(u =>
    supabaseClient
      .from(TABLE_NAME)
      .update({
        training_start: u.training_start,
        training_end: u.training_end,
        waitlist_note: (u.waitlist_note || "").trim() || null,
        is_waitlist: false,
      })
      .eq("id", u.id)
      .select()
  ));

  const failed = results.find(r => r.error);
  if (failed) throw failed.error;

  return results.flatMap(r => r.data || []);
}

// -------- حذف سجلات متدرب (قسم واحد أو أكثر) عبر معرّفاتها --------
/**
 * حذف سجل واحد أو أكثر نهائياً عبر قائمة معرّفاتها (id). تُستخدم لحذف قسم
 * واحد فقط لطالب متعدد الأقسام، أو لحذف كل أقسام طالب دفعة واحدة. تتطلب أن
 * تكون سياسة RLS الخاصة بالحذف (allow_delete_students) مفعّلة في Supabase.
 * @param {Array<string>} ids - قائمة معرّفات UUID للسجلات المطلوب حذفها
 */
async function deleteStudentsByIds(ids){
  const { error } = await supabaseClient
    .from(TABLE_NAME)
    .delete()
    .in("id", ids);

  if (error) throw error;
}

// -------- جلب سجلات المتدربين الذين لديهم فترة تدريب محددة (لوحة الإدارة) --------
/**
 * جلب سجلات المتدربين الذين لديهم فترة تدريب محددة فقط (is_waitlist = false)،
 * مرتبة من الأحدث إدراجاً للأقدم (created_at تنازلياً). تُستدعى مرة واحدة عند
 * تحميل لوحة التحكم؛ كل الفلترة والفرز والترقيم بعد ذلك يحدث محلياً في المتصفح
 * على النسخة المخزَّنة في state.allStudents دون طلبات إضافية للخادم.
 * سجلات قائمة الانتظار (is_waitlist = true) مُستبعدة عمداً هنا — راجع
 * fetchWaitlistStudents() لجلبها في صفحة waiting.html.
 * @returns {Array} سجلات جدول students التي لها فترة تدريب محددة
 */
async function fetchAllStudents(){
  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .select("*")
    .eq("is_waitlist", false)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

// -------- جلب سجلات قائمة الانتظار (بلا فترة تدريب محددة بعد) --------
/**
 * جلب سجلات المتدربين الذين أُضيفوا لقسم دون تحديد فترة تدريب فورية
 * (is_waitlist = true)، مرتبة من الأحدث تسجيلاً للأقدم. تُستخدم حصرياً في
 * صفحة قائمة الانتظار (waiting.html وjs/waiting.js).
 * @returns {Array} سجلات جدول students التي بلا فترة تدريب محددة بعد
 */
async function fetchWaitlistStudents(){
  const { data, error } = await supabaseClient
    .from(TABLE_NAME)
    .select("*")
    .eq("is_waitlist", true)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data || [];
}

// ============================================================================
// تقييم المتدرب (جدول evaluations) — راجع sql/add_evaluations_feature.sql
// ============================================================================
const EVALUATIONS_TABLE = "evaluations";

// -------- جلب آخر تقييم محفوظ لطالب معيّن (إن وُجد) --------
/**
 * جلب آخر سجل تقييم محفوظ لطالب معيّن عبر معرّفه (student_id)، إن وُجد.
 * تُستخدم عند فتح نموذج «📋 التقييم» لتحميل آخر تقييم محفوظ لهذا الطالب
 * تلقائياً بدل البدء من نموذج فارغ في كل مرة (وضع تعديل بدل إنشاء جديد دائماً).
 * @param {string} studentId - معرّف UUID لسجل الطالب في جدول students
 * @returns {object|null} أحدث سجل تقييم لهذا الطالب، أو null إن لم يوجد أي تقييم سابق
 */
async function fetchLatestEvaluationForStudent(studentId){
  const { data, error } = await supabaseClient
    .from(EVALUATIONS_TABLE)
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return (data && data[0]) || null;
}

// -------- حفظ تقييم (إنشاء جديد أو تحديث تقييم موجود) --------
/**
 * حفظ نموذج تقييم متدرب: تُحدِّث السجل الموجود إن كان لديه id سابق (تعديل
 * تقييم محفوظ مسبقاً)، أو تُنشئ سجلاً جديداً إن لم يوجد id (أول تقييم لهذا
 * الطالب). تُستخدم من زر «💾 حفظ التقييم» في نافذة التقييم.
 * @param {object} payload - بيانات التقييم الكاملة؛ يتضمن id اختيارياً للتحديث
 * @returns {object} السجل بعد الحفظ كما أرجعته Supabase
 */
async function saveEvaluation(payload){
  const { id, ...fields } = payload;

  if (id){
    const { data, error } = await supabaseClient
      .from(EVALUATIONS_TABLE)
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select();
    if (error) throw error;
    return data && data[0];
  }

  const { data, error } = await supabaseClient
    .from(EVALUATIONS_TABLE)
    .insert(fields)
    .select();
  if (error) throw error;
  return data && data[0];
}
