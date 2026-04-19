/**
 * PDF Stream Decoder
 *
 * Handles decompression of PDF streams:
 * - FlateDecode (zlib/deflate) - most common
 * - ASCIIHexDecode
 * - ASCII85Decode
 * - RunLengthDecode
 * - LZWDecode (legacy)
 *
 * Also handles predictor functions for PNG-style filtering
 */

import { ObjectParser } from './ObjectParser.js';

export class StreamDecoder {
    constructor() {
        // Huffman tables for deflate
        this.fixedLitLenTree = null;
        this.fixedDistTree = null;
    }

    // Decode a stream based on its Filter(s)
    async decode(data, dict) {
        let filter = dict.Filter;
        let decodeParms = dict.DecodeParms;

        if (!filter) {
            return data;
        }

        // Handle array of filters
        const filters = filter.type === 'array'
            ? filter.value.map(f => ObjectParser.getName(f))
            : [ObjectParser.getName(filter)];

        const parmsArray = decodeParms && decodeParms.type === 'array'
            ? decodeParms.value
            : [decodeParms];

        let result = data;

        for (let i = 0; i < filters.length; i++) {
            const filterName = filters[i];
            const parms = parmsArray[i] ? ObjectParser.getDict(parmsArray[i]) : {};

            result = await this.applyFilter(result, filterName, parms);
        }

        return result;
    }

    // Apply a single filter
    async applyFilter(data, filterName, parms) {
        switch (filterName) {
            case 'FlateDecode':
            case 'Fl':
                return this.flateDecode(data, parms);

            case 'ASCIIHexDecode':
            case 'AHx':
                return this.asciiHexDecode(data);

            case 'ASCII85Decode':
            case 'A85':
                return this.ascii85Decode(data);

            case 'RunLengthDecode':
            case 'RL':
                return this.runLengthDecode(data);

            case 'LZWDecode':
            case 'LZW':
                return this.lzwDecode(data, parms);

            default:
                console.warn('Unknown filter:', filterName);
                return data;
        }
    }

    // FlateDecode (zlib inflate)
    async flateDecode(data, parms) {
        const inflated = await this.inflateWithNative(data);

        // Apply predictor if specified
        const predictor = parms.Predictor ? ObjectParser.getNumber(parms.Predictor) : 1;

        if (predictor > 1) {
            return this.applyPredictor(inflated, parms);
        }

        return inflated;
    }

    async inflateWithNative(data) {
        if (typeof process !== 'undefined' && process.versions?.node) {
            try {
                const zlib = await import('node:zlib');
                return new Uint8Array(zlib.inflateSync(data));
            } catch (err) {
                console.warn('Node zlib inflate failed, trying browser/native fallbacks:', err);
            }
        }

        if (typeof DecompressionStream === 'function') {
            try {
                return await this.inflateWithDecompressionStream(data);
            } catch (err) {
                console.warn('Native deflate decode failed, falling back to JS inflate:', err);
            }
        }

        // Fall back to the original pure-JS inflater if native support is unavailable.
        return this.inflate(this.stripZlibHeader(data));
    }

    async inflateWithDecompressionStream(data) {
        const stream = new DecompressionStream('deflate');
        const bufferPromise = new Response(stream.readable).arrayBuffer();
        const writer = stream.writable.getWriter();
        await writer.write(data);
        await writer.close();
        const buffer = await bufferPromise;
        return new Uint8Array(buffer);
    }

    stripZlibHeader(data) {
        let offset = 0;
        if (data.length >= 2) {
            const cmf = data[0];
            const flg = data[1];
            if ((cmf & 0x0F) === 8 && ((cmf * 256 + flg) % 31 === 0)) {
                offset = 2;
                if (flg & 0x20) {
                    offset += 4;
                }
            }
        }

        return data.slice(offset);
    }

    // Inflate (decompress) deflate data
    inflate(data) {
        const bits = new BitReader(data);
        const output = [];

        let bfinal;
        do {
            bfinal = bits.readBits(1);
            const btype = bits.readBits(2);

            if (btype === 0) {
                // Uncompressed block
                bits.alignToByte();
                const len = bits.readBits(16);
                bits.readBits(16); // nlen (complement)
                for (let i = 0; i < len; i++) {
                    output.push(bits.readBits(8));
                }
            } else if (btype === 1) {
                // Fixed Huffman codes
                this.inflateBlock(bits, output, this.getFixedLitLenTree(), this.getFixedDistTree());
            } else if (btype === 2) {
                // Dynamic Huffman codes
                const { litLenTree, distTree } = this.readDynamicTrees(bits);
                this.inflateBlock(bits, output, litLenTree, distTree);
            } else {
                throw new Error('Invalid deflate block type');
            }
        } while (!bfinal);

        return new Uint8Array(output);
    }

