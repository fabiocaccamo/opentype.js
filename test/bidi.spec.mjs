import assert from 'assert';
import Bidi from '../src/bidi.mjs';
import FeatureQuery from '../src/features/featureQuery.mjs';
import { parse } from '../src/opentype.mjs';
import { readFileSync } from 'fs';
import { shapeText, assertShape, itFailsUntilFixed } from './regression/helpers.mjs';
import {
    glyphIndexes,
    createLookupFlagsFont,
    createLayoutTable,
    createScriptsLayoutTable,
    createCoverage,
    createCoverages,
    createSingleLookup,
    createMultipleLookup
} from './lookup-flags-font.mjs';
const loadSync = (url, opt) => parse(readFileSync(url), opt);

/**
 * The clusters of a text in visual order, each one with the start and the end of its characters and its glyphs in
 * visual order
 * @param {opentype.Font} font
 * @param {string} text
 * @returns {Array<[number, number, number[]]>}
 */
function describeClusters(font, text) {
    const clusters = [];
    for (const { glyph, start, end } of font.stringToGlyphClusters(text)) {
        const lastCluster = clusters[clusters.length - 1];
        if (lastCluster && lastCluster[0] === start) {
            lastCluster[2].push(glyph.index);
        } else {
            clusters.push([start, end, [glyph.index]]);
        }
    }
    return clusters;
}

