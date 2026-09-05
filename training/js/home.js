// Home page for the Training project — KPI cards + charts built from real
// data in the `students` and `evaluations` tables (see js/supabase.js for
// the shared Supabase client this file reuses: `supabaseClient`).

const PALETTE = ['#7C3AED', '#3B82F6', '#06B6D4', '#6366F1', '#EC4899', '#10B981', '#F59E0B'];
const PIE_PALETTE = ['#7C3AED', '#3B82F6', '#06B6D4', '#EC4899', '#10B981', '#F59E0B'];

function setChartState(overlayId, state, message) {
    const overlay = document.getElementById(overlayId);
    const canvas = overlay.previousElementSibling.querySelector('canvas');
    if (state === 'ok') {
        overlay.className = 'chart-state-overlay';
        overlay.innerHTML = '';
        canvas.style.visibility = 'visible';
        return;
    }
    canvas.style.visibility = 'hidden';
    overlay.className = `chart-state-overlay is-visible${state === 'error' ? ' is-error' : ''}`;
    if (state === 'loading') overlay.innerHTML = '<div class="chart-spinner"></div>';
    else overlay.innerHTML = `<span>${message || 'لا توجد بيانات لعرضها.'}</span>`;
}

function renderKpiTile(index, number, error) {
    const grid = document.getElementById('homeKpiGrid');
    const tile = grid.children[index];
    if (!tile) return;
    tile.className = `stat-tile${error ? ' chart-tile-error' : ''}`;
    tile.querySelector('.stat-tile-number').textContent = error ? 'خطأ' : number;
}

