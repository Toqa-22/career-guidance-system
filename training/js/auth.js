// ============================================================================
// auth.js
// Login now happens once at the hub level (../index.html), not inside this
// project — training/index.html just redirects there. This file now only
// provides logoutAdmin() (used by the logout link in every protected page)
// and binds it automatically to any #logoutLink / .logout-link element.
// ============================================================================

function logoutAdmin(){
  // This does NOT clear the session — it just returns to the hub's 2-card
  // picker, still signed in, so Workshops is one click away. Clearing the
  // session here would immediately bounce straight back to the login page
  // anyway, since hub.html itself requires a valid session to view — only
  // the hub's OWN logout button actually ends the session.
  location.href = "../hub.html";
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("#logoutLink, .logout-link").forEach(link => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      logoutAdmin();
    });
  });

  // Shows who's signed in under the sidebar logo, on every protected page.
  const el = document.getElementById("sidebarUsername");
  if (el) {
    try {
      const raw = localStorage.getItem("ibra_admin_session");
      const session = raw ? JSON.parse(raw) : null;
      if (session && session.username) el.textContent = "Welcome, " + (session.fullName || session.username);
    } catch (e) { /* no session — leave it blank */ }
  }
});
