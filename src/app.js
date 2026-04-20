/**
 * Docs - Modern PDF Reader
 */

import {
    getDocument,
    GlobalWorkerOptions,
    TextLayer
} from '../node_modules/pdfjs-dist/build/pdf.mjs';
import { AnnotationLayer } from './annotations/AnnotationLayer.js';

GlobalWorkerOptions.workerSrc = new URL(
    '../node_modules/pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
).toString();

const CMAP_URL = new URL('../node_modules/pdfjs-dist/cmaps/', import.meta.url).toString();
const STANDARD_FONT_URL = new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).toString();
const WASM_URL = new URL('../node_modules/pdfjs-dist/wasm/', import.meta.url).toString();
const NOTE_RAIL_WIDTH = 196;
const PAGE_RENDER_BUFFER = 2;
const PAGE_RELEASE_BUFFER = 6;
const THUMBNAIL_ROOT_MARGIN = '320px 0px';

class App {
    constructor() {
        this.pdf = null;
        this.loadingTask = null;
        this.pages = [];
        this.pageCache = new Map();
        this.pageElements = [];
        this.pageViews = [];
        this.annotationLayers = [];
        this.currentPage = 0;
        this.scale = 1.5;
        this.tool = 'select';
        this.color = '#fbbf24';
        this.theme = localStorage.getItem('theme') || 'light';
        this.pdfDarkMode = localStorage.getItem('pdfDarkMode') === 'true';
        this.sidebarView = 'pages';
        this.renderSessionId = 0;
        this.undoStack = [];
        this.redoStack = [];
        this.isApplyingHistory = false;
        this.currentNote = null;
        this.currentNoteOriginal = null;
        this.thumbnailViews = [];
        this.thumbnailObserver = null;
        this.pendingPageRenderFrame = null;
        this.pendingScrollFrame = null;

        this.init();
    }

    init() {
        this.setTheme(this.theme);
        this.applyPdfDarkModeState();
        this.bindEvents();
        this.setSidebarView('pages');
        this.updateHistoryButtons();
    }

