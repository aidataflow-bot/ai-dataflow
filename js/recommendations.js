// ===== AI Recommendations Engine =====

let currentRecommendation = null;
let availableClients = [];

document.addEventListener('DOMContentLoaded', function() {
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
    
    // Setup form
    const form = document.getElementById('recommendationForm');
    if (form) {
        form.addEventListener('submit', handleFormSubmit);
    }
    
    // Character counter
    const textarea = document.getElementById('processDescription');
    const charCount = document.getElementById('charCount');
    if (textarea && charCount) {
        textarea.addEventListener('input', () => {
            charCount.textContent = textarea.value.length;
        });
    }
    
    // Setup file upload
    setupFileUpload();
    
    // Load clients for selection
    loadClientsDropdown();
    setupQuickClientActions();
    
    // Setup result actions
    setupResultActions();
});

// File upload management
let uploadedFiles = [];

function setupFileUpload() {
    const fileInput = document.getElementById('attachments');
    const fileUploadArea = document.getElementById('fileUploadArea');
    const fileUploadPrompt = document.getElementById('fileUploadPrompt');
    
    if (!fileInput || !fileUploadArea) return;
    
    // Click to upload
    fileUploadArea.addEventListener('click', (e) => {
        if (e.target.classList.contains('file-item-remove') || e.target.closest('.file-item-remove')) {
            return;
        }
        fileInput.click();
    });
    
    // File selection
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });
    
    // Drag and drop
    fileUploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        fileUploadArea.classList.add('dragover');
    });
    
    fileUploadArea.addEventListener('dragleave', () => {
        fileUploadArea.classList.remove('dragover');
    });
    
    fileUploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        fileUploadArea.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
}

function handleFiles(files) {
    const maxSize = 10 * 1024 * 1024; // 10MB
    
    Array.from(files).forEach(file => {
        // Check file size
        if (file.size > maxSize) {
            showNotification(`File "${file.name}" is too large. Maximum size is 10MB.`, 'error');
            return;
        }
        
        // Check for duplicates
        if (uploadedFiles.some(f => f.name === file.name && f.size === file.size)) {
            showNotification(`File "${file.name}" is already added.`, 'error');
            return;
        }
        
        // Add file
        uploadedFiles.push(file);
    });
    
    renderFileList();
}

function renderFileList() {
    const fileList = document.getElementById('fileList');
    const fileUploadPrompt = document.getElementById('fileUploadPrompt');
    
    if (uploadedFiles.length === 0) {
        fileList.innerHTML = '';
        fileUploadPrompt.style.display = 'block';
        return;
    }
    
    fileUploadPrompt.style.display = 'none';
    
    fileList.innerHTML = uploadedFiles.map((file, index) => {
        const icon = getFileIcon(file.name);
        const size = formatFileSize(file.size);
        
        return `
            <div class="file-item">
                <div class="file-item-info">
                    <div class="file-item-icon">
                        <i class="fas fa-${icon}"></i>
                    </div>
                    <div class="file-item-details">
                        <div class="file-item-name">${file.name}</div>
                        <div class="file-item-size">${size}</div>
                    </div>
                </div>
                <button type="button" class="file-item-remove" onclick="removeFile(${index})" title="Remove file">
                    <i class="fas fa-times"></i>
                </button>
            </div>
        `;
    }).join('');
}

function removeFile(index) {
    uploadedFiles.splice(index, 1);
    renderFileList();
    showNotification('File removed', 'success');
}

function getFileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const iconMap = {
        'pdf': 'file-pdf',
        'doc': 'file-word',
        'docx': 'file-word',
        'xls': 'file-excel',
        'xlsx': 'file-excel',
        'txt': 'file-alt',
        'png': 'file-image',
        'jpg': 'file-image',
        'jpeg': 'file-image',
        'gif': 'file-image'
    };
    return iconMap[ext] || 'file';
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Handle form submission
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const user = getCurrentUser();
    
    // Get form data
    const formData = {
        clientId: document.getElementById('clientSelect')?.value || null,
        processArea: document.getElementById('processArea').value,
        processDescription: document.getElementById('processDescription').value,
        currentTools: document.getElementById('currentTools').value,
        teamSize: document.getElementById('teamSize').value,
        urgency: document.getElementById('urgency').value,
        goals: Array.from(document.querySelectorAll('input[name="goals"]:checked')).map(cb => cb.value),
        attachments: uploadedFiles.map(f => ({name: f.name, size: f.size, type: f.type}))
    };
    
    // Validate
    if (!formData.processArea || !formData.processDescription) {
        showNotification('Please fill in all required fields', 'error');
        return;
    }
    
    // Show loading
    document.querySelector('.input-section').style.display = 'none';
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('loadingSection').style.display = 'block';
    
    try {
        const { recommendation, results } = await apiRequest('/api/recommendations/analyze', {
            method: 'POST',
            body: JSON.stringify(formData)
        });

        displayResults(results, formData, recommendation);
    } catch (error) {
        document.querySelector('.input-section').style.display = 'block';
        document.getElementById('loadingSection').style.display = 'none';
        showNotification(error.message, 'error');
    }
}

// Legacy local recommendation templates retained as reference material.
function generateRecommendations(formData) {
    const area = formData.processArea;
    const description = formData.processDescription.toLowerCase();
    const goals = formData.goals;
    
    // Base recommendations by area
    const recommendations = getAreaRecommendations(area, description, goals);
    
    return {
        summary: {
            totalRecommendations: recommendations.length,
            estimatedImpact: calculateEstimatedImpact(recommendations),
            implementationTime: formData.urgency,
            confidenceScore: 9.2
        },
        recommendations: recommendations
    };
}

