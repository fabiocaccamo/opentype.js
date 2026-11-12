/**
 * Contextual alternates of a connected cursive font: upstream PR #848 ("calt" for the
 * Playwrite fonts) and issue #801 ("calt" not applied by forEachGlyph).
 *
 * Fixture: PlaywriteUSTrad-VF-calt-subset.ttf (Playwrite US Trad, variable, wght 100..400,
 * default 400, named instances 100, 200, 300 and 400, 46 glyphs). How it was built is in
 * test/fonts/regression/README.md.
 *
 * Mechanism, GSUB calt = lookups 7, 17, 21, 23:
 * - 7: multiple substitution (type 2), eacute becomes e.ful + acutecomb;
 * - 17: chaining context format 3 (type 6.3, lookupFlag IgnoreMarks) with nested single
 *   substitutions (lookups 18, 19, 20, formats 2, 2, 1) that pick the med, fin and ini forms;
 * - 21: the same type with the nested single substitution 22 (format 2) that picks the _n_
 *   variants of the medial m and n and of the final m after a joined letter;
 * - 23: chaining context format 3 (IgnoreMarks) with nested multiple substitutions that
 *   turn each joined letter into letter + connector (cnct.*, zero width, GDEF class mark).
 * GPOS: dist = lookups 0, 1 (pair adjustment format 2, IgnoreMarks, no device: the space
 * between joined letters), kern = lookup 3 for DFLT, lookups 2 and 3 for latn (listed 3, 2
 * in the feature, applied 2 then 3, the order of the LookupList; pair adjustment formats 1
 * and 2, IgnoreMarks, with VariationIndex devices), mark and mkmk (connectors and accents).
 * The offsets of the marks (the @x,y of the hb-shape outputs) are not asserted here: the mark
 * attachment that the fork does not apply is a known failure of robotoGsubChaining.spec.mjs.
 *
 * The reference values are the output of hb-shape (HarfBuzz 11.3.2) on the fixture, run
 * from test/fonts/regression/: each command and its output are quoted above the expected
 * value. The font has no language system, the outputs do not depend on the locale.
 */

import assert from 'assert';
import { loadFont, shapeText, getGlyphOrigins, assertShape, itFailsUntilFixed } from './helpers.mjs';

const fixture = 'PlaywriteUSTrad-VF-calt-subset.ttf';

// 400 is the default instance; 300, 200 and 100 are the other named instances, 250 is between two of them
const weights = [400, 300, 250, 200, 100];

// glyphs of GDEF class 3 (mark), read with fontTools (GDEF.GlyphClassDef): acutecomb (8) and
// the connectors cnct.mod_n_o (17), cnct.mod_n_n (18), cnct.ful_e_f (25), cnct.ful_n_e (26),
// cnct.ful_n_f (27), cnct.lop_b_h (33), cnct.cnt_n_n (43), cnct.cnt_o_n (44)
const accentGlyphIndex = 8;
const connectorGlyphIndexes = [17, 18, 25, 26, 27, 33, 43, 44];
const markGlyphIndexes = [accentGlyphIndex, ...connectorGlyphIndexes];

// h.lop.ini cnct.ful_n_e e.ful.med cnct.ful_e_f l.lop.med cnct.ful_n_f l.lop.med cnct.mod_n_o o.mod.fin
// neither dist nor kern acts on this text
// hb-shape --no-glyph-names --cluster-level=1 PlaywriteUSTrad-VF-calt-subset.ttf -u 0068,0065,006C,006C,006F
// [29=0+676|26=0+0|21=1+444|25=1+0|32=2+394|27=2+0|32=3+394|17=3+0|13=4+601]
// hb-shape --no-glyph-names --cluster-level=1 --features=-dist,-kern PlaywriteUSTrad-VF-calt-subset.ttf -u 0068,0065,006C,006C,006F
// [29=0+676|26=0+0|21=1+444|25=1+0|32=2+394|27=2+0|32=3+394|17=3+0|13=4+601]
const helloShape = {
    text: 'hello',
    glyphs: [29, 26, 21, 25, 32, 27, 32, 17, 13],
    clusters: [0, 0, 1, 1, 2, 2, 3, 3, 4],
    advances: [676, 0, 444, 0, 394, 0, 394, 0, 601]
};
const helloShapesByWeight = {
    400: helloShape,
    // the same line: GSUB has no FeatureVariations, and the advances of these glyphs do not vary
    // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=100 PlaywriteUSTrad-VF-calt-subset.ttf -u 0068,0065,006C,006C,006F
    // [29=0+676|26=0+0|21=1+444|25=1+0|32=2+394|27=2+0|32=3+394|17=3+0|13=4+601]
    100: helloShape
};

