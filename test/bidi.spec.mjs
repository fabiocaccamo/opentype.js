import assert from 'assert';
import Bidi from '../src/bidi.mjs';
import { parse } from '../src/opentype.mjs';
import { readFileSync } from 'fs';
import { itFailsUntilFixed } from './regression/helpers.mjs';
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
 * glyph index order: the order of the glyphs of a cluster of a right-to-left run with a multiple substitution is a
 * known failure (see 'reverses the glyphs of a multiple substitution of a right-to-left run, like HarfBuzz')
 * @param {opentype.Font} font
 * @param {string} text
 * @returns {Array<[number, number, number[]]>}
 */
function describeClusters(font, text) {
    const clusters = [];
    for (const { glyph, start, end } of font.stringToGlyphClusters(text)) {
        const lastCluster = clusters[clusters.length - 1];
        if (lastCluster && lastCluster[0] === start) {
            lastCluster[2] = lastCluster[2].concat(glyph.index).sort((indexA, indexB) => indexA - indexB);
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
        it('should match arabic words in a given text', function() {
            const tokenizer = bidiScheherazade.tokenizer;
            tokenizer.tokenize('Hello السلام عليكم');
            const ranges = tokenizer.getContextRanges('arabicWord');
            const words = ranges.map(range => tokenizer.rangeToText(range));
            assert.deepEqual(words, ['السلام', 'عليكم']);
        });
        it('should match mixed arabic sentence', function() {
            arabicTokenizer.tokenize('The king said: ائتوني به أستخلصه لنفسي');
            const ranges = arabicTokenizer.getContextRanges('arabicSentence');
            const sentences = ranges.map(range => arabicTokenizer.rangeToText(range))[0];
            assert.equal(sentences, 'ائتوني به أستخلصه لنفسي');
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
            const ranges = bidiScheherazade.tokenizer.getContextRanges('arabicWord');
            const PeaceTokens = bidiScheherazade.tokenizer.getRangeTokens(ranges[1]);
            const PeaceForms = PeaceTokens.map(token => {
                if (token.state.init) return 'init';
                if (token.state.medi) return 'medi';
                if (token.state.fina) return 'fina';
                return null;
            });
            assert.deepEqual(PeaceForms, [null, 'init', 'medi', 'medi', 'fina', null].reverse());
        });
        it('should apply arabic required letter ligature', function () {
            let glyphIndexes = bidiScheherazade.getTextGlyphs('لا'); // Arabic word 'لا' : 'no'
            assert.deepEqual(glyphIndexes, [1341, 1330]);
        });
        it('should apply arabic required composition ligature', function () {
            let glyphIndexes = bidiScheherazade.getTextGlyphs('َّ'); // Arabic word 'َّ' : 'Fatha & Shadda'
            assert.deepEqual(glyphIndexes, [1311]);
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

        describe('a ligature formed across a mark', function() {
            let changaFont;
            let lookupFlagsFont;
            let ccmpLigatureFont;

            // the font of test/lookup-flags-font.mjs with the two rlig lookups of LookupFlags.ttf in ccmp, in DFLT where the fork
            // looks the ccmp of an arabic text up: lookupflag IgnoreMarks; sub lam alef by lam_alef; then
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

            // the font of test/lookup-flags-font.mjs with a ligature of two marks in ccmp, in DFLT where the fork looks the
            // ccmp of an arabic text up: sub fatha fatha by fatha; then in rlig: lookupflag IgnoreMarks; sub lam alef by lam_alef;
            function createCcmpBeforeRligFont() {
                const { lam, alef, fatha } = glyphIndexes;
                const IGNORE_MARKS = 0x0008;
                const coverage = glyphIndex => ({ format: 1, glyphs: [glyphIndex] });
                const defaultLangSys = featureIndex => ({ reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [featureIndex] });
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
                            { tag: 'DFLT', script: { defaultLangSys: defaultLangSys(0), langSysRecords: [] } },
                            { tag: 'arab', script: { defaultLangSys: defaultLangSys(1), langSysRecords: [] } }
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
        // the font of test/lookup-flags-font.mjs; ccmp in DFLT, where the fork looks the ccmp of an arabic text up, the other
        // features in arab. Each glyph sequence of the clusters in glyph index order, see describeClusters
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
            return createLookupFlagsFont({ gsub: createScriptsLayoutTable({ DFLT: [['ccmp', ccmpLookupIndexes]], arab: [['fina', [2]]] }, lookups) });
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
            return createLookupFlagsFont({ gsub: createScriptsLayoutTable({ DFLT: [['ccmp', [1]]], arab: [['fina', [2]]] }, lookups) });
        }

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
            const font = createLookupFlagsFont({ gsub: createScriptsLayoutTable({ DFLT: [['ccmp', [0]]], arab: [['fina', [1]]] }, lookups) });
            assert.deepStrictEqual(describeClusters(font, '\u{644}\u{62F}'), [[1, 2, [acuteAlternate]], [0, 1, [lam]]]);
        });

        itFailsUntilFixed('goes on after the input of a contextual rule of a form lookup, like HarfBuzz',
            'arabicPresentationForms (src/features/arab/arabicPresentationForms.mjs): the form lookups apply letter by letter, so the ' +
            'contextual rule applies again at the letter after its first input glyph, the second one of its input, and at the last medial ' +
            'lam, which HarfBuzz skips as the input of the rule before it: lam.init at the lams 1 to 4, not at 1 and 3',
            function() {
                // LookupFlagsMediContext.ttf: medi sub lam' lookup SUB_LAM lam'; (sub lam by lam.init;)
                // six lams: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsMediContext.ttf -u 0644,0644,0644,0644,0644,0644
                // [18=5+500|18=4+500|25=3+500|18=2+500|25=1+500|18=0+500]
                const lamInitial = glyphIndexes['lam.init'];
                const contextLookup = {
                    lookupType: 5,
                    lookupFlag: 0,
                    subtables: [{ substFormat: 3, coverages: createCoverages([lam, lam]), lookupRecords: [{ sequenceIndex: 0, lookupListIndex: 0 }] }]
                };
                const lookups = [createSingleLookup([lam], [lamInitial]), contextLookup];
                const font = createLookupFlagsFont({ gsub: createScriptsLayoutTable({ arab: [['medi', [1]]] }, lookups) });
                assert.deepStrictEqual(describeClusters(font, '\u{644}'.repeat(6)),
                    [[5, 6, [lam]], [4, 5, [lam]], [3, 4, [lamInitial]], [2, 3, [lam]], [1, 2, [lamInitial]], [0, 1, [lam]]]);
            });

        itFailsUntilFixed('reverses the glyphs of a multiple substitution of a right-to-left run, like HarfBuzz',
            'reverseArabicSentences (src/bidi.mjs): it reverses the tokens of an arabic sentence but not the glyphs of the multiple ' +
            'substitution of a token, so getTextGlyphs and getTextGlyphClusters keep the substitution order, HarfBuzz reverses them ' +
            'with the run: lam fatha, not fatha lam',
            function() {
                // -u 0644,0631: [20=1+500|14=0+0|18=0+500]
                assert.deepStrictEqual(createArabicFormsFont().stringToGlyphIndexes('\u{644}\u{631}'), [rehAlternate, fatha, lam]);
            });

        // LookupFlagsArabicJoining.ttf: init sub lam by lam.init;, fina sub dal by dal.alt;, no glyph for U+0621 and U+0629
        function createArabicJoiningFont() {
            const lookups = [createSingleLookup([lam], [glyphIndexes['lam.init']]), createSingleLookup([dal], [dalAlternate])];
            return createLookupFlagsFont({ gsub: createScriptsLayoutTable({ arab: [['init', [0]], ['fina', [1]]] }, lookups) });
        }

        itFailsUntilFixed('applies no initial form to a dual-joining letter before a non-joining hamza, like HarfBuzz',
            'willConnectNext (src/features/arab/arabicPresentationForms.mjs): it checks that the letter joins on its left, not that ' +
            'the next character joins on its right, so lam takes the initial form before the hamza (U+0621, joining type U)',
            function() {
                // lam, hamza: hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsArabicJoining.ttf -u 0644,0621
                // [0=1+500|18=0+500]: lam stays isolated
                assert.deepStrictEqual(describeClusters(createArabicJoiningFont(), '\u{644}\u{621}'), [[1, 2, [0]], [0, 1, [lam]]]);
            });

        itFailsUntilFixed('applies no final form to a letter after a right-joining teh marbuta, like HarfBuzz',
            'isIsolatedArabicChar (src/char.mjs): the teh marbuta (U+0629, joining type R) is missing, so willConnectPrev joins ' +
            'the letter after it, which takes the final form',
            function() {
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

        describe('thai contexts', function () {
            it('should match thai words in a given text', () => {
                const tokenizer = bidiThai.tokenizer;
                bidiThai.processText('The king said: เป็นคนใจดีสำหรับทุกคน because ความรักคือทุกสิ่ง');
                const ranges = tokenizer.getContextRanges('thaiWord');
                const words = ranges.map(range => tokenizer.rangeToText(range));
                assert.deepEqual(words, ['เป็นคนใจดีสำหรับทุกคน', 'ความรักคือทุกสิ่ง']);
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
