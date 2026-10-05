import assert from 'assert';
import { parse } from '../../src/opentype.mjs';
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
});