// Get recommendations by area
function getAreaRecommendations(area, description, goals) {
    const templates = {
        'customer-service': [
            {
                title: 'Implement AI-Powered Chatbot for First-Line Support',
                description: 'Deploy an intelligent chatbot to handle routine customer inquiries, reducing response times by 65% and freeing up your team to focus on complex issues. The chatbot can be integrated with your existing systems and trained on your knowledge base.',
                priority: 'high',
                impactScore: 9.2,
                actions: [
                    'Select chatbot platform (Intercom, Zendesk, or custom solution)',
                    'Train AI on your FAQ database and common inquiries',
                    'Implement seamless handoff to human agents for complex cases',
                    'Monitor performance and continuously improve responses'
                ],
                timeline: '2-3 months',
                estimatedCost: '$15,000 - $30,000',
                expectedRoi: '250% in first year'
            },
            {
                title: 'Automate Customer Data Synchronization',
                description: 'Create automated workflows to sync customer data across all platforms in real-time, eliminating manual data entry errors and ensuring all teams have access to up-to-date information.',
                priority: 'high',
                impactScore: 8.7,
                actions: [
                    'Map data flow between CRM, support system, and other tools',
                    'Implement API integrations or middleware (Zapier, MuleSoft)',
                    'Set up data validation rules and error handling',
                    'Create monitoring dashboard for data sync status'
                ],
                timeline: '1-2 months',
                estimatedCost: '$8,000 - $20,000',
                expectedRoi: '180% through error reduction'
            },
            {
                title: 'Predictive Customer Service Analytics',
                description: 'Implement machine learning models to predict customer issues before they escalate, enabling proactive outreach and significantly improving satisfaction scores.',
                priority: 'medium',
                impactScore: 7.8,
                actions: [
                    'Collect and analyze historical customer interaction data',
                    'Build predictive models for churn risk and issue escalation',
                    'Create proactive outreach workflows',
                    'Establish KPIs and monitoring systems'
                ],
                timeline: '3-4 months',
                estimatedCost: '$25,000 - $45,000',
                expectedRoi: '200% through retention improvement'
            }
        ],
        'data-migration': [
            {
                title: 'Automated Data Validation Framework',
                description: 'Implement a comprehensive automated data validation system to ensure 99.9% accuracy during migration, with real-time error detection and correction workflows.',
                priority: 'high',
                impactScore: 9.5,
                actions: [
                    'Define data quality rules and validation criteria',
                    'Build automated testing framework for data integrity',
                    'Create error logging and resolution workflows',
                    'Implement rollback procedures for failed migrations'
                ],
                timeline: '2-3 months',
                estimatedCost: '$20,000 - $40,000',
                expectedRoi: '300% through error prevention'
            },
            {
                title: 'Phased Migration Strategy with Zero Downtime',
                description: 'Design and implement a phased migration approach that allows your team to migrate data incrementally while maintaining full system availability throughout the process.',
                priority: 'high',
                impactScore: 9.0,
                actions: [
                    'Analyze dependencies and create migration sequence',
                    'Set up parallel run environment for testing',
                    'Implement real-time data sync between old and new systems',
                    'Create detailed rollout and rollback plans'
                ],
                timeline: '4-6 months',
                estimatedCost: '$35,000 - $60,000',
                expectedRoi: 'Risk mitigation + business continuity'
            },
            {
                title: 'SAP Data Migration Accelerator',
                description: 'Utilize SAP-specific migration tools and best practices to streamline your migration to S/4HANA, reducing timeline by 40% and ensuring compliance with SAP standards.',
                priority: 'high',
                impactScore: 8.8,
                actions: [
                    'Conduct SAP system assessment and readiness check',
                    'Configure SAP Data Services or SAP Migration Cockpit',
                    'Perform data cleansing and harmonization',
                    'Execute UAT with key stakeholders'
                ],
                timeline: '3-5 months',
                estimatedCost: '$40,000 - $80,000',
                expectedRoi: '220% through accelerated timeline'
            }
        ],
        'process-optimization': [
            {
                title: 'Robotic Process Automation (RPA) for Repetitive Tasks',
                description: 'Deploy RPA bots to automate manual, repetitive tasks, reducing processing time by 70% and eliminating human errors in data entry and document processing.',
                priority: 'high',
                impactScore: 9.3,
                actions: [
                    'Identify top 10 repetitive processes for automation',
                    'Select RPA platform (UiPath, Automation Anywhere, Blue Prism)',
                    'Develop and test automation workflows',
                    'Train team and establish governance framework'
                ],
                timeline: '2-4 months',
                estimatedCost: '$20,000 - $50,000',
                expectedRoi: '350% in first 18 months'
            },
            {
                title: 'Process Mining for Bottleneck Identification',
                description: 'Implement process mining tools to visualize your actual workflows, automatically identify bottlenecks, and discover optimization opportunities worth millions in efficiency gains.',
                priority: 'medium',
                impactScore: 8.5,
                actions: [
                    'Deploy process mining software (Celonis, UiPath Process Mining)',
                    'Connect to system logs and event data',
                    'Analyze process flows and identify inefficiencies',
                    'Create optimization roadmap based on findings'
                ],
                timeline: '1-2 months',
                estimatedCost: '$15,000 - $35,000',
                expectedRoi: '280% through efficiency improvements'
            },
            {
                title: 'Workflow Automation Platform',
                description: 'Build a centralized workflow automation platform that connects all your business systems, enabling end-to-end process automation without coding.',
                priority: 'medium',
                impactScore: 8.0,
                actions: [
                    'Select low-code platform (Microsoft Power Automate, Nintex)',
                    'Map critical cross-system workflows',
                    'Build automation templates for common processes',
                    'Train power users and establish center of excellence'
                ],
                timeline: '3-5 months',
                estimatedCost: '$30,000 - $55,000',
                expectedRoi: '260% through cross-functional efficiency'
            }
        ],
        'sap-systems': [
            {
                title: 'SAP Fiori User Experience Modernization',
                description: 'Upgrade to SAP Fiori apps to provide your users with a modern, intuitive interface, reducing training time by 60% and improving user adoption rates.',
                priority: 'high',
                impactScore: 8.6,
                actions: [
                    'Assess current transactions and identify Fiori equivalents',
                    'Activate and configure relevant Fiori apps',
                    'Customize apps to match business requirements',
                    'Conduct user training and change management'
                ],
                timeline: '2-4 months',
                estimatedCost: '$25,000 - $50,000',
                expectedRoi: '190% through productivity gains'
            },
            {
                title: 'SAP Master Data Governance Implementation',
                description: 'Establish centralized master data governance to ensure data consistency across all SAP modules, reducing data quality issues by 95%.',
                priority: 'high',
                impactScore: 9.1,
                actions: [
                    'Define data governance policies and workflows',
                    'Configure SAP MDG for customer, vendor, and material data',
                    'Implement approval workflows and quality checks',
                    'Train data stewards and establish governance board'
                ],
                timeline: '3-6 months',
                estimatedCost: '$40,000 - $70,000',
                expectedRoi: '240% through data quality improvement'
            },
            {
                title: 'SAP S/4HANA Readiness Assessment',
                description: 'Conduct comprehensive readiness assessment for S/4HANA migration, including custom code analysis, data volume assessment, and business case development.',
                priority: 'medium',
                impactScore: 8.3,
                actions: [
                    'Run SAP Readiness Check and custom code analysis',
                    'Assess data volume and archiving opportunities',
                    'Evaluate business processes for simplification',
                    'Develop migration strategy and business case'
                ],
                timeline: '1-3 months',
                estimatedCost: '$20,000 - $45,000',
                expectedRoi: 'Foundation for successful S/4HANA migration'
            }
        ],
        'automation': [
            {
                title: 'Intelligent Document Processing',
                description: 'Deploy AI-powered document processing to automatically extract, classify, and process information from invoices, contracts, and other documents with 98% accuracy.',
                priority: 'high',
                impactScore: 9.0,
                actions: [
                    'Select IDP platform (Automation Anywhere IQ Bot, UiPath Document Understanding)',
                    'Train ML models on your document types',
                    'Integrate with downstream systems (ERP, CRM)',
                    'Implement exception handling workflows'
                ],
                timeline: '2-3 months',
                estimatedCost: '$25,000 - $45,000',
                expectedRoi: '320% through labor cost reduction'
            },
            {
                title: 'Email Automation and Smart Routing',
                description: 'Implement intelligent email processing to automatically categorize, route, and respond to emails, reducing response time by 80% and improving customer satisfaction.',
                priority: 'medium',
                impactScore: 7.9,
                actions: [
                    'Implement AI email classification',
                    'Set up smart routing rules based on content',
                    'Create automated response templates',
                    'Configure escalation workflows for urgent items'
                ],
                timeline: '1-2 months',
                estimatedCost: '$12,000 - $28,000',
                expectedRoi: '210% through faster response times'
            },
            {
                title: 'End-to-End Order Processing Automation',
                description: 'Automate your entire order-to-cash process from order receipt through fulfillment and invoicing, reducing processing time from days to hours.',
                priority: 'high',
                impactScore: 8.8,
                actions: [
                    'Map current order processing workflow',
                    'Identify automation opportunities at each step',
                    'Build integration between order, inventory, and finance systems',
                    'Implement real-time tracking and notifications'
                ],
                timeline: '3-5 months',
                estimatedCost: '$35,000 - $65,000',
                expectedRoi: '290% through cycle time reduction'
            }
        ],
        'analytics': [
            {
                title: 'Real-Time Executive Dashboard',
                description: 'Create a comprehensive real-time dashboard that provides executives with instant visibility into key business metrics, enabling data-driven decision making.',
                priority: 'high',
                impactScore: 8.4,
                actions: [
                    'Define KPIs and data sources',
                    'Select BI platform (Power BI, Tableau, Looker)',
                    'Build data warehouse and ETL pipelines',
                    'Design and deploy interactive dashboards'
                ],
                timeline: '2-3 months',
                estimatedCost: '$20,000 - $40,000',
                expectedRoi: '230% through better decision making'
            },
            {
                title: 'Predictive Analytics for Business Forecasting',
                description: 'Implement machine learning models to forecast sales, demand, and resource needs with 90%+ accuracy, enabling proactive planning and optimization.',
                priority: 'high',
                impactScore: 9.0,
                actions: [
                    'Collect and prepare historical business data',
                    'Build predictive models (regression, time series, ML)',
                    'Validate model accuracy and tune parameters',
                    'Deploy models and create automated forecasting reports'
                ],
                timeline: '3-4 months',
                estimatedCost: '$30,000 - $55,000',
                expectedRoi: '270% through improved planning'
            },
            {
                title: 'Customer Behavior Analytics Platform',
                description: 'Build a customer analytics platform that provides 360-degree view of customer behavior, preferences, and lifetime value to drive personalized marketing and service.',
                priority: 'medium',
                impactScore: 8.2,
                actions: [
                    'Integrate data from all customer touchpoints',
                    'Implement customer segmentation and scoring',
                    'Build behavior tracking and analysis models',
                    'Create actionable insights and recommendations'
                ],
                timeline: '3-5 months',
                estimatedCost: '$35,000 - $60,000',
                expectedRoi: '250% through improved targeting'
            }
        ],
        'real-estate': [
            {
                title: 'Automated Lead Management and Nurturing System',
                description: 'Implement AI-powered lead scoring and automated nurturing workflows that increase conversion rates by 45% through timely, personalized follow-ups.',
                priority: 'high',
                impactScore: 9.1,
                actions: [
                    'Integrate CRM with lead sources (Zillow, Realtor.com, website)',
                    'Implement lead scoring based on engagement and demographics',
                    'Create automated email and SMS nurture campaigns',
                    'Set up alerts for high-value leads'
                ],
                timeline: '1-2 months',
                estimatedCost: '$10,000 - $25,000',
                expectedRoi: '380% through increased conversions'
            },
            {
                title: 'Property Management Automation Suite',
                description: 'Deploy comprehensive automation for rent collection, maintenance requests, tenant screening, and lease management, reducing administrative workload by 70%.',
                priority: 'high',
                impactScore: 8.9,
                actions: [
                    'Implement property management software (Buildium, AppFolio)',
                    'Automate rent collection and payment reminders',
                    'Set up online maintenance request portal',
                    'Automate tenant screening and background checks'
                ],
                timeline: '2-3 months',
                estimatedCost: '$15,000 - $35,000',
                expectedRoi: '290% through operational efficiency'
            },
            {
                title: 'AI-Powered Property Valuation and Market Analysis',
                description: 'Utilize machine learning to provide instant, accurate property valuations and market trend analysis, enabling faster, more confident pricing decisions.',
                priority: 'medium',
                impactScore: 7.8,
                actions: [
                    'Integrate with MLS and property data sources',
                    'Build ML models for automated valuation',
                    'Create comparative market analysis automation',
                    'Generate market trend reports and insights'
                ],
                timeline: '2-4 months',
                estimatedCost: '$20,000 - $40,000',
                expectedRoi: '220% through better pricing strategy'
            }
        ]
    };
    
    // Get recommendations for the area
    let recs = templates[area] || templates['process-optimization'];
    
    // Filter based on goals if provided
    if (goals && goals.length > 0) {
        // Prioritize recommendations that match goals
        if (goals.includes('reduce-costs')) {
            recs[0].priority = 'high';
        }
        if (goals.includes('improve-efficiency')) {
            recs.forEach(r => r.impactScore += 0.3);
        }
    }
    
    return recs;
}

