/**
 * Regression tests of the advance widths of CFF fonts once the outlines are read.
 *
 * Upstream: issues #417, #440 and #397, one bug, fixed by PR #445 (release 1.3.4). Reading the
 * outline of a glyph (getBoundingBox, getPath, path) parses its charstring, and
 * parseCFFCharstring (src/tables/cff.mjs) assigns the width of the charstring to
 * glyph.advanceWidth, over the advance of the hmtx table. With an empty Private DICT (size 0,
 * no nominalWidthX and no defaultWidthX: the font of #417, and every font that opentype.js
 * wrote, the scenario of #440 and #397) that width was NaN.
 *
 * With the 1.3.3 build the advances are NaN once an outline is read, on the empty Private DICT
 * fixture and on the subsets of #397. The two WOFF fonts of the #440 test cannot be written by
 * 1.3.3 (its GSUB writer has no coverage format 2); without their GSUB table their advances
 * are NaN too. The 1.3.4 build gives the hmtx advances in the three cases. A CID-keyed font
 * was never the trigger (its advances are right with 1.3.3).
 *
 * The assignment is still there in upstream master, with three bugs that this fork fixes (the
 * tests that cover them fail on upstream master; the tests that do not shape a text pass there,
 * shapeText needs stringToGlyphClusters, an API of this fork):
 * - CFF: an hmtx advance that differs from the width of the charstring is replaced by that
 *   width, also in the hmtx table written by toArrayBuffer
 * - CFF2: a charstring never has a width, but a glyph with hint operators gets an advance of 0
 * - written fonts: a charstring width above 32767 is written with the number encoding of a
 *   DICT, the charstring is invalid and another width is read back
 * The fork never assigns the width of a charstring: the advances are the ones of hmtx and HVAR.
 *
 * Fixtures (test/fonts/regression/README.md says how they were built):
 * - TestCFF1-EmptyPrivateDict.otf: synthetic CFF, Top DICT Private of size 0, each glyph gives
 *   its width with a different charstring operator (rmoveto, endchar, hmoveto, vmoveto, hstem,
 *   hstemhm and hintmask, width omitted)
 * - TestCFF1-WidthMismatch.otf: the same font with an hmtx advance of A and V that differs from
 *   the width of their charstrings
 * - TestCFF1-CIDKeyed-subset.otf: a CID-keyed subset of Source Han Sans KR, 10 Font DICTs with
 *   their own nominalWidthX and defaultWidthX (FDSelect), GPOS pair kerning
 * - TestCFF2-HintedVariable-subset.otf: a subset of Source Serif 4 Variable, CFF2 with hint
 *   operators, HVAR, avar, GPOS pair kerning with variations
 * - ../Vibur.woff (TrueType outlines) and ../FiraSansMedium.woff (CFF outlines): written by
 *   font.toArrayBuffer() as CFF, with an empty Private DICT unless an advance does not fit a
 *   charstring width (Vibur, rs 64001: nominalWidthX 31234)
 *
 * The reference advances are the ones of the hmtx table (fontTools) and of hb-shape, which
 * takes the advances from hmtx and HVAR, never from the width of a charstring (and gives 0 to
 * a mark whatever its hmtx advance). "The hmtx advances" of a fixture, in glyph order, are
 * printed by this command with the name of the fixture, here the one with the mismatch:
 *   python -c "from fontTools.ttLib import TTFont; font = TTFont('TestCFF1-WidthMismatch.otf'); print([font['hmtx'][name][0] for name in font.getGlyphOrder()])"
 *   [500, 250, 600, 720, 300, 813, 0]
 * and "the widths of the charstrings" of a CFF fixture by this one:
 *   python -c "from fontTools.ttLib import TTFont; from fontTools.pens.basePen import NullPen; font = TTFont('TestCFF1-WidthMismatch.otf'); charStrings = font['CFF '].cff.topDictIndex[0].CharStrings; [charStrings[name].draw(NullPen()) for name in font.getGlyphOrder()]; print([charStrings[name].width for name in font.getGlyphOrder()])"
 *   [500, 250, 749, 680, 300, 813, 0]
 */

import assert from 'assert';
import { Font, parse } from '../../src/opentype.mjs';
import { loadFont, shapeText, assertShape } from './helpers.mjs';

const emptyPrivateDictFixture = 'TestCFF1-EmptyPrivateDict.otf';
const widthMismatchFixture = 'TestCFF1-WidthMismatch.otf';
const cidKeyedFixture = 'TestCFF1-CIDKeyed-subset.otf';
const hintedVariableFixture = 'TestCFF2-HintedVariable-subset.otf';
const viburFixture = '../Vibur.woff';
const firaSansFixture = '../FiraSansMedium.woff';

const loadModes = [
    { name: 'normal mode', options: undefined },
    { name: 'lowMemory mode', options: { lowMemory: true } }
];