function countBy(rows, key) {
    const counts = new Map();
    rows.forEach(r => {
        const value = (r[key] || '').toString().trim() || 'غير محدد';
        counts.set(value, (counts.get(value) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function topNWithOthers(sorted, n) {
    if (sorted.length <= n) return sorted;
    const top = sorted.slice(0, n);
    const othersTotal = sorted.slice(n).reduce((sum, [, c]) => sum + c, 0);
    return [...top, ['أخرى', othersTotal]];
}

async function loadHome() {
    ['chartMonthlyState', 'chartDepartmentsState', 'chartTrainingTypeState', 'chartGenderState']
        .forEach(id => setChartState(id, 'loading'));

    // Only the columns each KPI/chart actually needs — never the participant
    // phone numbers or names, since this page is a purely aggregate view.
    const { data: allStudents, error: studentsErr } = await supabaseClient
        .from('students')
        .select('department, training_start, training_end, training_type, gender, registration_date, is_waitlist, academic_stage');

    if (studentsErr) {
        [0, 1, 2, 3].forEach(i => renderKpiTile(i, studentsErr.message, true));
        ['chartMonthlyState', 'chartDepartmentsState', 'chartTrainingTypeState', 'chartGenderState']
            .forEach(id => setChartState(id, 'error', studentsErr.message));
        return;
    }

    const today = new Date().toISOString().slice(0, 10);
    const confirmed = allStudents.filter(s => !s.is_waitlist);
    const waitlisted = allStudents.filter(s => s.is_waitlist);
    const inTrainingNow = confirmed.filter(s => s.training_start <= today && (!s.training_end || s.training_end >= today));
    const departments = new Set(confirmed.map(s => (s.department || '').trim()).filter(Boolean));

    renderKpiTile(0, confirmed.length);
    renderKpiTile(1, inTrainingNow.length);
    renderKpiTile(2, waitlisted.length);
    renderKpiTile(3, departments.size);

    // Evaluations — a plain count query (head:true → no rows sent back).
    const { count: evalCount, error: evalErr } = await supabaseClient
        .from('evaluations')
        .select('*', { count: 'exact', head: true });
    renderKpiTile(4, evalErr ? evalErr.message : (evalCount ?? 0), !!evalErr);

    renderMonthlyChart(allStudents);
    renderDepartmentsChart(confirmed);
    renderTrainingTypeChart(confirmed);
    renderGenderChart(confirmed);
    renderCategoryChart(confirmed);
}

function renderMonthlyChart(rows) {
    const now = new Date();
    const buckets = [];
    for (let i = 11; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        buckets.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('ar', { month: 'short', year: '2-digit' }), count: 0 });
    }
    const byKey = new Map(buckets.map(b => [b.key, b]));
    rows.forEach(r => {
        if (!r.registration_date) return;
        const d = new Date(r.registration_date);
        const bucket = byKey.get(`${d.getFullYear()}-${d.getMonth()}`);
        if (bucket) bucket.count++;
    });

    if (buckets.every(b => b.count === 0)) { setChartState('chartMonthlyState', 'empty'); return; }
    setChartState('chartMonthlyState', 'ok');
    new Chart(document.getElementById('chartMonthly'), {
        type: 'line',
        data: {
            labels: buckets.map(b => b.label),
            datasets: [{ label: 'تسجيلات', data: buckets.map(b => b.count), borderColor: PALETTE[0], backgroundColor: PALETTE[0], fill: false, tension: 0.4, pointRadius: 4 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
}

function renderDepartmentsChart(rows) {
    if (rows.length === 0) { setChartState('chartDepartmentsState', 'empty'); return; }
    // Every value here is a real department name — there's no "miscellaneous"
    // data being collected, so no "أخرى" bucket to lump anything into. Shows
    // every department that actually has trainees, not just a top-8 slice.
    const top = countBy(rows, 'department');
    setChartState('chartDepartmentsState', 'ok');
    new Chart(document.getElementById('chartDepartments'), {
        type: 'bar',
        data: { labels: top.map(([n]) => n), datasets: [{ label: 'متدربون', data: top.map(([, c]) => c), backgroundColor: top.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 6 }] },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } }
        }
    });
}

function renderTrainingTypeChart(rows) {
    const withType = rows.filter(r => (r.training_type || '').trim());
    if (withType.length === 0) { setChartState('chartTrainingTypeState', 'empty'); return; }
    const grouped = countBy(withType, 'training_type');
    setChartState('chartTrainingTypeState', 'ok');
    new Chart(document.getElementById('chartTrainingType'), {
        type: 'doughnut',
        data: { labels: grouped.map(([n]) => n), datasets: [{ data: grouped.map(([, c]) => c), backgroundColor: PIE_PALETTE }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } }
    });
}

function renderGenderChart(rows) {
    const withGender = rows.filter(r => (r.gender || '').trim());
    if (withGender.length === 0) { setChartState('chartGenderState', 'empty'); return; }
    const grouped = countBy(withGender, 'gender');
    setChartState('chartGenderState', 'ok');

    // Colored by actual meaning (ذكر = male = blue, انثى = female = pink),
    // not by array position — countBy sorts by count, so whichever gender
    // has more registrations would otherwise grab whatever color happened
    // to be first.
    const GENDER_COLORS = { 'ذكر': '#3B82F6', 'انثى': '#EC4899' };
    const colors = grouped.map(([label]) => GENDER_COLORS[label] || '#94a3b8');

    new Chart(document.getElementById('chartGender'), {
        type: 'doughnut',
        data: { labels: grouped.map(([n]) => n), datasets: [{ data: grouped.map(([, c]) => c), backgroundColor: colors }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } } }
    });
}

function renderCategoryChart(rows) {
    // Uses the SAME 4-category structure (الفئات الطبية / الفئات الطبية
    // المساعدة / الأقسام الإدارية / أقسام الهندسة والصيانة) that
    // register.html's own 2-step department picker is built on
    // (js/departments.js's CATEGORIES + findCategoryForDepartment) — not a
    // separate/invented grouping.
    const counts = {};
    rows.forEach(r => {
        if (!r.department) return;
        const category = findCategoryForDepartment(r.department);
        const label = category ? category.name : 'غير مصنف';
        counts[label] = (counts[label] || 0) + 1;
    });
    const grouped = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    if (grouped.length === 0) { setChartState('chartCategoryState', 'empty'); return; }
    setChartState('chartCategoryState', 'ok');
    new Chart(document.getElementById('chartCategory'), {
        type: 'bar',
        data: { labels: grouped.map(([n]) => n), datasets: [{ label: 'متدربون', data: grouped.map(([, c]) => c), backgroundColor: grouped.map((_, i) => PALETTE[i % PALETTE.length]), borderRadius: 6 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
}

loadHome();