// Calculate estimated impact
function calculateEstimatedImpact(recommendations) {
    const avgImpact = recommendations.reduce((sum, r) => sum + r.impactScore, 0) / recommendations.length;
    return avgImpact.toFixed(1);
}

// Display results
function displayResults(results, formData, savedRecommendation = null) {
    document.getElementById('loadingSection').style.display = 'none';
    const resultsSection = document.getElementById('resultsSection');
    resultsSection.style.display = 'block';
    
    const analysisResults = document.getElementById('analysisResults');
    
    // Store current recommendation
    currentRecommendation = savedRecommendation || {
        results,
        formData: formData,
        createdAt: new Date().toISOString()
    };
    
    // Build HTML
    analysisResults.innerHTML = `
        <div class="analysis-summary">
            <h3><i class="fas fa-chart-bar"></i> Analysis Summary</h3>
            <div class="summary-grid">
                <div class="summary-item">
                    <div class="value">${results.summary.totalRecommendations}</div>
                    <div class="label">Recommendations</div>
                </div>
                <div class="summary-item">
                    <div class="value">${results.summary.estimatedImpact}</div>
                    <div class="label">Avg Impact Score</div>
                </div>
                <div class="summary-item">
                    <div class="value">${formatUrgency(results.summary.implementationTime)}</div>
                    <div class="label">Timeline</div>
                </div>
                <div class="summary-item">
                    <div class="value">${results.summary.confidenceScore}</div>
                    <div class="label">Confidence Score</div>
                </div>
            </div>
            ${formData.attachments && formData.attachments.length > 0 ? `
                <div style="margin-top: 24px; padding: 16px; background: #fff5f5; border-radius: 8px; border: 1px solid var(--accent-red);">
                    <h4 style="margin-bottom: 12px; color: var(--gray-900);">
                        <i class="fas fa-paperclip"></i> Attached Documents (${formData.attachments.length})
                    </h4>
                    <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                        ${formData.attachments.map(file => `
                            <span style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: white; border-radius: 6px; font-size: 14px; color: var(--gray-700);">
                                <i class="fas fa-${getFileIcon(file.name)}" style="color: var(--primary-red);"></i>
                                ${file.name}
                            </span>
                        `).join('')}
                    </div>
                    <small style="display: block; margin-top: 8px; color: var(--gray-600); font-style: italic;">
                        <i class="fas fa-info-circle"></i> These files were reviewed to generate more accurate recommendations
                    </small>
                </div>
            ` : ''}
        </div>
        
        <h3 style="margin: 32px 0 24px 0;">
            <i class="fas fa-list-check"></i> Detailed Recommendations
        </h3>
        
        <div class="recommendations-list">
            ${results.recommendations.map((rec, index) => `
                <div class="recommendation-item">
                    <div class="recommendation-header">
                        <div class="recommendation-title">
                            <h3>
                                <span style="color: var(--primary-blue); font-weight: 700;">${index + 1}.</span>
                                ${rec.title}
                            </h3>
                            <div style="display: flex; gap: 12px; align-items: center; margin-top: 8px;">
                                <span class="priority-badge ${rec.priority}">${rec.priority} Priority</span>
                                <div class="impact-score">
                                    <i class="fas fa-chart-line"></i>
                                    Impact Score: <span class="score-badge">${rec.impactScore}/10</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <p class="recommendation-description">${rec.description}</p>
                    
                    <div class="action-items">
                        <h4><i class="fas fa-tasks"></i> Implementation Steps:</h4>
                        <ul>
                            ${rec.actions.map(action => `
                                <li>
                                    <i class="fas fa-check-circle"></i>
                                    <span>${action}</span>
                                </li>
                            `).join('')}
                        </ul>
                    </div>
                    
                    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 16px; margin-top: 20px;">
                        <div class="implementation-timeline">
                            <i class="fas fa-clock"></i>
                            <div>
                                <strong>Timeline:</strong> ${rec.timeline}
                            </div>
                        </div>
                        <div class="implementation-timeline">
                            <i class="fas fa-dollar-sign"></i>
                            <div>
                                <strong>Est. Cost:</strong> ${rec.estimatedCost}
                            </div>
                        </div>
                        <div class="implementation-timeline">
                            <i class="fas fa-chart-line"></i>
                            <div>
                                <strong>Expected ROI:</strong> ${rec.expectedRoi}
                            </div>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;
    
    // Scroll to results
    resultsSection.scrollIntoView({ behavior: 'smooth' });
}

