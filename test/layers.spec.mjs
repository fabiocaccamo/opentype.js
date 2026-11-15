import assert  from 'assert';
import Font from '../src/font.mjs';
import Glyph from '../src/glyph.mjs';
import Path from '../src/path.mjs';
import { itFailsUntilFixed } from './regression/helpers.mjs';
// import { parse } from '../src/js';
// import { PaletteManager } from '../src/palettes.mjs';
// import { readFileSync } from 'fs';
// const loadSync = (url, opt) => parse(readFileSync(url), opt);

describe('layers.mjs', function() {
    // creating the layers from an existing colr table
    // is already sufficiently tested via palettes.mjs
    
    const trianglePath = new Path();
    trianglePath.moveTo(0, 0);
    trianglePath.lineTo(125, 125);
    trianglePath.lineTo(250, 0);
    trianglePath.close();
    const colorGlyph = new Glyph({index: 0, advanceWidth: 250, yMax: 800, path: trianglePath});
    const squarePath = new Path();
    squarePath.moveTo(25, 50);
    squarePath.lineTo(25, 250);
    squarePath.lineTo(75, 250);
    squarePath.lineTo(125, 250);
    squarePath.lineTo(175, 250);
    squarePath.lineTo(225, 250);
    squarePath.lineTo(225, 50);
    squarePath.lineTo(25, 50);
    squarePath.close();
    const colorGlyphLayer1 = new Glyph({index: 1, path: squarePath, advanceWidth: 250});

    const trianglePath2 = new Path();
    trianglePath2.moveTo(0, 250);
    trianglePath2.lineTo(250, 250);
    trianglePath2.lineTo(125, 125);
    trianglePath2.close();

    const colorGlyphLayer2 = new Glyph({index: 2, path: trianglePath2, advanceWidth: 250});
    const colorGlyphLayer3 = new Glyph({index: 3, path: trianglePath, advanceWidth: 250});

    const colorGlyph2 = new Glyph({index: 4, advanceWidth: 250});

    const font = new Font({
        familyName: 'MyFont',
        styleName: 'Medium',
        unitsPerEm: 1000,
        ascender: 800,
        descender: -200,
        glyphs: [colorGlyph, colorGlyphLayer1, colorGlyphLayer2, colorGlyphLayer3, colorGlyph2]
    });
    font.palettes.add(['#ffaa00','#99cc00','#12345678']);

    
    it('adds layers to a glyph', function() {
        font.layers.add(4, {glyph: colorGlyphLayer1, paletteIndex: 0});
        font.layers.add(4, {glyph: colorGlyphLayer3, paletteIndex: 1}, 0);

        assert.deepEqual(font.tables.colr.baseGlyphRecords, [
            { glyphID: 4, firstLayerIndex: 0, numLayers: 2 },
        ]);

        assert.deepEqual(font.tables.colr.layerRecords, [
            { glyphID: 3, paletteIndex: 1 },
            { glyphID: 1, paletteIndex: 0 },
        ]);
        
        font.layers.add(0, [{glyph: colorGlyphLayer1, paletteIndex: 1},{glyph: colorGlyphLayer2, paletteIndex: 0}]);
        
        assert.deepEqual(font.tables.colr.baseGlyphRecords, [
            { glyphID: 0, firstLayerIndex: 2, numLayers: 2},
            { glyphID: 4, firstLayerIndex: 0, numLayers: 2 },
        ]);
        
        assert.deepEqual(font.tables.colr.layerRecords, [
            { glyphID: 3, paletteIndex: 1 },
            { glyphID: 1, paletteIndex: 0 },
            { glyphID: 1, paletteIndex: 1 },
            { glyphID: 2, paletteIndex: 0 }
        ]);
        
        font.layers.add(0, [{glyph: colorGlyphLayer3, paletteIndex: 2}]);

        assert.deepEqual(font.tables.colr.baseGlyphRecords, [
            { glyphID: 0, firstLayerIndex: 2, numLayers: 3 },
            { glyphID: 4, firstLayerIndex: 0, numLayers: 2 },
        ]);

        assert.deepEqual(font.tables.colr.layerRecords, [
            { "glyphID": 3, "paletteIndex": 1 },
            { "glyphID": 1, "paletteIndex": 0 },
            { "glyphID": 1, "paletteIndex": 1 },
            { "glyphID": 2, "paletteIndex": 0 },
            { "glyphID": 3, "paletteIndex": 2 },
        ]);

        font.layers.add(4, [{glyph: colorGlyphLayer3, paletteIndex: 2}], 1);
        
        assert.deepEqual(font.tables.colr.baseGlyphRecords, [
            { glyphID: 0, firstLayerIndex: 3, numLayers: 3 },
            { glyphID: 4, firstLayerIndex: 0, numLayers: 3 },
        ]);

        assert.deepEqual(font.tables.colr.layerRecords, [
            { "glyphID": 3, "paletteIndex": 1 },
            { "glyphID": 3, "paletteIndex": 2 },
            { "glyphID": 1, "paletteIndex": 0 },
            { "glyphID": 1, "paletteIndex": 1 },
            { "glyphID": 2, "paletteIndex": 0 },
            { "glyphID": 3, "paletteIndex": 2 },
        ]);

    });

    it('removes layers from a glyph', function() {
        font.layers.remove(4, 1, 2);
        
        assert.deepEqual(font.tables.colr.baseGlyphRecords, [
            { glyphID: 0, firstLayerIndex: 1, numLayers: 3 },
            { glyphID: 4, firstLayerIndex: 0, numLayers: 1 },
        ]);

        assert.deepEqual(font.tables.colr.layerRecords, [
            { "glyphID": 3, "paletteIndex": 1 },
            { "glyphID": 1, "paletteIndex": 1 },
            { "glyphID": 2, "paletteIndex": 0 },
            { "glyphID": 3, "paletteIndex": 2 },
        ]);

    });

    it('sets a layer\'s paletteIndex', function() {
        assert.deepEqual(font.layers.get(4)[0].paletteIndex, 1);
        font.layers.setPaletteIndex(4, 0, 2);
        assert.deepEqual(font.layers.get(4)[0].paletteIndex, 2);
        font.layers.setPaletteIndex(0, 1, 1);
        assert.deepEqual(font.tables.colr.layerRecords, [
            { "glyphID": 3, "paletteIndex": 2 },
            { "glyphID": 1, "paletteIndex": 1 },
            { "glyphID": 2, "paletteIndex": 1 },
            { "glyphID": 3, "paletteIndex": 2 },
        ]);

    });

    it('gets only the layers of a glyph that are layer records of the COLR table, like HarfBuzz', function() {
        // a base glyph record whose firstLayerIndex + numLayers is past the 2 layer records: HarfBuzz takes the layers
        // of a glyph as a sub-array of the layer records, which keeps the ones that exist (COLR::get_glyph_layers)
        const layersFont = new Font({
            familyName: 'MyFont',
            styleName: 'Medium',
            unitsPerEm: 1000,
            ascender: 800,
            descender: -200,
            glyphs: [colorGlyph, colorGlyphLayer1, colorGlyphLayer2]
        });
        layersFont.palettes.add(['#ffaa00', '#99cc00']);
        layersFont.tables.colr = {
            version: 0,
            baseGlyphRecords: [{ glyphID: 0, firstLayerIndex: 1, numLayers: 3 }],
            layerRecords: [{ glyphID: 1, paletteIndex: 0 }, { glyphID: 2, paletteIndex: 1 }],
        };
        assert.deepStrictEqual(layersFont.layers.get(0), [{ glyph: colorGlyphLayer2, paletteIndex: 1 }]);
        layersFont.tables.colr.baseGlyphRecords[0].firstLayerIndex = 2;
        assert.deepStrictEqual(layersFont.layers.get(0), []);
    });

    describe('a glyph with a layer of a glyph id the font has not', function() {
        // the glyph 0 has 2 layers, the first one of the glyph id 0xFFFF (get gives it the glyph undefined), and the
        // glyph 4 one layer after them
        let layersFont;

        beforeEach(function() {
            layersFont = new Font({
                familyName: 'MyFont',
                styleName: 'Medium',
                unitsPerEm: 1000,
                ascender: 800,
                descender: -200,
                glyphs: [colorGlyph, colorGlyphLayer1, colorGlyphLayer2, colorGlyphLayer3, colorGlyph2]
            });
            layersFont.palettes.add(['#ffaa00', '#99cc00']);
            layersFont.tables.colr = {
                version: 0,
                baseGlyphRecords: [{ glyphID: 0, firstLayerIndex: 0, numLayers: 2 }, { glyphID: 4, firstLayerIndex: 2, numLayers: 1 }],
                layerRecords: [{ glyphID: 0xFFFF, paletteIndex: 0 }, { glyphID: 2, paletteIndex: 1 }, { glyphID: 3, paletteIndex: 0 }],
            };
        });

        it('gets the layer with the glyph undefined', function() {
            assert.deepStrictEqual(layersFont.layers.get(0), [
                { glyph: undefined, paletteIndex: 0 },
                { glyph: colorGlyphLayer2, paletteIndex: 1 }
            ]);
        });

        itFailsUntilFixed('removes a layer of the glyph, keeping the glyph id of the other one',
            'remove (src/layers.mjs): reads layer.glyph.index of a layer whose glyph is undefined and throws a TypeError',
            function() {
                layersFont.layers.remove(0, 1);
                assert.deepStrictEqual(layersFont.tables.colr.layerRecords, [{ glyphID: 0xFFFF, paletteIndex: 0 }, { glyphID: 3, paletteIndex: 0 }]);
            }, TypeError);

        itFailsUntilFixed('sets the palette index of a layer of the glyph, keeping the glyph id of the other one',
            'setPaletteIndex (src/layers.mjs): reads layer.glyph.index of a layer whose glyph is undefined and throws a TypeError',
            function() {
                layersFont.layers.setPaletteIndex(0, 1, 0);
                assert.deepStrictEqual(layersFont.tables.colr.layerRecords.slice(0, 2), [{ glyphID: 0xFFFF, paletteIndex: 0 }, { glyphID: 2, paletteIndex: 0 }]);
            }, TypeError);

        itFailsUntilFixed('adds a layer to the glyph, keeping the glyph id of the other ones',
            'add (src/layers.mjs): reads currentLayers[i].glyph.index of a layer whose glyph is undefined and throws a TypeError',
            function() {
                layersFont.layers.add(0, { glyph: 1, paletteIndex: 1 });
                assert.deepStrictEqual(layersFont.tables.colr.layerRecords.slice(0, 3), [
                    { glyphID: 0xFFFF, paletteIndex: 0 }, { glyphID: 2, paletteIndex: 1 }, { glyphID: 1, paletteIndex: 1 }
                ]);
            }, TypeError);
    });

    it('removes a layer of a glyph whose layers run past the layer records, the other base glyphs kept', function() {
        // the glyph 4, the last one of the layer records, with 3 layers of which only 2 are layer records (see get)
        const layersFont = new Font({
            familyName: 'MyFont',
            styleName: 'Medium',
            unitsPerEm: 1000,
            ascender: 800,
            descender: -200,
            glyphs: [colorGlyph, colorGlyphLayer1, colorGlyphLayer2, colorGlyphLayer3, colorGlyph2]
        });
        layersFont.palettes.add(['#ffaa00', '#99cc00']);
        layersFont.tables.colr = {
            version: 0,
            baseGlyphRecords: [{ glyphID: 0, firstLayerIndex: 0, numLayers: 1 }, { glyphID: 4, firstLayerIndex: 1, numLayers: 3 }],
            layerRecords: [{ glyphID: 1, paletteIndex: 0 }, { glyphID: 2, paletteIndex: 1 }, { glyphID: 3, paletteIndex: 0 }],
        };
        layersFont.layers.remove(4, 0);
        assert.deepStrictEqual(layersFont.tables.colr.baseGlyphRecords, [
            { glyphID: 0, firstLayerIndex: 0, numLayers: 1 },
            { glyphID: 4, firstLayerIndex: 1, numLayers: 1 }
        ]);
        assert.deepStrictEqual(layersFont.tables.colr.layerRecords, [{ glyphID: 1, paletteIndex: 0 }, { glyphID: 3, paletteIndex: 0 }]);
        assert.deepStrictEqual(layersFont.layers.get(4), [{ glyph: colorGlyphLayer3, paletteIndex: 0 }]);
        assert.deepStrictEqual(layersFont.layers.get(0), [{ glyph: colorGlyphLayer1, paletteIndex: 0 }]);
    });

});