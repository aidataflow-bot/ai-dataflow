// ===== Client Detail Page =====

let currentClient = null;

document.addEventListener('DOMContentLoaded', async function() {
    // Check authentication
    const user = checkAuth();
    if (!user) return;
    
    // Update user info
    updateUserInfo(user);
    
    // Setup logout button
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    // Get client ID from URL
    const urlParams = new URLSearchParams(window.location.search);
    const clientId = urlParams.get('id');
    
    if (!clientId) {
        window.location.href = 'clients.html';
        return;
    }
    
    // Load client details
    await loadClientDetails(user, clientId);
    
    // Setup new analysis buttons
    document.getElementById('newAnalysisBtn')?.addEventListener('click', () => createAnalysisForClient(clientId));
    document.getElementById('newAnalysisBtnEmpty')?.addEventListener('click', () => createAnalysisForClient(clientId));
});

// Load client details
async function loadClientDetails(user, clientId) {
    try {
        currentClient = await getClient(clientId);
    } catch (error) {
        showNotification('Client not found', 'error');
        setTimeout(() => window.location.href = 'clients.html', 2000);
        return;
    }
    
    renderClientDetails();
    await loadClientAnalyses(clientId);
}

// Render client details
function renderClientDetails() {
    const breadcrumb = document.getElementById('breadcrumbClient');
    breadcrumb.textContent = currentClient.company_name;
    
    const detailsContainer = document.getElementById('clientDetails');
    
    detailsContainer.innerHTML = `
        <div class="client-detail-card">
            <div class="client-detail-header">
                <div class="client-detail-title">
                    <h1>
                        <i class="fas fa-building"></i>
                        ${currentClient.company_name}
                    </h1>
                    <div class="client-detail-subtitle">
                        <i class="fas fa-user"></i>
                        ${currentClient.contact_name}
                    </div>
                    <div style="margin-top: 12px;">
                        <span class="client-status-badge ${currentClient.status}">
                            ${currentClient.status}
                        </span>
                    </div>
                </div>
                <div class="client-detail-actions">
                    <button class="btn-secondary" onclick="editClient()">
                        <i class="fas fa-edit"></i> Edit Client
                    </button>
                    <button class="btn-danger-outline" onclick="deleteClient()">
                        <i class="fas fa-trash"></i> Delete
                    </button>
                </div>
            </div>
            
            <div class="client-detail-grid">
                <div class="client-detail-item">
                    <label><i class="fas fa-envelope"></i> Email</label>
                    <div class="value">${currentClient.email}</div>
                </div>
                
                ${currentClient.phone ? `
                    <div class="client-detail-item">
                        <label><i class="fas fa-phone"></i> Phone</label>
                        <div class="value">${currentClient.phone}</div>
                    </div>
                ` : ''}
                
                <div class="client-detail-item">
                    <label><i class="fas fa-industry"></i> Industry</label>
                    <div class="value">${formatIndustry(currentClient.industry)}</div>
                </div>
                
                ${currentClient.company_size ? `
                    <div class="client-detail-item">
                        <label><i class="fas fa-users"></i> Company Size</label>
                        <div class="value">${currentClient.company_size} employees</div>
                    </div>
                ` : ''}
                
                ${currentClient.location ? `
                    <div class="client-detail-item">
                        <label><i class="fas fa-map-marker-alt"></i> Location</label>
                        <div class="value">${currentClient.location}</div>
                    </div>
                ` : ''}
                
                <div class="client-detail-item">
                    <label><i class="fas fa-calendar"></i> Client Since</label>
                    <div class="value">${formatDate(currentClient.created_at)}</div>
                </div>
            </div>
            
            ${currentClient.notes ? `
                <div class="client-notes">
                    <h4><i class="fas fa-sticky-note"></i> Notes</h4>
                    <p>${currentClient.notes}</p>
                </div>
            ` : ''}
        </div>
    `;
}

