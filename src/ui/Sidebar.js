/**
 * Sidebar Manager
 * Modern sidebar with smooth animations
 */

export class Sidebar {
    constructor(app) {
        this.app = app;
        this.activeTab = 'thumbnails';
        this.init();
    }

    init() {
        // Tab switching
        document.getElementById('thumbnailsTab').addEventListener('click', () => {
            this.setActiveTab('thumbnails');
        });

        document.getElementById('annotationsTab').addEventListener('click', () => {
            this.setActiveTab('annotations');
        });

        // Listen for annotation changes
        document.addEventListener('annotationChange', () => {
            this.updateAnnotationsList();
        });
    }

    setActiveTab(tab) {
        this.activeTab = tab;

        // Update tab buttons
        document.querySelectorAll('.sidebar-tab').forEach(t => {
            t.classList.remove('active');
        });
        document.getElementById(tab + 'Tab').classList.add('active');

        // Update panels with animation
        document.querySelectorAll('.sidebar-panel').forEach(p => {
            p.classList.remove('active');
        });

        const panel = document.getElementById(tab + 'Panel');
        panel.classList.add('active');
        panel.style.animation = 'fadeIn 0.2s ease-out';
    }

    async updateThumbnails(pages, renderer) {
        const container = document.getElementById('thumbnailsList');
        container.innerHTML = '';

        for (let i = 0; i < pages.length; i++) {
            const page = pages[i];
            const wrapper = document.createElement('div');
            wrapper.className = 'thumbnail';
            wrapper.dataset.pageIndex = i;
            wrapper.style.animation = `slideUp 0.3s ease-out ${i * 0.05}s both`;

            // Create thumbnail canvas
            const canvas = document.createElement('canvas');
            const scale = renderer.scale;
            renderer.setScale(0.2);

            try {
                await renderer.render(page, canvas);
            } catch (e) {
                console.warn('Thumbnail render error:', e);
            }

            renderer.setScale(scale);

            wrapper.appendChild(canvas);

            // Page label
            const label = document.createElement('div');
            label.className = 'thumbnail-label';
            label.textContent = `Page ${i + 1}`;
            wrapper.appendChild(label);

            // Click handler
            wrapper.addEventListener('click', () => {
                this.app.goToPage(i);
            });

            container.appendChild(wrapper);
        }
    }

    setActiveThumbnail(pageIndex) {
        document.querySelectorAll('.thumbnail').forEach(t => {
            t.classList.toggle('active', parseInt(t.dataset.pageIndex) === pageIndex);
        });

        // Scroll thumbnail into view
        const activeThumbnail = document.querySelector('.thumbnail.active');
        if (activeThumbnail) {
            activeThumbnail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    updateAnnotationsList() {
        const container = document.getElementById('annotationsList');
        container.innerHTML = '';

        const annotations = this.app.getAllAnnotations();

        if (annotations.length === 0) {
            container.innerHTML = `
                <div style="padding: 20px; text-align: center;">
                    <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="margin-bottom: 12px; opacity: 0.5;">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <path d="M14 2v6h6"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                    <p style="color: var(--text-muted); font-size: 13px;">No annotations yet</p>
                    <p style="color: var(--text-muted); font-size: 12px; margin-top: 4px; opacity: 0.7;">
                        Use the toolbar to add highlights, notes, or drawings
                    </p>
                </div>
            `;
            return;
        }

        // Group by page
        const byPage = {};
        for (const ann of annotations) {
            if (!byPage[ann.pageIndex]) {
                byPage[ann.pageIndex] = [];
            }
            byPage[ann.pageIndex].push(ann);
        }

        // Sort pages
        const pageNums = Object.keys(byPage).map(Number).sort((a, b) => a - b);
        let delay = 0;

        for (const pageNum of pageNums) {
            const pageAnnotations = byPage[pageNum];

            for (const ann of pageAnnotations) {
                const item = document.createElement('div');
                item.className = 'annotation-item';
                item.dataset.annotationId = ann.id;
                item.dataset.pageIndex = pageNum;
                item.style.animation = `slideUp 0.3s ease-out ${delay}s both`;
                delay += 0.03;

                // Icon based on type
                const icons = {
                    highlight: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
                    note: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
                    drawing: '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>'
                };

                item.innerHTML = `
                    <div class="annotation-item-header">
                        <span class="annotation-type" style="color: ${ann.color}">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: middle; margin-right: 4px;">
                                ${icons[ann.type] || ''}
                            </svg>
                            ${ann.type}
                        </span>
                        <span class="annotation-page">Page ${pageNum + 1}</span>
                    </div>
                    <div class="annotation-preview">
                        ${ann.type === 'note' ? (ann.text || '(Empty note)') :
                          ann.type === 'highlight' ? (ann.text || 'Highlighted area') :
                          'Freehand drawing'}
                    </div>
                `;

                // Click to navigate
                item.addEventListener('click', () => {
                    this.app.goToPage(pageNum);
                });

                container.appendChild(item);
            }
        }
    }

    clear() {
        document.getElementById('thumbnailsList').innerHTML = '';
        document.getElementById('annotationsList').innerHTML = '';
    }
}
