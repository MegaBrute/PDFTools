/**
 * Drawing Tool
 *
 * Handles freehand drawing annotations:
 * - Capture mouse/touch path
 * - Render smooth strokes
 * - Support multiple colors and sizes
 */

export class DrawingTool {
    constructor() {
        this.color = '#E91E63';
        this.lineWidth = 2;
        this.isActive = false;
    }

    // Set drawing color
    setColor(color) {
        this.color = color;
    }

    // Set line width
    setLineWidth(width) {
        this.lineWidth = width;
    }

    // Activate/deactivate tool
    setActive(active) {
        this.isActive = active;
    }

    // Create drawing from path
    createDrawing(path) {
        if (path.length < 2) return null;

        return {
            type: 'drawing',
            color: this.color,
            lineWidth: this.lineWidth,
            path: this.smoothPath(path)
        };
    }

    // Smooth the path using Catmull-Rom spline
    smoothPath(points) {
        if (points.length < 3) return points;

        const smoothed = [];
        const tension = 0.5;

        for (let i = 0; i < points.length; i++) {
            const p0 = points[Math.max(0, i - 1)];
            const p1 = points[i];
            const p2 = points[Math.min(points.length - 1, i + 1)];
            const p3 = points[Math.min(points.length - 1, i + 2)];

            // Add the original point
            smoothed.push(p1);

            // Add interpolated points
            if (i < points.length - 1) {
                for (let t = 0.2; t < 1; t += 0.2) {
                    const x = this.catmullRom(p0.x, p1.x, p2.x, p3.x, t, tension);
                    const y = this.catmullRom(p0.y, p1.y, p2.y, p3.y, t, tension);
                    smoothed.push({ x, y });
                }
            }
        }

        return smoothed;
    }

    // Catmull-Rom spline interpolation
    catmullRom(p0, p1, p2, p3, t, tension) {
        const t2 = t * t;
        const t3 = t2 * t;

        const m0 = tension * (p2 - p0);
        const m1 = tension * (p3 - p1);

        const a = 2 * t3 - 3 * t2 + 1;
        const b = t3 - 2 * t2 + t;
        const c = -2 * t3 + 3 * t2;
        const d = t3 - t2;

        return a * p1 + b * m0 + c * p2 + d * m1;
    }

    // Calculate bounding box of drawing
    getBoundingBox(path) {
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        for (const point of path) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    // Format drawing for display in sidebar
    formatForList(drawing) {
        const bbox = this.getBoundingBox(drawing.path);
        return {
            id: drawing.id,
            type: 'Drawing',
            preview: `${drawing.path.length} points`,
            pageIndex: drawing.pageIndex,
            color: drawing.color
        };
    }

    // Get available colors
    static getColors() {
        return [
            { name: 'Red', value: '#E91E63' },
            { name: 'Blue', value: '#2196F3' },
            { name: 'Green', value: '#4CAF50' },
            { name: 'Black', value: '#333333' },
            { name: 'Orange', value: '#FF5722' }
        ];
    }

    // Get available line widths
    static getLineWidths() {
        return [
            { name: 'Thin', value: 1 },
            { name: 'Normal', value: 2 },
            { name: 'Thick', value: 4 },
            { name: 'Extra Thick', value: 6 }
        ];
    }
}
