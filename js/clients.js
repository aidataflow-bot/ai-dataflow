// ===== Client Management =====

let allClients = [];
let filteredClients = [];
let allRecommendations = [];
let editingClientId = null;
let consultants = [];

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
    
    // The role decides what the cards show (e.g. only consultants can delete).
    user = (await window.userReady) || user;
    try {
        consultants = await loadConsultants();
    } catch (error) {
        consultants = [];
    }
    
    // Load clients
    await loadClients(user);
    
    // Setup filters
    setupFilters();
    
    // Setup modal
    setupModal();
    
    // Setup add client buttons
    document.getElementById('addClientBtn')?.addEventListener('click', () => openModal());
    document.getElementById('addClientBtnEmpty')?.addEventListener('click', () => openModal());

    // Open the editor when returning from a client detail page.
    handleEditClientQuery();
});

// Load clients
async function loadClients(user) {
    allClients = await getClients();
    allRecommendations = await getRecommendations();
    filteredClients = [...allClients];
    renderClients();
}

async function getClients() {
    const { clients } = await apiRequest('/api/clients');
    return clients;
}

async function createClient(client) {
    const { client: savedClient } = await apiRequest('/api/clients', {
        method: 'POST',
        body: JSON.stringify(client)
    });
    return savedClient;
}

async function updateClient(clientId, client) {
    const { client: savedClient } = await apiRequest(`/api/clients/${encodeURIComponent(clientId)}`, {
        method: 'PUT',
        body: JSON.stringify(client)
    });
    return savedClient;
}

async function removeClient(clientId) {
    await apiRequest(`/api/clients/${encodeURIComponent(clientId)}`, {
        method: 'DELETE'
    });
}

// Render clients grid
function renderClients() {
    const clientsGrid = document.getElementById('clientsGrid');
    const emptyState = document.getElementById('emptyState');
    
    if (filteredClients.length === 0) {
        clientsGrid.style.display = 'none';
        emptyState.style.display = 'flex';
        emptyState.style.flexDirection = 'column';
        emptyState.style.alignItems = 'center';
        return;
    }
    
    clientsGrid.style.display = 'grid';
    emptyState.style.display = 'none';
    
    // Sort by company name
    const sorted = [...filteredClients].sort((a, b) => 
        a.company_name.localeCompare(b.company_name)
    );
    
    const canDelete = isConsultantUser(getCurrentUser());
    clientsGrid.innerHTML = sorted.map(client => {
        const analysesCount = getClientAnalysesCount(client.id);
        const upcoming = isUpcoming(client.appointment_at);
        
        return `
            <div class="client-card" onclick="viewClient('${escapeHtml(client.id)}')">
                <div class="client-card-header">
                    <div class="client-card-title">
                        <h3>
                            <i class="fas fa-building"></i>
                            ${escapeHtml(client.company_name)}
                        </h3>
                        <div class="client-card-subtitle">
                            <i class="fas fa-user"></i>
                            ${escapeHtml(client.contact_name)}
                        </div>
                    </div>
                    <div class="client-card-actions">
                        ${stageBadge(client.stage)}
                    </div>
                </div>
                
                <div class="client-card-workflow">
                    <div class="workflow-line ${client.assigned_to ? '' : 'is-empty'}">
                        <i class="fas fa-user-tie"></i>
                        ${client.assigned_to ? escapeHtml(client.assigned_to_name || 'Former team member') : 'Not assigned yet'}
                    </div>
                    <div class="workflow-line ${client.appointment_at ? (upcoming ? 'is-upcoming' : '') : 'is-empty'}">
                        <i class="fas fa-calendar-check"></i>
                        ${client.appointment_at ? escapeHtml(formatDateTime(client.appointment_at)) : 'No appointment'}
                    </div>
                </div>
                
                <div class="client-card-body">
                    <div class="client-info-grid">
                        <div class="client-info-item">
                            <i class="fas fa-envelope"></i>
                            <span>${escapeHtml(client.email)}</span>
                        </div>
                        ${client.phone ? `
                            <div class="client-info-item">
                                <i class="fas fa-phone"></i>
                                <span>${escapeHtml(client.phone)}</span>
                            </div>
                        ` : ''}
                        <div class="client-info-item">
                            <i class="fas fa-industry"></i>
                            <span>${escapeHtml(formatIndustry(client.industry))}</span>
                        </div>
                        ${client.location ? `
                            <div class="client-info-item">
                                <i class="fas fa-map-marker-alt"></i>
                                <span>${escapeHtml(client.location)}</span>
                            </div>
                        ` : ''}
                    </div>
                </div>
                
                <div class="client-card-footer">
                    <div class="client-analyses-count">
                        <i class="fas fa-lightbulb"></i>
                        <strong>${analysesCount}</strong>
                        <span>Analyses</span>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn-icon" onclick="event.stopPropagation(); editClient('${escapeHtml(client.id)}')" title="Edit client">
                            <i class="fas fa-edit"></i>
                        </button>
                        ${canDelete ? `
                        <button class="btn-icon" onclick="event.stopPropagation(); deleteClient('${escapeHtml(client.id)}')" title="Delete client">
                            <i class="fas fa-trash"></i>
                        </button>` : ''}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Setup filters
function setupFilters() {
    document.getElementById('filterStatus')?.addEventListener('change', applyFilters);
    document.getElementById('filterStage')?.addEventListener('change', applyFilters);
    document.getElementById('filterAssigned')?.addEventListener('change', applyFilters);
    // One entry per active consultant/admin next to the built-in Everyone / Me / Unassigned choices.
    const assigned = document.getElementById('filterAssigned');
    if (assigned) {
        assigned.insertAdjacentHTML('beforeend', consultants.map(m =>
            `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join(''));
    }
    document.getElementById('filterIndustry')?.addEventListener('change', applyFilters);
    document.getElementById('searchClients')?.addEventListener('input', applyFilters);
}

