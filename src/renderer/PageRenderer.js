/**
 * Page Renderer
 *
 * Orchestrates rendering of a PDF page to canvas:
 * - Sets up canvas with correct dimensions
 * - Parses content stream operators
 * - Delegates to TextRenderer and GraphicsRenderer
 */

import { Tokenizer } from '../parser/Tokenizer.js';
import { ObjectParser } from '../parser/ObjectParser.js';
import { TextRenderer } from './TextRenderer.js';
import { GraphicsRenderer } from './GraphicsRenderer.js';

export class PageRenderer {
    constructor(pdfParser) {
        this.pdf = pdfParser;
        this.scale = 1.5; // Default scale factor
        this.textRenderer = new TextRenderer(pdfParser);
        this.graphicsRenderer = new GraphicsRenderer();
    }

    // Render a page to canvas
    async render(page, canvas) {
        const { width, height, rotate, x1, y1 } = this.pdf.getPageDimensions(page);

        // Set canvas size
        const scaledWidth = width * this.scale;
        const scaledHeight = height * this.scale;

        canvas.width = scaledWidth;
        canvas.height = scaledHeight;

        const ctx = canvas.getContext('2d');

        // Fill background
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, scaledWidth, scaledHeight);

        // Set up coordinate system
        // PDF uses bottom-left origin, canvas uses top-left
        ctx.save();
        ctx.scale(this.scale, this.scale);
        ctx.translate(-x1, height + y1);
        ctx.scale(1, -1);

        // Handle rotation
        if (rotate) {
            ctx.translate(width / 2, height / 2);
            ctx.rotate(-rotate * Math.PI / 180);
            ctx.translate(-width / 2, -height / 2);
        }

        // Get resources
        const resources = await this.pdf.getPageResources(page);

        // Get content stream
        const content = await this.pdf.getPageContent(page);

        // Parse and execute content stream
        await this.executeContentStream(ctx, content, resources);

        ctx.restore();

