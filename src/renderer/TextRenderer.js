/**
 * Text Renderer
 *
 * Handles text rendering in PDF pages:
 * - Font mapping and loading
 * - Character encoding
 * - Text positioning
 * - Glyph metrics
 */

import { ObjectParser } from '../parser/ObjectParser.js';

export class TextRenderer {
    constructor(pdfParser) {
        this.pdf = pdfParser;
        this.fontCache = new Map();
        this.textPositions = []; // For annotation support
        this.currentFont = null;
        this.currentFontSize = 12;
    }

    // Reset for new page
    reset() {
        this.textPositions = [];
    }

    // Get recorded text positions
    getTextPositions() {
        return this.textPositions;
    }

    // Set the current font
    async setFont(ctx, fontName, fontSize, resources) {
        this.currentFontSize = fontSize;

        // Try to get font from resources
        const fonts = resources.Font;
        if (fonts) {
            const fontsDict = ObjectParser.getDict(await this.pdf.resolveRef(fonts));
            const fontRef = fontsDict[fontName];

            if (fontRef) {
                const fontObj = await this.pdf.resolveRef(fontRef);
                this.currentFont = await this.parseFont(fontObj);
            }
        }

        // Map PDF font to canvas font
        const cssFont = this.mapFontToCSS(fontName, fontSize);
        ctx.font = cssFont;
    }

    // Parse font object
    async parseFont(fontObj) {
        const dict = ObjectParser.getDict(fontObj);
        const subtype = ObjectParser.getName(dict.Subtype);
        const baseFont = ObjectParser.getName(dict.BaseFont);

        const font = {
            name: baseFont,
            subtype,
            encoding: null,
            toUnicode: null,
            widths: [],
            firstChar: 0,
            missingWidth: 0
        };

        // Parse encoding
        if (dict.Encoding) {
            if (dict.Encoding.type === 'name') {
                font.encoding = ObjectParser.getName(dict.Encoding);
            } else {
                const encDict = ObjectParser.getDict(await this.pdf.resolveRef(dict.Encoding));
                font.encoding = ObjectParser.getName(encDict.BaseEncoding);
                // Handle Differences array for custom mappings
                if (encDict.Differences) {
                    font.differences = this.parseDifferences(encDict.Differences);
                }
            }
        }

        // Parse ToUnicode CMap if present
        if (dict.ToUnicode) {
            const toUnicodeStream = await this.pdf.resolveRef(dict.ToUnicode);
            if (toUnicodeStream && toUnicodeStream.type === 'stream') {
                font.toUnicode = this.parseToUnicode(
                    toUnicodeStream.decodedData || toUnicodeStream.data
                );
            }
        }

        // Parse widths
        if (dict.Widths) {
            const widths = ObjectParser.getArray(await this.pdf.resolveRef(dict.Widths));
            font.widths = widths.map(w => ObjectParser.getNumber(w));
            font.firstChar = ObjectParser.getNumber(dict.FirstChar, 0);
        }

        if (dict.MissingWidth) {
            font.missingWidth = ObjectParser.getNumber(dict.MissingWidth);
        }

        return font;
    }

    // Parse encoding Differences array
    parseDifferences(diffsObj) {
        const diffs = ObjectParser.getArray(diffsObj);
        const mapping = {};
        let code = 0;

        for (const item of diffs) {
            if (item.type === 'number') {
                code = ObjectParser.getNumber(item);
            } else if (item.type === 'name') {
                mapping[code] = ObjectParser.getName(item);
                code++;
            }
        }

        return mapping;
    }

    // Parse ToUnicode CMap
    parseToUnicode(data) {
        const text = new TextDecoder('latin1').decode(data);
        const mapping = {};

        // Parse bfchar mappings: <src> <dst>
        const bfcharRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
        let match;

        // Find beginbfchar...endbfchar sections
        const bfcharSections = text.match(/beginbfchar[\s\S]*?endbfchar/g) || [];
        for (const section of bfcharSections) {
            while ((match = bfcharRegex.exec(section)) !== null) {
                const src = parseInt(match[1], 16);
                const dst = this.hexToString(match[2]);
                mapping[src] = dst;
            }
        }

        // Parse bfrange mappings: <srcStart> <srcEnd> <dstStart>
        const bfrangeRegex = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
        const bfrangeSections = text.match(/beginbfrange[\s\S]*?endbfrange/g) || [];

        for (const section of bfrangeSections) {
            while ((match = bfrangeRegex.exec(section)) !== null) {
                const start = parseInt(match[1], 16);
                const end = parseInt(match[2], 16);
                let dst = parseInt(match[3], 16);

                for (let i = start; i <= end; i++) {
                    mapping[i] = String.fromCodePoint(dst++);
                }
            }
        }

        return mapping;
    }

