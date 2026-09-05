import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth(); // 0-indexed
let selectedDateStr = null;
let monthReservations = []; // reservations for the currently displayed month only
let monthPendingRequests = []; // still-processing Department Hall Requests for the same month — shown in gray
let bookingsChart = null;
let activeHallFilter = ''; // '' = all halls, or one of the halls fetched below

// Places are admin-managed now, not a fixed 2-value list — loaded from the
// `halls` table (name + a color the admin picked for it). This map is
// rebuilt every time loadHalls() runs, and is what every color lookup
// below reads from.
let hallsCache = []; // [{id, name, color}]
let hallColorByName = new Map();

function pad2(n) { return String(n).padStart(2, '0'); }
function dateKey(y, m, d) { return `${y}-${pad2(m + 1)}-${pad2(d)}`; }
function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + n);
    return dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
}
function colorFor(hallName) { return hallColorByName.get(hallName) || '#94a3b8'; }
function formatTime12(t) {
    const [h, m] = t.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}:${pad2(m)} ${period}`;
}
function visibleReservations() {
    return activeHallFilter ? monthReservations.filter(r => r.hall === activeHallFilter) : monthReservations;
}

// ============================================================================
// Places (halls) — admin-managed list with a color each, used everywhere
// else on this page (dropdown, legend, calendar pills, chart).
// ============================================================================
async function loadHalls() {
    const { data, error } = await client.from('halls').select('id, name, color').order('name', { ascending: true });
    if (error) {
        console.error('Could not load halls:', error.message);
        return;
    }
    hallsCache = data || [];
    hallColorByName = new Map(hallsCache.map(h => [h.name, h.color]));

    renderHallSelect();
    renderLegendFilter();
    renderChartLegend();
}

function renderHallSelect() {
    const select = document.getElementById('hallSelect');
    const previousValue = select.value;
    select.innerHTML = hallsCache.map(h => `<option value="${h.name}">${h.name}</option>`).join('');
    if (hallsCache.some(h => h.name === previousValue)) select.value = previousValue;
}

function renderLegendFilter() {
    const box = document.getElementById('hallLegendFilter');
    box.innerHTML = `<button type="button" class="hall-legend-btn${activeHallFilter === '' ? ' active' : ''}" data-hall="">All Halls</button>` +
        hallsCache.map(h => `
            <button type="button" class="hall-legend-btn${activeHallFilter === h.name ? ' active' : ''}" data-hall="${h.name}">
                <i class="hall-dot" style="background:${h.color}"></i> ${h.name}
            </button>`).join('');

    box.querySelectorAll('.hall-legend-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeHallFilter = btn.dataset.hall;
            renderLegendFilter();
            renderCalendarGrid();
            renderDayDetail(selectedDateStr);
        });
    });
}

function renderChartLegend() {
    document.getElementById('hallChartLegend').innerHTML = hallsCache.map(h =>
        `<span><i class="hall-dot" style="background:${h.color}"></i> ${h.name}</span>`
    ).join('');
}

// ============================================================================
// Calendar navigation controls (month/year selects on the calendar side)
// ============================================================================
function populateCalendarNavSelects() {
    const monthSel = document.getElementById('calMonthSelect');
    monthSel.innerHTML = MONTH_NAMES.map((name, i) => `<option value="${i}">${name}</option>`).join('');
    monthSel.value = viewMonth;

    const yearSel = document.getElementById('calYearSelect');
    const startYear = today.getFullYear() - 2;
    const endYear = today.getFullYear() + 4;
    let opts = '';
    for (let y = startYear; y <= endYear; y++) opts += `<option value="${y}">${y}</option>`;
    yearSel.innerHTML = opts;
    yearSel.value = viewYear;
}

async function goToMonth(year, month) {
    const d = new Date(year, month, 1);
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
    document.getElementById('calMonthSelect').value = viewMonth;
    document.getElementById('calYearSelect').value = viewYear;
    selectedDateStr = null;
    renderDayDetail(null);
    await loadMonthReservations();
    renderBookingsChart();
}

document.getElementById('calPrevMonth').addEventListener('click', () => goToMonth(viewYear, viewMonth - 1));
document.getElementById('calNextMonth').addEventListener('click', () => goToMonth(viewYear, viewMonth + 1));
document.getElementById('calMonthSelect').addEventListener('change', (e) => goToMonth(viewYear, Number(e.target.value)));
document.getElementById('calYearSelect').addEventListener('change', (e) => goToMonth(Number(e.target.value), viewMonth));

// ============================================================================
// Fetch + render the calendar grid for the currently viewed month
// ============================================================================
async function loadMonthReservations() {
    const grid = document.getElementById('hallCalGrid');
    grid.setAttribute('aria-busy', 'true');

    const firstDay = `${viewYear}-${pad2(viewMonth + 1)}-01`;
    const lastDayNum = new Date(viewYear, viewMonth + 1, 0).getDate();
    const lastDay = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(lastDayNum)}`;

    const { data, error } = await client
        .from('hall_reservations')
        .select('id, hall, course_name, reservation_type, writer_name, organizer_name, phone_number, participant_count, reservation_date, start_time, end_time, booking_group_id')
        .gte('reservation_date', firstDay)
        .lte('reservation_date', lastDay)
        .order('start_time', { ascending: true });

    if (error) {
        grid.innerHTML = `<p style="grid-column: 1 / -1; color:#dc2626; font-size:13px;">Couldn't load bookings: ${error.message}</p>`;
        return;
    }
    monthReservations = data || [];

    // Still-processing Department Hall Requests are shown too (in gray, so
    // nothing collides with them while they're pending) — declined ones
    // are never shown here, only pending.
    const { data: pending, error: pendingErr } = await client
        .from('hall_requests')
        .select('id, hall, course_name, reservation_date, start_time, end_time, booking_group_id')
        .eq('status', 'pending')
        .gte('reservation_date', firstDay)
        .lte('reservation_date', lastDay);
    if (pendingErr) console.error('Could not load pending requests:', pendingErr.message);
    monthPendingRequests = pending || [];

    renderCalendarGrid();
}