// Apply filters
function applyFilters() {
    const filterStatus = document.getElementById('filterStatus')?.value || 'all';
    const filterIndustry = document.getElementById('filterIndustry')?.value || 'all';
    const filterStage = document.getElementById('filterStage')?.value || 'all';
    const filterAssigned = document.getElementById('filterAssigned')?.value || 'all';
    const myId = (getCurrentUser() || {}).id;
    const searchTerm = document.getElementById('searchClients')?.value.toLowerCase() || '';
    
    filteredClients = allClients.filter(client => {
        if (filterStatus !== 'all' && client.status !== filterStatus) return false;
        if (filterIndustry !== 'all' && client.industry !== filterIndustry) return false;
        if (filterStage !== 'all' && client.stage !== filterStage) return false;
        if (filterAssigned === 'me' && client.assigned_to !== myId) return false;
        if (filterAssigned === 'none' && client.assigned_to) return false;
        if (!['all', 'me', 'none'].includes(filterAssigned) && client.assigned_to !== filterAssigned) return false;
        if (searchTerm) {
            const searchableText = `${client.company_name} ${client.contact_name} ${client.email}`.toLowerCase();
            if (!searchableText.includes(searchTerm)) return false;
        }
        return true;
    });
    
    renderClients();
}

// Setup modal
function setupModal() {
    const modal = document.getElementById('clientModal');
    const closeBtn = document.getElementById('closeModal');
    const cancelBtn = document.getElementById('cancelBtn');
    const saveBtn = document.getElementById('saveClientBtn');
    
    closeBtn?.addEventListener('click', closeModal);
    cancelBtn?.addEventListener('click', closeModal);
    saveBtn?.addEventListener('click', saveClient);
    
    // Close on outside click
    modal?.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
}

// Open modal
function openModal(client = null) {
    const modal = document.getElementById('clientModal');
    const modalTitle = document.getElementById('modalTitle');
    const form = document.getElementById('clientForm');
    
    editingClientId = client ? client.id : null;
    modalTitle.textContent = client ? 'Edit Client' : 'Add New Client';

    // Hand-off fields (stage / consultant / appointment)
    document.getElementById('stage').innerHTML = stageOptions(client ? client.stage : 'lead');
    document.getElementById('assignedTo').innerHTML = consultantOptions(
        consultants,
        client ? client.assigned_to : '',
        'Not assigned yet',
        client && client.assigned_to ? { id: client.assigned_to, name: client.assigned_to_name } : null
    );
    document.getElementById('appointmentAt').value = client ? toLocalInputValue(client.appointment_at) : '';
    document.getElementById('appointmentNotes').value = client ? (client.appointment_notes || '') : '';
    
    if (client) {
        document.getElementById('companyName').value = client.company_name || '';
        document.getElementById('contactName').value = client.contact_name || '';
        document.getElementById('email').value = client.email || '';
        document.getElementById('phone').value = client.phone || '';
        document.getElementById('industry').value = client.industry || '';
        document.getElementById('companySize').value = client.company_size || '';
        document.getElementById('location').value = client.location || '';
        document.getElementById('status').value = client.status || 'active';
        document.getElementById('notes').value = client.notes || '';
    } else {
        form.reset();
        document.getElementById('stage').value = 'lead';
        document.getElementById('assignedTo').value = '';
    }
    
    modal.style.display = 'flex';
}

