// ===== Dashboard Logic =====

document.addEventListener('DOMContentLoaded', async function() {
    // Check authentication
    const user = checkAuth();
    if (!user) return;
    
    // Update user info in navigation
    updateUserInfo(user);
    
    // The role decides what the dashboard emphasises.
    const freshUser = (await window.userReady) || user;
    
    // Appointments and clients to follow up (shared across the agency)
    await loadWorkspace(freshUser);
    
    // Load dashboard statistics
    await loadDashboardStats(user);
    
    // Load recent recommendations
    await loadRecentRecommendations(user);
    
    // Setup logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
});

// Update user info display
function updateUserInfo(user) {
    const userNameElements = document.querySelectorAll('#userName');
    const welcomeNameElement = document.getElementById('welcomeName');
    
    const displayName = user.name || user.firstName || extractNameFromEmail(user.email);
    
    userNameElements.forEach(el => {
        el.textContent = displayName;
    });
    
    if (welcomeNameElement) {
        welcomeNameElement.textContent = displayName;
    }
}

// Load dashboard statistics
async function loadDashboardStats(user) {
    const recommendations = await getRecommendations();
    
    // Calculate stats
    const totalRecommendations = recommendations.length;
    const implementedCount = recommendations.filter(r => r.status === 'completed').length;
    const savedCount = recommendations.filter(r => r.isFavorite).length;
    
    // Calculate average impact
    let avgImpact = '-';
    if (recommendations.length > 0) {
        const totalImpact = recommendations.reduce((sum, r) => sum + (r.impactScore || 0), 0);
        avgImpact = (totalImpact / recommendations.length).toFixed(1);
    }
    
    // Update UI
    document.getElementById('totalRecommendations').textContent = totalRecommendations;
    document.getElementById('implementedCount').textContent = implementedCount;
    document.getElementById('avgImpact').textContent = avgImpact !== '-' ? avgImpact + '/10' : avgImpact;
    document.getElementById('savedCount').textContent = savedCount;
}

// Load recent recommendations
async function loadRecentRecommendations(user) {
    const recommendations = await getRecommendations();
    const recentSection = document.getElementById('recentSection');
    const recentList = document.getElementById('recentList');
    
    if (recommendations.length === 0) {
        recentSection.style.display = 'none';
        return;
    }
    
    // Show section
    recentSection.style.display = 'block';
    
    // Get 3 most recent
    const recent = recommendations
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 3);
    
    // Render recent items
    recentList.innerHTML = recent.map(rec => `
        <div class="recommendation-item">
            <div class="recommendation-header">
                <div class="recommendation-title">
                    <h3>
                        <i class="fas fa-lightbulb"></i>
                        ${rec.processArea ? formatAreaName(rec.processArea) : 'Process Analysis'}
                    </h3>
                    <div class="history-meta">
                        <span>
                            <i class="fas fa-calendar"></i>
                            ${formatDate(rec.createdAt)}
                        </span>
                        <span class="priority-badge ${rec.priority || 'medium'}">
                            ${rec.priority || 'Medium'} Priority
                        </span>
                    </div>
                </div>
                ${rec.isFavorite ? '<i class="fas fa-star" style="color: #f59e0b; font-size: 24px;"></i>' : ''}
            </div>
            <p class="recommendation-description">
                ${escapeHtml(truncateText(rec.description || 'Analysis of business process optimization opportunities.', 150))}
            </p>
            <div class="history-item-footer">
                <span class="status-badge ${rec.status || 'not-started'}">
                    ${formatStatus(rec.status || 'not-started')}
                </span>
                <a href="history.html?view=${encodeURIComponent(rec.id)}" class="btn-secondary">View Details</a>
            </div>
        </div>
    `).join('');
}

// Get recommendations for user
async function getRecommendations() {
    const { recommendations } = await apiRequest('/api/recommendations');
    return recommendations;
}

