import { requireSession, client } from '../js/admin-shared.js';

requireSession();

const IBRA_PREFIX = 'Ibra - ';

function setAddNote(message, isError) {
    const note = document.getElementById('addInstNote');
    note.textContent = message || '';
    note.className = `admin-note${isError ? ' error' : ' success'}`;
}

async function loadInstitutions() {
    const tbody = document.getElementById('instTableBody');
    const { data, error } = await client.from('institutions').select('id, name').order('name', { ascending: true });

    if (error) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="1">Couldn't load institutions: ${error.message}</td></tr>`;
        return;
    }

    // This page only manages "Other" (Health Center) institutions now —
    // Ibra departments are a fixed list maintained on the Ibra Department
    // page, so they're left out of this listing entirely, not just hidden
    // from the add form above.
    const otherInstitutions = (data || []).filter(inst => !inst.name.startsWith(IBRA_PREFIX));

    if (otherInstitutions.length === 0) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="1">No institutions yet — add one above.</td></tr>`;
        return;
    }

    tbody.innerHTML = otherInstitutions.map(inst => `
        <tr data-id="${inst.id}">
            <td>${inst.name} <button type="button" class="admin-btn admin-btn-small admin-btn-danger" data-action="remove" style="float:right;">Remove</button></td>
        </tr>`
    ).join('');

    tbody.querySelectorAll('[data-action="remove"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const row = btn.closest('tr');
            const id = row.dataset.id;
            const name = row.children[0].firstChild.textContent.trim();
            if (!(await confirmCard(`Remove "${name}"? This does not affect past registrations already recorded under it.`))) return;
            const { error: delErr } = await client.from('institutions').delete().eq('id', id);
            if (delErr) { alert('Could not remove: ' + delErr.message); return; }
            alert('Removed successfully!');
            loadInstitutions();
        });
    });
}

document.getElementById('addInstBtn').addEventListener('click', async () => {
    const typed = document.getElementById('newInstName').value.trim();
    setAddNote('', false);

    if (!typed) {
        setAddNote('Please enter a name.', true);
        return;
    }

    // This form only adds "Other" institutions now — Ibra departments are
    // a fixed list maintained on the Ibra Department page, not added here.
    // Saved exactly as typed, with no prefix.
    if (typed.startsWith(IBRA_PREFIX) || typed.toLowerCase() === 'ibra') {
        setAddNote('This form only adds "Other" institutions — Ibra departments are managed on the Ibra Department page.', true);
        return;
    }
    const name = typed;

    if (!(await confirmCard(`Add "${name}"?`))) return;

    const btn = document.getElementById('addInstBtn');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
        const { error } = await client.from('institutions').insert({ name });
        if (error) throw error;
        setAddNote(`"${name}" added successfully!`, false);
        document.getElementById('newInstName').value = '';
        loadInstitutions();
    } catch (err) {
        setAddNote('Could not add: ' + err.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = '+ Add';
    }
});

loadInstitutions();
