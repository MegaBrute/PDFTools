/**
 * PDF Parser - Main orchestrator
 *
 * Coordinates all parsing components to load a PDF document:
 * - Parse xref table to locate objects
 * - Load and cache objects on demand
 * - Navigate document structure (catalog -> pages -> content)
 * - Extract page content for rendering
 */

import { Tokenizer } from './Tokenizer.js';
import { ObjectParser } from './ObjectParser.js';
import { XRefParser } from './XRefParser.js';
import { StreamDecoder } from './StreamDecoder.js';

export class PDFParser {
    constructor(data) {
        this.data = data instanceof Uint8Array ? data : new Uint8Array(data);
        this.tokenizer = new Tokenizer(this.data);
        this.streamDecoder = new StreamDecoder();
        this.objectCache = new Map();
        this.xref = null;
        this.trailer = null;
    }

    // Parse the PDF document
    async parse() {
        // Verify PDF header
        this.verifyHeader();

        // Parse xref table
        const xrefParser = new XRefParser(this.data);
        const result = xrefParser.parse();

        this.xref = result.xref;
        this.trailer = result.trailer;

        // Handle xref stream decompression if needed
        if (xrefParser.xrefStreamData) {
            const { data, W, Index, filter } = xrefParser.xrefStreamData;

            if (filter) {
                const decompressed = this.streamDecoder.decode(data, { Filter: filter });
                xrefParser.parseXRefStreamData(decompressed, W, Index);
                this.xref = xrefParser.xref;
            }
        }

        // Get document catalog
        const rootRef = this.trailer.Root;
        const catalog = await this.resolveRef(rootRef);

        // Get page tree
        const pagesRef = ObjectParser.getDict(catalog).Pages;
        const pages = await this.resolveRef(pagesRef);

        return {
            catalog: ObjectParser.getDict(catalog),
            pages: ObjectParser.getDict(pages),
            pageCount: ObjectParser.getNumber(ObjectParser.getDict(pages).Count),
            info: this.trailer.Info ? await this.resolveRef(this.trailer.Info) : null
        };
    }

    // Verify PDF header
    verifyHeader() {
        const header = new TextDecoder().decode(this.data.slice(0, 8));
        if (!header.startsWith('%PDF-')) {
            throw new Error('Invalid PDF file: missing header');
        }
        this.version = header.substring(5, 8);
    }

    // Get an object by reference
    async getObject(objNum, genNum = 0) {
        const cacheKey = `${objNum}_${genNum}`;

        if (this.objectCache.has(cacheKey)) {
            return this.objectCache.get(cacheKey);
        }

        const entry = this.xref.get(objNum);
        if (!entry || !entry.inUse) {
            return null;
        }

        let obj;

        if (entry.compressed) {
            // Object is in an object stream
            obj = await this.getCompressedObject(entry.streamObjNum, entry.indexInStream);
        } else {
            // Regular object at file offset
            obj = this.readObjectAt(entry.offset);
        }

        this.objectCache.set(cacheKey, obj);
        return obj;
    }

    // Read object at file offset
    readObjectAt(offset) {
        this.tokenizer.setPosition(offset);
        const parser = new ObjectParser(this.tokenizer);

        // Read "objNum genNum obj"
        const objNumToken = parser.nextToken();
        const genNumToken = parser.nextToken();
        const objKeyword = parser.nextToken();

        if (!objKeyword || objKeyword.value !== 'obj') {
            throw new Error(`Expected 'obj' at offset ${offset}`);
        }

        const obj = parser.parseIndirectObject(
            objNumToken.value,
            genNumToken.value
        );

        // Decode stream if present
        if (obj.type === 'stream') {
            try {
                obj.decodedData = this.streamDecoder.decode(obj.data, obj.dict);
            } catch (e) {
                console.warn('Stream decode error:', e);
                obj.decodedData = obj.data;
            }
        }

        return obj;
    }

    // Get object from object stream
    async getCompressedObject(streamObjNum, index) {
        const stream = await this.getObject(streamObjNum);
        if (!stream || stream.type !== 'stream') {
            throw new Error('Invalid object stream');
        }

        const dict = stream.dict;
        const n = ObjectParser.getNumber(dict.N); // Number of objects
        const first = ObjectParser.getNumber(dict.First); // Offset of first object

        const data = stream.decodedData || stream.data;
        const dataStr = new TextDecoder('latin1').decode(data);

        // Parse object number/offset pairs
        const headerTokenizer = new Tokenizer(data.slice(0, first));
        const headerParser = new ObjectParser(headerTokenizer);

        const entries = [];
        for (let i = 0; i < n; i++) {
            const objNum = headerParser.nextToken().value;
            const offset = headerParser.nextToken().value;
            entries.push({ objNum, offset });
        }

        // Find the requested object
        const entry = entries[index];
        if (!entry) {
            throw new Error(`Object index ${index} not found in stream`);
        }

        // Parse the object
        const objOffset = first + entry.offset;
        const objTokenizer = new Tokenizer(data.slice(objOffset));
        const objParser = new ObjectParser(objTokenizer);

        return objParser.parseObject();
    }

    // Resolve an indirect reference
    async resolveRef(ref) {
        if (!ref || ref.type !== 'ref') {
            return ref;
        }
        return this.getObject(ref.objNum, ref.genNum);
    }

