/**
 * PDF Object Parser
 *
 * Parses PDF objects from tokens:
 * - Dictionaries: << /Key value >>
 * - Arrays: [ item1 item2 ]
 * - Indirect objects: 1 0 obj ... endobj
 * - Indirect references: 1 0 R
 * - Streams: stream ... endstream
 */

import { Tokenizer } from './Tokenizer.js';

export class ObjectParser {
    constructor(tokenizer) {
        this.tokenizer = tokenizer;
        this.tokenBuffer = []; // For lookahead
    }

    // Get next token (with lookahead support)
    nextToken() {
        if (this.tokenBuffer.length > 0) {
            return this.tokenBuffer.shift();
        }
        return this.tokenizer.nextToken();
    }

    // Peek at next token without consuming
    peekToken(count = 1) {
        while (this.tokenBuffer.length < count) {
            const token = this.tokenizer.nextToken();
            if (token === null) break;
            this.tokenBuffer.push(token);
        }
        return this.tokenBuffer[count - 1] || null;
    }

    // Put token back for re-reading
    pushBack(token) {
        if (token) {
            this.tokenBuffer.unshift(token);
        }
    }

    // Parse any PDF object
    parseObject() {
        const token = this.nextToken();
        if (!token) return null;

        switch (token.type) {
            case 'number':
                return this.parseNumberOrRef(token);

            case 'string':
                return { type: 'string', value: token.value };

            case 'name':
                return { type: 'name', value: token.value };

            case 'boolean':
                return { type: 'boolean', value: token.value };

            case 'null':
                return { type: 'null', value: null };

            case 'arrayStart':
                return this.parseArray();

            case 'dictStart':
                return this.parseDict();

            case 'keyword':
                // Could be stream or other keyword
                return { type: 'keyword', value: token.value };

            default:
                return token;
        }
    }

    // Parse number, or check if it's an indirect reference (1 0 R)
    parseNumberOrRef(firstToken) {
        const first = firstToken.value;

        // Check if this might be an indirect reference: num1 num2 R
        const second = this.peekToken(1);
        if (!second || second.type !== 'number') {
            return { type: 'number', value: first };
        }

        const third = this.peekToken(2);

        if (third && third.type === 'keyword' && third.value === 'R') {
            // It's an indirect reference
            this.nextToken(); // consume second number
            this.nextToken(); // consume R
            return {
                type: 'ref',
                objNum: Math.floor(first),
                genNum: Math.floor(second.value)
            };
        }

        return { type: 'number', value: first };
    }

    // Parse array [ ... ]
    parseArray() {
        const items = [];

        while (true) {
            const token = this.peekToken(1);
            if (!token || token.type === 'arrayEnd') {
                this.nextToken(); // consume ]
                break;
            }
            const obj = this.parseObject();
            if (obj) items.push(obj);
        }

        return { type: 'array', value: items };
    }

    // Parse dictionary << ... >>
    parseDict() {
        const dict = {};

        while (true) {
            const token = this.nextToken();
            if (!token || token.type === 'dictEnd') {
                break;
            }

            if (token.type !== 'name') {
                // Invalid - dictionary key must be a name
                console.warn('Expected name in dictionary, got:', token);
                continue;
            }

            const key = token.value;
            const value = this.parseObject();
            dict[key] = value;
        }

        return { type: 'dict', value: dict };
    }

    // Parse an indirect object definition: num gen obj ... endobj
    parseIndirectObject(objNum, genNum) {
        // We've already read "num gen obj", now parse the content
        const obj = this.parseObject();

        // Check for stream
        if (obj && obj.type === 'dict') {
            this.tokenizer.skipWhitespaceAndComments();

            // Check if followed by "stream"
            const pos = this.tokenizer.getPosition();
            const keyword = this.tokenizer.readRegularChars();

            if (keyword === 'stream') {
                // Read stream data
                // Stream must be followed by single EOL (CR, LF, or CRLF)
                let byte = this.tokenizer.peek();
                if (byte === 13) { // CR
                    this.tokenizer.read();
                    if (this.tokenizer.peek() === 10) { // LF after CR
                        this.tokenizer.read();
                    }
                } else if (byte === 10) { // LF
                    this.tokenizer.read();
                }

                // Get stream length
                const lengthObj = obj.value.Length;
                let streamLength;

                if (lengthObj && lengthObj.type === 'number') {
                    streamLength = lengthObj.value;
                } else {
                    // Length is indirect reference - we'll need to resolve it later
                    // For now, search for endstream
                    streamLength = this.findEndStream();
                }

                const streamData = this.tokenizer.readBytes(streamLength);

                // Skip to endstream
                this.tokenizer.skipWhitespaceAndComments();
                this.tokenizer.readRegularChars(); // consume "endstream"

                return {
                    type: 'stream',
                    dict: obj.value,
                    data: streamData,
                    objNum,
                    genNum
                };
            } else {
                // Not a stream, restore position
                this.tokenizer.setPosition(pos);
            }
        }

        // Skip to endobj
        let token;
        do {
            token = this.nextToken();
        } while (token && !(token.type === 'keyword' && token.value === 'endobj'));

        return {
            ...obj,
            objNum,
            genNum
        };
    }

    // Find endstream when length is unknown
    findEndStream() {
        const startPos = this.tokenizer.getPosition();
        const endstreamBytes = new TextEncoder().encode('endstream');
        const pos = this.tokenizer.find(endstreamBytes, startPos);

        if (pos === -1) {
            throw new Error('Could not find endstream');
        }

        // Calculate length (excluding any trailing whitespace before endstream)
        let length = pos - startPos;

        // Check for EOL before endstream
        const data = this.tokenizer.data;
        while (length > 0) {
            const byte = data[startPos + length - 1];
            if (byte === 10 || byte === 13) {
                length--;
            } else {
                break;
            }
        }

        return length;
    }

    // Helper to get value from parsed object
    static getValue(obj) {
        if (!obj) return null;
        if (obj.type === 'number' || obj.type === 'boolean') return obj.value;
        if (obj.type === 'string') return obj.value;
        if (obj.type === 'name') return obj.value;
        if (obj.type === 'array') return obj.value;
        if (obj.type === 'dict') return obj.value;
        if (obj.type === 'null') return null;
        return obj;
    }

    // Helper to check if object is a reference
    static isRef(obj) {
        return obj && obj.type === 'ref';
    }

    // Helper to get number value
    static getNumber(obj, defaultValue = 0) {
        if (obj && obj.type === 'number') return obj.value;
        return defaultValue;
    }

    // Helper to get string value
    static getString(obj, defaultValue = '') {
        if (obj && obj.type === 'string') {
            if (obj.value instanceof Uint8Array) {
                return new TextDecoder('latin1').decode(obj.value);
            }
            return obj.value;
        }
        if (obj && obj.type === 'name') return obj.value;
        return defaultValue;
    }

    // Helper to get array value
    static getArray(obj, defaultValue = []) {
        if (obj && obj.type === 'array') return obj.value;
        return defaultValue;
    }

    // Helper to get dict value
    static getDict(obj, defaultValue = {}) {
        if (obj && obj.type === 'dict') return obj.value;
        if (obj && obj.type === 'stream') return obj.dict;
        return defaultValue;
    }

    // Helper to get name value
    static getName(obj, defaultValue = '') {
        if (obj && obj.type === 'name') return obj.value;
        return defaultValue;
    }
}
