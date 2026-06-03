// ===== History Page Logic =====

let allRecommendations = [];
let filteredRecommendations = [];

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
    
    // Load recommendations
    await loadHistory(user);
    
    // Setup filters
    setupFilters();
    
    // Setup clear history button
    document.getElementById('clearHistoryBtn')?.addEventListener('click', handleClearHistory);

    // Support links from dashboard/client pages that open a specific analysis.
    handleInitialAnalysisView();
});

// Load history
async function loadHistory(user) {
    allRecommendations = await getRecommendations();
    filteredRecommendations = [...allRecommendations];
    
    renderHistory();
}

// Render history
function renderHistory() {
    const historyList = document.getElementById('historyList');
    const emptyState = document.getElementById('emptyState');
    
    if (filteredRecommendations.length === 0) {
        historyList.style.display = 'none';
        emptyState.style.display = 'flex';
        emptyState.style.flexDirection = 'column';
        emptyState.style.alignItems = 'center';
        return;
    }
    
    historyList.style.display = 'flex';
    emptyState.style.display = 'none';
    
    // Sort by date (newest first)
    const sorted = [...filteredRecommendations].sort((a, b) => 
        new Date(b.createdAt) - new Date(a.createdAt)
    );
    
    historyList.innerHTML = sorted.map(rec => `
        <div class="history-item" data-id="${rec.id}">
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
                    <button class="btn-icon toggle-favorite" data-id="${rec.id}" title="${rec.isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
                        <i class="fas fa-star"></i>
                    </button>
                    <button class="btn-icon view-details" data-id="${rec.id}" title="View details">
                        <i class="fas fa-eye"></i>
                    </button>
                    <button class="btn-icon delete-item" data-id="${rec.id}" title="Delete">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            
            <div class="history-item-body">
                <p>${truncateText(rec.description, 200)}</p>
                ${rec.currentTools ? `<p style="margin-top: 12px; color: var(--gray-600);"><strong>Tools:</strong> ${rec.currentTools}</p>` : ''}
                ${rec.teamSize ? `<p style="color: var(--gray-600);"><strong>Team Size:</strong> ${rec.teamSize}</p>` : ''}
            </div>
            
            <div class="history-item-footer">
                <div style="display: flex; gap: 12px; align-items: center;">
                    <span class="status-badge ${rec.status}">
                        ${formatStatus(rec.status)}
                    </span>
                    <select class="status-select" data-id="${rec.id}" style="padding: 6px 12px; border: 2px solid var(--gray-200); border-radius: 6px; font-size: 14px;">
                        <option value="not-started" ${rec.status === 'not-started' ? 'selected' : ''}>Not Started</option>
                        <option value="in-progress" ${rec.status === 'in-progress' ? 'selected' : ''}>In Progress</option>
                        <option value="completed" ${rec.status === 'completed' ? 'selected' : ''}>Completed</option>
                    </select>
                </div>
                <button class="btn-secondary view-full" data-id="${rec.id}">
                    <i class="fas fa-external-link-alt"></i> View Full Analysis
                </button>
            </div>
        </div>
    `).join('');
    
    // Attach event listeners
    attachHistoryEventListeners();
}

// Attach event listeners
function attachHistoryEventListeners() {
    // Toggle favorite
    document.querySelectorAll('.toggle-favorite').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            toggleFavorite(id);
        });
    });
    
    // View details
    document.querySelectorAll('.view-details').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            viewDetails(id);
        });
    });
    
    // Delete item
    document.querySelectorAll('.delete-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            deleteItem(id);
        });
    });
    
    // Status change
    document.querySelectorAll('.status-select').forEach(select => {
        select.addEventListener('change', (e) => {
            e.stopPropagation();
            const id = select.dataset.id;
            updateStatus(id, select.value);
        });
    });
    
    // View full analysis
    document.querySelectorAll('.view-full').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            viewDetails(id);
        });
    });
    
    // Click on item to view details
    document.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'SELECT' && e.target.tagName !== 'I') {
                const id = item.dataset.id;
                viewDetails(id);
            }
        });
    });
}

// Setup filters
function setupFilters() {
    const filterArea = document.getElementById('filterArea');
    const filterStatus = document.getElementById('filterStatus');
    const filterFavorites = document.getElementById('filterFavorites');
    
    filterArea?.addEventListener('change', applyFilters);
    filterStatus?.addEventListener('change', applyFilters);
    filterFavorites?.addEventListener('change', applyFilters);
}

