import assert from 'assert';
import { Font, Glyph, Path, parse } from '../src/opentype.mjs';
import { Parser } from '../src/parse.mjs';
import { unhex } from './testutil.mjs';
import {
    glyphIndexes,
    createLookupFlagsFont,
    createLayoutTable,
    createCoverage,
    createCoverages,
    createSingleLookup,
    createMultipleLookup,
    multipleCLookup,
    subAcuteBLookup
} from './lookup-flags-font.mjs';
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

// TestScriptLanguage.ttf, generated by test/generate-script-language-font.py: liga has a_b, a_alpha and becyr.latn in latn,
// becyr_vecyr in cyrl, alpha.grek in grek, locl i.TRK in latn TRK and becyr.SRB in cyrl SRB, which have the X_LIGA
// lookup of liga only; every language system has rvrn X_RVRN (x.rvrn) after X_LIGA (x.liga) in the lookup list. latn TRK
// has the liga sub o by o.liga; and the required feature (ReqFeatureIndex) ss05 sub o by o.req;, after it in the lookup
// list, the DefaultLangSys of cyrl the required feature ss06 sub gecyr by gecyr.req;
describe('the script and the language of the latin features', function() {
    let font;

    beforeEach(function() {
        font = loadSync('./test/fonts/TestScriptLanguage.ttf');
    });

    it('applies the features of the script of each script run, not the ones of latn', function() {
        // hb-shape --no-glyph-names --cluster-level=1 TestScriptLanguage.ttf -u 0431,0432: [26=0+500]
        assert.deepEqual(shape(font, '\u{431}\u{432}'), ['becyr_vecyr']);
        // -u 03B1: [23=0+500]
        assert.deepEqual(shape(font, '\u{3B1}'), ['alpha.grek']);
        // -u 0061,0062: [19=0+500]
        assert.deepEqual(shape(font, 'ab'), ['a_b']);
        // the runs A, бв and α, each one with its script: -u 0041 [4=0+500], -u 0431,0432 [26=0+500], -u 03B1 [23=0+500]
        // (hb-shape -u 0041,0431,0432,03B1 shapes the four characters as one latn run: [4=0+500|25=1+500|12=2+500|10=3+500])
        assert.deepEqual(shape(font, 'A\u{431}\u{432}\u{3B1}'), ['A', 'becyr_vecyr', 'alpha.grek']);
    });

    it('applies the features of the script option to the whole text, as one script run', function() {
        // hb-shape --no-glyph-names --cluster-level=1 --script=latn TestScriptLanguage.ttf -u 0431,0432: [25=0+500|12=1+500]
        assert.deepEqual(shape(font, '\u{431}\u{432}', { script: 'latn' }), ['becyr.latn', 'vecyr']);
        // a Latin text with the features of cyrl, which has no a_b: --script=cyrl -u 0061,0062 [6=0+500|7=1+500]
        assert.deepEqual(shape(font, 'ab', { script: 'cyrl' }), ['a', 'b']);
        // a Latin and a Greek letter with the features of grek: --script=grek -u 0061,03B1 [6=0+500|23=1+500]
        assert.deepEqual(shape(font, 'a\u{3B1}', { script: 'grek' }), ['a', 'alpha.grek']);
        // the latn ligature of a Latin and a Greek letter: --script=latn -u 0061,03B1 [45=0+500], two runs without it:
        // -u 0061 [6=0+500], -u 03B1 [23=0+500]
        assert.deepEqual(shape(font, 'a\u{3B1}', { script: 'latn' }), ['a_alpha']);
        assert.deepEqual(shape(font, 'a\u{3B1}'), ['a', 'alpha.grek']);
    });

    it('applies the features of the language system of the language option, locl included', function() {
        // hb-shape --no-glyph-names --cluster-level=1 --language=tr TestScriptLanguage.ttf -u 0069: [20=0+500]
        assert.deepEqual(shape(font, 'i', { language: 'TRK ' }), ['i.TRK']);
        assert.deepEqual(shape(font, 'i', { language: 'TRK' }), ['i.TRK']);
        // -u 0069: [8=0+500]
        assert.deepEqual(shape(font, 'i'), ['i']);
        // the language system TRK has no a_b ligature: --language=tr -u 0061,0062: [6=0+500|7=1+500]
        assert.deepEqual(shape(font, 'ab', { language: 'TRK' }), ['a', 'b']);
        // --language=sr -u 0431,0432: [24=0+500|12=1+500]
        assert.deepEqual(shape(font, '\u{431}\u{432}', { language: 'SRB' }), ['becyr.SRB', 'vecyr']);
        // a language the script has not: the default language system, --language=ro -u 0061,0062: [19=0+500]
        assert.deepEqual(shape(font, 'ab', { language: 'ROM' }), ['a_b']);
    });

    it('applies rvrn before the other features, like HarfBuzz', function() {
        // hb-shape --no-glyph-names --cluster-level=1 TestScriptLanguage.ttf -u 0078: [22=0+500]
        assert.deepEqual(shape(font, 'x'), ['x.rvrn']);
        // --features=-rvrn -u 0078: [21=0+500]
        assert.deepEqual(shape(font, 'x', { features: { rvrn: false } }), ['x.liga']);
    });

    it('applies the required feature of the language system whatever the features option, with rvrn unless its tag is on', function() {
        // hb_ot_map_builder_t::compile of HarfBuzz 11.3.2: the stage of the tag of the required feature if it is enabled,
        // otherwise the first stage. hb-shape --no-glyph-names --cluster-level=1 TestScriptLanguage.ttf -u 006F: [65=0+500]
        assert.deepEqual(shape(font, 'o'), ['o']);
        // --language=tr -u 006F: [71=0+500], before the liga of o
        assert.deepEqual(shape(font, 'o', { language: 'TRK' }), ['o.req']);
        // --language=tr --features=-ss05 -u 006F: [71=0+500]
        assert.deepEqual(shape(font, 'o', { language: 'TRK', features: { ss05: false } }), ['o.req']);
        // --language=tr --features=-rvrn -u 006F: [71=0+500]
        assert.deepEqual(shape(font, 'o', { language: 'TRK', features: { rvrn: false } }), ['o.req']);
        // with its tag on, in the stage of the other features, after the liga of o: --language=tr --features=+ss05 -u 006F
        // [70=0+500]
        assert.deepEqual(shape(font, 'o', { language: 'TRK', features: { ss05: true } }), ['o.liga']);
    });

    it('applies the required feature of the default language system of a script, like HarfBuzz', function() {
        // hb-shape --no-glyph-names --cluster-level=1 TestScriptLanguage.ttf -u 0433: [72=0+500]
        assert.deepEqual(shape(font, '\u{433}'), ['gecyr.req']);
        // --features=-ss06 -u 0433: [72=0+500]
        assert.deepEqual(shape(font, '\u{433}', { features: { ss06: false } }), ['gecyr.req']);
        // every default feature off: --features=-rvrn,-ccmp,-locl,-rlig,-rclt,-calt,-liga,-clig -u 0433 [72=0+500]
        const defaultFeaturesOff = { rvrn: false, ccmp: false, locl: false, rlig: false, rclt: false, calt: false, liga: false, clig: false };
        assert.deepEqual(shape(font, '\u{433}', { features: defaultFeaturesOff }), ['gecyr.req']);
        // the language system SRB has no required feature: --language=sr -u 0433 [64=0+500]
        assert.deepEqual(shape(font, '\u{433}', { language: 'SRB' }), ['gecyr']);
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

    it('merges the clusters of a ligature and of the marks between its components, like HarfBuzz', function() {
        // -u 0061,0301,0062 with the ligature lookup with IgnoreMarks: [9=0+500|5=0+0], a b and the acute are one cluster
        const font = createFlagsFont([{ lookupType: 4, lookupFlag: IGNORE_MARKS, subtables: [abLigatureSubtable] }], [0]);
        const clusters = font.stringToGlyphClusters('a\u{301}b');
        assert.deepStrictEqual(clusters.map(cluster => [cluster.start, cluster.end]), [[0, 3], [0, 3]]);
    });

    it('merges the clusters of a ligature of three components, to its last component, like HarfBuzz', function() {
        // ss04: lookupflag IgnoreMarks; sub a b c by a_b_c; sub a b by a_b;
        const font = createFlagsFont([{ lookupType: 4, lookupFlag: IGNORE_MARKS, subtables: [abLigatureSubtable] }], [0]);
        const describeClusters = text => font.stringToGlyphClusters(text).map(cluster => [cluster.glyph.name, cluster.start, cluster.end]);
        // -u 0061,0062,0301,0063: [10=0+500|5=0+0]
        assert.deepStrictEqual(describeClusters('ab\u{301}c'), [['a_b_c', 0, 4], ['acute', 0, 4]]);
        // -u 0061,0301,0062,0323,0063: [10=0+500|5=0+0|6=0+0]
        assert.deepStrictEqual(describeClusters('a\u{301}b\u{323}c'), [['a_b_c', 0, 5], ['acute', 0, 5], ['dotbelow', 0, 5]]);
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

    it('goes on after the last input glyph of a contextual match, like HarfBuzz', function() {
        // ss16: sub a' lookup SUB_A a'; HarfBuzz goes on after the last matched input glyph (apply_lookup, buffer move_to end)
        // -u 0061,0061,0061: [7=0+500|1=1+500|1=2+500]
        const font = createFlagsFont([singleLookup(glyphA, glyphIndexes['a.alt']), chainingFormat3Lookup([], [glyphA, glyphA], [], 0)], [1]);
        assert.deepEqual(shapeNames(font, 'aaa'), ['a.alt', 'a', 'a']);
    });

    it('goes on after the input glyphs of a contextual rule that substitutes nothing (an exception rule), like HarfBuzz', function() {
        // calt: ignore sub a' b'; sub b' lookup SUB_B; (two ContextSubst format 3), the lookup does not apply at the b of the
        // input of the exception: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsExceptionRules.ttf
        const exceptionLookup = {
            lookupType: 5,
            lookupFlag: 0,
            subtables: [
                { substFormat: 3, coverages: createCoverages([glyphA, glyphB]), lookupRecords: [] },
                { substFormat: 3, coverages: createCoverages([glyphB]), lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }
            ]
        };
        const font = createFlagsFont([singleLookup(glyphB, glyphIndexes['b.alt']), exceptionLookup], [1]);
        // -u 0061,0062,0062: [1=0+500|2=1+500|8=2+500]
        assert.deepEqual(shapeNames(font, 'abb'), ['a', 'b', 'b.alt']);
        // -u 0062,0062: [8=0+500|8=1+500]
        assert.deepEqual(shapeNames(font, 'bb'), ['b.alt', 'b.alt']);
    });
});

describe('multiple substitutions of the latin features', function() {
    // the font of test/lookup-flags-font.mjs, whose calt feature has the given lookups; each lookup in the feaLib syntax,
    // then its hb-shape outputs, each glyph with the start of its cluster
    // (hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+<feature of the lookups> LookupFlags.ttf -u <code points>)
    const { a: glyphA, b: glyphB, c: glyphC, acute } = glyphIndexes;

    function createMultipleFont(lookups) {
        return createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', lookups.map((lookup, index) => index), lookups) });
    }

    // sub a b by a_b;
    const abLigatureLookup = {
        lookupType: 4,
        lookupFlag: 0,
        subtables: [{ substFormat: 1, coverage: { format: 1, glyphs: [glyphA] }, ligatureSets: [[{ ligGlyph: glyphIndexes.a_b, components: [glyphB] }]] }]
    };

    // the name of each glyph, with the range of its characters
    const shapeClusters = (font, text) => font.stringToGlyphClusters(text).map(cluster => [cluster.glyph.name, cluster.start, cluster.end]);

    it('applies the following lookups to each glyph of a multiple substitution', function() {
        // ss30: sub c by a acute; then sub acute by acute.alt; sub b by b.alt;
        // -u 0063,0062: [1=0+500|11=0+0|8=1+500]
        const font = createMultipleFont([multipleCLookup, subAcuteBLookup]);
        assert.deepEqual(shapeClusters(font, 'cb'), [['a', 0, 1], ['acute.alt', 0, 1], ['b.alt', 1, 2]]);
    });

    it('forms a ligature of the glyphs of a multiple substitution, in the cluster of its character', function() {
        // ss25: sub c by a b; then sub a b by a_b;
        // -u 0063,0062: [9=0+500|2=1+500]
        const font = createMultipleFont([createMultipleLookup([glyphC], [[glyphA, glyphB]]), abLigatureLookup]);
        assert.deepEqual(shapeClusters(font, 'cb'), [['a_b', 0, 1], ['b', 1, 2]]);
    });

    it('merges the whole cluster of a multiple substitution with the cluster of a ligature of one of its glyphs', function() {
        // ss26: sub c by b a; then sub a b by a_b;
        // -u 0063,0062: [2=0+500|9=0+500]
        const font = createMultipleFont([createMultipleLookup([glyphC], [[glyphB, glyphA]]), abLigatureLookup]);
        assert.deepEqual(shapeClusters(font, 'cb'), [['b', 0, 2], ['a_b', 0, 2]]);
    });

    it('gives each glyph of a multiple substitution of a ligature the characters of the ligature', function() {
        // ss27: sub a b by a_b; then sub a_b by a.alt b.alt;
        // -u 0061,0062,0063: [7=0+500|8=0+500|3=2+500]
        const font = createMultipleFont([abLigatureLookup, createMultipleLookup([glyphIndexes.a_b], [[glyphIndexes['a.alt'], glyphIndexes['b.alt']]])]);
        assert.deepEqual(shapeClusters(font, 'abc'), [['a.alt', 0, 2], ['b.alt', 0, 2], ['c', 2, 3]]);
    });

    it('does not apply a multiple substitution to the glyphs it gives', function() {
        // ss28: sub c by a c;
        // -u 0063,0063: [1=0+500|3=0+500|1=1+500|3=1+500]
        const font = createMultipleFont([createMultipleLookup([glyphC], [[glyphA, glyphC]])]);
        assert.deepEqual(shapeClusters(font, 'cc'), [['a', 0, 1], ['c', 0, 1], ['a', 1, 2], ['c', 1, 2]]);
    });

    it('applies the lookup that deletes a glyph to the glyph after it, which takes the characters of the deleted one', function() {
        // calt: sub c by NULL; sub b by a b; (a lookup of type 2)
        // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsDeletionThenMultiple.ttf -u 0063,0062
        // [1=0+500|2=0+500]
        const font = createMultipleFont([createMultipleLookup([glyphB, glyphC], [[glyphA, glyphB], []])]);
        assert.deepEqual(shapeClusters(font, 'cb'), [['a', 0, 2], ['b', 0, 2]]);
    });

    // ss32: sub c by a acute; sub acute by acute.alt; (a lookup of type 2, the sequence of acute of one glyph)
    const multipleThenAcuteLookup = createMultipleLookup([glyphC, acute], [[glyphA, acute], [glyphIndexes['acute.alt']]]);

    it('goes on after the glyphs of a multiple substitution, which its lookup does not substitute again', function() {
        // ss32: -u 0063,0062: [1=0+500|5=0+0|2=1+500], -u 0063,0301: [1=0+500|5=0+0|11=1+0], the acute of the text only
        const font = createMultipleFont([multipleThenAcuteLookup]);
        assert.deepEqual(shapeClusters(font, 'cb'), [['a', 0, 1], ['acute', 0, 1], ['b', 1, 2]]);
        assert.deepEqual(shapeClusters(font, 'c\u{301}'), [['a', 0, 1], ['acute', 0, 1], ['acute.alt', 1, 2]]);
    });

    it('goes on after the glyphs of a nested multiple substitution, which its contextual lookup does not substitute again', function() {
        // ss33: sub [c acute]' lookup MULTIPLE_C_THEN_ACUTE; (the lookup of ss32)
        // -u 0063,0062: [1=0+500|5=0+0|2=1+500], -u 0063,0301: [1=0+500|5=0+0|11=1+0]
        const contextLookup = {
            lookupType: 5,
            lookupFlag: 0,
            subtables: [{ substFormat: 3, coverages: [createCoverage([glyphC, acute])], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }]
        };
        const font = createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [1], [multipleThenAcuteLookup, contextLookup]) });
        assert.deepEqual(shapeClusters(font, 'cb'), [['a', 0, 1], ['acute', 0, 1], ['b', 1, 2]]);
        assert.deepEqual(shapeClusters(font, 'c\u{301}'), [['a', 0, 1], ['acute', 0, 1], ['acute.alt', 1, 2]]);
    });

    it('goes on after a nested multiple substitution of the last input glyph, whose glyphs match the rule again', function() {
        // ss34: sub a' b' lookup MULTIPLE_B_A_B; (sub b by a b;)
        // -u 0061,0062: [1=0+500|1=1+500|2=1+500], -u 0061,0062,0062: [1=0+500|1=1+500|2=1+500|2=2+500]
        const contextLookup = {
            lookupType: 5,
            lookupFlag: 0,
            subtables: [{ substFormat: 3, coverages: createCoverages([glyphA, glyphB]), lookupRecords: [{ sequenceIndex: 1, lookupListIndex: 0 }] }]
        };
        const font = createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [1], [createMultipleLookup([glyphB], [[glyphA, glyphB]]), contextLookup]) });
        assert.deepEqual(shapeClusters(font, 'ab'), [['a', 0, 1], ['a', 1, 2], ['b', 1, 2]]);
        assert.deepEqual(shapeClusters(font, 'abb'), [['a', 0, 1], ['a', 1, 2], ['b', 1, 2], ['b', 2, 3]]);
    });

    it('does not apply a later rule of the lookup to the glyphs of a nested multiple substitution of the input', function() {
        // ss35: sub a' c' lookup MULTIPLE_C_B_A; sub a' lookup SUB_A; (sub c by b a;), feaLib: ContextSubst format 1
        // -u 0061,0063: [1=0+500|2=1+500|1=1+500], -u 0061,0063,0061: [1=0+500|2=1+500|1=1+500|7=2+500]
        const contextLookup = {
            lookupType: 5,
            lookupFlag: 0,
            subtables: [{
                substFormat: 1,
                coverage: createCoverage([glyphA]),
                ruleSets: [[
                    { input: [glyphC], lookupRecords: [{ sequenceIndex: 1, lookupListIndex: 0 }] },
                    { input: [], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 1 }] }
                ]]
            }]
        };
        const lookups = [createMultipleLookup([glyphC], [[glyphB, glyphA]]), createSingleLookup([glyphA], [glyphIndexes['a.alt']]), contextLookup];
        const font = createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [2], lookups) });
        assert.deepEqual(shapeClusters(font, 'ac'), [['a', 0, 1], ['b', 1, 2], ['a', 1, 2]]);
        assert.deepEqual(shapeClusters(font, 'aca'), [['a', 0, 1], ['b', 1, 2], ['a', 1, 2], ['a.alt', 2, 3]]);
    });

    it('merges the whole clusters of the components of a ligature, with the glyphs they share them with', function() {
        // ss31: lookupflag IgnoreMarks; sub a b by a_b; then sub c a_b by a_b_c; the acute that the first ligature skipped
        // is in the cluster of a_b: -u 0063,0061,0301,0062: [10=0+500|5=0+0]
        const ignoreMarksLigatureLookup = Object.assign({}, abLigatureLookup, { lookupFlag: 0x0008 });
        const cLigatureLookup = {
            lookupType: 4,
            lookupFlag: 0,
            subtables: [{ substFormat: 1, coverage: { format: 1, glyphs: [glyphC] }, ligatureSets: [[{ ligGlyph: glyphIndexes.a_b_c, components: [glyphIndexes.a_b] }]] }]
        };
        const font = createMultipleFont([ignoreMarksLigatureLookup, cLigatureLookup]);
        assert.deepEqual(shapeClusters(font, 'ca\u{301}b'), [['a_b_c', 0, 4], ['acute', 0, 4]]);
    });
});