    // Inflate a block using Huffman trees
    inflateBlock(bits, output, litLenTree, distTree) {
        while (true) {
            const code = this.decodeSymbol(bits, litLenTree);

            if (code < 256) {
                // Literal byte
                output.push(code);
            } else if (code === 256) {
                // End of block
                break;
            } else {
                // Length-distance pair
                const length = this.decodeLength(bits, code);
                const distCode = this.decodeSymbol(bits, distTree);
                const distance = this.decodeDistance(bits, distCode);

                // Copy from output buffer
                const start = output.length - distance;
                for (let i = 0; i < length; i++) {
                    output.push(output[start + i]);
                }
            }
        }
    }

    // Decode a symbol using Huffman tree
    decodeSymbol(bits, tree) {
        let node = tree;
        while (node.left || node.right) {
            const bit = bits.readBits(1);
            node = bit ? node.right : node.left;
            if (!node) throw new Error('Invalid Huffman code');
        }
        return node.value;
    }

    // Length decoding table
    static LENGTH_EXTRA_BITS = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
    static LENGTH_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];

    decodeLength(bits, code) {
        const index = code - 257;
        const extra = StreamDecoder.LENGTH_EXTRA_BITS[index];
        const base = StreamDecoder.LENGTH_BASE[index];
        return base + bits.readBits(extra);
    }

    // Distance decoding table
    static DISTANCE_EXTRA_BITS = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
    static DISTANCE_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];

    decodeDistance(bits, code) {
        const extra = StreamDecoder.DISTANCE_EXTRA_BITS[code];
        const base = StreamDecoder.DISTANCE_BASE[code];
        return base + bits.readBits(extra);
    }

    // Build Huffman tree from code lengths
    buildHuffmanTree(codeLengths) {
        const maxLen = Math.max(...codeLengths);
        if (maxLen === 0) return { value: 0 };

        // Count codes of each length
        const blCount = new Array(maxLen + 1).fill(0);
        for (const len of codeLengths) {
            if (len > 0) blCount[len]++;
        }

        // Calculate starting code for each length
        const nextCode = new Array(maxLen + 1).fill(0);
        let code = 0;
        for (let len = 1; len <= maxLen; len++) {
            code = (code + blCount[len - 1]) << 1;
            nextCode[len] = code;
        }

        // Assign codes and build tree
        const root = {};
        for (let i = 0; i < codeLengths.length; i++) {
            const len = codeLengths[i];
            if (len === 0) continue;

            code = nextCode[len]++;
            let node = root;

            for (let bit = len - 1; bit >= 0; bit--) {
                const b = (code >> bit) & 1;
                if (b === 0) {
                    if (!node.left) node.left = {};
                    node = node.left;
                } else {
                    if (!node.right) node.right = {};
                    node = node.right;
                }
            }
            node.value = i;
        }

        return root;
    }

    // Get fixed literal/length Huffman tree
    getFixedLitLenTree() {
        if (this.fixedLitLenTree) return this.fixedLitLenTree;

        const lengths = new Array(288);
        for (let i = 0; i <= 143; i++) lengths[i] = 8;
        for (let i = 144; i <= 255; i++) lengths[i] = 9;
        for (let i = 256; i <= 279; i++) lengths[i] = 7;
        for (let i = 280; i <= 287; i++) lengths[i] = 8;

        this.fixedLitLenTree = this.buildHuffmanTree(lengths);
        return this.fixedLitLenTree;
    }

    // Get fixed distance Huffman tree
    getFixedDistTree() {
        if (this.fixedDistTree) return this.fixedDistTree;

        const lengths = new Array(32).fill(5);
        this.fixedDistTree = this.buildHuffmanTree(lengths);
        return this.fixedDistTree;
    }

    // Read dynamic Huffman trees from stream
    readDynamicTrees(bits) {
        const hlit = bits.readBits(5) + 257;  // # of literal/length codes
        const hdist = bits.readBits(5) + 1;   // # of distance codes
        const hclen = bits.readBits(4) + 4;   // # of code length codes

        // Code length code order
        const order = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

        // Read code length code lengths
        const clCodeLengths = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) {
            clCodeLengths[order[i]] = bits.readBits(3);
        }

        // Build code length Huffman tree
        const clTree = this.buildHuffmanTree(clCodeLengths);

        // Read literal/length and distance code lengths
        const codeLengths = [];
        while (codeLengths.length < hlit + hdist) {
            const code = this.decodeSymbol(bits, clTree);

            if (code < 16) {
                codeLengths.push(code);
            } else if (code === 16) {
                // Repeat previous 3-6 times
                const repeat = bits.readBits(2) + 3;
                const prev = codeLengths[codeLengths.length - 1];
                for (let i = 0; i < repeat; i++) codeLengths.push(prev);
            } else if (code === 17) {
                // Repeat 0 for 3-10 times
                const repeat = bits.readBits(3) + 3;
                for (let i = 0; i < repeat; i++) codeLengths.push(0);
            } else if (code === 18) {
                // Repeat 0 for 11-138 times
                const repeat = bits.readBits(7) + 11;
                for (let i = 0; i < repeat; i++) codeLengths.push(0);
            }
        }

        const litLenTree = this.buildHuffmanTree(codeLengths.slice(0, hlit));
        const distTree = this.buildHuffmanTree(codeLengths.slice(hlit));

        return { litLenTree, distTree };
    }

    // Apply PNG predictor function
    applyPredictor(data, parms) {
        const predictor = ObjectParser.getNumber(parms.Predictor, 1);
        const columns = ObjectParser.getNumber(parms.Columns, 1);
        const colors = ObjectParser.getNumber(parms.Colors, 1);
        const bitsPerComponent = ObjectParser.getNumber(parms.BitsPerComponent, 8);

        if (predictor === 1) {
            return data;
        }

        const bytesPerPixel = Math.ceil(colors * bitsPerComponent / 8);
        const rowBytes = Math.ceil(columns * colors * bitsPerComponent / 8);

        if (predictor === 2) {
            // TIFF predictor
            return this.tiffPredictor(data, columns, colors, bitsPerComponent);
        }

        // PNG predictors (10-15)
        const rows = Math.floor(data.length / (rowBytes + 1));
        const output = new Uint8Array(rows * rowBytes);

        let inOffset = 0;
        let outOffset = 0;

        for (let row = 0; row < rows; row++) {
            const filterType = data[inOffset++];
            const prevRow = row > 0 ? output.slice(outOffset - rowBytes, outOffset) : null;

            for (let col = 0; col < rowBytes; col++) {
                const raw = data[inOffset++];
                const a = col >= bytesPerPixel ? output[outOffset - bytesPerPixel] : 0;
                const b = prevRow ? prevRow[col] : 0;
                const c = (prevRow && col >= bytesPerPixel) ? prevRow[col - bytesPerPixel] : 0;

                let value;
                switch (filterType) {
                    case 0: value = raw; break;                    // None
                    case 1: value = raw + a; break;                // Sub
                    case 2: value = raw + b; break;                // Up
                    case 3: value = raw + Math.floor((a + b) / 2); break; // Average
                    case 4: value = raw + this.paethPredictor(a, b, c); break; // Paeth
                    default: value = raw;
                }

                output[outOffset++] = value & 0xFF;
            }
        }

        return output;
    }

    // Paeth predictor function
    paethPredictor(a, b, c) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);

        if (pa <= pb && pa <= pc) return a;
        if (pb <= pc) return b;
        return c;
    }

    // TIFF predictor
    tiffPredictor(data, columns, colors, bitsPerComponent) {
        const bytesPerRow = columns * colors * bitsPerComponent / 8;
        const rows = data.length / bytesPerRow;
        const output = new Uint8Array(data.length);

        for (let row = 0; row < rows; row++) {
            const rowStart = row * bytesPerRow;
            for (let col = 0; col < bytesPerRow; col++) {
                const prev = col >= colors ? output[rowStart + col - colors] : 0;
                output[rowStart + col] = (data[rowStart + col] + prev) & 0xFF;
            }
        }

        return output;
    }

    // ASCIIHexDecode
    asciiHexDecode(data) {
        const str = new TextDecoder().decode(data);
        const hex = str.replace(/\s/g, '').replace(/>$/, '');
        const result = new Uint8Array(Math.ceil(hex.length / 2));

        for (let i = 0; i < result.length; i++) {
            const h = hex.substr(i * 2, 2);
            result[i] = parseInt(h.padEnd(2, '0'), 16);
        }

        return result;
    }

    // ASCII85Decode
    ascii85Decode(data) {
        const str = new TextDecoder().decode(data);
        const clean = str.replace(/\s/g, '').replace(/^<~/, '').replace(/~>$/, '');
        const output = [];

        let i = 0;
        while (i < clean.length) {
            if (clean[i] === 'z') {
                // z = 4 zero bytes
                output.push(0, 0, 0, 0);
                i++;
            } else {
                // Decode 5 chars to 4 bytes
                const chunk = clean.substr(i, 5);
                let value = 0;

                for (let j = 0; j < chunk.length; j++) {
                    value = value * 85 + (chunk.charCodeAt(j) - 33);
                }

                // Pad if necessary
                const padding = 5 - chunk.length;
                for (let j = 0; j < padding; j++) {
                    value = value * 85 + 84;
                }

                const bytes = [
                    (value >> 24) & 0xFF,
                    (value >> 16) & 0xFF,
                    (value >> 8) & 0xFF,
                    value & 0xFF
                ];

                // Only push valid bytes
                for (let j = 0; j < 4 - padding; j++) {
                    output.push(bytes[j]);
                }

                i += chunk.length;
            }
        }

        return new Uint8Array(output);
    }

    // RunLengthDecode
    runLengthDecode(data) {
        const output = [];
        let i = 0;

        while (i < data.length) {
            const length = data[i++];

            if (length === 128) {
                // End of data
                break;
            } else if (length < 128) {
                // Copy next length+1 bytes literally
                for (let j = 0; j <= length && i < data.length; j++) {
                    output.push(data[i++]);
                }
            } else {
                // Repeat next byte 257-length times
                const repeat = 257 - length;
                const byte = data[i++];
                for (let j = 0; j < repeat; j++) {
                    output.push(byte);
                }
            }
        }

        return new Uint8Array(output);
    }

    // LZWDecode
    lzwDecode(data, parms) {
        const earlyChange = parms.EarlyChange !== undefined
            ? ObjectParser.getNumber(parms.EarlyChange)
            : 1;

        const output = [];
        const bits = new BitReader(data);

        // Initialize dictionary with single-byte entries
        let dict = [];
        for (let i = 0; i < 256; i++) {
            dict[i] = [i];
        }
        dict[256] = null; // Clear table
        dict[257] = null; // EOD

        let codeSize = 9;
        let nextCode = 258;
        let prevEntry = null;

        while (true) {
            const code = bits.readBits(codeSize);

            if (code === 257) {
                // End of data
                break;
            }

            if (code === 256) {
                // Clear table
                dict = [];
                for (let i = 0; i < 256; i++) {
                    dict[i] = [i];
                }
                dict[256] = null;
                dict[257] = null;
                codeSize = 9;
                nextCode = 258;
                prevEntry = null;
                continue;
            }

            let entry;
            if (code < nextCode) {
                entry = dict[code];
            } else if (code === nextCode && prevEntry) {
                entry = [...prevEntry, prevEntry[0]];
            } else {
                throw new Error('Invalid LZW code');
            }

            output.push(...entry);

            if (prevEntry) {
                dict[nextCode++] = [...prevEntry, entry[0]];

                // Increase code size if needed
                const threshold = earlyChange ? nextCode : nextCode - 1;
                if (threshold >= (1 << codeSize) && codeSize < 12) {
                    codeSize++;
                }
            }

            prevEntry = entry;
        }

        const result = new Uint8Array(output);

        // Apply predictor if specified
        const predictor = parms.Predictor ? ObjectParser.getNumber(parms.Predictor) : 1;
        if (predictor > 1) {
            return this.applyPredictor(result, parms);
        }

        return result;
    }
}

// Bit reader helper for inflate
class BitReader {
    constructor(data) {
        this.data = data;
        this.pos = 0;
        this.bitPos = 0;
        this.currentByte = 0;
    }

    readBits(count) {
        let result = 0;
        let bitsRead = 0;

        while (bitsRead < count) {
            if (this.bitPos === 0) {
                if (this.pos >= this.data.length) {
                    return result;
                }
                this.currentByte = this.data[this.pos++];
            }

            const bitsAvailable = 8 - this.bitPos;
            const bitsToRead = Math.min(count - bitsRead, bitsAvailable);

            const mask = (1 << bitsToRead) - 1;
            const bits = (this.currentByte >> this.bitPos) & mask;

            result |= bits << bitsRead;
            bitsRead += bitsToRead;
            this.bitPos += bitsToRead;

            if (this.bitPos >= 8) {
                this.bitPos = 0;
            }
        }

        return result;
    }

    alignToByte() {
        this.bitPos = 0;
    }
}
