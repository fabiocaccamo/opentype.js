import assert from 'assert';
import { readdirSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { Path } from '../../src/opentype.mjs';
import {
    loadFont,
    shapeText,
    assertShape,
    getPathOutline,
    getOutline,
    assertOutlineClose,
    assertKnownFailure
} from './helpers.mjs';

const fontsFolder = fileURLToPath(new URL('../fonts/', import.meta.url));

// the name records that are not font names: the notices of the font keep the Reserved Font Name
const NOTICE_NAME_KEYS = [
    'copyright', 'trademark', 'manufacturer', 'designer', 'description',
    'manufacturerURL', 'designerURL', 'license', 'licenseURL', 'version'
];

/**
 * The Reserved Font Names declared by the notices of a font (name IDs 0 and 13), e.g.
 * "with Reserved Font Name 'Source'." or "with Reserved Font Names "Lobster" and "Lobster Two"".
 * @param {string[]} notices
 * @returns {string[]}
 */
function getReservedFontNames(notices) {
    const reservedFontNames = [];
    for (const notice of notices) {
        for (const match of notice.matchAll(/Reserved Font Names? ([^.]+)/g)) {
            for (const part of match[1].split(/,| and /)) {
                const reservedFontName = part.replace(/['"‘’“”]/g, '').trim();
                if (reservedFontName) {
                    reservedFontNames.push(reservedFontName);
                }
            }
        }
    }
    return reservedFontNames;
}

/**
 * The font names of a font: every name record of every platform but the notices.
 * @param {opentype.Font} font
 * @returns {string[]}
 */
function getFontNames(font) {
    const fontNames = [];
    for (const platformNames of Object.values(font.names)) {
        for (const [key, translations] of Object.entries(platformNames)) {
            if (!NOTICE_NAME_KEYS.includes(key)) {
                fontNames.push(...Object.values(translations));
            }
        }
    }
    return fontNames;
}

/**
 * The helpers decide the result of every known failure and of every outline comparison
 * of this folder: a bug in them would silently void those tests.
 */
describe('regression: helpers', function() {
    describe('assertKnownFailure', function() {
        it('passes while the body fails an assertion', function() {
            assertKnownFailure(() => assert.strictEqual(1, 2));
        });

        it('fails when the body passes', function() {
            assert.throws(() => assertKnownFailure(() => {}), /this known failure passes now/);
        });

        it('throws the error of the body when it is not an assertion failure', function() {
            assert.throws(() => assertKnownFailure(() => {
                throw new TypeError('not a function');
            }), TypeError);
        });

        it('passes while the body throws the expected error, a class or a message pattern', function() {
            const throwTypeError = () => {
                throw new TypeError('lookup type 6 is not supported');
            };
            assertKnownFailure(throwTypeError, TypeError);
            assertKnownFailure(throwTypeError, /lookup type 6/);
            assert.throws(() => assertKnownFailure(throwTypeError, /lookup type 7/), TypeError);
            assert.throws(() => assertKnownFailure(() => assert.strictEqual(1, 2), TypeError), assert.AssertionError);
        });

        it('rejects an asynchronous body, whatever the expected error', function() {
            assert.throws(() => assertKnownFailure(() => Promise.resolve()), /must be synchronous/);
            assert.throws(() => assertKnownFailure(async () => {}, TypeError), /must be synchronous/);
            assert.throws(() => assertKnownFailure(async () => {}, /synchronous/), /must be synchronous/);
        });
    });

    describe('shapeText and assertShape', function() {
        let font;

        beforeEach(function() {
            font = loadFont('EBGaramond-VF-kern-subset.ttf');
        });

        it('shapes a text like a line of hb-shape, with and without kerning', function() {
            // hb-shape --no-glyph-names --cluster-level=1 EBGaramond-VF-kern-subset.ttf -u 0041,0056
            // [1=0+552|5=1+672]
            assertShape(shapeText(font, 'AV'), { glyphs: [1, 5], clusters: [0, 1], ends: [1, 2], advances: [552, 672] });
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern EBGaramond-VF-kern-subset.ttf -u 0041,0056
            // [1=0+692|5=1+672]
            assertShape(shapeText(font, 'AV', { kerning: false }), { glyphs: [1, 5], clusters: [0, 1], ends: [1, 2], advances: [692, 672] });
        });

        it('shapes an empty text to no glyph', function() {
            assertShape(shapeText(font, ''), { glyphs: [], clusters: [], ends: [], advances: [] });
        });

        it('throws on an advance that is not a finite number, instead of reading it as 0', function() {
            const markFont = loadFont('TestCFF1-EmptyPrivateDict.otf');
            // hb-shape --no-glyph-names --cluster-level=1 TestCFF1-EmptyPrivateDict.otf -u 0041,0301
            // [2=0+749|6=1@-225,162+0]
            assertShape(shapeText(markFont, 'Á'), { glyphs: [2, 6], clusters: [0, 1], advances: [749, 0] });
            for (const brokenAdvance of [undefined, NaN]) {
                markFont.glyphs.get(6).advanceWidth = brokenAdvance;
                assert.throws(() => shapeText(markFont, 'Á'), new RegExp(`glyph 6 has the advance ${brokenAdvance}`));
            }
        });

        it('rejects another glyph, cluster, advance or end, and compares the ends only when expected has them', function() {
            const shape = { glyphs: [1, 5], clusters: [0, 1], ends: [1, 2], advances: [552, 672] };
            assertShape(shape, { glyphs: [1, 5], clusters: [0, 1], advances: [552, 672] });
            assert.throws(() => assertShape(shape, { glyphs: [1, 6], clusters: [0, 1], advances: [552, 672] }), /glyphs/);
            assert.throws(() => assertShape(shape, { glyphs: [1, 5], clusters: [0, 0], advances: [552, 672] }), /clusters/);
            assert.throws(() => assertShape(shape, { glyphs: [1, 5], clusters: [0, 1], advances: [552, 671] }), /advances/);
            assert.throws(() => assertShape(shape, { glyphs: [1, 5], clusters: [0, 1], ends: [2, 2], advances: [552, 672] }), /ends/);
        });
    });

    describe('getPathOutline and getOutline', function() {
        it('turns a path with the y axis going down into font units with the y axis going up, without negative zero', function() {
            const path = new Path();
            path.moveTo(10, -20);
            path.lineTo(30, 0);
            path.closePath();
            const outline = getPathOutline(path);
            assert.deepStrictEqual(outline, [['M', 10, 20], ['L', 30, 0], ['Z']]);
            assert.ok(Object.is(outline[1][2], 0));
        });

        it('gives the outline of a glyph like a pen of fontTools, from the last point of the contour', function() {
            // fontTools: TTFont('ReadexPro-VF-gvar-shared-points-subset.ttf').getGlyphSet()['l'].draw(RecordingPen())
            // moveTo (74, 0), lineTo (74, 740), lineTo (177, 740), lineTo (177, 0), closePath
            assertOutlineClose(
                getOutline(loadFont('ReadexPro-VF-gvar-shared-points-subset.ttf'), 6),
                [['M', 177, 0], ['L', 74, 0], ['L', 74, 740], ['L', 177, 740], ['L', 177, 0], ['Z']]
            );
        });
    });

    describe('assertOutlineClose', function() {
        const outline = [['M', 10, 20], ['Q', 30, 40, 50, 60], ['Z']];

        it('accepts values within the tolerance', function() {
            assertOutlineClose([['M', 10, 21], ['Q', 30, 40, 49, 60], ['Z']], outline, 1);
        });

        it('rejects a value beyond the tolerance, exact by default', function() {
            assert.throws(() => assertOutlineClose([['M', 10, 22], ['Q', 30, 40, 50, 60], ['Z']], outline, 1), /value 2: 22 instead of 20/);
            assert.throws(() => assertOutlineClose([['M', 10, 21], ['Q', 30, 40, 50, 60], ['Z']], outline), /value 2: 21 instead of 20/);
        });

        it('rejects another command type, a missing command and a command with other values', function() {
            assert.throws(() => assertOutlineClose([['M', 10, 20], ['L', 50, 60], ['Z']], outline), /command types/);
            assert.throws(() => assertOutlineClose([['M', 10, 20], ['Z']], outline), /command types/);
            assert.throws(() => assertOutlineClose([['M', 10, 20], ['Q', 30, 40, 50, 60, 70], ['Z']], outline), /number of values/);
        });

        it('rejects a value that is not a finite number', function() {
            assert.throws(() => assertOutlineClose([['M', 10, NaN], ['Q', 30, 40, 50, 60], ['Z']], outline, 1), /value 2: NaN/);
            assert.throws(() => assertOutlineClose([['M', 10, '20'], ['Q', 30, 40, 50, 60], ['Z']], outline), /value 2: 20 instead of 20/);
        });
    });

    describe('loadFont', function() {
        it('rejects the coordinates of an axis the font does not have', function() {
            assert.throws(() => loadFont('EBGaramond-VF-kern-subset.ttf', { wdth: 75 }), /has no wdth axis/);
            assert.throws(() => loadFont('TestCFF1-EmptyPrivateDict.otf', { wght: 700 }), /has no wght axis/);
        });
    });

    describe('fixtures', function() {
        const fixtureFileNames = readdirSync(`${fontsFolder}regression`).filter(fileName => /\.(ttf|otf)$/.test(fileName)).sort();

        it('have one entry in test/fonts/LICENSE and one section in their README each', function() {
            const licenseEntries = readFileSync(`${fontsFolder}LICENSE`, 'utf8').match(/^regression\/\S+$/gm).map(line => line.slice('regression/'.length));
            const readmeSections = readFileSync(`${fontsFolder}regression/README.md`, 'utf8').match(/^## \S+$/gm).map(line => line.slice('## '.length));
            assert.deepStrictEqual(licenseEntries.slice().sort(), fixtureFileNames);
            assert.deepStrictEqual(readmeSections.slice().sort(), fixtureFileNames);
        });

        it('keep no Reserved Font Name of their notices in their font names', function() {
            for (const fileName of fixtureFileNames) {
                const font = loadFont(fileName);
                const notices = Object.values(font.names).flatMap(platformNames => {
                    return ['copyright', 'license'].flatMap(key => Object.values(platformNames[key] || {}));
                });
                const reservedFontNames = getReservedFontNames(notices).flatMap(name => [name, name.replace(/ /g, '')]);
                for (const fontName of getFontNames(font)) {
                    for (const reservedFontName of reservedFontNames) {
                        assert.ok(!fontName.includes(reservedFontName), `${fileName}: the font name "${fontName}" has the Reserved Font Name "${reservedFontName}"`);
                    }
                }
            }
        });
    });
});