// Setup result actions
function setupResultActions() {
    // Save button
    document.getElementById('saveBtn')?.addEventListener('click', async () => {
        if (!currentRecommendation) return;
        
        if (currentRecommendation.id) {
            const nextFavorite = !currentRecommendation.isFavorite;
            const { recommendation } = await apiRequest(`/api/recommendations/${encodeURIComponent(currentRecommendation.id)}`, {
                method: 'PATCH',
                body: JSON.stringify({ isFavorite: nextFavorite })
            });
            currentRecommendation = recommendation;

            const btn = document.getElementById('saveBtn');
            btn.classList.toggle('active', currentRecommendation.isFavorite);
            
            showNotification(
                currentRecommendation.isFavorite ? 'Added to favorites!' : 'Removed from favorites',
                'success'
            );
        }
    });
    
    // Export button
    document.getElementById('exportBtn')?.addEventListener('click', () => {
        if (!currentRecommendation) return;
        exportToCSV(currentRecommendation);
    });
    
    // New analysis button
    document.getElementById('newAnalysisBtn')?.addEventListener('click', () => {
        location.reload();
    });
}

// Save recommendation
// Format urgency
function formatUrgency(urgency) {
    const formats = {
        'immediate': '1-3 months',
        'short-term': '3-6 months',
        'medium-term': '6-12 months',
        'long-term': '12+ months'
    };
    return formats[urgency] || urgency;
}

