/**
 * PDF Tokenizer - Lexical analysis for PDF files
 *
 * PDF tokens include:
 * - Numbers (integers and reals)
 * - Strings (literal and hexadecimal)
 * - Names (like /Type, /Page)
 * - Arrays [ ]
 * - Dictionaries << >>
 * - Keywords (obj, endobj, stream, endstream, R, true, false, null)
 * - Comments (% to end of line)
 */

export class Tokenizer {
    constructor(data) {
        // data is a Uint8Array
        this.data = data;
        this.pos = 0;
        this.length = data.length;
    }

    // Character classification
    static WHITESPACE = new Set([0, 9, 10, 12, 13, 32]); // null, tab, LF, FF, CR, space
    static DELIMITERS = new Set([
        40, 41,  // ( )
        60, 62,  // < >
        91, 93,  // [ ]
        123, 125, // { }
        47,      // /
        37       // %
    ]);

    isWhitespace(byte) {
        return Tokenizer.WHITESPACE.has(byte);
    }

    isDelimiter(byte) {
        return Tokenizer.DELIMITERS.has(byte);
    }

    isDigit(byte) {
        return byte >= 48 && byte <= 57; // 0-9
    }

    isHexDigit(byte) {
        return this.isDigit(byte) ||
               (byte >= 65 && byte <= 70) ||  // A-F
               (byte >= 97 && byte <= 102);   // a-f
    }

    peek(offset = 0) {
        const pos = this.pos + offset;
        return pos < this.length ? this.data[pos] : -1;
    }

    read() {
        return this.pos < this.length ? this.data[this.pos++] : -1;
    }

    skipWhitespace() {
        while (this.pos < this.length && this.isWhitespace(this.data[this.pos])) {
            this.pos++;
        }
    }

    skipComment() {
        // Skip from % to end of line
        while (this.pos < this.length) {
            const byte = this.data[this.pos++];
            if (byte === 10 || byte === 13) break; // LF or CR
        }
    }

    skipWhitespaceAndComments() {
        while (this.pos < this.length) {
            const byte = this.data[this.pos];
            if (this.isWhitespace(byte)) {
                this.pos++;
            } else if (byte === 37) { // %
                this.skipComment();
            } else {
                break;
            }
        }
    }

    // Read a sequence of regular characters (not whitespace or delimiters)
    readRegularChars() {
        const start = this.pos;
        while (this.pos < this.length) {
            const byte = this.data[this.pos];
            if (this.isWhitespace(byte) || this.isDelimiter(byte)) {
                break;
            }
            this.pos++;
        }
        return this.getString(start, this.pos);
    }

    getString(start, end) {
        const bytes = this.data.slice(start, end);
        return new TextDecoder('latin1').decode(bytes);
    }

    // Parse a number (integer or real)
    readNumber(firstChar) {
        let str = firstChar;
        while (this.pos < this.length) {
            const byte = this.data[this.pos];
            if (this.isDigit(byte) || byte === 46 || byte === 45 || byte === 43) {
                // digit, '.', '-', '+'
                str += String.fromCharCode(byte);
                this.pos++;
            } else {
                break;
            }
        }
        const num = parseFloat(str);
        return { type: 'number', value: num };
    }

    // Parse a literal string (...)
    readLiteralString() {
        let result = [];
        let parenDepth = 1;

        while (this.pos < this.length && parenDepth > 0) {
            let byte = this.read();

            if (byte === 40) { // (
                parenDepth++;
                result.push(byte);
            } else if (byte === 41) { // )
                parenDepth--;
                if (parenDepth > 0) result.push(byte);
            } else if (byte === 92) { // backslash - escape sequence
                byte = this.read();
                switch (byte) {
                    case 110: result.push(10); break;  // \n
                    case 114: result.push(13); break;  // \r
                    case 116: result.push(9); break;   // \t
                    case 98: result.push(8); break;    // \b
                    case 102: result.push(12); break;  // \f
                    case 40: result.push(40); break;   // \(
                    case 41: result.push(41); break;   // \)
                    case 92: result.push(92); break;   // \\
                    case 10: break; // line continuation (LF)
                    case 13: // line continuation (CR or CRLF)
                        if (this.peek() === 10) this.pos++;
                        break;
                    default:
                        // Octal escape \ddd
                        if (byte >= 48 && byte <= 55) {
                            let octal = String.fromCharCode(byte);
                            for (let i = 0; i < 2 && this.pos < this.length; i++) {
                                const next = this.peek();
                                if (next >= 48 && next <= 55) {
                                    octal += String.fromCharCode(this.read());
                                } else {
                                    break;
                                }
                            }
                            result.push(parseInt(octal, 8) & 0xFF);
                        } else {
                            result.push(byte);
                        }
                }
            } else {
                result.push(byte);
            }
        }

        return { type: 'string', value: new Uint8Array(result) };
    }