function spanPillClass(r) {
    if (!r.booking_group_id) return '';
    const hasPrev = monthReservations.some(x => x.booking_group_id === r.booking_group_id && x.reservation_date === addDays(r.reservation_date, -1));
    const hasNext = monthReservations.some(x => x.booking_group_id === r.booking_group_id && x.reservation_date === addDays(r.reservation_date, 1));
    if (hasPrev && hasNext) return 'hall-pill-span-mid';
    if (!hasPrev && hasNext) return 'hall-pill-span-start';
    if (hasPrev && !hasNext) return 'hall-pill-span-end';
    return '';
}

function renderCalendarGrid() {
    const grid = document.getElementById('hallCalGrid');
    grid.removeAttribute('aria-busy');

    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
    const visible = visibleReservations();

    let html = '';
    for (let i = 0; i < firstWeekday; i++) {
        html += `<div class="hall-cal-day hall-cal-day-empty"></div>`;
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const key = dateKey(viewYear, viewMonth, day);
        const dayReservations = visible.filter(r => r.reservation_date === key);
        const dayPending = activeHallFilter ? monthPendingRequests.filter(r => r.reservation_date === key && r.hall === activeHallFilter) : monthPendingRequests.filter(r => r.reservation_date === key);
        const pills = dayReservations.slice(0, 2).map(r =>
            `<span class="hall-cal-day-pill ${spanPillClass(r)}" style="background:${colorFor(r.hall)}" title="${r.hall}: ${r.course_name}">${r.course_name}</span>`
        ).join('');
        // Pending requests are always gray — never a real hall color, since
        // they aren't confirmed bookings yet.
        const pendingPills = dayPending.slice(0, 2).map(r =>
            `<span class="hall-cal-day-pill hall-cal-day-pill-pending" title="${r.hall}: ${r.course_name} (pending request)">⏳ ${r.course_name}</span>`
        ).join('');
        const totalShown = dayReservations.length + dayPending.length;
        const more = totalShown > 4 ? `<span class="hall-cal-day-more">+${totalShown - 4} more</span>` : '';

        const classes = ['hall-cal-day'];
        if (key === todayKey) classes.push('hall-cal-day-today');
        if (key === selectedDateStr) classes.push('hall-cal-day-selected');

        html += `
            <button type="button" class="${classes.join(' ')}" data-date="${key}">
                <span class="hall-cal-day-num">${day}</span>
                <span class="hall-cal-day-bookings">${pills}${pendingPills}${more}</span>
            </button>`;
    }

    grid.innerHTML = html;
    grid.querySelectorAll('[data-date]').forEach(btn => {
        btn.addEventListener('click', () => {
            selectedDateStr = btn.getAttribute('data-date');
            renderCalendarGrid();
            renderDayDetail(selectedDateStr);
        });
    });
}