    // Convert hex string to unicode string
    hexToString(hex) {
        let result = '';
        // Assume 2 bytes per character for BMP
        const bytes = hex.length / 2;
        if (bytes <= 2) {
            const codePoint = parseInt(hex, 16);
            result = String.fromCodePoint(codePoint);
        } else {
            // Multiple characters
            for (let i = 0; i < hex.length; i += 4) {
                const codePoint = parseInt(hex.substr(i, 4), 16);
                result += String.fromCodePoint(codePoint);
            }
        }
        return result;
    }

    // Map PDF font name to CSS font
    mapFontToCSS(fontName, fontSize) {
        let family = 'sans-serif';
        let weight = 'normal';
        let style = 'normal';

        const name = fontName.toLowerCase();

        // Check for standard fonts
        if (name.includes('courier') || name.includes('mono')) {
            family = 'Courier New, Courier, monospace';
        } else if (name.includes('times') || name.includes('serif')) {
            family = 'Times New Roman, Times, serif';
        } else if (name.includes('helvetica') || name.includes('arial') || name.includes('sans')) {
            family = 'Helvetica, Arial, sans-serif';
        } else if (name.includes('symbol')) {
            family = 'Symbol';
        } else if (name.includes('zapf') || name.includes('dingbat')) {
            family = 'ZapfDingbats, Wingdings';
        }

        // Check for bold
        if (name.includes('bold') || name.includes('-b')) {
            weight = 'bold';
        }

        // Check for italic/oblique
        if (name.includes('italic') || name.includes('oblique') || name.includes('-i')) {
            style = 'italic';
        }

        return `${style} ${weight} ${fontSize}px ${family}`;
    }

    // Show a text string
    showText(ctx, textObj, state) {
        let text;

        if (textObj.type === 'string') {
            text = this.decodeString(textObj.value);
        } else {
            return;
        }

        this.renderText(ctx, text, state);
    }

    // Show text array with positioning
    showTextArray(ctx, arrayObj, state) {
        const items = ObjectParser.getArray(arrayObj);

        for (const item of items) {
            if (item.type === 'string') {
                const text = this.decodeString(item.value);
                this.renderText(ctx, text, state);
            } else if (item.type === 'number') {
                // Adjust position (negative = move right)
                const adjustment = ObjectParser.getNumber(item);
                const tx = -adjustment * state.fontSize / 1000 * (state.horizontalScaling / 100);
                state.textMatrix = this.multiplyMatrix(state.textMatrix, [1, 0, 0, 1, tx, 0]);
            }
        }
    }

    // Decode string bytes to unicode
    decodeString(bytes) {
        if (!(bytes instanceof Uint8Array)) {
            return bytes;
        }

        // Check for UTF-16BE BOM
        if (bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF) {
            // UTF-16BE
            let result = '';
            for (let i = 2; i < bytes.length; i += 2) {
                const code = (bytes[i] << 8) | bytes[i + 1];
                result += String.fromCharCode(code);
            }
            return result;
        }

        // Use ToUnicode mapping if available
        if (this.currentFont && this.currentFont.toUnicode) {
            let result = '';
            for (const byte of bytes) {
                const mapped = this.currentFont.toUnicode[byte];
                result += mapped || String.fromCharCode(byte);
            }
            return result;
        }

        // Use encoding
        let result = '';
        for (const byte of bytes) {
            result += this.decodeChar(byte);
        }
        return result;
    }

    // Decode a single character
    decodeChar(code) {
        if (this.currentFont && this.currentFont.differences) {
            const name = this.currentFont.differences[code];
            if (name) {
                return this.glyphNameToChar(name);
            }
        }

        // Standard encodings
        if (this.currentFont && this.currentFont.encoding === 'WinAnsiEncoding') {
            return String.fromCharCode(WINANSI_ENCODING[code] || code);
        }

        // Default: Latin-1
        return String.fromCharCode(code);
    }

