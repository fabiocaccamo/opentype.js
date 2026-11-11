import assert from 'assert';
import { parse } from '../../src/opentype.mjs';
import Glyph from '../../src/glyph.mjs';
import glyphset from '../../src/glyphset.mjs';
import hmtx, { getHmtxAdvanceWidth } from '../../src/tables/hmtx.mjs';
import { readFileSync } from 'fs';
const loadSync = (url, opt) => parse(readFileSync(url), opt);

describe('tables/hmtx.mjs', function() {
    // TestGVAROne has 2 longHorMetrics for 14 glyphs: the other glyphs reuse the last
    // advance width and read their left side bearing from the leftSideBearings array
    [false, true].forEach(lowMemory => {
        it(`reads the left side bearings after the last longHorMetric (lowMemory: ${lowMemory})`, function() {
            const font = loadSync('./test/fonts/TestGVAROne.ttf', { lowMemory });
            assert.equal(font.tables.hhea.numberOfHMetrics, 2);
            const metrics = [0, 1, 2, 3].map(index => {
                const glyph = font.glyphs.get(index);
                return [glyph.advanceWidth, glyph.leftSideBearing];
            });
            // expected values from fontTools
            assert.deepEqual(metrics, [[527, 98], [1000, 0], [1000, 63], [1000, 35]]);
        });
    });

    it('writes the integer part of a fractional advance width, and 0 for a glyph without advance width', function() {
        // the advanceWidth of a longHorMetric record is a uint16 (OpenType specification, hmtx)
        const glyphs = new glyphset.GlyphSet({ unitsPerEm: 1000 }, [
            new Glyph({ name: '.notdef', advanceWidth: 250.5 }),
            new Glyph({ name: 'a', advanceWidth: 500.75 }),
            new Glyph({ name: 'b' })
        ]);
        const advanceWidths = hmtx.make(glyphs).fields
            .filter(field => field.name.startsWith('advanceWidth_'))
            .map(field => field.value);
        assert.deepEqual(advanceWidths, [250, 500, 0]);
        assert.deepEqual([0, 1, 2].map(index => getHmtxAdvanceWidth(glyphs.get(index))), [250, 500, 0]);
    });
});