    // Parse a hexadecimal string <...>
    readHexString() {
        let hex = '';
        while (this.pos < this.length) {
            const byte = this.read();
            if (byte === 62) break; // >
            if (!this.isWhitespace(byte)) {
                hex += String.fromCharCode(byte);
            }
        }
        // Pad with 0 if odd length
        if (hex.length % 2 !== 0) {
            hex += '0';
        }
        const result = new Uint8Array(hex.length / 2);
        for (let i = 0; i < result.length; i++) {
            result[i] = parseInt(hex.substr(i * 2, 2), 16);
        }
        return { type: 'string', value: result };
    }

    // Parse a name /...
    readName() {
        let name = '';
        while (this.pos < this.length) {
            const byte = this.data[this.pos];
            if (this.isWhitespace(byte) || this.isDelimiter(byte)) {
                break;
            }
            this.pos++;
            if (byte === 35) { // # hex escape
                const hex = String.fromCharCode(this.read()) + String.fromCharCode(this.read());
                name += String.fromCharCode(parseInt(hex, 16));
            } else {
                name += String.fromCharCode(byte);
            }
        }
        return { type: 'name', value: name };
    }

    // Get next token
    nextToken() {
        this.skipWhitespaceAndComments();

        if (this.pos >= this.length) {
            return null;
        }

        const byte = this.data[this.pos];

        // Array start
        if (byte === 91) { // [
            this.pos++;
            return { type: 'arrayStart' };
        }

        // Array end
        if (byte === 93) { // ]
            this.pos++;
            return { type: 'arrayEnd' };
        }

        // Dictionary or hex string
        if (byte === 60) { // <
            this.pos++;
            if (this.peek() === 60) { // <<
                this.pos++;
                return { type: 'dictStart' };
            }
            return this.readHexString();
        }

        // Dictionary end
        if (byte === 62) { // >
            this.pos++;
            if (this.peek() === 62) { // >>
                this.pos++;
                return { type: 'dictEnd' };
            }
            // Stray > - shouldn't happen in valid PDF
            return { type: 'error', value: '>' };
        }

        // Literal string
        if (byte === 40) { // (
            this.pos++;
            return this.readLiteralString();
        }

        // Name
        if (byte === 47) { // /
            this.pos++;
            return this.readName();
        }

        // Number or keyword
        if (this.isDigit(byte) || byte === 45 || byte === 43 || byte === 46) {
            // Could be number: 123, -45, +67, .89
            const firstChar = String.fromCharCode(this.read());
            return this.readNumber(firstChar);
        }

        // Keyword (true, false, null, obj, endobj, stream, endstream, R, etc.)
        const word = this.readRegularChars();

        if (word === 'true') return { type: 'boolean', value: true };
        if (word === 'false') return { type: 'boolean', value: false };
        if (word === 'null') return { type: 'null', value: null };

        return { type: 'keyword', value: word };
    }

    // Utility: find a byte sequence
    find(sequence, startPos = 0) {
        const seqLen = sequence.length;
        for (let i = startPos; i <= this.length - seqLen; i++) {
            let match = true;
            for (let j = 0; j < seqLen; j++) {
                if (this.data[i + j] !== sequence[j]) {
                    match = false;
                    break;
                }
            }
            if (match) return i;
        }
        return -1;
    }

    // Find sequence searching backwards
    findReverse(sequence, startPos = this.length - 1) {
        const seqLen = sequence.length;
        for (let i = startPos - seqLen + 1; i >= 0; i--) {
            let match = true;
            for (let j = 0; j < seqLen; j++) {
                if (this.data[i + j] !== sequence[j]) {
                    match = false;
                    break;
                }
            }
            if (match) return i;
        }
        return -1;
    }

    // Read a line from current position
    readLine() {
        const start = this.pos;
        while (this.pos < this.length) {
            const byte = this.data[this.pos];
            if (byte === 10 || byte === 13) {
                const line = this.getString(start, this.pos);
                // Skip line ending
                if (byte === 13 && this.peek() === 10) {
                    this.pos += 2;
                } else {
                    this.pos++;
                }
                return line;
            }
            this.pos++;
        }
        return this.getString(start, this.pos);
    }

    // Set position
    setPosition(pos) {
        this.pos = pos;
    }

    // Get current position
    getPosition() {
        return this.pos;
    }

    // Read raw bytes
    readBytes(count) {
        const bytes = this.data.slice(this.pos, this.pos + count);
        this.pos += count;
        return bytes;
    }
}
