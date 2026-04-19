/**
 * Graphics Renderer
 *
 * Handles vector graphics rendering:
 * - Path construction (lines, curves, rectangles)
 * - Path painting (stroke, fill)
 */

import { ObjectParser } from '../parser/ObjectParser.js';

export class GraphicsRenderer {
    constructor() {
        this.currentX = 0;
        this.currentY = 0;
    }

    // Move to point
    moveTo(ctx, args) {
        const x = ObjectParser.getNumber(args[0]);
        const y = ObjectParser.getNumber(args[1]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        this.currentX = x;
        this.currentY = y;
    }

    // Line to point
    lineTo(ctx, args) {
        const x = ObjectParser.getNumber(args[0]);
        const y = ObjectParser.getNumber(args[1]);
        ctx.lineTo(x, y);
        this.currentX = x;
        this.currentY = y;
    }

    // Cubic bezier curve
    curveTo(ctx, args) {
        const x1 = ObjectParser.getNumber(args[0]);
        const y1 = ObjectParser.getNumber(args[1]);
        const x2 = ObjectParser.getNumber(args[2]);
        const y2 = ObjectParser.getNumber(args[3]);
        const x3 = ObjectParser.getNumber(args[4]);
        const y3 = ObjectParser.getNumber(args[5]);
        ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
        this.currentX = x3;
        this.currentY = y3;
    }

    // Bezier curve with first control point = current point
    curveToV(ctx, args) {
        const x2 = ObjectParser.getNumber(args[0]);
        const y2 = ObjectParser.getNumber(args[1]);
        const x3 = ObjectParser.getNumber(args[2]);
        const y3 = ObjectParser.getNumber(args[3]);
        ctx.bezierCurveTo(this.currentX, this.currentY, x2, y2, x3, y3);
        this.currentX = x3;
        this.currentY = y3;
    }

    // Bezier curve with second control point = end point
    curveToY(ctx, args) {
        const x1 = ObjectParser.getNumber(args[0]);
        const y1 = ObjectParser.getNumber(args[1]);
        const x3 = ObjectParser.getNumber(args[2]);
        const y3 = ObjectParser.getNumber(args[3]);
        ctx.bezierCurveTo(x1, y1, x3, y3, x3, y3);
        this.currentX = x3;
        this.currentY = y3;
    }

    // Rectangle
    rectangle(ctx, args) {
        const x = ObjectParser.getNumber(args[0]);
        const y = ObjectParser.getNumber(args[1]);
        const width = ObjectParser.getNumber(args[2]);
        const height = ObjectParser.getNumber(args[3]);
        ctx.rect(x, y, width, height);
        this.currentX = x;
        this.currentY = y;
    }
}
