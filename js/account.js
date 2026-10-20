// ===== Account page: who you are + change your own password =====

document.addEventListener('DOMContentLoaded', async function() {
    let user = checkAuth();
    if (!user) return;

    document.querySelectorAll('#userName').forEach(el => {
        el.textContent = user.name || user.firstName || extractNameFromEmail(user.email);
    });
    document.getElementById('logoutBtn')?.addEventListener('click', handleLogout);

    user = (await window.userReady) || user;
    document.getElementById('accName').textContent = user.name || '';
    document.getElementById('accEmail').textContent = user.email || '';
    const role = userRole(user);
    const roleChip = document.getElementById('accRole');
    roleChip.textContent = ROLE_LABELS[role];
    roleChip.className = `role-chip role-${role}`;

    document.getElementById('passwordForm').addEventListener('submit', changePassword);
});

async function changePassword(event) {
    event.preventDefault();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (newPassword.length < 8) {
        showNotification('The new password must be at least 8 characters', 'error');
        return;
    }
    if (newPassword !== confirmPassword) {
        showNotification('The new passwords do not match', 'error');
        return;
    }
    if (newPassword === currentPassword) {
        showNotification('The new password must be different from the current one', 'error');
        return;
    }

    const button = document.getElementById('passwordSubmit');
    button.disabled = true;
    try {
        const { token } = await apiRequest('/api/me/password', {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword })
        });
        // The old token stops working the moment the password changes; keep this browser signed in.
        localStorage.setItem(AUTH_TOKEN_KEY, token);
        event.target.reset();
        showNotification('Password changed. Your other sessions have been signed out.', 'success');
    } catch (error) {
        showNotification(error.message, 'error');
    }
    button.disabled = false;
}