// the advances of i.mod.med (10) and u.mod.med (15) are 325 and 671 without dist
// hb-shape --no-glyph-names --cluster-level=1 PlaywriteUSTrad-VF-calt-subset.ttf -u 006D,0069,006E,0069,006D,0075,006D
// [35=0+989|18=0+0|10=1+425|43=1@-100,0+0|42=2+671|18=2+0|10=3+425|43=3@-100,0+0|38=4+989|18=4+0|15=5+771|43=5@-101,0+0|39=6+989]
// hb-shape --no-glyph-names --cluster-level=1 --features=-dist PlaywriteUSTrad-VF-calt-subset.ttf -u 006D,0069,006E,0069,006D,0075,006D
// [35=0+989|18=0+0|10=1+325|43=1+0|42=2+671|18=2+0|10=3+325|43=3+0|38=4+989|18=4+0|15=5+671|43=5@-1,0+0|39=6+989]
const minimumShape = {
    text: 'minimum',
    glyphs: [35, 18, 10, 43, 42, 18, 10, 43, 38, 18, 15, 43, 39],
    clusters: [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6],
    advances: [989, 0, 425, 0, 671, 0, 425, 0, 989, 0, 771, 0, 989]
};
const minimumShapesByWeight = {
    400: minimumShape,
    // the same line: the pairs of dist have no device, and the advances of these glyphs do not vary
    // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=100 PlaywriteUSTrad-VF-calt-subset.ttf -u 006D,0069,006E,0069,006D,0075,006D
    // [35=0+989|18=0+0|10=1+425|43=1@-100,0+0|42=2+671|18=2+0|10=3+425|43=3@-100,0+0|38=4+989|18=4+0|15=5+771|43=5@-101,0+0|39=6+989]
    100: minimumShape
};

// the advance of P.dec (45) is 855 without its kerning with h.lop.ini (29), -10
// hb-shape --no-glyph-names --cluster-level=1 PlaywriteUSTrad-VF-calt-subset.ttf -u 0050,0068,006F,006E,0065
// [45=0+845|29=1+676|17=1+0|12=2+601|44=2@1,0+0|41=3+671|26=3+0|22=4+444]
// hb-shape --no-glyph-names --cluster-level=1 --features=-kern PlaywriteUSTrad-VF-calt-subset.ttf -u 0050,0068,006F,006E,0065
// [45=0+855|29=1+676|17=1+0|12=2+601|44=2@1,0+0|41=3+671|26=3+0|22=4+444]
const phoneShape = {
    text: 'Phone',
    glyphs: [45, 29, 17, 12, 44, 41, 26, 22],
    clusters: [0, 1, 1, 2, 2, 3, 3, 4],
    advances: [845, 676, 0, 601, 0, 671, 0, 444]
};
const phoneShapesByWeight = {
    400: phoneShape,
    // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=300 PlaywriteUSTrad-VF-calt-subset.ttf -u 0050,0068,006F,006E,0065
    // [45=0+843|29=1+676|17=1+0|12=2+601|44=2@1,0+0|41=3+671|26=3+0|22=4+444]
    300: { ...phoneShape, advances: [843, 676, 0, 601, 0, 671, 0, 444] },
    // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=200 PlaywriteUSTrad-VF-calt-subset.ttf -u 0050,0068,006F,006E,0065
    // [45=0+841|29=1+676|17=1+0|12=2+601|44=2@1,0+0|41=3+671|26=3+0|22=4+444]
    200: { ...phoneShape, advances: [841, 676, 0, 601, 0, 671, 0, 444] },
    // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=100 PlaywriteUSTrad-VF-calt-subset.ttf -u 0050,0068,006F,006E,0065
    // [45=0+839|29=1+676|17=1+0|12=2+601|44=2@1,0+0|41=3+671|26=3+0|22=4+444]
    100: { ...phoneShape, advances: [839, 676, 0, 601, 0, 671, 0, 444] }
};

