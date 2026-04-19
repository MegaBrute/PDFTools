/**
 * Annotation Layer
 *
 * Manages the annotation overlay for a page:
 * - Renders annotations on a transparent canvas
 * - Handles mouse events for creating/editing annotations
 * - Coordinates between different annotation tools
 */

import { Highlighter } from './Highlighter.js';

export class AnnotationLayer {
    constructor(pageWrapper, pageIndex, scale) {
        this.pageWrapper = pageWrapper;
        this.pageIndex = pageIndex;
        this.scale = scale;
        this.annotations = [];
        this.canvas = null;
        this.ctx = null;
        this.activeTool = null;
        this.activeColor = '#FFEB3B';
        this.isDrawing = false;
        this.textPositions = [];
        this.highlighter = new Highlighter();

        this.init();
    }

    init() {
        // Create annotation canvas
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'annotation-layer';
        this.pageWrapper.appendChild(this.canvas);

        this.ctx = this.canvas.getContext('2d');

        // Set up event listeners
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this));
    }

    // Set canvas size to match page
    setSize(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';
        this.render();
    }

    // Set text positions from page rendering
    setTextPositions(positions) {
        this.textPositions = positions;
    }

    // Set active tool
    setTool(tool) {
        this.activeTool = tool;
        const isCanvasTool = tool === 'draw' || tool === 'note';
        this.canvas.classList.toggle('active', isCanvasTool);

        // Update cursor
        switch (tool) {
            case 'highlight':
                this.canvas.style.cursor = 'default';
                break;
            case 'note':
                this.canvas.style.cursor = 'crosshair';
                break;
            case 'draw':
                this.canvas.style.cursor = 'crosshair';
                break;
            default:
                this.canvas.style.cursor = 'default';
        }
    }

    // Set active color
    setColor(color) {
        this.activeColor = color;
        this.highlighter.setColor(color);
    }

    // Handle mouse down
    handleMouseDown(e) {
        if (!this.activeTool || this.activeTool === 'select') return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        this.isDrawing = true;
        this.startX = x;
        this.startY = y;
        this.currentPath = [{ x, y }];

        if (this.activeTool === 'draw') {
            this.tempCanvas = document.createElement('canvas');
            this.tempCanvas.width = this.canvas.width;
            this.tempCanvas.height = this.canvas.height;
            this.tempCtx = this.tempCanvas.getContext('2d');
            this.tempCtx.strokeStyle = this.activeColor;
            this.tempCtx.lineWidth = 2;
            this.tempCtx.lineCap = 'round';
            this.tempCtx.lineJoin = 'round';
            this.tempCtx.beginPath();
            this.tempCtx.moveTo(x, y);
        }
    }

    // Handle mouse move
    handleMouseMove(e) {
        if (!this.isDrawing) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (this.activeTool === 'draw') {
            this.currentPath.push({ x, y });
            this.tempCtx.lineTo(x, y);
            this.tempCtx.stroke();
            this.tempCtx.beginPath();
            this.tempCtx.moveTo(x, y);

            // Render to main canvas
            this.render();
            this.ctx.drawImage(this.tempCanvas, 0, 0);
        } else if (this.activeTool === 'highlight') {
            // Show selection preview
            this.render();
            this.ctx.fillStyle = this.activeColor + '50';
            const width = x - this.startX;
            const height = y - this.startY;
            this.ctx.fillRect(this.startX, this.startY, width, height);
        }
    }

    // Handle mouse up
    handleMouseUp(e) {
        if (!this.isDrawing) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        this.isDrawing = false;

        if (this.activeTool === 'highlight') {
            const highlight = this.highlighter.createHighlightFromText(
                this.textPositions,
                this.startX,
                this.startY,
                x,
                y,
                this.scale
            );

            highlight.color = this.activeColor;
            highlight.pageIndex = this.pageIndex;
            highlight.id = this.generateId();

            if (highlight.rect.width > 5 && highlight.rect.height > 5) {
                this.annotations.push(highlight);
                this.dispatchAnnotationEvent('add', highlight);
            }
        } else if (this.activeTool === 'draw') {
            // Create drawing annotation
            const drawing = {
                type: 'drawing',
                color: this.activeColor,
                path: [...this.currentPath],
                pageIndex: this.pageIndex,
                id: this.generateId()
            };

            if (this.currentPath.length > 1) {
                this.annotations.push(drawing);
                this.dispatchAnnotationEvent('add', drawing);
            }

            this.tempCanvas = null;
            this.tempCtx = null;
        } else if (this.activeTool === 'note') {
            // Create note annotation
            const note = {
                type: 'note',
                color: this.activeColor,
                x: x,
                y: y,
                text: '',
                pageIndex: this.pageIndex,
                id: this.generateId()
            };

            this.annotations.push(note);
            this.dispatchAnnotationEvent('add', note);

            // Open note editor
            this.openNoteEditor(note);
        }

        this.currentPath = [];
        this.render();
    }

    // Handle double click (edit note)
    handleDoubleClick(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Check if clicked on a note
        const note = this.findAnnotationAt(x, y, 'note');
        if (note) {
            this.openNoteEditor(note);
        }
    }

    // Find annotation at position
    findAnnotationAt(x, y, type = null) {
        for (let i = this.annotations.length - 1; i >= 0; i--) {
            const ann = this.annotations[i];

            if (type && ann.type !== type) continue;

            if (ann.type === 'note') {
                // Note icon hit test (24x24)
                if (x >= ann.x - 12 && x <= ann.x + 12 &&
                    y >= ann.y - 12 && y <= ann.y + 12) {
                    return ann;
                }
            } else if (ann.type === 'highlight') {
                const rects = ann.rects?.length ? ann.rects : [ann.rect];
                for (const rect of rects) {
                    if (x >= rect.x && x <= rect.x + rect.width &&
                        y >= rect.y && y <= rect.y + rect.height) {
                        return ann;
                    }
                }
            } else if (ann.type === 'drawing') {
                for (let j = 0; j < ann.path.length; j++) {
                    const point = ann.path[j];
                    if (Math.abs(point.x - x) <= 8 && Math.abs(point.y - y) <= 8) {
                        return ann;
                    }
                }
            }
        }
        return null;
    }

    // Open note editor
    openNoteEditor(note) {
        window.app?.openNoteEditor(note);
    }

    // Generate unique ID
    generateId() {
        return 'ann_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    // Dispatch annotation event
    dispatchAnnotationEvent(action, annotation) {
        const event = new CustomEvent('annotationChange', {
            detail: { action, annotation }
        });
        document.dispatchEvent(event);
    }

    // Remove annotation
    removeAnnotation(id, options = {}) {
        const index = this.annotations.findIndex(a => a.id === id);
        if (index !== -1) {
            const annotation = this.annotations[index];
            this.annotations.splice(index, 1);
            if (!options.silent) {
                this.dispatchAnnotationEvent('remove', annotation);
            }
            this.render();
            return annotation;
        }

        return null;
    }

    // Add annotation
    addAnnotation(annotation, options = {}) {
        this.annotations.push(annotation);
        if (!options.silent) {
            this.dispatchAnnotationEvent('add', annotation);
        }
        this.render();
    }

    // Get annotation by ID
    getAnnotation(id) {
        return this.annotations.find(annotation => annotation.id === id) || null;
    }

    // Update annotation
    updateAnnotation(annotation, options = {}) {
        const index = this.annotations.findIndex(item => item.id === annotation.id);
        if (index === -1) return null;

        const previousAnnotation = this.annotations[index];
        this.annotations[index] = annotation;

        if (!options.silent) {
            const event = new CustomEvent('annotationChange', {
                detail: {
                    action: 'update',
                    annotation,
                    previousAnnotation
                }
            });
            document.dispatchEvent(event);
        }

        this.render();
        return annotation;
    }

    // Get all annotations
    getAnnotations() {
        return this.annotations;
    }

    // Set annotations (for loading)
    setAnnotations(annotations) {
        this.annotations = annotations.filter(a => a.pageIndex === this.pageIndex);
        this.render();
    }

    // Render all annotations
    render() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        for (const ann of this.annotations) {
            switch (ann.type) {
                case 'highlight':
                    this.renderHighlight(ann);
                    break;
                case 'note':
                    this.renderNote(ann);
                    break;
                case 'drawing':
                    this.renderDrawing(ann);
                    break;
            }
        }
    }

    // Render highlight annotation
    renderHighlight(ann) {
        this.ctx.fillStyle = ann.color + '59'; // Add transparency
        const rects = ann.rects?.length ? ann.rects : [ann.rect];
        for (const rect of rects) {
            this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        }
    }

    // Render note annotation
    renderNote(ann) {
        // Draw note icon
        this.ctx.fillStyle = ann.color;
        this.ctx.beginPath();

        // Simple note icon shape
        const x = ann.x;
        const y = ann.y;
        const size = 20;

        this.ctx.moveTo(x - size/2, y - size/2);
        this.ctx.lineTo(x + size/2, y - size/2);
        this.ctx.lineTo(x + size/2, y + size/4);
        this.ctx.lineTo(x + size/4, y + size/2);
        this.ctx.lineTo(x - size/2, y + size/2);
        this.ctx.closePath();

        this.ctx.fill();

        // Folded corner
        this.ctx.fillStyle = this.adjustColor(ann.color, -30);
        this.ctx.beginPath();
        this.ctx.moveTo(x + size/2, y + size/4);
        this.ctx.lineTo(x + size/4, y + size/4);
        this.ctx.lineTo(x + size/4, y + size/2);
        this.ctx.closePath();
        this.ctx.fill();

        // Border
        this.ctx.strokeStyle = this.adjustColor(ann.color, -50);
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(x - size/2, y - size/2);
        this.ctx.lineTo(x + size/2, y - size/2);
        this.ctx.lineTo(x + size/2, y + size/4);
        this.ctx.lineTo(x + size/4, y + size/2);
        this.ctx.lineTo(x - size/2, y + size/2);
        this.ctx.closePath();
        this.ctx.stroke();
    }

    // Render drawing annotation
    renderDrawing(ann) {
        if (ann.path.length < 2) return;

        this.ctx.strokeStyle = ann.color;
        this.ctx.lineWidth = 2;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        this.ctx.beginPath();
        this.ctx.moveTo(ann.path[0].x, ann.path[0].y);

        for (let i = 1; i < ann.path.length; i++) {
            this.ctx.lineTo(ann.path[i].x, ann.path[i].y);
        }

        this.ctx.stroke();
    }

    // Adjust color brightness
    adjustColor(hex, amount) {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.max(0, Math.min(255, (num >> 16) + amount));
        const g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
        const b = Math.max(0, Math.min(255, (num & 0x0000FF) + amount));
        return '#' + (0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    // Update scale
    setScale(scale) {
        if (this.scale && this.scale !== scale) {
            const factor = scale / this.scale;

            for (const ann of this.annotations) {
                if (ann.type === 'highlight') {
                    ann.rect.x *= factor;
                    ann.rect.y *= factor;
                    ann.rect.width *= factor;
                    ann.rect.height *= factor;
                } else if (ann.type === 'note') {
                    ann.x *= factor;
                    ann.y *= factor;
                } else if (ann.type === 'drawing') {
                    ann.path = ann.path.map(point => ({
                        x: point.x * factor,
                        y: point.y * factor
                    }));
                }
            }
        }

        this.scale = scale;
        this.render();
    }
}
