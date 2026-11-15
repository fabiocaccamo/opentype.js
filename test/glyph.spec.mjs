import assert  from 'assert';
import { parse, Glyph, Path } from '../src/opentype.mjs';
import { readFileSync } from 'fs';
import { createMockObject, getTableRecordOffset } from './testutil.mjs';
import { itFailsUntilFixed } from './regression/helpers.mjs';
const loadSync = (url, opt) => parse(readFileSync(url), opt);

const emojiFont = loadSync('./test/fonts/OpenMojiCOLRv0-subset.otf');

describe('glyph.mjs', function() {

    describe('lazy loading', function() {
        let font;
        let glyph;

        beforeEach(function() {
            font = loadSync('./test/fonts/Roboto-Black.ttf');
            glyph = font.charToGlyph('A');
        });

        it('lazily loads xMin', function() {
            assert.equal(glyph.xMin, -3);
        });

        it('lazily loads xMax', function() {
            assert.equal(glyph.xMax, 1399);
        });

        it('lazily loads yMin', function() {
            assert.equal(glyph.yMin, 0);
        });

        it('lazily loads yMax', function() {
            assert.equal(glyph.yMax, 1456);
        });

        it('lazily loads numberOfContours', function() {
            assert.equal(glyph.numberOfContours, 2);
        });

        it('lazily loads COLR layers on paths', function() {
            const layers = emojiFont.glyphs.get(138).getLayers(emojiFont);
            assert.equal(Array.isArray(layers), true);
            assert.equal(layers.length, 4);
        });
    });

    describe('bounding box', function() {
        let trueTypeFont;
        let openTypeFont;

        beforeEach(function() {
            trueTypeFont = loadSync('./test/fonts/Roboto-Black.ttf');
            openTypeFont = loadSync('./test/fonts/FiraSansMedium.woff');
        });

        it('calculates a box for a linear shape', function() {
            const glyph = trueTypeFont.charToGlyph('A');
            const box = glyph.getBoundingBox();
            assert.equal(box.x1, -3);
            assert.equal(box.y1, 0);
            assert.equal(box.x2, 1399);
            assert.equal(box.y2, 1456);
        });

        it('calculates a box for a quadratic shape', function() {
            const glyph = trueTypeFont.charToGlyph('Q');
            const box = glyph.getBoundingBox();
            assert.equal(box.x1, 72);
            assert.equal(box.y1, -266);
            assert.equal(box.x2, 1345);
            assert.equal(box.y2, 1476);
        });

        it('calculates a box for a bezier shape', function() {
            const glyph = openTypeFont.charToGlyph('Q');
            const box = glyph.getBoundingBox();
            assert.equal(box.x1, 62);
            assert.equal(box.y1, -103);
            assert.equal(box.x2, 688);
            assert.equal(box.y2, 701);
        });
    });

    describe('new Glyph', function() {
        let glyph = new Glyph({
            name: 'Test Glyph',
            unicode: 65,
            unicodes: [65, 66],
            path: new Path(),
            advanceWidth: 400,
            leftSideBearing: -100
        });

        it('verifies that the options have all been set', function() {
            assert.equal(glyph.name, 'Test Glyph');
            assert.equal(glyph.unicode, 65);
            assert.equal(glyph.advanceWidth, 400);
            assert.equal(glyph.leftSideBearing, -100);
            assert.deepEqual(glyph.unicodes, [65, 66]);
        });
    });

    describe('SVG handling', function() {
        it('should flip the path Y coordinates when generating or parsing SVG paths', function() {
            const font = loadSync('./test/fonts/FiraSansMedium.woff');
            const glyph = font.charToGlyph('j');
            const svgPath = glyph.toPathData();
            const svgMarkup = glyph.toSVG();
            const expectedPath = 'M25 772C130 725 185 680 185 528L185 33L93 33L93 534C93 647 60 673-9 705ZM204-150' +
                'C204-185 177-212 139-212C101-212 75-185 75-150C75-114 101-87 139-87C177-87 204-114 204-150Z';
            assert.equal(
                svgPath,
                expectedPath
            );
            assert.equal(
                svgMarkup,
                '<path d="' + expectedPath + '"/>'
            );

            // we can't test toDOMElement() in node context!
            // @TODO: we'll be able to by leveraging the new mock functionality in testutil.mjs

            const trianglePathUp = 'M318 230L182 230L250 93Z';
            const trianglePathDown = 'M318 320L182 320L250 457Z';
            const flipOption = {
                minY: font.ascender,
                maxY: font.ascender,
                flipY: true,
                flipYBase: font.ascender + font.descender
            };
            glyph.fromSVG(trianglePathUp, flipOption);
            assert.equal(glyph.path.toPathData({flipY: false}), trianglePathDown);
            assert.equal(glyph.toPathData(flipOption), trianglePathUp);
        });

        it('should not throw an error during optimization for paths with few points', function() {
            const textToRender = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ffffiThe king said: เป็นคนใจดีสำหรับทุกคน because ความรักคือทุกสิ่งThe king said: ائتوني به أستخلصه لنفسيBe kind, هناش الإ ءيش نم عزن الو ، هناز الإ ءيش يف قفرلا ناك امفลลฤๅ';
            assert.doesNotThrow(function() {
                const font = loadSync('./test/fonts/Jomhuria-Regular.ttf');
                const glyphs = font.stringToGlyphs(textToRender);
                for (let i = 0; i < glyphs.length; i++) {
                    const glyph = glyphs[i];
                    glyph.path.toSVG();
                }
            });
        });
    });

    describe('toPathData options', function() {
        it('should invoke pathTransform callback', function() {
            const font = loadSync('./test/fonts/FiraSansMedium.woff');
            const glyph = font.charToGlyph('A');
            let called = false;
            glyph.toPathData({
                pathTransform: function(path) {
                    called = true;
                    return path;
                }
            }, font);
            assert.equal(called, true);
        });
    });

    describe('component transformation', function() {
        // @TODO test components more thoroughly,
        // maybe move to a separate glyf test file
        
        const changaVarFont = loadSync('./test/fonts/Changa-VariableFont_wght.ttf');

        it('handles 2x2 transform correctly',function() {
            const glyph = changaVarFont.charToGlyph('+');
            assert.deepEqual(glyph.toPathData(), 'M91 342L91 284L440 284L440 342ZM294 487L236 487L236 138L294 138Z');
        });
    });

    describe('circular composite glyph references', function() {
        it('does not crash on fonts with circular composite references', function() {
            const font = loadSync('./test/fonts/circular-composite.ttf');
            // Verify cmap maps 'A' to glyph 1
            const glyphA = font.charToGlyph('A');
            assert.equal(glyphA.index, 1);
            const glyph2 = font.glyphs.get(2);
            // Should return paths without stack overflow
            const path1 = glyphA.getPath();
            const path2 = glyph2.getPath();
            assert.ok(path1 instanceof Path);
            assert.ok(path2 instanceof Path);
        });
    });

    describe('color glyph drawing/rendering', function() {
        it('draws and renders layers correctly', function() {
            let contextLogs = [];
            const ctx = createMockObject(contextLogs, undefined/*, { consoleLog: 'ctx' }*/);
            emojiFont.glyphs.get(138).draw(ctx, 0, 0, 12, {}, emojiFont);
            const expectedProps = [
                'beginPath', 'moveTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'fillStyle', 'fill',
                'beginPath', 'moveTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'fillStyle', 'fill',
                'beginPath', 'moveTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'fillStyle', 'fill',
                'beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'lineTo', 'lineTo', 'bezierCurveTo',
                'lineTo', 'lineTo', 'bezierCurveTo', 'lineTo', 'lineTo', 'bezierCurveTo', 'lineTo',
                'moveTo', 'lineTo', 'lineTo', 'lineTo', 'lineTo', 'fillStyle', 'fill',

            ];
            assert.deepEqual(contextLogs.map(log => log.property), expectedProps);
            assert.deepEqual(contextLogs[6], { property: 'fillStyle', value: 'rgba(241, 179, 28, 1)' });
            assert.deepEqual(contextLogs[14], { property: 'fillStyle', value: 'rgba(210, 47, 39, 1)' });
            assert.deepEqual(contextLogs[22], { property: 'fillStyle', value: 'rgba(0, 0, 0, 1)' });
            assert.deepEqual(contextLogs[43], { property: 'fillStyle', value: 'rgba(0, 0, 0, 1)' });
            const layerPath = emojiFont.glyphs.get(3540).getPath(0, 0, 72, {colorFormat: 'hexa'}, emojiFont)._layers[0];
            const layerGlyphPath = emojiFont.glyphs.get(21090).getPath(0, 0, 72, {}, emojiFont);
            assert.deepEqual(layerPath.commands, layerGlyphPath.commands);
            assert.deepEqual(layerPath.fill, '#3f3f3fff');
        });

        it('does not draw layers when options.drawLayers = false', function() {
            let contextLogs = [];
            const ctx = createMockObject(contextLogs, undefined/*, { consoleLog: 'ctx' }*/);
            emojiFont.glyphs.get(138).draw(ctx, 0, 0, 12, { drawLayers: false }, emojiFont);
            const expectedProps = [
                'beginPath', 'moveTo', 'lineTo', 'lineTo', 'fillStyle', 'fill',
            ];
            assert.deepEqual(contextLogs.map(log => log.property), expectedProps);
        });

        it('reflects color and palette changes', function() {
            let path = emojiFont.glyphs.get(929).getPath(0, 0, 12, {}, emojiFont);
            emojiFont.palettes.add(emojiFont.palettes.get(0).reverse());
            assert.equal(path._layers.length, 8);
            path = emojiFont.glyphs.get(929).getPath(0, 0, 12, {usePalette: 1, colorFormat: 'hexa'}, emojiFont);
            assert.deepEqual(path._layers.map(p => p.fill), [
                '#c19a65ff', '#00000099', '#61b2e4ff',
            ].concat(Array(5).fill('#fadcbcff')));
            emojiFont.layers.setPaletteIndex(929, 2, 25);
            path = emojiFont.glyphs.get(929).getPath(0, 0, 12, {usePalette: 1, colorFormat: 'hexa'}, emojiFont);
            assert.deepEqual(path._layers[2].fill, '#5c9e31ff');
            emojiFont.palettes.setColor(25, '#ff000099', 1);
            path = emojiFont.glyphs.get(929).getPath(0, 0, 12, {usePalette: 1, colorFormat: 'hexa'}, emojiFont);
            assert.deepEqual(path._layers[2].fill, '#ff000099');
        });
    });

    describe('getPath of a COLR glyph with broken layers, drawn like HarfBuzz', function() {
        // OpenMojiCOLRv0-subset.otf, the glyph 3540 (U+2194) with two layers: the glyph 21090 of the color 8 (#3f3f3f)
        // and the glyph 21091 of the color 3 (#000000) of the palette 0, of 35 colors. Like HarfBuzz, a layer of a glyph
        // id the font has not, or of a color the palette has not, draws nothing, as hb-view 11.3.2 renders them:
        // hb-view --output-format=png --foreground=#0000FF --background=#FFFFFF <font> -u 2194, the colors of its
        // pixels: OpenMojiCOLRv0-subset.otf #3f3f3f and #000000; the first layer of the glyph id 0xFFFF, #000000 only;
        // the second layer of the color index 35, #3f3f3f only; the color index 0xFFFF, #3f3f3f and the foreground
        // #0000ff; the CPAL table without palettes, no pixel but the background
        const getEmojiFontBytes = patchFont => {
            const bytes = new Uint8Array(readFileSync('./test/fonts/OpenMojiCOLRv0-subset.otf'));
            const view = new DataView(bytes.buffer);
            const getTableRange = tag => {
                const recordOffset = getTableRecordOffset(bytes, tag);
                return { offset: view.getUint32(recordOffset + 8), length: view.getUint32(recordOffset + 12) };
            };
            patchFont(bytes, view, getTableRange);
            return bytes;
        };
        // the offset of the first layer record of the glyph 3540 in a COLR table of version 0: the header (version,
        // numBaseGlyphRecords, baseGlyphRecordsOffset, layerRecordsOffset, numLayerRecords), the base glyph records
        // (glyphID, firstLayerIndex, numLayers), the layer records (glyphID, paletteIndex)
        const getBaseGlyphRecordOffset = (view, colrOffset) => {
            const baseGlyphRecordCount = view.getUint16(colrOffset + 2);
            const baseGlyphRecordsOffset = colrOffset + view.getUint32(colrOffset + 4);
            for (let i = 0; i < baseGlyphRecordCount; i += 1) {
                const baseGlyphRecordOffset = baseGlyphRecordsOffset + 6 * i;
                if (view.getUint16(baseGlyphRecordOffset) === 3540) {
                    return baseGlyphRecordOffset;
                }
            }
            throw new Error('No base glyph record of the glyph 3540');
        };
        const getFirstLayerRecordOffset = (view, colrOffset) =>
            colrOffset + view.getUint32(colrOffset + 8) + 4 * view.getUint16(getBaseGlyphRecordOffset(view, colrOffset) + 2);
        const getLayers = (bytes, parseOptions) => {
            const font = parse(bytes.buffer, parseOptions);
            const path = font.glyphs.get(3540).getPath(0, 0, 72, { colorFormat: 'hexa' }, font);
            return path._layers.map(layer => ({ commands: layer.commands, fill: layer.fill }));
        };
        const getLayerGlyphCommands = glyphIndex => emojiFont.glyphs.get(glyphIndex).getPath(0, 0, 72, {}, emojiFont).commands;
        const getMissingLayerGlyphFontBytes = () => getEmojiFontBytes((fontBytes, view, getTableRange) => {
            const layerRecordOffset = getFirstLayerRecordOffset(view, getTableRange('COLR').offset);
            assert.deepStrictEqual([view.getUint16(layerRecordOffset), view.getUint16(layerRecordOffset + 2)], [21090, 8]);
            view.setUint16(layerRecordOffset, 0xFFFF);
        });

        for (const parseOptions of [undefined, { lowMemory: true }]) {
            it('draws nothing for a layer of a glyph id the font has not' + (parseOptions ? ', with lowMemory' : ''), function() {
                assert.deepStrictEqual(getLayers(getMissingLayerGlyphFontBytes(), parseOptions),
                    [{ commands: getLayerGlyphCommands(21091), fill: '#000000ff' }]);
            });
        }

        // the base glyph record of the glyph 3540 with its firstLayerIndex set to the last of the 57 layer records (the
        // glyph 21091 of the color 3), so that its second layer is past them: HarfBuzz takes the layers of a glyph as a
        // sub-array of the layer records, which keeps the ones that exist (COLR::get_glyph_layers), and hb-view renders
        // the glyph 21091 in #000000 only, without the #3f3f3f of the glyph 21090
        const getLayersPastLayerRecordsFontBytes = () => getEmojiFontBytes((fontBytes, view, getTableRange) => {
            const colrOffset = getTableRange('COLR').offset;
            const baseGlyphRecordOffset = getBaseGlyphRecordOffset(view, colrOffset);
            const layerRecordCount = view.getUint16(colrOffset + 12);
            assert.strictEqual(layerRecordCount, 57);
            assert.strictEqual(view.getUint16(baseGlyphRecordOffset + 4), 2);
            const lastLayerRecordOffset = colrOffset + view.getUint32(colrOffset + 8) + 4 * (layerRecordCount - 1);
            assert.deepStrictEqual([view.getUint16(lastLayerRecordOffset), view.getUint16(lastLayerRecordOffset + 2)], [21091, 3]);
            view.setUint16(baseGlyphRecordOffset + 2, layerRecordCount - 1);
        });

        for (const parseOptions of [undefined, { lowMemory: true }]) {
            it('draws only the layers that are layer records of the table' + (parseOptions ? ', with lowMemory' : ''), function() {
                const bytes = getLayersPastLayerRecordsFontBytes();
                assert.deepStrictEqual(getLayers(bytes, parseOptions), [{ commands: getLayerGlyphCommands(21091), fill: '#000000ff' }]);
                const font = parse(bytes.buffer, parseOptions);
                assert.deepStrictEqual(font.warnings, []);
                const contextLogs = [];
                font.glyphs.get(3540).drawPoints(createMockObject(contextLogs), 0, 0, 72, { drawLayers: true }, font);
                const expectedContextLogs = [];
                emojiFont.glyphs.get(21091).drawPoints(createMockObject(expectedContextLogs), 0, 0, 72);
                assert.deepStrictEqual(contextLogs, expectedContextLogs);
                assert.strictEqual(font.getPath('\u2194', 0, 0, 72)._layers.length, 1);
            });
        }

        it('draws the points of the other layers only for a layer of a glyph id the font has not', function() {
            const font = parse(getMissingLayerGlyphFontBytes().buffer);
            const contextLogs = [];
            font.glyphs.get(3540).drawPoints(createMockObject(contextLogs), 0, 0, 72, { drawLayers: true }, font);
            // the layers are drawn without the font (see Glyph.drawPoints)
            const expectedContextLogs = [];
            emojiFont.glyphs.get(21091).drawPoints(createMockObject(expectedContextLogs), 0, 0, 72);
            assert.ok(expectedContextLogs.length > 0);
            assert.deepStrictEqual(contextLogs, expectedContextLogs);
        });

        it('throws for a palette the CPAL table has not, an error of the caller and not of the font', function() {
            // OpenMojiCOLRv0-subset.otf has one palette; hb-view --font-palette=7 renders it with the palette 0, as
            // cairo falls back to the default palette, where opentype.js throws the error of getPaletteColor
            const font = loadSync('./test/fonts/OpenMojiCOLRv0-subset.otf');
            assert.strictEqual(font.tables.cpal.colorRecordIndices.length, 1);
            // a negative or non-integer index is not a palette either
            for (const usePalette of [1, 7, -1, 0.5]) {
                assert.throws(() => font.glyphs.get(3540).getPath(0, 0, 72, { drawLayers: true, usePalette }, font),
                    { message: `Palette index out of range (colorRecordIndices.length: 1, index: ${usePalette})` });
            }
            assert.strictEqual(font.glyphs.get(3540).getPath(0, 0, 72, { drawLayers: true, usePalette: 0 }, font)._layers.length, 2);
        });

        it('draws nothing for a layer of a color the palette has not', function() {
            const bytes = getEmojiFontBytes((fontBytes, view, getTableRange) => {
                const layerRecordOffset = getFirstLayerRecordOffset(view, getTableRange('COLR').offset) + 4;
                assert.deepStrictEqual([view.getUint16(layerRecordOffset), view.getUint16(layerRecordOffset + 2)], [21091, 3]);
                view.setUint16(layerRecordOffset + 2, 35);
            });
            assert.deepStrictEqual(getLayers(bytes), [{ commands: getLayerGlyphCommands(21090), fill: '#3f3f3fff' }]);
        });

        describe('with the color index 0xFFFF in the second layer', function() {
            let foregroundLayerFont;

            before(function() {
                foregroundLayerFont = parse(getEmojiFontBytes((fontBytes, view, getTableRange) => {
                    view.setUint16(getFirstLayerRecordOffset(view, getTableRange('COLR').offset) + 6, 0xFFFF);
                }).buffer);
            });

            itFailsUntilFixed('draws the layer of the color index 0xFFFF in the color of the text',
                'Glyph.prototype.getPath (src/glyph.mjs): the fill of a layer is set on the options of the layers after it, so a layer of the color index 0xFFFF after another one gets its color',
                function() {
                    const path = foregroundLayerFont.glyphs.get(3540).getPath(0, 0, 72, { colorFormat: 'hexa', fill: '#0000ff' }, foregroundLayerFont);
                    assert.deepStrictEqual(path._layers.map(layer => layer.fill), ['#3f3f3fff', '#0000ff']);
                });
        });

        it('draws no layer with a CPAL table without palettes', function() {
            // the CPAL table set to 0 after its version: no palette entries, palettes nor color records
            const bytes = getEmojiFontBytes((fontBytes, view, getTableRange) => {
                const { offset, length } = getTableRange('CPAL');
                fontBytes.fill(0, offset + 2, offset + length);
            });
            const font = parse(bytes.buffer);
            assert.deepStrictEqual(font.warnings, []);
            assert.deepStrictEqual(font.tables.cpal.colorRecordIndices, []);
            assert.deepStrictEqual(getLayers(bytes), []);
            assert.ok(Number.isFinite(font.getAdvanceWidth('\u2194', 72)));
            assert.strictEqual(font.getPath('\u2194', 0, 0, 72).toPathData(), '');
        });
    });

    describe('getPath', function() {
        it('keeps the closePath commands of filled contours', function() {
            const font = loadSync('./test/fonts/Roboto-Black.ttf');
            const glyph = font.charToGlyph('o');
            const countCommands = (commands, type) => commands.filter(command => command.type === type).length;
            const sourceCommands = glyph.path.commands;
            const commands = glyph.getPath(0, 0, 72, {}, font).commands;
            assert.equal(countCommands(sourceCommands, 'Z'), 2);
            assert.equal(countCommands(commands, 'Z'), countCommands(sourceCommands, 'Z'));
            assert.equal(countCommands(font.getPath('oo', 0, 0, 72).commands, 'Z'), 4);
        });
    });
});