// the ways of reading the outline of a glyph, each of them parses its charstring
const outlineReaders = {
    getBoundingBox: glyph => glyph.getBoundingBox(),
    getPath: (glyph, font) => glyph.getPath(0, 0, 72, undefined, font),
    path: glyph => glyph.path
};

function getAllGlyphs(font) {
    const glyphs = [];
    for (let i = 0; i < font.numGlyphs; i++) {
        glyphs.push(font.glyphs.get(i));
    }
    return glyphs;
}

// the bounds of the outline of a glyph like the BoundsPen of fontTools gives them: null for a
// glyph without outline (getBoundingBox gives it a box of zeros)
function getOutlineBounds(glyph) {
    if (glyph.path.commands.length === 0) {
        return null;
    }
    const boundingBox = glyph.getBoundingBox();
    return [boundingBox.x1, boundingBox.y1, boundingBox.x2, boundingBox.y2];
}

// the messages that console.log prints while a function runs, instead of printing them
function getConsoleLogMessages(callback) {
    const messages = [];
    const consoleLog = console.log;
    console.log = (...values) => {
        messages.push(values.join(' '));
    };
    try {
        callback();
    } finally {
        console.log = consoleLog;
    }
    return messages;
}

// glyph.advanceWidth of the glyphs, before and after their outlines are read
function getAdvanceWidthsAroundOutlines(font, glyphs, readOutline) {
    const before = glyphs.map(glyph => glyph.advanceWidth);
    for (const glyph of glyphs) {
        readOutline(glyph, font);
    }
    const after = glyphs.map(glyph => glyph.advanceWidth);
    return { before, after };
}

// a new font for each load mode
function loadFontPerLoadMode(fixture, variation) {
    return loadModes.map(loadMode => ({
        name: loadMode.name,
        font: loadFont(fixture, variation, loadMode.options)
    }));
}

// a new font for each way of reading an outline in each load mode: only the first reading
// of an outline parses the charstring
function loadFontPerOutlineReader(fixture) {
    const loadedFonts = [];
    for (const loadMode of loadModes) {
        for (const [readerName, readOutline] of Object.entries(outlineReaders)) {
            loadedFonts.push({
                name: `${readerName}, ${loadMode.name}`,
                font: loadFont(fixture, undefined, loadMode.options),
                readOutline
            });
        }
    }
    return loadedFonts;
}

function assertKeepsAdvanceWidths(loadedFonts, expectedAdvanceWidths) {
    for (const { name, font, readOutline } of loadedFonts) {
        const advanceWidths = getAdvanceWidthsAroundOutlines(font, getAllGlyphs(font), readOutline);
        assert.deepStrictEqual(advanceWidths.before, expectedAdvanceWidths, `before ${name}`);
        assert.deepStrictEqual(advanceWidths.after, expectedAdvanceWidths, `after ${name}`);
    }
}

// Draw a text like font.getPath() does, at a font size of one em: the pen position of each
// glyph when its outline is read, and the advance of the text, in font units
// (Font.shape reads every advance before the first callback: on a font whose outlines were
// never read the pen positions come from hmtx, a second drawing lays the text out once they are)
function drawText(font, text) {
    const penPositions = [];
    const textAdvance = font.forEachGlyph(text, 0, 0, font.unitsPerEm, {}, function(glyph, penX, penY, fontSize, options) {
        glyph.getPath(penX, penY, fontSize, options, font);
        penPositions.push(penX);
    });
    return { penPositions, textAdvance };
}

function writeAndParse(font) {
    return parse(font.toArrayBuffer());
}

// The tests of a fixture whose hmtx advances were replaced once an outline was read, one per
// load mode
function itKeepsHmtxAdvanceWidths(fixture, hmtxAdvanceWidths) {
    for (const loadMode of loadModes) {
        describe(`glyph.advanceWidth, ${loadMode.name}`, function() {
            let font;

            beforeEach(function() {
                font = loadFont(fixture, undefined, loadMode.options);
            });

            it('keeps the hmtx advance of every glyph after getBoundingBox', function() {
                const advanceWidths = getAdvanceWidthsAroundOutlines(font, getAllGlyphs(font), outlineReaders.getBoundingBox);
                assert.deepStrictEqual(advanceWidths.after, hmtxAdvanceWidths);
            });
        });
    }
}