// Apply filters
function applyFilters() {
    const filterArea = document.getElementById('filterArea').value;
    const filterStatus = document.getElementById('filterStatus').value;
    const filterFavorites = document.getElementById('filterFavorites').checked;
    
    filteredRecommendations = allRecommendations.filter(rec => {
        if (filterArea !== 'all' && rec.processArea !== filterArea) return false;
        if (filterStatus !== 'all' && rec.status !== filterStatus) return false;
        if (filterFavorites && !rec.isFavorite) return false;
        return true;
    });
    
    renderHistory();
}

// Toggle favorite
async function toggleFavorite(id) {
    const recommendations = await getRecommendations();
    const rec = recommendations.find(r => r.id === id);
    
    if (rec) {
        const nextFavorite = !rec.isFavorite;
        await apiRequest(`/api/recommendations/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ isFavorite: nextFavorite })
        });
        
        allRecommendations = await getRecommendations();
        applyFilters();
        
        showNotification(
            nextFavorite ? 'Added to favorites!' : 'Removed from favorites',
            'success'
        );
    }
}

// Update status
async function updateStatus(id, newStatus) {
    const recommendations = await getRecommendations();
    const rec = recommendations.find(r => r.id === id);
    
    if (rec) {
        await apiRequest(`/api/recommendations/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            body: JSON.stringify({ status: newStatus })
        });
        
        allRecommendations = await getRecommendations();
        applyFilters();
        
        showNotification('Status updated successfully!', 'success');
    }
}

// Delete item
async function deleteItem(id) {
    if (!confirm('Are you sure you want to delete this recommendation? This action cannot be undone.')) {
        return;
    }
    
    await apiRequest(`/api/recommendations/${encodeURIComponent(id)}`, {
        method: 'DELETE'
    });
    
    allRecommendations = await getRecommendations();
    applyFilters();
    
    showNotification('Recommendation deleted', 'success');
}

