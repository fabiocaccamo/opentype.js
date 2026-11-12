import assert from 'assert';
import { Font, Glyph, Path, parse } from '../src/opentype.mjs';
import { Parser } from '../src/parse.mjs';
import { unhex } from './testutil.mjs';
import { glyphIndexes, createLookupFlagsFont, createLayoutTable } from './lookup-flags-font.mjs';
import { itFailsUntilFixed } from './regression/helpers.mjs';
import { readFileSync } from 'fs';
const loadSync = (url, opt) => parse(readFileSync(url), opt);

/**
 * Latin features applied like HarfBuzz: the default features of browsers, their lookups
 * in lookup list order, on the whole text that is not arabic or thai.
 *
 * Glyphs:
 *   0: .notdef, 1: a, 2: b, 3: c, 4: hyphen, 5: greater (mapped to "a", "b", "c", "-", ">")
 *   6: a.alt, 7: b.alt, 8: a_b, 9: arrow, 10: c.alt
 */
const glyphNames = ['.notdef', 'a', 'b', 'c', 'hyphen', 'greater', 'a.alt', 'b.alt', 'a_b', 'arrow', 'c.alt'];
const characters = [null, 'a', 'b', 'c', '-', '>'];

function single(from, to) {
    return { lookupType: 1, lookupFlag: 0, subtables: [{ substFormat: 2, coverage: { format: 1, glyphs: [from] }, substitute: [to] }] };
}

function ligature(first, components, ligGlyph) {
    return { lookupType: 4, lookupFlag: 0, subtables: [{ substFormat: 1, coverage: { format: 1, glyphs: [first] }, ligatureSets: [[{ ligGlyph, components }]] }] };
}

// chaining context format 1: input glyphs with a lookahead, the nested lookup applied to the first glyph
function chainingFormat1(input, lookahead, lookupListIndex) {
    return {
        lookupType: 6,
        lookupFlag: 0,
        subtables: [{
            substFormat: 1,
            coverage: { format: 1, glyphs: [input[0]] },
            chainRuleSets: [[{ backtrack: [], input: input.slice(1), lookahead, lookupRecords: [{ sequenceIndex: 0, lookupListIndex }] }]]
        }]
    };
}

