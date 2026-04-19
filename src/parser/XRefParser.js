/**
 * PDF Cross-Reference Table Parser
 *
 * The xref table maps object numbers to byte offsets in the file.
 * PDFs can have:
 * - Traditional xref tables (text-based)
 * - Cross-reference streams (compressed, PDF 1.5+)
 * - Multiple xref sections (incremental updates)
 */

import { Tokenizer } from './Tokenizer.js';
import { ObjectParser } from './ObjectParser.js';

export class XRefParser {
    constructor(data) {
        this.data = data;
        this.tokenizer = new Tokenizer(data);
        this.xref = new Map(); // objNum -> { offset, gen, inUse }
        this.trailer = null;
    }

    // Parse the PDF and build xref table
    parse() {
        // Find startxref position
        const startxrefPos = this.findStartXRef();
        if (startxrefPos === -1) {
            throw new Error('Could not find startxref');
        }

        // Read the numeric offset token that follows "startxref".
        // Real PDFs sometimes include extra whitespace or non-standard line breaks here.
        const xrefOffset = this.readStartXRefOffset(startxrefPos);

        // Parse xref (could be table or stream)
        this.parseXRefAt(xrefOffset);

        return {
            xref: this.xref,
            trailer: this.trailer
        };
    }

    // Find "startxref" near end of file
    findStartXRef() {
        const startxrefBytes = new TextEncoder().encode('startxref');
        return this.tokenizer.findReverse(startxrefBytes);
    }

    readStartXRefOffset(startxrefPos) {
        const keywordLength = 'startxref'.length;
        this.tokenizer.setPosition(startxrefPos + keywordLength);
        this.tokenizer.skipWhitespaceAndComments();

        const token = this.tokenizer.nextToken();
        if (!token || token.type !== 'number' || !Number.isFinite(token.value)) {
            throw new Error('Could not read startxref offset');
        }

        return Math.floor(token.value);
    }

    // Parse xref at given offset
    parseXRefAt(offset) {
        const resolvedOffset = this.findNearestXRefOffset(offset);
        this.tokenizer.setPosition(resolvedOffset);
        this.tokenizer.skipWhitespaceAndComments();

        // Check if it's traditional xref or xref stream
        const peek = this.tokenizer.readRegularChars();

        if (peek === 'xref') {
            this.parseTraditionalXRef();
        } else {
            // It's an xref stream (object number)
            this.tokenizer.setPosition(resolvedOffset);
            this.parseXRefStream();
        }

        // Handle Prev pointer for incremental updates
        if (this.trailer && this.trailer.Prev) {
            const prevOffset = ObjectParser.getNumber(this.trailer.Prev);
            if (prevOffset > 0) {
                this.parseXRefAt(prevOffset);
            }
        }
    }

    findNearestXRefOffset(offset) {
        if (!Number.isInteger(offset) || offset < 0 || offset >= this.data.length) {
            throw new Error(`Invalid xref offset: ${offset}`);
        }

        const direct = this.classifyXRefOffset(offset);
        if (direct) {
            return offset;
        }

        // Some PDFs provide an offset that lands a few bytes away from the actual
        // xref header/object. Search a small local window before giving up.
        const windowStart = Math.max(0, offset - 64);
        const windowEnd = Math.min(this.data.length - 1, offset + 64);

        for (let candidate = windowStart; candidate <= windowEnd; candidate++) {
            if (this.classifyXRefOffset(candidate)) {
                return candidate;
            }
        }

        return offset;
    }

    classifyXRefOffset(offset) {
        this.tokenizer.setPosition(offset);
        this.tokenizer.skipWhitespaceAndComments();

        const probePos = this.tokenizer.getPosition();
        const word = this.tokenizer.readRegularChars();

        if (word === 'xref') {
            return 'table';
        }

        this.tokenizer.setPosition(probePos);
        const first = this.tokenizer.nextToken();
        const second = this.tokenizer.nextToken();
        const third = this.tokenizer.nextToken();

        if (first?.type === 'number' && second?.type === 'number' &&
            third?.type === 'keyword' && third.value === 'obj') {
            return 'stream';
        }

        return null;
    }

