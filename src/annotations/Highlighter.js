/**
 * Highlighter Tool
 *
 * Handles text highlighting functionality:
 * - Detect text under selection
 * - Create highlight annotations
 * - Support multiple colors
 */

export class Highlighter {
    constructor() {
        this.color = '#FFEB3B';
        this.isActive = false;
    }

    // Set highlight color
    setColor(color) {
        this.color = color;
    }

    // Activate/deactivate tool
    setActive(active) {
        this.isActive = active;
    }

    // Create highlight from text positions
    createHighlightFromText(textPositions, startX, startY, endX, endY, scale) {
        // Find text that falls within the selection rectangle
        const minX = Math.min(startX, endX);
        const maxX = Math.max(startX, endX);
        const minY = Math.min(startY, endY);
        const maxY = Math.max(startY, endY);

        const selectedText = [];

        for (const pos of textPositions) {
            const textX = pos.x * scale;
            const textY = pos.y * scale;
            const textWidth = pos.width * scale;
            const textHeight = pos.height * scale;

            // Check if text overlaps with selection
            if (textX + textWidth > minX && textX < maxX &&
                textY + textHeight > minY && textY < maxY) {
                selectedText.push(pos);
            }
        }

        if (selectedText.length === 0) {
            // No text selected, create rectangular highlight
            return {
                type: 'highlight',
                color: this.color,
                rect: {
                    x: minX,
                    y: minY,
                    width: maxX - minX,
                    height: maxY - minY
                }
            };
        }

        // Create highlight that encompasses all selected text
        let bounds = {
            minX: Infinity,
            minY: Infinity,
            maxX: -Infinity,
            maxY: -Infinity
        };

        for (const pos of selectedText) {
            bounds.minX = Math.min(bounds.minX, pos.x * scale);
            bounds.minY = Math.min(bounds.minY, pos.y * scale);
            bounds.maxX = Math.max(bounds.maxX, (pos.x + pos.width) * scale);
            bounds.maxY = Math.max(bounds.maxY, (pos.y + pos.height) * scale);
        }

        return {
            type: 'highlight',
            color: this.color,
            rect: {
                x: bounds.minX,
                y: bounds.minY,
                width: bounds.maxX - bounds.minX,
                height: bounds.maxY - bounds.minY
            },
            text: selectedText.map(p => p.text).join(' ')
        };
    }

    // Get available colors
    static getColors() {
        return [
            { name: 'Yellow', value: '#FFEB3B' },
            { name: 'Green', value: '#4CAF50' },
            { name: 'Blue', value: '#2196F3' },
            { name: 'Pink', value: '#E91E63' },
            { name: 'Orange', value: '#FF5722' }
        ];
    }
}
