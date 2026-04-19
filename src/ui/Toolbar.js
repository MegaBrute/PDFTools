/**
 * Toolbar Manager
 * Modern toolbar with animations and state management
 */

export class Toolbar {
    constructor(app) {
        this.app = app;
        this.currentTool = 'select';
        this.currentColor = '#FFEB3B';
        this.init();
    }

    init() {
        // File open
        document.getElementById('openFileBtn').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });

        document.getElementById('fileInput').addEventListener('change', (e) => {
            if (e.target.files[0]) {
                this.app.loadFile(e.target.files[0]);
                e.target.value = ''; // Reset for same file selection
            }
        });

        // Navigation
        document.getElementById('prevPageBtn').addEventListener('click', () => {
            this.app.previousPage();
        });

        document.getElementById('nextPageBtn').addEventListener('click', () => {
            this.app.nextPage();
        });

        // Zoom
        document.getElementById('zoomOutBtn').addEventListener('click', () => {
            this.app.zoomOut();
        });

        document.getElementById('zoomInBtn').addEventListener('click', () => {
            this.app.zoomIn();
        });

        // Tools
        const tools = ['select', 'highlight', 'note', 'draw'];
        for (const tool of tools) {
            const btn = document.getElementById(tool + 'Tool');
            if (btn) {
                btn.addEventListener('click', () => {
                    this.setTool(tool);
                });
            }
        }

        // Color picker
        const colorBtns = document.querySelectorAll('.color-btn');
        colorBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.setColor(btn.dataset.color);
            });
        });

        // Set initial color button active
        this.updateColorButtons();

        // Save/Load annotations
        document.getElementById('saveAnnotationsBtn').addEventListener('click', () => {
            this.app.saveAnnotations();
        });

        document.getElementById('loadAnnotationsBtn').addEventListener('click', () => {
            document.getElementById('annotationFileInput').click();
        });

        document.getElementById('annotationFileInput').addEventListener('change', (e) => {
            if (e.target.files[0]) {
                this.app.loadAnnotations(e.target.files[0]);
                e.target.value = '';
            }
        });
    }

    setTool(tool) {
        this.currentTool = tool;

        // Update button states with animation
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        const activeBtn = document.getElementById(tool + 'Tool');
        if (activeBtn) {
            activeBtn.classList.add('active');
        }

        // Show/hide color picker with animation
        const colorPicker = document.getElementById('colorPicker');
        const showColors = tool === 'highlight' || tool === 'note' || tool === 'draw';

        if (showColors) {
            colorPicker.style.display = 'flex';
            colorPicker.style.animation = 'fadeIn 0.2s ease-out';
        } else {
            colorPicker.style.animation = 'fadeIn 0.2s ease-out reverse';
            setTimeout(() => {
                colorPicker.style.display = 'none';
            }, 150);
        }

        // Update app
        this.app.setTool(tool);
    }

    setColor(color) {
        this.currentColor = color;
        this.updateColorButtons();
        this.app.setColor(color);
    }

    updateColorButtons() {
        document.querySelectorAll('.color-btn').forEach(btn => {
            const isActive = btn.dataset.color === this.currentColor;
            btn.classList.toggle('active', isActive);
        });
    }

    setEnabled(enabled) {
        const btns = [
            'prevPageBtn', 'nextPageBtn',
            'zoomOutBtn', 'zoomInBtn',
            'selectTool', 'highlightTool', 'noteTool', 'drawTool',
            'saveAnnotationsBtn', 'loadAnnotationsBtn'
        ];

        btns.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.disabled = !enabled;
            }
        });
    }

    updatePageInfo(current, total) {
        const pageInfo = document.getElementById('pageInfo');
        pageInfo.textContent = `${current} / ${total}`;

        document.getElementById('prevPageBtn').disabled = current <= 1;
        document.getElementById('nextPageBtn').disabled = current >= total;
    }

    updateZoomLevel(scale) {
        document.getElementById('zoomLevel').textContent = Math.round(scale * 100) + '%';
    }
}