    bindEvents() {
        const fileInput = document.getElementById('fileInput');
        const annotationInput = document.getElementById('annotationInput');

        document.getElementById('openFileBtn').onclick = () => this.openPdfPicker();
        document.getElementById('emptyOpenBtn').onclick = () => this.openPdfPicker();
        fileInput.onchange = async e => {
            const file = e.target.files?.[0];
            if (!file) return;

            try {
                await this.loadFile(file);
            } finally {
                e.target.value = '';
            }
        };

        document.getElementById('pagesNav').onclick = () => this.setSidebarView('pages');
        document.getElementById('notesNav').onclick = () => this.setSidebarView('annotations');

        document.getElementById('prevPage').onclick = () => this.goToPage(this.currentPage - 1);
        document.getElementById('nextPage').onclick = () => this.goToPage(this.currentPage + 1);

        document.getElementById('pageInput').onkeydown = e => {
            if (e.key === 'Enter') {
                const page = parseInt(e.target.value, 10) - 1;
                if (page >= 0 && page < this.pages.length) this.goToPage(page);
            }
        };

        document.getElementById('zoomIn').onclick = () => this.setScale(Math.min(4, this.scale + 0.25));
        document.getElementById('zoomOut').onclick = () => this.setScale(Math.max(0.5, this.scale - 0.25));

        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
            btn.onclick = () => this.setTool(btn.dataset.tool);
        });

        document.getElementById('undoBtn').onclick = () => this.undo();
        document.getElementById('redoBtn').onclick = () => this.redo();
        document.getElementById('pdfThemeBtn').onclick = () => this.togglePdfDarkMode();

        document.querySelectorAll('.color-dot').forEach(dot => {
            dot.onclick = () => this.setColor(dot.dataset.color);
        });

        document.getElementById('saveBtn').onclick = () => this.saveAnnotations();
        document.getElementById('loadBtn').onclick = () => annotationInput.click();
        annotationInput.onchange = e => {
            if (e.target.files?.[0]) {
                this.loadAnnotations(e.target.files[0]);
            }
            e.target.value = '';
        };

        document.getElementById('themeToggle').onclick = () => this.toggleTheme();

        document.getElementById('shortcutsBtn').onclick = () => this.showModal('shortcutsModal');
        document.getElementById('shortcutsClose').onclick = () => this.hideModal('shortcutsModal');
        document.getElementById('shortcutsModal').onclick = e => {
            if (e.target.id === 'shortcutsModal') this.hideModal('shortcutsModal');
        };

        document.getElementById('noteClose').onclick = () => this.hideModal('noteModal');
        document.getElementById('noteSave').onclick = () => this.saveNote();
        document.getElementById('noteDelete').onclick = () => this.deleteNote();

        document.getElementById('sidebarToggle').onclick = () => {
            const sidebar = document.querySelector('.sidebar');
            if (window.matchMedia('(max-width: 768px)').matches) {
                sidebar.classList.toggle('open');
                sidebar.classList.remove('collapsed');
            } else {
                sidebar.classList.toggle('collapsed');
                sidebar.classList.remove('open');
            }
        };

        const viewer = document.getElementById('viewer');

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
            const file = e.dataTransfer.files[0];
            if (!file) return;

            if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                this.loadFile(file);
            } else {
                this.toast('Please drop a PDF file', 'error');
            }
        };

        document.ondragover = e => e.preventDefault();
        document.ondrop = e => e.preventDefault();

        document.onkeydown = e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key === 'Escape') {
                this.hideModal('shortcutsModal');
                this.hideModal('noteModal');
                return;
            }

            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'o') {
                    e.preventDefault();
                    this.openPdfPicker();
                }
                if (e.key === '=' || e.key === '+') {
                    e.preventDefault();
                    this.setScale(Math.min(4, this.scale + 0.25));
                }
                if (e.key === '-') {
                    e.preventDefault();
                    this.setScale(Math.max(0.5, this.scale - 0.25));
                }
                if (e.key.toLowerCase() === 'z') {
                    e.preventDefault();
                    if (e.shiftKey) {
                        this.redo();
                    } else {
                        this.undo();
                    }
                }
                if (e.key.toLowerCase() === 'y') {
                    e.preventDefault();
                    this.redo();
                }
                return;
            }

            switch (e.key.toLowerCase()) {
                case 'v': this.setTool('select'); break;
                case 'h': this.setTool('highlight'); break;
                case 'n': this.setTool('note'); break;
                case 'd': this.setTool('draw'); break;
                case 'i': this.togglePdfDarkMode(); break;
                case 't': this.toggleTheme(); break;
                case 'arrowleft': this.goToPage(this.currentPage - 1); break;
                case 'arrowright': this.goToPage(this.currentPage + 1); break;
            }
        };

        viewer.onscroll = () => this.handleViewerScroll();
    }

    openPdfPicker() {
        const fileInput = document.getElementById('fileInput');
        if (!fileInput) return;

        fileInput.value = '';

        try {
            if (typeof fileInput.showPicker === 'function') {
                fileInput.showPicker();
                return;
            }
        } catch (err) {
            console.warn('showPicker failed, falling back to click()', err);
        }

        fileInput.click();
    }

    async loadFile(file) {
        const hadDocument = this.pages.length > 0;
        const viewer = document.getElementById('pagesContainer');

        try {
            this.cancelRenderTasks();
            await this.destroyCurrentDocument();

            document.getElementById('emptyState').style.display = 'none';
            document.getElementById('loadingState').style.display = 'flex';

            const data = new Uint8Array(await file.arrayBuffer());
            const loadingTask = getDocument({
                data,
                cMapUrl: CMAP_URL,
                cMapPacked: true,
                standardFontDataUrl: STANDARD_FONT_URL,
                wasmUrl: WASM_URL,
                useWorkerFetch: false,
                enableXfa: true
            });

            this.loadingTask = loadingTask;

            const pdf = await loadingTask.promise;
            const firstPage = await pdf.getPage(1);

            this.pdf = pdf;
            this.pageCache = new Map([[1, Promise.resolve(firstPage)]]);
            this.pages = Array.from({ length: pdf.numPages }, (_, index) => index + 1);
            this.pageElements = [];
            this.pageViews = [];
            this.annotationLayers = [];
            this.thumbnailViews = [];
            this.undoStack = [];
            this.redoStack = [];
            this.currentNote = null;
            this.currentNoteOriginal = null;
            this.renderSessionId += 1;
            viewer.innerHTML = '';

            const fallbackViewport = firstPage.getViewport({ scale: this.scale });
            this.initializePageViews(this.renderSessionId, fallbackViewport);

            document.getElementById('docTitle').textContent = file.name.replace(/\.pdf$/i, '');
            document.getElementById('loadingState').style.display = 'none';
            this.enableControls(true);
            this.updatePageCount();
            this.updateAnnotationCount();
            this.updateHistoryButtons();
            this.renderAnnotationList();
            this.goToPage(0);

            this.queueVisiblePageRendering();
            this.renderThumbnailsProgressively(this.renderSessionId);

            this.toast(`Loaded ${this.pages.length} pages`, 'success');
        } catch (err) {
            console.error(err);
            document.getElementById('loadingState').style.display = 'none';

            if (!hadDocument) {
                document.getElementById('emptyState').style.display = 'flex';
            }

            this.toast(`Failed to load PDF: ${err.message}`, 'error');
        }
    }

    async destroyCurrentDocument() {
        const currentLoadingTask = this.loadingTask;
        this.loadingTask = null;
        this.disconnectThumbnailObserver();
        this.thumbnailViews = [];

        if (currentLoadingTask) {
            try {
                await currentLoadingTask.destroy();
            } catch {
                // Ignore teardown errors when replacing the document.
            }
        }

        this.pdf = null;
        this.pageCache = new Map();
    }

    initializePageViews(sessionId, fallbackViewport) {
        const container = document.getElementById('pagesContainer');
        const width = fallbackViewport.width;
        const height = fallbackViewport.height;

        for (let i = 0; i < this.pages.length; i++) {
            if (sessionId !== this.renderSessionId) return;

            const wrapper = document.createElement('div');
            wrapper.className = 'page-wrapper';
            wrapper.dataset.page = i;
            wrapper.style.width = `${width}px`;
            wrapper.style.height = `${height}px`;

            const content = document.createElement('div');
            content.className = 'page-content';
            content.style.width = `${width}px`;
            content.style.height = `${height}px`;

            const canvas = document.createElement('canvas');
            canvas.className = 'page-canvas';
            canvas.width = 1;
            canvas.height = 1;
            canvas.style.width = '0px';
            canvas.style.height = '0px';
            content.appendChild(canvas);

            const textLayer = document.createElement('div');
            textLayer.className = 'text-layer textLayer';
            textLayer.addEventListener('mouseup', () => {
                setTimeout(() => this.handleTextLayerMouseUp(i), 0);
            });
            content.appendChild(textLayer);

            wrapper.appendChild(content);

            const noteRail = document.createElement('div');
            noteRail.className = 'page-note-rail';
            noteRail.style.width = `${NOTE_RAIL_WIDTH}px`;
            noteRail.style.height = `${height}px`;
            wrapper.appendChild(noteRail);

            container.appendChild(wrapper);

            const layer = new AnnotationLayer(wrapper, i, this.scale);
            layer.setTool(this.tool);
            layer.setColor(this.color);

            this.pageElements.push(wrapper);
            this.pageViews.push({
                wrapper,
                content,
                canvas,
                textLayer,
                noteRail,
                renderTask: null,
                textLayerTask: null,
                renderKey: null,
                renderingKey: null
            });
            this.annotationLayers.push(layer);
        }
    }

    async getPdfPage(pageNumber) {
        let pagePromise = this.pageCache.get(pageNumber);
        if (!pagePromise) {
            pagePromise = this.pdf.getPage(pageNumber);
            this.pageCache.set(pageNumber, pagePromise);
        }
        return pagePromise;
    }

    async renderPagesProgressively(sessionId) {
        const { start, end } = this.getPageRenderWindow();

        for (let i = start; i <= end; i++) {
            if (sessionId !== this.renderSessionId) return;

            try {
                await this.renderPageView(i, sessionId);
            } catch (err) {
                if (err?.name === 'RenderingCancelledException' || err?.name === 'AbortException') {
                    return;
                }
                console.error(`Failed to render page ${i + 1}:`, err);
                this.toast(`Couldn't fully render page ${i + 1}`, 'error');
            }

            await this.nextFrame();
        }

        this.releaseFarPageViews();
    }

    getPdfPageColors() {
        if (!this.pdfDarkMode) return null;

        const styles = getComputedStyle(document.documentElement);
        return {
            background: styles.getPropertyValue('--bg-base').trim() || '#0f172a',
            foreground: styles.getPropertyValue('--fg-default').trim() || '#f8fafc'
        };
    }

    getRenderTransform(outputScale) {
        return outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0];
    }

    createRenderCanvas(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    restoreImageRegions(targetCanvas, sourceCanvas, imageCoordinates) {
        if (!imageCoordinates?.length) return;

        const ctx = targetCanvas.getContext('2d');

        for (let i = 0; i < imageCoordinates.length; i += 6) {
            const xs = [
                imageCoordinates[i] * targetCanvas.width,
                imageCoordinates[i + 2] * targetCanvas.width,
                imageCoordinates[i + 4] * targetCanvas.width
            ];
            const ys = [
                imageCoordinates[i + 1] * targetCanvas.height,
                imageCoordinates[i + 3] * targetCanvas.height,
                imageCoordinates[i + 5] * targetCanvas.height
            ];

            const minX = Math.max(0, Math.floor(Math.min(...xs)));
            const maxX = Math.min(targetCanvas.width, Math.ceil(Math.max(...xs)));
            const minY = Math.max(0, Math.floor(Math.min(...ys)));
            const maxY = Math.min(targetCanvas.height, Math.ceil(Math.max(...ys)));
            const width = maxX - minX;
            const height = maxY - minY;

            if (width <= 0 || height <= 0) continue;

            ctx.drawImage(
                sourceCanvas,
                minX,
                minY,
                width,
                height,
                minX,
                minY,
                width,
                height
            );
        }
    }

    async renderPageBitmap(page, viewport, outputScale, canvas) {
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const renderTask = page.render({
            canvasContext: ctx,
            viewport,
            transform: this.getRenderTransform(outputScale)
        });

        await renderTask.promise;
        return renderTask;
    }

    commitRenderedCanvas(view, sourceCanvas, viewport) {
        view.canvas.width = sourceCanvas.width;
        view.canvas.height = sourceCanvas.height;
        view.canvas.style.width = `${viewport.width}px`;
        view.canvas.style.height = `${viewport.height}px`;

        const targetContext = view.canvas.getContext('2d', { alpha: false });
        targetContext.setTransform(1, 0, 0, 1, 0, 0);
        targetContext.clearRect(0, 0, view.canvas.width, view.canvas.height);
        targetContext.drawImage(sourceCanvas, 0, 0);

        view.wrapper.style.height = `${viewport.height}px`;
        view.content.style.width = `${viewport.width}px`;
        view.content.style.height = `${viewport.height}px`;
        if (view.noteRail) {
            view.noteRail.style.width = `${NOTE_RAIL_WIDTH}px`;
            view.noteRail.style.height = `${viewport.height}px`;
        }
    }

    async renderPageView(pageIndex, sessionId) {
        const view = this.pageViews[pageIndex];
        if (!view || sessionId !== this.renderSessionId) return;

        const renderKey = this.getPageRenderKey(pageIndex);
        if (view.renderKey === renderKey || view.renderingKey === renderKey) return;
        view.renderingKey = renderKey;

        try {
            const page = await this.getPdfPage(this.pages[pageIndex]);
            if (sessionId !== this.renderSessionId) return;

            const viewport = page.getViewport({ scale: this.scale });
            const outputScale = window.devicePixelRatio || 1;

            view.renderTask?.cancel();
            view.textLayerTask?.cancel?.();
            const renderWidth = Math.ceil(viewport.width * outputScale);
            const renderHeight = Math.ceil(viewport.height * outputScale);

            if (this.pdfDarkMode) {
                const originalCanvas = this.createRenderCanvas(renderWidth, renderHeight);
                await this.renderPageBitmap(page, viewport, outputScale, originalCanvas);
                if (sessionId !== this.renderSessionId) return;

                const darkCanvas = this.createRenderCanvas(renderWidth, renderHeight);
                const darkContext = darkCanvas.getContext('2d', { alpha: false });
                view.renderTask = page.render({
                    canvasContext: darkContext,
                    viewport,
                    transform: this.getRenderTransform(outputScale),
                    pageColors: this.getPdfPageColors(),
                    recordImages: true
                });

                await view.renderTask.promise;

                if (sessionId !== this.renderSessionId) return;

                this.restoreImageRegions(darkCanvas, originalCanvas, view.renderTask.imageCoordinates);
                this.commitRenderedCanvas(view, darkCanvas, viewport);
            } else {
                const renderCanvas = this.createRenderCanvas(renderWidth, renderHeight);
                const renderContext = renderCanvas.getContext('2d', { alpha: false });
                view.renderTask = page.render({
                    canvasContext: renderContext,
                    viewport,
                    transform: this.getRenderTransform(outputScale)
                });

                await view.renderTask.promise;
                if (sessionId !== this.renderSessionId) return;

                this.commitRenderedCanvas(view, renderCanvas, viewport);
            }

            if (sessionId !== this.renderSessionId) return;

            view.textLayer.replaceChildren();
            view.textLayer.style.setProperty('--total-scale-factor', viewport.scale);
            const textLayerTask = new TextLayer({
                textContentSource: page.streamTextContent({
                    includeMarkedContent: true,
                    disableNormalization: true
                }),
                container: view.textLayer,
                viewport
            });
            view.textLayerTask = textLayerTask;

            await textLayerTask.render();

            if (sessionId !== this.renderSessionId || view.textLayerTask !== textLayerTask) return;

            const endOfContent = document.createElement('div');
            endOfContent.className = 'endOfContent';
            view.textLayer.appendChild(endOfContent);

            await this.nextFrame();

            view.content.style.visibility = 'visible';

            const textPositions = this.extractTextPositions(pageIndex);
            this.annotationLayers[pageIndex]?.setScale(this.scale);
            this.annotationLayers[pageIndex]?.setSize(viewport.width + NOTE_RAIL_WIDTH, viewport.height, viewport.width);
            this.annotationLayers[pageIndex]?.setTextPositions(textPositions);
            this.syncPageNoteRail(pageIndex);
            view.renderKey = renderKey;
        } finally {
            if (view.renderingKey === renderKey) {
                view.renderingKey = null;
            }
        }
    }

    async renderThumbnailsProgressively(sessionId) {
        const container = document.getElementById('sidebarPages');
        this.disconnectThumbnailObserver();
        container.innerHTML = '';

        if (!this.pages.length) {
            container.innerHTML = '<div class="pages-empty"><p>No document loaded</p></div>';
            return;
        }
        this.thumbnailViews = [];

        this.thumbnailObserver = new IntersectionObserver(entries => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue;
                const pageIndex = Number(entry.target.dataset.page);
                if (Number.isFinite(pageIndex)) {
                    this.requestThumbnailRender(pageIndex, sessionId);
                }
            }
        }, {
            root: container,
            rootMargin: THUMBNAIL_ROOT_MARGIN,
            threshold: 0.01
        });

        for (let i = 0; i < this.pages.length; i++) {
            if (sessionId !== this.renderSessionId) return;

            const thumb = document.createElement('div');
            thumb.className = 'page-thumb';
            thumb.dataset.page = i;
            thumb.onclick = () => this.goToPage(i);

            const canvas = document.createElement('canvas');

            const label = document.createElement('div');
            label.className = 'page-thumb-label';
            label.textContent = `Page ${i + 1}`;

            thumb.appendChild(canvas);
            thumb.appendChild(label);
            container.appendChild(thumb);
            thumb.classList.toggle('active', i === this.currentPage);
            this.thumbnailViews.push({
                pageIndex: i,
                element: thumb,
                canvas,
                renderedKey: null,
                renderingKey: null
            });
            this.thumbnailObserver.observe(thumb);
        }

        this.requestThumbnailRender(this.currentPage, sessionId);
    }

    extractTextPositions(pageIndex) {
        const view = this.pageViews[pageIndex];
        if (!view) return [];

        const wrapperRect = view.wrapper.getBoundingClientRect();
        const spans = Array.from(view.textLayer.querySelectorAll('span'));

        return spans
            .map(span => {
                const text = span.textContent || '';
                if (!text.trim()) return null;

                const rect = span.getBoundingClientRect();
                if (!rect.width || !rect.height) return null;

                return {
                    text,
                    x: (rect.left - wrapperRect.left) / this.scale,
                    y: (rect.top - wrapperRect.top) / this.scale,
                    width: rect.width / this.scale,
                    height: rect.height / this.scale
                };
            })
            .filter(Boolean);
    }

    handleTextLayerMouseUp(pageIndex) {
        if (this.tool !== 'highlight') return;

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

        const view = this.pageViews[pageIndex];
        if (!view) return;

        const range = selection.getRangeAt(0);
        const commonNode = range.commonAncestorContainer;
        if (!view.textLayer.contains(commonNode)) return;

        const wrapperRect = view.wrapper.getBoundingClientRect();
        const textLayerRect = view.textLayer.getBoundingClientRect();
        const rects = Array.from(range.getClientRects())
            .filter(rect => rect.width > 1 && rect.height > 1)
            .filter(rect =>
                rect.bottom >= textLayerRect.top &&
                rect.top <= textLayerRect.bottom &&
                rect.right >= textLayerRect.left &&
                rect.left <= textLayerRect.right
            )
            .map(rect => ({
                x: rect.left - wrapperRect.left,
                y: rect.top - wrapperRect.top,
                width: rect.width,
                height: rect.height
            }));

        const mergedRects = this.mergeHighlightRects(rects);
        if (!mergedRects.length) return;

        const minX = Math.min(...mergedRects.map(rect => rect.x));
        const minY = Math.min(...mergedRects.map(rect => rect.y));
        const maxX = Math.max(...mergedRects.map(rect => rect.x + rect.width));
        const maxY = Math.max(...mergedRects.map(rect => rect.y + rect.height));

        this.annotationLayers[pageIndex]?.addAnnotation({
            id: this.createAnnotationId(),
            type: 'highlight',
            color: this.color,
            pageIndex,
            text: selection.toString().trim(),
            rects: mergedRects,
            rect: {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY
            }
        });

        selection.removeAllRanges();
    }

    mergeHighlightRects(rects) {
        const sorted = rects
            .slice()
            .sort((a, b) => (Math.abs(a.y - b.y) < 4 ? a.x - b.x : a.y - b.y));

        const merged = [];
        for (const rect of sorted) {
            const previous = merged[merged.length - 1];
            if (
                previous &&
                Math.abs(previous.y - rect.y) < 4 &&
                Math.abs(previous.height - rect.height) < 6 &&
                rect.x <= previous.x + previous.width + 6
            ) {
                previous.width = Math.max(previous.x + previous.width, rect.x + rect.width) - previous.x;
                previous.height = Math.max(previous.height, rect.height);
                previous.y = Math.min(previous.y, rect.y);
            } else {
                merged.push({ ...rect });
            }
        }

        return merged;
    }

    createAnnotationId() {
        return `ann_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    }

    cancelRenderTasks() {
        for (const view of this.pageViews) {
            view.renderTask?.cancel();
            view.textLayerTask?.cancel?.();
            if (view.textLayer) {
                view.textLayer.replaceChildren();
            }
            if (view.content) {
                view.content.style.visibility = 'visible';
            }
        }
    }

    handleViewerScroll() {
        if (this.pendingScrollFrame) return;

        this.pendingScrollFrame = requestAnimationFrame(() => {
            this.pendingScrollFrame = null;
            this.updateCurrentPage();
            this.queueVisiblePageRendering();
        });
    }

    getPageRenderKey(pageIndex) {
        return `${pageIndex}:${this.scale}:${this.pdfDarkMode ? 'dark' : 'light'}`;
    }

    getThumbnailRenderKey(pageIndex, maxThumbWidth) {
        return `${pageIndex}:${this.pdfDarkMode ? 'dark' : 'light'}:${Math.round(maxThumbWidth)}`;
    }

    getPageRenderWindow() {
        const center = Math.max(0, Math.min(this.currentPage, this.pages.length - 1));
        return {
            start: Math.max(0, center - PAGE_RENDER_BUFFER),
            end: Math.min(this.pages.length - 1, center + PAGE_RENDER_BUFFER)
        };
    }

    queueVisiblePageRendering() {
        if (!this.pdf) return;

        if (this.pendingPageRenderFrame) {
            cancelAnimationFrame(this.pendingPageRenderFrame);
        }

        const sessionId = this.renderSessionId;
        this.pendingPageRenderFrame = requestAnimationFrame(() => {
            this.pendingPageRenderFrame = null;
            this.renderPagesProgressively(sessionId);
        });
    }

    releasePageView(pageIndex) {
        const view = this.pageViews[pageIndex];
        if (!view) return;

        view.renderTask?.cancel();
        view.textLayerTask?.cancel?.();
        view.textLayer.replaceChildren();
        view.canvas.width = 0;
        view.canvas.height = 0;
        view.canvas.style.width = '0px';
        view.canvas.style.height = '0px';
        view.renderKey = null;
        view.renderingKey = null;
        this.annotationLayers[pageIndex]?.release();
        this.syncPageNoteRail(pageIndex);
    }

    releaseFarPageViews() {
        const center = Math.max(0, Math.min(this.currentPage, this.pages.length - 1));
        const keepStart = Math.max(0, center - PAGE_RELEASE_BUFFER);
        const keepEnd = Math.min(this.pages.length - 1, center + PAGE_RELEASE_BUFFER);

        for (let i = 0; i < this.pageViews.length; i++) {
            if (i < keepStart || i > keepEnd) {
                this.releasePageView(i);
            }
        }
    }

    disconnectThumbnailObserver() {
        this.thumbnailObserver?.disconnect();
        this.thumbnailObserver = null;
    }

    async requestThumbnailRender(pageIndex, sessionId = this.renderSessionId) {
        const thumbView = this.thumbnailViews[pageIndex];
        const container = document.getElementById('sidebarPages');
        if (!thumbView || !container || sessionId !== this.renderSessionId) return;

        const maxThumbWidth = Math.max(140, thumbView.element.clientWidth - 12);
        const renderKey = this.getThumbnailRenderKey(pageIndex, maxThumbWidth);
        if (thumbView.renderedKey === renderKey || thumbView.renderingKey === renderKey) return;
        thumbView.renderingKey = renderKey;

        try {
            const page = await this.getPdfPage(this.pages[pageIndex]);
            if (sessionId !== this.renderSessionId) return;

            const baseViewport = page.getViewport({ scale: 1 });
            const thumbScale = Math.min(0.5, maxThumbWidth / baseViewport.width);
            const viewport = page.getViewport({ scale: thumbScale });
            const outputScale = Math.min(4, (window.devicePixelRatio || 1) * 2);
            const renderWidth = Math.ceil(viewport.width * outputScale);
            const renderHeight = Math.ceil(viewport.height * outputScale);
            const canvas = thumbView.canvas;

            canvas.width = renderWidth;
            canvas.height = renderHeight;
            canvas.style.width = '100%';
            canvas.style.height = 'auto';

            if (this.pdfDarkMode) {
                const originalCanvas = this.createRenderCanvas(renderWidth, renderHeight);
                await this.renderPageBitmap(page, viewport, outputScale, originalCanvas);
                if (sessionId !== this.renderSessionId) return;

                const darkCanvas = this.createRenderCanvas(renderWidth, renderHeight);
                const darkContext = darkCanvas.getContext('2d', { alpha: false });
                const renderTask = page.render({
                    canvasContext: darkContext,
                    viewport,
                    transform: this.getRenderTransform(outputScale),
                    pageColors: this.getPdfPageColors(),
                    recordImages: true
                });

                await renderTask.promise;
                if (sessionId !== this.renderSessionId) return;

                this.restoreImageRegions(darkCanvas, originalCanvas, renderTask.imageCoordinates);
                const context = canvas.getContext('2d', { alpha: false });
                context.setTransform(1, 0, 0, 1, 0, 0);
                context.clearRect(0, 0, canvas.width, canvas.height);
                context.drawImage(darkCanvas, 0, 0);
            } else {
                const context = canvas.getContext('2d', { alpha: false });
                context.setTransform(1, 0, 0, 1, 0, 0);
                context.clearRect(0, 0, canvas.width, canvas.height);

                await page.render({
                    canvasContext: context,
                    viewport,
                    transform: this.getRenderTransform(outputScale)
                }).promise;
            }

            thumbView.renderedKey = renderKey;
        } catch (err) {
            if (err?.name === 'RenderingCancelledException' || err?.name === 'AbortException') return;
            console.error(`Failed to render thumbnail ${pageIndex + 1}:`, err);
        } finally {
            if (thumbView.renderingKey === renderKey) {
                thumbView.renderingKey = null;
            }
        }
    }

    syncPageNoteRail(pageIndex) {
        const view = this.pageViews[pageIndex];
        const layer = this.annotationLayers[pageIndex];
        if (!view || !layer) return;

        const contentWidth = parseFloat(view.content.style.width) || 0;
        const contentHeight = parseFloat(view.content.style.height) || 0;
        const showRail = layer.hasNotes();

        if (view.noteRail) {
            view.noteRail.hidden = !showRail;
        }

        view.wrapper.classList.toggle('has-notes', showRail);
        view.wrapper.style.width = `${contentWidth}px`;
        view.wrapper.style.height = `${contentHeight}px`;
    }

    nextFrame() {
        return new Promise(resolve => requestAnimationFrame(() => resolve()));
    }

    scrollViewerToPage(index, behavior = 'smooth') {
        const viewer = document.getElementById('viewer');
        const target = this.pageElements[index];
        if (!viewer || !target) return;

        const targetTop = target.offsetTop - 24;
        viewer.scrollTo({
            top: Math.max(0, targetTop),
            behavior
        });
    }

    goToPage(index) {
        if (index < 0 || index >= this.pages.length) return;

        this.currentPage = index;
        this.scrollViewerToPage(index);
        this.queueVisiblePageRendering();
        this.requestThumbnailRender(index);

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
            if (
                rect.top < viewerRect.top + viewerRect.height / 2 &&
                rect.bottom > viewerRect.top + viewerRect.height / 2
            ) {
                if (this.currentPage !== i) {
                    this.currentPage = i;
                    this.queueVisiblePageRendering();
                    this.requestThumbnailRender(i);
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
        const factor = scale / this.scale;
        this.scale = scale;
        document.getElementById('zoomLevel').textContent = `${Math.round(scale * 100)}%`;

        if (!this.pdf) return;

        this.scaleHistoryEntries(factor);

        this.renderSessionId += 1;
        this.cancelRenderTasks();
        this.annotationLayers.forEach(layer => layer.setScale(scale));
        this.queueVisiblePageRendering();
    }

    setTool(tool) {
        this.tool = tool;

        document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
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
        const ids = [
            'prevPage', 'nextPage', 'zoomIn', 'zoomOut', 'selectTool',
            'highlightTool', 'noteTool', 'drawTool', 'saveBtn', 'loadBtn',
            'undoBtn', 'redoBtn', 'pdfThemeBtn'
        ];
        ids.forEach(id => {
            document.getElementById(id).disabled = !enabled;
        });
        this.updateHistoryButtons();
        this.updatePdfThemeButton();
    }

    updatePageCount() {
        document.getElementById('totalPages').textContent = this.pages.length;
        document.getElementById('pageCount').textContent = this.pages.length;
    }

    setSidebarView(view) {
        this.sidebarView = view;
        document.getElementById('pagesNav').classList.toggle('active', view === 'pages');
        document.getElementById('notesNav').classList.toggle('active', view === 'annotations');
        document.getElementById('sidebarPages').hidden = view !== 'pages';
        document.getElementById('sidebarAnnotations').hidden = view !== 'annotations';

        if (view === 'annotations') {
            this.renderAnnotationList();
        } else {
            this.requestThumbnailRender(this.currentPage);
        }
    }

    renderAnnotationList() {
        const container = document.getElementById('sidebarAnnotations');
        if (!container) return;

        const annotations = this.getAllAnnotations()
            .slice()
            .sort((a, b) => a.pageIndex - b.pageIndex || a.type.localeCompare(b.type));

        container.innerHTML = '';

        if (!annotations.length) {
            container.innerHTML = '<div class="pages-empty"><p>No annotations yet</p></div>';
            return;
        }

        const list = document.createElement('div');
        list.className = 'annotation-list';

        for (const annotation of annotations) {
            const item = document.createElement('div');
            item.className = 'annotation-item';
            item.onclick = () => {
                this.goToPage(annotation.pageIndex);
                if (annotation.type === 'note') {
                    this.openNoteEditor(annotation);
                }
            };

            const swatch = document.createElement('span');
            swatch.className = 'annotation-swatch';
            swatch.style.background = annotation.color || '#fbbf24';

            const meta = document.createElement('div');
            meta.className = 'annotation-meta';

            const title = document.createElement('div');
            title.className = 'annotation-title';
            title.textContent = this.getAnnotationTitle(annotation);

            const subtitle = document.createElement('div');
            subtitle.className = 'annotation-subtitle';
            subtitle.textContent = `Page ${annotation.pageIndex + 1}`;

            meta.appendChild(title);
            meta.appendChild(subtitle);

            const actions = document.createElement('div');
            actions.className = 'annotation-actions';

            if (annotation.type === 'note') {
                const editBtn = document.createElement('button');
                editBtn.type = 'button';
                editBtn.className = 'annotation-action';
                editBtn.title = 'Edit note';
                editBtn.innerHTML = `
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                    </svg>
                `;
                editBtn.onclick = e => {
                    e.stopPropagation();
                    this.openNoteEditor(annotation);
                };
                actions.appendChild(editBtn);
            }

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'annotation-action delete';
            deleteBtn.title = 'Delete annotation';
            deleteBtn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18"/>
                    <path d="M8 6V4h8v2"/>
                    <path d="M19 6l-1 14H6L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                </svg>
            `;
            deleteBtn.onclick = e => {
                e.stopPropagation();
                this.removeAnnotation(annotation.pageIndex, annotation.id);
            };
            actions.appendChild(deleteBtn);

            item.appendChild(swatch);
            item.appendChild(meta);
            item.appendChild(actions);
            list.appendChild(item);
        }

        container.appendChild(list);
    }

    getAnnotationTitle(annotation) {
        if (annotation.type === 'note') {
            return annotation.text?.trim() || 'Empty note';
        }
        if (annotation.type === 'highlight') {
            return annotation.text?.trim() || 'Highlight';
        }
        return 'Drawing';
    }

    setTheme(theme) {
        this.theme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);

        document.querySelector('.icon-sun').style.display = theme === 'dark' ? 'none' : 'block';
        document.querySelector('.icon-moon').style.display = theme === 'dark' ? 'block' : 'none';

        if (this.pdfDarkMode && this.pdf) {
            this.rerenderPages(true);
        }
    }

    toggleTheme() {
        this.setTheme(this.theme === 'dark' ? 'light' : 'dark');
    }

    applyPdfDarkModeState() {
        document.body.classList.toggle('pdf-dark', this.pdfDarkMode);
        localStorage.setItem('pdfDarkMode', String(this.pdfDarkMode));
        this.updatePdfThemeButton();
    }

    updatePdfThemeButton() {
        const button = document.getElementById('pdfThemeBtn');
        if (!button) return;

        button.setAttribute('aria-pressed', this.pdfDarkMode ? 'true' : 'false');
    }

    togglePdfDarkMode() {
        if (!this.pdf) return;

        this.pdfDarkMode = !this.pdfDarkMode;
        this.applyPdfDarkModeState();
        this.rerenderPages(true);
    }

    rerenderPages(withThumbnails = true) {
        if (!this.pdf) return;

        this.renderSessionId += 1;
        this.cancelRenderTasks();
        this.queueVisiblePageRendering();

        if (withThumbnails) {
            this.renderThumbnailsProgressively(this.renderSessionId);
        }
    }

    showModal(id) {
        document.getElementById(id).style.display = 'flex';
    }

    hideModal(id) {
        document.getElementById(id).style.display = 'none';
    }

    openNoteEditor(note) {
        this.currentNote = this.cloneAnnotation(note);
        this.currentNoteOriginal = this.cloneAnnotation(note);
        const noteText = document.getElementById('noteText');
        noteText.value = note.text || '';
        this.showModal('noteModal');
        requestAnimationFrame(() => {
            try {
                noteText.focus({ preventScroll: true });
                noteText.setSelectionRange(noteText.value.length, noteText.value.length);
            } catch {
                noteText.focus();
            }
        });
    }

    saveNote() {
        if (!this.currentNote) {
            this.hideModal('noteModal');
            return;
        }

        const updatedNote = {
            ...this.currentNote,
            text: document.getElementById('noteText').value
        };
        const layer = this.annotationLayers[updatedNote.pageIndex];
        layer?.updateAnnotation(updatedNote);

        this.currentNote = updatedNote;
        this.currentNoteOriginal = this.cloneAnnotation(updatedNote);
        this.hideModal('noteModal');
        this.updateAnnotationCount();
    }

    deleteNote() {
        if (this.currentNote) {
            this.removeAnnotation(this.currentNote.pageIndex, this.currentNote.id);
        }
        this.hideModal('noteModal');
        this.currentNote = null;
        this.currentNoteOriginal = null;
        this.updateAnnotationCount();
    }

    getAllAnnotations() {
        return this.annotationLayers.flatMap(layer => layer.getAnnotations());
    }

    getAnnotationLayer(pageIndex) {
        return this.annotationLayers[pageIndex] || null;
    }

    removeAnnotation(pageIndex, annotationId, options = {}) {
        const layer = this.getAnnotationLayer(pageIndex);
        const removed = layer?.removeAnnotation(annotationId, options) || null;

        if (removed && this.currentNote?.id === annotationId) {
            this.currentNote = null;
            this.currentNoteOriginal = null;
            this.hideModal('noteModal');
        }

        if (removed && options.silent) {
            this.updateAnnotationCount();
            this.renderAnnotationList();
        }

        return removed;
    }

    updateAnnotationCount() {
        document.getElementById('annotationCount').textContent = this.getAllAnnotations().length;
        this.renderAnnotationList();
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

            this.undoStack = [];
            this.redoStack = [];
            this.annotationLayers.forEach(layer => layer.setAnnotations([]));
            annotations.forEach(annotation => {
                this.annotationLayers[annotation.pageIndex]?.addAnnotation(annotation, { silent: true });
            });

            this.updateAnnotationCount();
            this.updateHistoryButtons();
            this.toast(`Loaded ${annotations.length} annotations`, 'success');
        } catch {
            this.toast('Failed to load annotations', 'error');
        }
    }

    cloneAnnotation(annotation) {
        return annotation ? structuredClone(annotation) : null;
    }

    scaleAnnotation(annotation, factor) {
        if (!annotation || !Number.isFinite(factor) || factor === 1) {
            return annotation ? this.cloneAnnotation(annotation) : null;
        }

        const scaled = this.cloneAnnotation(annotation);

        if (scaled.type === 'highlight') {
            scaled.rect.x *= factor;
            scaled.rect.y *= factor;
            scaled.rect.width *= factor;
            scaled.rect.height *= factor;
            if (scaled.rects?.length) {
                scaled.rects = scaled.rects.map(rect => ({
                    x: rect.x * factor,
                    y: rect.y * factor,
                    width: rect.width * factor,
                    height: rect.height * factor
                }));
            }
        } else if (scaled.type === 'note') {
            scaled.x *= factor;
            scaled.y *= factor;
        } else if (scaled.type === 'drawing') {
            scaled.path = scaled.path.map(point => ({
                x: point.x * factor,
                y: point.y * factor
            }));
        }

        return scaled;
    }

    scaleHistoryEntries(factor) {
        if (!Number.isFinite(factor) || factor === 1) return;

        const scaleEntry = entry => ({
            before: this.scaleAnnotation(entry.before, factor),
            after: this.scaleAnnotation(entry.after, factor)
        });

        this.undoStack = this.undoStack.map(scaleEntry);
        this.redoStack = this.redoStack.map(scaleEntry);
    }

    updateHistoryButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        if (!undoBtn || !redoBtn) return;

        const enabled = !!this.pdf;
        undoBtn.disabled = !enabled || this.undoStack.length === 0;
        redoBtn.disabled = !enabled || this.redoStack.length === 0;
    }

    createHistoryEntry(detail) {
        if (detail.action === 'add') {
            return {
                before: null,
                after: this.cloneAnnotation(detail.annotation)
            };
        }

        if (detail.action === 'remove') {
            return {
                before: this.cloneAnnotation(detail.annotation),
                after: null
            };
        }

        if (detail.action === 'update') {
            return {
                before: this.cloneAnnotation(detail.previousAnnotation),
                after: this.cloneAnnotation(detail.annotation)
            };
        }

        return null;
    }

    handleAnnotationChange(detail) {
        if (!detail) return;

        if (!this.isApplyingHistory) {
            const entry = this.createHistoryEntry(detail);
            if (entry) {
                this.undoStack.push(entry);
                this.redoStack = [];
            }
        }

        const pageIndex = detail.annotation?.pageIndex ?? detail.previousAnnotation?.pageIndex;
        if (Number.isInteger(pageIndex)) {
            this.syncPageNoteRail(pageIndex);
        }

        this.updateAnnotationCount();
        this.updateHistoryButtons();
    }

    applyHistoryEntry(entry, direction) {
        const target = direction === 'undo' ? entry.before : entry.after;
        const opposite = direction === 'undo' ? entry.after : entry.before;
        const pageIndex = target?.pageIndex ?? opposite?.pageIndex;
        const layer = this.getAnnotationLayer(pageIndex);
        if (!layer) return;

        this.isApplyingHistory = true;

        try {
            if (target && opposite) {
                layer.updateAnnotation(this.cloneAnnotation(target), { silent: true });
            } else if (target && !opposite) {
                layer.addAnnotation(this.cloneAnnotation(target), { silent: true });
            } else if (!target && opposite) {
                layer.removeAnnotation(opposite.id, { silent: true });
            }
        } finally {
            this.isApplyingHistory = false;
        }

        if (this.currentNote && !this.getAnnotationLayer(this.currentNote.pageIndex)?.getAnnotation(this.currentNote.id)) {
            this.currentNote = null;
            this.currentNoteOriginal = null;
            this.hideModal('noteModal');
        }

        this.updateAnnotationCount();
        this.updateHistoryButtons();
    }

    undo() {
        if (!this.undoStack.length) return;

        const entry = this.undoStack.pop();
        this.applyHistoryEntry(entry, 'undo');
        this.redoStack.push(entry);
        this.updateHistoryButtons();
        this.toast('Undid annotation change', 'info');
    }

    redo() {
        if (!this.redoStack.length) return;

        const entry = this.redoStack.pop();
        this.applyHistoryEntry(entry, 'redo');
        this.undoStack.push(entry);
        this.updateHistoryButtons();
        this.toast('Redid annotation change', 'info');
    }

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

document.addEventListener('annotationChange', event => {
    window.app?.handleAnnotationChange(event.detail);
});

document.addEventListener('DOMContentLoaded', () => {
    try {
        window.app = new App();
    } catch (e) {
        console.error('Failed to initialize app:', e);
    }
});
