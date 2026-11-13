import assert from 'assert';
import { readFileSync } from 'fs';
import { parse } from '../src/opentype.mjs';
import { arraysEqual, getGlyphVariationPointCount, getTuplePointNumbers, warnOncePerFont } from '../src/util.mjs';

describe('util.mjs', function() {
    describe('arraysEqual', function() {
        it('should return true for equal arrays', function() {
            assert.equal(arraysEqual([], []), true);
            assert.equal(arraysEqual([23], [23]), true);
        });

        it('should return false for unequal objects', function() {
            assert.equal(arraysEqual([], [23]), false);
            assert.equal(arraysEqual([23], [42]), false);
            assert.equal(arraysEqual([23], ["23"]), false);
            assert.equal(arraysEqual([23,42], [23]), false);
        });
    });

    describe('getGlyphVariationPointCount', function() {
        // TestVariationPrecision.ttf: space (no outline), H (4 points), Hdot (a composite of H and period)
        it('counts the points of a simple glyph and the components of a composite glyph not parsed yet', function() {
            const font = parse(readFileSync('./test/fonts/TestVariationPrecision.ttf'));
            assert.deepStrictEqual([2, 3, 5].map(glyphIndex => getGlyphVariationPointCount(font.glyphs.get(glyphIndex))), [0, 4, 2]);
        });
    });

    describe('getTuplePointNumbers', function() {
        // OpenType, Tuple variation store: the PRIVATE_POINT_NUMBERS flag gives a tuple its own point
        // numbers, a packed count of 0 means all the points; without the flag the shared ones apply
        it('gives the private point numbers of a tuple that has them, even an empty list, else the shared ones', function() {
            const sharedPoints = [0, 5];
            assert.deepStrictEqual(getTuplePointNumbers({ privatePoints: [1, 2] }, sharedPoints), [1, 2]);
            assert.deepStrictEqual(getTuplePointNumbers({ privatePoints: [] }, sharedPoints), []);
            assert.deepStrictEqual(getTuplePointNumbers({}, sharedPoints), [0, 5]);
        });
    });

    describe('warnOncePerFont', function() {
        it('warns once per font, kind and value, and builds each message at its first warning only', function() {
            const [firstFont, secondFont] = [{}, {}];
            const warnings = [];
            const builtMessages = [];
            const getMessage = message => () => {
                builtMessages.push(message);
                return message;
            };
            const consoleWarn = console.warn;
            console.warn = message => warnings.push(message);
            try {
                warnOncePerFont(firstFont, 'GPOS lookupType', 4, getMessage('first font, GPOS 4'));
                warnOncePerFont(firstFont, 'GPOS lookupType', 4, getMessage('first font, GPOS 4 again'));
                warnOncePerFont(firstFont, 'GPOS lookupType', 5, getMessage('first font, GPOS 5'));
                warnOncePerFont(firstFont, 'GSUB substitutionType', 4, getMessage('first font, GSUB 4'));
                warnOncePerFont(secondFont, 'GPOS lookupType', 4, getMessage('second font, GPOS 4'));
                warnOncePerFont(secondFont, 'GPOS lookupType', 4, getMessage('second font, GPOS 4 again'));
            } finally {
                console.warn = consoleWarn;
            }
            const expectedWarnings = ['first font, GPOS 4', 'first font, GPOS 5', 'first font, GSUB 4', 'second font, GPOS 4'];
            assert.deepStrictEqual([warnings, builtMessages], [expectedWarnings, expectedWarnings]);
        });
    });
});
