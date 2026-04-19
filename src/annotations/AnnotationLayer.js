/**
 * Annotation Layer
 *
 * Manages the annotation overlay for a page:
 * - Renders annotations on a transparent canvas
 * - Handles mouse events for creating/editing annotations
 * - Coordinates between different annotation tools
 */

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
        this.canvas.classList.toggle('active', tool !== null && tool !== 'select');

        // Update cursor
        switch (tool) {
            case 'highlight':
                this.canvas.style.cursor = 'text';
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
            // Create highlight annotation
            const highlight = {
                type: 'highlight',
                color: this.activeColor,
                rect: {
                    x: Math.min(this.startX, x),
                    y: Math.min(this.startY, y),
                    width: Math.abs(x - this.startX),
                    height: Math.abs(y - this.startY)
                },
                pageIndex: this.pageIndex,
                id: this.generateId()
            };

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
                if (x >= ann.rect.x && x <= ann.rect.x + ann.rect.width &&
                    y >= ann.rect.y && y <= ann.rect.y + ann.rect.height) {
                    return ann;
                }
            }
        }
        return null;
    }

    // Open note editor
    openNoteEditor(note) {
        const editor = document.getElementById('noteEditor');
        const textarea = document.getElementById('noteText');
        const saveBtn = document.getElementById('saveNoteBtn');
        const deleteBtn = document.getElementById('deleteNoteBtn');
        const cancelBtn = document.getElementById('cancelNoteBtn');

        textarea.value = note.text || '';

        // Position editor near note
        const pageRect = this.pageWrapper.getBoundingClientRect();
        const scrollContainer = document.getElementById('viewerContainer');
        const scrollRect = scrollContainer.getBoundingClientRect();

        let left = pageRect.left + note.x + 20;
        let top = pageRect.top + note.y - scrollRect.top + scrollContainer.scrollTop;

        // Keep in bounds
        if (left + 280 > window.innerWidth) {
            left = pageRect.left + note.x - 300;
        }

        editor.style.left = left + 'px';
        editor.style.top = top + 'px';
        editor.style.display = 'block';

        textarea.focus();

        // Event handlers
        const save = () => {
            note.text = textarea.value;
            this.dispatchAnnotationEvent('update', note);
            close();
        };

        const deleteNote = () => {
            this.removeAnnotation(note.id);
            close();
        };

        const close = () => {
            editor.style.display = 'none';
            saveBtn.removeEventListener('click', save);
            deleteBtn.removeEventListener('click', deleteNote);
            cancelBtn.removeEventListener('click', close);
        };

        saveBtn.addEventListener('click', save);
        deleteBtn.addEventListener('click', deleteNote);
        cancelBtn.addEventListener('click', close);
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
    removeAnnotation(id) {
        const index = this.annotations.findIndex(a => a.id === id);
        if (index !== -1) {
            const annotation = this.annotations[index];
            this.annotations.splice(index, 1);
            this.dispatchAnnotationEvent('remove', annotation);
            this.render();
        }
    }

    // Add annotation
    addAnnotation(annotation) {
        this.annotations.push(annotation);
        this.render();
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
        this.ctx.fillRect(ann.rect.x, ann.rect.y, ann.rect.width, ann.rect.height);
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
        this.scale = scale;
    }
}