function renderDayDetail(dateStr) {
    const box = document.getElementById('hallDayDetail');
    if (!dateStr) {
        box.innerHTML = '<p class="hall-day-detail-placeholder">Select a day to see its bookings.</p>';
        return;
    }
    const items = visibleReservations().filter(r => r.reservation_date === dateStr);
    const pendingItems = (activeHallFilter ? monthPendingRequests.filter(r => r.hall === activeHallFilter) : monthPendingRequests)
        .filter(r => r.reservation_date === dateStr);
    const [y, m, d] = dateStr.split('-').map(Number);
    const label = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

    if (items.length === 0 && pendingItems.length === 0) {
        const scope = activeHallFilter ? ` for ${activeHallFilter}` : '';
        box.innerHTML = `<p class="hall-day-detail-title">${label}</p><p class="hall-day-detail-placeholder">Nothing booked this day${scope}.</p>`;
        return;
    }

    const rows = items.map(r => `
        <div class="hall-day-detail-item" style="border-left-color:${colorFor(r.hall)}">
            <strong>${r.hall} — ${formatTime12(r.start_time)} to ${formatTime12(r.end_time)}</strong>
            <span>${r.course_name}${r.reservation_type ? ` (${r.reservation_type})` : ''}</span>
            ${r.writer_name ? `<span>Entrance Name: ${r.writer_name}</span>` : ''}
            ${r.organizer_name ? `<span>Organizer: ${r.organizer_name}</span>` : ''}
            ${r.phone_number ? `<span>Phone: ${r.phone_number}</span>` : ''}
            ${r.participant_count ? `<span>Participants: ${r.participant_count}</span>` : ''}
            <div class="hall-day-detail-actions">
                <button type="button" class="hall-detail-edit-btn" data-id="${r.id}">Edit</button>
                <button type="button" class="hall-detail-delete-btn" data-id="${r.id}">Remove</button>
            </div>
        </div>`).join('');

    // Read-only — reviewing/approving these happens on the Department Hall
    // Requests page, not here.
    const pendingRows = pendingItems.map(r => `
        <div class="hall-day-detail-item" style="border-left-color:#94a3b8; opacity:.85;">
            <strong>⏳ ${r.hall} — ${formatTime12(r.start_time)} to ${formatTime12(r.end_time)} (pending request)</strong>
            <span>${r.course_name}</span>
        </div>`).join('');

    box.innerHTML = `<p class="hall-day-detail-title">${label}</p>${rows}${pendingRows}`;

    box.querySelectorAll('.hall-detail-edit-btn').forEach(btn => {
        btn.addEventListener('click', () => startEditReservation(Number(btn.dataset.id)));
    });
    box.querySelectorAll('.hall-detail-delete-btn').forEach(btn => {
        btn.addEventListener('click', () => deleteReservation(Number(btn.dataset.id)));
    });
}

// ============================================================================
// Edit / Delete a booking from the day-detail list.
// ============================================================================
let editingReservationId = null;
let editingGroupId = null;