// Format area name
function formatAreaName(area) {
    const names = {
        'customer-service': 'Customer Service Operations',
        'data-migration': 'Data Migration & Integration',
        'process-optimization': 'Process Optimization',
        'sap-systems': 'SAP Systems',
        'automation': 'Business Process Automation',
        'analytics': 'Data Analytics & BI',
        'real-estate': 'Real Estate & Property Management',
        'other': 'General Process Analysis'
    };
    return names[area] || area;
}

// Format date
function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
        return 'Today';
    } else if (diffDays === 1) {
        return 'Yesterday';
    } else if (diffDays < 7) {
        return `${diffDays} days ago`;
    } else {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
}

// Format status
function formatStatus(status) {
    const formats = {
        'not-started': 'Not Started',
        'in-progress': 'In Progress',
        'completed': 'Completed'
    };
    return formats[status] || status;
}

// Truncate text
function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substr(0, maxLength) + '...';
}


// ===== Shared workspace: appointments and who needs attention =====
async function loadWorkspace(user) {
    const grid = document.getElementById('workspaceGrid');
    let clients = [];
    try {
        ({ clients } = await apiRequest('/api/clients'));
    } catch (error) {
        return;
    }
    if (!clients.length) return;
    grid.style.display = 'grid';

    const isOpen = c => c.stage !== 'won' && c.stage !== 'lost';

    // Upcoming appointments for everyone, soonest first.
    const upcoming = clients
        .filter(c => c.appointment_at && isUpcoming(c.appointment_at) && isOpen(c))
        .sort((a, b) => new Date(a.appointment_at) - new Date(b.appointment_at))
        .slice(0, 6);
    document.getElementById('appointmentsList').innerHTML = upcoming.length
        ? upcoming.map(c => agendaItem(c, formatDateTime(c.appointment_at),
            `${c.assigned_to ? 'With ' + (c.assigned_to_name || 'Former team member') : 'No consultant yet'}${c.appointment_notes ? ' · ' + c.appointment_notes : ''}`)).join('')
        : '<p class="agenda-empty">No upcoming appointments. Set one on a client to see it here.</p>';

    // Second card: consultants see their own clients first; sales see who still needs a consultant.
    const role = userRole(user);
    const focusTitle = document.getElementById('focusTitle');
    let focus;
    if (role === 'sales') {
        focusTitle.innerHTML = '<i class="fas fa-user-clock"></i> Waiting for a consultant';
        focus = clients.filter(c => !c.assigned_to && isOpen(c));
    } else {
        focusTitle.innerHTML = '<i class="fas fa-user-tie"></i> My clients';
        focus = clients.filter(c => c.assigned_to === user.id && isOpen(c));
    }
    focus = focus.sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at)).slice(0, 6);
    document.getElementById('focusList').innerHTML = focus.length
        ? focus.map(c => agendaItem(c, stageLabel(c.stage),
            role === 'sales' ? `Added by ${c.created_by_name || 'Former team member'}` : (c.appointment_at ? 'Appointment ' + formatDateTime(c.appointment_at) : 'No appointment yet'))).join('')
        : `<p class="agenda-empty">${role === 'sales' ? 'Every open client has a consultant.' : 'No clients assigned to you yet.'}</p>`;

    if (role === 'sales') {
        document.getElementById('welcomeSubtitle').textContent = 'Create clients, set appointments and hand them to a consultant. You can follow every client from here.';
    }
}

function agendaItem(client, right, sub) {
    return `
        <a class="agenda-item" href="client-detail.html?id=${encodeURIComponent(client.id)}">
            <div>
                <div class="agenda-title">${escapeHtml(client.company_name)}</div>
                <div class="agenda-sub">${escapeHtml(client.contact_name)} &middot; ${escapeHtml(sub)}</div>
            </div>
            <div class="agenda-when">${escapeHtml(right)}</div>
        </a>`;
}
