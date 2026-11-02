const button = document.querySelector('#apply');
const status = document.querySelector('#status');

button.addEventListener('click', async () => {
  button.disabled = true;
  button.textContent = 'Starting…';
  status.className = '';
  status.textContent = 'Reading this job page and connecting to JobHunter…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'jh_apply_current' });
    if (!result?.ok) throw new Error(result?.error || 'Could not start the apply assistant.');
    status.className = 'ok';
    status.textContent = `Started${result.title ? `: ${result.title}` : ''}. Keep this tab open.`;
    button.textContent = '✓ Apply flow started';
    setTimeout(() => window.close(), 1400);
  } catch (error) {
    status.className = 'bad';
    status.textContent = error?.message || String(error);
    button.disabled = false;
    button.textContent = '⚡ Apply on this page';
  }
});
