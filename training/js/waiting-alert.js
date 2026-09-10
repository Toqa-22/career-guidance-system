// ============================================================================
// waiting-alert.js
// نافذة تنبيه تظهر تلقائياً في منتصف الشاشة (بحجم كبير، نفس نمط نوافذ التأكيد
// بالموقع) في كل صفحة تُحمِّل هذا الملف (register.html، dashboard.html،
// reports.html — وليس waiting.html نفسها، فلا داعي لتذكير المستخدم بقائمة
// الانتظار وهو أصلاً فيها، ولا index.html صفحة تسجيل الدخول التي يجب ألا
// يظهر فيها أي محتوى قبل الدخول). تعرض عدد المتدربين الحاليين في قائمة
// الانتظار (is_waitlist = true)، وتُغلق إما بزر ✕، بزر «إغلاق»، بالنقر على
// الخلفية المعتمة خارج البطاقة، أو بزر «عرض قائمة الانتظار» للانتقال المباشر
// لصفحة قائمة الانتظار (waiting.html).
//
// تظهر النافذة في كل مرة يدخل فيها المستخدم الموقع أو ينتقل لصفحة مختلفة من
// صفحاته المحمية (كل تحميل صفحة = محاولة عرض جديدة، دون أي تأخير أو تخزين
// لوقت آخر ظهور)، وتُعاد أيضاً كل 3 ساعات تلقائياً أثناء بقاء المستخدم على
// نفس الصفحة دون تنقّل أو إعادة تحميل (عبر مؤقّت دوري manual)، طالما كان عدد
// قائمة الانتظار أكبر من صفر وقت كل محاولة عرض.
//
// الاعتماديات المطلوب تحميلها قبل هذا الملف: js/config.js وjs/supabase.js
// (تحديداً fetchWaitlistStudents()).
// ============================================================================

const WAITING_ALERT_REPEAT_INTERVAL_MS = 3 * 60 * 60 * 1000; // إعادة العرض كل 3 ساعات لمن يبقى على نفس الصفحة
const WAITING_ALERT_INITIAL_DELAY_MS = 2000;                 // تأخير أول ظهور بعد تحميل كل صفحة

/**
 * محاولة عرض نافذة التنبيه: تُجلب عدد قائمة الانتظار الحالي من الخادم في كل
 * مرة (بلا أي تخزين مسبق أو تخمين)، وتُعرض النافذة فوراً إن كان العدد أكبر
 * من صفر ولم تكن نافذة أخرى معروضة أصلاً على الشاشة حالياً. تُستدعى مرة عند
 * كل تحميل صفحة، ثم دورياً كل 3 ساعات بعد ذلك (راجع أسفل الملف).
 */
async function maybeShowWaitingAlert(){
  if (document.getElementById("waitingAlertCard")) return; // نافذة معروضة أصلاً على الشاشة

  let count = 0;
  try {
    const list = await fetchWaitlistStudents();
    count = list.length;
  } catch (err){
    console.error("تعذر تحميل عدد قائمة الانتظار لنافذة التنبيه:", err);
    return;
  }

  if (count === 0) return; // لا داعي لإزعاج المستخدم إن كانت القائمة فارغة حالياً

  renderWaitingAlertCard(count);
}

/**
 * بناء نافذة التنبيه فعلياً وإدراجها في الصفحة (خلفية معتمة + بطاقة بمنتصف
 * الشاشة)، مع مستمعي إغلاق متعددة: زر ✕، زر «إغلاق»، النقر على الخلفية
 * المعتمة نفسها خارج البطاقة، وزر «عرض قائمة الانتظار» للانتقال المباشر.
 * @param {number} count - عدد المتدربين الحاليين في قائمة الانتظار
 */
function renderWaitingAlertCard(count){
  const overlay = document.createElement("div");
  overlay.id = "waitingAlertCard";
  overlay.className = "waiting-alert-overlay";
  overlay.innerHTML = `
    <div class="waiting-alert-card" role="dialog" aria-modal="true" aria-label="تنبيه قائمة الانتظار">
      <button type="button" class="waiting-alert-close" aria-label="إغلاق">✕</button>
      <div class="waiting-alert-icon">⏳</div>
      <div class="waiting-alert-title">قائمة الانتظار</div>
      <div class="waiting-alert-count">يوجد حالياً <strong>${count}</strong> ${count === 1 ? "متدرب" : "متدربين"} بانتظار تحديد فترة التدريب</div>
      <div class="waiting-alert-actions">
        <button type="button" class="waiting-alert-dismiss">إغلاق</button>
        <button type="button" class="waiting-alert-go">عرض قائمة الانتظار</button>
      </div>
    </div>
  `;

  const closeCard = () => overlay.remove();

  overlay.querySelector(".waiting-alert-close").addEventListener("click", closeCard);
  overlay.querySelector(".waiting-alert-dismiss").addEventListener("click", closeCard);
  overlay.querySelector(".waiting-alert-go").addEventListener("click", () => {
    location.href = "waiting.html";
  });
  // إغلاق عند الضغط على الخلفية المعتمة نفسها (خارج البطاقة) فقط
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeCard();
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add("show"));
}

document.addEventListener("DOMContentLoaded", () => {
  // محاولة أولى عند كل دخول/تنقل لصفحة محمية
  setTimeout(maybeShowWaitingAlert, WAITING_ALERT_INITIAL_DELAY_MS);
  // إعادة العرض كل 3 ساعات لمن يبقى على نفس الصفحة دون تنقّل أو إعادة تحميل
  setInterval(maybeShowWaitingAlert, WAITING_ALERT_REPEAT_INTERVAL_MS);
});