describe('glyph.mjs on low memory mode', function() {
    let opt = {lowMemory: true};

    describe('lazy loading', function() {
        let font;
        let glyph;

        beforeEach(function() {
            font = loadSync('./test/fonts/Roboto-Black.ttf', opt);
            glyph = font.charToGlyph('A');
        });

        it('lazily loads xMin', function() {
            assert.equal(glyph.xMin, -3);
        });

        it('lazily loads xMax', function() {
            assert.equal(glyph.xMax, 1399);
        });

        it('lazily loads yMin', function() {
            assert.equal(glyph.yMin, 0);
        });

        it('lazily loads yMax', function() {
            assert.equal(glyph.yMax, 1456);
        });

        it('lazily loads numberOfContours', function() {
            assert.equal(glyph.numberOfContours, 2);
        });

        it('lazily loads COLR layers on paths', function() {
            const layers = emojiFont.glyphs.get(138).getLayers(emojiFont);
            assert.equal(Array.isArray(layers), true);
            assert.equal(layers.length, 4);
        });
    });

    describe('bounding box', function() {
        let trueTypeFont;
        let openTypeFont;

        beforeEach(function() {
            trueTypeFont = loadSync('./test/fonts/Roboto-Black.ttf', opt);
            openTypeFont = loadSync('./test/fonts/FiraSansMedium.woff', opt);
        });

        it('calculates a box for a linear shape', function() {
            const glyph = trueTypeFont.charToGlyph('A');
            const box = glyph.getBoundingBox();
            assert.equal(box.x1, -3);
            assert.equal(box.y1, 0);
            assert.equal(box.x2, 1399);
            assert.equal(box.y2, 1456);
        });

        it('calculates a box for a quadratic shape', function() {
            const glyph = trueTypeFont.charToGlyph('Q');
            const box = glyph.getBoundingBox();
            assert.equal(box.x1, 72);
            assert.equal(box.y1, -266);
            assert.equal(box.x2, 1345);
            assert.equal(box.y2, 1476);
        });

        it('calculates a box for a bezier shape', function() {
            const glyph = openTypeFont.charToGlyph('Q');
            const box = glyph.getBoundingBox();
            assert.equal(box.x1, 62);
            assert.equal(box.y1, -103);
            assert.equal(box.x2, 688);
            assert.equal(box.y2, 701);
        });
    });
});