    // Convert glyph name to character
    glyphNameToChar(name) {
        // Common glyph names
        const GLYPH_MAP = {
            'space': ' ', 'exclam': '!', 'quotedbl': '"', 'numbersign': '#',
            'dollar': '$', 'percent': '%', 'ampersand': '&', 'quotesingle': "'",
            'parenleft': '(', 'parenright': ')', 'asterisk': '*', 'plus': '+',
            'comma': ',', 'hyphen': '-', 'period': '.', 'slash': '/',
            'zero': '0', 'one': '1', 'two': '2', 'three': '3',
            'four': '4', 'five': '5', 'six': '6', 'seven': '7',
            'eight': '8', 'nine': '9', 'colon': ':', 'semicolon': ';',
            'less': '<', 'equal': '=', 'greater': '>', 'question': '?',
            'at': '@', 'bracketleft': '[', 'backslash': '\\', 'bracketright': ']',
            'asciicircum': '^', 'underscore': '_', 'grave': '`',
            'braceleft': '{', 'bar': '|', 'braceright': '}', 'asciitilde': '~',
            'bullet': '•', 'endash': '–', 'emdash': '—',
            'quoteleft': ''', 'quoteright': ''', 'quotedblleft': '"', 'quotedblright': '"',
            'fi': 'fi', 'fl': 'fl'
        };

        if (GLYPH_MAP[name]) {
            return GLYPH_MAP[name];
        }

        // Letter names (A-Z, a-z)
        if (name.length === 1) {
            return name;
        }

        // Unicode value: uniXXXX
        if (name.startsWith('uni') && name.length === 7) {
            const code = parseInt(name.substring(3), 16);
            return String.fromCharCode(code);
        }

        return '?';
    }

    // Render text at current position
    renderText(ctx, text, state) {
        if (!text) return;

        const tm = state.textMatrix;
        const fontSize = state.fontSize;

        // Calculate position
        // Text matrix: [a b c d e f]
        // Position: (e, f)
        // Scale: sqrt(a^2 + b^2) for x, sqrt(c^2 + d^2) for y

        ctx.save();

        // Apply text matrix (but flip Y for canvas coordinates)
        ctx.transform(tm[0], tm[1], tm[2], tm[3], tm[4], tm[5]);
        ctx.scale(1, -1); // Flip for correct text orientation

        // Draw text
        const renderMode = state.renderingMode;

        if (renderMode === 0 || renderMode === 2 || renderMode === 4 || renderMode === 6) {
            // Fill text
            ctx.fillText(text, 0, 0);
        }

        if (renderMode === 1 || renderMode === 2 || renderMode === 5 || renderMode === 6) {
            // Stroke text
            ctx.strokeText(text, 0, 0);
        }

        ctx.restore();

        // Record text position for annotations
        const width = ctx.measureText(text).width;
        const scaledWidth = width * Math.abs(tm[0]);

        this.textPositions.push({
            text,
            x: tm[4],
            y: tm[5],
            width: scaledWidth,
            height: fontSize * Math.abs(tm[3]),
            fontSize
        });

        // Advance text position
        const advance = width + text.length * state.charSpacing;
        const spaceCount = (text.match(/ /g) || []).length;
        const totalAdvance = (advance + spaceCount * state.wordSpacing) * (state.horizontalScaling / 100);

        state.textMatrix = this.multiplyMatrix(state.textMatrix, [1, 0, 0, 1, totalAdvance, 0]);
    }

    // Multiply matrices
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
}

// WinAnsi encoding table
const WINANSI_ENCODING = {
    128: 0x20AC, // Euro
    130: 0x201A, // Single low-9 quote
    131: 0x0192, // f with hook
    132: 0x201E, // Double low-9 quote
    133: 0x2026, // Ellipsis
    134: 0x2020, // Dagger
    135: 0x2021, // Double dagger
    136: 0x02C6, // Circumflex
    137: 0x2030, // Per mille
    138: 0x0160, // S caron
    139: 0x2039, // Single left angle quote
    140: 0x0152, // OE
    142: 0x017D, // Z caron
    145: 0x2018, // Left single quote
    146: 0x2019, // Right single quote
    147: 0x201C, // Left double quote
    148: 0x201D, // Right double quote
    149: 0x2022, // Bullet
    150: 0x2013, // En dash
    151: 0x2014, // Em dash
    152: 0x02DC, // Tilde
    153: 0x2122, // Trademark
    154: 0x0161, // s caron
    155: 0x203A, // Single right angle quote
    156: 0x0153, // oe
    158: 0x017E, // z caron
    159: 0x0178  // Y diaeresis
};

// Fill in standard ASCII
for (let i = 0; i < 128; i++) {
    WINANSI_ENCODING[i] = i;
}
for (let i = 160; i < 256; i++) {
    WINANSI_ENCODING[i] = i;
}