// View details in modal
function viewDetails(id) {
    const rec = allRecommendations.find(r => r.id === id);
    if (!rec) return;
    
    const modal = document.getElementById('detailsModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalBody = document.getElementById('modalBody');
    
    modalTitle.textContent = formatAreaName(rec.processArea);
    
    modalBody.innerHTML = `
        <div style="margin-bottom: 24px;">
            <div style="display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;">
                <span class="priority-badge ${rec.priority}">${rec.priority} Priority</span>
                <span class="status-badge ${rec.status}">${formatStatus(rec.status)}</span>
                ${rec.isFavorite ? '<span style="color: #f59e0b;"><i class="fas fa-star"></i> Favorite</span>' : ''}
            </div>
            
            <div class="history-meta" style="margin-bottom: 16px;">
                <span><i class="fas fa-calendar"></i> ${formatDate(rec.createdAt)}</span>
                <span><i class="fas fa-chart-line"></i> Impact: ${rec.impactScore}/10</span>
                ${rec.teamSize ? `<span><i class="fas fa-users"></i> Team: ${rec.teamSize}</span>` : ''}
            </div>
        </div>
        
        <div style="margin-bottom: 24px;">
            <h3 style="margin-bottom: 12px;"><i class="fas fa-file-alt"></i> Process Description</h3>
            <p style="color: var(--gray-700); line-height: 1.8;">${rec.description}</p>
        </div>
        
        ${rec.currentTools ? `
            <div style="margin-bottom: 24px;">
                <h3 style="margin-bottom: 12px;"><i class="fas fa-tools"></i> Current Tools</h3>
                <p style="color: var(--gray-700);">${rec.currentTools}</p>
            </div>
        ` : ''}
        
        ${rec.goals && rec.goals.length > 0 ? `
            <div style="margin-bottom: 24px;">
                <h3 style="margin-bottom: 12px;"><i class="fas fa-bullseye"></i> Goals</h3>
                <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                    ${rec.goals.map(goal => `
                        <span style="padding: 6px 12px; background: var(--gray-100); border-radius: 12px; font-size: 14px;">
                            ${formatGoal(goal)}
                        </span>
                    `).join('')}
                </div>
            </div>
        ` : ''}
        
        <div style="margin-bottom: 24px;">
            <h3 style="margin-bottom: 16px;"><i class="fas fa-lightbulb"></i> AI Recommendations (${rec.results.summary.totalRecommendations})</h3>
            
            <div class="summary-grid" style="margin-bottom: 24px;">
                <div class="summary-item">
                    <div class="value">${rec.results.summary.totalRecommendations}</div>
                    <div class="label">Recommendations</div>
                </div>
                <div class="summary-item">
                    <div class="value">${rec.results.summary.estimatedImpact}</div>
                    <div class="label">Avg Impact</div>
                </div>
                <div class="summary-item">
                    <div class="value">${rec.results.summary.confidenceScore}</div>
                    <div class="label">Confidence</div>
                </div>
            </div>
            
            <div class="recommendations-list">
                ${rec.results.recommendations.slice(0, 3).map((r, idx) => `
                    <div class="recommendation-item" style="margin-bottom: 20px;">
                        <h4 style="font-size: 18px; margin-bottom: 12px;">
                            <span style="color: var(--primary-blue);">${idx + 1}.</span> ${r.title}
                        </h4>
                        <p style="color: var(--gray-700); margin-bottom: 12px;">${r.description}</p>
                        <div style="display: flex; gap: 12px; flex-wrap: wrap; font-size: 14px; color: var(--gray-600);">
                            <span><i class="fas fa-clock"></i> ${r.timeline}</span>
                            <span><i class="fas fa-dollar-sign"></i> ${r.estimatedCost}</span>
                            <span><i class="fas fa-chart-line"></i> ROI: ${r.expectedRoi}</span>
                        </div>
                    </div>
                `).join('')}
            </div>
            
            ${rec.results.recommendations.length > 3 ? `
                <p style="text-align: center; color: var(--gray-600); font-style: italic;">
                    + ${rec.results.recommendations.length - 3} more recommendations
                </p>
            ` : ''}
        </div>
    `;
    
    modal.style.display = 'flex';
    
    // Setup modal close handlers
    document.getElementById('closeModal').onclick = () => modal.style.display = 'none';
    document.getElementById('modalClose').onclick = () => modal.style.display = 'none';
    modal.onclick = (e) => {
        if (e.target === modal) modal.style.display = 'none';
    };
    
    // Setup export button
    document.getElementById('modalExport').onclick = () => {
        exportRecommendation(rec);
    };
}

function handleInitialAnalysisView() {
    const analysisId = new URLSearchParams(window.location.search).get('view');
    if (!analysisId) return;

    const rec = allRecommendations.find(r => r.id === analysisId);
    if (rec) {
        viewDetails(analysisId);
    } else {
        showNotification('Analysis not found', 'error');
    }
}

// Export single recommendation
function exportRecommendation(rec) {
    const data = rec.results.recommendations;
    let csv = 'Recommendation,Priority,Impact Score,Timeline,Estimated Cost,Expected ROI,Description\n';
    
    data.forEach(r => {
        csv += `"${r.title}","${r.priority}",${r.impactScore},"${r.timeline}","${r.estimatedCost}","${r.expectedRoi}","${r.description}"\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recommendation-${rec.id}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    showNotification('Recommendation exported!', 'success');
}

// Handle clear history
async function handleClearHistory() {
    if (!confirm('Are you sure you want to delete ALL recommendations? This action cannot be undone.')) {
        return;
    }
    
    await apiRequest('/api/recommendations', {
        method: 'DELETE'
    });
    
    allRecommendations = [];
    filteredRecommendations = [];
    
    renderHistory();
    showNotification('All recommendations deleted', 'success');
}

// Format goal
function formatGoal(goal) {
    const formats = {
        'reduce-costs': 'Reduce Costs',
        'improve-efficiency': 'Improve Efficiency',
        'enhance-quality': 'Enhance Quality',
        'scale-operations': 'Scale Operations',
        'improve-accuracy': 'Improve Data Accuracy',
        'customer-satisfaction': 'Customer Satisfaction'
    };
    return formats[goal] || goal;
}

// Utility functions (shared with other files)
function updateUserInfo(user) {
    const userNameElements = document.querySelectorAll('#userName');
    const displayName = user.name || user.firstName || extractNameFromEmail(user.email);
    
    userNameElements.forEach(el => {
        el.textContent = displayName;
    });
}

async function getRecommendations() {
    const { recommendations } = await apiRequest('/api/recommendations');
    return recommendations;
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

function extractNameFromEmail(email) {
    const username = email.split('@')[0];
    const parts = username.split(/[._]/);
    return parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