// Load client analyses
async function loadClientAnalyses(clientId) {
    const recommendations = await getRecommendations();
    const clientAnalyses = recommendations.filter(r => r.clientId === clientId);
    
    const analysesList = document.getElementById('analysesList');
    const noAnalyses = document.getElementById('noAnalyses');
    
    if (clientAnalyses.length === 0) {
        analysesList.style.display = 'none';
        noAnalyses.style.display = 'flex';
        noAnalyses.style.flexDirection = 'column';
        noAnalyses.style.alignItems = 'center';
        return;
    }
    
    analysesList.style.display = 'block';
    noAnalyses.style.display = 'none';
    
    // Sort by date (newest first)
    const sorted = clientAnalyses.sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
    );
    
    analysesList.innerHTML = `
        <div class="history-list">
            ${sorted.map(rec => `
                <div class="history-item" onclick="viewAnalysis('${rec.id}')">
                    <div class="history-item-header">
                        <div class="history-item-title">
                            <h3>
                                ${rec.isFavorite ? '<i class="fas fa-star" style="color: #f59e0b;"></i>' : ''}
                                ${formatAreaName(rec.processArea)}
                            </h3>
                            <div class="history-meta">
                                <span>
                                    <i class="fas fa-calendar"></i>
                                    ${formatDate(rec.createdAt)}
                                </span>
                                <span>
                                    <i class="fas fa-chart-line"></i>
                                    Impact: ${rec.impactScore}/10
                                </span>
                                <span class="priority-badge ${rec.priority}">
                                    ${rec.priority} Priority
                                </span>
                            </div>
                        </div>
                        <div class="history-actions">
                            <button class="btn-icon" onclick="event.stopPropagation(); toggleFavorite('${rec.id}')" title="${rec.isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
                                <i class="fas fa-star"></i>
                            </button>
                        </div>
                    </div>
                    
                    <div class="history-item-body">
                        <p>${truncateText(rec.description, 200)}</p>
                    </div>
                    
                    <div class="history-item-footer">
                        <span class="status-badge ${rec.status}">
                            ${formatStatus(rec.status)}
                        </span>
                        <button class="btn-secondary" onclick="event.stopPropagation(); viewAnalysis('${rec.id}')">
                            <i class="fas fa-external-link-alt"></i> View Details
                        </button>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

// Edit client
function editClient() {
    window.location.href = `clients.html?edit=${currentClient.id}`;
}

// Delete client
async function deleteClient() {
    if (!confirm(`Are you sure you want to delete ${currentClient.company_name}? This will NOT delete their analyses.`)) {
        return;
    }
    
    try {
        await apiRequest(`/api/clients/${encodeURIComponent(currentClient.id)}`, {
            method: 'DELETE'
        });
        showNotification('Client deleted successfully', 'success');
        setTimeout(() => window.location.href = 'clients.html', 1500);
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// Create analysis for client
function createAnalysisForClient(clientId) {
    // Store client ID in session storage to pre-fill in recommendations form
    sessionStorage.setItem('selectedClientId', clientId);
    window.location.href = 'recommendations.html';
}

// View analysis
function viewAnalysis(analysisId) {
    window.location.href = `history.html?view=${analysisId}`;
}

// Toggle favorite
async function toggleFavorite(analysisId) {
    const recommendations = await getRecommendations();
    const rec = recommendations.find(r => r.id === analysisId);

    if (rec) {
        const nextFavorite = !rec.isFavorite;
        await apiRequest(`/api/recommendations/${encodeURIComponent(analysisId)}`, {
            method: 'PATCH',
            body: JSON.stringify({ isFavorite: nextFavorite })
        });
        await loadClientAnalyses(currentClient.id);
        showNotification(
            nextFavorite ? 'Added to favorites!' : 'Removed from favorites',
            'success'
        );
    }
}

// Utility functions
async function getClient(clientId) {
    const { client } = await apiRequest(`/api/clients/${encodeURIComponent(clientId)}`);
    return client;
}

async function getRecommendations() {
    const { recommendations } = await apiRequest('/api/recommendations');
    return recommendations;
}

function formatIndustry(industry) {
    const industries = {
        'technology': 'Technology',
        'manufacturing': 'Manufacturing',
        'healthcare': 'Healthcare',
        'finance': 'Finance',
        'retail': 'Retail',
        'real-estate': 'Real Estate',
        'other': 'Other'
    };
    return industries[industry] || industry;
}

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

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatStatus(status) {
    const formats = {
        'not-started': 'Not Started',
        'in-progress': 'In Progress',
        'completed': 'Completed'
    };
    return formats[status] || status;
}

function truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substr(0, maxLength) + '...';
}

function updateUserInfo(user) {
    const userNameElements = document.querySelectorAll('#userName');
    const displayName = user.name || user.firstName || extractNameFromEmail(user.email);
    
    userNameElements.forEach(el => {
        el.textContent = displayName;
    });
}

function extractNameFromEmail(email) {
    const username = email.split('@')[0];
    const parts = username.split(/[._]/);
    return parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
