import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Chart.js instances, kept so a refresh destroys + rebuilds them cleanly
// instead of stacking duplicate canvases on top of each other.
const chartInstances = { monthly: null, cumulative: null, byCourse: null, designation: null, institution: null, gauge: null, stacked: null, radar: null, coverage: null };

let coursesCached = []; // { id, name, course_date, course_end_date } — small table, refetched each load

// ============================================================================
// Date range resolution — every preset is built from LOCAL time (the admin's
// browser), then converted to ISO for the query. registrations.created_at is
// `timestamptz` in Postgres, so comparing against an ISO instant is correct
// no matter what timezone the Supabase server itself runs in — the mistake
// this avoids is treating a typed "2026-09-01" as if it were already UTC.
// ============================================================================
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

function resolveDateRange() {
    const preset = document.getElementById('chartDateRangeSelect').value;
    const now = new Date();
    let from = null, to = null;

    switch (preset) {
        case 'today':
            from = startOfDay(now); to = endOfDay(now); break;
        case '7d':
            from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)); to = endOfDay(now); break;
        case '30d':
            from = startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29)); to = endOfDay(now); break;
        case 'this_month':
            from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)); to = endOfDay(now); break;
        case 'last_month':
            from = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
            to = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)); break;
        case 'this_year':
            from = startOfDay(new Date(now.getFullYear(), 0, 1)); to = endOfDay(now); break;
        case 'custom': {
            const fromStr = document.getElementById('chartCustomFrom').value;
            const toStr = document.getElementById('chartCustomTo').value;
            from = fromStr ? startOfDay(new Date(fromStr + 'T00:00:00')) : null;
            to = toStr ? endOfDay(new Date(toStr + 'T00:00:00')) : null;
            break;
        }
        default: // 'all'
            from = null; to = null;
    }
    return { fromISO: from ? from.toISOString() : null, toISO: to ? to.toISOString() : null };
}

function applyDateFilter(query, fromISO, toISO, column = 'created_at') {
    if (fromISO) query = query.gte(column, fromISO);
    if (toISO) query = query.lte(column, toISO);
    return query;
}

