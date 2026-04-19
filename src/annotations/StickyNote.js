/**
 * Sticky Note Tool
 *
 * Handles sticky note annotations:
 * - Create note at click position
 * - Edit note text
 * - Display note icon
 */

export class StickyNote {
    constructor() {
        this.color = '#FFEB3B';
        this.isActive = false;
    }

    // Set note color
    setColor(color) {
        this.color = color;
    }

    // Activate/deactivate tool
    setActive(active) {
        this.isActive = active;
    }

    // Create note at position
    createNote(x, y, text = '') {
        return {
            type: 'note',
            color: this.color,
            x: x,
            y: y,
            text: text,
            createdAt: new Date().toISOString()
        };
    }

    // Format note for display in sidebar
    formatForList(note) {
        return {
            id: note.id,
            type: 'Note',
            preview: note.text ? note.text.substring(0, 50) + (note.text.length > 50 ? '...' : '') : '(Empty note)',
            pageIndex: note.pageIndex,
            color: note.color
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
