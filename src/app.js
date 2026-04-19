/**
 * Docs - Modern PDF Reader
 */

import { PDFParser } from './parser/PDFParser.js';
import { PageRenderer } from './renderer/PageRenderer.js';
import { AnnotationLayer } from './annotations/AnnotationLayer.js';

class App {
    constructor() {
        this.pdf = null;
        this.renderer = null;
        this.pages = [];
        this.pageElements = [];
        this.annotationLayers = [];
        this.currentPage = 0;
        this.scale = 1.5;
        this.tool = 'select';
        this.color = '#fbbf24';
        this.theme = localStorage.getItem('theme') || 'light';

        this.init();
    }

    init() {
        this.setTheme(this.theme);
        this.bindEvents();
    }

    bindEvents() {
        // File open
        const fileInput = document.getElementById('fileInput');
        console.log('fileInput element:', fileInput);
        console.log('openFileBtn element:', document.getElementById('openFileBtn'));
        console.log('emptyOpenBtn element:', document.getElementById('emptyOpenBtn'));

        document.getElementById('openFileBtn').onclick = () => {
            console.log('Open button clicked');
            fileInput.click();
        };
        document.getElementById('emptyOpenBtn').onclick = () => {
            console.log('Empty open button clicked');
            fileInput.click();
        };
        fileInput.onchange = e => {
            console.log('File selected:', e.target.files[0]);
            if (e.target.files[0]) this.loadFile(e.target.files[0]);
        };

        // Navigation
        document.getElementById('prevPage').onclick = () => this.goToPage(this.currentPage - 1);
        document.getElementById('nextPage').onclick = () => this.goToPage(this.currentPage + 1);

        document.getElementById('pageInput').onkeydown = e => {
            if (e.key === 'Enter') {
                const page = parseInt(e.target.value) - 1;
                if (page >= 0 && page < this.pages.length) this.goToPage(page);
            }
        };

        // Zoom
        document.getElementById('zoomIn').onclick = () => this.setScale(Math.min(4, this.scale + 0.25));
        document.getElementById('zoomOut').onclick = () => this.setScale(Math.max(0.5, this.scale - 0.25));

        // Tools
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.onclick = () => this.setTool(btn.dataset.tool);
        });

        // Colors
        document.querySelectorAll('.color-dot').forEach(dot => {
            dot.onclick = () => this.setColor(dot.dataset.color);
        });

        // Save/Load
        const annotationInput = document.getElementById('annotationInput');
        document.getElementById('saveBtn').onclick = () => this.saveAnnotations();
        document.getElementById('loadBtn').onclick = () => annotationInput.click();
        annotationInput.onchange = e => e.target.files[0] && this.loadAnnotations(e.target.files[0]);

        // Theme
        document.getElementById('themeToggle').onclick = () => this.toggleTheme();

        // Shortcuts modal
        document.getElementById('shortcutsBtn').onclick = () => this.showModal('shortcutsModal');
        document.getElementById('shortcutsClose').onclick = () => this.hideModal('shortcutsModal');
        document.getElementById('shortcutsModal').onclick = e => {
            if (e.target.id === 'shortcutsModal') this.hideModal('shortcutsModal');
        };

        // Note modal
        document.getElementById('noteClose').onclick = () => this.hideModal('noteModal');
        document.getElementById('noteSave').onclick = () => this.saveNote();
        document.getElementById('noteDelete').onclick = () => this.deleteNote();

        // Sidebar toggle
        document.getElementById('sidebarToggle').onclick = () => {
            document.querySelector('.sidebar').classList.toggle('collapsed');
        };

        // Drag and drop
        const viewer = document.getElementById('viewer');
        console.log('viewer element:', viewer);

        viewer.ondragover = e => {
            e.preventDefault();
            e.stopPropagation();
            viewer.classList.add('drag-over');
        };
        viewer.ondragleave = e => {
            e.preventDefault();
            viewer.classList.remove('drag-over');
        };
        viewer.ondrop = e => {
            e.preventDefault();
            e.stopPropagation();
            viewer.classList.remove('drag-over');
            console.log('File dropped:', e.dataTransfer.files[0]);
            const file = e.dataTransfer.files[0];
            if (file) {
                console.log('File type:', file.type, 'Name:', file.name);
                // Accept both by MIME type and extension
                if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                    this.loadFile(file);
                } else {
                    this.toast('Please drop a PDF file', 'error');
                }
            }
        };

        // Also handle drag events on document to prevent browser default
        document.ondragover = e => e.preventDefault();
        document.ondrop = e => e.preventDefault();

        // Keyboard shortcuts
        document.onkeydown = e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key === 'Escape') {
                this.hideModal('shortcutsModal');
                this.hideModal('noteModal');
                return;
            }

            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'o') { e.preventDefault(); fileInput.click(); }
                if (e.key === '=' || e.key === '+') { e.preventDefault(); this.setScale(Math.min(4, this.scale + 0.25)); }
                if (e.key === '-') { e.preventDefault(); this.setScale(Math.max(0.5, this.scale - 0.25)); }
                return;
            }

            switch(e.key.toLowerCase()) {
                case 'v': this.setTool('select'); break;
                case 'h': this.setTool('highlight'); break;
                case 'n': this.setTool('note'); break;
                case 'd': this.setTool('draw'); break;
                case 't': this.toggleTheme(); break;
                case 'arrowleft': this.goToPage(this.currentPage - 1); break;
                case 'arrowright': this.goToPage(this.currentPage + 1); break;
            }
        };

        // Scroll spy
        document.getElementById('viewer').onscroll = () => this.updateCurrentPage();
    }

    async loadFile(file) {
        console.log('loadFile called with:', file.name, file.size, 'bytes');
        try {
            document.getElementById('emptyState').style.display = 'none';
            document.getElementById('loadingState').style.display = 'flex';
            document.getElementById('pagesContainer').innerHTML = '';

            console.log('Reading file...');
            const data = new Uint8Array(await file.arrayBuffer());
            console.log('File read, size:', data.length, 'bytes');

            console.log('Creating PDFParser...');
            this.pdf = new PDFParser(data);

            console.log('Parsing PDF...');
            await this.pdf.parse();
            console.log('PDF parsed');

            console.log('Getting pages...');
            this.pages = await this.pdf.getPages();
            console.log('Got', this.pages.length, 'pages');

            this.renderer = new PageRenderer(this.pdf);
            this.renderer.setScale(this.scale);

            this.pageElements = [];
            this.annotationLayers = [];

            await this.renderPages();

            document.getElementById('loadingState').style.display = 'none';
            document.getElementById('docTitle').textContent = file.name.replace('.pdf', '');

            this.enableControls(true);
            this.updatePageCount();
            this.goToPage(0);
            this.renderThumbnails();

            this.toast(`Loaded ${this.pages.length} pages`, 'success');

        } catch (err) {
            console.error(err);
            document.getElementById('loadingState').style.display = 'none';
            document.getElementById('emptyState').style.display = 'flex';
            this.toast('Failed to load PDF', 'error');
        }
    }

    async renderPages() {
        const container = document.getElementById('pagesContainer');

        for (let i = 0; i < this.pages.length; i++) {
            const wrapper = document.createElement('div');
            wrapper.className = 'page-wrapper';
            wrapper.dataset.page = i;

            const canvas = document.createElement('canvas');
            canvas.className = 'page-canvas';
            wrapper.appendChild(canvas);
            container.appendChild(wrapper);

            const result = await this.renderer.render(this.pages[i], canvas);

            const layer = new AnnotationLayer(wrapper, i, this.scale);
            layer.setSize(result.width, result.height);
            layer.setTool(this.tool);
            layer.setColor(this.color);

            this.pageElements.push(wrapper);
            this.annotationLayers.push(layer);
        }
    }

    async renderThumbnails() {
        const container = document.getElementById('sidebarPages');
        container.innerHTML = '';

        for (let i = 0; i < this.pages.length; i++) {
            const thumb = document.createElement('div');
            thumb.className = 'page-thumb';
            thumb.dataset.page = i;
            thumb.onclick = () => this.goToPage(i);

            const canvas = document.createElement('canvas');
            const scale = this.renderer.scale;
            this.renderer.setScale(0.2);
            await this.renderer.render(this.pages[i], canvas);
            this.renderer.setScale(scale);

            const label = document.createElement('div');
            label.className = 'page-thumb-label';
            label.textContent = `Page ${i + 1}`;

            thumb.appendChild(canvas);
            thumb.appendChild(label);
            container.appendChild(thumb);
        }
    }

    goToPage(index) {
        if (index < 0 || index >= this.pages.length) return;

        this.currentPage = index;
        this.pageElements[index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });

        document.getElementById('pageInput').value = index + 1;
        document.getElementById('prevPage').disabled = index === 0;
        document.getElementById('nextPage').disabled = index === this.pages.length - 1;

        document.querySelectorAll('.page-thumb').forEach((t, i) => {
            t.classList.toggle('active', i === index);
        });
    }

    updateCurrentPage() {
        const viewer = document.getElementById('viewer');
        const viewerRect = viewer.getBoundingClientRect();

        for (let i = 0; i < this.pageElements.length; i++) {
            const rect = this.pageElements[i].getBoundingClientRect();
            if (rect.top < viewerRect.top + viewerRect.height / 2 &&
                rect.bottom > viewerRect.top + viewerRect.height / 2) {
                if (this.currentPage !== i) {
                    this.currentPage = i;
                    document.getElementById('pageInput').value = i + 1;
                    document.getElementById('prevPage').disabled = i === 0;
                    document.getElementById('nextPage').disabled = i === this.pages.length - 1;
                    document.querySelectorAll('.page-thumb').forEach((t, j) => {
                        t.classList.toggle('active', j === i);
                    });
                }
                break;
            }
        }
    }

    async setScale(scale) {
        this.scale = scale;
        document.getElementById('zoomLevel').textContent = Math.round(scale * 100) + '%';

        if (!this.renderer) return;
        this.renderer.setScale(scale);

        for (let i = 0; i < this.pages.length; i++) {
            const canvas = this.pageElements[i].querySelector('.page-canvas');
            const result = await this.renderer.render(this.pages[i], canvas);
            this.annotationLayers[i].setSize(result.width, result.height);
            this.annotationLayers[i].setScale(scale);
        }
    }

    setTool(tool) {
        this.tool = tool;

        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });

        this.annotationLayers.forEach(layer => layer.setTool(tool));
    }

    setColor(color) {
        this.color = color;

        document.querySelectorAll('.color-dot').forEach(dot => {
            dot.classList.toggle('active', dot.dataset.color === color);
        });

        this.annotationLayers.forEach(layer => layer.setColor(color));
    }

    enableControls(enabled) {
        const ids = ['prevPage', 'nextPage', 'zoomIn', 'zoomOut', 'selectTool',
                     'highlightTool', 'noteTool', 'drawTool', 'saveBtn', 'loadBtn'];
        ids.forEach(id => document.getElementById(id).disabled = !enabled);
    }

    updatePageCount() {
        document.getElementById('totalPages').textContent = this.pages.length;
        document.getElementById('pageCount').textContent = this.pages.length;
    }

    // Theme
    setTheme(theme) {
        this.theme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);

        document.querySelector('.icon-sun').style.display = theme === 'dark' ? 'none' : 'block';
        document.querySelector('.icon-moon').style.display = theme === 'dark' ? 'block' : 'none';
    }

    toggleTheme() {
        this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
    }

    // Modals
    showModal(id) {
        document.getElementById(id).style.display = 'flex';
    }

    hideModal(id) {
        document.getElementById(id).style.display = 'none';
    }

    // Notes
    currentNote = null;

    openNoteEditor(note) {
        this.currentNote = note;
        document.getElementById('noteText').value = note.text || '';
        this.showModal('noteModal');
    }

    saveNote() {
        if (this.currentNote) {
            this.currentNote.text = document.getElementById('noteText').value;
        }
        this.hideModal('noteModal');
        this.updateAnnotationCount();
    }

    deleteNote() {
        if (this.currentNote) {
            const layer = this.annotationLayers[this.currentNote.pageIndex];
            layer?.removeAnnotation(this.currentNote.id);
        }
        this.hideModal('noteModal');
        this.updateAnnotationCount();
    }

    // Annotations
    getAllAnnotations() {
        return this.annotationLayers.flatMap(layer => layer.getAnnotations());
    }

    updateAnnotationCount() {
        document.getElementById('annotationCount').textContent = this.getAllAnnotations().length;
    }

    saveAnnotations() {
        const annotations = this.getAllAnnotations();
        if (!annotations.length) {
            this.toast('No annotations to save', 'error');
            return;
        }

        const blob = new Blob([JSON.stringify(annotations, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'annotations.json';
        a.click();
        URL.revokeObjectURL(a.href);

        this.toast(`Saved ${annotations.length} annotations`, 'success');
    }

    async loadAnnotations(file) {
        try {
            const annotations = JSON.parse(await file.text());

            this.annotationLayers.forEach(layer => layer.setAnnotations([]));

            annotations.forEach(ann => {
                this.annotationLayers[ann.pageIndex]?.addAnnotation(ann);
            });

            this.updateAnnotationCount();
            this.toast(`Loaded ${annotations.length} annotations`, 'success');
        } catch {
            this.toast('Failed to load annotations', 'error');
        }
    }

    // Toast
    toast(message, type = 'info') {
        const container = document.getElementById('toasts');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'toastIn 300ms ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// Listen for annotation changes
document.addEventListener('annotationChange', () => {
    window.app?.updateAnnotationCount();
});

// Init
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing app...');
    try {
        window.app = new App();
        console.log('App initialized successfully');
    } catch (e) {
        console.error('Failed to initialize app:', e);
    }
});
