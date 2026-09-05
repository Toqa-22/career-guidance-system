import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

document.getElementById('verifyBtn').addEventListener('click', async () => {
    const certId = document.getElementById('certificateIdInput').value.trim();
    const resultBox = document.getElementById('verifyResult');
    resultBox.classList.remove('hidden-element');

    if (!certId) {
        resultBox.style.background = '#fff5f5';
        resultBox.style.border = '1px solid #fed7d7';
        resultBox.style.color = '#b91c1c';
        resultBox.textContent = 'Please enter a certificate ID.';
        return;
    }

    const btn = document.getElementById('verifyBtn');
    btn.disabled = true;
    btn.textContent = 'Verifying...';
    resultBox.style.background = '#f1f5f9';
    resultBox.style.border = '1px solid #e2e8f0';
    resultBox.style.color = '#334155';
    resultBox.textContent = 'Checking...';

    try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-certificate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'apikey': SUPABASE_ANON_KEY
            },
            body: JSON.stringify({ certificate_number: certId })
        });
        const result = await res.json();

        if (res.ok && result.valid) {
            resultBox.style.background = '#f0fdf4';
            resultBox.style.border = '1px solid #bbf7d0';
            resultBox.style.color = '#166534';
            resultBox.innerHTML = `
                <b>✓ Valid Certificate</b><br>
                Course: ${result.course_name || 'N/A'}<br>
                Issued: ${result.issued_date || 'N/A'}
            `;
        } else {
            resultBox.style.background = '#fff5f5';
            resultBox.style.border = '1px solid #fed7d7';
            resultBox.style.color = '#b91c1c';
            resultBox.textContent = 'This certificate ID could not be verified.';
        }
    } catch (err) {
        resultBox.style.background = '#fff5f5';
        resultBox.style.border = '1px solid #fed7d7';
        resultBox.style.color = '#b91c1c';
        resultBox.textContent = 'Something went wrong. Please try again shortly.';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Verify';
    }
});
