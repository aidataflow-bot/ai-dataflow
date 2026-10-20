// ===== Client Detail Page =====

let currentClient = null;

document.addEventListener('DOMContentLoaded', async function() {
    // Check authentication
    let user = checkAuth();
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
    
    // The role decides which buttons exist (sales cannot run or change analyses).
    user = (await window.userReady) || user;
    
    // Load client details
    await loadClientDetails(user, clientId);
    
    // Setup new analysis buttons
    document.getElementById('newAnalysisBtn')?.addEventListener('click', () => createAnalysisForClient(clientId));
    document.getElementById('newAnalysisBtnEmpty')?.addEventListener('click', () => createAnalysisForClient(clientId));
    document.getElementById('addNoteBtn')?.addEventListener('click', addNote);
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
    await Promise.all([
        renderPipelinePanel(),
        loadTimeline(),
        loadClientAnalyses(clientId)
    ]);
}

// Render client details
function renderClientDetails() {
    const breadcrumb = document.getElementById('breadcrumbClient');
    breadcrumb.textContent = currentClient.company_name;
    
    const detailsContainer = document.getElementById('clientDetails');
    const canDelete = isConsultantUser(getCurrentUser());
    
    detailsContainer.innerHTML = `
        <div class="client-detail-card">
            <div class="client-detail-header">
                <div class="client-detail-title">
                    <h1>
                        <i class="fas fa-building"></i>
                        ${escapeHtml(currentClient.company_name)}
                    </h1>
                    <div class="client-detail-subtitle">
                        <i class="fas fa-user"></i>
                        ${escapeHtml(currentClient.contact_name)}
                    </div>
                    <div style="margin-top: 12px; display: flex; gap: 8px; flex-wrap: wrap;">
                        ${stageBadge(currentClient.stage)}
                        <span class="client-status-badge ${escapeHtml(currentClient.status)}">
                            ${escapeHtml(currentClient.status)}
                        </span>
                    </div>
                </div>
                <div class="client-detail-actions">
                    <button class="btn-secondary" onclick="editClient()">
                        <i class="fas fa-edit"></i> Edit Client
                    </button>
                    ${canDelete ? `
                    <button class="btn-danger-outline" onclick="deleteClient()">
                        <i class="fas fa-trash"></i> Delete
                    </button>` : ''}
                </div>
            </div>
            
            <div class="client-detail-grid">
                <div class="client-detail-item">
                    <label><i class="fas fa-envelope"></i> Email</label>
                    <div class="value">${escapeHtml(currentClient.email)}</div>
                </div>
                
                ${currentClient.phone ? `
                    <div class="client-detail-item">
                        <label><i class="fas fa-phone"></i> Phone</label>
                        <div class="value">${escapeHtml(currentClient.phone)}</div>
                    </div>
                ` : ''}
                
                <div class="client-detail-item">
                    <label><i class="fas fa-industry"></i> Industry</label>
                    <div class="value">${escapeHtml(formatIndustry(currentClient.industry))}</div>
                </div>
                
                ${currentClient.company_size ? `
                    <div class="client-detail-item">
                        <label><i class="fas fa-users"></i> Company Size</label>
                        <div class="value">${escapeHtml(currentClient.company_size)} employees</div>
                    </div>
                ` : ''}
                
                ${currentClient.location ? `
                    <div class="client-detail-item">
                        <label><i class="fas fa-map-marker-alt"></i> Location</label>
                        <div class="value">${escapeHtml(currentClient.location)}</div>
                    </div>
                ` : ''}
                
                <div class="client-detail-item">
                    <label><i class="fas fa-calendar"></i> Client Since</label>
                    <div class="value">${escapeHtml(formatDate(currentClient.created_at))}</div>
                </div>
                
                <div class="client-detail-item">
                    <label><i class="fas fa-user-plus"></i> Added by</label>
                    <div class="value">${escapeHtml(currentClient.created_by_name || 'Former team member')}</div>
                </div>
            </div>
            
            ${currentClient.notes ? `
                <div class="client-notes">
                    <h4><i class="fas fa-sticky-note"></i> Background notes</h4>
                    <p>${escapeHtml(currentClient.notes)}</p>
                </div>
            ` : ''}
        </div>
    `;
}

// ===== Pipeline & hand-off =====
async function renderPipelinePanel() {
    const panel = document.getElementById('pipelinePanel');
    let consultants = [];
    try {
        consultants = await loadConsultants();
    } catch (error) {
        consultants = [];
    }
    
    const me = getCurrentUser() || {};
    const c = currentClient;
    const canTake = isConsultantUser(me) && c.assigned_to !== me.id;
    const currentIndex = PIPELINE_STAGES.findIndex(st => st.id === c.stage);
    const lost = c.stage === 'lost';
    
    const steps = PIPELINE_STAGES.filter(st => st.id !== 'lost').map((st, index) => {
        const state = lost ? 'muted' : index < currentIndex ? 'done' : index === currentIndex ? 'current' : '';
        return `<li class="pipeline-step ${state}"><span class="pipeline-dot"></span>${escapeHtml(st.label)}</li>`;
    }).join('');
    
    panel.innerHTML = `
        <div class="pipeline-panel">
            <div class="section-header">
                <h2><i class="fas fa-stream"></i> Pipeline &amp; hand-off</h2>
                ${canTake ? `<button class="btn-secondary" id="takeClientBtn"><i class="fas fa-hand-paper"></i> Assign to me</button>` : ''}
            </div>
            <ol class="pipeline-steps">${steps}</ol>
            ${lost ? '<p class="pipeline-lost"><i class="fas fa-times-circle"></i> Marked as lost</p>' : ''}
            <div class="pipeline-form">
                <div class="form-group">
                    <label for="pipeStage"><i class="fas fa-stream"></i> Stage</label>
                    <select id="pipeStage">${stageOptions(c.stage)}</select>
                </div>
                <div class="form-group">
                    <label for="pipeAssigned"><i class="fas fa-user-tie"></i> Consultant</label>
                    <select id="pipeAssigned">${consultantOptions(consultants, c.assigned_to, 'Not assigned yet',
                        c.assigned_to ? { id: c.assigned_to, name: c.assigned_to_name } : null)}</select>
                </div>
                <div class="form-group">
                    <label for="pipeAppointment"><i class="fas fa-calendar-check"></i> Appointment (your time zone)</label>
                    <input type="datetime-local" id="pipeAppointment" value="${escapeHtml(toLocalInputValue(c.appointment_at))}">
                </div>
                <div class="form-group">
                    <label for="pipeAppointmentNotes"><i class="fas fa-comment-dots"></i> Appointment notes</label>
                    <input type="text" id="pipeAppointmentNotes" maxlength="500" value="${escapeHtml(c.appointment_notes || '')}" placeholder="Zoom link, what they want to cover...">
                </div>
            </div>
            <div class="pipeline-actions">
                <button class="btn-primary" id="savePipelineBtn" style="width: auto;"><i class="fas fa-save"></i> Save changes</button>
            </div>
        </div>
    `;
    
    document.getElementById('savePipelineBtn').addEventListener('click', savePipeline);
    document.getElementById('takeClientBtn')?.addEventListener('click', () => {
        document.getElementById('pipeAssigned').value = me.id;
        savePipeline();
    });
}

async function savePipeline() {
    const c = currentClient;
    const wanted = {
        stage: document.getElementById('pipeStage').value,
        assignedTo: document.getElementById('pipeAssigned').value,
        appointmentAt: fromLocalInputValue(document.getElementById('pipeAppointment').value),
        appointmentNotes: document.getElementById('pipeAppointmentNotes').value.trim()
    };
    
    // Send only what changed so the activity log stays readable.
    const changes = {};
    if (wanted.stage !== c.stage) changes.stage = wanted.stage;
    if (wanted.assignedTo !== (c.assigned_to || '')) changes.assignedTo = wanted.assignedTo;
    const before = c.appointment_at ? new Date(c.appointment_at).toISOString() : null;
    if (wanted.appointmentAt !== before) changes.appointmentAt = wanted.appointmentAt;
    if (wanted.appointmentNotes !== (c.appointment_notes || '')) changes.appointmentNotes = wanted.appointmentNotes;
    
    if (!Object.keys(changes).length) {
        showNotification('Nothing to save: no changes yet', 'info');
        return;
    }
    
    const button = document.getElementById('savePipelineBtn');
    button.disabled = true;
    try {
        const { client } = await apiRequest(`/api/clients/${encodeURIComponent(c.id)}/workflow`, {
            method: 'PATCH',
            body: JSON.stringify(changes)
        });
        currentClient = client;
        renderClientDetails();
        await Promise.all([renderPipelinePanel(), loadTimeline()]);
        showNotification('Saved', 'success');
    } catch (error) {
        showNotification(error.message, 'error');
        button.disabled = false;
    }
}

// ===== Notes & activity timeline =====
async function loadTimeline() {
    const panel = document.getElementById('timelinePanel');
    const list = document.getElementById('timelineList');
    panel.style.display = 'block';
    
    let notes = [];
    try {
        ({ notes } = await apiRequest(`/api/clients/${encodeURIComponent(currentClient.id)}/notes`));
    } catch (error) {
        list.innerHTML = `<p class="timeline-empty">Could not load the activity: ${escapeHtml(error.message)}</p>`;
        return;
    }
    
    if (!notes.length) {
        list.innerHTML = '<p class="timeline-empty">No notes yet. Add the first one above.</p>';
        return;
    }
    
    list.innerHTML = notes.map(note => note.kind === 'event' ? `
        <div class="timeline-item is-event">
            <span class="timeline-icon"><i class="fas fa-flag"></i></span>
            <div class="timeline-body">
                <div class="timeline-text">${eventTextHtml(note.body)}</div>
                <div class="timeline-meta">${escapeHtml(note.authorName)} &middot; ${escapeHtml(timeAgo(note.createdAt))}</div>
            </div>
        </div>
    ` : `
        <div class="timeline-item is-note">
            <span class="timeline-icon"><i class="fas fa-comment"></i></span>
            <div class="timeline-body">
                <div class="timeline-meta"><strong>${escapeHtml(note.authorName)}</strong> &middot; ${escapeHtml(timeAgo(note.createdAt))}</div>
                <div class="timeline-text">${escapeHtml(note.body)}</div>
            </div>
        </div>
    `).join('');
}

async function addNote() {
    const input = document.getElementById('noteInput');
    const button = document.getElementById('addNoteBtn');
    const body = input.value.trim();
    if (!body) {
        showNotification('Write a note first', 'error');
        return;
    }
    
    button.disabled = true;
    try {
        await apiRequest(`/api/clients/${encodeURIComponent(currentClient.id)}/notes`, {
            method: 'POST',
            body: JSON.stringify({ body })
        });
        input.value = '';
        await loadTimeline();
    } catch (error) {
        showNotification(error.message, 'error');
    } finally {
        button.disabled = false;
    }
}

// Load client analyses
async function loadClientAnalyses(clientId) {
    const recommendations = await getRecommendations();
    const clientAnalyses = recommendations.filter(r => r.clientId === clientId);
    const canManage = isConsultantUser(getCurrentUser());
    
    const analysesList = document.getElementById('analysesList');
    const noAnalyses = document.getElementById('noAnalyses');
    
    if (clientAnalyses.length === 0) {
        analysesList.style.display = 'none';
        noAnalyses.style.display = 'flex';
        noAnalyses.style.flexDirection = 'column';
        noAnalyses.style.alignItems = 'center';
        if (!canManage) {
            document.getElementById('noAnalysesText').textContent = 'The consultant on this client adds the analysis after the discovery meeting.';
        }
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
                <div class="history-item" onclick="viewAnalysis('${escapeHtml(rec.id)}')">
                    <div class="history-item-header">
                        <div class="history-item-title">
                            <h3>
                                ${rec.isFavorite ? '<i class="fas fa-star" style="color: #f59e0b;"></i>' : ''}
                                ${escapeHtml(formatAreaName(rec.processArea))}
                            </h3>
                            <div class="history-meta">
                                <span>
                                    <i class="fas fa-calendar"></i>
                                    ${escapeHtml(formatDate(rec.createdAt))}
                                </span>
                                <span>
                                    <i class="fas fa-chart-line"></i>
                                    Impact: ${escapeHtml(rec.impactScore)}/10
                                </span>
                                <span class="priority-badge ${escapeHtml(rec.priority)}">
                                    ${escapeHtml(rec.priority)} Priority
                                </span>
                            </div>
                        </div>
                        ${canManage ? `
                        <div class="history-actions">
                            <button class="btn-icon" onclick="event.stopPropagation(); toggleFavorite('${escapeHtml(rec.id)}')" title="${rec.isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
                                <i class="fas fa-star"></i>
                            </button>
                        </div>` : ''}
                    </div>
                    
                    <div class="history-item-body">
                        <p>${escapeHtml(truncateText(rec.description, 200))}</p>
                    </div>
                    
                    <div class="history-item-footer">
                        <span class="status-badge ${escapeHtml(rec.status)}">
                            ${escapeHtml(formatStatus(rec.status))}
                        </span>
                        <button class="btn-secondary" onclick="event.stopPropagation(); viewAnalysis('${escapeHtml(rec.id)}')">
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