// w.ful.ini cnct.lop_b_h h.lop.med cnct.mod_n_o o.mod.fin
// hb-shape --no-glyph-names --cluster-level=1 PlaywriteUSTrad-VF-calt-subset.ttf -u 0077,0068,006F
// [24=0+880|33=0@-26,0+0|30=1+676|17=1+0|13=2+601]
const whoShape = {
    text: 'who',
    glyphs: [24, 33, 30, 17, 13],
    clusters: [0, 0, 1, 1, 2],
    advances: [880, 0, 676, 0, 601]
};
const whoShapesByWeight = {
    400: whoShape,
    // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=100 PlaywriteUSTrad-VF-calt-subset.ttf -u 0077,0068,006F
    // [24=0+888|33=0@-26,0+0|30=1+676|17=1+0|13=2+601]
    100: { ...whoShape, advances: [888, 0, 676, 0, 601] }
};

// e with acute (U+00E9), l, u: e.ful.ini cnct.ful_e_f acutecomb l.lop.med cnct.mod_n_n u.mod.fin
// hb-shape --no-glyph-names --cluster-level=1 PlaywriteUSTrad-VF-calt-subset.ttf -u 00E9,006C,0075
// [20=0+444|25=0+0|8=0@-267,0+0|32=1+394|18=1+0|16=2+671]
const accentedShape = {
    text: '\u{E9}lu',
    glyphs: [20, 25, 8, 32, 18, 16],
    clusters: [0, 0, 0, 1, 1, 2],
    advances: [444, 0, 0, 394, 0, 671]
};

// a shape without the given glyphs: the other glyphs with their clusters and advances
function withoutGlyphs(shape, glyphIndexes) {
    const kept = { glyphs: [], clusters: [], advances: [] };
    for (let i = 0; i < shape.glyphs.length; i++) {
        if (!glyphIndexes.includes(shape.glyphs[i])) {
            kept.glyphs.push(shape.glyphs[i]);
            kept.clusters.push(shape.clusters[i]);
            kept.advances.push(shape.advances[i]);
        }
    }
    return kept;
}

function getGlyphsAndClusters(shape) {
    return { glyphs: shape.glyphs, clusters: shape.clusters };
}

function getGlyphsClustersAndAdvances(shape) {
    return { glyphs: shape.glyphs, clusters: shape.clusters, advances: shape.advances };
}

// the glyphs of a shape that are not GDEF marks (the letters), with their clusters
function getLetters(shape) {
    return getGlyphsAndClusters(withoutGlyphs(shape, markGlyphIndexes));
}

// the letters of a line of hb-shape where the pen draws them: the [glyph, x, y] of each glyph that is
// not a GDEF mark (x is the sum of the advances before it, a letter has no offset) and the end of the text
function getLetterOrigins(shape) {
    const letters = [];
    let penX = 0;
    for (let i = 0; i < shape.glyphs.length; i++) {
        if (!markGlyphIndexes.includes(shape.glyphs[i])) {
            letters.push([shape.glyphs[i], penX, 0]);
        }
        penX += shape.advances[i];
    }
    return { letters, end: penX };
}

// the same value for a text laid out by forEachGlyph
function layOutLetters(font, text, options) {
    const { origins, end } = getGlyphOrigins(font, text, options);
    return { letters: origins.filter(origin => !markGlyphIndexes.includes(origin[0])), end };
}

