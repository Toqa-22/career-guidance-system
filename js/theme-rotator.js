// Rotates the whole program's brand color (sidebar, buttons, login/hero
// backgrounds) through a fixed 16-color palette, changing every 2 hours.
// Time-based (not random-per-load) so every open tab/every user sees the
// SAME color at the same moment, and it survives a page refresh correctly —
// re-opening the app 10 minutes later shows the same color, not a new one.
//
// This is the ONE copy of this file for the whole program — the hub,
// Workshops, and Training all load it from here (js/theme-rotator.js at
// the project root) via a relative path, rather than each keeping its own
// duplicate. That's what keeps every part of the app landing on the same
// color at the same moment; don't reintroduce a per-system copy.
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
        { primary: '#F59E0B', dark: '#B45309', deep: '#78350F', mid: '#FBBF24', bgFrom: '#FDE68A', bgTo: '#FEF3C7', light1: '#FFFBEB', light2: '#FEF3C7', light3: '#FDE68A' }, // Orange
        { primary: '#E11D48', dark: '#BE123C', deep: '#881337', mid: '#FB7185', bgFrom: '#FECDD3', bgTo: '#FFE4E6', light1: '#FFF1F2', light2: '#FFE4E6', light3: '#FECDD3' }, // Rose
        { primary: '#374151', dark: '#1F2937', deep: '#111827', mid: '#4B5563', bgFrom: '#D3DCE8', bgTo: '#E8ECF3', light1: '#F4F6FA', light2: '#E8ECF3', light3: '#D3DCE8' }, // Graphite
        { primary: '#B45309', dark: '#92400E', deep: '#78350F', mid: '#D97706', bgFrom: '#FDE68A', bgTo: '#FEF3C7', light1: '#FFFBEB', light2: '#FEF3C7', light3: '#FDE68A' }, // Copper
        { primary: '#E76F51', dark: '#C2412D', deep: '#7C2D12', mid: '#F08060', bgFrom: '#FFD0BD', bgTo: '#FFE4D6', light1: '#FFF7F3', light2: '#FFE4D6', light3: '#FFD0BD' }, // Coral
        { primary: '#312E81', dark: '#1E1B4B', deep: '#0F172A', mid: '#4338CA', bgFrom: '#C7D2FE', bgTo: '#E0E7FF', light1: '#EEF2FF', light2: '#E0E7FF', light3: '#C7D2FE' }, // Midnight
        { primary: '#8B5E83', dark: '#704A69', deep: '#4A3045', mid: '#A8789E', bgFrom: '#E8D5E4', bgTo: '#F3E8F1', light1: '#FCF7FB', light2: '#F3E8F1', light3: '#E8D5E4' }, // Mauve
        { primary: '#475569', dark: '#334155', deep: '#1E293B', mid: '#64748B', bgFrom: '#BFD3EA', bgTo: '#DCE7F5', light1: '#F1F5FB', light2: '#DCE7F5', light3: '#BFD3EA' }, // Slate
        { primary: '#B89968', dark: '#9A7C4E', deep: '#6B5433', mid: '#D0B583', bgFrom: '#E5D3AE', bgTo: '#F2E9D8', light1: '#FBF8F2', light2: '#F2E9D8', light3: '#E5D3AE' }, // Champagne
        { primary: '#A8451F', dark: '#832F13', deep: '#5A1E0B', mid: '#C46138', bgFrom: '#F0B896', bgTo: '#F8DBCB', light1: '#FDF1EC', light2: '#F8DBCB', light3: '#F0B896' }  // Rust
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
        // Harmless no-ops for the hub/Workshops CSS, which don't use them.
        root.setProperty('--primary', c.primary);
        root.setProperty('--primary-dark', c.dark);
        root.setProperty('--primary-light', c.light1);
    }

    applyColor();
    // A page left open across a 2-hour boundary picks up the new color on
    // its own, without needing a manual refresh.
    setInterval(applyColor, 5 * 60 * 1000);
})();