describe('regression: CFF advance widths after the outlines are read (#417, #440, #397)', function() {

    describe('CFF with an empty Private DICT (#417)', function() {
        // A, V, I, H, space, A, COMBINING ACUTE ACCENT (the glyph whose charstring has no width)
        const text = 'AVIH A\u{0301}';
        let font;
        let fontsPerOutlineReader;
        let fontsPerLoadMode;

        beforeEach(function() {
            font = loadFont(emptyPrivateDictFixture);
            fontsPerOutlineReader = loadFontPerOutlineReader(emptyPrivateDictFixture);
            fontsPerLoadMode = loadFontPerLoadMode(emptyPrivateDictFixture);
        });

        it('keeps the hmtx advance of every glyph after getBoundingBox, getPath and path (also in lowMemory mode)', function() {
            // the hmtx advances of TestCFF1-EmptyPrivateDict.otf (.notdef, space, A, V, I, H, acutecomb)
            // [500, 250, 749, 680, 300, 813, 0]
            // hb-shape --no-glyph-names --cluster-level=1 TestCFF1-EmptyPrivateDict.otf -u 0020,0041,0056,0049,0048
            // [1=0+250|2=1+749|3=2+680|4=3+300|5=4+813]
            // (A is 749 like in the issue; the 1.3.3 build gives NaN for 6 glyphs and undefined for acutecomb.
            // HarfBuzz gives 0 to a mark whatever its hmtx advance: for acutecomb the reference is fontTools)
            const hmtxAdvanceWidths = [500, 250, 749, 680, 300, 813, 0];
            for (const loaded of fontsPerOutlineReader) {
                // python -c "from fontTools.ttLib import TTFont; print(TTFont('TestCFF1-EmptyPrivateDict.otf')['CFF '].cff.topDictIndex[0].rawDict['Private'])"
                // (0, 249)
                assert.strictEqual(loaded.font.tables.cff.topDict.private[0], 0, loaded.name);
            }
            assertKeepsAdvanceWidths(fontsPerOutlineReader, hmtxAdvanceWidths);
        });

        it('reads the outline of every glyph apart from the width operand of its first operator (also in lowMemory mode)', function() {
            // the outline of each glyph once its width operand is set apart: the width before rmoveto (.notdef),
            // hmoveto (A) and vmoveto (V) is not a coordinate, the two arguments of the rmoveto of acutecomb (width
            // omitted) are both coordinates, and the stems of hstem (I), hstemhm and hintmask (H) give the size of
            // the mask that follows hintmask; the space has no outline:
            // python -c "from fontTools.ttLib import TTFont; from fontTools.pens.boundsPen import BoundsPen; font = TTFont('TestCFF1-EmptyPrivateDict.otf'); glyphSet = font.getGlyphSet(); pens = {name: BoundsPen(glyphSet) for name in font.getGlyphOrder()}; [glyphSet[name].draw(pens[name]) for name in pens]; print([pens[name].bounds for name in pens])"
            // [(100, 0, 400, 700), None, (40, 0, 640, 700), (0, 0, 600, 700), (110, 0, 190, 700), (90, 0, 723, 700), (-200, 600, -100, 750)]
            const expectedBounds = [[100, 0, 400, 700], null, [40, 0, 640, 700], [0, 0, 600, 700], [110, 0, 190, 700], [90, 0, 723, 700], [-200, 600, -100, 750]];
            for (const { name, font: loadedFont } of fontsPerLoadMode) {
                assert.deepStrictEqual(getAllGlyphs(loadedFont).map(getOutlineBounds), expectedBounds, name);
            }
        });

        it('keeps the pen positions and the advances of a text once it is drawn', function() {
            // hb-shape --no-glyph-names --cluster-level=1 TestCFF1-EmptyPrivateDict.otf -u 0041,0056,0049,0048,0020,0041,0301
            // [2=0+749|3=1+680|4=2+300|5=3+813|1=4+250|2=5+749|6=6@-225,162+0]
            // (the offset of the mark is the fallback mark positioning of HarfBuzz, out of this spec:
            // the pen is at 3541 for the mark too)
            assert.deepStrictEqual(drawText(font, text), {
                penPositions: [0, 749, 1429, 1729, 2542, 2792, 3541],
                textAdvance: 3541
            });
            assertShape(shapeText(font, text), {
                glyphs: [2, 3, 4, 5, 1, 2, 6],
                clusters: [0, 1, 2, 3, 4, 5, 6],
                advances: [749, 680, 300, 813, 250, 749, 0]
            });
        });

        it('keeps the advance of a text after font.getPath', function() {
            // the sum of the hb-shape advances of the text above
            font.getPath(text, 0, 0, font.unitsPerEm);
            assert.strictEqual(font.getAdvanceWidth(text, font.unitsPerEm), 3541);
        });
    });

    describe('font written by opentype.js and parsed again (#440, #397)', function() {

        describe('WOFF fonts written with toArrayBuffer (#440)', function() {
            // hb-shape does not load WOFF: the references are the tables of the sources (a font that
            // is read and written keeps its glyphs and their advances). Glyph id and hmtx advance
            // of A, 1 and V, and number of glyphs:
            // python -c "from fontTools.ttLib import TTFont; font = TTFont('../Vibur.woff'); cmap = font.getBestCmap(); print([(font.getGlyphID(cmap[code]), font['hmtx'][cmap[code]][0]) for code in (0x41, 0x31, 0x56)], font['maxp'].numGlyphs)"
            // [(36, 1138), (20, 1024), (57, 1429)] 249
            // python -c "from fontTools.ttLib import TTFont; font = TTFont('../FiraSansMedium.woff'); cmap = font.getBestCmap(); print([(font.getGlyphID(cmap[code]), font['hmtx'][cmap[code]][0]) for code in (0x41, 0x31, 0x56)], font['maxp'].numGlyphs)"
            // [(36, 579), (20, 400), (57, 585)] 1147
            // The only glyph of the two fonts with an advance above 32767, an oddity of Vibur:
            // python -c "from fontTools.ttLib import TTFont; font = TTFont('../Vibur.woff'); print([(font.getGlyphID(name), name, font['hmtx'][name][0]) for name in font.getGlyphOrder() if font['hmtx'][name][0] > 32767])"
            // [(241, 'rs', 64001)]
            const wideGlyph = { index: 241, advanceWidth: 64001 };
            const sources = [
                // TrueType outlines (the issue names .woff and .ttf fonts), written as CFF
                { fixture: viburFixture, numGlyphs: 249, glyphs: [36, 20, 57], advanceWidths: [1138, 1024, 1429], wideGlyphs: [wideGlyph] },
                // CFF outlines, the Private DICT of the source has 65 bytes
                { fixture: firaSansFixture, numGlyphs: 1147, glyphs: [36, 20, 57], advanceWidths: [579, 400, 585], wideGlyphs: [] }
            ];
            let writtenFonts;

            beforeEach(function() {
                writtenFonts = new Map(sources.map(source => [source.fixture, writeAndParse(loadFont(source.fixture))]));
            });

            it('keeps the advance of every glyph but the one wider than 32767 units after getBoundingBox', function() {
                for (const source of sources) {
                    const writtenFont = writtenFonts.get(source.fixture);
                    assert.strictEqual(writtenFont.numGlyphs, source.numGlyphs, source.fixture);
                    const characterGlyphs = Array.from('A1V').map(character => writtenFont.charToGlyph(character));
                    assert.deepStrictEqual(characterGlyphs.map(glyph => glyph.index), source.glyphs, source.fixture);
                    const characterAdvanceWidths = getAdvanceWidthsAroundOutlines(writtenFont, characterGlyphs, outlineReaders.getBoundingBox);
                    assert.deepStrictEqual(characterAdvanceWidths.before, source.advanceWidths, `before, ${source.fixture}`);
                    assert.deepStrictEqual(characterAdvanceWidths.after, source.advanceWidths, `after, ${source.fixture}`);
                    // the hmtx advance of a wide glyph is written, its outline is not read here
                    const wideGlyphIndexes = source.wideGlyphs.map(glyph => glyph.index);
                    assert.deepStrictEqual(
                        wideGlyphIndexes.map(glyphIndex => writtenFont.glyphs.get(glyphIndex).advanceWidth),
                        source.wideGlyphs.map(glyph => glyph.advanceWidth),
                        `wide glyphs, ${source.fixture}`
                    );
                    // every other glyph, without a reference value: the advance read in hmtx is the one
                    // the glyph has once its outline is read
                    const otherGlyphs = getAllGlyphs(writtenFont).filter(glyph => !wideGlyphIndexes.includes(glyph.index));
                    const advanceWidths = getAdvanceWidthsAroundOutlines(writtenFont, otherGlyphs, outlineReaders.getBoundingBox);
                    assert.deepStrictEqual(advanceWidths.after, advanceWidths.before, `every glyph, ${source.fixture}`);
                }
            });

            it('keeps the advance of the glyph wider than 32767 units after getBoundingBox (rs of Vibur.woff)', function() {
                const glyph = writtenFonts.get(viburFixture).glyphs.get(wideGlyph.index);
                glyph.getBoundingBox();
                assert.strictEqual(glyph.advanceWidth, wideGlyph.advanceWidth);
            });

            // The writer alone, whatever parseCFFCharstring does with the width: a valid charstring is
            // read without an unknown operator. The writer of the fonto branch wrote the width of rs,
            // 64001, with the number encoding of a DICT, byte 29 and a 32 bit integer (1d 00 00 fa 01),
            // which is callgsubr in a charstring: fontTools could not draw it (IndexError: list index
            // out of range) and parseCFFCharstring logged 'Glyph 241: unknown operator 0' twice, for
            // the two first bytes of the integer. The font written now, saved and read with fontTools
            // (charStrings[name].draw(NullPen()) for every glyph), draws every charstring, and the
            // width of each one is its hmtx advance (Private DICT: {'nominalWidthX': 31234}).
            it('writes charstrings that are read without an unknown operator (rs of Vibur.woff, wider than 32767 units)', function() {
                const writtenFont = writtenFonts.get(viburFixture);
                const messages = getConsoleLogMessages(() => {
                    for (const glyph of getAllGlyphs(writtenFont)) {
                        glyph.getBoundingBox();
                    }
                });
                assert.deepStrictEqual(messages, []);
            });
        });

        describe('subset made with new Font() from the glyphs of a CID-keyed font (#397)', function() {
            // A, V, O, HANGUL SYLLABLE GA, CJK UNIFIED IDEOGRAPH-4E00
            const text = 'AVO\u{AC00}\u{4E00}';
            // the subset of the issue has the glyphs of the text only, a later comment adds .notdef
            const subsets = [
                { name: 'without .notdef', withNotdefGlyph: false, glyphs: [0, 1, 2, 3, 4] },
                { name: 'with .notdef', withNotdefGlyph: true, glyphs: [1, 2, 3, 4, 5] }
            ];
            let writtenSubsets;

            function writeSubset(withNotdefGlyph) {
                const sourceFont = loadFont(cidKeyedFixture);
                const glyphs = sourceFont.stringToGlyphs(text);
                if (withNotdefGlyph) {
                    glyphs.unshift(sourceFont.glyphs.get(0));
                }
                return writeAndParse(new Font({
                    familyName: sourceFont.getEnglishName('fontFamily'),
                    styleName: sourceFont.getEnglishName('fontSubfamily'),
                    unitsPerEm: sourceFont.unitsPerEm,
                    ascender: sourceFont.ascender,
                    descender: sourceFont.descender,
                    glyphs
                }));
            }

            beforeEach(function() {
                writtenSubsets = subsets.map(subset => ({ subset, font: writeSubset(subset.withNotdefGlyph) }));
            });

            it('keeps the advances of the glyphs after getBoundingBox', function() {
                // the advances of the source, without its kerning:
                // hb-shape --no-glyph-names --cluster-level=1 --language=en --features=-kern TestCFF1-CIDKeyed-subset.otf -u 0041,0056,004F,AC00,4E00
                // [2=0+608|4=1+575|3=2+742|12=3+920|11=4+1000]
                const sourceAdvanceWidths = [608, 575, 742, 920, 1000];
                for (const { subset, font } of writtenSubsets) {
                    const characterGlyphs = Array.from(text).map(character => font.charToGlyph(character));
                    assert.deepStrictEqual(characterGlyphs.map(glyph => glyph.index), subset.glyphs, subset.name);
                    const advanceWidths = getAdvanceWidthsAroundOutlines(font, characterGlyphs, outlineReaders.getBoundingBox);
                    assert.deepStrictEqual(advanceWidths.before, sourceAdvanceWidths, `before, ${subset.name}`);
                    assert.deepStrictEqual(advanceWidths.after, sourceAdvanceWidths, `after, ${subset.name}`);
                }
            });
        });
    });

    // The family of the font of #397, not its bug: a CID-keyed font has the Private DICTs of its
    // Font DICTs and its advances are right with the 1.3.3 build too. Nothing public gives the
    // width of a charstring any more: the advances after an outline is read say that the hmtx
    // advances are kept, with the widths of the Private DICT of each Font DICT parsed.
    describe('CID-keyed CFF, a subset of Source Han Sans KR (the font of #397)', function() {
        let fontsPerOutlineReader;
        let fontsPerLoadMode;

        beforeEach(function() {
            fontsPerOutlineReader = loadFontPerOutlineReader(cidKeyedFixture);
            fontsPerLoadMode = loadFontPerLoadMode(cidKeyedFixture);
        });

        it('parses the nominalWidthX and defaultWidthX of every Font DICT and keeps the hmtx advance of every glyph after getBoundingBox, getPath and path (also in lowMemory mode)', function() {
            // nominalWidthX and defaultWidthX of the 10 Font DICTs, and the Font DICT of each glyph:
            // python -c "from fontTools.ttLib import TTFont; top = TTFont('TestCFF1-CIDKeyed-subset.otf')['CFF '].cff.topDictIndex[0]; print([(fontDict.Private.nominalWidthX, fontDict.Private.defaultWidthX) for fontDict in top.FDArray], [top.FDSelect[index] for index in range(22)])"
            // [(0, 1000), (707, 1000), (107, 1000), (0, 1000), (0, 500), (0, 500), (107, 920), (0, 1000), (617, 742), (386, 279)] [3, 8, 8, 8, 8, 2, 2, 2, 2, 1, 1, 7, 6, 0, 0, 0, 4, 9, 5, 5, 5, 5]
            const fontDictWidths = [[0, 1000], [707, 1000], [107, 1000], [0, 1000], [0, 500], [0, 500], [107, 920], [0, 1000], [617, 742], [386, 279]];
            const fontDictIndexes = [3, 8, 8, 8, 8, 2, 2, 2, 2, 1, 1, 7, 6, 0, 0, 0, 4, 9, 5, 5, 5, 5];
            for (const { name, font } of fontsPerLoadMode) {
                const topDict = font.tables.cff.topDict;
                assert.deepStrictEqual(topDict._fdArray.map(fontDict => [fontDict._privateDict.nominalWidthX, fontDict._privateDict.defaultWidthX]), fontDictWidths, name);
                assert.deepStrictEqual(Array.from(topDict._fdSelect), fontDictIndexes, name);
            }
            // the hmtx advances of TestCFF1-CIDKeyed-subset.otf, equal to the widths of its charstrings
            const hmtxAdvanceWidths = [
                1000, 224, 608, 742, 575, 1000, 600, 0, 1000, 1000, 600,
                1000, 920, 1000, 1000, 1000, 500, 280, 500, 500, 500, 500
            ];
            assertKeepsAdvanceWidths(fontsPerOutlineReader, hmtxAdvanceWidths);
        });

        it('keeps the pen positions and the kerned advances of a text once it is drawn (also in lowMemory mode)', function() {
            // hb-shape --no-glyph-names --cluster-level=1 --language=en TestCFF1-CIDKeyed-subset.otf -u 0041,0056,004F,0020,AC00,4E00,02C7,00B1,31B4,3105,FF76
            // [2=0+593|4=1+564|3=2+742|1=3+224|12=4+920|11=5+1000|6=6+600|5=7+1000|10=8+600|9=9+1000|16=10+500]
            // (pair kerning: A V -15, V O -11; the glyphs come from 6 Font DICTs, with and without a width.
            // --language=en: the locl feature of the KOR language system of the font replaces the space, glyph 1,
            // with glyph 17, and hb-shape takes its default language from the locale)
            // A, V, O, space, HANGUL SYLLABLE GA, CJK UNIFIED IDEOGRAPH-4E00, CARON, PLUS-MINUS SIGN,
            // BOPOMOFO FINAL LETTER P, BOPOMOFO LETTER B, HALFWIDTH KATAKANA LETTER KA
            const text = 'AVO \u{AC00}\u{4E00}\u{02C7}\u{00B1}\u{31B4}\u{3105}\u{FF76}';
            for (const { name, font } of fontsPerLoadMode) {
                assert.deepStrictEqual(drawText(font, text), {
                    penPositions: [0, 593, 1157, 1899, 2123, 3043, 4043, 4643, 5643, 6243, 7243],
                    textAdvance: 7743
                }, name);
                assertShape(shapeText(font, text), {
                    glyphs: [2, 4, 3, 1, 12, 11, 6, 5, 10, 9, 16],
                    clusters: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                    advances: [593, 564, 742, 224, 920, 1000, 600, 1000, 600, 1000, 500]
                }, name);
            }
        });
    });

    // Not the NaN of the issues: what is left of the assignment that #397 points at
    // ("this line of code override previous value"), in upstream master too.
    describe('CFF with an hmtx advance that differs from the width of the charstring (the assignment of #397)', function() {
        // the hmtx advances of TestCFF1-WidthMismatch.otf
        // (the widths of its charstrings: [500, 250, 749, 680, 300, 813, 0])
        const hmtxAdvanceWidths = [500, 250, 600, 720, 300, 813, 0];
        const text = 'AVIH A';
        let font;

        beforeEach(function() {
            font = loadFont(widthMismatchFixture);
        });

        it('takes the advances from hmtx as long as no outline is read', function() {
            // hb-shape --no-glyph-names --cluster-level=1 TestCFF1-WidthMismatch.otf -u 0041,0056,0049,0048,0020,0041
            // [2=0+600|3=1+720|4=2+300|5=3+813|1=4+250|2=5+600]
            assertShape(shapeText(font, text), {
                glyphs: [2, 3, 4, 5, 1, 2],
                clusters: [0, 1, 2, 3, 4, 5],
                advances: [600, 720, 300, 813, 250, 600]
            });
            assert.strictEqual(font.getAdvanceWidth(text, font.unitsPerEm), 3283);
        });

        itKeepsHmtxAdvanceWidths(widthMismatchFixture, hmtxAdvanceWidths);

        it('keeps the pen positions of hmtx when a text is drawn, and drawn again once its outlines are read', function() {
            // the pen positions of the hb-shape advances above
            const expectedDrawnText = {
                penPositions: [0, 600, 1320, 1620, 2433, 2683],
                textAdvance: 3283
            };
            assert.deepStrictEqual([drawText(font, text), drawText(font, text)], [expectedDrawnText, expectedDrawnText]);
        });

        // fontToSfntTable (src/tables/sfnt.mjs) reads the outlines (glyph.getMetrics) before it
        // writes hmtx: the advances it writes are the ones of the glyphs once their outlines are read
        describe('written with toArrayBuffer and parsed again', function() {
            let advanceWidths;

            beforeEach(function() {
                const writtenFont = writeAndParse(font);
                advanceWidths = getAdvanceWidthsAroundOutlines(writtenFont, getAllGlyphs(writtenFont), outlineReaders.getBoundingBox);
            });

            it('keeps the hmtx advance of every glyph', function() {
                // the hmtx advances of the source above: a font that is read and written keeps its hmtx table
                // (the fonto branch wrote the widths of the charstrings, [500, 250, 749, 680, 300, 813, 0])
                assert.deepStrictEqual(advanceWidths, {
                    before: hmtxAdvanceWidths,
                    after: hmtxAdvanceWidths
                });
            });
        });
    });

    // Not reported upstream, and in upstream master too: the assignment of #417 with another
    // wrong value, 0 instead of NaN.
    describe('hinted CFF2 variable font, a subset of Source Serif 4 Variable (the assignment of #417)', function() {
        // .notdef, A, V and o have hint operators, the space has no charstring program.
        // A V and V o are kerned by PairPos format 2 subtables
        const text = 'AVo A';
        // V space and space V are kerned by the PairPos format 1 subtable, V A and o V by the
        // format 2 ones; every value has a variation device
        const variablePairsText = 'VA V V oV';
        // V V is kerned by the PairPos format 1 subtable, o o by a format 2 one, both with the value 0
        // and a variation device (the format 2 subtable of V has V V too, 0 without a device: the
        // format 1 subtable comes first in the lookup); A A has +10 and a variation device
        const zeroDefaultPairsText = 'VVooAA';

        const instances = [
            {
                name: 'the default instance (wght=400, opsz=20)',
                variation: undefined,
                // hb-shape --no-glyph-names --cluster-level=1 TestCFF2-HintedVariable-subset.otf -u 0041,0056,006F,0020,0041
                // [2=0+545|3=1+603|4=2+549|1=3+233|2=4+664]
                advances: [545, 603, 549, 233, 664],
                penPositions: [0, 545, 1148, 1697, 1930],
                textAdvance: 2594,
                // hb-shape --no-glyph-names --cluster-level=1 TestCFF2-HintedVariable-subset.otf -u 0056,0041,0020,0056,0020,0056,0020,006F,0056
                // [3=0+554|2=1+664|1=2+203|3=3+635|1=4+203|3=5+635|1=6+233|4=7+469|3=8+674]
                variablePairsAdvances: [554, 664, 203, 635, 203, 635, 233, 469, 674],
                // hb-shape --no-glyph-names --cluster-level=1 TestCFF2-HintedVariable-subset.otf -u 0056,0056,006F,006F,0041,0041
                // [3=0+674|3=1+603|4=2+549|4=3+509|2=4+674|2=5+664]
                zeroDefaultPairsAdvances: [674, 603, 549, 509, 674, 664]
            },
            {
                name: 'wght=900',
                variation: { wght: 900 },
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900 TestCFF2-HintedVariable-subset.otf -u 0041,0056,006F,0020,0041
                // [2=0+580|3=1+566|4=2+572|1=3+206|2=4+680]
                advances: [580, 566, 572, 206, 680],
                penPositions: [0, 580, 1146, 1718, 1924],
                textAdvance: 2604,
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900 TestCFF2-HintedVariable-subset.otf -u 0056,0041,0020,0056,0020,0056,0020,006F,0056
                // [3=0+536|2=1+680|1=2+186|3=3+636|1=4+186|3=5+636|1=6+206|4=7+492|3=8+656]
                variablePairsAdvances: [536, 680, 186, 636, 186, 636, 206, 492, 656],
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=900 TestCFF2-HintedVariable-subset.otf -u 0056,0056,006F,006F,0041,0041
                // [3=0+666|3=1+566|4=2+582|4=3+522|2=4+680|2=5+680]
                zeroDefaultPairsAdvances: [666, 566, 582, 522, 680, 680]
            },
            {
                name: 'wght=200, opsz=60',
                variation: { wght: 200, opsz: 60 },
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=200,opsz=60 TestCFF2-HintedVariable-subset.otf -u 0041,0056,006F,0020,0041
                // [2=0+494|3=1+522|4=2+480|1=3+212|2=4+614]
                advances: [494, 522, 480, 212, 614],
                penPositions: [0, 494, 1016, 1496, 1708],
                textAdvance: 2322,
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=200,opsz=60 TestCFF2-HintedVariable-subset.otf -u 0056,0041,0020,0056,0020,0056,0020,006F,0056
                // [3=0+494|2=1+614|1=2+180|3=3+582|1=4+180|3=5+582|1=6+212|4=7+388|3=8+614]
                variablePairsAdvances: [494, 614, 180, 582, 180, 582, 212, 388, 614],
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=200,opsz=60 TestCFF2-HintedVariable-subset.otf -u 0056,0056,006F,006F,0041,0041
                // [3=0+622|3=1+522|4=2+480|4=3+452|2=4+622|2=5+614]
                zeroDefaultPairsAdvances: [622, 522, 480, 452, 622, 614]
            },
            {
                // not a default nor an extreme of an axis: the avar table moves the normalized wght from 0.5 to about 0.52
                name: 'wght=650, opsz=12',
                variation: { wght: 650, opsz: 12 },
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=650,opsz=12 TestCFF2-HintedVariable-subset.otf -u 0041,0056,006F,0020,0041
                // [2=0+612|3=1+644|4=2+608|1=3+225|2=4+725]
                advances: [612, 644, 608, 225, 725],
                penPositions: [0, 612, 1256, 1864, 2089],
                textAdvance: 2814,
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=650,opsz=12 TestCFF2-HintedVariable-subset.otf -u 0056,0041,0020,0056,0020,0056,0020,006F,0056
                // [3=0+601|2=1+725|1=2+200|3=3+689|1=4+200|3=5+689|1=6+225|4=7+534|3=8+718]
                variablePairsAdvances: [601, 725, 200, 689, 200, 689, 225, 534, 718],
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=650,opsz=12 TestCFF2-HintedVariable-subset.otf -u 0056,0056,006F,006F,0041,0041
                // [3=0+723|3=1+644|4=2+613|4=3+581|2=4+730|2=5+725]
                zeroDefaultPairsAdvances: [723, 644, 613, 581, 730, 725]
            }
        ];

        describe('as long as no outline is read', function() {
            let fontsPerInstance;

            beforeEach(function() {
                fontsPerInstance = instances.map(instance => ({
                    instance,
                    fonts: loadFontPerLoadMode(hintedVariableFixture, instance.variation)
                }));
            });

            it('has the advances of hmtx, HVAR and the pair kerning at every instance (also in lowMemory mode)', function() {
                for (const { instance, fonts } of fontsPerInstance) {
                    for (const { name, font } of fonts) {
                        const message = `${instance.name}, ${name}`;
                        assertShape(shapeText(font, text), {
                            glyphs: [2, 3, 4, 1, 2],
                            clusters: [0, 1, 2, 3, 4],
                            advances: instance.advances
                        }, message);
                        assert.strictEqual(font.getAdvanceWidth(text, font.unitsPerEm), instance.textAdvance, message);
                    }
                }
            });

            it('kerns the pairs of a PairPos format 1 subtable with variation devices at every instance (also in lowMemory mode)', function() {
                for (const { instance, fonts } of fontsPerInstance) {
                    for (const { name, font } of fonts) {
                        assertShape(shapeText(font, variablePairsText), {
                            glyphs: [3, 2, 1, 3, 1, 3, 1, 4, 3],
                            clusters: [0, 1, 2, 3, 4, 5, 6, 7, 8],
                            advances: instance.variablePairsAdvances
                        }, `${instance.name}, ${name}`);
                    }
                }
            });

            it('kerns the pairs whose value is 0 at the default instance with their variation device at every instance (also in lowMemory mode)', function() {
                for (const { instance, fonts } of fontsPerInstance) {
                    for (const { name, font } of fonts) {
                        assertShape(shapeText(font, zeroDefaultPairsText), {
                            glyphs: [3, 3, 4, 4, 2, 2],
                            clusters: [0, 1, 2, 3, 4, 5],
                            advances: instance.zeroDefaultPairsAdvances
                        }, `${instance.name}, ${name}`);
                    }
                }
            });
        });

        for (const instance of instances) {
            describe(`drawn at ${instance.name}`, function() {
                let font;

                beforeEach(function() {
                    font = loadFont(hintedVariableFixture, instance.variation);
                });

                it('keeps the pen positions and the advances of a text once it is drawn', function() {
                    const drawnText = drawText(font, text);
                    const advancesOnceDrawn = shapeText(font, text).advances;
                    assert.deepStrictEqual({ ...drawnText, advancesOnceDrawn }, {
                        penPositions: instance.penPositions,
                        textAdvance: instance.textAdvance,
                        advancesOnceDrawn: instance.advances
                    });
                });
            });
        }

        // the hmtx advances of TestCFF2-HintedVariable-subset.otf (.notdef, space, A, V, o)
        // [640, 233, 664, 674, 549]
        itKeepsHmtxAdvanceWidths(hintedVariableFixture, [640, 233, 664, 674, 549]);

        describe('glyph without hint operators', function() {
            let font;

            beforeEach(function() {
                font = loadFont(hintedVariableFixture);
            });

            it('keeps the hmtx advance of the space after getBoundingBox', function() {
                // hb-shape --no-glyph-names --cluster-level=1 TestCFF2-HintedVariable-subset.otf -u 0020
                // [1=0+233]
                const space = font.glyphs.get(1);
                space.getBoundingBox();
                assert.strictEqual(space.advanceWidth, 233);
            });
        });
    });
});
