import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../js/config.js';
import { requireSession } from '../js/admin-shared.js';

requireSession();
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function setAddNote(message, isError) {
    const note = document.getElementById('addHallNote');
    note.textContent = message || '';
    note.className = `admin-note${isError ? ' error' : ' success'}`;
}

async function loadHalls() {
    const tbody = document.getElementById('hallsTableBody');
    const { data, error } = await client.from('halls').select('id, name, color').order('name', { ascending: true });

    if (error) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="3">Couldn't load halls: ${error.message}</td></tr>`;
        return;
    }
    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr class="admin-empty-row"><td colspan="3">No halls yet — add one above.</td></tr>`;
        return;
    }

    tbody.innerHTML = data.map(h => `
        <tr data-id="${h.id}">
            <td><span class="admin-color-swatch" style="background:${h.color}"></span></td>
            <td>${h.name}</td>
            <td>
                <input type="color" class="admin-color-input-small" data-action="recolor" value="${h.color}" title="Change color">
                <button type="button" class="admin-btn admin-btn-small admin-btn-danger" data-action="remove">Remove</button>
            </td>
        </tr>
    `).join('');

    tbody.querySelectorAll('[data-action="recolor"]').forEach(input => {
        input.addEventListener('change', async () => {
            const id = input.closest('tr').dataset.id;
            const { error: updErr } = await client.from('halls').update({ color: input.value }).eq('id', id);
            if (updErr) { alert('Could not update color: ' + updErr.message); return; }
            alert('Color updated successfully!');
            loadHalls();
        });
    });
    tbody.querySelectorAll('[data-action="remove"]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const row = btn.closest('tr');
            const id = row.dataset.id;
            const name = row.children[1].textContent;
            if (!(await confirmCard(`Remove "${name}"? Existing bookings for it are kept, but it won't be bookable anymore.`))) return;
            const { error: delErr } = await client.from('halls').delete().eq('id', id);
            if (delErr) { alert('Could not remove hall: ' + delErr.message); return; }
            alert('Removed successfully!');
            loadHalls();
        });
    });
}

document.getElementById('addHallBtn').addEventListener('click', async () => {
    const nameInput = document.getElementById('newHallName');
    const colorValue = document.getElementById('newHallColor').value;
    const name = nameInput.value.trim();
    setAddNote('', false);

    if (!name) {
        setAddNote('Please enter a hall name.', true);
        return;
    }
    if (!(await confirmCard(`Add hall "${name}"?`))) return;

    const btn = document.getElementById('addHallBtn');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
        const { error } = await client.from('halls').insert({ name, color: colorValue });
        if (error) throw error;
        setAddNote(`"${name}" added successfully!`, false);
        nameInput.value = '';
        document.getElementById('newHallColor').value = '#7C3AED';
        loadHalls();
    } catch (err) {
        setAddNote('Could not add hall: ' + err.message, true);
    } finally {
        btn.disabled = false;
        btn.textContent = '+ Add';
    }
});

loadHalls();