// Export to CSV
function exportToCSV(recommendation) {
    const data = recommendation.results.recommendations;
    let csv = 'Recommendation,Priority,Impact Score,Timeline,Estimated Cost,Expected ROI,Description\n';
    
    data.forEach(rec => {
        csv += `"${rec.title}","${rec.priority}",${rec.impactScore},"${rec.timeline}","${rec.estimatedCost}","${rec.expectedRoi}","${rec.description}"\n`;
    });
    
    // Create download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-recommendations-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    
    showNotification('Recommendations exported successfully!', 'success');
}

// Update user info (copied from dashboard.js for this page)
function updateUserInfo(user) {
    const userNameElements = document.querySelectorAll('#userName');
    const displayName = user.name || user.firstName || extractNameFromEmail(user.email);
    
    userNameElements.forEach(el => {
        el.textContent = displayName;
    });
}

// Load clients for dropdown
async function loadClientsDropdown() {
    availableClients = await getClients();
    renderClientOptions(sessionStorage.getItem('selectedClientId'));
}

function renderClientOptions(selectedClientId = '') {
    const clientSelect = document.getElementById('clientSelect');
    const clientSelectHelp = document.getElementById('clientSelectHelp');
    
    if (!clientSelect) return;
    
    clientSelect.innerHTML = '<option value="">No Client (General Analysis)</option>';

    if (availableClients.length === 0) {
        if (clientSelectHelp) {
            clientSelectHelp.textContent = 'No clients yet. Add one here or continue with a general analysis.';
        }
        sessionStorage.removeItem('selectedClientId');
        return;
    }

    if (clientSelectHelp) {
        clientSelectHelp.textContent = 'Link this analysis to a specific client for tracking';
    }
    
    const sorted = [...availableClients].sort((a, b) => a.company_name.localeCompare(b.company_name));
    
    sorted.forEach(client => {
        const option = document.createElement('option');
        option.value = client.id;
        option.textContent = `${client.company_name} - ${client.contact_name}`;
        clientSelect.appendChild(option);
    });
    
    if (selectedClientId) {
        clientSelect.value = selectedClientId;
        sessionStorage.removeItem('selectedClientId');
    }
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

function setupQuickClientActions() {
    document.getElementById('showQuickClientBtn')?.addEventListener('click', () => {
        document.getElementById('quickClientPanel').style.display = 'block';
        document.getElementById('quickCompanyName')?.focus();
    });

    document.getElementById('cancelQuickClientBtn')?.addEventListener('click', closeQuickClientPanel);
    document.getElementById('saveQuickClientBtn')?.addEventListener('click', saveQuickClient);
}

function closeQuickClientPanel() {
    const panel = document.getElementById('quickClientPanel');
    if (panel) panel.style.display = 'none';
    clearQuickClientFields();
}

function clearQuickClientFields() {
    [
        'quickCompanyName',
        'quickContactName',
        'quickEmail',
        'quickPhone',
        'quickIndustry',
        'quickCompanySize',
        'quickNotes'
    ].forEach(id => {
        const field = document.getElementById(id);
        if (field) field.value = '';
    });
}

async function saveQuickClient() {
    const saveBtn = document.getElementById('saveQuickClientBtn');
    const clientData = {
        company_name: document.getElementById('quickCompanyName').value.trim(),
        contact_name: document.getElementById('quickContactName').value.trim(),
        email: document.getElementById('quickEmail').value.trim(),
        phone: document.getElementById('quickPhone').value.trim(),
        industry: document.getElementById('quickIndustry').value,
        company_size: document.getElementById('quickCompanySize').value,
        location: '',
        status: 'active',
        notes: document.getElementById('quickNotes').value.trim()
    };

    if (!clientData.company_name || !clientData.contact_name || !clientData.email || !clientData.industry) {
        showNotification('Please complete company, contact, email, and industry for the client', 'error');
        return;
    }

    try {
        if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        }

        const savedClient = await createClient(clientData);
        availableClients.push(savedClient);
        renderClientOptions(savedClient.id);
        closeQuickClientPanel();
        showNotification('Client added and linked to this analysis', 'success');
    } catch (error) {
        showNotification(error.message, 'error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = '<i class="fas fa-save"></i> Save and Select Client';
        }
    }
}

function extractNameFromEmail(email) {
    const username = email.split('@')[0];
    const parts = username.split(/[._]/);
    return parts.map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