function startEditReservation(id) {
    const r = monthReservations.find(x => x.id === id);
    if (!r) return;

    const groupRows = r.booking_group_id ? monthReservations.filter(x => x.booking_group_id === r.booking_group_id) : [r];
    groupRows.sort((a, b) => a.reservation_date.localeCompare(b.reservation_date));

    editingReservationId = id;
    editingGroupId = r.booking_group_id || null;
    document.getElementById('hallSelect').value = r.hall;
    document.getElementById('hallCourseName').value = r.course_name || '';
    document.getElementById('hallReservationType').value = r.reservation_type || 'Meeting';
    prefillEntranceName(); // always the CURRENT admin, not who originally booked it
    document.getElementById('hallOrganizerName').value = r.organizer_name || '';
    document.getElementById('hallPhoneNumber').value = r.phone_number || '';
    document.getElementById('hallParticipantCount').value = r.participant_count || '';

    // One row per date actually stored for this booking, each with its OWN
    // time — a booking made under the old shared-time system just shows
    // the same time repeated across its rows, and edits from here on are
    // free to give each date a different time going forward.
    document.getElementById('hallDatesContainer').innerHTML = '';
    groupRows.forEach(row => {
        addDateEntryRow(row.reservation_date, row.reservation_date, row.start_time.slice(0, 5), row.end_time.slice(0, 5));
    });

    document.getElementById('hallSubmitBtn').textContent = 'Update Booking';
    document.getElementById('hallCancelEditBtn').classList.remove('hidden-element');
    setFormNote('', false);
    document.getElementById('hallReservationForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditReservation() {
    editingReservationId = null;
    editingGroupId = null;
    document.getElementById('hallReservationForm').reset();
    prefillEntranceName();
    setDefaultFormDates();
    document.getElementById('hallSubmitBtn').textContent = 'Book Hall';
    document.getElementById('hallCancelEditBtn').classList.add('hidden-element');
    setFormNote('', false);
}

document.getElementById('hallCancelEditBtn').addEventListener('click', cancelEditReservation);

function currentAdminName() {
    try {
        const raw = localStorage.getItem('ibra_admin_session');
        const session = raw ? JSON.parse(raw) : null;
        return (session && (session.fullName || session.username)) || 'Unknown admin';
    } catch {
        return 'Unknown admin';
    }
}

async function deleteReservation(id) {
    try {
        if (typeof formCard !== 'function' || typeof confirmCard !== 'function') {
            alert('This page needs a fresh copy of a required file — please hard-refresh (Ctrl+Shift+R) and try again.');
            return;
        }

        const r = monthReservations.find(x => x.id === id);
        if (!r) {
            alert("Could not find that booking — please refresh the calendar and try again.");
            return;
        }
        // A non-null booking_group_id always means this was a multi-day
        // booking, regardless of how many of its rows happen to fall in the
        // currently-loaded month — counting rows in monthReservations alone
        // undercounts (or misses entirely) a booking that spans a month
        // boundary, e.g. one starting Aug 30 and viewed while looking at
        // September only shows its last 2 days.
        const multiDay = !!r.booking_group_id;

        const result = await formCard('Remove Booking', [
            { name: 'reason', label: `Why are you removing "${r.course_name}"?`, placeholder: 'Reason for deletion' }
        ], { okLabel: 'Continue' });
        if (!result) return;
        if (!result.reason) { alert('Please enter a reason.'); return; }
        if (!(await confirmCard(multiDay ? 'Remove this multi-day booking? This cannot be undone.' : 'Remove this booking? This cannot be undone.'))) return;

        const { error } = multiDay
            ? await client.from('hall_reservations').delete().eq('booking_group_id', r.booking_group_id)
            : await client.from('hall_reservations').delete().eq('id', id);

        if (error) {
            alert('Could not remove booking: ' + error.message);
            return;
        }

        client.from('deletion_audit_log').insert({
            admin_username: currentAdminName(), entity_type: 'hall_reservation',
            entity_label: `${r.hall} — ${r.course_name} (${r.reservation_date})`, reason: result.reason
        }).then(() => {}, () => {}); // best-effort — shouldn't block the actual deletion

        if (editingReservationId === id) cancelEditReservation();
        await loadMonthReservations();
        renderDayDetail(selectedDateStr);
        renderBookingsChart();
        alert('Booking removed successfully!');
    } catch (err) {
        console.error('deleteReservation failed:', err);
        alert('Something unexpected went wrong removing this booking: ' + err.message);
    }
}

// ============================================================================
// Bookings Overview chart — dynamic per-hall colors, any number of places.
// ============================================================================
function buildBookingsDataset(labels, countsByLabelAndHall) {
    return {
        labels,
        datasets: hallsCache.map(h => ({
            label: h.name,
            data: labels.map(l => (countsByLabelAndHall[l] && countsByLabelAndHall[l][h.name]) || 0),
            backgroundColor: h.color,
            borderRadius: 5
        }))
    };
}

function emptyCountsRow() {
    const row = {};
    hallsCache.forEach(h => { row[h.name] = 0; });
    return row;
}

function drawBookingsChart(labels, countsByLabelAndHall) {
    const totalBookings = Object.values(countsByLabelAndHall).reduce(
        (sum, byHall) => sum + Object.values(byHall).reduce((s, n) => s + n, 0), 0
    );
    const canvasWrap = document.querySelector('.hall-chart-canvas-wrap');
    const emptyMsg = document.getElementById('hallChartEmpty');

    if (totalBookings === 0 || hallsCache.length === 0) {
        canvasWrap.classList.add('hidden-element');
        emptyMsg.classList.remove('hidden-element');
        if (bookingsChart) { bookingsChart.destroy(); bookingsChart = null; }
        return;
    }
    canvasWrap.classList.remove('hidden-element');
    emptyMsg.classList.add('hidden-element');

    if (bookingsChart) bookingsChart.destroy();
    bookingsChart = new Chart(document.getElementById('hallBookingsChart'), {
        type: 'bar',
        data: buildBookingsDataset(labels, countsByLabelAndHall),
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: true } },
            scales: {
                x: { grid: { display: false } },
                y: { beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });
}

function renderBookingsByDay() {
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const labels = [];
    const counts = {};
    for (let d = 1; d <= daysInMonth; d++) {
        labels.push(String(d));
        counts[String(d)] = emptyCountsRow();
    }
    monthReservations.forEach(r => {
        const day = String(Number(r.reservation_date.split('-')[2]));
        if (counts[day] && r.hall in counts[day]) counts[day][r.hall] = (counts[day][r.hall] || 0) + 1;
    });
    drawBookingsChart(labels, counts);
}

async function renderBookingsByMonth() {
    const { data, error } = await client
        .from('hall_reservations')
        .select('hall, reservation_date')
        .gte('reservation_date', `${viewYear}-01-01`)
        .lte('reservation_date', `${viewYear}-12-31`);
    if (error) { console.error(error); return; }

    const monthLabels = MONTH_NAMES.map(m => m.slice(0, 3));
    const counts = {};
    monthLabels.forEach(label => { counts[label] = emptyCountsRow(); });
    (data || []).forEach(r => {
        const monthLabel = monthLabels[Number(r.reservation_date.split('-')[1]) - 1];
        if (counts[monthLabel] && r.hall in counts[monthLabel]) counts[monthLabel][r.hall] = (counts[monthLabel][r.hall] || 0) + 1;
    });
    drawBookingsChart(monthLabels, counts);
}

async function renderBookingsByYear() {
    const { data, error } = await client.from('hall_reservations').select('hall, reservation_date');
    if (error) { console.error(error); return; }

    const counts = {};
    (data || []).forEach(r => {
        const year = r.reservation_date.split('-')[0];
        if (!counts[year]) counts[year] = emptyCountsRow();
        if (r.hall in counts[year]) counts[year][r.hall] = (counts[year][r.hall] || 0) + 1;
    });
    const labels = Object.keys(counts).sort();
    drawBookingsChart(labels, counts);
}

function renderBookingsChart() {
    const granularity = document.getElementById('hallChartGranularity').value;
    if (granularity === 'day') renderBookingsByDay();
    else if (granularity === 'month') renderBookingsByMonth();
    else renderBookingsByYear();
}

document.getElementById('hallChartGranularity').addEventListener('change', renderBookingsChart);

// ============================================================================
// Reservation form — a flexible list of dates, each with its own time
// ============================================================================
let dateEntryCounter = 0;

function createDateEntryRow(dateFromValue, dateToValue, startTime, endTime) {
    dateEntryCounter++;
    const rowId = `dateEntry${dateEntryCounter}`;
    const row = document.createElement('div');
    row.className = 'hall-date-entry-row';
    row.dataset.rowId = rowId;
    row.innerHTML = `
        <div class="hall-date-entry-dates">
            <input type="date" class="hall-entry-date-from" value="${dateFromValue || ''}" required>
            <span>to</span>
            <input type="date" class="hall-entry-date-to" value="${dateToValue || dateFromValue || ''}" required>
        </div>
        <div class="hall-date-entry-times">
            <input type="time" class="hall-entry-start" value="${startTime || ''}" required>
            <span>to</span>
            <input type="time" class="hall-entry-end" value="${endTime || ''}" required>
            <button type="button" class="hall-date-entry-remove-btn">Remove</button>
        </div>
    `;
    row.querySelector('.hall-date-entry-remove-btn').addEventListener('click', () => {
        row.remove();
        updateDateEntryRemoveButtons();
    });
    return row;
}

function updateDateEntryRemoveButtons() {
    const rows = document.querySelectorAll('#hallDatesContainer .hall-date-entry-row');
    // At least one date is always required — hide Remove entirely when
    // it's the only row left, rather than letting the form end up with zero.
    rows.forEach(row => {
        row.querySelector('.hall-date-entry-remove-btn').classList.toggle('hidden-element', rows.length <= 1);
    });
}

function addDateEntryRow(dateFromValue, dateToValue, startTime, endTime) {
    const container = document.getElementById('hallDatesContainer');
    container.appendChild(createDateEntryRow(dateFromValue, dateToValue, startTime, endTime));
    updateDateEntryRemoveButtons();
}

document.getElementById('hallAddDateBtn').addEventListener('click', () => addDateEntryRow());

// Each row can itself be a date RANGE (with one shared time for that whole
// range) — this expands every row into one entry per actual day, so
// downstream conflict-checking and insertion never need to know about
// ranges at all, just a flat list of individual (date, start, end) entries.
function collectDateEntries() {
    const entries = [];
    document.querySelectorAll('#hallDatesContainer .hall-date-entry-row').forEach(row => {
        const dateFrom = row.querySelector('.hall-entry-date-from').value;
        const dateTo = row.querySelector('.hall-entry-date-to').value || dateFrom;
        const start_time = row.querySelector('.hall-entry-start').value;
        const end_time = row.querySelector('.hall-entry-end').value;

        if (!dateFrom) { entries.push({ reservation_date: '', start_time, end_time }); return; }
        let cursor = dateFrom;
        let guard = 0;
        while (cursor <= dateTo && guard < 366) {
            entries.push({ reservation_date: cursor, start_time, end_time });
            cursor = addDays(cursor, 1);
            guard++;
        }
    });
    return entries;
}

function setDefaultFormDates() {
    const todayStr = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
    document.getElementById('hallDatesContainer').innerHTML = '';
    addDateEntryRow(todayStr, todayStr, '', '');
}

// "Entrance Name" is read-only and always shows whoever is CURRENTLY signed
// in — not editable, and re-set to the current admin every time (including
// when editing someone else's earlier booking), so it always reflects who
// last touched the record rather than preserving history in a field meant
// to be typed into.
function currentSessionUsername() {
    try {
        const raw = localStorage.getItem('ibra_admin_session');
        const session = raw ? JSON.parse(raw) : null;
        // Prefer the admin's full name for Entrance Name — falls back to
        // the username only for accounts that don't have one set.
        return (session && (session.fullName || session.username)) || '';
    } catch {
        return '';
    }
}
function prefillEntranceName() {
    document.getElementById('hallWriterName').value = currentSessionUsername();
}

function setFormNote(message, isSuccess) {
    const note = document.getElementById('hallFormNote');
    note.textContent = message || '';
    note.classList.toggle('hall-note-success', !!isSuccess);
}

function dateRangeList(from, to) {
    // Unused now that dates are entered as an explicit list rather than a
    // contiguous range — kept only in case something elsewhere still
    // references it.
    const dates = [];
    let cursor = from;
    let guard = 0;
    while (cursor <= to && guard < 366) {
        dates.push(cursor);
        cursor = addDays(cursor, 1);
        guard++;
    }
    return dates;
}

document.getElementById('hallReservationForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormNote('', false);

    const hall = document.getElementById('hallSelect').value;
    const course_name = document.getElementById('hallCourseName').value.trim();
    const reservation_type = document.getElementById('hallReservationType').value;
    // Always the CURRENT signed-in admin at the moment of saving — the
    // field is read-only and never a free-text value the form trusts.
    const writer_name = currentSessionUsername() || null;
    const organizer_name = document.getElementById('hallOrganizerName').value.trim() || null;
    const phone_number = document.getElementById('hallPhoneNumber').value.trim() || null;
    const participantCountRaw = document.getElementById('hallParticipantCount').value;
    const participant_count = participantCountRaw === '' ? null : parseInt(participantCountRaw, 10);
    if (!hall) {
        setFormNote('Please add at least one place before booking (see Manage Places below).');
        return;
    }
    if (!course_name) {
        setFormNote('Please fill in the activity name.');
        return;
    }
    // Checked directly on the rows (not the expanded entries) — a
    // backwards range (To before From) would otherwise just silently
    // produce zero days for that row instead of a clear error.
    const rows = document.querySelectorAll('#hallDatesContainer .hall-date-entry-row');
    for (const row of rows) {
        const dateFrom = row.querySelector('.hall-entry-date-from').value;
        const dateTo = row.querySelector('.hall-entry-date-to').value;
        if (!dateFrom || !dateTo) {
            setFormNote('Please fill in both dates for every entry.');
            return;
        }
        if (dateTo < dateFrom) {
            setFormNote(`"To" date must be on or after "From" date (${dateFrom}).`);
            return;
        }
    }
    const entries = collectDateEntries();

    for (const entry of entries) {
        if (!entry.reservation_date || !entry.start_time || !entry.end_time) {
            setFormNote('Please fill in every date and both times for each entry.');
            return;
        }
        if (entry.start_time >= entry.end_time) {
            setFormNote(`End time must be after start time (${entry.reservation_date}).`);
            return;
        }
    }
    // Two entries in the SAME submission clashing with each other — catch
    // this before even hitting the database, since the exclusion
    // constraint only guards against EXISTING rows, not duplicates within
    // one insert batch.
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            if (entries[i].reservation_date === entries[j].reservation_date &&
                entries[i].start_time < entries[j].end_time && entries[i].end_time > entries[j].start_time) {
                setFormNote(`Two of your own entries overlap on ${entries[i].reservation_date} — please adjust the times.`);
                return;
            }
        }
    }

    const submitBtn = document.getElementById('hallSubmitBtn');
    const isEditing = editingReservationId !== null;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Checking availability...';

    try {
        const dates = entries.map(en => en.reservation_date);
        const { data: existingOnDates, error: checkErr } = await client
            .from('hall_reservations')
            .select('id, reservation_date, start_time, end_time, course_name, booking_group_id')
            .eq('hall', hall)
            .in('reservation_date', dates);
        if (checkErr) throw checkErr;

        const relevant = isEditing && editingGroupId
            ? (existingOnDates || []).filter(r => r.booking_group_id !== editingGroupId)
            : (existingOnDates || []);

        for (const entry of entries) {
            const clash = relevant.find(r =>
                r.reservation_date === entry.reservation_date &&
                entry.start_time < r.end_time && entry.end_time > r.start_time
            );
            if (clash) {
                setFormNote(`${hall} is already booked on ${clash.reservation_date} from ${formatTime12(clash.start_time)} to ${formatTime12(clash.end_time)} (${clash.course_name}).`);
                submitBtn.disabled = false;
                submitBtn.textContent = isEditing ? 'Update Booking' : 'Book Hall';
                return;
            }
        }

        if (isEditing) {
            const deleteQuery = editingGroupId
                ? client.from('hall_reservations').delete().eq('booking_group_id', editingGroupId)
                : client.from('hall_reservations').delete().eq('id', editingReservationId);
            const { error: delErr } = await deleteQuery;
            if (delErr) throw delErr;
        }

        const booking_group_id = entries.length > 1 ? crypto.randomUUID() : (isEditing ? editingGroupId : null);
        const rows = entries.map(entry => ({
            hall, course_name, reservation_type, writer_name, organizer_name, phone_number, participant_count,
            reservation_date: entry.reservation_date, start_time: entry.start_time, end_time: entry.end_time,
            booking_group_id
        }));

        const { error: saveErr } = await client.from('hall_reservations').insert(rows);

        if (saveErr) {
            if (saveErr.code === '23P01') {
                setFormNote(`${hall} was just booked for an overlapping time by someone else — please pick a different slot.`);
            } else {
                setFormNote((isEditing ? 'Update failed: ' : 'Booking failed: ') + saveErr.message);
            }
            return;
        }

        setFormNote(isEditing ? 'Booking updated successfully!' : 'Hall booked successfully!', true);
        editingReservationId = null;
        editingGroupId = null;
        document.getElementById('hallReservationForm').reset();
        prefillEntranceName();
        setDefaultFormDates();
        document.getElementById('hallSubmitBtn').textContent = 'Book Hall';
        document.getElementById('hallCancelEditBtn').classList.add('hidden-element');

        const viewedMonthKeyPrefix = `${viewYear}-${pad2(viewMonth + 1)}`;
        if (isEditing || dates.some(d => d.startsWith(viewedMonthKeyPrefix))) {
            await loadMonthReservations();
            renderDayDetail(selectedDateStr);
        }
        renderBookingsChart();
    } catch (err) {
        setFormNote((isEditing ? 'Update failed: ' : 'Booking failed: ') + err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = editingReservationId ? 'Update Booking' : 'Book Hall';
    }
});

// ============================================================================
// Init
// ============================================================================
populateCalendarNavSelects();
setDefaultFormDates();
prefillEntranceName();
await loadHalls();
await loadMonthReservations();
renderBookingsChart();
