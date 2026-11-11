/**
 * Regression tests of upstream issue #590, the error "Substitution type 11 is not supported in
 * chaining substitution" on this font: PR #486 added that error for the nested lookups it did not
 * handle (the reporter met it on the branch of PR #564, about rlig, a feature this font does not have).
 *
 * On upstream master stringToGlyphIndexes of the text of the issue still throws that error,
 * and so does the call of the issue, getPath with { features: { liga: true } } (getPath
 * without options draws the plain glyphs); the glyphs with liga turned off are already right
 * (stringToGlyphIndexes). Of the tests as written only the parsing test passes there: the
 * getPath test throws that error, the others shape with stringToGlyphClusters, which
 * upstream does not have.
 *
 * Fixture: TestGSUB-ChainingLigatures-subset.otf, a subset of Lobster Two Bold (CFF, 54 glyphs,
 * U+0020 A T a d f i k n o t u x y z and the glyphs of their layout closure). How it was
 * built is in test/fonts/regression/README.md.
 *
 * Mechanism: the liga feature has four GSUB lookups, applied in lookup list order:
 * 2 (type 4, the T_i ligature), 3 (type 6 format 3: d or u followed by z, nested lookup 7),
 * 4 (type 4, the other ligatures), 5 (type 6 format 3: a first rule with a lookahead and no
 * lookup record, which only stops the lookup inside a word, then a rule without context,
 * nested lookup 7). The nested lookup 7 is a single substitution format 1 (delta +1, the
 * .end forms). GPOS has one kern lookup (type 2, formats 1 and 2). The aalt feature has a
 * single substitution format 1 (lookup 0) and an alternate substitution for k (lookup 1,
 * type 3, which the fork does not apply yet: the known failures), the salt feature a single
 * substitution format 2 (lookup 6).
 *
 * Around the fix, the same fixture shows what the text layout does with the substituted
 * glyphs: their kerning and a character the font does not have (regular tests), the zero
 * width joiner and non-joiner inside a ligature, the non-joiner in a chaining context and in a
 * kerning pair, and the kerning with a language the font has no language system for (known failures).
 *
 * The font has one script (latn) with its default language system only, in GSUB and in GPOS:
 * the hb-shape commands need no --script or --language, except the one of the language test.
 */

import assert from 'assert';
import { loadFont, shapeText, assertShape, getPathOutline, assertOutlineClose, itFailsUntilFixed } from './helpers.mjs';

const fixture = 'TestGSUB-ChainingLigatures-subset.otf';

// The text of the example attached to #590, and its shaping:
// hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 0064,007A,0020,0075,007A,0020,0041,0041,0066,0066,0074,0041,0041
// [11=0+534|53=1+428|38=2+215|44=3+514|53=4+428|38=5+215|1=6+603|1=7+603|13=8+783|1=11+603|1=12+603]
// (d.end z space u.end z space A A f_f_t A A)
const issueText = 'dz uz AAfftAA';
const issueShape = {
    glyphs: [11, 53, 38, 44, 53, 38, 1, 1, 13, 1, 1],
    clusters: [0, 1, 2, 3, 4, 5, 6, 7, 8, 11, 12],
    advances: [534, 428, 215, 514, 428, 215, 603, 603, 783, 603, 603],
    // the end of each cluster is the start of the next one: the ligature covers the three characters f f t
    ends: [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13]
};

