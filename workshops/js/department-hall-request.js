import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const today = new Date();
let viewYear = today.getFullYear();
let viewMonth = today.getMonth();
let selectedDateStr = null;
let monthReservations = [];
let activeHallFilter = '';
let hallsCache = [];
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

async function loadHalls() {
    const { data, error } = await client.from('halls').select('id, name, color').order('name', { ascending: true });
    if (error) { console.error('Could not load halls:', error.message); return; }
    hallsCache = data || [];
    hallColorByName = new Map(hallsCache.map(h => [h.name, h.color]));

    document.getElementById('reqHallSelect').innerHTML = hallsCache.map(h => `<option value="${h.name}">${h.name}</option>`).join('');

    const box = document.getElementById('hallLegendFilter');
    box.innerHTML = `<button type="button" class="hall-legend-btn active" data-hall="">All Halls</button>` +
        hallsCache.map(h => `
            <button type="button" class="hall-legend-btn" data-hall="${h.name}">
                <i class="hall-dot" style="background:${h.color}"></i> ${h.name}
            </button>`).join('');
    box.querySelectorAll('.hall-legend-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeHallFilter = btn.dataset.hall;
            box.querySelectorAll('.hall-legend-btn').forEach(b => b.classList.toggle('active', b.dataset.hall === activeHallFilter));
            renderCalendarGrid();
            renderDayDetail(selectedDateStr);
        });
    });
}

function populateCalendarNavSelects() {
    const monthSel = document.getElementById('calMonthSelect');
    monthSel.innerHTML = MONTH_NAMES.map((name, i) => `<option value="${i}">${name}</option>`).join('');
    monthSel.value = viewMonth;
    const yearSel = document.getElementById('calYearSelect');
    let opts = '';
    for (let y = today.getFullYear() - 1; y <= today.getFullYear() + 2; y++) opts += `<option value="${y}">${y}</option>`;
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
}
document.getElementById('calPrevMonth').addEventListener('click', () => goToMonth(viewYear, viewMonth - 1));
document.getElementById('calNextMonth').addEventListener('click', () => goToMonth(viewYear, viewMonth + 1));
document.getElementById('calMonthSelect').addEventListener('change', (e) => goToMonth(viewYear, Number(e.target.value)));
document.getElementById('calYearSelect').addEventListener('change', (e) => goToMonth(Number(e.target.value), viewMonth));

