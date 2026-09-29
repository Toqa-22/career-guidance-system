// Sidebar toggle — shared by every admin page. Defaults to expanded on
// desktop and collapsed on narrow screens (where it would otherwise overlay
// most of the content), but once the person clicks the toggle themselves
// that explicit choice is remembered (localStorage) and wins from then on.
(function () {
    const STORAGE_KEY = 'adminSidebarCollapsed';
    const shell = document.querySelector('.admin-shell');
    const toggleBtn = document.getElementById('sidebarToggleBtn');
    const backdrop = document.getElementById('sidebarBackdrop');
    if (!shell || !toggleBtn) return;

    const stored = localStorage.getItem(STORAGE_KEY);
    const initiallyCollapsed = stored !== null ? stored === '1' : window.innerWidth <= 900;
    shell.classList.toggle('sidebar-collapsed', initiallyCollapsed);

    function setCollapsed(collapsed) {
        shell.classList.toggle('sidebar-collapsed', collapsed);
        localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    }

    toggleBtn.addEventListener('click', () => {
        setCollapsed(!shell.classList.contains('sidebar-collapsed'));
    });

    // On mobile the sidebar is a full overlay — tapping the dimmed backdrop
    // behind it is the expected way to dismiss it, not just the toggle button.
    if (backdrop) {
        backdrop.addEventListener('click', () => setCollapsed(true));
    }
})();