    // Parse traditional xref table
    parseTraditionalXRef() {
        // Format:
        // xref
        // 0 6        <- starting object number, count
        // 0000000000 65535 f
        // 0000000017 00000 n
        // ...

        while (true) {
            this.tokenizer.skipWhitespaceAndComments();
            const line = this.tokenizer.readLine().trim();

            if (line === 'trailer' || line.startsWith('trailer')) {
                // Parse trailer dictionary
                if (line === 'trailer') {
                    this.tokenizer.skipWhitespaceAndComments();
                }
                const parser = new ObjectParser(this.tokenizer);
                const trailerObj = parser.parseObject();
                this.trailer = ObjectParser.getDict(trailerObj);
                break;
            }

            // Parse subsection header: startObj count
            const parts = line.split(/\s+/);
            if (parts.length < 2) continue;

            const startObj = parseInt(parts[0], 10);
            const count = parseInt(parts[1], 10);

            // Read entries
            for (let i = 0; i < count; i++) {
                const entry = this.tokenizer.readLine().trim();
                if (entry.length < 17) continue;

                const offset = parseInt(entry.substring(0, 10), 10);
                const gen = parseInt(entry.substring(11, 16), 10);
                const inUse = entry.charAt(17) === 'n';

                const objNum = startObj + i;

                // Only add if not already present (later entries take precedence)
                if (!this.xref.has(objNum)) {
                    this.xref.set(objNum, { offset, gen, inUse });
                }
            }
        }
    }

    // Parse cross-reference stream (PDF 1.5+)
    parseXRefStream() {
        const parser = new ObjectParser(this.tokenizer);

        // Read object number and generation
        const objNumToken = parser.nextToken();
        const genNumToken = parser.nextToken();
        const objKeyword = parser.nextToken();

        if (!objKeyword || objKeyword.value !== 'obj') {
            throw new Error('Expected xref stream object');
        }

        // Parse the stream object
        const streamObj = parser.parseIndirectObject(
            objNumToken.value,
            genNumToken.value
        );

        if (streamObj.type !== 'stream') {
            throw new Error('Expected xref stream');
        }

        const dict = streamObj.dict;

        // Decompress stream data if needed
        let data = streamObj.data;
        // Note: XRef streams are often FlateDecode compressed
        // We'll handle decompression in StreamDecoder

        // Use trailer from stream dictionary
        this.trailer = dict;

        // Parse the stream data
        // W array specifies field widths: [offset_width, type_width, gen_width]
        const W = ObjectParser.getArray(dict.W).map(w => ObjectParser.getNumber(w));
        const Size = ObjectParser.getNumber(dict.Size);

        // Index array specifies subsections (default: [0, Size])
        let Index = dict.Index
            ? ObjectParser.getArray(dict.Index).map(i => ObjectParser.getNumber(i))
            : [0, Size];

        // For now, mark that we need decompression
        // Actual parsing will happen after decompression in PDFParser
        this.xrefStreamData = {
            data: streamObj.data,
            dict: dict,
            W,
            Index,
            filter: dict.Filter
        };
    }

    // Parse decompressed xref stream data
    parseXRefStreamData(data, W, Index) {
        const [w1, w2, w3] = W;
        const entrySize = w1 + w2 + w3;
        let dataOffset = 0;

        for (let i = 0; i < Index.length; i += 2) {
            const startObj = Index[i];
            const count = Index[i + 1];

            for (let j = 0; j < count; j++) {
                const objNum = startObj + j;

                // Read fields
                let type = w1 > 0 ? this.readInt(data, dataOffset, w1) : 1;
                dataOffset += w1;

                let field2 = this.readInt(data, dataOffset, w2);
                dataOffset += w2;

                let field3 = this.readInt(data, dataOffset, w3);
                dataOffset += w3;

                // Type 0: free object
                // Type 1: uncompressed object (field2 = offset, field3 = gen)
                // Type 2: compressed object (field2 = object stream num, field3 = index)

                if (!this.xref.has(objNum)) {
                    if (type === 0) {
                        this.xref.set(objNum, { offset: 0, gen: field3, inUse: false });
                    } else if (type === 1) {
                        this.xref.set(objNum, { offset: field2, gen: field3, inUse: true });
                    } else if (type === 2) {
                        this.xref.set(objNum, {
                            streamObjNum: field2,
                            indexInStream: field3,
                            inUse: true,
                            compressed: true
                        });
                    }
                }
            }
        }
    }

    // Read big-endian integer from bytes
    readInt(data, offset, length) {
        let value = 0;
        for (let i = 0; i < length; i++) {
            value = (value << 8) | data[offset + i];
        }
        return value;
    }

    // Get object entry from xref
    getEntry(objNum) {
        return this.xref.get(objNum);
    }

    // Check if object exists
    hasObject(objNum) {
        const entry = this.xref.get(objNum);
        return entry && entry.inUse;
    }
}