async function loadMonthReservations() {
    const firstDay = `${viewYear}-${pad2(viewMonth + 1)}-01`;
    const lastDayNum = new Date(viewYear, viewMonth + 1, 0).getDate();
    const lastDay = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(lastDayNum)}`;

    // Only real, APPROVED bookings — this page never shows Entrance Name,
    // Organizer, or Phone, so those fields aren't even fetched.
    const { data, error } = await client
        .from('hall_reservations')
        .select('id, hall, course_name, reservation_date, start_time, end_time, booking_group_id')
        .gte('reservation_date', firstDay)
        .lte('reservation_date', lastDay)
        .order('start_time', { ascending: true });

    if (error) {
        document.getElementById('hallCalGrid').innerHTML = `<p style="grid-column:1/-1; color:#dc2626; font-size:13px;">Couldn't load the calendar: ${error.message}</p>`;
        return;
    }
    monthReservations = data || [];
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
    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayKey = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
    const visible = visibleReservations();

    let html = '';
    for (let i = 0; i < firstWeekday; i++) html += `<div class="hall-cal-day hall-cal-day-empty"></div>`;

    for (let day = 1; day <= daysInMonth; day++) {
        const key = dateKey(viewYear, viewMonth, day);
        const dayReservations = visible.filter(r => r.reservation_date === key);
        const pills = dayReservations.slice(0, 2).map(r =>
            `<span class="hall-cal-day-pill ${spanPillClass(r)}" style="background:${colorFor(r.hall)}" title="${r.hall}: ${r.course_name}">${r.course_name}</span>`
        ).join('');
        const more = dayReservations.length > 2 ? `<span class="hall-cal-day-more">+${dayReservations.length - 2} more</span>` : '';

        const classes = ['hall-cal-day'];
        if (key === todayKey) classes.push('hall-cal-day-today');
        if (key === selectedDateStr) classes.push('hall-cal-day-selected');

        html += `
            <button type="button" class="${classes.join(' ')}" data-date="${key}">
                <span class="hall-cal-day-num">${day}</span>
                <span class="hall-cal-day-bookings">${pills}${more}</span>
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
        box.innerHTML = '<p class="hall-day-detail-placeholder">Select a day to see what\'s already booked.</p>';
        return;
    }
    const items = visibleReservations().filter(r => r.reservation_date === dateStr);
    const [y, m, d] = dateStr.split('-').map(Number);
    const label = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

    if (items.length === 0) {
        box.innerHTML = `<p class="hall-day-detail-title">${label}</p><p class="hall-day-detail-placeholder">Nothing booked this day.</p>`;
        return;
    }
    // Deliberately just hall/name/time — no Entrance Name, Organizer, or
    // Phone on this public page, and no edit/delete controls.
    const rows = items.map(r => `
        <div class="hall-day-detail-item" style="border-left-color:${colorFor(r.hall)}">
            <strong>${r.hall} — ${formatTime12(r.start_time)} to ${formatTime12(r.end_time)}</strong>
            <span>${r.course_name}</span>
        </div>`).join('');
    box.innerHTML = `<p class="hall-day-detail-title">${label}</p>${rows}`;
}

// ============================================================================
// Request form — a flexible list of dates, each with its own time
// ============================================================================
let dateEntryCounter = 0;

function createDateEntryRow(dateFromValue, dateToValue, startTime, endTime) {
    dateEntryCounter++;
    const row = document.createElement('div');
    row.className = 'hall-date-entry-row';
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
    const rows = document.querySelectorAll('#reqDatesContainer .hall-date-entry-row');
    rows.forEach(row => {
        row.querySelector('.hall-date-entry-remove-btn').classList.toggle('hidden-element', rows.length <= 1);
    });
}

function addDateEntryRow(dateFromValue, dateToValue, startTime, endTime) {
    document.getElementById('reqDatesContainer').appendChild(createDateEntryRow(dateFromValue, dateToValue, startTime, endTime));
    updateDateEntryRemoveButtons();
}

document.getElementById('reqAddDateBtn').addEventListener('click', () => addDateEntryRow());

// Each row can itself be a date RANGE (with one shared time for that whole
// range) — this expands every row into one entry per actual day.
function collectDateEntries() {
    const entries = [];
    document.querySelectorAll('#reqDatesContainer .hall-date-entry-row').forEach(row => {
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
    document.getElementById('reqDatesContainer').innerHTML = '';
    addDateEntryRow(todayStr, todayStr, '', '');
}
function setFormNote(message, isSuccess) {
    const note = document.getElementById('reqFormNote');
    note.textContent = message || '';
    note.classList.toggle('hall-note-success', !!isSuccess);
}

document.getElementById('hallRequestForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    setFormNote('', false);

    const hall = document.getElementById('reqHallSelect').value;
    const course_name = document.getElementById('reqCourseName').value.trim();
    const reservation_type = document.getElementById('reqReservationType').value;
    const organizer_name = document.getElementById('reqOrganizerName').value.trim();
    const phone_number = document.getElementById('reqPhoneNumber').value.trim();
    const participantCountRaw = document.getElementById('reqParticipantCount').value;
    const participant_count = participantCountRaw === '' ? null : parseInt(participantCountRaw, 10);

    if (!hall) { setFormNote('No halls are set up yet — please contact the admin team.'); return; }
    if (!course_name || !organizer_name || !phone_number) {
        setFormNote('Please fill in every required field.');
        return;
    }
    const rows = document.querySelectorAll('#reqDatesContainer .hall-date-entry-row');
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
    for (let i = 0; i < entries.length; i++) {
        for (let j = i + 1; j < entries.length; j++) {
            if (entries[i].reservation_date === entries[j].reservation_date &&
                entries[i].start_time < entries[j].end_time && entries[i].end_time > entries[j].start_time) {
                setFormNote(`Two of your own entries overlap on ${entries[i].reservation_date} — please adjust the times.`);
                return;
            }
        }
    }

    const submitBtn = document.getElementById('reqSubmitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    try {
        const booking_group_id = entries.length > 1 ? crypto.randomUUID() : null;
        const rows = entries.map(entry => ({
            hall, course_name, reservation_type, organizer_name, phone_number, participant_count,
            reservation_date: entry.reservation_date, start_time: entry.start_time, end_time: entry.end_time,
            booking_group_id, status: 'pending'
        }));
        const { error } = await client.from('hall_requests').insert(rows);
        if (error) throw error;

        setFormNote('Request submitted! The admin team will review it and confirm.', true);
        document.getElementById('hallRequestForm').reset();
        setDefaultFormDates();
    } catch (err) {
        setFormNote('Could not submit your request: ' + err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Request';
    }
});

populateCalendarNavSelects();
setDefaultFormDates();
await loadHalls();
await loadMonthReservations();
