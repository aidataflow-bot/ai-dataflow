// ===== Shared agency workspace helpers (pipeline stages, appointments, team, timeline) =====
// Loaded after auth.js on every page that shows clients.

const PIPELINE_STAGES = [
    { id: 'lead', label: 'Lead' },
    { id: 'appointment-set', label: 'Appointment set' },
    { id: 'discovery', label: 'Discovery' },
    { id: 'analysis', label: 'Analysis' },
    { id: 'proposal-sent', label: 'Proposal sent' },
    { id: 'won', label: 'Won' },
    { id: 'lost', label: 'Lost' }
];

function stageLabel(stage) {
    const found = PIPELINE_STAGES.find(s => s.id === stage);
    return found ? found.label : 'Lead';
}

function stageBadge(stage) {
    const id = PIPELINE_STAGES.some(s => s.id === stage) ? stage : 'lead';
    return `<span class="stage-badge stage-${id}">${escapeHtml(stageLabel(id))}</span>`;
}

function stageOptions(selected) {
    return PIPELINE_STAGES.map(s =>
        `<option value="${s.id}"${s.id === selected ? ' selected' : ''}>${escapeHtml(s.label)}</option>`
    ).join('');
}

// Appointments are stored as an exact moment (UTC). Each person sees them in their own time zone.
function formatDateTime(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return date.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        ...(sameYear ? {} : { year: 'numeric' }),
        hour: 'numeric', minute: '2-digit'
    });
}

// <input type="datetime-local"> works in local time without a zone.
function toLocalInputValue(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isUpcoming(iso) {
    if (!iso) return false;
    const time = new Date(iso).getTime();
    return !Number.isNaN(time) && time >= Date.now() - 60 * 60 * 1000; // an appointment stays "upcoming" for an hour after it starts
}

// Timeline events store dates as {{date:ISO}} so each viewer sees them in their own time zone.
function eventTextHtml(text) {
    return escapeHtml(text).replace(/\{\{date:([^}]+)\}\}/g, (match, iso) => formatDateTime(iso) || 'a date');
}

function timeAgo(iso) {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (!Number.isFinite(seconds)) return '';
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
    if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)} d ago`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

let teamCache = null;
async function loadTeam() {
    if (!teamCache) {
        const { team } = await apiRequest('/api/team');
        teamCache = team;
    }
    return teamCache;
}

// People a client can be handed to: active consultants and admins.
async function loadConsultants() {
    return (await loadTeam()).filter(m => m.active && m.role !== 'sales');
}

// `current` is the client's present assignee ({id, name}); it stays selectable even if that person was
// deactivated, so saving other changes never silently unassigns the client.
function consultantOptions(consultants, selectedId, blankLabel, current) {
    const blank = `<option value="">${escapeHtml(blankLabel || 'Unassigned')}</option>`;
    const list = current && current.id && !consultants.some(m => m.id === current.id)
        ? [...consultants, { id: current.id, name: `${current.name || 'Former team member'} (inactive)`, role: 'consultant' }]
        : consultants;
    return blank + list.map(m =>
        `<option value="${escapeHtml(m.id)}"${m.id === selectedId ? ' selected' : ''}>${escapeHtml(m.name)}${m.role === 'admin' ? ' (admin)' : ''}</option>`
    ).join('');
}

function industryLabel(industry) {
    const industries = {
        technology: 'Technology', manufacturing: 'Manufacturing', healthcare: 'Healthcare',
        finance: 'Finance', retail: 'Retail', 'real-estate': 'Real Estate', other: 'Other'
    };
    return industries[industry] || industry || '';
}
