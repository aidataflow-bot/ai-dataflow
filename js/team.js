// ===== Team page (admin only) =====

let teamMembers = [];

document.addEventListener('DOMContentLoaded', async function() {
    let user = checkAuth();
    if (!user) return;

    document.querySelectorAll('#userName').forEach(el => {
        el.textContent = user.name || user.firstName || extractNameFromEmail(user.email);
    });
    document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);

    // Only admins manage the team; the server refuses everyone else too.
    user = (await window.userReady) || user;
    if (userRole(user) !== 'admin') {
        showNotification('Only admins can manage the team.', 'error');
        setTimeout(() => { window.location.href = 'dashboard.html'; }, 1000);
        return;
    }

    await loadMembers();
});

async function loadMembers() {
    const body = document.getElementById('teamBody');
    try {
        ({ team: teamMembers } = await apiRequest('/api/team'));
    } catch (error) {
        body.innerHTML = `<tr><td colspan="4" class="timeline-empty">${escapeHtml(error.message)}</td></tr>`;
        return;
    }
    renderMembers();
}

function renderMembers() {
    const me = getCurrentUser() || {};
    const body = document.getElementById('teamBody');
    const sorted = [...teamMembers].sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));

    body.innerHTML = sorted.map(member => {
        const isMe = member.id === me.id;
        return `
            <tr class="${member.active ? '' : 'is-inactive'}">
                <td>
                    <div class="team-name">${escapeHtml(member.name)}${isMe ? ' <span class="role-chip">you</span>' : ''}</div>
                    <div class="team-email">${escapeHtml(member.email || '')}</div>
                </td>
                <td>
                    <select data-id="${escapeHtml(member.id)}" class="team-role" ${isMe ? 'disabled title="Ask another admin to change your own role"' : ''}>
                        ${['admin', 'consultant', 'sales'].map(role =>
                            `<option value="${role}"${member.role === role ? ' selected' : ''}>${escapeHtml(ROLE_LABELS[role])}</option>`).join('')}
                    </select>
                </td>
                <td>
                    ${member.active ? '<span class="client-status-badge active">Active</span>' : '<span class="client-status-badge inactive">Deactivated</span>'}
                    ${isMe ? '' : `<div class="team-actions">
                        <button class="btn-secondary btn-small team-toggle" data-id="${escapeHtml(member.id)}" data-active="${member.active ? '0' : '1'}">${member.active ? 'Deactivate' : 'Reactivate'}</button>
                        <button class="btn-secondary btn-small team-reset" data-id="${escapeHtml(member.id)}">Reset password</button>
                    </div>`}
                </td>
                <td>${member.createdAt ? escapeHtml(new Date(member.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })) : ''}</td>
            </tr>`;
    }).join('');

    body.querySelectorAll('.team-role').forEach(select => {
        select.addEventListener('change', () => updateMember(select.dataset.id, { role: select.value }, select));
    });
    body.querySelectorAll('.team-toggle').forEach(button => {
        button.addEventListener('click', () => {
            const member = teamMembers.find(m => m.id === button.dataset.id);
            const activate = button.dataset.active === '1';
            if (!activate && !confirm(`Deactivate ${member ? member.name : 'this person'}? They are signed out immediately and cannot log in until you reactivate them.`)) return;
            updateMember(button.dataset.id, { active: activate }, button);
        });
    });
    body.querySelectorAll('.team-reset').forEach(button => {
        button.addEventListener('click', () => resetPassword(button.dataset.id, button));
    });
}

// Admin sets a one-time temporary password. It is shown once, in the page only (never logged
// or stored), and the person is signed out everywhere until they use it.
async function resetPassword(id, button) {
    const member = teamMembers.find(m => m.id === id);
    const name = member ? member.name : 'this person';
    if (!confirm(`Reset the password for ${name}? They are signed out everywhere and must sign in with a temporary password that you will see once.`)) return;

    button.disabled = true;
    try {
        const result = await apiRequest(`/api/team/${encodeURIComponent(id)}/reset-password`, { method: 'POST' });
        showResetNotice(result.member.name, result.temporaryPassword);
    } catch (error) {
        showNotification(error.message, 'error');
    }
    button.disabled = false;
}

function showResetNotice(name, temporaryPassword) {
    const box = document.getElementById('resetNotice');
    box.innerHTML = `
        <div class="reset-title"><i class="fas fa-key"></i> Temporary password for <strong>${escapeHtml(name)}</strong> &mdash; shown once</div>
        <div class="reset-code" id="resetCode"></div>
        <div class="reset-actions">
            <button type="button" class="btn-secondary btn-small" id="copyReset"><i class="fas fa-copy"></i> Copy</button>
            <button type="button" class="btn-secondary btn-small" id="dismissReset">Done, I have copied it</button>
        </div>
        <p class="reset-help">Send it to ${escapeHtml(name)} privately. They sign in at the login page with this password, then open <b>Account</b> (click their name at the top right) and choose a new password. Once you click Done it cannot be shown again; reset again if you lose it.</p>`;
    document.getElementById('resetCode').textContent = temporaryPassword;
    box.hidden = false;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    document.getElementById('copyReset').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(temporaryPassword);
            showNotification('Copied to clipboard', 'success');
        } catch (error) {
            const range = document.createRange();
            range.selectNodeContents(document.getElementById('resetCode'));
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            showNotification('Press Ctrl+C (or Cmd+C) to copy the selected password', 'info');
        }
    });
    document.getElementById('dismissReset').addEventListener('click', () => {
        box.hidden = true;
        box.innerHTML = '';
    });
}

async function updateMember(id, changes, control) {
    control.disabled = true;
    try {
        const { member } = await apiRequest(`/api/team/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify(changes)
        });
        const index = teamMembers.findIndex(m => m.id === id);
        if (index >= 0) teamMembers[index] = { ...teamMembers[index], ...member };
        showNotification('Team updated', 'success');
    } catch (error) {
        showNotification(error.message, 'error');
    }
    renderMembers();
}