describe('regression: contextual alternates of a connected cursive, Playwrite US Trad (#848, #801)', function() {
    let fonts;

    beforeEach(function() {
        fonts = {};
        for (const weight of weights) {
            fonts[weight] = weight === 400 ? loadFont(fixture) : loadFont(fixture, { wght: weight });
        }
    });

    describe('positional forms (chaining context format 3 with nested single substitutions)', function() {
        it('keeps the isolated forms when calt is off', function() {
            // baseline, no lookup acts on this text: it proves that { calt: false } turns calt off
            // h.lop e.ful l.lop l.lop o.mod
            // hb-shape --no-glyph-names --cluster-level=1 --features=-calt PlaywriteUSTrad-VF-calt-subset.ttf -u 0068,0065,006C,006C,006F
            // [28=0+676|19=1+444|31=2+394|31=3+394|11=4+588]
            assertShape(shapeText(fonts[400], 'hello', { features: { calt: false } }), {
                glyphs: [28, 19, 31, 31, 11],
                clusters: [0, 1, 2, 3, 4],
                advances: [676, 444, 394, 394, 588]
            }, 'hello');
        });

        it('picks the initial, medial and final letters of HarfBuzz', function() {
            // the hb-shape outputs quoted above, without the glyphs of GDEF class mark. When lookup 17 runs,
            // the accent of the multiple substitution is still in the token of e and the context is matched
            // on the first glyph of each token: the initial e of accentedShape does not depend on the
            // IgnoreMarks flag (a mark typed in the text is the known failure of the combining mark)
            for (const reference of [helloShape, minimumShape, phoneShape, whoShape, accentedShape]) {
                assert.deepStrictEqual(getLetters(shapeText(fonts[400], reference.text)), getLetters(reference), reference.text);
            }
        });

        it('draws the letters at the pen positions of HarfBuzz with the forEachGlyph options of #801', function() {
            // options.script also selects the kern lookups of latn, where the pair P.dec h.lop.ini is
            const options = { script: 'latn', kerning: true, features: { calt: true, liga: true, rlig: true } };
            for (const weight of [400, 300, 200, 100]) {
                assert.deepStrictEqual(
                    layOutLetters(fonts[weight], phoneShape.text, options),
                    getLetterOrigins(phoneShapesByWeight[weight]),
                    `Phone, wght ${weight}`
                );
            }
        });
    });

    describe('connectors (chaining context format 3 with nested multiple substitutions)', function() {
        const reason = 'chainingSubstitutionFormat3 (src/features/applySubstitution.mjs): keeps only the first glyph of a nested multiple substitution';

        // the whole shape: the advances of hello only need the connectors
        itFailsUntilFixed('adds a connector after each joined letter of hello, in the cluster of the letter, at each instance', reason, function() {
            const shapesByWeight = {};
            const referencesByWeight = {};
            for (const weight of [400, 100]) {
                shapesByWeight[weight] = getGlyphsClustersAndAdvances(shapeText(fonts[weight], helloShape.text));
                referencesByWeight[weight] = getGlyphsClustersAndAdvances(helloShapesByWeight[weight]);
            }
            assert.deepStrictEqual(shapesByWeight, referencesByWeight);
        });

        // glyphs and clusters only: the advances of these texts also need dist or the kerning of latn
        itFailsUntilFixed('adds the connectors of minimum, Phone and who', reason, function() {
            const shapesByText = {};
            const referencesByText = {};
            for (const reference of [minimumShape, phoneShape, whoShape]) {
                shapesByText[reference.text] = getGlyphsAndClusters(shapeText(fonts[400], reference.text));
                referencesByText[reference.text] = getGlyphsAndClusters(reference);
            }
            assert.deepStrictEqual(shapesByText, referencesByText);
        });
    });

    describe('accented letters (multiple substitution before the contextual lookups)', function() {
        it('keeps the precomposed letter when calt is off', function() {
            // e with acute (U+00E9), l, u: eacute l.lop u.mod
            // hb-shape --no-glyph-names --cluster-level=1 --features=-calt PlaywriteUSTrad-VF-calt-subset.ttf -u 00E9,006C,0075
            // [7=0+526|31=1+394|14=2+646]
            assertShape(shapeText(fonts[400], accentedShape.text, { features: { calt: false } }), {
                glyphs: [7, 31, 14],
                clusters: [0, 1, 2],
                advances: [526, 394, 646]
            }, 'e acute, l, u');
        });

        it('decomposes a precomposed letter alone into the letter and its accent, in one cluster', function() {
            // baseline of the known failure below: the multiple substitution itself keeps the accent
            // e with acute (U+00E9): e.ful acutecomb
            // hb-shape --no-glyph-names --cluster-level=1 PlaywriteUSTrad-VF-calt-subset.ttf -u 00E9
            // [19=0+444|8=0@-267,0+0]
            assertShape(shapeText(fonts[400], '\u{E9}'), {
                glyphs: [19, 8],
                clusters: [0, 0],
                advances: [444, 0]
            }, 'e acute');
        });

        itFailsUntilFixed(
            'keeps the accent of a letter decomposed by calt when the letter takes a positional form',
            'chainingSubstitutionFormat3 (src/features/applySubstitution.mjs): a nested substitution replaces the whole token that holds ' +
            'the two glyphs of the multiple substitution, the accent is lost: by the nested single substitution of lookup 17 (the ' +
            'positional form) and again by the first glyph of the nested multiple substitution of lookup 23 (the connector)',
            function() {
                // accentedShape without its connectors (e.ful.ini acutecomb l.lop.med u.mod.fin), so that
                // the missing connectors, the known failures above, are not what fails here
                const shape = withoutGlyphs(shapeText(fonts[400], accentedShape.text), connectorGlyphIndexes);
                assertShape(shape, withoutGlyphs(accentedShape, connectorGlyphIndexes), 'e acute, l, u');
            }
        );

        itFailsUntilFixed(
            'puts the connector of a decomposed letter between the letter and its accent, all three in its cluster',
            'chainingSubstitutionFormat3 (src/features/applySubstitution.mjs): keeps only the first glyph of a nested multiple ' +
            'substitution, the connectors are dropped, and a nested substitution replaces the whole token that holds e.ful and ' +
            'acutecomb, the accent is lost (lookups 17 and 23)',
            function() {
                // the whole accentedShape, in the order of HarfBuzz: e.ful.ini cnct.ful_e_f acutecomb
                const shape = shapeText(fonts[400], accentedShape.text);
                assertShape(shape, accentedShape, 'e acute, l, u');
            }
        );
    });

    describe('combining mark in the text (lookupFlag IgnoreMarks, clusters, composition)', function() {
        it('keeps a combining mark in a cluster of its own', function() {
            // h, combining acute accent (U+0301), e: h.lop acutecomb e.ful
            // hb-shape --no-glyph-names --cluster-level=1 --features=-calt PlaywriteUSTrad-VF-calt-subset.ttf -u 0068,0301,0065
            // [28=0+676|8=1@-297,455+0|19=2+444]
            assertShape(shapeText(fonts[400], 'h\u{301}e', { features: { calt: false } }), {
                glyphs: [28, 8, 19],
                clusters: [0, 1, 2],
                advances: [676, 0, 444]
            }, 'h, combining acute, e');
        });

        itFailsUntilFixed(
            'joins the letters around a combining mark',
            'chainingSubstitutionFormat3 (src/features/featureQuery.mjs): matches the context on the glyphs next to each other, the ' +
            'lookupFlag is not read and the marks of a lookup with IgnoreMarks are not skipped: the letters stay isolated',
            function() {
                // h, combining acute accent (U+0301), e: h.lop.ini cnct.ful_n_e acutecomb e.ful.fin
                // hb-shape --no-glyph-names --cluster-level=1 PlaywriteUSTrad-VF-calt-subset.ttf -u 0068,0301,0065
                // [29=0+676|26=0+0|8=1@-297,455+0|22=2+444]
                // the letters only (h.lop.ini and e.ful.fin, clusters 0 and 2): the connector is a known failure above
                const reference = { glyphs: [29, 26, 8, 22], clusters: [0, 0, 1, 2], advances: [676, 0, 0, 444] };
                const letters = getLetters(shapeText(fonts[400], 'h\u{301}e'));
                assert.deepStrictEqual(letters, getLetters(reference));
            }
        );

        itFailsUntilFixed(
            'composes a letter and a combining mark into the precomposed glyph of the font',
            '_createBidi (src/font.mjs): maps each character of the text to its glyph without composing a letter and its combining ' +
            'mark first, e.ful and acutecomb instead of eacute',
            function() {
                // e, combining acute accent (U+0301): eacute
                // hb-shape --no-glyph-names --cluster-level=1 --features=-calt PlaywriteUSTrad-VF-calt-subset.ttf -u 0065,0301
                // [7=0+526]
                const shape = shapeText(fonts[400], 'e\u{301}', { features: { calt: false } });
                assertShape(shape, { glyphs: [7], clusters: [0], advances: [526] }, 'e, combining acute');
            }
        );

        itFailsUntilFixed(
            'decomposes and joins a composed letter with calt, its accent in the cluster of the two characters',
            '_createBidi (src/font.mjs): does not compose e and U+0301 into eacute, acutecomb stays in a cluster of its own and, as ' +
            'the IgnoreMarks flag of lookup 17 is not read (src/features/featureQuery.mjs), keeps e, l and u from joining; the ' +
            'composed letter then loses its accent like the precomposed one (chainingSubstitutionFormat3, src/features/applySubstitution.mjs)',
            function() {
                // e, combining acute accent (U+0301), l, u: e.ful.ini cnct.ful_e_f acutecomb l.lop.med cnct.mod_n_n u.mod.fin,
                // composed into eacute and decomposed again by lookup 7: l is in cluster 2
                // hb-shape --no-glyph-names --cluster-level=1 PlaywriteUSTrad-VF-calt-subset.ttf -u 0065,0301,006C,0075
                // [20=0+444|25=0+0|8=0@-267,0+0|32=2+394|18=2+0|16=3+671]
                // without the connectors, the known failures of the connectors
                const reference = { glyphs: [20, 25, 8, 32, 18, 16], clusters: [0, 0, 0, 2, 2, 3], advances: [444, 0, 0, 394, 0, 671] };
                const shape = withoutGlyphs(shapeText(fonts[400], 'e\u{301}lu'), connectorGlyphIndexes);
                assertShape(shape, withoutGlyphs(reference, connectorGlyphIndexes), 'e, combining acute, l, u');
            }
        );
    });

    describe('space between joined letters (GPOS dist, pair adjustment across the connectors)', function() {
        it('gives w.ful and w.ful.ini, the glyph that dist widens, their advance at each instance (HVAR)', function() {
            const expected = [
                // hb-shape --no-glyph-names --cluster-level=1 PlaywriteUSTrad-VF-calt-subset.ttf -u 0077
                // [23=0+855]
                // hb-shape --no-glyph-names --cluster-level=1 --features=-dist PlaywriteUSTrad-VF-calt-subset.ttf -u 0077,0068,006F
                // [24=0+855|33=0@-1,0+0|30=1+676|17=1+0|13=2+601]
                { weight: 400, advance: 855 },
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=250 PlaywriteUSTrad-VF-calt-subset.ttf -u 0077
                // [23=0+859]
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=250 --features=-dist PlaywriteUSTrad-VF-calt-subset.ttf -u 0077,0068,006F
                // [24=0+859|33=0@-1,0+0|30=1+676|17=1+0|13=2+601]
                { weight: 250, advance: 859 },
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=100 PlaywriteUSTrad-VF-calt-subset.ttf -u 0077
                // [23=0+863]
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=100 --features=-dist PlaywriteUSTrad-VF-calt-subset.ttf -u 0077,0068,006F
                // [24=0+863|33=0@-1,0+0|30=1+676|17=1+0|13=2+601]
                { weight: 100, advance: 863 }
            ];
            for (const { weight, advance } of expected) {
                const font = fonts[weight];
                assertShape(shapeText(font, 'w'), { glyphs: [23], clusters: [0], advances: [advance] }, `w, wght ${weight}`);
                assert.strictEqual(font.glyphs.get(24).getAdvanceWidth(font), advance, `w.ful.ini, wght ${weight}`);
            }
        });

        // the letters where the pen draws them, with or without the connectors between them: a pair of
        // dist is a letter and the next letter, across the connector (IgnoreMarks)
        const references = [
            { name: 'minimum', shape: minimumShape, weight: 400 },
            { name: 'minimum at wght 100', shape: minimumShapesByWeight[100], weight: 100 },
            { name: 'who', shape: whoShape, weight: 400 },
            { name: 'who at wght 100', shape: whoShapesByWeight[100], weight: 100 }
        ];
        for (const reference of references) {
            itFailsUntilFixed(
                `widens the advance of a letter before the next joined letter, ${reference.name}`,
                'forEachGlyph (src/font.mjs): adds only the pairs of the kern feature (getKerningTables, src/position.mjs), the pairs of ' +
                'dist are never applied; once the connectors are there, each pair is also across a GDEF mark (lookupFlag IgnoreMarks)',
                function() {
                    const letters = layOutLetters(fonts[reference.weight], reference.shape.text);
                    assert.deepStrictEqual(letters, getLetterOrigins(reference.shape));
                }
            );
        }
    });

    describe('kerning (GPOS pair adjustment, kern feature of DFLT and of latn)', function() {
        it('applies a pair of the lookup shared by DFLT and latn, with its variation delta', function() {
            // seven period, pair adjustment format 1 of lookup 3: the kerning is the difference with the advance
            // of seven without kern, 613 at every instance, so it comes from the device of the pair and not from HVAR
            const expected = [
                // hb-shape --no-glyph-names --cluster-level=1 PlaywriteUSTrad-VF-calt-subset.ttf -u 0037,002E
                // [5=0+525|6=1+313]
                // hb-shape --no-glyph-names --cluster-level=1 --features=-kern PlaywriteUSTrad-VF-calt-subset.ttf -u 0037,002E
                // [5=0+613|6=1+313]
                { weight: 400, advances: [525, 313], kerning: -88 },
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=250 PlaywriteUSTrad-VF-calt-subset.ttf -u 0037,002E
                // [5=0+531|6=1+313]
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=250 --features=-kern PlaywriteUSTrad-VF-calt-subset.ttf -u 0037,002E
                // [5=0+613|6=1+313]
                { weight: 250, advances: [531, 313], kerning: -82 },
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=100 PlaywriteUSTrad-VF-calt-subset.ttf -u 0037,002E
                // [5=0+537|6=1+313]
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=100 --features=-kern PlaywriteUSTrad-VF-calt-subset.ttf -u 0037,002E
                // [5=0+613|6=1+313]
                { weight: 100, advances: [537, 313], kerning: -76 }
            ];
            for (const { weight, advances, kerning } of expected) {
                const font = fonts[weight];
                assertShape(shapeText(font, '7.'), { glyphs: [5, 6], clusters: [0, 1], advances }, `7., wght ${weight}`);
                assertShape(shapeText(font, '7.', { kerning: false }), {
                    glyphs: [5, 6],
                    clusters: [0, 1],
                    advances: [613, 313]
                }, `7. without kerning, wght ${weight}`);
                assert.strictEqual(font.getKerningValue(5, 6), kerning, `getKerningValue of seven and period, wght ${weight}`);
            }
        });

        it('applies the pairs of the lookup that only latn has when the script is given', function() {
            const expected = [
                // e.ful period, pair adjustment format 1 of lookup 2 with a device
                // hb-shape --no-glyph-names --cluster-level=1 PlaywriteUSTrad-VF-calt-subset.ttf -u 0065,002E
                // [19=0+484|6=1+313]
                { text: 'e.', weight: 400, glyphs: [19, 6], advances: [484, 313] },
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=100 PlaywriteUSTrad-VF-calt-subset.ttf -u 0065,002E
                // [19=0+472|6=1+313]
                { text: 'e.', weight: 100, glyphs: [19, 6], advances: [472, 313] },
                // P.dec period, class pair of lookup 2 without a device
                // hb-shape --no-glyph-names --cluster-level=1 PlaywriteUSTrad-VF-calt-subset.ttf -u 0050,002E
                // [45=0+735|6=1+313]
                { text: 'P.', weight: 400, glyphs: [45, 6], advances: [735, 313] },
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=100 PlaywriteUSTrad-VF-calt-subset.ttf -u 0050,002E
                // [45=0+735|6=1+313]
                { text: 'P.', weight: 100, glyphs: [45, 6], advances: [735, 313] }
            ];
            for (const { text, weight, glyphs, advances } of expected) {
                const shape = shapeText(fonts[weight], text, { script: 'latn' });
                assertShape(shape, { glyphs, clusters: [0, 1], advances }, `${text}, wght ${weight}`);
            }
        });

        // the pair P.dec h.lop.ini of Phone is in lookup 2, a kern lookup of latn and not of DFLT. HarfBuzz
        // takes the script of the text, the fork takes latn in two places, each one on its own: the text
        // layout (forEachGlyph, behind getPath, draw and getAdvanceWidth) and Font.getKerningValue
        for (const weight of [400, 100]) {
            it(`applies a pair of the kern lookup that only latn has to a text laid out without options.script, wght ${weight}`, function() {
                const letters = layOutLetters(fonts[weight], phoneShape.text);
                assert.deepStrictEqual(letters, getLetterOrigins(phoneShapesByWeight[weight]));
            });
        }

        itFailsUntilFixed(
            'kerns a letter and the next letter across the accent that calt adds, at each instance',
            'forEachGlyph (src/font.mjs): kerns each glyph with the glyph right after it without reading the lookupFlag of the kern ' +
            'lookups, e.ful with acutecomb (0 in getKerningValue, src/position.mjs): the pair e.ful period of lookup 2 (IgnoreMarks) ' +
            'is never looked up',
            function() {
                // e with acute (U+00E9), period: e.ful acutecomb period, the pair e.ful period of lookup 2 (see 'e.' above)
                // hb-shape --no-glyph-names --cluster-level=1 PlaywriteUSTrad-VF-calt-subset.ttf -u 00E9,002E
                // [19=0+484|8=0@-307,0+0|6=1+313]
                // hb-shape --no-glyph-names --cluster-level=1 --features=-kern PlaywriteUSTrad-VF-calt-subset.ttf -u 00E9,002E
                // [19=0+444|8=0@-267,0+0|6=1+313]
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=100 PlaywriteUSTrad-VF-calt-subset.ttf -u 00E9,002E
                // [19=0+472|8=0@-289,0+0|6=1+313]
                // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=100 --features=-kern PlaywriteUSTrad-VF-calt-subset.ttf -u 00E9,002E
                // [19=0+444|8=0@-261,0+0|6=1+313]
                const shapesByWeight = {};
                for (const weight of [400, 100]) {
                    shapesByWeight[weight] = getGlyphsClustersAndAdvances(shapeText(fonts[weight], '\u{E9}.', { script: 'latn' }));
                }
                assert.deepStrictEqual(shapesByWeight, {
                    400: { glyphs: [19, 8, 6], clusters: [0, 0, 1], advances: [484, 0, 313] },
                    100: { glyphs: [19, 8, 6], clusters: [0, 0, 1], advances: [472, 0, 313] }
                });
            }
        );

        it('gives Font.getKerningValue a pair of the kern lookup that only latn has', function() {
            // P.dec (45) and h.lop.ini (29): 845 - 855, the two outputs quoted above phoneShape
            const kerning = fonts[400].getKerningValue(45, 29);
            assert.strictEqual(kerning, -10);
        });

        it('applies the -60 of lookup 2 to period P although lookup 3, listed first in the feature, covers period with no value', function() {
            // period P.dec, kerning -60: a class pair of lookup 2. Lookup 3, listed first in the feature, has a class
            // subtable that covers period, with no value for this pair: a guard of the old stop at the first lookup that
            // covers the pair, in the order of the feature. options.script selects the kern lookups of latn, so that the
            // script chosen without the option is not involved. The values of the lookups add up, so this pair cannot
            // tell the order of the lookups: position.spec.mjs tests it ('lists the lookups in LookupList order...')
            // hb-shape --no-glyph-names --cluster-level=1 PlaywriteUSTrad-VF-calt-subset.ttf -u 002E,0050
            // [6=0+253|45=1+855]
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern PlaywriteUSTrad-VF-calt-subset.ttf -u 002E,0050
            // [6=0+313|45=1+855]
            const shape = shapeText(fonts[400], '.P', { script: 'latn' });
            assertShape(shape, { glyphs: [6, 45], clusters: [0, 1], advances: [253, 855] }, 'period, P');
        });
    });
});