describe('bidi.mjs', function() {
    let latinFont;
    let arabicFont;
    let bidiFira;
    let bidiScheherazade;
    let arabicTokenizer;

    beforeEach(function () {
        /**
         * arab
         */
        arabicFont = loadSync('./test/fonts/Scheherazade-Bold.ttf');
        bidiScheherazade = new Bidi();
        bidiScheherazade.registerModifier(
            'glyphIndex', null, token => arabicFont.charToGlyphIndex(token.char)
        );
        const requiredArabicFeatures = [{
            script: 'arab',
            tags: ['init', 'medi', 'fina', 'rlig']
        }];
        bidiScheherazade.applyFeatures(arabicFont, requiredArabicFeatures);
        bidiScheherazade.getTextGlyphs(''); // initialize bidi.
        arabicTokenizer = bidiScheherazade.tokenizer;
        /**
         * latin
         */
        latinFont = loadSync('./test/fonts/FiraSansMedium.woff');
        bidiFira = new Bidi();
        bidiFira.registerModifier(
            'glyphIndex', null, token => latinFont.charToGlyphIndex(token.char)
        );
        const latinFeatures = [{
            script: 'latn',
            tags: ['liga', 'rlig']
        }];
        bidiFira.applyFeatures(latinFont, latinFeatures);
    });
    describe('arabic contexts', function() {
        it('should match the arabic script runs of a given text', function() {
            bidiScheherazade.processText('Hello السلام عليكم');
            const runs = bidiScheherazade.scriptRuns.map(run => [run.scriptTags, run.tokens.map(token => token.char).join('')]);
            // the space between two arabic words is in their run
            assert.deepEqual(runs, [[['latn'], 'Hello '], [['arab'], 'السلام عليكم']]);
        });
        it('should match mixed arabic sentence', function() {
            arabicTokenizer.tokenize('The king said: ائتوني به أستخلصه لنفسي');
            const ranges = arabicTokenizer.getContextRanges('arabicSentence');
            const sentences = ranges.map(range => arabicTokenizer.rangeToText(range))[0];
            assert.equal(sentences, 'ائتوني به أستخلصه لنفسي');
        });

        // U+FD3E ORNATE LEFT PARENTHESIS and U+FD3F ORNATE RIGHT PARENTHESIS of the Arabic Presentation Forms-A block, of
        // the Common script and of the bidi class ON, which take the direction of the strong chars around them (UAX #9 N1)
        describe('the ornate parentheses', function() {
            let jomhuriaFont;

            before(function() {
                jomhuriaFont = loadSync('./test/fonts/Jomhuria-Regular.ttf');
            });

            it('keeps the ornate parentheses between two latin letters in the order of the text, like HarfBuzz', function() {
                // hb-shape --no-glyph-names --cluster-level=1 Jomhuria-Regular.ttf -u 0041,FD3E,FD3F,0042
                // [37=0+981|864=1+846|865=2+846|38=3+981]
                assert.deepStrictEqual(jomhuriaFont.stringToGlyphIndexes('A\u{FD3E}\u{FD3F}B'), [37, 864, 865, 38]);
            });

            itFailsUntilFixed('lays the ornate parentheses between two arabic letters out from right to left, like HarfBuzz',
                'arabicSentenceEndCheck (src/features/arab/contextCheck/arabicSentence.mjs): no resolution of the bidi neutral ' +
                'chars, so the ornate parentheses, which are not Arabic characters (isArabicChar), end the right-to-left ' +
                'sentence and are laid out from left to right between the two letters, each one a right-to-left run of its own',
                function() {
                    // hb-shape --no-glyph-names --cluster-level=1 Jomhuria-Regular.ttf -u 0627,FD3E,FD3F,0628
                    // [434=3+1608|865=2+846|864=1+846|433=0+576]
                    assert.deepStrictEqual(jomhuriaFont.stringToGlyphIndexes('\u{627}\u{FD3E}\u{FD3F}\u{628}'), [434, 865, 864, 433]);
                });
        });
    });
    describe('getBidiText', function() {
        it('should adjust then render layout direction of bidi text', function() {
            const bidiText = bidiScheherazade.getBidiText('Be kind, فما كان الرفق في شيء إلا زانه ، ولا نزع من شيء إلا شانه');
            assert.equal(bidiText, 'Be kind, هناش الإ ءيش نم عزن الو ، هناز الإ ءيش يف قفرلا ناك امف');
        });
    });
    describe('applyFeatures', function () {
        it('should apply arabic presentation forms', function() {
            bidiScheherazade.getTextGlyphs('Hello السلام عليكم');
            const arabicRun = bidiScheherazade.scriptRuns.find(run => run.scriptTags.includes('arab'));
            const forms = arabicRun.tokens.map(token => ['init', 'medi', 'fina'].find(tag => token.state[tag]) || null);
            // in the order of the text, isol not registered: hb-shape --shapers=ot --cluster-level=1
            // --features=-rlig,-calt,-liga,-kern,-mark,-mkmk,-isol Scheherazade-Bold.ttf -u 0627,0644,0633,0644,0627,0645,0020,0639,0644,064A,0643,0645
            // [uni0645.fina=11|uni0643.medi=10|uni064A.medi=9|uni0644.medi=8|uni0639.init=7|space=6|uni0645=5|uni0627.fina=4|uni0644.medi=3|
            // uni0633.medi=2|uni0644.init=1|uni0627=0]
            assert.deepEqual(forms, [null, 'init', 'medi', 'medi', 'fina', null, null, 'init', 'medi', 'medi', 'medi', 'fina']);
        });
        it('should apply arabic required letter ligature', function () {
            let glyphIndexes = bidiScheherazade.getTextGlyphs('لا'); // Arabic word 'لا' : 'no'
            assert.deepEqual(glyphIndexes, [1341, 1330]);
        });
        it('should apply arabic required composition ligature', function () {
            // beh, fatha, shadda: the marks of the Inherited script take the Arabic script of the beh
            // hb-shape --shapers=ot --no-glyph-names --cluster-level=1 Scheherazade-Bold.ttf -u 0628,064E,0651
            // [1311=1@560,-322+0|373=0+1505]
            let glyphIndexes = bidiScheherazade.getTextGlyphs('\u{628}\u{64E}\u{651}');
            assert.deepEqual(glyphIndexes, [1311, 373]);
        });
        it('does not apply the arabic features to a text of marks of no script, like HarfBuzz', function () {
            // fatha, shadda: a text of the Inherited script only takes the DFLT script, which falls back to latn
            // hb-shape --shapers=ot --no-glyph-names --cluster-level=1 Scheherazade-Bold.ttf -u 064E,0651
            // [1081=0+0|1075=0@30,370+0]; with --script=arab [1311=0+0]
            assert.deepStrictEqual(bidiScheherazade.getTextGlyphs('\u{64E}\u{651}'), [1081, 1075]);
        });
        it('should apply latin ligature', function () {
            let glyphIndexes = bidiFira.getTextGlyphs('fi'); // fi => ﬁ
            assert.deepEqual(glyphIndexes, [1145]);
        });
    });

    describe('getTextGlyphClusters', function() {
        it('gives the direction of the run of each glyph', function() {
            // 'Hi ' then the arabic sentence of beh, fatha, alef, in visual order: H, i, space, alef, fatha, beh
            const clusters = bidiScheherazade.getTextGlyphClusters('Hi \u{628}\u{64E}\u{627}');
            assert.deepStrictEqual(clusters.map(cluster => [cluster.start, cluster.rightToLeft]),
                [[0, false], [1, false], [2, false], [5, true], [4, true], [3, true]]);
            // a right-to-left run of one glyph between two left-to-right glyphs
            const oneGlyphRunClusters = bidiScheherazade.getTextGlyphClusters('a\u{631}b');
            assert.deepStrictEqual(oneGlyphRunClusters.map(cluster => cluster.rightToLeft), [false, true, false]);
            // two right-to-left runs reh alef around a left-to-right b
            const twoRunsClusters = bidiScheherazade.getTextGlyphClusters('\u{631}\u{627}b\u{631}\u{627}');
            assert.deepStrictEqual(twoRunsClusters.map(cluster => [cluster.start, cluster.rightToLeft]),
                [[1, true], [0, true], [2, false], [4, true], [3, true]]);
        });

        it('gives each glyph the ligature properties that the ligature substitutions recorded for it', function() {
            // TestMarkAttachment.ttf: lookupflag IgnoreMarks; sub f i by f_i; in liga, on f acute i b: the ligature of two
            // components, the acute after its first one (see applySubstitution.spec.mjs), b without ligature properties
            const markFont = loadSync('./test/fonts/TestMarkAttachment.ttf');
            const bidi = new Bidi();
            bidi.registerModifier('glyphIndex', null, token => markFont.charToGlyphIndex(token.char));
            bidi.applyFeatures(markFont, [{ script: 'latn', tags: ['liga'] }]);
            const clusters = bidi.getTextGlyphClusters('f\u{301}ib');
            const ligatureId = clusters[0].ligatureProperties.ligatureId;
            assert.strictEqual(typeof ligatureId, 'symbol');
            assert.deepStrictEqual(clusters.map(cluster => [cluster.index, cluster.ligatureProperties]), [
                [markFont.nameToGlyphIndex('f_i'), { ligatureId, ligatureComponentCount: 2 }],
                [markFont.charToGlyphIndex('\u{301}'), { ligatureId, ligatureComponent: 1 }],
                [markFont.charToGlyphIndex('b'), undefined]
            ]);
        });

        it('keeps the ligature properties of each glyph of a token of a right-to-left run with its glyph, like HarfBuzz', function() {
            // TestMarkAttachment.ttf with the multiple substitution of ss10 changed to sub z by f acutecomb i; and U+062A
            // mapped to z (fontTools), then sub f' lookup LIGA_F_I i'; of ss11: the token of the teh holds the ligature f_i
            // and the acute after its first component, reversed in the right-to-left run; the acute attaches to the first
            // component, at 150 700: hb-shape --no-glyph-names --cluster-level=1 --features=+ss10,+ss11 -u 062A
            // [10=0@150,200+0|9=0+550]
            const markFont = loadSync('./test/fonts/TestMarkAttachment.ttf');
            markFont.tables.gsub.lookups[2].subtables[0].sequences[0] = ['f', 'acutecomb', 'i'].map(name => markFont.nameToGlyphIndex(name));
            markFont.tables.cmap.glyphIndexMap[0x62A] = markFont.nameToGlyphIndex('z');
            assertShape(shapeText(markFont, '\u{62A}', { features: { ss10: true, ss11: true } }), {
                glyphs: [10, 9], clusters: [0, 0], advances: [0, 550], offsets: [[150, 200], [0, 0]]
            });
        });

        itFailsUntilFixed('lays a right-to-left word with a zero width non-joiner out from right to left, like HarfBuzz',
            'arabicSentenceEndCheck (src/features/arab/contextCheck/arabicSentence.mjs): the zero width non-joiner U+200C, ' +
            'which is not an Arabic character (isArabicChar), ends the right-to-left sentence, so the two pieces of the word ' +
            'are each reversed in place and keep their logical order, the zero width non-joiner a left-to-right run between them',
            function() {
                // the Persian word mi-khwaham, with a zero width non-joiner after mi (the space glyph 3, a hidden default
                // ignorable): hb-shape --shapers=ot (the default shaper of this font is graphite2) --no-glyph-names
                // --cluster-level=1 Scheherazade-Bold.ttf -u 0645,06CC,200C,062E,0648,0627,0647,0645
                // [724=7+838|1062=6+803|273=5+357|532=4@-130,0+523|956=3+1120|3=2+0|593=1+1140|1046=0+639]
                const clusters = arabicFont.stringToGlyphClusters('\u{645}\u{6CC}\u{200C}\u{62E}\u{648}\u{627}\u{647}\u{645}');
                assert.deepStrictEqual(clusters.map(cluster => cluster.start), [7, 6, 5, 4, 3, 2, 1, 0]);
            });

        describe('a ligature formed across a mark', function() {
            let changaFont;
            let lookupFlagsFont;
            let ccmpLigatureFont;

            // the font of test/lookup-flags-font.mjs with the two rlig lookups of LookupFlags.ttf in ccmp, in DFLT, the script an
            // arabic text falls back to without arab: lookupflag IgnoreMarks; sub lam alef by lam_alef; then
            // lookupflag IgnoreMarks; sub lam_alef reh' by reh.alt;
            function createCcmpLigatureFont() {
                const { lam, alef, reh } = glyphIndexes;
                const IGNORE_MARKS = 0x0008;
                const coverage = glyphIndex => ({ format: 1, glyphs: [glyphIndex] });
                const ligatureLookup = {
                    lookupType: 4,
                    lookupFlag: IGNORE_MARKS,
                    subtables: [{ substFormat: 1, coverage: coverage(lam), ligatureSets: [[{ ligGlyph: glyphIndexes.lam_alef, components: [alef] }]] }]
                };
                const chainingLookup = {
                    lookupType: 6,
                    lookupFlag: IGNORE_MARKS,
                    subtables: [{
                        substFormat: 3,
                        backtrackCoverage: [coverage(glyphIndexes.lam_alef)],
                        inputCoverage: [coverage(reh)],
                        lookaheadCoverage: [],
                        lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 2 }]
                    }]
                };
                const rehLookup = { lookupType: 1, lookupFlag: 0, subtables: [{ substFormat: 2, coverage: coverage(reh), substitute: [glyphIndexes['reh.alt']] }] };
                return createLookupFlagsFont({ gsub: createLayoutTable('DFLT', 'ccmp', [0, 1], [ligatureLookup, chainingLookup, rehLookup]) });
            }

            // the font of test/lookup-flags-font.mjs with a ligature of two marks in ccmp, in DFLT and arab like the language
            // systems of the generator: sub fatha fatha by fatha; then in rlig: lookupflag IgnoreMarks; sub lam alef by lam_alef;
            function createCcmpBeforeRligFont() {
                const { lam, alef, fatha } = glyphIndexes;
                const IGNORE_MARKS = 0x0008;
                const coverage = glyphIndex => ({ format: 1, glyphs: [glyphIndex] });
                const defaultLangSys = featureIndexes => ({ reserved: 0, reqFeatureIndex: 0xffff, featureIndexes });
                const fathaLigatureLookup = {
                    lookupType: 4,
                    lookupFlag: 0,
                    subtables: [{ substFormat: 1, coverage: coverage(fatha), ligatureSets: [[{ ligGlyph: fatha, components: [fatha] }]] }]
                };
                const lamAlefLigatureLookup = {
                    lookupType: 4,
                    lookupFlag: IGNORE_MARKS,
                    subtables: [{ substFormat: 1, coverage: coverage(lam), ligatureSets: [[{ ligGlyph: glyphIndexes.lam_alef, components: [alef] }]] }]
                };
                return createLookupFlagsFont({
                    gsub: {
                        version: 1,
                        scripts: [
                            { tag: 'DFLT', script: { defaultLangSys: defaultLangSys([0]), langSysRecords: [] } },
                            { tag: 'arab', script: { defaultLangSys: defaultLangSys([0, 1]), langSysRecords: [] } }
                        ],
                        features: [
                            { tag: 'ccmp', feature: { featureParams: 0, lookupListIndexes: [0] } },
                            { tag: 'rlig', feature: { featureParams: 0, lookupListIndexes: [1] } }
                        ],
                        lookups: [fathaLigatureLookup, lamAlefLigatureLookup]
                    }
                });
            }

            before(function() {
                changaFont = loadSync('./test/fonts/Changa-Regular.ttf');
                // built by test/generate-lookup-flags-font.py
                lookupFlagsFont = loadSync('./test/fonts/LookupFlags.ttf');
                ccmpLigatureFont = createCcmpLigatureFont();
            });

            it('forms the lam alef required ligature across the fatha, like HarfBuzz', function() {
                // hb-shape --no-glyph-names --cluster-level=1 Changa-Regular.ttf -u 644,64e,627
                // [773=0@375,180+0|458=0+635]: the fatha, then the lam alef ligature, in visual order
                assert.deepStrictEqual(changaFont.stringToGlyphIndexes('\u{644}\u{64E}\u{627}'), [773, 458]);
            });

            it('matches the rule of a later required ligature lookup right after the ligature, like HarfBuzz', function() {
                // rlig: lookupflag IgnoreMarks; sub lam alef by lam_alef; then lookupflag IgnoreMarks; sub lam_alef reh' by reh.alt;
                // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlags.ttf -u 0644,0627,0631
                // [20=2+500|19=0+500]: reh.alt, then the lam alef ligature, in visual order
                assert.deepStrictEqual(lookupFlagsFont.stringToGlyphIndexes('\u{644}\u{627}\u{631}'), [20, 19]);
            });

            it('forms the lam alef required ligature across a mark ligature that ccmp formed, like HarfBuzz', function() {
                // ccmp: sub fatha fatha by fatha; then rlig: lookupflag IgnoreMarks; sub lam alef by lam_alef;
                // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsCcmpBeforeRlig.ttf -u 0644,064E,064E,0627
                // [14=0+0|19=0+500]: the fatha, then the lam alef ligature, in visual order
                assert.deepStrictEqual(createCcmpBeforeRligFont().stringToGlyphIndexes('\u{644}\u{64E}\u{64E}\u{627}'), [14, 19]);
            });

            it('forms both glyphs of the lam alef across a mark ligature of a later required ligature lookup, like HarfBuzz', function() {
                // rlig of Scheherazade: lookup 8 (IgnoreMarks) substitutes lam by lam.init.preAlef and alef by alef.fina.postLamIni,
                // lookup 9 (MarkAttachmentType 1) forms the ligature uni0651064E of the fatha and the shadda between them.
                // hb-shape --shapers=ot (the default shaper of this font is graphite2) --no-glyph-names --cluster-level=1
                // Scheherazade-Bold.ttf -u 0644,064E,0651,0627: [1341=3+564|1311=1@18,316+0|1330=0@-51,0+451]
                assert.deepStrictEqual(arabicFont.stringToGlyphIndexes('\u{644}\u{64E}\u{651}\u{627}'), [1341, 1311, 1330]);
            });

            it('matches the rule of a later ccmp lookup right after the ligature, like HarfBuzz', function() {
                // the context of ccmp is the glyphs of the tokens, without the component the ligature deleted
                // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsCcmpLigature.ttf -u 0644,0627,0631
                // [20=2+500|19=0+500]: reh.alt, then the lam alef ligature, in visual order
                assert.deepStrictEqual(ccmpLigatureFont.stringToGlyphIndexes('\u{644}\u{627}\u{631}'), [20, 19]);
            });

            it('merges the clusters of a ligature and of the mark between its components, like HarfBuzz', function() {
                // hb-shape --no-glyph-names --cluster-level=1 Changa-Regular.ttf -u 644,64e,627
                // [773=0@375,180+0|458=0+635]: lam fatha alef is one cluster
                const clusters = changaFont.stringToGlyphClusters('\u{644}\u{64E}\u{627}');
                assert.deepStrictEqual(clusters.map(cluster => [cluster.start, cluster.end]), [[0, 3], [0, 3]]);
            });
        });

        describe('a deleted first glyph', function() {
            // the font of test/lookup-flags-font.mjs, the lookups in calt: lookup 0: sub c by NULL; lookup 1: sub acute by acute.alt;
            // sub b by b.alt; (MULTIPLE_C and SUB_ACUTE_B of LookupFlagsNestedDeletion.ttf)
            const { b: glyphB, c: glyphC, acute } = glyphIndexes;
            const deletionLookups = [
                createMultipleLookup([glyphC], [[]]),
                createSingleLookup([glyphB, acute], [glyphIndexes['b.alt'], glyphIndexes['acute.alt']])
            ];
            const shapeClusters = (font, text) => font.stringToGlyphClusters(text).map(({ glyph, start, end }) => [glyph.index, start, end]);

            it('gives the characters of a first glyph that a lookup deleted to the next cluster, like HarfBuzz', function() {
                // ss30: sub c by NULL; then sub acute by acute.alt; sub b by b.alt;
                // hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+ss30 LookupFlagsNestedDeletion.ttf -u 0063,0062: [8=0+500]
                const font = createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [0, 1], deletionLookups) });
                assert.deepStrictEqual(shapeClusters(font, 'cb'), [[glyphIndexes['b.alt'], 0, 2]]);
            });

            it('gives the characters of a first glyph that a nested lookup deleted to the next cluster, like HarfBuzz', function() {
                // ss23: sub c' lookup MULTIPLE_C b' lookup SUB_ACUTE_B; with sub c by NULL; and the second record at the sequence index 0
                // hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+ss23 LookupFlagsNestedDeletion.ttf -u 0063,0062: [8=0+500]
                const contextLookup = {
                    lookupType: 5,
                    lookupFlag: 0,
                    subtables: [{
                        substFormat: 3,
                        coverages: [createCoverage([glyphC]), createCoverage([glyphB])],
                        lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }, { sequenceIndex: 0, lookupListIndex: 1 }]
                    }]
                };
                const font = createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [2], deletionLookups.concat(contextLookup)) });
                assert.deepStrictEqual(shapeClusters(font, 'cb'), [[glyphIndexes['b.alt'], 0, 2]]);
            });

            it('gives the characters of a deleted first glyph to the first cluster when two glyphs share it, like HarfBuzz', function() {
                // LookupFlagsDeletionThenLigature.ttf: calt sub c by NULL; then lookupflag IgnoreMarks; sub a b by a_b;, whose cluster
                // has the acute it skips
                // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsDeletionThenLigature.ttf -u 0063,0061,0301,0062
                // [9=0+500|5=0@-625,562+0]
                const IGNORE_MARKS = 0x0008;
                const ligatureLookup = {
                    lookupType: 4,
                    lookupFlag: IGNORE_MARKS,
                    subtables: [{ substFormat: 1, coverage: createCoverage([glyphIndexes.a]), ligatureSets: [[{ ligGlyph: glyphIndexes.a_b, components: [glyphB] }]] }]
                };
                const font = createLookupFlagsFont({ gsub: createLayoutTable('latn', 'calt', [0, 1], [deletionLookups[0], ligatureLookup]) });
                assert.deepStrictEqual(shapeClusters(font, 'ca\u{301}b'), [[glyphIndexes.a_b, 0, 4], [acute, 0, 4]]);
            });
        });
    });

    describe('arabic presentation forms', function() {
        // the font of test/lookup-flags-font.mjs; ccmp in DFLT and arab, like the language systems of the generator, the other
        // features in arab. Each glyph sequence of the clusters in visual order, see describeClusters
        const { lam, alef, reh, dal, fatha } = glyphIndexes;
        const lamAlef = glyphIndexes.lam_alef;
        const rehAlternate = glyphIndexes['reh.alt'];
        const dalAlternate = glyphIndexes['dal.alt'];

        // LookupFlagsArabicForms.ttf: ccmp sub lam alef by lam_alef; then sub lam by lam fatha; sub dal by dal fatha;
        // fina: sub dal by dal.alt; sub reh by reh.alt;, ccmp listing the lookups of the given indexes
        function createArabicFormsFont(ccmpLookupIndexes = [0, 1]) {
            const ligatureLookup = {
                lookupType: 4,
                lookupFlag: 0,
                subtables: [{ substFormat: 1, coverage: createCoverage([lam]), ligatureSets: [[{ ligGlyph: lamAlef, components: [alef] }]] }]
            };
            const lookups = [
                ligatureLookup,
                createMultipleLookup([dal, lam], [[dal, fatha], [lam, fatha]]),
                createSingleLookup([reh, dal], [rehAlternate, dalAlternate])
            ];
            const ccmp = ['ccmp', ccmpLookupIndexes];
            return createLookupFlagsFont({ gsub: createScriptsLayoutTable({ DFLT: [ccmp], arab: [ccmp, ['fina', [2]]] }, lookups) });
        }

        // LookupFlagsArabicFormsChaining.ttf: fina sub reh by reh.alt fatha; sub dal by dal.alt; (a lookup of type 2), init
        // lookupflag IgnoreMarks; sub [dal.alt reh.alt] lam' by lam.init;
        function createArabicFormsChainingFont() {
            const chainingLookup = {
                lookupType: 6,
                lookupFlag: 0x0008,
                subtables: [{
                    substFormat: 3,
                    backtrackCoverage: [createCoverage([dalAlternate, rehAlternate])],
                    inputCoverage: [createCoverage([lam])],
                    lookaheadCoverage: [],
                    lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 2 }]
                }]
            };
            const lookups = [
                createMultipleLookup([reh, dal], [[rehAlternate, fatha], [dalAlternate]]),
                chainingLookup,
                createSingleLookup([lam], [glyphIndexes['lam.init']])
            ];
            return createLookupFlagsFont({ gsub: createScriptsLayoutTable({ arab: [['fina', [0]], ['init', [1]]] }, lookups) });
        }

        // LookupFlagsArabicFormsNested.ttf: ccmp sub dal' lookup MULTIPLE_DAL_FATHA; (sub dal by dal fatha;), fina sub dal by
        // dal.alt; sub fatha by acute.alt;
        function createArabicFormsNestedFont() {
            const contextLookup = {
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{ substFormat: 3, coverages: [createCoverage([dal])], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }]
            };
            const lookups = [
                createMultipleLookup([dal], [[dal, fatha]]),
                contextLookup,
                createSingleLookup([fatha, dal], [glyphIndexes['acute.alt'], dalAlternate])
            ];
            return createLookupFlagsFont({ gsub: createScriptsLayoutTable({ DFLT: [['ccmp', [1]]], arab: [['ccmp', [1]], ['fina', [2]]] }, lookups) });
        }

        it('applies ccmp to a text of one arabic letter, like HarfBuzz', function() {
            // lam: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsArabicForms.ttf -u 0644
            // [14=0+0|18=0+500]: lam fatha
            assert.deepStrictEqual(describeClusters(createArabicFormsFont(), '\u{644}'), [[0, 1, [fatha, lam]]]);
        });

        it('does not apply ccmp to an arabic text with ccmp turned off, like HarfBuzz', function() {
            // lam, reh: hb-shape --no-glyph-names --cluster-level=1 --features=-kern,-ccmp LookupFlagsArabicForms.ttf -u 0644,0631
            // [20=1+500|18=0+500]: reh.alt, then lam
            const clusters = createArabicFormsFont().stringToGlyphClusters('\u{644}\u{631}', { features: { ccmp: false } });
            assert.deepStrictEqual(clusters.map(({ glyph, start }) => [glyph.index, start]), [[rehAlternate, 1], [lam, 0]]);
        });

        it('applies the form of a letter after a letter that ccmp decomposed, like HarfBuzz', function() {
            // lam, reh: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsArabicForms.ttf -u 0644,0631
            // [20=1+500|14=0+0|18=0+500]: reh.alt, then lam fatha
            assert.deepStrictEqual(describeClusters(createArabicFormsFont(), '\u{644}\u{631}'), [[1, 2, [rehAlternate]], [0, 1, [fatha, lam]]]);
        });

        it('keeps the other glyphs of a letter that ccmp decomposed when its form substitutes the first one, like HarfBuzz', function() {
            // lam, dal: -u 0644,062F: [14=1+0|17=1+500|14=0+0|18=0+500]: dal.alt fatha, then lam fatha
            assert.deepStrictEqual(describeClusters(createArabicFormsFont(), '\u{644}\u{62F}'), [[1, 2, [fatha, dalAlternate]], [0, 1, [fatha, lam]]]);
        });

        it('applies no form to a letter that a ccmp ligature deleted, and the form of the letters after it, like HarfBuzz', function() {
            // lam, alef, lam, reh: -u 0644,0627,0644,0631: [20=3+500|14=2+0|18=2+500|19=0+500]: the alef of the lam alef ligature
            // has no glyph, reh.alt
            assert.deepStrictEqual(describeClusters(createArabicFormsFont(), '\u{644}\u{627}\u{644}\u{631}'),
                [[3, 4, [rehAlternate]], [2, 3, [fatha, lam]], [0, 2, [lamAlef]]]);
        });

        it('keeps the clusters of the latin text around a ccmp ligature of an arabic text, like HarfBuzz', function() {
            // a, lam, alef, b: ccmp applies to the text outside the latin runs, and the ligature merges the clusters of lam and alef only
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsArabicForms.ttf -u 0061,0644,0627,0062
            // [1=0+500|19=1+500|2=3+500]: hb-shape takes the text as one latin run, the ligature is in the ccmp of latn too
            assert.deepStrictEqual(describeClusters(createArabicFormsFont(), 'a\u{644}\u{627}b'),
                [[0, 1, [glyphIndexes.a]], [1, 3, [lamAlef]], [3, 4, [glyphIndexes.b]]]);
        });

        it('matches the backtrack of a form rule on a letter that a multiple substitution changed, like HarfBuzz', function() {
            // the dal of lam, dal, lam, lam becomes dal.alt, a multiple substitution of one glyph, then the second lam lam.init
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsArabicFormsChaining.ttf -u 0644,062F,0644,0644
            // [18=3+500|25=2+500|17=1+500|18=0+500]
            const font = createArabicFormsChainingFont();
            assert.deepStrictEqual(describeClusters(font, '\u{644}\u{62F}\u{644}\u{644}'),
                [[3, 4, [lam]], [2, 3, [glyphIndexes['lam.init']]], [1, 2, [dalAlternate]], [0, 1, [lam]]]);
            // the reh of lam, reh, lam, lam becomes reh.alt fatha, the rule skips the fatha
            // -u 0644,0631,0644,0644: [18=3+500|25=2+500|14=1+0|20=1+500|18=0+500]
            assert.deepStrictEqual(describeClusters(font, '\u{644}\u{631}\u{644}\u{644}'),
                [[3, 4, [lam]], [2, 3, [glyphIndexes['lam.init']]], [1, 2, [fatha, rehAlternate]], [0, 1, [lam]]]);
        });

        it('applies the form of a letter to each glyph of its nested decomposition by ccmp, like HarfBuzz', function() {
            // lam, dal: the dal becomes dal fatha in ccmp, then each glyph takes the final form of dal, like the form mask HarfBuzz
            // copies to each glyph of a multiple substitution
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsArabicFormsNested.ttf -u 0644,062F
            // [11=1+0|17=1+500|18=0+500]
            assert.deepStrictEqual(describeClusters(createArabicFormsNestedFont(), '\u{644}\u{62F}'),
                [[1, 2, [glyphIndexes['acute.alt'], dalAlternate]], [0, 1, [lam]]]);
        });

        it('applies a ccmp lookup that the feature lists twice once, like HarfBuzz', function() {
            // LookupFlagsCcmpDuplicate.ttf: LookupFlagsArabicForms.ttf with ccmp listing sub lam by lam fatha; sub dal by dal fatha; twice
            // reh, dal: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsCcmpDuplicate.ttf -u 0631,062F
            // [14=1+0|15=1+500|13=0+500]: dal fatha, then reh
            const font = createArabicFormsFont([0, 1, 1]);
            assert.deepStrictEqual(describeClusters(font, '\u{631}\u{62F}'), [[1, 2, [fatha, dal]], [0, 1, [reh]]]);
            // dal, reh: -u 062F,0631: [13=1+500|14=0+0|15=0+500]
            assert.deepStrictEqual(describeClusters(font, '\u{62F}\u{631}'), [[1, 2, [reh]], [0, 1, [fatha, dal]]]);
        });

        it('does not apply the form lookup again at the glyphs of its own multiple substitution, like HarfBuzz', function() {
            // LookupFlagsArabicFormsMultiple.ttf: fina sub reh by reh.alt fatha; sub fatha by acute.alt; (one lookup of type 2)
            // lam, reh: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsArabicFormsMultiple.ttf -u 0644,0631
            // [14=1+0|20=1+500|18=0+500]: reh.alt fatha, then lam
            const lookups = [createMultipleLookup([reh, fatha], [[rehAlternate, fatha], [glyphIndexes['acute.alt']]])];
            const font = createLookupFlagsFont({ gsub: createScriptsLayoutTable({ arab: [['fina', [0]]] }, lookups) });
            assert.deepStrictEqual(describeClusters(font, '\u{644}\u{631}'), [[1, 2, [fatha, rehAlternate]], [0, 1, [lam]]]);
        });

        it('applies the form of a letter at its next glyph after the form deleted its first one, like HarfBuzz', function() {
            // LookupFlagsArabicFormsDeletion.ttf: ccmp sub dal by dal fatha;, fina sub dal by NULL; sub fatha by acute.alt; (one
            // lookup of type 2)
            // lam, dal: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsArabicFormsDeletion.ttf -u 0644,062F
            // [11=1+0|18=0+500]: acute.alt, then lam
            const acuteAlternate = glyphIndexes['acute.alt'];
            const lookups = [createMultipleLookup([dal], [[dal, fatha]]), createMultipleLookup([fatha, dal], [[acuteAlternate], []])];
            const font = createLookupFlagsFont({ gsub: createScriptsLayoutTable({ DFLT: [['ccmp', [0]]], arab: [['ccmp', [0]], ['fina', [1]]] }, lookups) });
            assert.deepStrictEqual(describeClusters(font, '\u{644}\u{62F}'), [[1, 2, [acuteAlternate]], [0, 1, [lam]]]);
        });

        // LookupFlagsMediContext.ttf: medi sub lam' lookup SUB_LAM lam'; (sub lam by lam.init;)
        function createMediContextFont() {
            const contextLookup = {
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{ substFormat: 3, coverages: createCoverages([lam, lam]), lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }]
            };
            const lookups = [createSingleLookup([lam], [glyphIndexes['lam.init']]), contextLookup];
            return createLookupFlagsFont({ gsub: createScriptsLayoutTable({ arab: [['medi', [1]]] }, lookups) });
        }

        it('goes on after the input of a contextual rule of a form lookup, like HarfBuzz', function() {
            // six lams: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsMediContext.ttf -u 0644,0644,0644,0644,0644,0644
            // [18=5+500|18=4+500|25=3+500|18=2+500|25=1+500|18=0+500]
            const lamInitial = glyphIndexes['lam.init'];
            assert.deepStrictEqual(describeClusters(createMediContextFont(), '\u{644}'.repeat(6)),
                [[5, 6, [lam]], [4, 5, [lam]], [3, 4, [lamInitial]], [2, 3, [lam]], [1, 2, [lamInitial]], [0, 1, [lam]]]);
        });

        itFailsUntilFixed('matches the later input glyphs of a contextual rule of a form at the letters of that form only, like HarfBuzz',
            'applyLookupToTokens (src/features/applySubstitution.mjs) checks the form at the first input glyph of a rule only: ' +
            'FeatureQuery matches the later input glyphs whatever their form, HarfBuzz matches them with the form mask',
            function() {
                // the second input lam is final: hb-shape --no-glyph-names --cluster-level=1 --features=-kern
                // LookupFlagsMediContext.ttf -u 0644,0644,0644 [18=2+500|18=1+500|18=0+500]
                assert.deepStrictEqual(createMediContextFont().stringToGlyphIndexes('\u{644}'.repeat(3)), [lam, lam, lam]);
            });

        itFailsUntilFixed('forms a ligature of a form with components of that form only, like HarfBuzz',
            'applyLookupToTokens (src/features/applySubstitution.mjs) checks the form at the first glyph of a ligature only: ' +
            'FeatureQuery matches its components whatever their form, HarfBuzz matches them with the form mask',
            function() {
                // LookupFlagsInitLigature.ttf: init sub lam alef by lam_alef;, the alef is final
                // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsInitLigature.ttf -u 0644,0627
                // [12=1+500|18=0+500]
                const ligatureLookup = {
                    lookupType: 4,
                    lookupFlag: 0,
                    subtables: [{ substFormat: 1, coverage: createCoverage([lam]), ligatureSets: [[{ ligGlyph: lamAlef, components: [alef] }]] }]
                };
                const font = createLookupFlagsFont({ gsub: createScriptsLayoutTable({ arab: [['init', [0]]] }, [ligatureLookup]) });
                assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{627}'), [alef, lam]);
            });

        it('applies each lookup of a form at the glyph that the lookup before it substituted, like HarfBuzz', function() {
            // LookupFlagsFinaChain.ttf: fina sub dal by dal.alt; then sub dal.alt by reh.alt;
            // lam, dal: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsFinaChain.ttf -u 0644,062F
            // [20=1+500|18=0+500]
            const lookups = [createSingleLookup([dal], [dalAlternate]), createSingleLookup([dalAlternate], [rehAlternate])];
            const font = createLookupFlagsFont({ gsub: createScriptsLayoutTable({ arab: [['fina', [0, 1]]] }, lookups) });
            assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{62F}'), [rehAlternate, lam]);
            // --features=-kern,-fina -u 0644,062F [15=1+500|18=0+500]
            assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{62F}', { features: { fina: false } }), [dal, lam]);
        });

        describe('the order of the form stages', function() {
            // a font of the generator whose rule of a form (lookup 0, sub <input>' <lookahead> by <substitute>;, a
            // ChainContextSubst of format 3 and its nested lookup 1) has the substitute of another form as its lookahead
            // (lookup 2): the rule matches only after the stage of the other form, like the stages of collect_features_arabic
            // of HarfBuzz (isol, fina, medi, then init), whatever the lookup list order
            function createFormOrderFont({ ruleTag, inputGlyph, lookaheadGlyph, substitute, formTag, formLookup }) {
                const chainingLookup = {
                    lookupType: 6,
                    lookupFlag: 0,
                    subtables: [{
                        substFormat: 3,
                        backtrackCoverage: [],
                        inputCoverage: [createCoverage([inputGlyph])],
                        lookaheadCoverage: [createCoverage([lookaheadGlyph])],
                        lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 1 }]
                    }]
                };
                const lookups = [chainingLookup, createSingleLookup([inputGlyph], [substitute]), formLookup];
                return createLookupFlagsFont({ gsub: createScriptsLayoutTable({ arab: [[ruleTag, [0]], [formTag, [2]]] }, lookups) });
            }

            const lamInitial = glyphIndexes['lam.init'];

            it('applies the final form before the medial form, like HarfBuzz', function() {
                // LookupFlagsFinaThenMedi.ttf: medi sub lam' dal.alt by lam.init;, fina sub dal by dal.alt;
                const font = createFormOrderFont({
                    ruleTag: 'medi',
                    inputGlyph: lam,
                    lookaheadGlyph: dalAlternate,
                    substitute: lamInitial,
                    formTag: 'fina',
                    formLookup: createSingleLookup([dal], [dalAlternate])
                });
                // lam, lam, dal: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsFinaThenMedi.ttf
                // -u 0644,0644,062F [17=2+500|25=1+500|18=0+500]
                assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{644}\u{62F}'), [dalAlternate, lamInitial, lam]);
                // --features=-kern,-fina -u 0644,0644,062F [15=2+500|18=1+500|18=0+500]
                assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{644}\u{62F}', { features: { fina: false } }), [dal, lam, lam]);
            });

            it('applies the medial form before the initial form, like HarfBuzz', function() {
                // LookupFlagsMediThenInit.ttf: init sub lam' reh.alt by lam.init;, medi sub lam by reh.alt;
                const font = createFormOrderFont({
                    ruleTag: 'init',
                    inputGlyph: lam,
                    lookaheadGlyph: rehAlternate,
                    substitute: lamInitial,
                    formTag: 'medi',
                    formLookup: createSingleLookup([lam], [rehAlternate])
                });
                // lam, lam, dal: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsMediThenInit.ttf
                // -u 0644,0644,062F [15=2+500|20=1+500|25=0+500]
                assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{644}\u{62F}'), [dal, rehAlternate, lamInitial]);
                // --features=-kern,-medi -u 0644,0644,062F [15=2+500|18=1+500|18=0+500]
                assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{644}\u{62F}', { features: { medi: false } }), [dal, lam, lam]);
            });

            it('applies the isolated form before the final form, like HarfBuzz', function() {
                // LookupFlagsIsolThenFina.ttf: fina sub dal' reh.alt by dal.alt;, isol sub dal by reh.alt;
                const font = createFormOrderFont({
                    ruleTag: 'fina',
                    inputGlyph: dal,
                    lookaheadGlyph: rehAlternate,
                    substitute: dalAlternate,
                    formTag: 'isol',
                    formLookup: createSingleLookup([dal], [rehAlternate])
                });
                // lam, dal, dal: the first dal is final, the second one isolated, after a right-joining letter
                // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsIsolThenFina.ttf -u 0644,062F,062F
                // [20=2+500|17=1+500|18=0+500]
                assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{62F}\u{62F}'), [rehAlternate, dalAlternate, lam]);
                // --features=-kern,-isol -u 0644,062F,062F [15=2+500|15=1+500|18=0+500]
                assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{62F}\u{62F}', { features: { isol: false } }), [dal, dal, lam]);
            });
        });

        describe('a required feature tagged as a form', function() {
            // the font of test/lookup-flags-font.mjs whose arab has fina and the required feature (ReqFeatureIndex) of a
            // second feature tagged fina, with the lookups of the lookup list given
            function createRequiredFinaFont(lookups, finaLookupIndexes, requiredLookupIndexes) {
                const gsub = createScriptsLayoutTable({ arab: [['fina', finaLookupIndexes]] }, lookups);
                gsub.features.push({ tag: 'fina', feature: { featureParams: 0, lookupListIndexes: requiredLookupIndexes } });
                gsub.scripts[0].script.defaultLangSys.reqFeatureIndex = 1;
                return createLookupFlagsFont({ gsub });
            }

            const lamInitial = glyphIndexes['lam.init'];

            it('applies its lookups and the ones of the form in lookup list order, its own ones at every glyph, like HarfBuzz', function() {
                // LookupFlagsRequiredFina.ttf: the required feature sub lam by lam.init; (lookup 0), fina sub lam by dal.alt;
                // (lookup 1): hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsRequiredFina.ttf
                // -u 0644,0644 [25=1+500|25=0+500], the same with --features=-kern,-fina
                const lookups = [createSingleLookup([lam], [lamInitial]), createSingleLookup([lam], [dalAlternate])];
                const font = createRequiredFinaFont(lookups, [1], [0]);
                assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{644}'), [lamInitial, lamInitial]);
                assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{644}', { features: { fina: false } }), [lamInitial, lamInitial]);
            });

            it('applies a lookup that it shares with the form once, at every glyph, like HarfBuzz', function() {
                // LookupFlagsRequiredFinaShared.ttf: fina and the required feature sub lam by lam.init; sub lam.init by dal.alt;
                // (one lookup): hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsRequiredFinaShared.ttf
                // -u 0644,0644 [25=1+500|25=0+500], the same with --features=-kern,-fina
                const lookups = [createSingleLookup([lam, lamInitial], [lamInitial, dalAlternate])];
                const font = createRequiredFinaFont(lookups, [0], [0]);
                assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{644}'), [lamInitial, lamInitial]);
                assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{644}', { features: { fina: false } }), [lamInitial, lamInitial]);
            });
        });

        it('matches the lookahead of a form rule across the space after an arabic word, like HarfBuzz', function() {
            // LookupFlagsFinaAcrossSpace.ttf: fina sub dal' lookup DAL_ALT .notdef lam; (sub dal by dal.alt;), the space has no
            // glyph in the font; feaLib builds a ChainContextSubst of format 1
            const chainingLookup = {
                lookupType: 6,
                lookupFlag: 0,
                subtables: [{
                    substFormat: 1,
                    coverage: createCoverage([dal]),
                    chainRuleSets: [[{ backtrack: [], input: [], lookahead: [0, lam], lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }]]
                }]
            };
            const lookups = [createSingleLookup([dal], [dalAlternate]), chainingLookup];
            const font = createLookupFlagsFont({ gsub: createScriptsLayoutTable({ arab: [['fina', [1]]] }, lookups) });
            // HarfBuzz gives the space the glyph 0, like the cmap of a parsed font, not the null glyph index of a character
            // missing from the glyphs of a font built in memory
            font.glyphs.get(0).addUnicode(0x20);
            // lam, dal, space, lam: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsFinaAcrossSpace.ttf
            // -u 0644,062F,0020,0644 [18=3+500|0=2+500|17=1+500|18=0+500]
            assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{62F} \u{644}'), [lam, 0, dalAlternate, lam]);
            // lam, dal, space, dal: -u 0644,062F,0020,062F [15=3+500|0=2+500|15=1+500|18=0+500]
            assert.deepStrictEqual(font.stringToGlyphIndexes('\u{644}\u{62F} \u{62F}'), [dal, 0, dal, lam]);
        });

        it('applies each form lookup once over the whole arabic run, in one context, whatever the length of the run', function() {
            // the contexts that the lookups of the forms see: one for each form lookup, init and fina of
            // createArabicJoiningFont, not one for each letter
            const font = createArabicJoiningFont();
            const lookupSubstitution = FeatureQuery.prototype.lookupSubstitution;
            const getFormContexts = text => {
                const contexts = new Set();
                let calls = 0;
                FeatureQuery.prototype.lookupSubstitution = function(lookupTable, contextParams, tag) {
                    contexts.add(contextParams);
                    calls++;
                    return lookupSubstitution.call(this, lookupTable, contextParams, tag);
                };
                try {
                    font.stringToGlyphIndexes(text);
                } finally {
                    FeatureQuery.prototype.lookupSubstitution = lookupSubstitution;
                }
                return { contexts: contexts.size, calls };
            };
            // lam, dal and a space: the initial lam and the final dal of each word, the lookup tried at the letters of its
            // form only
            assert.deepStrictEqual(getFormContexts('\u{644}\u{62F} '.repeat(10)), { contexts: 2, calls: 20 });
            assert.deepStrictEqual(getFormContexts('\u{644}\u{62F} '.repeat(1000)), { contexts: 2, calls: 2000 });
        });

        it('reverses the glyphs of a multiple substitution of a right-to-left run, like HarfBuzz', function() {
            // -u 0644,0631: [20=1+500|14=0+0|18=0+500]
            assert.deepStrictEqual(createArabicFormsFont().stringToGlyphIndexes('\u{644}\u{631}'), [rehAlternate, fatha, lam]);
        });

        it('lays out the mark of a letter that ccmp decomposed before the letter, on the letter, like HarfBuzz', function() {
            // the alef with hamza below, decomposed by the ccmp of arab of Scheherazade-Bold.ttf into the alef and the hamza:
            // hb-shape --shapers=ot --no-glyph-names --cluster-level=1 --features=-kern Scheherazade-Bold.ttf -u 0625
            // [1088=0@13,-92+0|273=0+357], the mark offset by its GPOS mark attachment (the y of forEachGlyph goes down)
            const glyphPositions = [];
            arabicFont.forEachGlyph('\u{625}', 0, 0, arabicFont.unitsPerEm, { kerning: false }, (glyph, glyphX, glyphY) => {
                glyphPositions.push([glyph.index, glyphX, glyphY]);
            });
            assert.deepStrictEqual(glyphPositions, [[1088, 13, 92], [273, 0, 0]]);
        });

        // LookupFlagsArabicJoining.ttf: init sub lam by lam.init;, fina sub dal by dal.alt;, no glyph for U+0621 and U+0629
        function createArabicJoiningFont() {
            const lookups = [createSingleLookup([lam], [glyphIndexes['lam.init']]), createSingleLookup([dal], [dalAlternate])];
            return createLookupFlagsFont({ gsub: createScriptsLayoutTable({ arab: [['init', [0]], ['fina', [1]]] }, lookups) });
        }

        it('joins a letter to a zero width joiner, and not to a zero width non-joiner, like HarfBuzz', function() {
            const font = createArabicJoiningFont();
            const glyphOfChar = (text, start) => font.stringToGlyphClusters(text).find(cluster => cluster.start === start).glyph.index;
            // the zero width joiner has no glyph in the font, so HarfBuzz removes it: lam, zero width joiner:
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsArabicJoining.ttf -u 0644,200D [25=0+500]
            assert.strictEqual(glyphOfChar('\u{644}\u{200D}', 0), glyphIndexes['lam.init']);
            // zero width joiner, dal: -u 200D,062F [17=0+500]
            assert.strictEqual(glyphOfChar('\u{200D}\u{62F}', 1), dalAlternate);
            // lam, zero width non-joiner, dal: -u 0644,200C,062F [15=1+500|18=0+500]
            assert.deepStrictEqual([glyphOfChar('\u{644}\u{200C}\u{62F}', 0), glyphOfChar('\u{644}\u{200C}\u{62F}', 2)], [lam, dal]);
        });

        it('applies no initial form to a dual-joining letter before a non-joining hamza, like HarfBuzz', function() {
            // lam, hamza: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsArabicJoining.ttf -u 0644,0621
            // [0=1+500|18=0+500]: lam stays isolated
            assert.deepStrictEqual(describeClusters(createArabicJoiningFont(), '\u{644}\u{621}'), [[1, 2, [0]], [0, 1, [lam]]]);
        });

        it('applies no final form to a letter after a right-joining teh marbuta, like HarfBuzz', function() {
            // teh marbuta, dal: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsArabicJoining.ttf -u 0629,062F
            // [15=1+500|0=0+500]: dal stays isolated
            assert.deepStrictEqual(describeClusters(createArabicJoiningFont(), '\u{629}\u{62F}'), [[1, 2, [dal]], [0, 1, [0]]]);
        });
    });

    describe('arabic required ligatures', function() {
        const { reh, dal, fatha } = glyphIndexes;
        const dalAlternate = glyphIndexes['dal.alt'];

        it('applies a later lookup of rlig to the glyphs of a multiple substitution, like HarfBuzz', function() {
            // LookupFlagsRligAfterMultiple.ttf: rlig MULTIPLE_DAL (sub dal by dal.alt fatha;) then SUB_FATHA (sub fatha by acute.alt;)
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsRligAfterMultiple.ttf -u 0631,062F
            // [11=1+0|17=1+500|13=0+500]
            const acuteAlternate = glyphIndexes['acute.alt'];
            const lookups = [createMultipleLookup([dal], [[dalAlternate, fatha]]), createSingleLookup([fatha], [acuteAlternate])];
            const font = createLookupFlagsFont({ gsub: createLayoutTable('arab', 'rlig', [0, 1], lookups) });
            assert.deepStrictEqual(describeClusters(font, '\u{631}\u{62F}'), [[1, 2, [acuteAlternate, dalAlternate]], [0, 1, [reh]]]);
        });

        it('applies a later lookup of rlig to the substitute of an earlier one, like HarfBuzz', function() {
            // LookupFlagsRligChain.ttf: rlig DAL_ALT (sub dal by dal.alt;) then DAL_ALT_REH (sub dal.alt by reh.alt;)
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsRligChain.ttf -u 0631,062F
            // [20=1+500|13=0+500]
            const lookups = [createSingleLookup([dal], [dalAlternate]), createSingleLookup([dalAlternate], [glyphIndexes['reh.alt']])];
            const font = createLookupFlagsFont({ gsub: createLayoutTable('arab', 'rlig', [0, 1], lookups) });
            assert.deepStrictEqual(font.stringToGlyphIndexes('\u{631}\u{62F}'), [glyphIndexes['reh.alt'], reh]);
        });

        it('applies the lookups of rlig in lookup list order, not in the order of the feature, like HarfBuzz', function() {
            // LookupFlagsRligUnsorted.ttf: rlig lists DAL_ALT (sub dal by dal.alt;, lookup 1) then DAL_ALT_REH (sub dal.alt by
            // reh.alt;, lookup 0), so DAL_ALT_REH applies first and does not see the dal.alt of DAL_ALT
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsRligUnsorted.ttf -u 0631,062F: [17=1+500|13=0+500]
            const lookups = [createSingleLookup([dalAlternate], [glyphIndexes['reh.alt']]), createSingleLookup([dal], [dalAlternate])];
            const font = createLookupFlagsFont({ gsub: createLayoutTable('arab', 'rlig', [1, 0], lookups) });
            assert.deepStrictEqual(describeClusters(font, '\u{631}\u{62F}'), [[1, 2, [dalAlternate]], [0, 1, [reh]]]);
            // -u 062F,0631: [13=1+500|17=0+500]
            assert.deepStrictEqual(describeClusters(font, '\u{62F}\u{631}'), [[1, 2, [reh]], [0, 1, [dalAlternate]]]);
        });

        it('applies a later lookup of rlig at the other input glyphs of a contextual rule of an earlier one, like HarfBuzz', function() {
            // LookupFlagsRligContextThenLigature.ttf: rlig CONTEXT_DAL_LAM (sub dal' lookup DAL_ALT lam';) then LIGATURE_LAM_ALEF
            // (sub lam alef by lam_alef;), whose ligature starts at the lam of the input of the rule
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsRligContextThenLigature.ttf -u 062F,0644,0627
            // [19=1+500|17=0+500]
            const { lam, alef, lam_alef: lamAlef } = glyphIndexes;
            const contextLookup = {
                lookupType: 5,
                lookupFlag: 0,
                subtables: [{ substFormat: 3, coverages: createCoverages([dal, lam]), lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }]
            };
            const ligatureLookup = {
                lookupType: 4,
                lookupFlag: 0,
                subtables: [{ substFormat: 1, coverage: createCoverage([lam]), ligatureSets: [[{ ligGlyph: lamAlef, components: [alef] }]] }]
            };
            const lookups = [createSingleLookup([dal], [dalAlternate]), contextLookup, ligatureLookup];
            const font = createLookupFlagsFont({ gsub: createLayoutTable('arab', 'rlig', [1, 2], lookups) });
            assert.deepStrictEqual(describeClusters(font, '\u{62F}\u{644}\u{627}'), [[1, 3, [lamAlef]], [0, 1, [dalAlternate]]]);
        });
    });

    describe('ccmp of a latin text', function() {
        it('applies ccmp once, with the latin features, to a font that has ccmp in DFLT and in latn, like HarfBuzz', function() {
            // ccmp: sub c by a c; (MULTIPLE_C_A_C of ss28), in DFLT and latn
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern,+ss28 LookupFlags.ttf -u 0063,0062: [1=0+500|3=0+500|2=1+500]
            const { a: glyphA, b: glyphB, c: glyphC } = glyphIndexes;
            const lookups = [createMultipleLookup([glyphC], [[glyphA, glyphC]])];
            const font = createLookupFlagsFont({ gsub: createScriptsLayoutTable({ DFLT: [['ccmp', [0]]], latn: [['ccmp', [0]]] }, lookups) });
            const clusters = font.stringToGlyphClusters('cb').map(({ glyph, start, end }) => [glyph.index, start, end]);
            assert.deepStrictEqual(clusters, [[glyphA, 0, 1], [glyphC, 0, 1], [glyphB, 1, 2]]);
        });
    });

    describe('thai features', function() {
        // the font of test/lookup-flags-font.mjs, the features in DFLT and in thai, like the language systems of the fonts of
        // the generator with thai; U+0E01 and U+0E02 map to kokai and khokhai
        const { a: glyphA, kokai, khokhai, maiek } = glyphIndexes;
        const maiekAlternate = glyphIndexes['maiek.alt'];
        const multipleKokaiLookup = createMultipleLookup([kokai], [[kokai, maiek]]);
        const subMaiekLookup = createSingleLookup([maiek], [maiekAlternate]);
        const createThaiFont = (features, lookups) => createLookupFlagsFont({ gsub: createScriptsLayoutTable({ DFLT: features, thai: features }, lookups) });
        const shapeClusters = (font, text) => font.stringToGlyphClusters(text).map(({ glyph, start, end }) => [glyph.index, start, end]);

        it('applies ccmp once, with the thai features, to a font that has ccmp in DFLT and in thai, like HarfBuzz', function() {
            // LookupFlagsThaiCcmp.ttf: ccmp sub kokai by kokai maiek;, whose glyphs start with its input glyph
            const font = createThaiFont([['ccmp', [0]]], [multipleKokaiLookup]);
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsThaiCcmp.ttf -u 0E01,0E02
            // [26=0+500|28=0+0|27=1+500]
            assert.deepStrictEqual(shapeClusters(font, '\u{E01}\u{E02}'), [[kokai, 0, 1], [maiek, 0, 1], [khokhai, 1, 2]]);
            // -u 0061,0E01,0E02: [1=0+500|26=1+500|28=1+0|27=2+500]
            assert.deepStrictEqual(shapeClusters(font, 'a\u{E01}\u{E02}'), [[glyphA, 0, 1], [kokai, 1, 2], [maiek, 1, 2], [khokhai, 2, 3]]);
        });

        it('applies a later ccmp lookup of a thai text to each glyph of a multiple substitution, like HarfBuzz', function() {
            // LookupFlagsThaiCcmpChain.ttf: ccmp sub kokai by kokai maiek; then sub maiek by maiek.alt;
            const font = createThaiFont([['ccmp', [0, 1]]], [multipleKokaiLookup, subMaiekLookup]);
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsThaiCcmpChain.ttf -u 0E01,0E01
            // [26=0+500|29=0+0|26=1+500|29=1+0]
            assert.deepStrictEqual(shapeClusters(font, '\u{E01}\u{E01}'), [[kokai, 0, 1], [maiekAlternate, 0, 1], [kokai, 1, 2], [maiekAlternate, 1, 2]]);
        });

        it('applies the lookups of ccmp, rlig and liga of a thai text in lookup list order, not feature by feature, like HarfBuzz', function() {
            // LookupFlagsThaiFeatures.ttf: the lookups sub kokai by kokai maiek; (ccmp), sub maiek by maiek.alt; (rlig) and
            // sub kokai maiek.alt by kokai_maiek; (liga), each one substituting the glyphs of the one before it
            const ligatureLookup = {
                lookupType: 4,
                lookupFlag: 0,
                subtables: [{ substFormat: 1, coverage: createCoverage([kokai]), ligatureSets: [[{ ligGlyph: glyphIndexes.kokai_maiek, components: [maiekAlternate] }]] }]
            };
            const font = createThaiFont([['ccmp', [0]], ['rlig', [1]], ['liga', [2]]], [multipleKokaiLookup, subMaiekLookup, ligatureLookup]);
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsThaiFeatures.ttf -u 0E01,0E02
            // [30=0+500|27=1+500]
            assert.deepStrictEqual(shapeClusters(font, '\u{E01}\u{E02}'), [[glyphIndexes.kokai_maiek, 0, 1], [khokhai, 1, 2]]);
        });

        it('turns a thai feature off with the features option, like HarfBuzz', function() {
            const ligatureLookup = {
                lookupType: 4,
                lookupFlag: 0,
                subtables: [{ substFormat: 1, coverage: createCoverage([kokai]), ligatureSets: [[{ ligGlyph: glyphIndexes.kokai_maiek, components: [maiekAlternate] }]] }]
            };
            const font = createThaiFont([['ccmp', [0]], ['rlig', [1]], ['liga', [2]]], [multipleKokaiLookup, subMaiekLookup, ligatureLookup]);
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern,-liga LookupFlagsThaiFeatures.ttf -u 0E01,0E02
            // [26=0+500|29=0+0|27=1+500]
            assert.deepStrictEqual(font.stringToGlyphIndexes('\u{E01}\u{E02}', { features: { liga: false } }), [kokai, maiekAlternate, khokhai]);
        });

        it('applies ccmp to a text of one thai letter, like HarfBuzz', function() {
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsThaiCcmp.ttf -u 0E01: [26=0+500|28=0+0]
            const font = createThaiFont([['ccmp', [0]]], [multipleKokaiLookup]);
            assert.deepStrictEqual(shapeClusters(font, '\u{E01}'), [[kokai, 0, 1], [maiek, 0, 1]]);
            // --features=-kern,-ccmp -u 0E01: [26=0+500]
            assert.deepStrictEqual(font.stringToGlyphIndexes('\u{E01}', { features: { ccmp: false } }), [kokai]);
        });
    });

    describe('script runs', function() {
        // TestScriptLanguage.ttf, generated by test/generate-script-language-font.py (see its docstring for its lookups):
        // ccmp of arab sub beh by beh.ccmp; (not in the language system URD), locl of arab URD sub fourarabic by
        // fourarabic.urdu;. The references are hb-shape --cluster-level=1 TestScriptLanguage.ttf with the given options;
        // hb-shape lays a right-to-left buffer out in reverse order, digits included, the fork lays out the digits after
        // an arabic word from left to right, like the Unicode bidi algorithm
        let font;
        let bidi;
        const glyphNames = (text, options) => font.stringToGlyphs(text, options).map(glyph => glyph.name);
        const runTexts = () => bidi.scriptRuns.map(run => run.tokens.map(token => token.char).join(''));

        beforeEach(function() {
            font = loadSync('./test/fonts/TestScriptLanguage.ttf');
            bidi = new Bidi();
            bidi.registerModifier('glyphIndex', null, token => font.charToGlyphIndex(token.char));
        });

        it('gives each glyph the script run of its character, with the OpenType script tags of the run', function() {
            bidi.applyFeatures(font, font.defaultRenderOptions.features);
            // the digits and the space before the first character of a script in its run, the space and the acute after
            // a character of a script in its run
            const clusters = bidi.getTextGlyphClusters('12 \u{431} a\u{301}\u{E01}');
            assert.deepStrictEqual(clusters.map(cluster => cluster.scriptRun.scriptTags), [
                ['cyrl'], ['cyrl'], ['cyrl'], ['cyrl'], ['cyrl'], ['latn'], ['latn'], ['thai']
            ]);
            assert.deepStrictEqual(runTexts(), ['12 \u{431} ', 'a\u{301}', '\u{E01}']);
            // a text of no script
            assert.deepStrictEqual(bidi.getTextGlyphClusters('12').map(cluster => cluster.scriptRun.scriptTags), [['DFLT'], ['DFLT']]);
        });

        it('shapes the whole text as one script run with the script tag of the script option, like HarfBuzz', function() {
            bidi.applyFeatures(font, font.defaultRenderOptions.features, { script: 'grek' });
            const clusters = bidi.getTextGlyphClusters('a\u{431}');
            assert.deepStrictEqual(clusters.map(cluster => cluster.scriptRun.scriptTags), [['grek'], ['grek']]);
            assert.deepStrictEqual(runTexts(), ['a\u{431}']);
        });

        it('shapes the text of the script option with the shaper of its script tag, like HarfBuzz', function() {
            // the arabic features, where calt applies in a stage of its own before liga in the language system URD, which
            // has no rclt: --script=arab --language=ur -u 0033,0034 [four=1+500|three.calt=0+500]
            assert.deepStrictEqual(glyphNames('34', { script: 'arab', language: 'URD' }), ['three.calt', 'four']);
            // the latin features: --language=ur -u 0033,0034 [three_four=0+500]
            assert.deepStrictEqual(glyphNames('34', { language: 'URD' }), ['three_four']);
            // no arabic forms with latn, the direction of the text still right-to-left: --script=latn --direction=rtl
            // -u 0633,062F [dal=1+500|seen=0+500]
            assert.deepStrictEqual(glyphNames('\u{633}\u{62F}', { script: 'latn' }), ['dal', 'seen']);
        });

        it('puts a tatweel between a Latin word and an Arabic letter in the run of the Arabic letter, like Chromium', function() {
            bidi.applyFeatures(font, font.defaultRenderOptions.features);
            bidi.getTextGlyphs('a \u{640}\u{633}');
            assert.deepStrictEqual(runTexts(), ['a ', '\u{640}\u{633}']);
            // the Arabic run: --script=arab -u 0640,0633 [seen.fina=1+500|tatweel.init=0+500]
            assert.deepStrictEqual(glyphNames('a \u{640}\u{633}'), ['a', 'space', 'seen.fina', 'tatweel.init']);
        });

        it('puts an Arabic haraka between a Latin letter and an Arabic letter in the run of the Arabic letter, like Chromium', function() {
            bidi.applyFeatures(font, font.defaultRenderOptions.features);
            bidi.getTextGlyphs('a\u{64E}\u{633}\u{62F}');
            assert.deepStrictEqual(runTexts(), ['a', '\u{64E}\u{633}\u{62F}']);
            // after a tatweel too, which joins the seen: the Arabic run --script=arab -u 0640,064E,0633
            // [seen.fina=2+500|.notdef=1+500|tatweel.init=0+500]
            assert.deepStrictEqual(glyphNames('a\u{640}\u{64E}\u{633}'), ['a', 'seen.fina', '.notdef', 'tatweel.init']);
        });

        it('applies no arabic form to a character of the script run before the arabic run, like HarfBuzz', function() {
            // the tatweel after the Syriac alaph is in the Syriac run, shaped with the features of its own script: --script=syrc
            // --unicodes-after=0633 -u 0710,0640 [tatweel=1+500|.notdef=0+500], not the tatweel.init of the arabic word
            const tatweelCluster = font.stringToGlyphClusters('\u{710}\u{640}\u{633}').find(cluster => cluster.start === 1);
            assert.strictEqual(tatweelCluster.glyph.name, 'tatweel');
        });

        itFailsUntilFixed('joins an arabic letter to the character of no script before it in the script run before, like HarfBuzz',
            'applyArabicFeatures (src/bidi.mjs): arabicPresentationForms takes the tokens of the script run, without ' +
            'the joining pre-context of the run before it, so the seen after the tatweel of the Syriac run takes no final form',
            function() {
                // the tatweel after the Syriac alaph is in the Syriac run, whose script its Script_Extensions have. With the
                // pre-context that a browser gives HarfBuzz, the seen joins the tatweel: --script=arab
                // --unicodes-before=0710,0640 -u 0633 [seen.fina=0+500]
                const seenCluster = font.stringToGlyphClusters('\u{710}\u{640}\u{633}').find(cluster => cluster.start === 2);
                assert.strictEqual(seenCluster.glyph.name, 'seen.fina');
            });

        it('applies ccmp to a text of one arabic letter, with the language system of the language option, like HarfBuzz', function() {
            // hb-shape --no-glyph-names --cluster-level=1 TestScriptLanguage.ttf -u 0628: [27=0+500]
            assert.deepStrictEqual(glyphNames('\u{628}'), ['beh.ccmp']);
            // --features=-ccmp -u 0628: [13=0+500]
            assert.deepStrictEqual(glyphNames('\u{628}', { features: { ccmp: false } }), ['beh']);
            // the language system URD has no ccmp: --language=ur -u 0628: [13=0+500]
            assert.deepStrictEqual(glyphNames('\u{628}', { language: 'URD' }), ['beh']);
        });

        it('applies rvrn to an arabic text in a stage of its own before ccmp, like the Arabic shaper of HarfBuzz', function() {
            // the ccmp of teh is before its rvrn in the lookup list: -u 062A [teh.rvrn=0+500]
            assert.deepStrictEqual(glyphNames('\u{62A}'), ['teh.rvrn']);
            // --features=-rvrn -u 062A [teh.ccmp=0+500]
            assert.deepStrictEqual(glyphNames('\u{62A}', { features: { rvrn: false } }), ['teh.ccmp']);
        });

        it('turns the arabic forms, rlig and the other arabic features on and off with the features option, like HarfBuzz', function() {
            // -u 0633,062F [dal.fina=1+500|seen.init=0+500]
            assert.deepStrictEqual(glyphNames('\u{633}\u{62F}'), ['dal.fina', 'seen.init']);
            // --features=-fina -u 0633,062F [dal=1+500|seen.init=0+500]
            assert.deepStrictEqual(glyphNames('\u{633}\u{62F}', { features: { fina: false } }), ['dal', 'seen.init']);
            // -u 0631 [reh.rlig=0+500], --features=-rlig [reh=0+500]
            assert.deepStrictEqual(glyphNames('\u{631}'), ['reh.rlig']);
            assert.deepStrictEqual(glyphNames('\u{631}', { features: { rlig: false } }), ['reh']);
            // -u 062F [dal=0+500], --features=+ss01 [dal.ss01=0+500]
            assert.deepStrictEqual(glyphNames('\u{62F}'), ['dal']);
            assert.deepStrictEqual(glyphNames('\u{62F}', { features: { ss01: true } }), ['dal.ss01']);
        });

        it('applies the arabic forms and rlig of the language system of the language option, like HarfBuzz', function() {
            // URD has fina dal.fina.urdu and rlig reh.rlig.urdu, and no init: --language=ur -u 0633,062F
            // [dal.fina.urdu=1+500|seen=0+500], --language=ur -u 0631 [reh.rlig.urdu=0+500]
            assert.deepStrictEqual(glyphNames('\u{633}\u{62F}', { language: 'URD' }), ['dal.fina.urdu', 'seen']);
            assert.deepStrictEqual(glyphNames('\u{631}', { language: 'URD' }), ['reh.rlig.urdu']);
        });

        it('applies isol to an isolated joining letter and no form to a non-joining letter, like the Arabic shaper of HarfBuzz', function() {
            // isol of arab sub hamza by hamza.isol; sub tehmarbuta by tehmarbuta.isol;, fina of arab sub tehmarbuta.isol by
            // tehmarbuta.isol.fina;: -u 0629 [tehmarbuta.isol=0+500], --features=-isol -u 0629 [tehmarbuta=0+500]
            assert.deepStrictEqual(glyphNames('\u{629}'), ['tehmarbuta.isol']);
            assert.deepStrictEqual(glyphNames('\u{629}', { features: { isol: false } }), ['tehmarbuta']);
            // the hamza is non-joining: -u 0621 [hamza=0+500], -u 0621,0629 [tehmarbuta.isol=1+500|hamza=0+500]
            assert.deepStrictEqual(glyphNames('\u{621}'), ['hamza']);
            assert.deepStrictEqual(glyphNames('\u{621}\u{629}'), ['tehmarbuta.isol', 'hamza']);
            // a hamza between two joining letters breaks the joining: -u 0633,0621,062F [dal=2+500|hamza=1+500|seen=0+500]
            assert.deepStrictEqual(glyphNames('\u{633}\u{621}\u{62F}'), ['dal', 'hamza', 'seen']);
            // a final teh marbuta takes no isol: -u 0633,0629 [tehmarbuta=1+500|seen.init=0+500]
            assert.deepStrictEqual(glyphNames('\u{633}\u{629}'), ['tehmarbuta', 'seen.init']);
        });

        it('applies an arabic form that the features option enables at every glyph, like a user feature of HarfBuzz', function() {
            // --features=+isol -u 0633,0629 [tehmarbuta.isol.fina=1+500|seen.init=0+500]: isol, then fina at the final letter
            assert.deepStrictEqual(glyphNames('\u{633}\u{629}', { features: { isol: true } }), ['tehmarbuta.isol.fina', 'seen.init']);
        });

        it('applies the required feature of an arabic language system in the first stage, or in its stage when its tag is enabled, like HarfBuzz', function() {
            // arab SND: init SEEN_INIT (sub seen by seen.init;), fina DAL_SEEN_FINA, the required feature ss07 SEEN_REQ (sub seen
            // by seen.req;, after SEEN_INIT in the lookup list): --language=sd -u 0633,062F [dal.fina=1+500|seen.req=0+500]
            assert.deepStrictEqual(glyphNames('\u{633}\u{62F}', { language: 'SND' }), ['dal.fina', 'seen.req']);
            // ss07 enabled, in the stage of the other features after init: --language=sd --features=+ss07 -u 0633,062F
            // [dal.fina=1+500|seen.init=0+500]
            assert.deepStrictEqual(glyphNames('\u{633}\u{62F}', { language: 'SND', features: { ss07: true } }), ['dal.fina', 'seen.init']);
            // all the features off: --language=sd --features=-rvrn,-ccmp,-locl,-isol,-fina,-medi,-init,-rlig,-rclt,-calt,-liga,
            // -clig,-mset -u 0633,062F [dal=1+500|seen.req=0+500]
            const allFeaturesOff = Object.fromEntries(font.defaultRenderOptions.features[0].tags.map(tag => [tag, false]));
            assert.deepStrictEqual(glyphNames('\u{633}\u{62F}', { language: 'SND', features: allFeaturesOff }), ['dal', 'seen.req']);
        });

        it('applies a required form of an arabic language system at every glyph in the stage of its form, like HarfBuzz', function() {
            // arab KUR: init SEEN_INIT, the required feature fina DAL_SEEN_FINA (sub dal by dal.fina; sub seen by seen.fina;),
            // ccmp sub seen.fina by seen.fina.ccmp;: the required feature at the seen too, after ccmp and before init
            // --language=ku -u 0633,062F [dal.fina=1+500|seen.fina=0+500]
            assert.deepStrictEqual(glyphNames('\u{633}\u{62F}', { language: 'KUR' }), ['dal.fina', 'seen.fina']);
            // fina off, the required feature in the first stage, before ccmp: --language=ku --features=-fina -u 0633,062F
            // [dal.fina=1+500|seen.fina.ccmp=0+500]
            assert.deepStrictEqual(glyphNames('\u{633}\u{62F}', { language: 'KUR', features: { fina: false } }), ['dal.fina', 'seen.fina.ccmp']);
        });

        it('skips the script runs of a shaper whose features are not registered', function() {
            // only latn features: the Arabic run keeps the glyphs of the cmap, like hb-shape with all the features off
            // (--features=-rvrn,-ccmp,...,-mset -u 0633,062F [dal=1+500|seen=0+500]); the Latin run: --script=latn
            // -u 0061,0062,0020 [a_b=0+500|space=2+500]
            bidi.applyFeatures(font, [{ script: 'latn', tags: ['liga'] }]);
            const names = bidi.getTextGlyphs('ab \u{633}\u{62F}').map(index => font.glyphs.get(index).name);
            assert.deepStrictEqual(names, ['a_b', 'space', 'dal', 'seen']);
        });

        it('applies the thai features of the language system of the language option, like HarfBuzz', function() {
            // -u 0E01 [kokai=0+500], --language=th -u 0E01 [kokai.tha=0+500]
            assert.deepStrictEqual(glyphNames('\u{E01}'), ['kokai']);
            assert.deepStrictEqual(glyphNames('\u{E01}', { language: 'THA' }), ['kokai.tha']);
        });

        it('applies calt, liga, clig and rclt to the characters of no script of a thai run, like the Thai shaper of HarfBuzz', function() {
            // -u 0E01,0035,0036 [kokai=0+500|five.calt=1+500|six=2+500]
            assert.deepStrictEqual(glyphNames('\u{E01}56'), ['kokai', 'five.calt', 'six']);
            // -u 0E01,002D,003E [kokai=0+500|arrow=1+500]
            assert.deepStrictEqual(glyphNames('\u{E01}->'), ['kokai', 'arrow']);
            // -u 0E01,0037,0038 [kokai=0+500|seven_eight=1+500]
            assert.deepStrictEqual(glyphNames('\u{E01}78'), ['kokai', 'seven_eight']);
            // -u 0E01,0039 [kokai=0+500|nine.rclt=1+500]
            assert.deepStrictEqual(glyphNames('\u{E01}9'), ['kokai', 'nine.rclt']);
            // the lookups of all the features together in lookup list order, the liga one before the calt one:
            // -u 0E01,0033,0034 [kokai=0+500|three_four=1+500]
            assert.deepStrictEqual(glyphNames('\u{E01}34'), ['kokai', 'three_four']);
        });

        it('applies calt, liga, clig and rclt to the characters of no script of an arabic run, like the Arabic shaper of HarfBuzz', function() {
            // -u 0628,0035,0036 [six=2+500|five.calt=1+500|beh.ccmp=0+500]
            assert.deepStrictEqual(glyphNames('\u{628}56'), ['beh.ccmp', 'five.calt', 'six']);
            // -u 0628,002D,003E [arrow=1+500|beh.ccmp=0+500]
            assert.deepStrictEqual(glyphNames('\u{628}->'), ['beh.ccmp', 'arrow']);
            // -u 0628,0037,0038 [seven_eight=1+500|beh.ccmp=0+500]
            assert.deepStrictEqual(glyphNames('\u{628}78'), ['beh.ccmp', 'seven_eight']);
            // -u 0628,0039 [nine.rclt=1+500|beh.ccmp=0+500]
            assert.deepStrictEqual(glyphNames('\u{628}9'), ['beh.ccmp', 'nine.rclt']);
        });

        it('applies calt to an arabic run in a stage of its own before liga unless its language system has rclt, like HarfBuzz', function() {
            // collect_features_arabic of HarfBuzz 11.3.2: calt, then a pause unless the font has rclt, then liga and clig;
            // the liga lookup is before the calt one in the lookup list. arab has rclt: -u 0628,0033,0034
            // [three_four=1+500|beh.ccmp=0+500]
            assert.deepStrictEqual(glyphNames('\u{628}34'), ['beh.ccmp', 'three_four']);
            // URD has no rclt: --language=ur -u 0628,0033,0034 [four=2+500|three.calt=1+500|beh=0+500]
            assert.deepStrictEqual(glyphNames('\u{628}34', { language: 'URD' }), ['beh', 'three.calt', 'four']);
        });

        it('applies the GSUB features of the dev2 script of a Devanagari run, before deva, like HarfBuzz', function() {
            // calt of dev2 sub ka by ka.dev2;, of deva sub ka by ka.deva;: -u 0915 [ka.dev2=0+500]
            assert.deepStrictEqual(glyphNames('\u{915}'), ['ka.dev2']);
        });

        it('takes the OpenType script tag of the script option literally, like the script tag of a language of HarfBuzz', function() {
            // the OpenType script tag of the private use subtag hbsc: --language=x-hbscdeva -u 0915 [ka.deva=0+500],
            // --language=x-hbscdev2 -u 0915 [ka.dev2=0+500] (the ISO 15924 code of --script=deva takes dev2: [ka.dev2=0+500])
            assert.deepStrictEqual(glyphNames('\u{915}', { script: 'deva' }), ['ka.deva']);
            assert.deepStrictEqual(glyphNames('\u{915}', { script: 'dev2' }), ['ka.dev2']);
        });

        it('shapes an empty text with the script option as one script run without glyphs', function() {
            bidi.applyFeatures(font, font.defaultRenderOptions.features, { script: 'arab' });
            assert.deepStrictEqual(bidi.getTextGlyphs(''), []);
            assert.deepStrictEqual(runTexts(), ['']);
            assert.deepStrictEqual(glyphNames('', { script: 'arab' }), []);
        });

        it('applies locl to an arabic run with ccmp, before the forms, like the Arabic shaper of HarfBuzz', function() {
            // locl of arab sub lam by lam.locl;, init of arab sub lam by lam.init;: -u 0644,062F [dal.fina=1+500|lam.locl=0+500],
            // --features=-locl -u 0644,062F [dal.fina=1+500|lam.init=0+500]
            assert.deepStrictEqual(glyphNames('\u{644}\u{62F}'), ['dal.fina', 'lam.locl']);
            assert.deepStrictEqual(glyphNames('\u{644}\u{62F}', { features: { locl: false } }), ['dal.fina', 'lam.init']);
        });

        it('applies ccmp and locl to an arabic run in one stage, like the Arabic shaper of HarfBuzz', function() {
            // locl of arab sub jeem.ccmp by jeem.locl; before ccmp of arab sub jeem by jeem.ccmp; in the lookup list, so the
            // locl lookup does not match the glyph of ccmp: -u 062C [jeem.ccmp=0+500], --features=-ccmp -u 062C [jeem=0+500]
            assert.deepStrictEqual(glyphNames('\u{62C}'), ['jeem.ccmp']);
            assert.deepStrictEqual(glyphNames('\u{62C}', { features: { ccmp: false } }), ['jeem']);
        });

        it('joins two arabic letters across a transparent Quranic mark outside the ranges of isArabicChar, like HarfBuzz', function() {
            // the small high dotless head of khah U+06E1 between seen and dal: -u 0633,06E1,062F
            // [dal.fina=2+500|dotlessheadofkhah=1+0|seen.init=0+500]
            assert.deepStrictEqual(glyphNames('\u{633}\u{6E1}\u{62F}'), ['dal.fina', 'dotlessheadofkhah', 'seen.init']);
        });

        it('applies the form of a right-joining letter outside the ranges of isArabicChar, like HarfBuzz', function() {
            // fina of arab sub ae by ae.fina;: -u 0633,06D5 [ae.fina=1+500|seen.init=0+500]. The forms of the characters in
            // the order of the text: the fork does not lay U+06D5 out from right to left yet (see the known failure of
            // Scheherazade)
            const clusters = font.stringToGlyphClusters('\u{633}\u{6D5}').sort((clusterA, clusterB) => clusterA.start - clusterB.start);
            assert.deepStrictEqual(clusters.map(cluster => cluster.glyph.name), ['seen.init', 'ae.fina']);
        });

        it('applies rlig to an arabic run in a stage of its own before calt and the other features, like HarfBuzz', function() {
            // liga sub waw.rlig by waw.liga; and calt sub heh.rlig by heh.calt; before rlig sub waw by waw.rlig; sub heh by
            // heh.rlig; in the lookup list. arab has rclt (calt with the other features): -u 0648 [waw.liga=0+500], -u 0647
            // [heh.calt=0+500]
            assert.deepStrictEqual(glyphNames('\u{648}'), ['waw.liga']);
            assert.deepStrictEqual(glyphNames('\u{647}'), ['heh.calt']);
            // URD has no rclt (calt in a stage of its own after rlig): --language=ur -u 0648 [waw.liga=0+500], --language=ur
            // -u 0647 [heh.calt=0+500]
            assert.deepStrictEqual(glyphNames('\u{648}', { language: 'URD' }), ['waw.liga']);
            assert.deepStrictEqual(glyphNames('\u{647}', { language: 'URD' }), ['heh.calt']);
        });

        it('lays out the glyphs of an arabic letter that ccmp decomposed in visual order, like HarfBuzz', function() {
            // ccmp of arab sub noon by noon.dotless dotabove;: -u 0646 [dotabove=0+0|noon.dotless=0+500], -u 0646,0020,0646
            // [dotabove=2+0|noon.dotless=2+500|space=1+500|dotabove=0+0|noon.dotless=0+500]: the mark at the pen position
            // of its base
            const glyphPositions = text => {
                const positions = [];
                font.forEachGlyph(text, 0, 0, font.unitsPerEm, {}, (glyph, x) => {
                    positions.push([glyph.name, x]);
                });
                return positions;
            };
            assert.deepStrictEqual(glyphPositions('\u{646}'), [['dotabove', 0], ['noon.dotless', 0]]);
            assert.deepStrictEqual(glyphPositions('\u{646} \u{646}'), [
                ['dotabove', 0], ['noon.dotless', 0], ['space', 500], ['dotabove', 1000], ['noon.dotless', 1000]
            ]);
        });

        it('applies rvrn to a thai run in a stage of its own before the other features, like the Thai shaper of HarfBuzz', function() {
            // X_RVRN after X_LIGA in the lookup list: --script=thai -u 0078 [x.rvrn=0+500], --script=thai --features=-rvrn
            // -u 0078 [x.liga=0+500]
            assert.deepStrictEqual(glyphNames('x', { script: 'thai' }), ['x.rvrn']);
            assert.deepStrictEqual(glyphNames('x', { script: 'thai', features: { rvrn: false } }), ['x.liga']);
        });

        it('applies the locl of the language option to a character of the Arabic script outside the ranges of isArabicChar', function() {
            // the Extended Arabic-Indic digit four: hb-shape --no-glyph-names --cluster-level=1 --language=ur TestScriptLanguage.ttf
            // -u 06F4: [28=0+500], without the language [14=0+500]
            assert.deepStrictEqual(glyphNames('\u{6F4}', { language: 'URD' }), ['fourarabic.urdu']);
            assert.deepStrictEqual(glyphNames('\u{6F4}'), ['fourarabic']);
        });
    });

    describe('the direction features, rand and the alternate substitutions of a run', function() {
        // TestAlternateSubstitution.ttf (test/generate-alternate-substitution-font.py): ccmp sub beh by beh.ccmp; (33) before
        // ltra sub beh by beh.ltra; (34) and rtla sub beh by beh.rtla; (35) in the lookup list, rtlm sub alef by
        // alef.rtlm; (31); ltra sub hebbet by hebbet.ltra; (37) sub one by one.ltra; (40), rtla sub hebbet by hebbet.rtla;
        // (38) sub one by one.rtla; (41), GPOS ltra +100 and rtla -100 on the advance of hebbet and one and of their
        // alternates (500 units wide): hb-shape --no-glyph-names --cluster-level=1 [--features=<features>]
        // TestAlternateSubstitution.ttf -u <code points>
        let alternateFont;

        before(function() {
            alternateFont = loadSync('./test/fonts/TestAlternateSubstitution.ttf');
        });

        // the glyph and the advance of each character in the order of the text, the order of the clusters of hb-shape: the
        // fork lays out a Hebrew text, and the characters of no script after an arabic word, in the order of the text
        function shapeInTextOrder(text, options) {
            return alternateFont.shape(text, options)
                .sort((positionA, positionB) => positionA.start - positionB.start)
                .map(glyphPosition => [glyphPosition.glyph.index, glyphPosition.xAdvance]);
        }

        it('applies rtla and rtlm to a right-to-left run, in a stage before ccmp, like the Arabic shaper of HarfBuzz', function() {
            // -u 0628,0627,0628: [35=2+500|31=1+500|35=0+500]; -u 0628,0020,0628: [35=2+500|1=1+500|35=0+500]
            assert.deepStrictEqual(alternateFont.stringToGlyphIndexes('\u{628}\u{627}\u{628}'), [35, 31, 35]);
            assert.deepStrictEqual(alternateFont.stringToGlyphIndexes('\u{628} \u{628}'), [35, 1, 35]);
            // --features=-rtla -u 0628,0627: [31=1+500|33=0+500], ccmp applies; --features=-rtlm: [30=1+500|35=0+500]
            assert.deepStrictEqual(alternateFont.stringToGlyphIndexes('\u{628}\u{627}', { features: { rtla: false } }), [31, 33]);
            assert.deepStrictEqual(alternateFont.stringToGlyphIndexes('\u{628}\u{627}', { features: { rtlm: false } }), [30, 35]);
        });

        it('applies ltra after the forms when the features option turns it on in a right-to-left run, like HarfBuzz', function() {
            // --features=+ltra -u 0628,0627: [31=1+500|35=0+500], the ltra that the user enables is in the last stage of
            // HarfBuzz, after rtla
            assert.deepStrictEqual(alternateFont.stringToGlyphIndexes('\u{628}\u{627}', { features: { ltra: true } }), [31, 35]);
        });

        it('applies rtla and rtlm to the characters of no script of an arabic run, like HarfBuzz', function() {
            // -u 0628,0627,0020: [1=2+500|31=1+500|35=0+500]; -u 0628,0627,002E: [0=2+500|31=1+500|35=0+500]
            assert.deepStrictEqual(shapeInTextOrder('\u{628}\u{627} '), [[35, 500], [31, 500], [1, 500]]);
            assert.deepStrictEqual(shapeInTextOrder('\u{628}\u{627}.'), [[35, 500], [31, 500], [0, 500]]);
        });

        it('applies the same direction features in GSUB and in GPOS to a digit of an arabic run, like HarfBuzz', function() {
            // -u 0628,0020,0031: [41=2+400|1=1+500|35=0+500], one.rtla and the -100 of rtla;
            // -u 0031,0020,0628: [35=2+500|1=1+500|41=0+400]
            assert.deepStrictEqual(shapeInTextOrder('\u{628} 1'), [[35, 500], [1, 500], [41, 400]]);
            assert.deepStrictEqual(shapeInTextOrder('1 \u{628}'), [[41, 400], [1, 500], [35, 500]]);
            // a digit of a latin run: -u 0068,0031: [26=0+500|40=1+600], one.ltra and the +100 of ltra
            assert.deepStrictEqual(shapeInTextOrder('h1'), [[26, 500], [40, 600]]);
        });

        it('applies rtla and rtlm, not ltra and ltrm, to a hebrew run in GSUB and in GPOS, like HarfBuzz', function() {
            // -u 05D1,05D1,05D1: [38=2+400|38=1+400|38=0+400], hebbet.rtla
            assert.deepStrictEqual(shapeInTextOrder('\u{5D1}\u{5D1}\u{5D1}'), [[38, 400], [38, 400], [38, 400]]);
            // without rtla, like a font that has ltra only: --features=-rtla -u 05D1,05D1,05D1 [36=2+500|36=1+500|36=0+500]
            assert.deepStrictEqual(shapeInTextOrder('\u{5D1}\u{5D1}\u{5D1}', { features: { rtla: false } }), [[36, 500], [36, 500], [36, 500]]);
            // with a digit: -u 05D1,05D1,0020,0031 [41=3+400|1=2+500|38=1+400|38=0+400]; --features=-rtla
            // [39=3+500|1=2+500|36=1+500|36=0+500]
            assert.deepStrictEqual(shapeInTextOrder('\u{5D1}\u{5D1} 1'), [[38, 400], [38, 400], [1, 500], [41, 400]]);
            assert.deepStrictEqual(shapeInTextOrder('\u{5D1}\u{5D1} 1', { features: { rtla: false } }), [[36, 500], [36, 500], [1, 500], [39, 500]]);
            // ltra that the features option turns on: --features=-rtla,+ltra [40=3+600|1=2+500|37=1+600|37=0+600]
            assert.deepStrictEqual(shapeInTextOrder('\u{5D1}\u{5D1} 1', { features: { rtla: false, ltra: true } }), [[37, 600], [37, 600], [1, 500], [40, 600]]);
        });

        it('applies ltra and ltrm to a thai run, like the Thai shaper of HarfBuzz', function() {
            // --script=thai -u 0068,0069: [26=0+500|29=1+500], h.ltra and i.ltrm
            assert.deepStrictEqual(alternateFont.stringToGlyphIndexes('hi', { script: 'thai' }), [26, 29]);
        });

        it('substitutes the random alternates of HarfBuzz in an arabic run, in the order of the text across its words', function() {
            // rand sub seen from [seen.rand1 seen.rand2 seen.rand3]; (43, 44, 45): -u 0633,0633,0633,0020,0633,0633,0020,0633
            // [43=7+500|1=6+500|43=5+500|43=4+500|1=3+500|43=2+500|43=1+500|44=0+500]
            assert.deepStrictEqual(shapeInTextOrder('\u{633}\u{633}\u{633} \u{633}\u{633} \u{633}').map(([glyph]) => glyph),
                [44, 43, 43, 1, 43, 43, 1, 43]);
            // -u 0633,0020,0633,0020,0633,0020,0633,0020,0633 [43=8+500|1=7+500|43=6+500|1=5+500|43=4+500|1=3+500|43=2+500|1=1+500|44=0+500]
            assert.deepStrictEqual(shapeInTextOrder('\u{633} \u{633} \u{633} \u{633} \u{633}').map(([glyph]) => glyph),
                [44, 1, 43, 1, 43, 1, 43, 1, 43]);
        });

        it('sets the bit 1 of the form in the value of a form feature at the letters of the form, like HarfBuzz', function() {
            // fina sub teh from [teh.fina1 teh.fina2 teh.fina3]; (47, 48, 49), a final teh: -u 0628,062A [47=1+500|35=0+500];
            // --features=fina=2: [49=1+500|35=0+500], 2 and the 1 of the mask of fina; --features=fina=3 [49=1+500|35=0+500];
            // --features=fina=4 [46=1+500|35=0+500], 5 is past the alternates of teh
            const finalTeh = features => alternateFont.stringToGlyphIndexes('\u{628}\u{62A}', { features })[0];
            assert.deepStrictEqual([undefined, { fina: 2 }, { fina: 3 }, { fina: 4 }].map(finalTeh), [47, 49, 49, 46]);
        });

        it('applies a form that the features option sets at every glyph with its value, and the value of the mask at the letters of the form, like HarfBuzz', function() {
            // a feature of the user of HarfBuzz is global: -u 062A,062A,0020,062A [46=3+500|1=2+500|47=1+500|46=0+500],
            // --features=fina=1 [47=3+500|1=2+500|47=1+500|47=0+500], --features=fina=2 [48=3+500|1=2+500|49=1+500|48=0+500]
            // (2 at every teh, 3 at the final one), --features=fina=0 [46=3+500|1=2+500|46=1+500|46=0+500]
            const tehs = features => alternateFont.stringToGlyphIndexes('\u{62A}\u{62A} \u{62A}', { features });
            assert.deepStrictEqual(tehs(), [46, 1, 47, 46]);
            assert.deepStrictEqual(tehs({ fina: 1 }), [47, 1, 47, 47]);
            assert.deepStrictEqual(tehs({ fina: 2 }), [48, 1, 49, 48]);
            assert.deepStrictEqual(tehs({ fina: 0 }), [46, 1, 46, 46]);
        });

        it('keeps the mask of a form whose value is a multiple of 256, like HarfBuzz', function() {
            // --features=fina=256 -u 062A,062A,0020,062A [46=3+500|1=2+500|47=1+500|46=0+500], teh.fina1 at the final teh: the
            // value 0 at every glyph, and the value 1 of the mask of fina at the final letter
            assert.deepStrictEqual(alternateFont.stringToGlyphIndexes('\u{62A}\u{62A} \u{62A}', { features: { fina: 256 } }), [46, 1, 47, 46]);
            // a form is no feature of the Latin shaper: --script=latn --features=fina=256 -u 062A,062A [46=0+500|46=1+500];
            // --features=fina=2 [48=0+500|48=1+500]
            assert.deepStrictEqual(alternateFont.stringToGlyphIndexes('\u{62A}\u{62A}', { script: 'latn', features: { fina: 256 } }), [46, 46]);
            assert.deepStrictEqual(alternateFont.stringToGlyphIndexes('\u{62A}\u{62A}', { script: 'latn', features: { fina: 2 } }), [48, 48]);
        });

        it('substitutes in a nested alternate substitution of a form the alternate of the value of the form at its glyph, like HarfBuzz', function() {
            // fina sub lam' theh' lookup THEH_ALTERNATES; sub theh' space' lam' lookup LAM_ALTERNATES; (lam 65, lam.alt1 to
            // lam.alt3 66 to 68, theh 69, theh.alt1 to theh.alt3 70 to 72), the nested alternate at the mask of its glyph:
            // -u 0644,062B [69=1+500|65=0+500], --features=fina=1 [70=1+500|65=0+500], --features=fina=2 [72=1+500|65=0+500]
            // (the rule starts at the initial lam, 2, and its nested lookup applies at the final theh, 3), --features=fina=3
            // [72=1+500|65=0+500], --features=fina=4 and --features=fina=256 [69=1+500|65=0+500]
            const lamTheh = features => alternateFont.stringToGlyphIndexes('\u{644}\u{62B}', { features });
            assert.deepStrictEqual([undefined, { fina: 1 }, { fina: 2 }, { fina: 3 }, { fina: 4 }, { fina: 256 }].map(lamTheh),
                [[69, 65], [70, 65], [72, 65], [72, 65], [69, 65], [69, 65]]);
            // beh.rtla 35: -u 0628,062B,0020,0644 [65=3+500|1=2+500|69=1+500|35=0+500] (the rule does not match in HarfBuzz,
            // whose space and lam have no mask of fina; in the fork its nested lookup applies at a glyph without that mask),
            // --features=fina=1 [66=3+500|1=2+500|69=1+500|35=0+500], --features=fina=2 [67=3+500|1=2+500|69=1+500|35=0+500]
            // (the rule starts at the final theh, 3, and its nested lookup applies at the isolated lam, 2), --features=fina=3
            // [68=3+500|1=2+500|69=1+500|35=0+500], --features=fina=4 and --features=fina=256 [65=3+500|1=2+500|69=1+500|35=0+500]
            const thehSpaceLam = features => alternateFont.stringToGlyphIndexes('\u{628}\u{62B} \u{644}', { features })[0];
            assert.deepStrictEqual([undefined, { fina: 1 }, { fina: 2 }, { fina: 3 }, { fina: 4 }, { fina: 256 }].map(thehSpaceLam),
                [65, 66, 67, 68, 65, 65]);
        });

        it('substitutes in a nested alternate substitution after a nested ligature the alternate of the value of the form at the glyph it comes from, like HarfBuzz', function() {
            // fina sub sad' lookup SAD_LIGATURE sad' tah' lookup TAH_ALTERNATES;, the alternate at the sequence index 1 (sad 73,
            // sad_sad 74, tah 75, tah.alt1 to tah.alt3 76 to 78): -u 0635,0635,0637 [75=2+500|73=1+500|73=0+500],
            // --features=fina=1 [76=2+500|74=0+500], --features=fina=2 [78=2+500|74=0+500] (3 at the final tah, not the 2 of
            // the medial sad the ligature deletes), --features=fina=3 [78=2+500|74=0+500], --features=fina=4 [75=2+500|74=0+500]
            const sadSadTah = features => alternateFont.stringToGlyphIndexes('\u{635}\u{635}\u{637}', { features });
            assert.deepStrictEqual([undefined, { fina: 1 }, { fina: 2 }, { fina: 3 }, { fina: 4 }].map(sadSadTah),
                [[75, 73, 73], [76, 74], [78, 74], [78, 74], [75, 74]]);
            // the rule after the first glyph of the run: -u 0635,0020,0635,0635,0637 [75=4+500|73=3+500|73=2+500|1=1+500|73=0+500],
            // --features=fina=1 [76=4+500|74=2+500|1=1+500|73=0+500], --features=fina=2 [78=4+500|74=2+500|1=1+500|73=0+500],
            // --features=fina=3 [78=4+500|74=2+500|1=1+500|73=0+500], --features=fina=4 [75=4+500|74=2+500|1=1+500|73=0+500]
            const sadSpaceSadSadTah = features => alternateFont.stringToGlyphIndexes('\u{635} \u{635}\u{635}\u{637}', { features });
            assert.deepStrictEqual([undefined, { fina: 1 }, { fina: 2 }, { fina: 3 }, { fina: 4 }].map(sadSpaceSadSadTah),
                [[75, 73, 73, 1, 73], [76, 74, 1, 73], [78, 74, 1, 73], [78, 74, 1, 73], [75, 74, 1, 73]]);
        });

        it('sets the bit 1 of the mask of rtlm in its value in a run of a right-to-left script, like HarfBuzz', function() {
            // rtlm sub jeem from [jeem.rtlm1 jeem.rtlm2 jeem.rtlm3]; (62, 63, 64): -u 062C [62=0+500], --features=rtlm=2
            // [64=0+500], --features=rtlm=3 [64=0+500] (3 keeps its bit 1, not 4), --features=rtlm=4 [61=0+500] (5 is past
            // the alternates); --features=rtlm=256 -u 0627 [31=0+500], alef.rtlm, -u 062C [62=0+500]
            const jeem = features => alternateFont.stringToGlyphIndexes('\u{62C}', { features });
            assert.deepStrictEqual([undefined, { rtlm: 2 }, { rtlm: 3 }, { rtlm: 4 }, { rtlm: 256 }].map(jeem),
                [[62], [64], [64], [61], [62]]);
            assert.deepStrictEqual(alternateFont.stringToGlyphIndexes('\u{627}', { features: { rtlm: 256 } }), [31]);
            // rtlm is no direction feature of a run of a left-to-right script: --script=latn -u 062C [61=0+500],
            // --features=rtlm=2 [63=0+500], --features=rtlm=256 [61=0+500]; --script=latn --features=rtlm=256 -u 0627 [30=0+500]
            const latinJeem = features => alternateFont.stringToGlyphIndexes('\u{62C}', { script: 'latn', features });
            assert.deepStrictEqual([undefined, { rtlm: 2 }, { rtlm: 256 }].map(latinJeem), [[61], [63], [61]]);
            assert.deepStrictEqual(alternateFont.stringToGlyphIndexes('\u{627}', { script: 'latn', features: { rtlm: 256 } }), [30]);
        });

        it('applies rand to an arabic run in the stage before ccmp, like the Arabic shaper of HarfBuzz', function() {
            // ccmp sub seen by seen.ccmp; (60) before rand sub seen from [seen.rand1 seen.rand2 seen.rand3]; (43, 44, 45) in
            // the lookup list: -u 0633 [44=0+500], the random alternate, then ccmp no longer matches; --features=-rand -u 0633
            // [60=0+500]; --script=latn -u 0633 [60=0+500], ccmp and rand together in lookup list order
            assert.deepStrictEqual(alternateFont.stringToGlyphIndexes('\u{633}'), [44]);
            assert.deepStrictEqual(alternateFont.stringToGlyphIndexes('\u{633}', { features: { rand: false } }), [60]);
            assert.deepStrictEqual(alternateFont.stringToGlyphIndexes('\u{633}', { script: 'latn' }), [60]);
        });

        describe('a form that is the required feature of the arabic language system too', function() {
            // TestAlternateSubstitution.ttf with fina as the ReqFeatureIndex of the arab DefaultLangSys, kept in its
            // FeatureIndex (fontTools), saved as fina-required.ttf: hb-shape --no-glyph-names --cluster-level=1
            // [--features=<features>] fina-required.ttf -u <code points>
            let finaRequiredFont;

            beforeEach(function() {
                finaRequiredFont = loadSync('./test/fonts/TestAlternateSubstitution.ttf');
                const gsub = finaRequiredFont.tables.gsub;
                const finaFeatureIndex = gsub.features.findIndex(featureRecord => featureRecord.tag === 'fina');
                gsub.scripts.find(scriptRecord => scriptRecord.tag === 'arab').script.defaultLangSys.reqFeatureIndex = finaFeatureIndex;
            });

            it('substitutes the first alternate at every teh with the value 1 of the feature, like the global mask of HarfBuzz', function() {
                // --features=+fina -u 0628,062A [47=1+500|35=0+500], -u 062A [47=0+500]; the same with --features=-fina
                for (const features of [{ fina: true }, { fina: false }]) {
                    assert.deepStrictEqual(finaRequiredFont.stringToGlyphIndexes('\u{628}\u{62A}', { features }), [47, 35], JSON.stringify(features));
                    assert.deepStrictEqual(finaRequiredFont.stringToGlyphIndexes('\u{62A}', { features }), [47], JSON.stringify(features));
                }
            });

            it('applies the shared lookup at every glyph with the value 0 of a form at 256, like HarfBuzz', function() {
                // --features=fina=256: the lookup starts at every glyph, so its nested ligature applies, and substitutes no
                // alternate: -u 0635,0635,0637 [75=2+500|74=0+500], -u 0628,062A [46=1+500|35=0+500]
                const features = { fina: 256 };
                assert.deepStrictEqual(finaRequiredFont.stringToGlyphIndexes('\u{635}\u{635}\u{637}', { features }), [75, 74]);
                assert.deepStrictEqual(finaRequiredFont.stringToGlyphIndexes('\u{628}\u{62A}', { features }), [46, 35]);
            });

            itFailsUntilFixed('substitutes no alternate with the mask of the form, like the joined masks of HarfBuzz',
                'getLookupFeatureValue (src/features/applySubstitution.mjs): a lookup that the required feature shares with an ' +
                'enabled form takes the value of the form at every glyph, where HarfBuzz joins the global mask of the required ' +
                'feature to the mask of the form, an alternate index past the alternates',
                function() {
                    // -u 0628,062A [46=1+500|35=0+500], -u 062A [46=0+500], -u 062A,0628 [35=1+500|46=0+500], teh unchanged
                    const tehTexts = ['\u{628}\u{62A}', '\u{62A}', '\u{62A}\u{628}'];
                    assert.deepStrictEqual(tehTexts.map(text => finaRequiredFont.stringToGlyphIndexes(text)), [[46, 35], [46], [35, 46]]);
                });
        });
    });

    describe('the characters of no script of an arabic run', function() {
        let jomhuriaFont;

        beforeEach(function() {
            jomhuriaFont = loadSync('./test/fonts/Jomhuria-Regular.ttf');
        });

        it('applies the calt of arab to the digits after the end of ayah, like the Arabic shaper of HarfBuzz', function() {
            // the end of ayah (Common) and the Arabic-Indic digits: hb-shape --shapers=ot --no-glyph-names --cluster-level=1
            // Jomhuria-Regular.ttf -u 06DD,0661,0662 [1764=2@-2055,0+-1|1763=1@-2705,0+0|615=0+4071] (uni0662.small,
            // uni0661.small, uni06DD), in the reverse order of a right-to-left buffer; --features=-calt gives uni0662 uni0661
            assert.deepStrictEqual(jomhuriaFont.stringToGlyphIndexes('\u{6DD}\u{661}\u{662}'), [615, 1763, 1764]);
        });
    });

    describe('the default arabic features of real fonts', function() {
        let rvrnFont;

        beforeEach(function() {
            rvrnFont = loadSync('./test/fonts/TestRVRN-CFF2.otf');
        });

        it('joins the arabic letters across a transparent Quranic mark outside the ranges of isArabicChar, like HarfBuzz', function() {
            // the Uthmani meem kasra noon small high dotless head of khah heh damma: hb-shape --shapers=ot --no-glyph-names
            // Scheherazade-Bold.ttf -u 0645,0650,0646,06E1,0647,064F
            // [1076=4@181,-89+0|744=4+645|1135=2@186,163+0|893=2+427|1079=0@159,408+0|1046=0+639]
            assert.deepStrictEqual(arabicFont.stringToGlyphIndexes('\u{645}\u{650}\u{646}\u{6E1}\u{647}\u{64F}'), [1076, 744, 1135, 893, 1079, 1046]);
        });

        it('applies the nested ligature of a calt rule to an alef madda with a fatha: Scheherazade, like HarfBuzz', function() {
            // of the calt rules, one adds a madda after the fatha (lookup 48, a multiple substitution) and one removes the first
            // madda (lookup 49, a ligature of the madda and the fatha into the fatha), so the alef has one madda; ccmp decomposes
            // U+0622 into alef and madda: hb-shape --shapers=ot --no-glyph-names Scheherazade-Bold.ttf
            // -u 0622,064E [1086=0@6,337+0|1075=0@32,80+0|273=0+357]
            assert.deepStrictEqual(arabicFont.stringToGlyphIndexes('\u{622}\u{64E}'), [1086, 1075, 273]);
        });

        itFailsUntilFixed('lays out an arabic word with the letter ae from right to left: Scheherazade, like HarfBuzz',
            'arabicSentenceStartCheck (src/features/arab/contextCheck/arabicSentence.mjs): isArabicChar leaves U+06D3-06F9 out, ' +
            'so the beh before U+06D5 is an arabic sentence of its own and the word is not laid out from right to left',
            function() {
                // beh ae reh zain: hb-shape --shapers=ot --no-glyph-names Scheherazade-Bold.ttf -u 0628,06D5,0631,0632
                // [329=3+638|328=2@-130,0+508|747=1+645|932=0+439]
                assert.deepStrictEqual(arabicFont.stringToGlyphIndexes('\u{628}\u{6D5}\u{631}\u{632}'), [329, 328, 747, 932]);
            });

        itFailsUntilFixed('joins the letters of Arabic Supplement and Arabic Extended-A from right to left: Scheherazade, like HarfBuzz',
            'getArabicJoiningType (src/char.mjs): the joining types cover the Arabic block U+0600-06FF only, so U+0750-077F and ' +
            'U+08A0-08FF are non-joining and take no form, and arabicSentenceStartCheck (src/features/arab/contextCheck/arabicSentence.mjs): ' +
            'isArabicChar leaves them out, so they are not laid out from right to left',
            function() {
                // hb-shape --shapers=ot --no-glyph-names --cluster-level=1 Scheherazade-Bold.ttf -u 0750,0750,0750
                // [621=2+1498|787=1+427|944=0+439]; -u 0628,0751,0628 [609=2+1498|788=1+427|932=0+439];
                // -u 08A0,08A0,08A0 [628=2+1498|794=1+427|951=0+439]
                const texts = ['\u{750}\u{750}\u{750}', '\u{628}\u{751}\u{628}', '\u{8A0}\u{8A0}\u{8A0}'];
                assert.deepStrictEqual(texts.map(text => arabicFont.stringToGlyphIndexes(text)),
                    [[621, 787, 944], [609, 788, 932], [628, 794, 951]]);
            });

        it('applies rtlm to an arabic run of Arabic Supplement and Arabic Extended-A letters: Scheherazade, like HarfBuzz', function() {
            // rtlm sub radical by radical.rtl;, the glyph of each character in the order of the text (the run is not laid out
            // from right to left yet, see above): hb-shape --shapers=ot --no-glyph-names --cluster-level=1
            // Scheherazade-Bold.ttf -u 0750,221A [1152=1+937|385=0+1505]; -u 08A0,221A [1152=1+937|392=0+1505];
            // --features=-rtlm -u 0750,221A [1151=1+937|385=0+1505]
            const glyphsInTextOrder = (text, options) => arabicFont.shape(text, options)
                .sort((positionA, positionB) => positionA.start - positionB.start)
                .map(glyphPosition => glyphPosition.glyph.index);
            assert.deepStrictEqual(glyphsInTextOrder('\u{750}\u{221A}'), [385, 1152]);
            assert.deepStrictEqual(glyphsInTextOrder('\u{8A0}\u{221A}'), [392, 1152]);
            assert.deepStrictEqual(glyphsInTextOrder('\u{750}\u{221A}', { features: { rtlm: false } }), [385, 1151]);
        });

        it('applies the arabic forms of the GSUB feature variations of the variation option: TestRVRN-CFF2, like HarfBuzz', function() {
            // the second lookup of fina (lookups 4 and 8) and of medi (3 and 7) of the feature variation of opsz 10 sees the
            // glyph of the first one
            // teh heh alef maksura: hb-shape --shapers=ot --no-glyph-names --variations=opsz=10 TestRVRN-CFF2.otf
            // -u 062A,0647,0649 [18=2+1000|17=1+1000|4=0+1000] (alefMaksura-ar.rvrn.fina, heh-ar.rvrn.medi, teh-ar.init)
            assert.deepStrictEqual(rvrnFont.stringToGlyphIndexes('\u{62A}\u{647}\u{649}', { variation: { opsz: 10 } }), [18, 17, 4]);
        });
    });

    describe('Unicode Variation Sequences (UVSes)', function() {
        it('should be handled correctly', function() {
            const font = loadSync('./test/fonts/TestCMAP14.otf');
            // the string '芦芦󠄀芦󠄁芦󠄂≩≩︀', containing (invisible) variation selectors after some of the characters
            const string = [33446, 33446, 917760, 33446, 917761, 33446, 917762, 8809, 8809, 65024].map(p => String.fromCodePoint(p)).join('');
            assert.deepEqual(font.stringToGlyphIndexes(string), [1, 1, 2, 1, 4, 3]);
        });
    });

    describe('thai scripts', function() {

        let thaiFont;
        let bidiThai;

        beforeEach(()=> {
            thaiFont = loadSync('./test/fonts/NotoSansThai-Medium-Testing-v1.ttf');
            bidiThai = new Bidi();
            bidiThai.registerModifier(
                'glyphIndex', null, token => thaiFont.charToGlyphIndex(token.char)
            );
            const requiredThaiFeatures = [{
                script: 'thai',
                tags: ['liga', 'rlig', 'ccmp']
            }];
            bidiThai.applyFeatures(thaiFont, requiredThaiFeatures);
        });

        describe('thai features', function () {
            it('should apply glyph composition', () => {
                let glyphIndexes = bidiThai.getTextGlyphs('่ํ');
                assert.deepEqual(glyphIndexes, [451]);
            });

            it('should apply glyph ligatures', () => {
                let glyphIndexes = bidiThai.getTextGlyphs('ฤๅ');
                assert.deepEqual(glyphIndexes, [459]);
            });

            it('should apply glyph required ligatures', () => {
                let glyphIndexes = bidiThai.getTextGlyphs('ลล');
                assert.deepEqual(glyphIndexes, [352]);
            });

            itFailsUntilFixed('decomposes sara am with ccmp turned off, like the Thai shaper of HarfBuzz',
                'thaiFeatures (src/features/thai/thaiFeatures.mjs): sara am is decomposed by the ccmp of the font only, not like the ' +
                'preprocess of the Thai shaper of HarfBuzz (preprocess_text_thai), so uni0E33 stays one glyph: [317, 367]',
                () => {
                    // hb-shape --no-glyph-names --cluster-level=1 --features=-ccmp NotoSansThai-Medium-Testing-v1.ttf -u 0E01,0E33
                    // [317=0+607|389=0@-3,0+0|366=0+415]
                    assert.deepStrictEqual(thaiFont.stringToGlyphIndexes('\u{E01}\u{E33}', { features: { ccmp: false } }), [317, 389, 366]);
                });

            itFailsUntilFixed('moves the nikhahit of sara am before the tone mark, like HarfBuzz',
                'tokenizeText (src/bidi.mjs): the nikhahit of sara am is not moved before the tone mark before GSUB, like the ' +
                'preprocess of the Thai shaper of HarfBuzz does, so ccmp decomposes uni0E33 into uni0E4D uni0E32 after the tone ' +
                'mark and ligates uni0E49 uni0E4D into nikhahit_maiThothai: [341, 453, 366]',
                () => {
                    // hb-shape --no-glyph-names --cluster-level=1 NotoSansThai-Medium-Testing-v1.ttf -u 0E19,0E49,0E33
                    // [341=0+623|389=1+0|444=1@-29,0+0|366=1+415]
                    assert.deepStrictEqual(bidiThai.getTextGlyphs('\u{E19}\u{E49}\u{E33}'), [341, 389, 444, 366]);
                });
        });

        describe('thai script runs', function () {
            it('should match the thai script runs of a given text', () => {
                bidiThai.processText('The king said: เป็นคนใจดีสำหรับทุกคน because ความรักคือทุกสิ่ง');
                const thaiRuns = bidiThai.scriptRuns.filter(run => run.scriptTags.includes('thai'));
                const texts = thaiRuns.map(run => run.tokens.map(token => token.char).join(''));
                // the space after a Thai word is in its run
                assert.deepEqual(texts, ['เป็นคนใจดีสำหรับทุกคน ', 'ความรักคือทุกสิ่ง']);
            });
        });
    });

    describe('noto emoji with ccmp', function () {
        let notoEmojiFont;
        beforeEach(()=> {
            notoEmojiFont = loadSync('./test/fonts/noto-emoji.ttf');
        });
    
        describe('ccmp features', function () {
            
            it('shape emoji with sub_0', () => {
                let options = {
                    kerning: true,
                    language: 'dflt',
                    features: [
                        { script: 'DFLT', tags: ['ccmp'] },
                    ]
                };
                let glyphIndexes = notoEmojiFont.stringToGlyphIndexes('👨‍👩‍👧‍👦👨‍👩‍👧',options);
                assert.deepEqual(glyphIndexes, [1463,1462]);
            });
    
            it('shape emoji with sub_5', () => {
                let options = {
                    kerning: true,
                    language: 'dflt',
                    features: [
                        { script: 'DFLT', tags: ['ccmp'] },
                    ]
                };
                let glyphIndexes = notoEmojiFont.stringToGlyphIndexes('🇺🇺',options);
                assert.deepEqual(glyphIndexes, [1850]);
            });
        });
    });
});