function createFont(features, lookups) {
    const glyphs = glyphNames.map((name, index) => {
        const unicodes = characters[index] ? [characters[index].codePointAt(0)] : [];
        return new Glyph({ index, name, unicode: unicodes[0], unicodes, advanceWidth: 500, path: new Path() });
    });
    const font = new Font({ familyName: 'LatinFeatures', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
    font.tables.gsub = {
        version: 1,
        scripts: [{
            tag: 'latn',
            script: { defaultLangSys: { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: features.map((feature, index) => index) }, langSysRecords: [] }
        }],
        features: features.map(([tag, lookupListIndexes]) => ({ tag, feature: { featureParams: 0, lookupListIndexes } })),
        lookups
    };
    return font;
}

const shape = (font, text, options) => font.stringToGlyphs(text, options).map(glyph => glyph.name);

describe('latin features', function() {
    it('applies the default features of browsers, including calt', function() {
        // calt: a followed by b becomes a.alt
        const font = createFont([['calt', [1]]], [single(1, 6), chainingFormat1([1], [2], 0)]);
        assert.deepEqual(shape(font, 'abab'), ['a.alt', 'b', 'a.alt', 'b']);
        assert.deepEqual(shape(font, 'ac'), ['a', 'c']);
    });

    it('applies the lookups in lookup list order, not feature by feature', function() {
        // liga (lookup 2) forms a_b, calt (lookup 1, applied before) turns a into a.alt first
        const font = createFont([['liga', [2]], ['calt', [1]]], [single(1, 6), chainingFormat1([1], [2], 0), ligature(1, [2], 8)]);
        assert.deepEqual(shape(font, 'ab'), ['a.alt', 'b']);
        // the same lookups in the other order: the ligature wins
        const ligatureFirst = createFont([['liga', [1]], ['calt', [2]]], [single(1, 6), ligature(1, [2], 8), chainingFormat1([1], [2], 0)]);
        assert.deepEqual(shape(ligatureFirst, 'ab'), ['a_b']);
    });

    it('applies the features to punctuation and across words', function() {
        // calt code ligature: - > becomes arrow
        const font = createFont([['calt', [0]]], [ligature(4, [5], 9)]);
        assert.deepEqual(shape(font, 'a->b c->'), ['a', 'arrow', 'b', '.notdef', 'c', 'arrow']);
    });

    it('enables and disables features through the features option', function() {
        const font = createFont([['liga', [0]], ['ss01', [1]]], [ligature(1, [2], 8), single(3, 10)]);
        assert.deepEqual(shape(font, 'abc'), ['a_b', 'c']);
        assert.deepEqual(shape(font, 'abc', { features: { liga: false } }), ['a', 'b', 'c']);
        assert.deepEqual(shape(font, 'abc', { features: { ss01: true } }), ['a_b', 'c.alt']);
    });

    it('applies a multiple substitution, with every glyph in the cluster of its character', function() {
        const multiple = { lookupType: 2, lookupFlag: 0, subtables: [{ substFormat: 1, coverage: { format: 1, glyphs: [3] }, sequences: [[6, 7]] }] };
        const font = createFont([['ccmp', [0]]], [multiple]);
        assert.deepEqual(shape(font, 'acb'), ['a', 'a.alt', 'b.alt', 'b']);
        const clusters = font.stringToGlyphClusters('acb');
        assert.deepEqual(clusters.map(cluster => [cluster.glyph.name, cluster.start, cluster.end]),
            [['a', 0, 1], ['a.alt', 1, 2], ['b.alt', 1, 2], ['b', 2, 3]]);
    });

    it('applies ccmp once to latin text', function() {
        // a -> a.alt and a.alt -> b.alt in the same lookup: applied twice, a would become b.alt
        const lookup = { lookupType: 1, lookupFlag: 0, subtables: [{ substFormat: 2, coverage: { format: 1, glyphs: [1, 6] }, substitute: [6, 7] }] };
        const font = createFont([['ccmp', [0]]], [lookup]);
        assert.deepEqual(shape(font, 'ab'), ['a.alt', 'b']);
    });

    it('applies extension lookups', function() {
        const extension = { lookupType: 7, lookupFlag: 0, subtables: [{ substFormat: 1, lookupType: 4, extension: ligature(1, [2], 8).subtables[0] }] };
        const font = createFont([['liga', [0]]], [extension]);
        assert.deepEqual(shape(font, 'abc'), ['a_b', 'c']);
    });

    it('does not apply the latin features across arabic or thai text', function() {
        // - > is a code ligature, but not when an arabic or a thai character separates the two glyphs
        const font = createFont([['calt', [0]]], [ligature(4, [5], 9)]);
        assert.deepEqual(shape(font, '->'), ['arrow']);
        assert.deepEqual(shape(font, '-\u0628>').filter(name => name !== '.notdef'), ['hyphen', 'greater']);
        assert.deepEqual(shape(font, '-\u0E01>').filter(name => name !== '.notdef'), ['hyphen', 'greater']);
    });

    it('applies the ligatures in getPath and getAdvanceWidth too', function() {
        const font = loadSync('./test/fonts/FiraSansMedium.woff');
        const glyphs = [];
        font.forEachGlyph('fi', 0, 0, 72, {}, glyph => glyphs.push(glyph.name));
        assert.deepEqual(glyphs, ['f_i']);
        assert.equal(font.getAdvanceWidth('fi', 1000), font.getAdvanceWidth('fi', 1000, { features: {} }));
        assert.notEqual(font.getAdvanceWidth('fi', 1000), font.getAdvanceWidth('fi', 1000, { features: { liga: false } }));
    });
});

describe('GSUB feature variations', function() {
    it('parses the conditions and the alternate feature tables', function() {
        const data = unhex(
            '00000004' +                                  // FeatureVariations offset
            '0001 0000 00000001' +                        // version 1.0, 1 record
            '00000010 0000001E' +                         // ConditionSet and FeatureTableSubstitution offsets
            '0001 00000006' +                             // ConditionSet: 1 condition
            '0001 0000 2000 4000' +                       // format 1, axis 0, from 0.5 to 1
            '0001 0000 0001 0003 0000000C' +              // FeatureTableSubstitution: feature 3
            '0000 0002 0004 0005'                         // alternate Feature: lookups 4 and 5
        );
        assert.deepEqual(new Parser(data, 0).parseFeatureVariationsList(), [{
            conditionSetOffset: 0x10,
            featureTableSubstitutionOffset: 0x1E,
            conditions: [{ format: 1, axisIndex: 0, filterRangeMinValue: 0.5, filterRangeMaxValue: 1 }],
            substitutions: [{ featureIndex: 3, feature: { featureParams: 0, lookupListIndexes: [4, 5] } }]
        }]);
    });

    it('applies the alternate features of the first record matching the variation coordinates', function() {
        const font = createFont([['liga', [0]]], [ligature(1, [2], 8), single(1, 6)]);
        font.tables.gsub.variations = [
            { conditions: [{ format: 1, axisIndex: 0, filterRangeMinValue: 0.5, filterRangeMaxValue: 1 }],
                substitutions: [{ featureIndex: 0, feature: { featureParams: 0, lookupListIndexes: [1] } }] }
        ];
        let normalizedCoordinates = [0];
        font.variation = { process: { getNormalizedCoords: () => normalizedCoordinates } };
        assert.deepEqual(shape(font, 'ab'), ['a_b']);
        normalizedCoordinates = [0.75];
        assert.deepEqual(shape(font, 'ab'), ['a.alt', 'b']);
    });

    it('does not match the records with conditions of unsupported formats', function() {
        const font = createFont([['liga', [0]]], [ligature(1, [2], 8), single(1, 6)]);
        font.tables.gsub.variations = [
            { conditions: [{ format: 2 }], substitutions: [{ featureIndex: 0, feature: { featureParams: 0, lookupListIndexes: [1] } }] }
        ];
        font.variation = { process: { getNormalizedCoords: () => [0.75] } };
        assert.deepEqual(shape(font, 'ab'), ['a_b']);
    });
});

describe('the lookupFlag of the latin features', function() {
    // the font of test/lookup-flags-font.mjs, whose calt feature has the lookups of the last indexes given, the
    // other lookups are the nested ones; each lookup in the feaLib syntax, then its hb-shape outputs
    // (hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+<feature of the lookup> LookupFlags.ttf -u <code points>)
    const { a: glyphA, b: glyphB, c: glyphC, acute, dotbelow } = glyphIndexes;
    const IGNORE_BASE_GLYPHS = 0x0002;
    const IGNORE_LIGATURES = 0x0004;
    const IGNORE_MARKS = 0x0008;
    const USE_MARK_FILTERING_SET = 0x0010;

    function createFlagsFont(lookups, caltLookupIndexes) {
        return createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', caltLookupIndexes, lookups) });
    }

    function singleLookup(from, to, lookupFlag = 0) {
        return { lookupType: 1, lookupFlag, subtables: [{ substFormat: 2, coverage: { format: 1, glyphs: [from] }, substitute: [to] }] };
    }

    // chaining context format 3, the nested lookup 0 applied to the first input glyph
    function chainingFormat3Lookup(backtrack, input, lookahead, lookupFlag, markFilteringSet) {
        const coverages = glyphs => glyphs.map(glyph => ({ format: 1, glyphs: [glyph] }));
        return {
            lookupType: 6,
            lookupFlag,
            markFilteringSet,
            subtables: [{
                substFormat: 3,
                backtrackCoverage: coverages(backtrack),
                inputCoverage: coverages(input),
                lookaheadCoverage: coverages(lookahead),
                lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }]
            }]
        };
    }

    // sub a b c by a_b_c; sub a b by a_b;
    const abLigatureSubtable = {
        substFormat: 1,
        coverage: { format: 1, glyphs: [glyphA] },
        ligatureSets: [[{ ligGlyph: glyphIndexes.a_b_c, components: [glyphB, glyphC] }, { ligGlyph: glyphIndexes.a_b, components: [glyphB] }]]
    };

    const shapeNames = (font, text) => font.stringToGlyphs(text).map(glyph => glyph.name);

    it('skips the marks of the input sequence of a lookup with IgnoreMarks (context format 3)', function() {
        // lookup SUB_B { sub b by b.alt; } SUB_B; lookupflag IgnoreMarks; sub a' b' lookup SUB_B; (feaLib: ContextSubst format 3)
        // -u 0061,0301,0062: [1=0+500|5=1+0|8=2+500]
        const contextLookup = {
            lookupType: 5,
            lookupFlag: IGNORE_MARKS,
            subtables: [{
                substFormat: 3,
                coverages: [{ format: 1, glyphs: [glyphA] }, { format: 1, glyphs: [glyphB] }],
                lookupRecords: [{ sequenceIndex: 1, lookupListIndex: 0 }]
            }]
        };
        const font = createFlagsFont([singleLookup(glyphB, glyphIndexes['b.alt']), contextLookup], [1]);
        assert.deepEqual(shapeNames(font, 'a\u{301}b'), ['a', 'acute', 'b.alt']);
        // -u 0061,0062: [1=0+500|8=1+500]
        assert.deepEqual(shapeNames(font, 'ab'), ['a', 'b.alt']);
    });

    it('skips the marks of the backtrack of a lookup with IgnoreMarks', function() {
        // lookupflag IgnoreMarks; sub a b' by b.alt;
        // -u 0061,0301,0062: [1=0+500|5=1+0|8=2+500]
        const font = createFlagsFont([singleLookup(glyphB, glyphIndexes['b.alt']), chainingFormat3Lookup([glyphA], [glyphB], [], IGNORE_MARKS)], [1]);
        assert.deepEqual(shapeNames(font, 'a\u{301}b'), ['a', 'acute', 'b.alt']);
    });

    it('skips the marks of the lookahead of a lookup with IgnoreMarks', function() {
        // lookupflag IgnoreMarks; sub a' b by a.alt;
        // -u 0061,0301,0062: [7=0+500|5=1+0|2=2+500]
        const font = createFlagsFont([singleLookup(glyphA, glyphIndexes['a.alt']), chainingFormat3Lookup([], [glyphA], [glyphB], IGNORE_MARKS)], [1]);
        assert.deepEqual(shapeNames(font, 'a\u{301}b'), ['a.alt', 'acute', 'b']);
    });

    itFailsUntilFixed('skips the nonspacing marks of a font without the glyph classes of GDEF, like HarfBuzz',
        'isGlyphIgnoredByLookup (src/layout.mjs): without the GlyphClassDef of GDEF no glyph is ignored, HarfBuzz synthesizes the ' +
        'classes from the Unicode general category (hb_synthesize_glyph_classes): the acute, a nonspacing mark, is a mark',
        function() {
            // lookupflag IgnoreMarks; sub a' b by a.alt;
            // --features=-kern,+ss03 LookupFlagsNoGDEF.ttf -u 0061,0301,0062: [7=0+500|5=1+0|2=2+500]
            const font = createFlagsFont([singleLookup(glyphA, glyphIndexes['a.alt']), chainingFormat3Lookup([], [glyphA], [glyphB], IGNORE_MARKS)], [1]);
            font.tables.gdef = undefined;
            assert.deepEqual(shapeNames(font, 'a\u{301}b'), ['a.alt', 'acute', 'b']);
        });

    it('forms a ligature across the marks of a lookup with IgnoreMarks, the marks after the ligature in their order', function() {
        // lookupflag IgnoreMarks; sub a b c by a_b_c; sub a b by a_b;
        const font = createFlagsFont([{ lookupType: 4, lookupFlag: IGNORE_MARKS, subtables: [abLigatureSubtable] }], [0]);
        // -u 0061,0301,0062: [9=0+500|5=0+0]
        assert.deepEqual(shapeNames(font, 'a\u{301}b'), ['a_b', 'acute']);
        // -u 0061,0301,0062,0323,0063: [10=0+500|5=0+0|6=0+0]
        assert.deepEqual(shapeNames(font, 'a\u{301}b\u{323}c'), ['a_b_c', 'acute', 'dotbelow']);
        // -u 0061,0062,0301,0063: [10=0+500|5=0+0]
        assert.deepEqual(shapeNames(font, 'ab\u{301}c'), ['a_b_c', 'acute']);
    });

    it('does not form a ligature across a mark without a flag', function() {
        // sub a b by a_b;
        // -u 0061,0301,0062: [1=0+500|5=1+0|2=2+500]
        const font = createFlagsFont([{ lookupType: 4, lookupFlag: 0, subtables: [abLigatureSubtable] }], [0]);
        assert.deepEqual(shapeNames(font, 'a\u{301}b'), ['a', 'acute', 'b']);
    });

    it('forms a ligature of one component', function() {
        // LookupFlagsOneComponentLigature.ttf: the ligature of ss10 with the component a only, by a.alt
        // --features=-kern,+ss10 LookupFlagsOneComponentLigature.ttf -u 0061,0062: [7=0+500|2=1+500]
        const oneComponentSubtable = {
            substFormat: 1,
            coverage: { format: 1, glyphs: [glyphA] },
            ligatureSets: [[{ ligGlyph: glyphIndexes['a.alt'], components: [] }]]
        };
        const font = createFlagsFont([{ lookupType: 4, lookupFlag: 0, subtables: [oneComponentSubtable] }], [0]);
        assert.deepEqual(shapeNames(font, 'ab'), ['a.alt', 'b']);
    });

    it('reads the lookupFlag of an extension lookup, not of its subtables', function() {
        // the ligature lookup above with useExtension
        const extensionLookup = {
            lookupType: 7,
            lookupFlag: IGNORE_MARKS,
            subtables: [{ substFormat: 1, lookupType: 4, extension: abLigatureSubtable }]
        };
        const font = createFlagsFont([extensionLookup], [0]);
        assert.deepEqual(shapeNames(font, 'a\u{301}b'), ['a_b', 'acute']);
    });

    itFailsUntilFixed('merges the clusters of a ligature and of the marks between its components, like HarfBuzz',
        'getTextGlyphClusters (src/bidi.mjs): the character of a deleted ligature component belongs to the glyph before it in ' +
        'the text, here the mark that the ligature lookup skipped: the cluster of a_b is [0, 1), the one of acute [1, 3)',
        function() {
            // -u 0061,0301,0062 with the ligature lookup with IgnoreMarks: [9=0+500|5=0+0], a b and the acute are one cluster
            const font = createFlagsFont([{ lookupType: 4, lookupFlag: IGNORE_MARKS, subtables: [abLigatureSubtable] }], [0]);
            const clusters = font.stringToGlyphClusters('a\u{301}b');
            assert.deepStrictEqual(clusters.map(cluster => [cluster.start, cluster.end]), [[0, 3], [0, 3]]);
        });

    it('skips the base glyphs with IgnoreBaseGlyphs, and does not apply the lookup at a base glyph', function() {
        // lookupflag IgnoreBaseGlyphs; sub acute' dotbelow by acute.alt;
        // -u 0301,0062,0323: [11=0+0|2=1+500|6=2+0]
        const contextFont = createFlagsFont([
            singleLookup(acute, glyphIndexes['acute.alt']),
            chainingFormat3Lookup([], [acute], [dotbelow], IGNORE_BASE_GLYPHS)
        ], [1]);
        assert.deepEqual(shapeNames(contextFont, '\u{301}b\u{323}'), ['acute.alt', 'b', 'dotbelow']);
        // lookupflag IgnoreBaseGlyphs; sub a by a.alt;
        // -u 0061: [1=0+500]
        const singleFont = createFlagsFont([singleLookup(glyphA, glyphIndexes['a.alt'], IGNORE_BASE_GLYPHS)], [0]);
        assert.deepEqual(shapeNames(singleFont, 'a'), ['a']);
    });

    it('skips the ligatures with IgnoreLigatures, not the marks', function() {
        // lookupflag IgnoreLigatures; sub a' b by a.alt;
        const font = createFlagsFont([singleLookup(glyphA, glyphIndexes['a.alt']), chainingFormat3Lookup([], [glyphA], [glyphB], IGNORE_LIGATURES)], [1]);
        // -u 0061,FB00,0062: [7=0+500|4=1+500|2=2+500]
        assert.deepEqual(shapeNames(font, 'a\u{FB00}b'), ['a.alt', 'ff', 'b']);
        // -u 0061,0301,0062: [1=0+500|5=1+0|2=2+500]
        assert.deepEqual(shapeNames(font, 'a\u{301}b'), ['a', 'acute', 'b']);
    });

    it('skips the marks of another mark attachment class with a MarkAttachmentType', function() {
        // lookupflag MarkAttachmentType @ACUTES; sub a' b by a.alt; (class 1)
        const acutesFont = createFlagsFont([singleLookup(glyphA, glyphIndexes['a.alt']), chainingFormat3Lookup([], [glyphA], [glyphB], 0x0100)], [1]);
        // -u 0061,0323,0062: [7=0+500|6=1+0|2=2+500]
        assert.deepEqual(shapeNames(acutesFont, 'a\u{323}b'), ['a.alt', 'dotbelow', 'b']);
        // -u 0061,0301,0062: [1=0+500|5=1+0|2=2+500]
        assert.deepEqual(shapeNames(acutesFont, 'a\u{301}b'), ['a', 'acute', 'b']);
        // lookupflag MarkAttachmentType @DOTS; sub b' a by b.alt; (class 2)
        const dotsFont = createFlagsFont([singleLookup(glyphB, glyphIndexes['b.alt']), chainingFormat3Lookup([], [glyphB], [glyphA], 0x0200)], [1]);
        // -u 0062,0301,0061: [8=0+500|5=1+0|1=2+500]
        assert.deepEqual(shapeNames(dotsFont, 'b\u{301}a'), ['b.alt', 'acute', 'a']);
        // -u 0062,0323,0061: [2=0+500|6=1+0|1=2+500]
        assert.deepEqual(shapeNames(dotsFont, 'b\u{323}a'), ['b', 'dotbelow', 'a']);
    });

    it('skips the marks outside of the mark filtering set with UseMarkFilteringSet', function() {
        // lookupflag UseMarkFilteringSet @DOTS; sub a' b by a.alt; (set 0)
        const font = createFlagsFont([
            singleLookup(glyphA, glyphIndexes['a.alt']),
            chainingFormat3Lookup([], [glyphA], [glyphB], USE_MARK_FILTERING_SET, 0)
        ], [1]);
        // -u 0061,0301,0062: [7=0+500|5=1+0|2=2+500]
        assert.deepEqual(shapeNames(font, 'a\u{301}b'), ['a.alt', 'acute', 'b']);
        // -u 0061,0323,0062: [1=0+500|6=1+0|2=2+500]
        assert.deepEqual(shapeNames(font, 'a\u{323}b'), ['a', 'dotbelow', 'b']);
    });

    it('forms a ligature across the marks of another mark attachment class with a MarkAttachmentType', function() {
        // ss17: lookupflag MarkAttachmentType @ACUTES; sub a b by a_b; (class 1)
        const font = createFlagsFont([{ lookupType: 4, lookupFlag: 0x0100, subtables: [abLigatureSubtable] }], [0]);
        // -u 0061,0323,0062: [9=0+500|6=0+0]
        assert.deepEqual(shapeNames(font, 'a\u{323}b'), ['a_b', 'dotbelow']);
        // -u 0061,0301,0062: [1=0+500|5=1+0|2=2+500]
        assert.deepEqual(shapeNames(font, 'a\u{301}b'), ['a', 'acute', 'b']);
    });

    it('forms a ligature across the ligatures with IgnoreLigatures, not across the marks', function() {
        // ss18: lookupflag IgnoreLigatures; sub a b by a_b;
        const font = createFlagsFont([{ lookupType: 4, lookupFlag: IGNORE_LIGATURES, subtables: [abLigatureSubtable] }], [0]);
        // -u 0061,FB00,0062: [9=0+500|4=0+500]
        assert.deepEqual(shapeNames(font, 'a\u{FB00}b'), ['a_b', 'ff']);
        // -u 0061,0301,0062: [1=0+500|5=1+0|2=2+500]
        assert.deepEqual(shapeNames(font, 'a\u{301}b'), ['a', 'acute', 'b']);
    });

    it('matches the first glyph of the glyphs of a multiple substitution in the lookahead', function() {
        // ss14: lookup MULTIPLE_C { sub c by a acute; } then lookupflag IgnoreMarks; sub b' a by b.alt;
        // -u 0062,0063: [8=0+500|1=1+500|5=1+0]
        const multipleLookup = {
            lookupType: 2,
            lookupFlag: 0,
            subtables: [{ substFormat: 1, coverage: { format: 1, glyphs: [glyphC] }, sequences: [[glyphA, acute]] }]
        };
        const font = createFlagsFont([
            singleLookup(glyphB, glyphIndexes['b.alt']),
            multipleLookup,
            chainingFormat3Lookup([], [glyphB], [glyphA], IGNORE_MARKS)
        ], [1, 2]);
        assert.deepEqual(shapeNames(font, 'bc'), ['b.alt', 'a', 'acute']);
    });

    itFailsUntilFixed('goes on after the last input glyph of a contextual match, like HarfBuzz',
        'applyLookup (src/features/latn/latinFeatures.mjs): after a contextual match the lookup is tried again at the next glyph, ' +
        'HarfBuzz goes on after the last matched input glyph (apply_lookup, buffer move_to end): a a a gives a.alt a.alt a',
        function() {
            // ss16: sub a' lookup SUB_A a';
            // -u 0061,0061,0061: [7=0+500|1=1+500|1=2+500]
            const font = createFlagsFont([singleLookup(glyphA, glyphIndexes['a.alt']), chainingFormat3Lookup([], [glyphA, glyphA], [], 0)], [1]);
            assert.deepEqual(shapeNames(font, 'aaa'), ['a.alt', 'a', 'a']);
        });
});