    // Recursively resolve all references in an object
    async resolveRefs(obj, depth = 0) {
        if (depth > 100) return obj; // Prevent infinite recursion

        if (!obj) return obj;

        if (obj.type === 'ref') {
            const resolved = await this.resolveRef(obj);
            return this.resolveRefs(resolved, depth + 1);
        }

        if (obj.type === 'array') {
            const resolved = [];
            for (const item of obj.value) {
                resolved.push(await this.resolveRefs(item, depth + 1));
            }
            return { type: 'array', value: resolved };
        }

        if (obj.type === 'dict') {
            const resolved = {};
            for (const [key, value] of Object.entries(obj.value)) {
                resolved[key] = await this.resolveRefs(value, depth + 1);
            }
            return { type: 'dict', value: resolved };
        }

        return obj;
    }

    // Get all pages
    async getPages() {
        const pagesRef = (await this.resolveRef(this.trailer.Root)).value.Pages;
        const pagesDict = await this.resolveRef(pagesRef);

        return this.flattenPageTree(pagesDict);
    }

    // Flatten page tree into array of page objects
    async flattenPageTree(node, inherited = {}) {
        const dict = ObjectParser.getDict(node);
        const type = ObjectParser.getName(dict.Type);

        // Inherit resources, mediabox, etc.
        const newInherited = { ...inherited };
        if (dict.Resources) newInherited.Resources = dict.Resources;
        if (dict.MediaBox) newInherited.MediaBox = dict.MediaBox;
        if (dict.CropBox) newInherited.CropBox = dict.CropBox;
        if (dict.Rotate) newInherited.Rotate = dict.Rotate;

        if (type === 'Page') {
            // Apply inherited properties
            return [{
                ...dict,
                Resources: dict.Resources || newInherited.Resources,
                MediaBox: dict.MediaBox || newInherited.MediaBox,
                CropBox: dict.CropBox || newInherited.CropBox,
                Rotate: dict.Rotate || newInherited.Rotate
            }];
        }

        if (type === 'Pages') {
            const pages = [];
            const kids = ObjectParser.getArray(dict.Kids);

            for (const kidRef of kids) {
                const kid = await this.resolveRef(kidRef);
                const kidPages = await this.flattenPageTree(kid, newInherited);
                pages.push(...kidPages);
            }

            return pages;
        }

        return [];
    }

    // Get page content stream(s)
    async getPageContent(page) {
        const contents = page.Contents;
        if (!contents) return new Uint8Array(0);

        if (contents.type === 'ref') {
            const obj = await this.resolveRef(contents);
            if (obj.type === 'stream') {
                return obj.decodedData || obj.data;
            }
            if (obj.type === 'array') {
                return this.concatenateStreams(obj.value);
            }
        }

        if (contents.type === 'array') {
            return this.concatenateStreams(contents.value);
        }

        return new Uint8Array(0);
    }

    // Concatenate multiple content streams
    async concatenateStreams(refs) {
        const parts = [];

        for (const ref of refs) {
            const obj = await this.resolveRef(ref);
            if (obj && obj.type === 'stream') {
                parts.push(obj.decodedData || obj.data);
            }
        }

        // Calculate total length
        const totalLength = parts.reduce((sum, p) => sum + p.length + 1, 0);
        const result = new Uint8Array(totalLength);

        let offset = 0;
        for (const part of parts) {
            result.set(part, offset);
            offset += part.length;
            result[offset++] = 10; // newline between streams
        }

        return result;
    }

    // Get page resources
    async getPageResources(page) {
        const resources = page.Resources;
        if (!resources) return {};

        const resolved = await this.resolveRef(resources);
        return ObjectParser.getDict(resolved);
    }

    // Get page dimensions
    getPageDimensions(page) {
        const mediaBox = ObjectParser.getArray(page.MediaBox);
        const cropBox = page.CropBox ? ObjectParser.getArray(page.CropBox) : mediaBox;
        const rotate = ObjectParser.getNumber(page.Rotate, 0);

        const box = cropBox || mediaBox;
        const x1 = ObjectParser.getNumber(box[0]);
        const y1 = ObjectParser.getNumber(box[1]);
        const x2 = ObjectParser.getNumber(box[2]);
        const y2 = ObjectParser.getNumber(box[3]);

        let width = x2 - x1;
        let height = y2 - y1;

        // Swap dimensions for 90/270 degree rotation
        if (rotate === 90 || rotate === 270) {
            [width, height] = [height, width];
        }

        return { width, height, rotate, x1, y1 };
    }

    // Get font from resources
    async getFont(resources, fontName) {
        const fonts = resources.Font;
        if (!fonts) return null;

        const fontsDict = ObjectParser.getDict(await this.resolveRef(fonts));
        const fontRef = fontsDict[fontName];

        if (!fontRef) return null;

        return this.resolveRef(fontRef);
    }

    // Get XObject (image, form) from resources
    async getXObject(resources, name) {
        const xobjects = resources.XObject;
        if (!xobjects) return null;

        const xobjectsDict = ObjectParser.getDict(await this.resolveRef(xobjects));
        const xobjRef = xobjectsDict[name];

        if (!xobjRef) return null;

        return this.resolveRef(xobjRef);
    }
}
