// Rotates the whole program's brand color (sidebar, buttons, login/hero
// backgrounds) through a fixed 7-color palette, changing every 2 hours.
// Time-based (not random-per-load) so every open tab/every user sees the
// SAME color at the same moment, and it survives a page refresh correctly —
// re-opening the app 10 minutes later shows the same color, not a new one.
//
// Deliberately scoped to brand/UI chrome only — chart colors and each
// course's own per-registration theme (register.html) are separate,
// intentional systems and are NOT touched by this.
(function () {
    const PALETTE = [
        { primary: '#7C3AED', dark: '#5B21B6', deep: '#3B0764', mid: '#8B5CF6', bgFrom: '#DDD6FE', bgTo: '#EDE9FE', light1: '#F5F3FF', light2: '#EDE9FE', light3: '#DDD6FE' }, // Purple
        { primary: '#3B82F6', dark: '#1D4ED8', deep: '#1E3A8A', mid: '#60A5FA', bgFrom: '#BFDBFE', bgTo: '#DBEAFE', light1: '#EFF6FF', light2: '#DBEAFE', light3: '#BFDBFE' }, // Blue
        { primary: '#06B6D4', dark: '#0E7490', deep: '#164E63', mid: '#22D3EE', bgFrom: '#A5F3FC', bgTo: '#CFFAFE', light1: '#ECFEFF', light2: '#CFFAFE', light3: '#A5F3FC' }, // Cyan
        { primary: '#6366F1', dark: '#4338CA', deep: '#312E81', mid: '#818CF8', bgFrom: '#C7D2FE', bgTo: '#E0E7FF', light1: '#EEF2FF', light2: '#E0E7FF', light3: '#C7D2FE' }, // Indigo
        { primary: '#EC4899', dark: '#BE185D', deep: '#831843', mid: '#F472B6', bgFrom: '#FBCFE8', bgTo: '#FCE7F3', light1: '#FDF2F8', light2: '#FCE7F3', light3: '#FBCFE8' }, // Pink
        { primary: '#10B981', dark: '#047857', deep: '#064E3B', mid: '#34D399', bgFrom: '#A7F3D0', bgTo: '#D1FAE5', light1: '#ECFDF5', light2: '#D1FAE5', light3: '#A7F3D0' }, // Green
        { primary: '#F59E0B', dark: '#B45309', deep: '#78350F', mid: '#FBBF24', bgFrom: '#FDE68A', bgTo: '#FEF3C7', light1: '#FFFBEB', light2: '#FEF3C7', light3: '#FDE68A' }  // Orange
    ];
    const SLOT_MS = 2 * 60 * 60 * 1000; // 2 hours

    function applyColor() {
        const slot = Math.floor(Date.now() / SLOT_MS) % PALETTE.length;
        const c = PALETTE[slot];
        const root = document.documentElement.style;
        root.setProperty('--dynamic-primary', c.primary);
        root.setProperty('--dynamic-primary-dark', c.dark);
        root.setProperty('--dynamic-primary-deep', c.deep);
        root.setProperty('--dynamic-primary-mid', c.mid);
        root.setProperty('--dynamic-bg-from', c.bgFrom);
        root.setProperty('--dynamic-bg-to', c.bgTo);
        root.setProperty('--dynamic-light1', c.light1);
        root.setProperty('--dynamic-light2', c.light2);
        root.setProperty('--dynamic-light3', c.light3);
        // Training's own CSS (style.css/dashboard.css/reports.css) is
        // already built around these exact variable names from its earlier
        // purple reskin — setting them directly here covers nearly the
        // whole app without needing to touch every individual CSS rule.
        root.setProperty('--primary', c.primary);
        root.setProperty('--primary-dark', c.dark);
        root.setProperty('--primary-light', c.light1);
    }

    applyColor();
    // A page left open across a 2-hour boundary picks up the new color on
    // its own, without needing a manual refresh.
    setInterval(applyColor, 5 * 60 * 1000);
})();