        // Return text positions for annotation support
        return {
            width: scaledWidth,
            height: scaledHeight,
            textPositions: this.textRenderer.getTextPositions()
        };
    }

    // Parse and execute content stream
    async executeContentStream(ctx, content, resources) {
        const text = new TextDecoder('latin1').decode(content);
        const operators = this.parseContentStream(text);

        // Initialize graphics state
        const state = {
            ctm: [1, 0, 0, 1, 0, 0], // Current transformation matrix
            strokeColor: [0, 0, 0],
            fillColor: [0, 0, 0],
            lineWidth: 1,
            lineCap: 0,
            lineJoin: 0,
            miterLimit: 10,
            dashArray: [],
            dashPhase: 0,
            font: null,
            fontSize: 12,
            textMatrix: [1, 0, 0, 1, 0, 0],
            lineMatrix: [1, 0, 0, 1, 0, 0],
            charSpacing: 0,
            wordSpacing: 0,
            horizontalScaling: 100,
            leading: 0,
            textRise: 0,
            renderingMode: 0,
            stateStack: []
        };

        // Reset text renderer
        this.textRenderer.reset();

        // Execute operators
        for (const { op, args } of operators) {
            await this.executeOperator(ctx, state, op, args, resources);
        }
    }

    // Parse content stream into operator/argument pairs
    parseContentStream(text) {
        const operators = [];
        const tokenizer = new Tokenizer(new TextEncoder().encode(text));
        const parser = new ObjectParser(tokenizer);

        const args = [];

        while (true) {
            const token = parser.nextToken();
            if (!token) break;

            if (token.type === 'keyword') {
                operators.push({ op: token.value, args: [...args] });
                args.length = 0;
            } else {
                // Build object for arrays and dicts
                parser.pushBack(token);
                const obj = parser.parseObject();
                args.push(obj);
            }
        }

        return operators;
    }

    // Execute a single operator
    async executeOperator(ctx, state, op, args, resources) {
        // Graphics state operators
        switch (op) {
            case 'q': // Save graphics state
                state.stateStack.push(this.cloneState(state));
                ctx.save();
                break;

            case 'Q': // Restore graphics state
                if (state.stateStack.length > 0) {
                    const saved = state.stateStack.pop();
                    Object.assign(state, saved);
                    ctx.restore();
                }
                break;

            case 'cm': // Concatenate matrix
                const [a, b, c, d, e, f] = args.map(arg => ObjectParser.getNumber(arg));
                ctx.transform(a, b, c, d, e, f);
                state.ctm = this.multiplyMatrix(state.ctm, [a, b, c, d, e, f]);
                break;

            case 'w': // Line width
                state.lineWidth = ObjectParser.getNumber(args[0]);
                ctx.lineWidth = state.lineWidth;
                break;

            case 'J': // Line cap
                state.lineCap = ObjectParser.getNumber(args[0]);
                ctx.lineCap = ['butt', 'round', 'square'][state.lineCap];
                break;

            case 'j': // Line join
                state.lineJoin = ObjectParser.getNumber(args[0]);
                ctx.lineJoin = ['miter', 'round', 'bevel'][state.lineJoin];
                break;

            case 'M': // Miter limit
                state.miterLimit = ObjectParser.getNumber(args[0]);
                ctx.miterLimit = state.miterLimit;
                break;

            case 'd': // Dash pattern
                state.dashArray = ObjectParser.getArray(args[0]).map(n => ObjectParser.getNumber(n));
                state.dashPhase = ObjectParser.getNumber(args[1]);
                ctx.setLineDash(state.dashArray);
                ctx.lineDashOffset = state.dashPhase;
                break;

            // Color operators
            case 'CS': // Set stroke color space
            case 'cs': // Set fill color space
                // Simplified - just track the color space name
                break;

            case 'SC': // Set stroke color
            case 'SCN':
                state.strokeColor = args.map(arg => ObjectParser.getNumber(arg));
                ctx.strokeStyle = this.colorToCSS(state.strokeColor);
                break;

            case 'sc': // Set fill color
            case 'scn':
                state.fillColor = args.map(arg => ObjectParser.getNumber(arg));
                ctx.fillStyle = this.colorToCSS(state.fillColor);
                break;

            case 'G': // Set gray stroke
                const gray = ObjectParser.getNumber(args[0]);
                state.strokeColor = [gray];
                ctx.strokeStyle = this.colorToCSS([gray]);
                break;

            case 'g': // Set gray fill
                const grayFill = ObjectParser.getNumber(args[0]);
                state.fillColor = [grayFill];
                ctx.fillStyle = this.colorToCSS([grayFill]);
                break;

            case 'RG': // Set RGB stroke
                state.strokeColor = args.map(arg => ObjectParser.getNumber(arg));
                ctx.strokeStyle = this.colorToCSS(state.strokeColor);
                break;

            case 'rg': // Set RGB fill
                state.fillColor = args.map(arg => ObjectParser.getNumber(arg));
                ctx.fillStyle = this.colorToCSS(state.fillColor);
                break;

            case 'K': // Set CMYK stroke
                state.strokeColor = args.map(arg => ObjectParser.getNumber(arg));
                ctx.strokeStyle = this.cmykToCSS(state.strokeColor);
                break;

            case 'k': // Set CMYK fill
                state.fillColor = args.map(arg => ObjectParser.getNumber(arg));
                ctx.fillStyle = this.cmykToCSS(state.fillColor);
                break;

            // Path construction
            case 'm': // Move to
                this.graphicsRenderer.moveTo(ctx, args);
                break;

            case 'l': // Line to
                this.graphicsRenderer.lineTo(ctx, args);
                break;

            case 'c': // Bezier curve
                this.graphicsRenderer.curveTo(ctx, args);
                break;

            case 'v': // Bezier curve (initial point = current)
                this.graphicsRenderer.curveToV(ctx, args);
                break;

            case 'y': // Bezier curve (final point = control)
                this.graphicsRenderer.curveToY(ctx, args);
                break;

            case 'h': // Close path
                ctx.closePath();
                break;

            case 're': // Rectangle
                this.graphicsRenderer.rectangle(ctx, args);
                break;

            // Path painting
            case 'S': // Stroke
                ctx.stroke();
                break;

            case 's': // Close and stroke
                ctx.closePath();
                ctx.stroke();
                break;

            case 'f': // Fill (non-zero)
            case 'F':
                ctx.fill('nonzero');
                break;

            case 'f*': // Fill (even-odd)
                ctx.fill('evenodd');
                break;

            case 'B': // Fill and stroke (non-zero)
                ctx.fill('nonzero');
                ctx.stroke();
                break;

            case 'B*': // Fill and stroke (even-odd)
                ctx.fill('evenodd');
                ctx.stroke();
                break;

            case 'b': // Close, fill, stroke (non-zero)
                ctx.closePath();
                ctx.fill('nonzero');
                ctx.stroke();
                break;

            case 'b*': // Close, fill, stroke (even-odd)
                ctx.closePath();
                ctx.fill('evenodd');
                ctx.stroke();
                break;

            case 'n': // End path without filling or stroking
                ctx.beginPath();
                break;

            // Clipping
            case 'W': // Set clipping path (non-zero)
                ctx.clip('nonzero');
                break;

            case 'W*': // Set clipping path (even-odd)
                ctx.clip('evenodd');
                break;

            // Text operators
            case 'BT': // Begin text
                state.textMatrix = [1, 0, 0, 1, 0, 0];
                state.lineMatrix = [1, 0, 0, 1, 0, 0];
                break;

            case 'ET': // End text
                break;

            case 'Tc': // Character spacing
                state.charSpacing = ObjectParser.getNumber(args[0]);
                break;

            case 'Tw': // Word spacing
                state.wordSpacing = ObjectParser.getNumber(args[0]);
                break;

            case 'Tz': // Horizontal scaling
                state.horizontalScaling = ObjectParser.getNumber(args[0]);
                break;

            case 'TL': // Leading
                state.leading = ObjectParser.getNumber(args[0]);
                break;

            case 'Tf': // Font and size
                const fontName = ObjectParser.getName(args[0]);
                const fontSize = ObjectParser.getNumber(args[1]);
                state.font = fontName;
                state.fontSize = fontSize;
                await this.textRenderer.setFont(ctx, fontName, fontSize, resources);
                break;

            case 'Tr': // Rendering mode
                state.renderingMode = ObjectParser.getNumber(args[0]);
                break;

            case 'Ts': // Text rise
                state.textRise = ObjectParser.getNumber(args[0]);
                break;

            case 'Td': // Move text position
                const tx = ObjectParser.getNumber(args[0]);
                const ty = ObjectParser.getNumber(args[1]);
                state.lineMatrix = this.multiplyMatrix(state.lineMatrix, [1, 0, 0, 1, tx, ty]);
                state.textMatrix = [...state.lineMatrix];
                break;

            case 'TD': // Move text position and set leading
                const tdx = ObjectParser.getNumber(args[0]);
                const tdy = ObjectParser.getNumber(args[1]);
                state.leading = -tdy;
                state.lineMatrix = this.multiplyMatrix(state.lineMatrix, [1, 0, 0, 1, tdx, tdy]);
                state.textMatrix = [...state.lineMatrix];
                break;

            case 'Tm': // Set text matrix
                state.textMatrix = args.map(arg => ObjectParser.getNumber(arg));
                state.lineMatrix = [...state.textMatrix];
                break;

            case 'T*': // Move to start of next line
                state.lineMatrix = this.multiplyMatrix(state.lineMatrix, [1, 0, 0, 1, 0, -state.leading]);
                state.textMatrix = [...state.lineMatrix];
                break;

            case 'Tj': // Show text
                this.textRenderer.showText(ctx, args[0], state);
                break;

            case 'TJ': // Show text with positioning
                this.textRenderer.showTextArray(ctx, args[0], state);
                break;

            case "'": // Move to next line and show text
                state.lineMatrix = this.multiplyMatrix(state.lineMatrix, [1, 0, 0, 1, 0, -state.leading]);
                state.textMatrix = [...state.lineMatrix];
                this.textRenderer.showText(ctx, args[0], state);
                break;

            case '"': // Set spacing, move to next line, show text
                state.wordSpacing = ObjectParser.getNumber(args[0]);
                state.charSpacing = ObjectParser.getNumber(args[1]);
                state.lineMatrix = this.multiplyMatrix(state.lineMatrix, [1, 0, 0, 1, 0, -state.leading]);
                state.textMatrix = [...state.lineMatrix];
                this.textRenderer.showText(ctx, args[2], state);
                break;

            // XObject
            case 'Do': // Paint XObject
                const xobjName = ObjectParser.getName(args[0]);
                await this.paintXObject(ctx, state, xobjName, resources);
                break;

            // Inline image
            case 'BI': // Begin inline image
                // Skip inline images for now (complex to parse)
                break;

            default:
                // Unknown operator - ignore
                break;
        }
    }

    // Paint an XObject (image or form)
    async paintXObject(ctx, state, name, resources) {
        const xobj = await this.pdf.getXObject(resources, name);
        if (!xobj) return;

        const dict = ObjectParser.getDict(xobj);
        const subtype = ObjectParser.getName(dict.Subtype);

        if (subtype === 'Image') {
            await this.paintImage(ctx, xobj);
        } else if (subtype === 'Form') {
            await this.paintForm(ctx, xobj, resources);
        }
    }

    // Paint an image XObject
    async paintImage(ctx, imageObj) {
        const dict = imageObj.dict || ObjectParser.getDict(imageObj);
        const width = ObjectParser.getNumber(dict.Width);
        const height = ObjectParser.getNumber(dict.Height);

        // For now, draw a placeholder rectangle
        // Full image decoding would require handling:
        // - Color spaces (DeviceRGB, DeviceCMYK, DeviceGray, Indexed, etc.)
        // - Bits per component
        // - DCTDecode (JPEG), JPXDecode (JPEG2000), etc.

        ctx.save();
        ctx.scale(1 / width, -1 / height);
        ctx.translate(0, -height);

        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = '#ccc';
        ctx.strokeRect(0, 0, width, height);

        ctx.restore();
    }

    // Paint a form XObject
    async paintForm(ctx, formObj, parentResources) {
        const dict = formObj.dict || ObjectParser.getDict(formObj);

        // Get form's resources (inherit from parent if not present)
        let formResources = parentResources;
        if (dict.Resources) {
            formResources = ObjectParser.getDict(await this.pdf.resolveRef(dict.Resources));
        }

        // Get form bbox and matrix
        const bbox = ObjectParser.getArray(dict.BBox);
        const matrix = dict.Matrix
            ? ObjectParser.getArray(dict.Matrix).map(n => ObjectParser.getNumber(n))
            : [1, 0, 0, 1, 0, 0];

        ctx.save();

        // Apply form matrix
        ctx.transform(matrix[0], matrix[1], matrix[2], matrix[3], matrix[4], matrix[5]);

        // Clip to bbox
        if (bbox) {
            const [x1, y1, x2, y2] = bbox.map(n => ObjectParser.getNumber(n));
            ctx.beginPath();
            ctx.rect(x1, y1, x2 - x1, y2 - y1);
            ctx.clip();
        }

        // Execute form content
        const content = formObj.decodedData || formObj.data;
        await this.executeContentStream(ctx, content, formResources);

        ctx.restore();
    }

    // Convert color array to CSS
    colorToCSS(color) {
        if (color.length === 1) {
            // Grayscale
            const g = Math.round(color[0] * 255);
            return `rgb(${g}, ${g}, ${g})`;
        } else if (color.length === 3) {
            // RGB
            const r = Math.round(color[0] * 255);
            const g = Math.round(color[1] * 255);
            const b = Math.round(color[2] * 255);
            return `rgb(${r}, ${g}, ${b})`;
        }
        return 'black';
    }

    // Convert CMYK to CSS
    cmykToCSS(cmyk) {
        const [c, m, y, k] = cmyk;
        const r = Math.round(255 * (1 - c) * (1 - k));
        const g = Math.round(255 * (1 - m) * (1 - k));
        const b = Math.round(255 * (1 - y) * (1 - k));
        return `rgb(${r}, ${g}, ${b})`;
    }

    // Multiply two transformation matrices
    multiplyMatrix(m1, m2) {
        return [
            m1[0] * m2[0] + m1[2] * m2[1],
            m1[1] * m2[0] + m1[3] * m2[1],
            m1[0] * m2[2] + m1[2] * m2[3],
            m1[1] * m2[2] + m1[3] * m2[3],
            m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
            m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
        ];
    }

    // Clone graphics state
    cloneState(state) {
        return {
            ctm: [...state.ctm],
            strokeColor: [...state.strokeColor],
            fillColor: [...state.fillColor],
            lineWidth: state.lineWidth,
            lineCap: state.lineCap,
            lineJoin: state.lineJoin,
            miterLimit: state.miterLimit,
            dashArray: [...state.dashArray],
            dashPhase: state.dashPhase,
            font: state.font,
            fontSize: state.fontSize,
            textMatrix: [...state.textMatrix],
            lineMatrix: [...state.lineMatrix],
            charSpacing: state.charSpacing,
            wordSpacing: state.wordSpacing,
            horizontalScaling: state.horizontalScaling,
            leading: state.leading,
            textRise: state.textRise,
            renderingMode: state.renderingMode,
            stateStack: [] // Don't deep clone stack
        };
    }

    // Set rendering scale
    setScale(scale) {
        this.scale = scale;
    }
}