// The outlines of the glyphs of the issue text, by glyph id (static CFF font, y axis going up): the value of
// the RecordingPen of fontTools, with M for moveTo, L for lineTo, C for curveTo and Z for closePath. The command
// for d.end, the other glyphs are A, f_f_t, space, u.end and z:
// python -c "from fontTools.ttLib import TTFont; from fontTools.pens.recordingPen import RecordingPen; pen = RecordingPen(); TTFont('TestGSUB-ChainingLigatures-subset.otf').getGlyphSet()['d.end'].draw(pen); print(pen.value)"
const issueGlyphOutlines = {
    // A
    1: [
        ['M', 557, 0], ['L', 557, 736], ['C', 530, 746, 497, 750, 477, 750], ['C', 361, 750, 261, 614, 194, 455],
        ['C', 171, 457, 150, 458, 135, 458], ['C', 29, 458, -43, 411, -43, 348], ['C', -43, 302, -6, 277, 33, 277], ['C', 61, 277, 82, 290, 82, 310],
        ['C', 82, 326, 67, 347, 61, 347], ['C', 67, 382, 108, 396, 172, 400], ['C', 126, 275, 100, 143, 100, 56], ['C', 100, -111, 196, -114, 263, -114],
        ['C', 249, -98, 227, -73, 227, 39], ['C', 227, 139, 244, 276, 275, 398], ['C', 318, 394, 358, 385, 412, 363], ['L', 412, 0],
        ['Z'], ['M', 412, 407], ['C', 371, 422, 328, 433, 287, 441], ['C', 318, 552, 361, 645, 412, 678],
        ['Z']
    ],
    // d.end
    11: [
        ['M', 315, 680], ['L', 315, 452], ['C', 298, 499, 254, 505, 221, 505], ['C', 82, 505, 30, 348, 30, 226],
        ['C', 30, 52, 122, -6, 206, -6], ['C', 277, -6, 314, 40, 335, 86], ['C', 348, 30, 381, -6, 447, -6], ['C', 503, -6, 519, 20, 531, 95],
        ['C', 525, 92, 520, 91, 511, 91], ['C', 472, 91, 459, 104, 459, 160], ['L', 459, 700], ['Z'],
        ['M', 266, 443], ['C', 298, 443, 311, 416, 315, 405], ['L', 315, 178], ['C', 315, 120, 279, 91, 250, 91],
        ['C', 225, 91, 176, 93, 176, 235], ['C', 176, 322, 201, 443, 266, 443], ['Z']
    ],
    // f_f_t
    13: [
        ['M', 54, -250], ['C', 89, -250, 136, -239, 165, -195], ['C', 190, -229, 232, -250, 285, -250], ['C', 352, -250, 428, -218, 428, -80],
        ['L', 428, 460], ['L', 564, 460], ['L', 564, 179], ['C', 564, 48, 627, -6, 705, -6],
        ['C', 755, -6, 851, 16, 873, 179], ['L', 831, 179], ['C', 826, 130, 804, 91, 755, 91], ['C', 722, 91, 707, 108, 707, 160],
        ['L', 707, 460], ['L', 768, 460], ['L', 768, 500], ['L', 707, 500],
        ['L', 707, 680], ['C', 616, 714, 516, 749, 433, 749], ['C', 391, 749, 347, 740, 318, 705], ['C', 284, 735, 242, 749, 193, 749],
        ['C', 126, 749, 47, 723, 47, 582], ['L', 47, 8], ['C', -32, -18, -97, -45, -97, -119], ['C', -97, -197, -27, -250, 54, -250],
        ['Z'], ['M', 194, 460], ['L', 282, 460], ['L', 282, 52],
        ['L', 194, 37], ['Z'], ['M', 564, 500], ['L', 427, 500],
        ['L', 427, 610], ['C', 427, 674, 455, 686, 477, 686], ['C', 491, 686, 535, 681, 564, 670], ['Z'],
        ['M', 189, -135], ['C', 192, -119, 194, -101, 194, -80], ['L', 194, 8], ['L', 283, 28],
        ['L', 283, -83], ['C', 283, -149, 264, -175, 228, -175], ['C', 210, -175, 189, -167, 189, -135], ['Z'],
        ['M', 282, 500], ['L', 194, 500], ['L', 194, 587], ['C', 194, 628, 203, 676, 256, 676],
        ['C', 272, 676, 284, 671, 295, 664], ['C', 287, 641, 282, 614, 282, 579], ['Z'], ['M', -38, -111],
        ['C', -38, -68, 8, -41, 54, -25], ['L', 54, -83], ['C', 54, -142, 31, -161, 11, -161], ['C', -8, -161, -38, -145, -38, -111],
        ['Z']
    ],
    // space
    38: [],
    // u.end
    44: [
        ['M', 294, 500], ['L', 294, 179], ['C', 290, 129, 268, 91, 232, 91], ['C', 206, 91, 191, 110, 191, 160],
        ['L', 191, 500], ['L', 47, 500], ['L', 47, 149], ['C', 47, 55, 86, -6, 181, -6],
        ['C', 222, -6, 280, 5, 314, 88], ['C', 326, 31, 359, -6, 426, -6], ['C', 482, -6, 498, 20, 510, 95], ['C', 504, 92, 499, 91, 490, 91],
        ['C', 451, 91, 438, 104, 438, 160], ['L', 438, 500], ['Z']
    ],
    // z
    53: [
        ['M', 365, 91], ['C', 365, 75, 346, 71, 322, 71], ['C', 295, 71, 251, 76, 234, 77], ['L', 425, 500],
        ['L', 150, 500], ['C', 87, 500, 54, 449, 54, 410], ['C', 54, 373, 84, 355, 111, 355], ['C', 133, 355, 155, 368, 155, 397],
        ['C', 155, 437, 138, 422, 138, 432], ['C', 138, 444, 160, 446, 189, 446], ['L', 263, 446], ['L', 67, 0],
        ['L', 343, 0], ['C', 411, 0, 444, 51, 444, 93], ['C', 444, 126, 425, 155, 388, 155], ['C', 355, 155, 341, 134, 341, 117],
        ['C', 341, 104, 349, 92, 365, 91], ['Z']
    ]
};

