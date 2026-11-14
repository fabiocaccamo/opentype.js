import assert from 'assert';
import { readFileSync } from 'fs';
import { parse } from '../src/opentype.mjs';
import glyphset from '../src/glyphset.mjs';

describe('glyphset.mjs', function() {
    describe('cffGlyphLoader', function() {
        it('reads the charstring of a glyph when its outline is first drawn, once', function() {
            // the charstrings of a CJK font are most of its parse time when they are read at parse
            const font = parse(readFileSync('./test/fonts/SourceSansPro-Regular.otf'));
            const charstrings = [];
            const parseCharstring = (parsedFont, glyph, charstring, version, variationCoords) => {
                charstrings.push([charstring, version, variationCoords]);
                return font.glyphs.get(1).path;
            };
            const readGlyphIndexes = [];
            const readCharstring = glyphIndex => {
                readGlyphIndexes.push(glyphIndex);
                return [139, 14];
            };
            const glyph = glyphset.cffGlyphLoader(font, 1, parseCharstring, readCharstring, 1)();
            assert.deepStrictEqual(readGlyphIndexes, []);
            assert.strictEqual(glyph.path.unitsPerEm, font.unitsPerEm);
            glyph.getBlendPath({ wght: 700 });
            assert.deepStrictEqual(readGlyphIndexes, [1]);
            assert.deepStrictEqual(charstrings, [[[139, 14], 1, undefined], [[139, 14], 1, { wght: 700 }]]);
        });

        it('gives the outlines of the charstrings of the glyphs, with or without lowMemory, like fontTools', function() {
            // python -c "from fontTools.ttLib import TTFont; from fontTools.pens.recordingPen import RecordingPen; font =
            // TTFont('SourceSansPro-Regular.otf'); order = font.getGlyphOrder(); glyphSet = font.getGlyphSet(); pens =
            // {index: RecordingPen() for index in (10, 507, 543, 1111)}; [glyphSet[order[index]].draw(pens[index]) for index
            // in pens]; print({index: pens[index].value for index in pens})"
            // I, period, slash and uni03040301.cap, the last glyph with an outline, as M, L, C and Z for moveTo, lineTo,
            // curveTo and closePath
            const expectedOutlines = {
                10: [['M', 90, 0], ['L', 173, 0], ['L', 173, 656], ['L', 90, 656], ['Z']],
                507: [
                    ['M', 65, 50], ['C', 65, 14, 92, -12, 125, -12], ['C', 157, -12, 184, 14, 184, 50],
                    ['C', 184, 88, 157, 114, 125, 114], ['C', 92, 114, 65, 88, 65, 50], ['Z']
                ],
                543: [['M', 10, -160], ['L', 70, -160], ['L', 337, 710], ['L', 277, 710], ['Z']],
                1111: [
                    ['M', -51, 839], ['L', 17, 839], ['L', 129, 950], ['L', 38, 950], ['Z'],
                    ['M', -124, 729], ['L', 124, 729], ['L', 124, 786], ['L', -124, 786], ['Z']
                ]
            };
            const getOutline = glyph => glyph.path.commands.map(command => {
                switch (command.type) {
                    case 'C':
                        return ['C', command.x1, command.y1, command.x2, command.y2, command.x, command.y];
                    case 'Z':
                        return ['Z'];
                    default:
                        return [command.type, command.x, command.y];
                }
            });
            const buffer = readFileSync('./test/fonts/SourceSansPro-Regular.otf');
            for (const options of [{}, { lowMemory: true }]) {
                const font = parse(buffer, options);
                for (const [glyphIndex, expectedOutline] of Object.entries(expectedOutlines)) {
                    assert.deepStrictEqual(getOutline(font.glyphs.get(Number(glyphIndex))), expectedOutline, `${glyphIndex} ${JSON.stringify(options)}`);
                }
            }
        });
    });
});
