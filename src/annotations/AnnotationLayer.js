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
        this.textModel = { items: [] };
        this.textModelVersion = 0;
        this.pageWidth = 0;
        this.noteRail = null;

        this.init();
    }

    init() {
        // Create annotation canvas
        this.canvas = document.createElement('canvas');
        this.canvas.className = 'annotation-layer';
        this.pageWrapper.appendChild(this.canvas);
        this.canvas.width = 1;
        this.canvas.height = 1;
        this.canvas.style.width = '0px';
        this.canvas.style.height = '0px';

        this.ctx = this.canvas.getContext('2d');
        this.noteRail = this.pageWrapper.querySelector('.page-note-rail');

        // Set up event listeners
        this.canvas.addEventListener('mousedown', this.handleMouseDown.bind(this));
        this.canvas.addEventListener('mousemove', this.handleMouseMove.bind(this));
        this.canvas.addEventListener('mouseup', this.handleMouseUp.bind(this));
        this.canvas.addEventListener('dblclick', this.handleDoubleClick.bind(this));
    }

    // Set canvas size to match page
    setSize(width, height, pageWidth = width) {
        this.pageWidth = pageWidth;
        this.canvas.width = width;
        this.canvas.height = height;
        this.canvas.style.width = width + 'px';
        this.canvas.style.height = height + 'px';
        this.normalizeNotePositions();
        this.render();
    }

    release() {
        this.canvas.width = 1;
        this.canvas.height = 1;
        this.canvas.style.width = '0px';
        this.canvas.style.height = '0px';
        this.ctx = this.canvas.getContext('2d');
        this.pageWrapper.classList.remove('has-notes');
        this.renderNoteCards([]);
    }

    // Set text model from page rendering
    setTextModel(textModel) {
        this.textModel = textModel ?? { items: [] };
        this.textModelVersion += 1;
        this.normalizeNotePositions();
        this.refreshTextAnchoredAnnotations();
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
        }
    }

    // Handle mouse up
    handleMouseUp(e) {
        if (!this.isDrawing) return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        this.isDrawing = false;

        if (this.activeTool === 'draw') {
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
            const textAnchor = this.getNearestTextAnchor(y);
            const noteAnchorY = this.getNearestTextAnchorY(y);
            const note = {
                type: 'note',
                color: this.activeColor,
                y: noteAnchorY,
                textAnchor,
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
                const noteX = this.getNoteX();
                const noteY = this.getNoteYForAnnotation(ann);
                // Note icon hit test (24x24)
                if (x >= noteX - 12 && x <= noteX + 12 &&
                    y >= noteY - 12 && y <= noteY + 12) {
                    return ann;
                }
            } else if (ann.type === 'highlight') {
                const rects = this.getHighlightRects(ann);
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
            if (options.render !== false) {
                this.render();
            }
            return annotation;
        }

        return null;
    }

    // Add annotation
    addAnnotation(annotation, options = {}) {
        if (annotation.type === 'note' && !annotation.textAnchor) {
            annotation.textAnchor = this.getNearestTextAnchor(annotation.y);
        }
        if (annotation.type === 'highlight') {
            delete annotation._anchorVersion;
            this.ensureHighlightAnchor(annotation, annotation.rects?.length ? annotation.rects : (annotation.rect ? [annotation.rect] : []));
            delete annotation.rect;
            delete annotation.rects;
        }
        this.annotations.push(annotation);
        if (!options.silent) {
            this.dispatchAnnotationEvent('add', annotation);
        }
        if (options.render !== false) {
            this.render();
        }
    }

    // Get annotation by ID
    getAnnotation(id) {
        return this.annotations.find(annotation => annotation.id === id) || null;
    }

    // Update annotation
    updateAnnotation(annotation, options = {}) {
        const index = this.annotations.findIndex(item => item.id === annotation.id);
        if (index === -1) return null;

        if (annotation.type === 'note' && !annotation.textAnchor) {
            annotation.textAnchor = this.getNearestTextAnchor(annotation.y);
        }
        if (annotation.type === 'highlight') {
            delete annotation._anchorVersion;
            this.ensureHighlightAnchor(annotation, annotation.rects?.length ? annotation.rects : (annotation.rect ? [annotation.rect] : []));
            delete annotation.rect;
            delete annotation.rects;
        }
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

        if (options.render !== false) {
            this.render();
        }
        return annotation;
    }

    // Get all annotations
    getAnnotations() {
        return this.annotations;
    }

    hasNotes() {
        return this.annotations.some(annotation => annotation.type === 'note');
    }

    // Set annotations (for loading)
    setAnnotations(annotations, options = {}) {
        this.annotations = annotations.filter(a => a.pageIndex === this.pageIndex);
        this.normalizeNotePositions();
        if (options.render !== false) {
            this.render();
        }
    }

    // Render all annotations
    render() {
        this.pageWrapper.classList.toggle('has-notes', this.hasNotes());
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.renderNoteCards(this.annotations.filter(annotation => annotation.type === 'note'));

        for (const ann of this.annotations) {
            switch (ann.type) {
                case 'highlight':
                    this.renderHighlight(ann);
                    break;
                case 'note':
                    break;
                case 'drawing':
                    this.renderDrawing(ann);
                    break;
            }
        }
    }

    // Render highlight annotation
    renderHighlight(ann) {
        this.ctx.fillStyle = this.hexToRgba(ann.color, 0.34);
        const rects = this.getHighlightRects(ann);
        for (const rect of rects) {
            const insetY = Math.min(2.5, rect.height * 0.16);
            const insetX = Math.min(1.5, rect.height * 0.08);
            const x = rect.x + insetX;
            const y = rect.y + insetY;
            const width = Math.max(1, rect.width - insetX * 2);
            const height = Math.max(1, rect.height - insetY * 2);
            const radius = Math.min(4, height / 3);

            this.ctx.beginPath();
            this.ctx.roundRect(x, y, width, height, radius);
            this.ctx.fill();
        }
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

    hexToRgba(hex, alpha) {
        const value = hex.replace('#', '');
        const normalized = value.length === 3
            ? value.split('').map(char => char + char).join('')
            : value.padEnd(6, '0').slice(0, 6);
        const numeric = Number.parseInt(normalized, 16);
        const r = (numeric >> 16) & 255;
        const g = (numeric >> 8) & 255;
        const b = numeric & 255;
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
                    if (ann.rects?.length) {
                        ann.rects = ann.rects.map(rect => ({
                            x: rect.x * factor,
                            y: rect.y * factor,
                            width: rect.width * factor,
                            height: rect.height * factor
                        }));
                    }
                } else if (ann.type === 'note') {
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
        this.normalizeNotePositions();
        this.render();
    }

    getNoteX() {
        if (!this.canvas.width || !this.pageWidth) return 0;
        return this.pageWidth + Math.max(12, (this.canvas.width - this.pageWidth) / 2);
    }

    renderNoteCards(notes) {
        if (!this.noteRail) return;

        this.noteRail.replaceChildren();

        for (const ann of notes) {
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'note-rail-card';
            card.style.top = `${Math.max(8, Math.min(this.canvas.height - 88, this.getNoteYForAnnotation(ann) - 18))}px`;
            card.style.setProperty('--note-accent', ann.color || '#fbbf24');
            card.onclick = () => this.openNoteEditor(ann);

            const title = document.createElement('div');
            title.className = 'note-rail-title';
            title.textContent = ann.text?.trim() ? 'Note' : 'Empty note';

            const body = document.createElement('div');
            body.className = 'note-rail-body';
            body.textContent = ann.text?.trim() || 'Click to add your note.';

            card.appendChild(title);
            card.appendChild(body);
            this.noteRail.appendChild(card);
        }
    }

    normalizeNotePositions() {
        if (!this.pageWidth || !this.canvas.height) return;

        for (const ann of this.annotations) {
            if (ann.type !== 'note') continue;
            if (!ann.textAnchor) {
                ann.textAnchor = this.getNearestTextAnchor(ann.y);
                ann.y = Math.max(16, Math.min(this.canvas.height - 16, ann.y));
            }
        }
    }

    getNearestTextAnchorY(y) {
        const anchor = this.getNearestTextAnchor(y);
        const anchorRect = anchor ? this.getRectForTextAnchor(anchor) : null;
        if (anchorRect) {
            return anchorRect.y + anchorRect.height / 2;
        }

        if (!this.textModel.items.length) {
            return y;
        }

        let closest = this.textModel.items[0];
        let closestDistance = Math.abs((closest.y + closest.height / 2) - y);

        for (const position of this.textModel.items) {
            const centerY = position.y + position.height / 2;
            const distance = Math.abs(centerY - y);
            if (distance < closestDistance) {
                closest = position;
                closestDistance = distance;
            }
        }

        return closest.y + closest.height / 2;
    }

    getNearestTextAnchor(y) {
        const items = this.textModel.items;
        if (!items.length) return null;

        let closestIndex = items[0].itemIndex;
        let closestDistance = Number.POSITIVE_INFINITY;
        items.forEach(item => {
            const centerY = item.y + item.height / 2;
            const distance = Math.abs(centerY - y);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = item.itemIndex;
            }
        });

        return { itemIndex: closestIndex, offset: 0 };
    }

    getRectForTextAnchor(anchor) {
        if (!anchor) return null;
        const item = this.getTextItemByIndex(anchor.itemIndex);
        if (!item) return null;
        const offset = Math.max(0, Math.min(item.text.length, anchor.offset ?? 0));
        const endOffset = Math.min(item.text.length, Math.max(offset + 1, item.text.length ? offset + 1 : offset));
        return this.getItemRectForOffsets(item, offset, endOffset)
            ?? this.getItemRectForOffsets(item, 0, item.text.length);
    }

    getNoteYForAnnotation(annotation) {
        const anchorRect = annotation.textAnchor ? this.getRectForTextAnchor(annotation.textAnchor) : null;
        if (anchorRect) {
            return anchorRect.y + anchorRect.height / 2;
        }
        return annotation.y ?? 16;
    }

    getHighlightRects(annotation) {
        const legacyRects = annotation.rects?.length ? annotation.rects : (annotation.rect ? [annotation.rect] : []);

        const anchoredRects = annotation.anchorRange ? this.resolveRectsFromAnchorRange(annotation.anchorRange) : [];
        if (anchoredRects.length) {
            const mergedRects = this.mergeHighlightRects(anchoredRects);
            annotation.rects = mergedRects;
            annotation.rect = this.getBoundingRect(mergedRects);
            return mergedRects;
        }

        return this.mergeHighlightRects(legacyRects);
    }

    refreshTextAnchoredAnnotations() {
        for (const annotation of this.annotations) {
            if (annotation.type === 'highlight') {
                this.ensureHighlightAnchor(annotation, annotation.rects?.length ? annotation.rects : (annotation.rect ? [annotation.rect] : []));
                delete annotation.rect;
                delete annotation.rects;
                annotation._anchorVersion = this.textModelVersion;
            } else if (annotation.type === 'note' && annotation.textAnchor) {
                annotation._anchorVersion = this.textModelVersion;
            }
        }
    }

    ensureHighlightAnchor(annotation, legacyRects = []) {
        if (!annotation) return;
        if (annotation._anchorVersion === this.textModelVersion) return;

        if (!annotation.anchorRange && legacyRects.length) {
            const recoveredFromRects = this.findAnchorRangeForLegacyRects(legacyRects);
            if (recoveredFromRects) {
                annotation.anchorRange = recoveredFromRects;
            }
        }

        if (!annotation.text?.trim()) {
            return;
        }

        const currentScore = annotation.anchorRange
            ? this.getAnchorRangeMatchScore(annotation.anchorRange, annotation.text)
            : 0;

        if (annotation.anchorRange && currentScore >= 0.92) {
            return;
        }

        const recoveredAnchorRange = this.findAnchorRangeForText(annotation.text);
        if (!recoveredAnchorRange) {
            return;
        }

        const recoveredScore = this.getAnchorRangeMatchScore(recoveredAnchorRange, annotation.text);
        const currentHasRects = annotation.anchorRange && this.resolveRectsFromAnchorRange(annotation.anchorRange).length > 0;
        const shouldReplace = !annotation.anchorRange
            || !currentHasRects
            || recoveredScore > currentScore + 0.03;

        if (shouldReplace) {
            annotation.anchorRange = recoveredAnchorRange;
        }

        annotation._anchorVersion = this.textModelVersion;
    }

    resolveRectsFromAnchorRange(anchorRange) {
        const start = anchorRange?.start;
        const end = anchorRange?.end;
        if (!start || !end) return [];

        const startIndex = start.itemIndex;
        const endIndex = end.itemIndex;
        if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
            return [];
        }

        const items = this.textModel.items.filter(item => item.itemIndex >= startIndex && item.itemIndex <= endIndex);
        if (!items.length) return [];

        return items
            .map(item => {
                const isStart = item.itemIndex === startIndex;
                const isEnd = item.itemIndex === endIndex;
                const startOffset = isStart ? (start.offset ?? 0) : 0;
                const endOffset = isEnd ? (end.offset ?? item.text.length) : item.text.length;
                return this.getItemRectForOffsets(item, startOffset, endOffset);
            })
            .filter(Boolean);
    }

    getBoundingRect(rects) {
        const minX = Math.min(...rects.map(rect => rect.x));
        const minY = Math.min(...rects.map(rect => rect.y));
        const maxX = Math.max(...rects.map(rect => rect.x + rect.width));
        const maxY = Math.max(...rects.map(rect => rect.y + rect.height));

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    mergeHighlightRects(rects) {
        if (!rects.length) return [];

        const sortedRects = rects
            .map(rect => ({ ...rect }))
            .sort((a, b) => (Math.abs(a.y - b.y) < 4 ? a.x - b.x : a.y - b.y));

        const merged = [];
        for (const rect of sortedRects) {
            const previous = merged[merged.length - 1];
            const sameLine = previous
                && Math.abs(previous.y - rect.y) < 6
                && Math.abs(previous.height - rect.height) < 8;
            const closeEnough = sameLine && rect.x <= previous.x + previous.width + 20;

            if (closeEnough) {
                const maxRight = Math.max(previous.x + previous.width, rect.x + rect.width);
                previous.x = Math.min(previous.x, rect.x);
                previous.y = Math.min(previous.y, rect.y);
                previous.width = maxRight - previous.x;
                previous.height = Math.max(previous.height, rect.height);
            } else {
                merged.push(rect);
            }
        }

        return merged;
    }

    findAnchorRangeForText(text) {
        const items = this.textModel.items;
        if (!items.length || !text?.trim()) return null;

        const preciseAnchorRange = this.findCompactAnchorRangeForText(items, text);
        if (preciseAnchorRange) {
            return preciseAnchorRange;
        }

        const quote = this.normalizeTextForSearch(text);
        if (!quote) return null;

        const mappedItems = items
            .map(item => ({
                itemIndex: item.itemIndex,
                text: this.normalizeTextForSearch(item.text || '')
            }))
            .filter(item => item.text);

        if (!mappedItems.length) return null;

        let cursor = 0;
        const joined = mappedItems.map(item => {
            const start = cursor;
            cursor += item.text.length;
            const end = cursor;
            cursor += 1;
            return {
                ...item,
                start,
                end
            };
        });

        const haystack = joined.map(item => item.text).join(' ');
        const matchIndex = haystack.indexOf(quote);
        if (matchIndex === -1) {
            return this.findFuzzyAnchorRangeForText(items, quote);
        }

        const matchEnd = matchIndex + quote.length;
        const startSpan = joined.find(item => item.end > matchIndex);
        const endSpan = [...joined].reverse().find(item => item.start < matchEnd);
        if (!startSpan || !endSpan) return null;

        return {
            start: {
                itemIndex: startSpan.itemIndex,
                offset: 0
            },
            end: {
                itemIndex: endSpan.itemIndex,
                offset: this.getTextItemByIndex(endSpan.itemIndex)?.text?.length ?? 0
            }
        };
    }

    findCompactAnchorRangeForText(items, text) {
        const quote = this.compactSearchText(text);
        if (!quote) return null;

        let compactText = '';
        const positions = [];

        items.forEach(item => {
            const source = item.text || '';
            for (let offset = 0; offset < source.length; offset++) {
                const expanded = this.expandCompactChars(source[offset]);
                for (const char of expanded) {
                    compactText += char;
                    positions.push({ itemIndex: item.itemIndex, offset });
                }
            }
        });

        const startIndex = compactText.indexOf(quote);
        if (startIndex === -1) {
            return null;
        }

        const start = positions[startIndex];
        const end = positions[startIndex + quote.length - 1];
        if (!start || !end) {
            return null;
        }

        return {
            start: {
                itemIndex: start.itemIndex,
                offset: start.offset
            },
            end: {
                itemIndex: end.itemIndex,
                offset: end.offset + 1
            }
        };
    }

    findFuzzyAnchorRangeForText(items, quote) {
        const mappedItems = items
            .map(item => ({
                itemIndex: item.itemIndex,
                text: this.normalizeTextForSearch(item.text || ''),
                compact: this.compactSearchText(item.text || '')
            }))
            .filter(item => item.text && item.compact);

        const quoteCompact = this.compactSearchText(quote);
        if (!mappedItems.length || !quoteCompact) return null;

        let best = null;
        for (let startIndex = 0; startIndex < mappedItems.length; startIndex++) {
            let accumulated = '';
            for (let endIndex = startIndex; endIndex < mappedItems.length && endIndex < startIndex + 180; endIndex++) {
                accumulated += mappedItems[endIndex].compact;
                if (accumulated.length < Math.max(12, quoteCompact.length * 0.45)) {
                    continue;
                }

                const score = this.getDiceCoefficient(accumulated, quoteCompact);
                if (!best || score > best.score) {
                    best = {
                        score,
                        startItemIndex: mappedItems[startIndex].itemIndex,
                        endItemIndex: mappedItems[endIndex].itemIndex
                    };
                }

                if (accumulated.length > quoteCompact.length * 1.65 + 24) {
                    break;
                }
            }
        }

        if (!best || best.score < 0.72) {
            return null;
        }

        const endItem = this.getTextItemByIndex(best.endItemIndex);
        return {
            start: {
                itemIndex: best.startItemIndex,
                offset: 0
            },
            end: {
                itemIndex: best.endItemIndex,
                offset: endItem?.text?.length ?? 0
            }
        };
    }

    findAnchorRangeForLegacyRects(rects) {
        const items = this.textModel.items;
        if (!items.length || !rects.length) return null;

        const matchedIndexes = [];
        const sortedRects = rects
            .map(rect => ({ ...rect }))
            .sort((a, b) => (Math.abs(a.y - b.y) < 4 ? a.x - b.x : a.y - b.y));

        items.forEach(item => {
            const localRect = this.getItemRectForOffsets(item, 0, item.text.length);
            const intersects = rects.some(legacyRect => localRect && this.rectIntersectsWithTolerance(localRect, legacyRect));
            if (intersects) {
                matchedIndexes.push(item.itemIndex);
            }
        });

        if (!matchedIndexes.length) return null;

        const startIndex = Math.min(...matchedIndexes);
        const endIndex = Math.max(...matchedIndexes);
        const endItem = this.getTextItemByIndex(endIndex);
        const startItem = this.getTextItemByIndex(startIndex);
        const startOffset = this.findTextOffsetFromLegacyRect(startItem, sortedRects[0], 'start');
        const endOffset = this.findTextOffsetFromLegacyRect(endItem, sortedRects[sortedRects.length - 1], 'end');

        return {
            start: {
                itemIndex: startIndex,
                offset: startOffset
            },
            end: {
                itemIndex: endIndex,
                offset: endOffset
            }
        };
    }

    findTextOffsetFromLegacyRect(item, legacyRect, mode) {
        const text = item?.text ?? '';
        if (!item || !text.length) {
            return mode === 'end' ? 0 : 0;
        }

        const targetX = mode === 'start'
            ? legacyRect.x
            : legacyRect.x + legacyRect.width;
        const fallback = mode === 'start' ? 0 : text.length;
        let bestOffset = fallback;
        let bestDistance = Number.POSITIVE_INFINITY;

        for (let offset = 0; offset < text.length; offset++) {
            const rect = this.getItemRectForOffsets(item, offset, offset + 1);
            if (!rect) continue;
            const localLeft = rect.x;
            const localRight = rect.x + rect.width;

            if (mode === 'start') {
                if (localRight >= targetX - 1) {
                    return offset;
                }
                const distance = Math.abs(localRight - targetX);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestOffset = offset;
                }
            } else {
                if (localLeft > targetX + 1) {
                    return Math.max(0, offset);
                }
                const distance = Math.abs(localLeft - targetX);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestOffset = offset + 1;
                }
            }
        }

        return bestOffset;
    }

    getTextItemByIndex(itemIndex) {
        return this.textModel.items.find(item => item.itemIndex === itemIndex) ?? null;
    }

    getTextForAnchorRange(anchorRange) {
        const start = anchorRange?.start;
        const end = anchorRange?.end;
        if (!start || !end) return '';

        const startIndex = start.itemIndex;
        const endIndex = end.itemIndex;
        if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex)) {
            return '';
        }

        const items = this.textModel.items.filter(item => item.itemIndex >= startIndex && item.itemIndex <= endIndex);
        if (!items.length) return '';

        const parts = [];
        for (const item of items) {
            const isStart = item.itemIndex === startIndex;
            const isEnd = item.itemIndex === endIndex;
            const from = isStart ? Math.max(0, Math.min(item.text.length, start.offset ?? 0)) : 0;
            const to = isEnd ? Math.max(from, Math.min(item.text.length, end.offset ?? item.text.length)) : item.text.length;
            const chunk = (item.text || '').slice(from, to);
            if (chunk) {
                parts.push(chunk);
            }
            if (item.hasEOL) {
                parts.push('\n');
            }
        }

        return parts.join('');
    }

    getAnchorRangeMatchScore(anchorRange, expectedText) {
        const actualCompact = this.compactSearchText(this.getTextForAnchorRange(anchorRange));
        const expectedCompact = this.compactSearchText(expectedText);
        if (!actualCompact || !expectedCompact) {
            return 0;
        }
        if (actualCompact === expectedCompact) {
            return 1;
        }
        if (actualCompact.includes(expectedCompact) || expectedCompact.includes(actualCompact)) {
            return Math.min(actualCompact.length, expectedCompact.length) / Math.max(actualCompact.length, expectedCompact.length);
        }
        return this.getDiceCoefficient(actualCompact, expectedCompact);
    }

    getItemRectForOffsets(item, startOffset, endOffset) {
        if (!item) return null;
        const textLength = item.text?.length ?? 0;
        if (!textLength || item.width <= 0 || item.height <= 0) {
            return null;
        }

        const start = Math.max(0, Math.min(textLength, startOffset));
        const end = Math.max(start, Math.min(textLength, endOffset));
        if (end <= start) {
            return null;
        }

        const charWidth = item.width / textLength;
        return {
            x: item.x + (charWidth * start),
            y: item.y,
            width: Math.max(1, charWidth * (end - start)),
            height: item.height
        };
    }

    rectIntersectsWithTolerance(a, b) {
        const expandX = 8;
        const expandY = 4;
        const ax1 = a.x;
        const ay1 = a.y;
        const ax2 = a.x + a.width;
        const ay2 = a.y + a.height;
        const bx1 = b.x - expandX;
        const by1 = b.y - expandY;
        const bx2 = b.x + b.width + expandX;
        const by2 = b.y + b.height + expandY;

        return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
    }

    normalizeTextForSearch(text) {
        return (text || '')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
            .replace(/[\u2018\u2019]/g, '\'')
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/\u00AD/g, '')
            .replace(/-\s+/g, '')
            .replace(/ﬁ/g, 'fi')
            .replace(/ﬂ/g, 'fl')
            .replace(/ﬀ/g, 'ff')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }

    compactSearchText(text) {
        return this.normalizeTextForSearch(text).replace(/[^a-z0-9]+/g, '');
    }

    expandCompactChars(char) {
        return (char || '')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
            .replace(/[\u2018\u2019]/g, '\'')
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/\u00AD/g, '')
            .replace(/ﬁ/g, 'fi')
            .replace(/ﬂ/g, 'fl')
            .replace(/ﬀ/g, 'ff')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '');
    }

    getDiceCoefficient(a, b) {
        if (!a || !b) return 0;
        if (a === b) return 1;
        if (a.length < 2 || b.length < 2) {
            return a === b ? 1 : 0;
        }

        const pairs = input => {
            const map = new Map();
            for (let i = 0; i < input.length - 1; i++) {
                const pair = input.slice(i, i + 2);
                map.set(pair, (map.get(pair) ?? 0) + 1);
            }
            return map;
        };

        const aPairs = pairs(a);
        const bPairs = pairs(b);
        let intersection = 0;

        for (const [pair, count] of aPairs.entries()) {
            if (!bPairs.has(pair)) continue;
            intersection += Math.min(count, bPairs.get(pair));
        }

        return (2 * intersection) / ((a.length - 1) + (b.length - 1));
    }
}
