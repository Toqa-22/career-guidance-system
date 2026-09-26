// ============================================================================
// hall-requests-alert.js
// A large centered alert that appears automatically on every page load of a
// page that includes this file (dashboard.html, create-course.html,
// certificates.html, create-certificate.html, hall-reservation.html,
// program-form.html, report.html, students.html — NOT chart.html/Home, and
// NOT department-hall-requests.html itself, which already shows the list
// directly). Shows how many Department Hall Requests are currently pending,
// dismissible via the ✕ button, the "Dismiss" button, clicking the dark
// backdrop, or "Review Requests" to go straight to that page. Repeats every
// 3 hours if the admin stays on the same page without navigating.
// ============================================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const HALL_ALERT_REPEAT_INTERVAL_MS = 3 * 60 * 60 * 1000; // repeat every 3 hours for anyone staying on the same page
const HALL_ALERT_INITIAL_DELAY_MS = 2000;                  // slight delay after each page load

const hallAlertClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function maybeShowHallRequestsAlert() {
    if (document.getElementById('hallAlertCard')) return; // already showing

    let count = 0;
    try {
        const { count: pendingCount, error } = await hallAlertClient
            .from('hall_requests')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending');
        if (error) throw error;
        count = pendingCount || 0;
    } catch (err) {
        console.error('Could not check pending hall requests for the alert:', err);
        return;
    }

    if (count === 0) return; // nothing to interrupt the admin about right now

    renderHallRequestsAlert(count);
}

function renderHallRequestsAlert(count) {
    const overlay = document.createElement('div');
    overlay.id = 'hallAlertCard';
    overlay.className = 'hall-alert-overlay';
    overlay.innerHTML = `
        <div class="hall-alert-card" role="dialog" aria-modal="true" aria-label="Pending hall requests">
            <button type="button" class="hall-alert-close" aria-label="Close">✕</button>
            <div class="hall-alert-icon">⏳</div>
            <div class="hall-alert-title">Department Hall Requests</div>
            <div class="hall-alert-count">There ${count === 1 ? 'is' : 'are'} currently <strong>${count}</strong> ${count === 1 ? 'request' : 'requests'} waiting for review</div>
            <div class="hall-alert-actions">
                <button type="button" class="hall-alert-dismiss">Dismiss</button>
                <button type="button" class="hall-alert-go">Review Requests</button>
            </div>
        </div>
    `;

    const closeCard = () => overlay.remove();
    overlay.querySelector('.hall-alert-close').addEventListener('click', closeCard);
    overlay.querySelector('.hall-alert-dismiss').addEventListener('click', closeCard);
    overlay.querySelector('.hall-alert-go').addEventListener('click', () => {
        window.location.href = 'department-hall-requests.html';
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeCard(); });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
}

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(maybeShowHallRequestsAlert, HALL_ALERT_INITIAL_DELAY_MS);
    setInterval(maybeShowHallRequestsAlert, HALL_ALERT_REPEAT_INTERVAL_MS);
});
