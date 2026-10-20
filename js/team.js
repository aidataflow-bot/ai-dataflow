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
                    ${isMe ? '' : `<button class="btn-secondary btn-small team-toggle" data-id="${escapeHtml(member.id)}" data-active="${member.active ? '0' : '1'}" style="margin-left: 8px;">${member.active ? 'Deactivate' : 'Reactivate'}</button>`}
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