// Close modal
function closeModal() {
    const modal = document.getElementById('clientModal');
    const form = document.getElementById('clientForm');
    modal.style.display = 'none';
    form.reset();
    editingClientId = null;
}

// Save client
async function saveClient() {
    const form = document.getElementById('clientForm');
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }
    
    const user = getCurrentUser();
    const existingClient = allClients.find(c => c.id === editingClientId);
    
    // Customer info: anyone on the team can change this.
    const clientData = {
        company_name: document.getElementById('companyName').value,
        contact_name: document.getElementById('contactName').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value,
        industry: document.getElementById('industry').value,
        company_size: document.getElementById('companySize').value,
        location: document.getElementById('location').value,
        status: document.getElementById('status').value,
        notes: document.getElementById('notes').value
    };
    
    // Pipeline hand-off fields.
    const workflow = {
        stage: document.getElementById('stage').value,
        assignedTo: document.getElementById('assignedTo').value,
        appointmentAt: fromLocalInputValue(document.getElementById('appointmentAt').value),
        appointmentNotes: document.getElementById('appointmentNotes').value.trim()
    };
    
    const saveBtn = document.getElementById('saveClientBtn');
    saveBtn.disabled = true;
    try {
        if (editingClientId) {
            await updateClient(editingClientId, clientData);
            // Only send what actually changed, so the timeline stays meaningful.
            const changes = {};
            if (workflow.stage !== existingClient.stage) changes.stage = workflow.stage;
            if (workflow.assignedTo !== (existingClient.assigned_to || '')) changes.assignedTo = workflow.assignedTo;
            const before = existingClient.appointment_at ? new Date(existingClient.appointment_at).toISOString() : null;
            if (workflow.appointmentAt !== before) changes.appointmentAt = workflow.appointmentAt;
            if (workflow.appointmentNotes !== (existingClient.appointment_notes || '')) changes.appointmentNotes = workflow.appointmentNotes;
            if (Object.keys(changes).length) {
                await apiRequest(`/api/clients/${encodeURIComponent(editingClientId)}/workflow`, {
                    method: 'PATCH',
                    body: JSON.stringify(changes)
                });
            }
            showNotification('Client updated successfully!', 'success');
        } else {
            await createClient({ ...clientData, ...workflow });
            showNotification('Client added successfully!', 'success');
        }
        
        await loadClients(user);
        closeModal();
    } catch (error) {
        showNotification(error.message, 'error');
    } finally {
        saveBtn.disabled = false;
    }
}

// Edit client
function editClient(clientId) {
    const client = allClients.find(c => c.id === clientId);
    if (client) {
        openModal(client);
    }
}

function handleEditClientQuery() {
    const clientId = new URLSearchParams(window.location.search).get('edit');
    if (!clientId) return;

    const client = allClients.find(c => c.id === clientId);
    if (client) {
        openModal(client);
    } else {
        showNotification('Client not found', 'error');
    }
}

// Delete client
async function deleteClient(clientId) {
    if (!confirm('Are you sure you want to delete this client? This will NOT delete their analyses.')) {
        return;
    }
    
    const user = getCurrentUser();
    try {
        await removeClient(clientId);
        await loadClients(user);
        showNotification('Client deleted successfully', 'success');
    } catch (error) {
        showNotification(error.message, 'error');
    }
}

// View client details
function viewClient(clientId) {
    window.location.href = `client-detail.html?id=${clientId}`;
}

// Get client analyses count
function getClientAnalysesCount(clientId) {
    return allRecommendations.filter(r => r.clientId === clientId).length;
}

// Format industry
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

// Utility functions
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

async function getRecommendations() {
    const { recommendations } = await apiRequest('/api/recommendations');
    return recommendations;
}
