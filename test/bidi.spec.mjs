import assert from 'assert';
import Bidi from '../src/bidi.mjs';
import { parse } from '../src/opentype.mjs';
import { readFileSync } from 'fs';
import { itFailsUntilFixed } from './regression/helpers.mjs';
import { glyphIndexes, createLookupFlagsFont, createLayoutTable } from './lookup-flags-font.mjs';
const loadSync = (url, opt) => parse(readFileSync(url), opt);

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

            itFailsUntilFixed('matches the rule of a later ccmp lookup right after the ligature, like HarfBuzz',
                'ccmpReplacementLigatures (src/features/ccmp/ccmpReplacementLigatures.mjs): the context keeps the component the ligature ' +
                'deleted, as true, so the backtrack of the rule at reh is true and not the lam alef ligature: lam_alef reh',
                function() {
                    // hb-shape --no-glyph-names --cluster-level=1 --features=-kern LookupFlagsCcmpLigature.ttf -u 0644,0627,0631
                    // [20=2+500|19=0+500]: reh.alt, then the lam alef ligature, in visual order
                    assert.deepStrictEqual(ccmpLigatureFont.stringToGlyphIndexes('\u{644}\u{627}\u{631}'), [20, 19]);
                });

            itFailsUntilFixed('merges the clusters of a ligature and of the mark between its components, like HarfBuzz',
                'getTextGlyphClusters (src/bidi.mjs): the character of a deleted ligature component belongs to the glyph before it in ' +
                'the text, here the fatha that the lam alef ligature skipped: the fatha has the cluster [1, 3), the ligature [0, 1) of lam',
                function() {
                    // hb-shape --no-glyph-names --cluster-level=1 Changa-Regular.ttf -u 644,64e,627
                    // [773=0@375,180+0|458=0+635]: lam fatha alef is one cluster
                    const clusters = changaFont.stringToGlyphClusters('\u{644}\u{64E}\u{627}');
                    assert.deepStrictEqual(clusters.map(cluster => [cluster.start, cluster.end]), [[0, 3], [0, 3]]);
                });
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