// The outline of a shaped line: the outline of each glyph, moved to its pen position
// (the sum of the advances before it).
function buildLineOutline(glyphs, advances, glyphOutlines) {
    const lineOutline = [];
    let penX = 0;
    for (let i = 0; i < glyphs.length; i++) {
        for (const command of glyphOutlines[glyphs[i]]) {
            // the x coordinates are the odd values of a command, after its type
            lineOutline.push(command.map((value, valueIndex) => (valueIndex % 2 === 1 ? value + penX : value)));
        }
        penX += advances[i];
    }
    return lineOutline;
}

describe('regression: GSUB chaining context format 3 with a nested single substitution, and ligatures (#590)', function() {
    let font;

    beforeEach(function() {
        font = loadFont(fixture);
    });

    describe('the GSUB lookups of the Lobster Two Bold subset', function() {
        it('parses the chaining lookups, the rule without lookup records, the nested single substitution format 1 and the alternates of k', function() {
            // python -m fontTools.ttx -q -t GSUB -o - TestGSUB-ChainingLigatures-subset.otf
            // (the lookups of liga, the lookup types, Format="3" of the chaining subtables, the coverages, the lookup
            // records and the alternates of k). ttx does not print the format of the single, alternate and ligature
            // substitutions: these formats (the first uint16 of each subtable) and the delta of lookup 7 (the int16
            // at offset 4 of its subtable) are read in the bytes of the table,
            // TTFont('TestGSUB-ChainingLigatures-subset.otf').getTableData('GSUB')
            const gsub = font.tables.gsub;
            const liga = gsub.features.find(feature => feature.tag === 'liga');
            assert.deepStrictEqual(liga.feature.lookupListIndexes, [2, 3, 4, 5]);
            assert.deepStrictEqual(gsub.lookups.map(lookup => lookup.lookupType), [1, 3, 4, 6, 4, 6, 1, 1]);
            assert.deepStrictEqual(
                gsub.lookups.map(lookup => lookup.subtables.map(subtable => subtable.substFormat)),
                [[1], [1], [1], [3, 3], [1], [3, 3], [2], [1]]
            );
            const nestedRecords = [{ sequenceIndex: 0, lookupListIndex: 7 }];
            const getCoverageGlyphs = coverage => font.substitution.expandCoverage(coverage);

            // lookup 3: d (10), then u (43), followed by z (53)
            const beforeZ = gsub.lookups[3].subtables;
            assert.deepStrictEqual(beforeZ.map(subtable => subtable.backtrackCoverage.length), [0, 0]);
            assert.deepStrictEqual(beforeZ.map(subtable => subtable.inputCoverage.map(getCoverageGlyphs)), [[[10]], [[43]]]);
            assert.deepStrictEqual(beforeZ.map(subtable => subtable.lookaheadCoverage.map(getCoverageGlyphs)), [[[53]], [[53]]]);
            assert.deepStrictEqual(beforeZ.map(subtable => subtable.lookupRecords), [nestedRecords, nestedRecords]);

            // lookup 5: a rule with a lookahead and no lookup record, then a rule without context.
            // Both rules have the same 15 input glyphs (a a_x d f_u fi i i_x k n o t u u_x x y); the lookahead
            // of the first rule is every glyph from a to z (5 to 37 and 39 to 53): not the space (38), not A or T (1 to 4)
            const wordFinal = gsub.lookups[5].subtables;
            const wordFinalInput = [5, 7, 10, 17, 22, 24, 26, 29, 32, 35, 39, 43, 45, 47, 49];
            const wordFinalLookahead = [];
            for (let i = 5; i <= 53; i++) {
                if (i !== 38) {
                    wordFinalLookahead.push(i);
                }
            }
            assert.deepStrictEqual(wordFinal.map(subtable => subtable.backtrackCoverage.length), [0, 0]);
            assert.deepStrictEqual(wordFinal.map(subtable => subtable.inputCoverage.map(getCoverageGlyphs)), [[wordFinalInput], [wordFinalInput]]);
            assert.deepStrictEqual(wordFinal.map(subtable => subtable.lookaheadCoverage.map(getCoverageGlyphs)), [[wordFinalLookahead], []]);
            assert.deepStrictEqual(wordFinal.map(subtable => subtable.lookupRecords), [[], nestedRecords]);

            // lookup 7, the "substitution type 11" of the error of #590: format 1, the same 15 glyphs, delta +1
            assert.strictEqual(gsub.lookups[7].subtables.length, 1);
            assert.deepStrictEqual(getCoverageGlyphs(gsub.lookups[7].subtables[0].coverage), wordFinalInput);
            assert.strictEqual(gsub.lookups[7].subtables[0].deltaGlyphId, 1);

            // lookup 1 of aalt, the alternate substitution: k (29) to k.end (30) or k.salt (31)
            assert.deepStrictEqual(getCoverageGlyphs(gsub.lookups[1].subtables[0].coverage), [29]);
            assert.deepStrictEqual(gsub.lookups[1].subtables[0].alternateSets, [[30, 31]]);
        });
    });

    describe('the text of the issue, "dz uz AAfftAA"', function() {
        it('substitutes d and u before z (chaining with a nested single substitution) and forms the f_f_t ligature', function() {
            // the command and its output are above issueShape
            assertShape(shapeText(font, issueText), issueShape);
            assert.deepStrictEqual(font.stringToGlyphIndexes(issueText), issueShape.glyphs);
        });

        it('gives the same glyphs with the features option of the issue, { liga: true }', function() {
            // hb-shape --no-glyph-names --cluster-level=1 --features=+liga TestGSUB-ChainingLigatures-subset.otf -u 0064,007A,0020,0075,007A,0020,0041,0041,0066,0066,0074,0041,0041
            // [11=0+534|53=1+428|38=2+215|44=3+514|53=4+428|38=5+215|1=6+603|1=7+603|13=8+783|1=11+603|1=12+603]
            assertShape(shapeText(font, issueText, { features: { liga: true } }), issueShape);
        });

        it('draws the substituted glyphs with getPath, the call of the issue', function() {
            // the glyphs and their pen positions are the hb-shape line of the test above (--features=+liga),
            // the outline of each glyph is the one of fontTools (issueGlyphOutlines)
            const expectedOutline = buildLineOutline(issueShape.glyphs, issueShape.advances, issueGlyphOutlines);
            // guard of the outlines copied in this file, the number of commands of the RecordingPen values:
            // 4 x 21 (A), 19 (d.end), 57 (f_f_t), 15 (u.end), 2 x 18 (z), none for the 2 spaces
            assert.strictEqual(expectedOutline.length, 211);
            const outline = getPathOutline(font.getPath(issueText, 0, 0, font.unitsPerEm, { features: { liga: true } }));
            assertOutlineClose(outline, expectedOutline, 0, 'getPath of the issue text');
        });

        it('keeps the plain glyphs when liga is turned off, in the glyphs and in the text layout', function() {
            // hb-shape --no-glyph-names --cluster-level=1 --features=-liga TestGSUB-ChainingLigatures-subset.otf -u 0064,007A,0020,0075,007A,0020,0041,0041,0066,0066,0074,0041,0041
            // [10=0+526|53=1+428|38=2+215|43=3+505|53=4+428|38=5+215|1=6+603|1=7+603|12=8+267|12=9+267|39=10+267|1=11+603|1=12+603]
            // (d z space u z space A A f f t A A)
            assertShape(shapeText(font, issueText, { features: { liga: false } }), {
                glyphs: [10, 53, 38, 43, 53, 38, 1, 1, 12, 12, 39, 1, 1],
                clusters: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                advances: [526, 428, 215, 505, 428, 215, 603, 603, 267, 267, 267, 603, 603]
            });
        });
    });

    describe('contextual end forms', function() {
        it('stops at a rule without lookup records inside a word, and applies the next rule at the end of a word', function() {
            // hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 0061,006E,0064,0020,006E,006F
            // [5=0+526|32=1+505|11=2+534|38=3+215|32=4+505|36=5+481]
            // ("and no": a n d.end space n o.end: a and n are followed by a letter, the first rule of lookup 5 matches and does nothing)
            assertShape(shapeText(font, 'and no'), {
                glyphs: [5, 32, 11, 38, 32, 36],
                clusters: [0, 1, 2, 3, 4, 5],
                advances: [526, 505, 534, 215, 505, 481]
            });
        });

        it('keeps d and u plain when their context does not match', function() {
            // A comment of the issue: with a first fix, d and u took the end form in any context.
            // hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 0064,0061,0020,0075,0061,0020,0064,0064,007A,0020,0075,0075,007A
            // [10=0+526|6=1+535|38=2+215|43=3+505|6=4+535|38=5+215|10=6+526|11=7+534|53=8+428|38=9+215|43=10+505|44=11+514|53=12+428]
            // ("da ua ddz uuz": d a.end space u a.end space d d.end z space u u.end z: plain before a letter,
            // only the d and the u followed by z take the end form)
            assertShape(shapeText(font, 'da ua ddz uuz'), {
                glyphs: [10, 6, 38, 43, 6, 38, 10, 11, 53, 38, 43, 44, 53],
                clusters: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
                advances: [526, 535, 215, 505, 535, 215, 526, 534, 428, 215, 505, 514, 428]
            });
        });

        it('gives the end form to a glyph that only lookup 5 of liga covers (k), and keeps it plain inside a word', function() {
            // hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 006B,0020,006B,006B,0020,006B,0075
            // [30=0+534|38=1+215|29=2+518|30=3+534|38=4+215|29=5+518|44=6+514]
            // ("k kk ku": k.end space k k.end space k u.end: k is in no ligature and not in lookup 3, both rules
            // of lookup 5 cover it and the first one keeps the k followed by a letter plain)
            assertShape(shapeText(font, 'k kk ku'), {
                glyphs: [30, 38, 29, 30, 38, 29, 44],
                clusters: [0, 1, 2, 3, 4, 5, 6],
                advances: [534, 215, 518, 534, 215, 518, 514]
            });
        });

        it('applies the liga lookups in lookup list order: the end form before z wins over a ligature, a ligature takes its end form', function() {
            // hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 0066,0075,007A,007A,0020,0066,0075
            // [12=0+267|44=1+514|53=2+428|53=3+428|38=4+215|18=5+782]
            // ("fuzz fu": f u.end z z space f_u.end: lookup 3 turns u into u.end before lookup 4 can form f_u,
            // lookup 5 substitutes the f_u ligature of lookup 4 at the end of the word)
            assertShape(shapeText(font, 'fuzz fu'), {
                glyphs: [12, 44, 53, 53, 38, 18],
                clusters: [0, 1, 2, 3, 4, 5],
                advances: [267, 514, 428, 428, 215, 782],
                ends: [1, 2, 3, 4, 5, 7]
            });
        });

        it('forms the ligatures of three glyphs, and the end form of the glyph after a ligature', function() {
            // hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 0066,0066,0069,0020,0066,0069,0074,0020,0066,0069,007A
            // [21=0+764|38=3+215|22=4+532|40=6+282|38=7+215|15=8+902]
            // ("ffi fit fiz": ffi space fi t.end space f_i_z)
            assertShape(shapeText(font, 'ffi fit fiz'), {
                glyphs: [21, 38, 22, 40, 38, 15],
                clusters: [0, 3, 4, 6, 7, 8],
                advances: [764, 215, 532, 282, 215, 902],
                ends: [3, 4, 6, 7, 8, 11]
            }, 'ffi fit fiz');

            // hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 0054,0069,0078,0020,0054,0069
            // [4=0+783|48=2+539|38=3+215|4=4+783]
            // ("Tix Ti": T_i x.end space T_i: T_i of lookup 2 comes before i_x of lookup 4)
            assertShape(shapeText(font, 'Tix Ti'), {
                glyphs: [4, 48, 38, 4],
                clusters: [0, 2, 3, 4],
                advances: [783, 539, 215, 783],
                ends: [2, 3, 4, 6]
            }, 'Tix Ti');
        });

        it('gives the end form to a glyph followed by a character the font does not have', function() {
            // .notdef (glyph 0, 385 wide) is not in the lookahead coverage of the first rule of lookup 5:
            // the a before it is at the end of a word
            // hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 0061,0062
            // [6=0+535|0=1+385]
            // ("ab": a.end .notdef)
            assertShape(shapeText(font, 'ab'), {
                glyphs: [6, 0],
                clusters: [0, 1],
                advances: [535, 385]
            }, 'ab');

            // hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 0061,002E,0064
            // [6=0+535|0=1+385|11=2+534]
            // ("a.d": a.end .notdef d.end)
            assertShape(shapeText(font, 'a.d'), {
                glyphs: [6, 0, 11],
                clusters: [0, 1, 2],
                advances: [535, 385, 534]
            }, 'a.d');
        });
    });

    describe('ligature control characters', function() {
        // The fixture has no glyph for the joiners. --remove-default-ignorables: a character without a glyph of
        // its own belongs to the cluster of the glyph before it (stringToGlyphClusters), where HarfBuzz by
        // default keeps it as an invisible glyph without advance ([12=0+267|38=1+0|12=2+267|38=3+0|40=4+282],
        // [13=0+783|38=0+0|38=0+0], [5=0+526|38=1+0|11=2+534] and [3=0+511|38=1+0|36=2+481] for the four texts
        // below). The ends are the start of the next cluster, or the length of the text

        itFailsUntilFixed(
            'keeps f f t apart around zero width non-joiners, which are not drawn',
            'Font.prototype._createBidi (src/font.mjs): a default ignorable character without a glyph in the cmap is mapped to .notdef and drawn, 385 units wide',
            function() {
                // f, U+200C (zero width non-joiner), f, U+200C, t
                const shape = shapeText(font, 'f\u{200C}f\u{200C}t');
                // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables TestGSUB-ChainingLigatures-subset.otf -u 0066,200C,0066,200C,0074
                // [12=0+267|12=2+267|40=4+282]
                // (f f t.end; the fork gives f .notdef f .notdef t.end)
                assertShape(shape, {
                    glyphs: [12, 12, 40],
                    clusters: [0, 2, 4],
                    advances: [267, 267, 282],
                    ends: [2, 4, 5]
                });
            }
        );

        itFailsUntilFixed(
            'forms the f_f_t ligature across zero width joiners, which are not drawn',
            'Font.prototype._createBidi (src/font.mjs): a default ignorable character without a glyph in the cmap is mapped to .notdef and drawn, ' +
            'and applyLookup (src/features/latn/latinFeatures.mjs) does not skip it between the components of a ligature',
            function() {
                // f, U+200D (zero width joiner), f, U+200D, t
                const shape = shapeText(font, 'f\u{200D}f\u{200D}t');
                // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables TestGSUB-ChainingLigatures-subset.otf -u 0066,200D,0066,200D,0074
                // [13=0+783]
                // (f_f_t; the fork gives f .notdef f .notdef t.end)
                assertShape(shape, {
                    glyphs: [13],
                    clusters: [0],
                    advances: [783],
                    ends: [5]
                });
            }
        );

        itFailsUntilFixed(
            'skips a zero width non-joiner in the lookahead of a chaining rule: an a followed by it and a letter keeps its plain form',
            'Font.prototype._createBidi (src/font.mjs): a default ignorable character without a glyph in the cmap is mapped to .notdef and drawn, ' +
            'and applyLookup (src/features/latn/latinFeatures.mjs) keeps it in the context of the chaining rules: the lookahead of the first rule ' +
            'of lookup 5 sees .notdef instead of d, the second rule gives a its end form',
            function() {
                // a, U+200C (zero width non-joiner), d
                const shape = shapeText(font, 'a\u{200C}d');
                // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables TestGSUB-ChainingLigatures-subset.otf -u 0061,200C,0064
                // [5=0+526|11=2+534]
                // (a d.end, as without the joiner; the fork gives a.end .notdef d.end)
                assertShape(shape, {
                    glyphs: [5, 11],
                    clusters: [0, 2],
                    advances: [526, 534],
                    ends: [2, 3]
                });
            }
        );

        itFailsUntilFixed(
            'kerns the glyphs around a zero width non-joiner, which is not drawn',
            'Font.prototype._createBidi (src/font.mjs): a default ignorable character without a glyph in the cmap is mapped to .notdef and drawn, ' +
            '385 units wide, and forEachGlyph (src/font.mjs) looks up the pairs T .notdef and .notdef o.end instead of T o.end',
            function() {
                // T, U+200C (zero width non-joiner), o
                const shape = shapeText(font, 'T\u{200C}o');
                // hb-shape --no-glyph-names --cluster-level=1 --remove-default-ignorables TestGSUB-ChainingLigatures-subset.otf -u 0054,200C,006F
                // [3=0+511|36=2+481]
                // (T o.end, kerned by -161 like "To"; the fork gives T .notdef o.end, 672, 385 and 481 wide)
                assertShape(shape, {
                    glyphs: [3, 36],
                    clusters: [0, 2],
                    advances: [511, 481],
                    ends: [2, 3]
                });
            }
        );
    });

    describe('GPOS pair kerning after the substitutions', function() {
        // The advances of shapeText are the pen positions of forEachGlyph, the text layout behind getPath and
        // getAdvanceWidth. The pair values quoted in the comments are those of the two PairPos subtables in
        // python -m fontTools.ttx -q -t GPOS -o - TestGSUB-ChainingLigatures-subset.otf

        it('kerns T with the end forms, in pair positioning format 2 (T o.end) and format 1 (T y.end)', function() {
            // hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 0054,006F,0020,0054,0079
            // [3=0+511|36=1+481|38=2+215|3=3+529|50=4+482]
            // ("To Ty": T o.end space T y.end, T is 672 wide: -161 and -143)
            assertShape(shapeText(font, 'To Ty'), {
                glyphs: [3, 36, 38, 3, 50],
                clusters: [0, 1, 2, 3, 4],
                advances: [511, 481, 215, 529, 482]
            }, 'with kerning');
            // the sum of the advances of the line above
            assert.strictEqual(font.getAdvanceWidth('To Ty', font.unitsPerEm), 2218);

            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern TestGSUB-ChainingLigatures-subset.otf -u 0054,006F,0020,0054,0079
            // [3=0+672|36=1+481|38=2+215|3=3+672|50=4+482]
            assertShape(shapeText(font, 'To Ty', { kerning: false }), {
                glyphs: [3, 36, 38, 3, 50],
                clusters: [0, 1, 2, 3, 4],
                advances: [672, 481, 215, 672, 482]
            }, 'without kerning');
            // the sum of the advances of the line above
            assert.strictEqual(font.getAdvanceWidth('To Ty', font.unitsPerEm, { kerning: false }), 2522);
        });

        itFailsUntilFixed(
            'kerns with the default language system of the script when the font has none for the language (Turkish)',
            'Layout.prototype.getLangSysTable (src/layout.mjs): a language without a LangSysRecord in the script gives no language system ' +
            'instead of the default one, so getKerningTables (src/position.mjs) finds no kern feature and forEachGlyph (src/font.mjs) kerns nothing',
            function() {
                // the substitutions do not depend on the language: o.end and y.end are right
                const shape = shapeText(font, 'To Ty', { language: 'TRK ' });
                // hb-shape --no-glyph-names --cluster-level=1 --language=tr TestGSUB-ChainingLigatures-subset.otf -u 0054,006F,0020,0054,0079
                // [3=0+511|36=1+481|38=2+215|3=3+529|50=4+482]
                // (T o.end space T y.end, kerned as without a language; the fork gives the advances 672, 481, 215, 672 and 482)
                assertShape(shape, {
                    glyphs: [3, 36, 38, 3, 50],
                    clusters: [0, 1, 2, 3, 4],
                    advances: [511, 481, 215, 529, 482]
                });
            }
        );

        it('kerns the substituted glyphs, not the glyphs of the characters', function() {
            // hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 0054,0074,0020,0054,0066,0069,0020,006E,0054
            // [3=0+626|40=1+282|38=2+215|3=3+653|23=4+544|38=6+215|33=7+519|3=8+672]
            // ("Tt Tfi nT": T t.end space T fi.end space n.end T: T t.end is -46 where T t is -42,
            // T fi.end is -19 where T fi and T f are -6, n.end T has no pair where n T is -33)
            assertShape(shapeText(font, 'Tt Tfi nT'), {
                glyphs: [3, 40, 38, 3, 23, 38, 33, 3],
                clusters: [0, 1, 2, 3, 4, 6, 7, 8],
                advances: [626, 282, 215, 653, 544, 215, 519, 672]
            }, 'Tt Tfi nT');

            // a text with as many glyphs as characters, where the index of a glyph is the index of its character:
            // hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 0054,0074,0020,006E,0054
            // [3=0+626|40=1+282|38=2+215|33=3+519|3=4+672]
            // ("Tt nT": T t.end space n.end T)
            assertShape(shapeText(font, 'Tt nT'), {
                glyphs: [3, 40, 38, 33, 3],
                clusters: [0, 1, 2, 3, 4],
                advances: [626, 282, 215, 519, 672]
            }, 'Tt nT');

            // the first text with the plain glyphs and their own pairs:
            // hb-shape --no-glyph-names --cluster-level=1 --features=-liga TestGSUB-ChainingLigatures-subset.otf -u 0054,0074,0020,0054,0066,0069,0020,006E,0054
            // [3=0+630|39=1+267|38=2+215|3=3+666|12=4+267|24=5+267|38=6+215|32=7+472|3=8+672]
            // (T t space T f i space n T: T t is -42, T f is -6, n T is -33)
            assertShape(shapeText(font, 'Tt Tfi nT', { features: { liga: false } }), {
                glyphs: [3, 39, 38, 3, 12, 24, 38, 32, 3],
                clusters: [0, 1, 2, 3, 4, 5, 6, 7, 8],
                advances: [630, 267, 215, 666, 267, 267, 215, 472, 672]
            }, 'Tt Tfi nT without liga');
        });

        it('does not kern a first glyph outside the coverage of pair positioning format 2 with the values of class 0', function() {
            // In the format 2 subtable, class 0 of the first glyphs is A (in the coverage, in no class of ClassDef1):
            // A z is -19, A x and A x.end are -10. d.end and T_i are in no class either, but they are not in the
            // coverage: the subtable does not apply to them, they are not kerned like A.
            // hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 0041,007A,0020,0064,007A
            // [1=0+584|53=1+428|38=2+215|11=3+534|53=4+428]
            // ("Az dz": A z space d.end z, A is 603 wide and d.end 534)
            assertShape(shapeText(font, 'Az dz'), {
                glyphs: [1, 53, 38, 11, 53],
                clusters: [0, 1, 2, 3, 4],
                advances: [584, 428, 215, 534, 428]
            }, 'Az dz');

            // hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 0041,0078,0020,0054,0069,0078
            // [1=0+593|48=1+539|38=2+215|4=3+783|48=5+539]
            // ("Ax Tix": A x.end space T_i x.end, T_i is 783 wide)
            assertShape(shapeText(font, 'Ax Tix'), {
                glyphs: [1, 48, 38, 4, 48],
                clusters: [0, 1, 2, 3, 5],
                advances: [593, 539, 215, 783, 539]
            }, 'Ax Tix');
        });
    });

    describe('alternates of k and A (salt and aalt)', function() {
        it('applies the single substitution format 2 of salt after the liga lookups', function() {
            // hb-shape --no-glyph-names --cluster-level=1 --features=+salt TestGSUB-ChainingLigatures-subset.otf -u 006B,0041
            // [30=0+534|2=1+530]
            // ("kA": k.end A.salt: lookup 5 of liga takes k before lookup 6 of salt)
            assertShape(shapeText(font, 'kA', { features: { salt: true } }), {
                glyphs: [30, 2],
                clusters: [0, 1],
                advances: [534, 530]
            }, 'with liga');

            // hb-shape --no-glyph-names --cluster-level=1 --features=+salt,-liga TestGSUB-ChainingLigatures-subset.otf -u 006B,0041
            // [31=0+518|2=1+530]
            // (k.salt A.salt)
            assertShape(shapeText(font, 'kA', { features: { salt: true, liga: false } }), {
                glyphs: [31, 2],
                clusters: [0, 1],
                advances: [518, 530]
            }, 'without liga');
        });

        it('applies the single substitution format 1 of aalt before the liga lookups', function() {
            // hb-shape --no-glyph-names --cluster-level=1 --features=+aalt TestGSUB-ChainingLigatures-subset.otf -u 0041,0020,0061,0078
            // [2=0+530|38=1+215|6=2+535|48=3+539]
            // ("A ax": A.salt space a.end x.end: lookup 0 of aalt takes a and x before lookup 4 of liga can form a_x)
            assertShape(shapeText(font, 'A ax', { features: { aalt: true } }), {
                glyphs: [2, 38, 6, 48],
                clusters: [0, 1, 2, 3],
                advances: [530, 215, 535, 539]
            }, 'with aalt');

            // hb-shape --no-glyph-names --cluster-level=1 TestGSUB-ChainingLigatures-subset.otf -u 0041,0020,0061,0078
            // [1=0+603|38=1+215|8=2+913]
            // (A space a_x.end)
            assertShape(shapeText(font, 'A ax'), {
                glyphs: [1, 38, 8],
                clusters: [0, 1, 2],
                advances: [603, 215, 913]
            }, 'without aalt');
        });

        // Lookup 1 of aalt is an alternate substitution (GSUB type 3): k to k.end or k.salt, HarfBuzz takes the
        // first alternate. The fork skips the lookup with a warning: k stays k, or is left to a later lookup.
        const alternateSubstitutionReason = 'FeatureQuery.prototype.getLookupMethod (src/features/featureQuery.mjs): ' +
            'no alternate substitution (GSUB lookup type 3), the lookup is skipped with a warning';
        const alternateReferences = [
            {
                name: 'with liga turned off (kA)',
                text: 'kA',
                features: { aalt: true, liga: false },
                // hb-shape --no-glyph-names --cluster-level=1 --features=+aalt,-liga TestGSUB-ChainingLigatures-subset.otf -u 006B,0041
                // [30=0+534|2=1+530]
                // (k.end A.salt: A.salt comes from the single substitution of aalt, lookup 0)
                expected: { glyphs: [30, 2], clusters: [0, 1], advances: [534, 530] },
                forkResult: 'k stays k'
            },
            {
                name: 'inside a word, where liga leaves k plain (ka)',
                text: 'ka',
                features: { aalt: true },
                // hb-shape --no-glyph-names --cluster-level=1 --features=+aalt TestGSUB-ChainingLigatures-subset.otf -u 006B,0061
                // [30=0+534|6=1+535]
                // (k.end a.end)
                expected: { glyphs: [30, 6], clusters: [0, 1], advances: [534, 535] },
                forkResult: 'k stays k'
            },
            {
                name: 'before the single substitution of salt can take k (ka with aalt and salt)',
                text: 'ka',
                features: { aalt: true, salt: true },
                // hb-shape --no-glyph-names --cluster-level=1 --features=+aalt,+salt TestGSUB-ChainingLigatures-subset.otf -u 006B,0061
                // [30=0+534|6=1+535]
                // (k.end a.end: lookup 1 of aalt comes before lookup 6 of salt, which does not cover k.end)
                expected: { glyphs: [30, 6], clusters: [0, 1], advances: [534, 535] },
                forkResult: 'lookup 6 of salt turns k into k.salt'
            }
        ];

        it('shapes a text with k when aalt is turned on without throwing: the clusters and the glyphs after k are right', function() {
            for (const reference of alternateReferences) {
                const shape = shapeText(font, reference.text, { features: reference.features });
                assert.deepStrictEqual(shape.clusters, reference.expected.clusters, `${reference.name}: clusters`);
                assert.deepStrictEqual(shape.glyphs.slice(1), reference.expected.glyphs.slice(1), `${reference.name}: glyphs after k`);
                assert.deepStrictEqual(shape.advances.slice(1), reference.expected.advances.slice(1), `${reference.name}: advances after k`);
            }
        });

        for (const reference of alternateReferences) {
            itFailsUntilFixed(
                `substitutes k with its first alternate (alternate substitution, GSUB type 3) ${reference.name}`,
                `${alternateSubstitutionReason}, ${reference.forkResult}`,
                function() {
                    const shape = shapeText(font, reference.text, { features: reference.features });
                    assertShape(shape, reference.expected);
                }
            );
        }
    });
});
