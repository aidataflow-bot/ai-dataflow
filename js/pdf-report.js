// ===== Client-ready PDF report =====
// Builds a branded PDF from a saved analysis using the vendored jsPDF library
// (js/vendor/jspdf.umd.min.js). Everything happens in the browser; nothing is uploaded.
(function (root) {
    const RED = [230, 57, 70];
    const INK = [26, 26, 26];
    const MUTED = [107, 114, 128];
    const LINE = [229, 231, 235];
    const PANEL = [249, 250, 251];
    const PRIORITY_COLORS = {
        high: [220, 38, 38],
        medium: [217, 119, 6],
        low: [22, 163, 74]
    };

    // images/logo-horizontal.png is 803 x 240 px.
    const LOGO_PATH = 'images/logo-horizontal.png';
    const LOGO_RATIO = 803 / 240;

    const AREAS = {
        'customer-service': 'Customer Service Operations',
        'data-migration': 'Data Migration & Integration',
        'process-optimization': 'Process Optimization',
        'sap-systems': 'SAP Systems',
        'automation': 'Business Process Automation',
        'analytics': 'Data Analytics & BI',
        'real-estate': 'Real Estate & Property Management',
        'other': 'General Process Analysis'
    };
    const GOALS = {
        'reduce-costs': 'Reduce Costs',
        'improve-efficiency': 'Improve Efficiency',
        'enhance-quality': 'Enhance Quality',
        'scale-operations': 'Scale Operations',
        'improve-accuracy': 'Improve Data Accuracy',
        'customer-satisfaction': 'Customer Satisfaction'
    };
    const TIMELINES = {
        'immediate': '1-3 months',
        'short-term': '3-6 months',
        'medium-term': '6-12 months',
        'long-term': '12+ months'
    };
    const INDUSTRIES = {
        'technology': 'Technology',
        'manufacturing': 'Manufacturing',
        'healthcare': 'Healthcare',
        'finance': 'Finance',
        'retail': 'Retail',
        'real-estate': 'Real Estate',
        'other': 'Other'
    };

    // jsPDF's built-in fonts only cover Latin-1, so normalise typographic characters
    // and drop anything the font cannot draw rather than printing garbage.
    function clean(value) {
        return String(value == null ? '' : value)
            .replace(/[‘’‚]/g, "'")
            .replace(/[“”„]/g, '"')
            .replace(/[‐-―−]/g, '-')
            .replace(/•/g, '-')
            .replace(/…/g, '...')
            .replace(/→/g, '->')
            .replace(/€/g, 'EUR ')
            .replace(/[   ]/g, ' ')
            .replace(/[^\n\x20-\x7E¡-ÿ]/g, '')
            .replace(/ {2,}/g, ' ');
    }

    function slug(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .slice(0, 40) || 'General';
    }

    function formatDate(iso) {
        const date = iso ? new Date(iso) : new Date();
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    }

    // Plain-language summary used when an analysis has no AI-written executive summary
    // (analyses created before that field existed). Built only from stored facts.
    function fallbackSummary(rec, client, recommendations) {
        const area = (AREAS[rec.processArea] || rec.processArea || 'the process').toLowerCase();
        const count = recommendations.length;
        const high = recommendations.filter(item => String(item.priority || '').toLowerCase() === 'high').length;
        const top = recommendations.reduce((best, item) => (
            !best || Number(item.impactScore) > Number(best.impactScore) ? item : best
        ), null);
        const average = rec.results && rec.results.summary && rec.results.summary.estimatedImpact;

        const parts = [];
        parts.push(client
            ? `${client.company_name} asked for a review of ${area}.`
            : `This report reviews ${area}.`);
        parts.push(`It sets out ${count} prioritized recommendation${count === 1 ? '' : 's'}${high ? `, ${high} of them high priority` : ''}${average ? `, with an average impact score of ${average}/10` : ''}.`);
        if (top && top.title) {
            parts.push(`The highest-impact opportunity is "${top.title}" (impact ${top.impactScore != null ? top.impactScore : '-'}/10${top.timeline ? `, about ${top.timeline}` : ''}).`);
        }
        return parts.join(' ');
    }

    function buildReportPdf(JsPDF, rec, client, preparedBy, assets) {
        const results = rec.results || {};
        const summary = results.summary || {};
        const recommendations = Array.isArray(results.recommendations) ? results.recommendations : [];
        const logo = assets && assets.logo;

        const doc = new JsPDF({ unit: 'pt', format: 'letter' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const M = 54;
        const CW = pageW - M * 2;
        const FOOTER = 54;
        let y = 0;

        function newPage() {
            doc.addPage();
            y = M;
        }

        function ensure(height) {
            if (y + height > pageH - FOOTER) newPage();
        }

        function setText(size, bold, color) {
            doc.setFont('helvetica', bold ? 'bold' : 'normal');
            doc.setFontSize(size);
            doc.setTextColor(color[0], color[1], color[2]);
        }

        // Writes wrapped text starting at y, breaking across pages as needed.
        function paragraph(str, opts = {}) {
            const size = opts.size || 10.5;
            const x = opts.x == null ? M : opts.x;
            const width = opts.width || CW;
            const step = size * (opts.lineHeight || 1.4);
            setText(size, opts.bold, opts.color || INK);
            const lines = doc.splitTextToSize(clean(str), width);
            lines.forEach(line => {
                ensure(step);
                setText(size, opts.bold, opts.color || INK);
                doc.text(line, x, y + size);
                y += step;
            });
            y += opts.gap || 0;
        }

        function heading(label, minBelow) {
            ensure(48 + (minBelow || 0));
            setText(13, true, INK);
            doc.text(clean(label), M, y + 13);
            y += 20;
            doc.setDrawColor(RED[0], RED[1], RED[2]);
            doc.setLineWidth(2);
            doc.line(M, y, M + 28, y);
            y += 14;
        }

        // ----- Letterhead (first page) -----
        doc.setFillColor(RED[0], RED[1], RED[2]);
        doc.rect(0, 0, pageW, 6, 'F');

        const LOGO_H = 36;
        let logoDrawn = false;
        if (logo) {
            try {
                doc.addImage(logo, 'PNG', M, 22, LOGO_H * LOGO_RATIO, LOGO_H);
                logoDrawn = true;
            } catch (error) {
                logoDrawn = false;
            }
        }
        if (!logoDrawn) {
            setText(22, true, RED);
            doc.text('AI.Data', M, 50);
            const redWidth = doc.getTextWidth('AI.Data');
            setText(22, true, INK);
            doc.text('Flow', M + redWidth, 50);
        }
        setText(10, true, INK);
        doc.text('Process Optimization Report', pageW - M, 40, { align: 'right' });
        setText(9, false, MUTED);
        doc.text(clean(formatDate(rec.createdAt)), pageW - M, 54, { align: 'right' });
        doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
        doc.setLineWidth(0.75);
        doc.line(M, 72, pageW - M, 72);
        y = 72 + 30;

        // ----- Title block -----
        setText(8.5, true, MUTED);
        doc.text('PREPARED FOR', M, y + 8);
        y += 18;
        paragraph(client ? client.company_name : 'General Process Analysis', { size: 24, bold: true, lineHeight: 1.2, gap: 4 });

        const subtitle = [];
        if (client && client.contact_name) subtitle.push(`Attn: ${client.contact_name}`);
        if (client && client.industry) subtitle.push(INDUSTRIES[client.industry] || client.industry);
        if (client && client.location) subtitle.push(client.location);
        if (subtitle.length) paragraph(subtitle.join('  |  '), { size: 10.5, color: MUTED, gap: 2 });
        paragraph(`Focus area: ${AREAS[rec.processArea] || rec.processArea || 'General'}`, { size: 10.5, color: MUTED, gap: 20 });

        // ----- Executive summary -----
        heading('Executive summary');
        const executiveSummary = String(summary.executiveSummary || '').trim() || fallbackSummary(rec, client, recommendations);
        paragraph(executiveSummary, { size: 10.5, lineHeight: 1.5, gap: 16 });

        // ----- Summary tiles -----
        const tileGap = 12;
        const tileW = (CW - tileGap * 2) / 3;
        const tileH = 58;
        ensure(tileH + 20);
        const tiles = [
            { value: String(recommendations.length), label: 'Recommendations' },
            { value: `${summary.estimatedImpact || '-'}/10`, label: 'Average impact score' },
            { value: TIMELINES[summary.implementationTime] || summary.implementationTime || TIMELINES[rec.urgency] || rec.urgency || '-', label: 'Target timeline' }
        ];
        tiles.forEach((tile, index) => {
            const x = M + index * (tileW + tileGap);
            doc.setFillColor(PANEL[0], PANEL[1], PANEL[2]);
            doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
            doc.setLineWidth(0.75);
            doc.roundedRect(x, y, tileW, tileH, 6, 6, 'FD');
            setText(19, true, RED);
            doc.text(clean(tile.value), x + 14, y + 29);
            setText(8.5, false, MUTED);
            doc.text(clean(tile.label), x + 14, y + 46);
        });
        y += tileH + 24;

        // ----- Client profile + scope panels -----
        const PANEL_IN = 14;
        const ROW_LABEL = 7.5;
        const ROW_VALUE = 9.5;

        function measureRows(rows, width) {
            setText(ROW_VALUE, false, INK);
            return rows.map(([label, value]) => {
                const lines = doc.splitTextToSize(clean(value), width);
                return { label, lines, height: ROW_LABEL + 5 + lines.length * 12.5 + 7 };
            });
        }

        function rowsHeight(measured) {
            return measured.reduce((sum, row) => sum + row.height, 0);
        }

        function drawPanel(title, measured, x, top, width, height) {
            doc.setFillColor(PANEL[0], PANEL[1], PANEL[2]);
            doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
            doc.setLineWidth(0.75);
            doc.roundedRect(x, top, width, height, 6, 6, 'FD');
            setText(8.5, true, RED);
            doc.text(title, x + PANEL_IN, top + 20);
            let rowY = top + 32;
            measured.forEach(row => {
                setText(ROW_LABEL, true, MUTED);
                doc.text(clean(row.label).toUpperCase(), x + PANEL_IN, rowY + ROW_LABEL);
                setText(ROW_VALUE, false, INK);
                row.lines.forEach((line, i) => doc.text(line, x + PANEL_IN, rowY + ROW_LABEL + 5 + 9.5 + i * 12.5 - 2));
                rowY += row.height;
            });
        }

        const profileRows = [];
        if (client) {
            profileRows.push(['Company', client.company_name]);
            const business = [
                INDUSTRIES[client.industry] || client.industry,
                client.location,
                client.company_size ? `${client.company_size} employees` : ''
            ].filter(Boolean).join('  |  ');
            if (business) profileRows.push(['Business', business]);
            if (client.contact_name) profileRows.push(['Primary contact', client.contact_name]);
            if (client.email) profileRows.push(['Email', client.email]);
            if (client.phone) profileRows.push(['Phone', client.phone]);
        }

        const scopeRows = [['Focus area', AREAS[rec.processArea] || rec.processArea || 'General']];
        if (rec.urgency) scopeRows.push(['Implementation window', TIMELINES[rec.urgency] || rec.urgency]);
        if (rec.teamSize) scopeRows.push(['Team size', rec.teamSize]);
        if (rec.currentTools) scopeRows.push(['Current tools', rec.currentTools]);
        if (Array.isArray(rec.goals) && rec.goals.length) {
            scopeRows.push(['Primary goals', rec.goals.map(goal => GOALS[goal] || goal).join(', ')]);
        }

        if (profileRows.length) {
            const panelGap = 14;
            const panelW = (CW - panelGap) / 2;
            const inner = panelW - PANEL_IN * 2;
            const left = measureRows(profileRows, inner);
            const right = measureRows(scopeRows, inner);
            const panelH = 32 + Math.max(rowsHeight(left), rowsHeight(right)) + 4;
            ensure(panelH + 20);
            drawPanel('CLIENT PROFILE', left, M, y, panelW, panelH);
            drawPanel('SCOPE OF THIS ANALYSIS', right, M + panelW + panelGap, y, panelW, panelH);
            y += panelH + 22;
        } else {
            const measured = measureRows(scopeRows, CW - PANEL_IN * 2);
            const panelH = 32 + rowsHeight(measured) + 4;
            ensure(panelH + 20);
            drawPanel('SCOPE OF THIS ANALYSIS', measured, M, y, CW, panelH);
            y += panelH + 22;
        }

        // ----- Situation as described -----
        const description = String(rec.description || '').trim();
        if (description) {
            heading('Challenge as described', 40);
            paragraph(description, { gap: 12 });
        }

        // ----- Recommendations at a glance -----
        if (recommendations.length) {
            const colX = { num: M, title: M + 24, priority: M + 24 + 206, impact: M + 24 + 206 + 56, timeline: M + 24 + 206 + 56 + 44, cost: M + 24 + 206 + 56 + 44 + 70 };
            const titleW = 206 - 10;
            const timelineW = 70 - 8;
            const costW = pageW - M - colX.cost;
            const headerH = 24;

            const glanceRows = recommendations.map((item, index) => {
                setText(9, true, INK);
                const titleLines = doc.splitTextToSize(clean(item.title || 'Untitled recommendation'), titleW);
                setText(8.5, false, INK);
                const timelineLines = doc.splitTextToSize(clean(item.timeline || '-'), timelineW);
                const costLines = doc.splitTextToSize(clean(item.estimatedCost || '-'), costW);
                const lines = Math.max(titleLines.length, timelineLines.length, costLines.length);
                return { item, index, titleLines, timelineLines, costLines, height: lines * 11.5 + 14 };
            });

            function drawGlanceHeader() {
                doc.setFillColor(PANEL[0], PANEL[1], PANEL[2]);
                doc.rect(M, y, CW, headerH, 'F');
                setText(7.5, true, MUTED);
                doc.text('#', colX.num + 6, y + 15);
                doc.text('RECOMMENDATION', colX.title, y + 15);
                doc.text('PRIORITY', colX.priority, y + 15);
                doc.text('IMPACT', colX.impact, y + 15);
                doc.text('TIMELINE', colX.timeline, y + 15);
                doc.text('ESTIMATED COST', colX.cost, y + 15);
                y += headerH;
            }

            const firstRowH = glanceRows[0].height;
            heading('Recommendations at a glance', headerH + firstRowH);
            drawGlanceHeader();
            glanceRows.forEach(row => {
                if (y + row.height > pageH - FOOTER) {
                    newPage();
                    drawGlanceHeader();
                }
                const priority = String(row.item.priority || 'medium').toLowerCase();
                const color = PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium;
                setText(9, false, MUTED);
                doc.text(String(row.index + 1), colX.num + 6, y + 15);
                setText(9, true, INK);
                row.titleLines.forEach((line, i) => doc.text(line, colX.title, y + 15 + i * 11.5));
                setText(8, true, color);
                doc.text(priority.toUpperCase(), colX.priority, y + 15);
                setText(9, false, INK);
                doc.text(`${row.item.impactScore != null ? row.item.impactScore : '-'}/10`, colX.impact, y + 15);
                setText(8.5, false, INK);
                row.timelineLines.forEach((line, i) => doc.text(line, colX.timeline, y + 15 + i * 11.5));
                row.costLines.forEach((line, i) => doc.text(line, colX.cost, y + 15 + i * 11.5));
                y += row.height;
                doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
                doc.setLineWidth(0.5);
                doc.line(M, y, pageW - M, y);
            });
            y += 24;
        }

        // ----- Detailed recommendations -----
        const GUTTER = 16;
        const PANEL_PAD = 14;
        const colW = (CW - PANEL_PAD * 2 - GUTTER * 2) / 3;

        function panelLayout(item) {
            const columns = [
                ['TIMELINE', item.timeline],
                ['ESTIMATED COST', item.estimatedCost],
                ['EXPECTED ROI', item.expectedRoi]
            ];
            setText(9.5, false, INK);
            const wrapped = columns.map(([, value]) => doc.splitTextToSize(clean(value || '-'), colW));
            const lineCount = Math.max(...wrapped.map(lines => lines.length));
            return { columns, wrapped, panelH: 14 + 14 + lineCount * 13 + 6 };
        }

        function lineCountFor(str, size, bold, width) {
            setText(size, bold, INK);
            return doc.splitTextToSize(clean(str), width).length;
        }

        // Height of a whole recommendation card, so it can be kept on one page.
        function measureRecommendation(item, index) {
            const actions = Array.isArray(item.actions) ? item.actions.filter(Boolean) : [];
            let height = lineCountFor(`${index + 1}.  ${item.title || 'Untitled recommendation'}`, 12.5, true, CW) * 12.5 * 1.3 + 3;
            height += 18;
            height += lineCountFor(item.description, 10.5, false, CW) * 10.5 * 1.4 + 6;
            if (actions.length) {
                height += 16;
                actions.forEach(action => {
                    height += lineCountFor(action, 10, false, CW - 14) * 10 * 1.35 + 2;
                });
                height += 4;
            }
            height += panelLayout(item).panelH + 4 + 22;
            return height + 4;
        }

        // Keep the section heading with its first recommendation.
        if (recommendations.length) {
            const firstCard = measureRecommendation(recommendations[0], 0);
            ensure(firstCard + 48 <= pageH - FOOTER - M ? firstCard + 48 : 48 + 120);
        }
        heading('Detailed recommendations');

        recommendations.forEach((item, index) => {
            const priority = String(item.priority || 'medium').toLowerCase();
            const color = PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium;

            const needed = measureRecommendation(item, index);
            ensure(needed <= pageH - FOOTER - M ? needed : 120);
            paragraph(`${index + 1}.  ${item.title || 'Untitled recommendation'}`, { size: 12.5, bold: true, lineHeight: 1.3, gap: 3 });

            ensure(14);
            setText(8.5, true, color);
            doc.text(`${priority.toUpperCase()} PRIORITY`, M, y + 8.5);
            const badgeWidth = doc.getTextWidth(`${priority.toUpperCase()} PRIORITY`) + 10;
            setText(8.5, false, MUTED);
            doc.text(`Impact ${item.impactScore != null ? item.impactScore : '-'}/10`, M + badgeWidth, y + 8.5);
            y += 18;

            paragraph(item.description, { gap: 6 });

            const actions = Array.isArray(item.actions) ? item.actions.filter(Boolean) : [];
            if (actions.length) {
                ensure(30);
                setText(9, true, MUTED);
                doc.text('RECOMMENDED ACTIONS', M, y + 9);
                y += 16;
                actions.forEach(action => {
                    const startY = y;
                    paragraph(action, { size: 10, x: M + 14, width: CW - 14, lineHeight: 1.35, gap: 2 });
                    doc.setFillColor(RED[0], RED[1], RED[2]);
                    doc.circle(M + 4, startY + 6, 1.6, 'F');
                });
                y += 4;
            }

            // Timeline / cost / ROI panel
            const { columns, wrapped, panelH } = panelLayout(item);
            ensure(panelH + 4);
            doc.setFillColor(PANEL[0], PANEL[1], PANEL[2]);
            doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
            doc.setLineWidth(0.75);
            doc.roundedRect(M, y, CW, panelH, 6, 6, 'FD');
            columns.forEach(([label], col) => {
                const x = M + PANEL_PAD + col * (colW + GUTTER);
                setText(8, true, MUTED);
                doc.text(label, x, y + 18);
                setText(9.5, false, INK);
                wrapped[col].forEach((line, i) => doc.text(line, x, y + 33 + i * 13));
            });
            y += panelH + 22;
        });

        // ----- Closing note -----
        ensure(48);
        paragraph(
            'Cost and ROI figures are planning estimates based on the information provided. Validate them against your own numbers before committing budget.',
            { size: 9, color: MUTED, lineHeight: 1.4 }
        );

        // ----- Footer on every page -----
        const total = doc.getNumberOfPages();
        for (let page = 1; page <= total; page++) {
            doc.setPage(page);
            doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
            doc.setLineWidth(0.75);
            doc.line(M, pageH - 40, pageW - M, pageH - 40);
            setText(8, false, MUTED);
            const left = preparedBy ? `Prepared by ${clean(preparedBy)}  |  AI.DataFlow` : 'AI.DataFlow';
            doc.text(left, M, pageH - 26);
            doc.text(`Page ${page} of ${total}`, pageW - M, pageH - 26, { align: 'right' });
        }

        return doc;
    }

    // Loads the logo once as a data URL; a failure just means the text wordmark is used.
    let logoPromise = null;
    function loadLogo() {
        if (!logoPromise) {
            logoPromise = (async () => {
                try {
                    const response = await fetch(LOGO_PATH);
                    if (!response.ok) return null;
                    const blob = await response.blob();
                    return await new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                } catch (error) {
                    return null;
                }
            })();
        }
        return logoPromise;
    }

    async function downloadReportPdf(rec, client, preparedBy) {
        const JsPDF = root.jspdf && root.jspdf.jsPDF;
        if (!JsPDF) {
            throw new Error('The PDF library did not load. Refresh the page and try again.');
        }
        const logo = await loadLogo();
        const doc = buildReportPdf(JsPDF, rec, client, preparedBy, { logo });
        const date = new Date().toISOString().split('T')[0];
        doc.save(`AI-DataFlow-Report-${slug(client ? client.company_name : 'General')}-${date}.pdf`);
    }

    const api = { buildReportPdf, downloadReportPdf };
    root.AIDataFlowPdf = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