// ============================================================================
// Small aggregation helpers shared by the three "breakdown" charts
// ============================================================================
function countBy(rows, key) {
    const counts = new Map();
    rows.forEach(r => {
        const value = (r[key] || '').toString().trim() || 'Not specified';
        counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// Keeps a chart readable when there are many categories: top N stay as their
// own bars/slices, everything past that collapses into one "Others" bucket.
function topNWithOthers(sortedEntries, n) {
    if (sortedEntries.length <= n) return sortedEntries;
    const top = sortedEntries.slice(0, n);
    const othersTotal = sortedEntries.slice(n).reduce((sum, [, c]) => sum + c, 0);
    return [...top, ['Others', othersTotal]];
}

// Fixed color sets as specified for this dashboard — kept distinct per chart
// kind rather than one generic palette, since bar/line, doughnut, and status
// colors are meant to carry different meaning.
const BAR_LINE_PALETTE = ['#7C3AED', '#3B82F6', '#06B6D4', '#6366F1', '#EC4899', '#10B981', '#F59E0B'];
const PIE_PALETTE = ['#7C3AED', '#3B82F6', '#06B6D4', '#EC4899', '#10B981', '#F59E0B'];
const STATUS_COLORS = { success: '#10B981', pending: '#F59E0B', rejected: '#EF4444', info: '#3B82F6' };

// ============================================================================
// Per-chart loading / empty / error overlay
// ============================================================================
function setChartState(overlayId, state, message, onRetry) {
    const overlay = document.getElementById(overlayId);
    const visualEl = overlay.previousElementSibling; // canvas wrapper OR the funnel's plain div
    const canvas = visualEl.querySelector('canvas'); // null for the Funnel, which has no canvas
    const gaugeLabel = visualEl.querySelector('.chart-gauge-label'); // only present on the Gauge card
    if (state === 'ok') {
        overlay.className = 'chart-state-overlay';
        overlay.innerHTML = '';
        (canvas || visualEl).style.visibility = 'visible';
        if (gaugeLabel) gaugeLabel.style.visibility = 'visible';
        return;
    }
    (canvas || visualEl).style.visibility = 'hidden';
    if (gaugeLabel) gaugeLabel.style.visibility = 'hidden';
    overlay.className = `chart-state-overlay is-visible${state === 'error' ? ' is-error' : ''}`;
    if (state === 'loading') {
        overlay.innerHTML = `<div class="chart-spinner"></div>`;
    } else if (state === 'empty') {
        overlay.innerHTML = `<span>${message || 'No data to show for the selected filters.'}</span>`;
    } else if (state === 'error') {
        overlay.innerHTML = `<span>${message || 'Something went wrong loading this chart.'}</span>` +
            (onRetry ? `<button type="button" class="chart-retry-btn">Retry</button>` : '');
        if (onRetry) overlay.querySelector('.chart-retry-btn').addEventListener('click', onRetry);
    }
}

// ============================================================================
// KPI cards
// ============================================================================
function renderKpiSkeleton() {
    const grid = document.getElementById('chartKpiGrid');
    grid.innerHTML = ['Total Registrations', 'This Month vs Last', 'Institutions Participating', 'Avg Registrations per Course', 'Total Courses']
        .map(label => `
            <div class="stat-tile chart-tile-loading" style="--tile-color:#DDD6FE;">
                <div class="stat-tile-number">…</div>
                <div class="stat-tile-label">${label}</div>
            </div>`).join('');
}

function renderKpiTile(index, { number, label, delta, color, error }) {
    const grid = document.getElementById('chartKpiGrid');
    const tile = grid.children[index];
    if (!tile) return;
    tile.className = `stat-tile${error ? ' chart-tile-error' : ''}`;
    tile.style.setProperty('--tile-color', error ? STATUS_COLORS.rejected : color);
    const deltaHtml = delta ? `<div class="stat-tile-delta ${delta.direction}">${delta.text}</div>` : '';
    tile.innerHTML = `
        <div class="stat-tile-number">${error ? 'Error' : number}</div>
        <div class="stat-tile-label">${label}</div>
        ${deltaHtml}`;
}

// ============================================================================
// Course filter dropdown (also feeds the Open/Closed KPI and course-name
// lookups used by the "Registrations by Course" chart)
// ============================================================================
async function loadCourses() {
    const { data, error } = await client.from('courses').select('id, name, course_date, course_end_date');
    if (error) throw error;
    coursesCached = data || [];

    const select = document.getElementById('chartCourseSelect');
    const preserved = select.value;
    select.innerHTML = '<option value="">All Activity</option>' +
        coursesCached.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
    if ([...select.options].some(o => o.value === preserved)) select.value = preserved;

    renderKpiTile(4, { number: coursesCached.length, label: 'Total Courses', color: '#F59E0B' });
    renderGaugeChart();
}

// ============================================================================
// KPI 1 + Charts 3/4/5/9 all come from ONE shared, filtered query — they all
// need the same date-range/course-filtered rows, so fetching it once here
// (rather than once per chart) avoids sending the same query five times.
// Returns the row count so the Gauge chart can reuse it too, without its own
// separate "total registrations" query.
// ============================================================================
async function loadFilteredRegistrationsAndRender(fromISO, toISO, courseId) {
    let query = client.from('registrations').select('id, course_id, designation_category_snapshot, institution_name_snapshot');
    query = applyDateFilter(query, fromISO, toISO);
    if (courseId) query = query.eq('course_id', Number(courseId));

    const { data, error } = await query;
    if (error) throw error;

    renderKpiTile(0, { number: data.length, label: 'Total Registrations', color: '#7C3AED' });

    // Two more KPIs derived from these same rows — no extra queries needed.
    const distinctInstitutions = new Set(data.map(r => (r.institution_name_snapshot || '').trim()).filter(Boolean)).size;
    renderKpiTile(2, { number: distinctInstitutions, label: 'Institutions Participating', color: '#3B82F6' });

    const distinctCoursesInRange = new Set(data.map(r => r.course_id)).size;
    const avgPerCourse = distinctCoursesInRange > 0 ? (data.length / distinctCoursesInRange).toFixed(1) : '0';
    renderKpiTile(3, { number: avgPerCourse, label: 'Avg Registrations per Course', color: '#06B6D4' });

    renderByCourseChart(data, courseId);
    renderDesignationChart(data);
    renderInstitutionChart(data);
    renderRadarChart(data, courseId);
    return data.length;
}

function renderByCourseChart(rows, courseId) {
    if (courseId) {
        setChartState('chartByCourseState', 'empty', 'Set Course back to "All Activity" to compare across courses.');
        if (chartInstances.byCourse) { chartInstances.byCourse.destroy(); chartInstances.byCourse = null; }
        return;
    }
    if (rows.length === 0) { setChartState('chartByCourseState', 'empty'); return; }

    const grouped = countBy(rows, 'course_id').map(([id, count]) => {
        const course = coursesCached.find(c => String(c.id) === String(id));
        return [course ? course.name : `Course #${id}`, count];
    }).sort((a, b) => b[1] - a[1]);
    const top = topNWithOthers(grouped, 8);

    setChartState('chartByCourseState', 'ok');
    if (chartInstances.byCourse) chartInstances.byCourse.destroy();
    chartInstances.byCourse = new Chart(document.getElementById('chartByCourse'), {
        type: 'bar',
        data: {
            labels: top.map(([name]) => name),
            datasets: [{ label: 'Registrations', data: top.map(([, c]) => c), backgroundColor: top.map((_, i) => BAR_LINE_PALETTE[i % BAR_LINE_PALETTE.length]), borderRadius: 6 }]
        },
        options: {
            indexAxis: 'y', // horizontal — many/long course names read better this way
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: true } },
            scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

function renderDesignationChart(rows) {
    if (rows.length === 0) { setChartState('chartDesignationState', 'empty'); return; }
    const top = topNWithOthers(countBy(rows, 'designation_category_snapshot'), 6);

    setChartState('chartDesignationState', 'ok');
    if (chartInstances.designation) chartInstances.designation.destroy();
    chartInstances.designation = new Chart(document.getElementById('chartDesignation'), {
        type: 'doughnut',
        data: {
            labels: top.map(([name]) => name),
            datasets: [{ data: top.map(([, c]) => c), backgroundColor: PIE_PALETTE }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }
        }
    });
}

function renderInstitutionChart(rows) {
    if (rows.length === 0) { setChartState('chartInstitutionState', 'empty'); return; }
    const top = topNWithOthers(countBy(rows, 'institution_name_snapshot'), 8);

    setChartState('chartInstitutionState', 'ok');
    if (chartInstances.institution) chartInstances.institution.destroy();
    chartInstances.institution = new Chart(document.getElementById('chartInstitution'), {
        type: 'bar',
        data: {
            labels: top.map(([name]) => name),
            datasets: [{ label: 'Registrations', data: top.map(([, c]) => c), backgroundColor: top.map((_, i) => BAR_LINE_PALETTE[i % BAR_LINE_PALETTE.length]), borderRadius: 6 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { autoSkip: false, maxRotation: 40, minRotation: 0, font: { size: 10 } } },
                y: { beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });
}

// ============================================================================
// Chart 9 — Radar: compares the top 4 institutions (by registration count,
// from the SAME filtered rows already fetched above — no extra query) across
// three real, independently-derivable metrics:
//   - Registrations       (how many signups)
//   - Courses Joined      (breadth — distinct courses that institution used)
//   - Avg per Course      (registrations ÷ courses joined — depth/intensity)
// Each axis is normalized to 0–100 against the max among the compared
// institutions, since the three metrics live on very different scales and a
// radar chart is only meaningful when its axes are comparable.
// ============================================================================
function renderRadarChart(rows, courseId) {
    if (courseId) {
        setChartState('chartRadarState', 'empty', 'Set Course back to "All Activity" to compare institutions.');
        if (chartInstances.radar) { chartInstances.radar.destroy(); chartInstances.radar = null; }
        return;
    }
    if (rows.length === 0) { setChartState('chartRadarState', 'empty'); return; }

    const byInstitution = new Map(); // name -> { registrations: n, courses: Set }
    rows.forEach(r => {
        const name = (r.institution_name_snapshot || '').trim() || 'Not specified';
        if (!byInstitution.has(name)) byInstitution.set(name, { registrations: 0, courses: new Set() });
        const entry = byInstitution.get(name);
        entry.registrations++;
        if (r.course_id != null) entry.courses.add(r.course_id);
    });

    const topInstitutions = [...byInstitution.entries()]
        .map(([name, v]) => ({
            name,
            registrations: v.registrations,
            coursesJoined: v.courses.size,
            avgPerCourse: v.courses.size ? v.registrations / v.courses.size : 0
        }))
        .sort((a, b) => b.registrations - a.registrations)
        .slice(0, 4);

    if (topInstitutions.length < 2) {
        setChartState('chartRadarState', 'empty', 'Need at least 2 institutions in range to compare.');
        return;
    }

    const maxReg = Math.max(...topInstitutions.map(i => i.registrations));
    const maxCourses = Math.max(...topInstitutions.map(i => i.coursesJoined));
    const maxAvg = Math.max(...topInstitutions.map(i => i.avgPerCourse));
    const normalize = (v, max) => max > 0 ? Math.round((v / max) * 100) : 0;

    setChartState('chartRadarState', 'ok');
    if (chartInstances.radar) chartInstances.radar.destroy();
    chartInstances.radar = new Chart(document.getElementById('chartRadar'), {
        type: 'radar',
        data: {
            labels: ['Registrations', 'Courses Joined', 'Avg per Course'],
            datasets: topInstitutions.map((inst, i) => ({
                label: inst.name,
                data: [normalize(inst.registrations, maxReg), normalize(inst.coursesJoined, maxCourses), normalize(inst.avgPerCourse, maxAvg)],
                borderColor: BAR_LINE_PALETTE[i % BAR_LINE_PALETTE.length],
                backgroundColor: BAR_LINE_PALETTE[i % BAR_LINE_PALETTE.length] + '33',
                pointBackgroundColor: BAR_LINE_PALETTE[i % BAR_LINE_PALETTE.length]
            }))
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10.5 } } } },
            scales: { r: { beginAtZero: true, max: 100, ticks: { display: false } } }
        }
    });
}

// ============================================================================
// Charts 1, 2, 7 (fixed last-12-months window) + KPI 2 (this month vs last
// month) all come from ONE query — created_at + sex_snapshot for the last 12
// months — since a smooth line (counts), an area chart (running total of
// those same counts), and a stacked-by-gender bar are all just different
// views of the same underlying rows. This window is intentionally
// independent of the Date Range filter above (a "last 12 months" trend
// filtered down to, say, "Today" would just be a single point and defeats
// its own purpose) but DOES still respect the Course filter, so it can show
// one course's trend too.
// ============================================================================
async function loadMonthlyTrendAndRender(courseId) {
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    let query = client.from('registrations').select('created_at, sex_snapshot').gte('created_at', twelveMonthsAgo.toISOString());
    if (courseId) query = query.eq('course_id', Number(courseId));

    const { data, error } = await query;
    if (error) throw error;

    // Pre-seed all 12 month buckets (oldest → newest) so months with zero
    // registrations still show as a real zero point, not a gap.
    const buckets = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), count: 0, male: 0, female: 0, other: 0 });
    }
    const bucketByKey = new Map(buckets.map(b => [b.key, b]));
    (data || []).forEach(r => {
        const d = new Date(r.created_at); // local time, per the timezone note above
        const bucket = bucketByKey.get(`${d.getFullYear()}-${d.getMonth()}`);
        if (!bucket) return;
        bucket.count++;
        const sex = (r.sex_snapshot || '').trim().toLowerCase();
        if (sex === 'male') bucket.male++;
        else if (sex === 'female') bucket.female++;
        else bucket.other++;
    });

    // KPI 2: current calendar month vs the one before it, from this same series.
    const thisMonth = buckets[buckets.length - 1].count;
    const lastMonth = buckets[buckets.length - 2].count;
    let delta = null;
    if (lastMonth > 0) {
        const pct = Math.round(((thisMonth - lastMonth) / lastMonth) * 100);
        delta = { direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat', text: `${pct > 0 ? '+' : ''}${pct}% vs last month` };
    } else if (thisMonth > 0) {
        // Can't express "vs 0" as a percentage without it being misleading —
        // show the plain difference instead of inventing a number.
        delta = { direction: 'up', text: `+${thisMonth} vs last month (was 0)` };
    }
    renderKpiTile(1, { number: thisMonth, label: 'Registrations This Month', delta, color: '#8B5CF6' });

    renderSmoothLineChart(buckets);
    renderCumulativeAreaChart(buckets);
    renderStackedGenderChart(buckets);
}

// Chart 1 — Smooth Line: plain trend line (no fill), so it reads distinctly
// from Chart 2's filled area below rather than looking like the same chart twice.
function renderSmoothLineChart(buckets) {
    if (buckets.every(b => b.count === 0)) { setChartState('chartMonthlyState', 'empty'); return; }
    setChartState('chartMonthlyState', 'ok');
    if (chartInstances.monthly) chartInstances.monthly.destroy();
    chartInstances.monthly = new Chart(document.getElementById('chartMonthly'), {
        type: 'line',
        data: {
            labels: buckets.map(b => b.label),
            datasets: [{
                label: 'Registrations', data: buckets.map(b => b.count),
                borderColor: BAR_LINE_PALETTE[0], backgroundColor: BAR_LINE_PALETTE[0],
                fill: false, tension: 0.4, pointRadius: 4, pointBackgroundColor: BAR_LINE_PALETTE[0], pointBorderColor: '#fff', pointBorderWidth: 1.5
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
            plugins: { legend: { display: false }, tooltip: { enabled: true } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } }
        }
    });
}

// Chart 2 — Area: running (cumulative) total of the same monthly counts, so
// it shows overall growth rather than duplicating the month-to-month trend.
function renderCumulativeAreaChart(buckets) {
    let running = 0;
    const cumulative = buckets.map(b => (running += b.count));
    if (cumulative[cumulative.length - 1] === 0) { setChartState('chartCumulativeState', 'empty'); return; }

    setChartState('chartCumulativeState', 'ok');
    if (chartInstances.cumulative) chartInstances.cumulative.destroy();
    const canvas = document.getElementById('chartCumulative');
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 260);
    gradient.addColorStop(0, 'rgba(59,130,246,0.35)');
    gradient.addColorStop(1, 'rgba(59,130,246,0.02)');

    chartInstances.cumulative = new Chart(canvas, {
        type: 'line',
        data: {
            labels: buckets.map(b => b.label),
            datasets: [{
                label: 'Cumulative Registrations', data: cumulative,
                borderColor: '#3B82F6', backgroundColor: gradient,
                fill: true, tension: 0.4, pointRadius: 3, pointBackgroundColor: '#3B82F6'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } }
        }
    });
}

// Chart 7 — Stacked Bar: same 12 months, split into Male/Female/Not specified
// per month (sex_snapshot) — a composition view, distinct from the plain
// trend/cumulative lines above.
function renderStackedGenderChart(buckets) {
    if (buckets.every(b => b.count === 0)) { setChartState('chartStackedState', 'empty'); return; }
    setChartState('chartStackedState', 'ok');
    if (chartInstances.stacked) chartInstances.stacked.destroy();
    chartInstances.stacked = new Chart(document.getElementById('chartStacked'), {
        type: 'bar',
        data: {
            labels: buckets.map(b => b.label),
            datasets: [
                { label: 'Male', data: buckets.map(b => b.male), backgroundColor: '#3B82F6', borderRadius: 4 },
                { label: 'Female', data: buckets.map(b => b.female), backgroundColor: '#EC4899', borderRadius: 4 },
                { label: 'Not specified', data: buckets.map(b => b.other), backgroundColor: '#94a3b8', borderRadius: 4 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, animation: { duration: 600 },
            plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
            scales: {
                x: { stacked: true, grid: { display: false } },
                y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });
}

// ============================================================================
// Chart 6 — Radial/Gauge: % of all courses currently open for registration
// (the same open/closed logic used on the public register page — see
// js/workshops.js's isRegistrationOpen). Runs entirely off coursesCached, so
// it needs no query of its own beyond the one loadCourses() already makes.
// Built as a half-doughnut (Chart.js has no native gauge type, and this
// needs no extra plugin/library) with the percentage in an HTML label under
// it rather than a canvas plugin, which stays crisp at any screen size.
// ============================================================================
function renderGaugeChart() {
    const label = document.getElementById('chartGaugeLabel');
    if (coursesCached.length === 0) {
        setChartState('chartGaugeState', 'empty', 'No courses yet to calculate a rate from.');
        label.innerHTML = '';
        return;
    }
    const now = new Date();
    const openCount = coursesCached.filter(c => !c.course_end_date || new Date(c.course_end_date + 'T23:59:59') >= now).length;
    const pct = Math.round((openCount / coursesCached.length) * 100);
    const color = pct >= 66 ? STATUS_COLORS.success : pct >= 33 ? STATUS_COLORS.pending : STATUS_COLORS.rejected;

    setChartState('chartGaugeState', 'ok');
    label.innerHTML = `<div class="chart-gauge-value" style="color:${color};">${pct}%</div><div class="chart-gauge-caption">${openCount} of ${coursesCached.length} courses open</div>`;

    if (chartInstances.gauge) chartInstances.gauge.destroy();
    chartInstances.gauge = new Chart(document.getElementById('chartGauge'), {
        type: 'doughnut',
        data: {
            labels: ['Open', 'Closed'],
            datasets: [{ data: [pct, 100 - pct], backgroundColor: [color, '#EEF0F4'], borderWidth: 0 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            circumference: 180, rotation: 270, cutout: '75%',
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            animation: { duration: 600 }
        }
    });
}

// ============================================================================
// Chart 8 — Funnel: course capacity pipeline. Total Courses → Courses with
// at least one registration → Courses that are fully booked (registrations
// reached the seat limit; unlimited-seat courses can never be "fully
// booked" and are correctly excluded from that stage). Reuses coursesCached
// (already fetched) plus one single-column query for per-course
// registration counts — no certificate data involved at all.
// ============================================================================
async function loadFunnelAndRender(courseId) {
    if (courseId) {
        setChartState('chartFunnelState', 'empty', 'Set Course back to "All Activity" to see the capacity funnel.');
        document.getElementById('chartFunnel').innerHTML = '';
        return;
    }
    if (coursesCached.length === 0) { setChartState('chartFunnelState', 'empty'); return; }

    const { data: regRows, error: regErr } = await client.from('registrations').select('course_id');
    if (regErr) throw regErr;

    const countsByCourseId = new Map();
    (regRows || []).forEach(r => countsByCourseId.set(r.course_id, (countsByCourseId.get(r.course_id) || 0) + 1));

    const totalCourses = coursesCached.length;
    const coursesWithRegistrations = countsByCourseId.size;
    const coursesFullyBooked = coursesCached.filter(c =>
        !c.unlimited_seats && c.seats > 0 && (countsByCourseId.get(c.id) || 0) >= c.seats
    ).length;

    const stages = [
        { label: 'Total Courses', value: totalCourses, color: BAR_LINE_PALETTE[0] },
        { label: 'With Registrations', value: coursesWithRegistrations, color: BAR_LINE_PALETTE[1] },
        { label: 'Fully Booked', value: coursesFullyBooked, color: STATUS_COLORS.success }
    ];

    setChartState('chartFunnelState', 'ok');
    const maxValue = Math.max(1, stages[0].value);
    document.getElementById('chartFunnel').innerHTML = stages.map((s, i) => {
        const widthPct = Math.max(18, Math.round((s.value / maxValue) * 100));
        const prevValue = i > 0 ? stages[i - 1].value : null;
        const dropText = prevValue ? `${Math.round((s.value / prevValue) * 100)}% of previous stage` : '';
        return `
            <div class="chart-funnel-stage">
                <div class="chart-funnel-bar" style="width: ${widthPct}%; background: ${s.color};">${s.value}</div>
                <div class="chart-funnel-caption">${s.label}</div>
                ${dropText ? `<div class="chart-funnel-drop">${dropText}</div>` : ''}
            </div>`;
    }).join('');
}

// ============================================================================
// Orchestration — each piece is wrapped so one failure shows an error state
// on just that KPI tile / chart instead of taking the whole page down.
// ============================================================================
async function loadAll() {
    const { fromISO, toISO } = resolveDateRange();
    const courseId = document.getElementById('chartCourseSelect').value;

    ['chartMonthlyState', 'chartCumulativeState', 'chartByCourseState', 'chartDesignationState', 'chartInstitutionState', 'chartGaugeState', 'chartStackedState', 'chartFunnelState', 'chartRadarState']
        .forEach(id => setChartState(id, 'loading'));

    // loadCourses() must resolve before the Funnel task runs (it needs
    // coursesCached), so it's awaited on its own first rather than folded
    // into the parallel batch below. It also renders the Gauge itself.
    let coursesOk = true;
    try {
        await loadCourses();
    } catch (err) {
        coursesOk = false;
        renderKpiTile(4, { number: err.message, label: 'Total Courses', error: true });
        setChartState('chartGaugeState', 'error', err.message, loadAll);
        setChartState('chartFunnelState', 'error', err.message, loadAll);
    }

    await Promise.allSettled([
        loadFilteredRegistrationsAndRender(fromISO, toISO, courseId).catch(err => {
            renderKpiTile(0, { number: err.message, label: 'Total Registrations', error: true });
            renderKpiTile(2, { number: err.message, label: 'Institutions Participating', error: true });
            renderKpiTile(3, { number: err.message, label: 'Avg Registrations per Course', error: true });
            setChartState('chartByCourseState', 'error', err.message, loadAll);
            setChartState('chartDesignationState', 'error', err.message, loadAll);
            setChartState('chartInstitutionState', 'error', err.message, loadAll);
            setChartState('chartRadarState', 'error', err.message, loadAll);
        }),
        loadMonthlyTrendAndRender(courseId).catch(err => {
            renderKpiTile(1, { number: err.message, label: 'Registrations This Month', error: true });
            setChartState('chartMonthlyState', 'error', err.message, loadAll);
            setChartState('chartCumulativeState', 'error', err.message, loadAll);
            setChartState('chartStackedState', 'error', err.message, loadAll);
        }),
        coursesOk ? loadFunnelAndRender(courseId).catch(err => setChartState('chartFunnelState', 'error', err.message, loadAll)) : Promise.resolve()
    ]);
}

// ============================================================================
// Filter wiring
// ============================================================================
document.getElementById('chartDateRangeSelect').addEventListener('change', (e) => {
    document.getElementById('chartCustomDateGroup').classList.toggle('hidden-element', e.target.value !== 'custom');
    if (e.target.value !== 'custom') loadAll();
});
document.getElementById('chartCustomFrom').addEventListener('change', loadAll);
document.getElementById('chartCustomTo').addEventListener('change', loadAll);
document.getElementById('chartCourseSelect').addEventListener('change', loadAll);

// ============================================================================
// Today's Hall Reservations — a quick "what's happening today" widget on the
// home page, independent of the date/course filters above (it's always
// "today", not a filtered range). Runs once at load since a live view of
// today's bookings isn't something the Date Range/Course filters apply to.
// ============================================================================
async function loadTodayHallReservations() {
    const list = document.getElementById('chartTodayList');
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    document.getElementById('chartTodayDateLabel').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

    try {
        const { data, error } = await client
            .from('hall_reservations')
            .select('hall, course_name, organizer_name, start_time, end_time')
            .eq('reservation_date', todayStr)
            .order('start_time', { ascending: true });
        if (error) throw error;

        if (!data || data.length === 0) {
            list.innerHTML = '<p class="chart-today-empty">No hall reservations today.</p>';
            return;
        }

        const formatTime = (t) => {
            const [h, m] = t.split(':').map(Number);
            const period = h >= 12 ? 'PM' : 'AM';
            const hour12 = h % 12 === 0 ? 12 : h % 12;
            return `${hour12}:${String(m).padStart(2, '0')} ${period}`;
        };

        list.innerHTML = `<div class="chart-today-list">${data.map(r => `
            <div class="chart-today-item${r.hall === 'Library' ? ' chart-today-item-library' : ''}">
                <span class="chart-today-time">${formatTime(r.start_time)}–${formatTime(r.end_time)}</span>
                <strong>${r.hall}</strong>
                <span>${r.course_name}</span>
                ${r.organizer_name ? `<span>Organizer: ${r.organizer_name}</span>` : ''}
            </div>`).join('')}</div>`;
    } catch (err) {
        list.innerHTML = `<p class="chart-today-empty" style="color:#EF4444;">Couldn't load today's bookings: ${err.message}</p>`;
    }
}

// ============================================================================
// Department Coverage — total staff per institution (set on the new
// Institutions & Staff admin page) vs. how many DISTINCT staff members from
// that institution have registered for at least one workshop, ever. Kept
// all-time (not filtered by Date Range/Course) since "coverage" is a
// lifetime metric, matching the Funnel chart's same treatment above. Only
// institutions where a staff count was actually entered are shown — an
// institution with no staff_count set has nothing meaningful to compare
// against, not a real zero.
// ============================================================================
async function loadDepartmentCoverageChart() {
    setChartState('chartCoverageState', 'loading');
    try {
        const { data: insts, error: instErr } = await client
            .from('institutions')
            .select('name, staff_count')
            .not('staff_count', 'is', null);
        if (instErr) throw instErr;

        if (!insts || insts.length === 0) {
            setChartState('chartCoverageState', 'empty', 'Set staff counts on the Institutions & Staff page to see this chart.');
            return;
        }

        const { data: regs, error: regErr } = await client
            .from('registrations')
            .select('institution_name_snapshot, staff_number');
        if (regErr) throw regErr;

        const attendedByInstitution = new Map(); // institution name -> Set of distinct staff_number
        (regs || []).forEach(r => {
            const name = (r.institution_name_snapshot || '').trim();
            if (!name || !r.staff_number) return;
            if (!attendedByInstitution.has(name)) attendedByInstitution.set(name, new Set());
            attendedByInstitution.get(name).add(r.staff_number);
        });

        const rows = insts
            .map(i => ({ name: i.name, total: i.staff_count, attended: (attendedByInstitution.get(i.name.trim()) || new Set()).size }))
            .sort((a, b) => b.total - a.total);

        setChartState('chartCoverageState', 'ok');
        if (chartInstances.coverage) chartInstances.coverage.destroy();
        chartInstances.coverage = new Chart(document.getElementById('chartCoverage'), {
            type: 'bar',
            data: {
                labels: rows.map(r => r.name),
                datasets: [
                    { label: 'Total Staff', data: rows.map(r => r.total), backgroundColor: '#DDD6FE', borderRadius: 5 },
                    { label: 'Attended a Workshop', data: rows.map(r => r.attended), backgroundColor: BAR_LINE_PALETTE[0], borderRadius: 5 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
                scales: {
                    x: { ticks: { autoSkip: false, maxRotation: 30, font: { size: 10 } } },
                    y: { beginAtZero: true, ticks: { precision: 0 } }
                }
            }
        });
    } catch (err) {
        setChartState('chartCoverageState', 'error', err.message, loadDepartmentCoverageChart);
    }
}

// ============================================================================
// Activity Calendar — a month calendar showing which days have a scheduled
// course_date. Reuses coursesCached (already fetched by loadCourses() for
// the filter dropdown) — no extra query needed for this widget.
// ============================================================================
const activityCalToday = new Date();
let activityCalYear = activityCalToday.getFullYear();
let activityCalMonth = activityCalToday.getMonth();
let activityCalSelectedDate = null;

function populateActivityCalNavSelects() {
    const monthSel = document.getElementById('activityCalMonthSelect');
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    monthSel.innerHTML = MONTHS.map((name, i) => `<option value="${i}">${name}</option>`).join('');
    monthSel.value = activityCalMonth;

    const yearSel = document.getElementById('activityCalYearSelect');
    const startYear = activityCalToday.getFullYear() - 2;
    const endYear = activityCalToday.getFullYear() + 4;
    let opts = '';
    for (let y = startYear; y <= endYear; y++) opts += `<option value="${y}">${y}</option>`;
    yearSel.innerHTML = opts;
    yearSel.value = activityCalYear;
}

function goToActivityCalMonth(year, month) {
    const d = new Date(year, month, 1);
    activityCalYear = d.getFullYear();
    activityCalMonth = d.getMonth();
    document.getElementById('activityCalMonthSelect').value = activityCalMonth;
    document.getElementById('activityCalYearSelect').value = activityCalYear;
    activityCalSelectedDate = null;
    renderActivityCalGrid();
    hideActivityCalDetail();
}

function renderActivityCalGrid() {
    const grid = document.getElementById('activityCalGrid');
    const firstWeekday = new Date(activityCalYear, activityCalMonth, 1).getDay();
    const daysInMonth = new Date(activityCalYear, activityCalMonth + 1, 0).getDate();
    const pad2 = n => String(n).padStart(2, '0');
    const todayKey = `${activityCalToday.getFullYear()}-${pad2(activityCalToday.getMonth() + 1)}-${pad2(activityCalToday.getDate())}`;

    let html = '';
    for (let i = 0; i < firstWeekday; i++) html += `<div class="activity-cal-day activity-cal-day-empty"></div>`;

    for (let day = 1; day <= daysInMonth; day++) {
        const key = `${activityCalYear}-${pad2(activityCalMonth + 1)}-${pad2(day)}`;
        const dayCourses = coursesCached.filter(c => c.course_date === key);
        const pills = dayCourses.slice(0, 2).map(c => `<span class="activity-cal-day-pill" title="${c.name}">${c.name}</span>`).join('');
        const more = dayCourses.length > 2 ? `<span class="activity-cal-day-more">+${dayCourses.length - 2} more</span>` : '';

        const classes = ['activity-cal-day'];
        if (key === todayKey) classes.push('activity-cal-day-today');
        if (key === activityCalSelectedDate) classes.push('activity-cal-day-selected');

        html += `<button type="button" class="${classes.join(' ')}" data-date="${key}">
            <span class="activity-cal-day-num">${day}</span>${pills}${more}
        </button>`;
    }

    grid.innerHTML = html;
    grid.querySelectorAll('[data-date]').forEach(btn => {
        btn.addEventListener('click', () => {
            const clickedDate = btn.getAttribute('data-date');
            if (activityCalSelectedDate === clickedDate) {
                // Clicking the already-open day again closes it.
                activityCalSelectedDate = null;
                renderActivityCalGrid();
                hideActivityCalDetail();
            } else {
                activityCalSelectedDate = clickedDate;
                renderActivityCalGrid();
                renderActivityCalDayTable(clickedDate);
            }
        });
    });
}

function hideActivityCalDetail() {
    document.getElementById('activityCalDetail').classList.add('hidden-element');
}

// Shown only once a day is clicked — lists just THAT day's activities as a
// table, not the whole month. The calendar grid is the default view; this
// stays hidden until there's something specific to show.
function renderActivityCalDayTable(dateStr) {
    const box = document.getElementById('activityCalDetail');
    const table = document.getElementById('activityCalMonthTable');
    box.classList.remove('hidden-element');

    const items = coursesCached.filter(c => c.course_date === dateStr);
    const label = new Date(dateStr + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

    if (items.length === 0) {
        table.innerHTML = `<tr><td class="activity-cal-month-empty">No activity scheduled on ${label}.</td></tr>`;
        return;
    }
    table.innerHTML = items.map(c =>
        `<tr><td class="activity-cal-month-date">${label}</td><td class="activity-cal-month-name">${c.name}</td></tr>`
    ).join('');
}

function initActivityCalendar() {
    populateActivityCalNavSelects();
    renderActivityCalGrid();
    document.getElementById('activityCalPrev').addEventListener('click', () => goToActivityCalMonth(activityCalYear, activityCalMonth - 1));
    document.getElementById('activityCalNext').addEventListener('click', () => goToActivityCalMonth(activityCalYear, activityCalMonth + 1));
    document.getElementById('activityCalMonthSelect').addEventListener('change', e => goToActivityCalMonth(activityCalYear, Number(e.target.value)));
    document.getElementById('activityCalYearSelect').addEventListener('change', e => goToActivityCalMonth(Number(e.target.value), activityCalMonth));
}

renderKpiSkeleton();
loadAll().then(initActivityCalendar);
loadTodayHallReservations();
loadDepartmentCoverageChart();
