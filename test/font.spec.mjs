import assert from 'assert';
import { Font, Glyph, Path, parse } from '../src/opentype.mjs';
import glyphset from '../src/glyphset.mjs';
import { readFileSync } from 'fs';
import { createMockObject, replaceTextGlyphs } from './testutil.mjs';
import { itFailsUntilFixed } from './regression/helpers.mjs';
import {
    glyphIndexes,
    createLookupFlagsGdef,
    createLookupFlagsFont,
    createLayoutTable,
    createScriptsLayoutTable,
    createSingleLookup
} from './lookup-flags-font.mjs';
const loadSync = (url, opt) => parse(readFileSync(url), opt);

describe('font.mjs', function() {
    let font;

    const fGlyph = new Glyph({name: 'f', unicode: 102, path: new Path(), advanceWidth: 1});
    const iGlyph = new Glyph({name: 'i', unicode: 105, path: new Path(), advanceWidth: 1});
    const ffGlyph = new Glyph({name: 'f_f', unicode: 0xfb01, path: new Path(), advanceWidth: 1});
    const fiGlyph = new Glyph({name: 'f_i', unicode: 0xfb02, path: new Path(), advanceWidth: 1});
    const ffiGlyph = new Glyph({name: 'f_f_i', unicode: 0xfb03, path: new Path(), advanceWidth: 1});

    const glyphs = [
        new Glyph({name: '.notdef', unicode: 0, path: new Path(), advanceWidth: 1}),
        fGlyph, iGlyph, ffGlyph, fiGlyph, ffiGlyph
    ];

    glyphs.forEach((glyph, index) => glyph.index = index);

    beforeEach(function() {
        font = new Font({
            familyName: 'MyFont',
            styleName: 'Medium',
            unitsPerEm: 1000,
            ascender: 800,
            descender: 0,
            fsSelection: 42,
            tables: {os2: {achVendID: 'TEST'}},
            glyphs: glyphs
        });
    });

    describe('Font constructor', function() {
        it('should throw Error objects (not strings) for missing required options', function() {
            assert.throws(
                () => new Font({ styleName: 'Medium', unitsPerEm: 1000, ascender: 800, descender: -200 }),
                (err) => err instanceof Error
            );
        });

        it('accept 0 as descender value', function() {
            assert.equal(font.descender, 0);
        });
        it('tables definition must be supported', function() {
            assert.equal(font.tables.os2.achVendID, 'TEST');
        });
        it('tables definition must blend with default tables values', function() {
            assert.equal(font.tables.os2.usWidthClass, 5);
        });
        it('tables definition can override defaults values', function() {
            assert.equal(font.tables.os2.fsSelection, 42);
        });
        it('panose has default fallback', function() {
            assert.equal(font.tables.os2.bFamilyType, 0);
            assert.equal(font.tables.os2.bSerifStyle, 0);
            assert.equal(font.tables.os2.bWeight, 0);
            assert.equal(font.tables.os2.bProportion, 0);
            assert.equal(font.tables.os2.bContrast, 0);
            assert.equal(font.tables.os2.bStrokeVariation, 0);
            assert.equal(font.tables.os2.bArmStyle, 0);
            assert.equal(font.tables.os2.bLetterform, 0);
            assert.equal(font.tables.os2.bMidline, 0);
            assert.equal(font.tables.os2.bXHeight, 0);
        });
        it('panose values are set correctly', function () {
            let panoseFont = new Font({
                familyName: 'MyFont',
                styleName: 'Medium',
                unitsPerEm: 1000,
                ascender: 800,
                descender: 0,
                panose: [0,1,2,3,4,5,6,7,8,9],
            });
            assert.equal(panoseFont.tables.os2.bFamilyType, 0);
            assert.equal(panoseFont.tables.os2.bSerifStyle, 1);
            assert.equal(panoseFont.tables.os2.bWeight, 2);
            assert.equal(panoseFont.tables.os2.bProportion, 3);
            assert.equal(panoseFont.tables.os2.bContrast, 4);
            assert.equal(panoseFont.tables.os2.bStrokeVariation, 5);
            assert.equal(panoseFont.tables.os2.bArmStyle, 6);
            assert.equal(panoseFont.tables.os2.bLetterform, 7);
            assert.equal(panoseFont.tables.os2.bMidline, 8);
            assert.equal(panoseFont.tables.os2.bXHeight, 9);
        });
        it('fsSelection and macStyle are calcluated if no fsSelection value is provided', function() {
            let weightClassFont = new Font({
                familyName: 'MyFont',
                styleName: 'Medium',
                unitsPerEm: 1000,
                ascender: 800,
                descender: 0,
                weightClass: 600,
                fsSelection: false,
            });
            assert.equal(weightClassFont.tables.os2.fsSelection, 32);
            const weightClassHeadTable = weightClassFont.toTables().tables.find(table => table.tableName === 'head');
            assert.equal(weightClassHeadTable.macStyle, font.macStyleValues.BOLD);

            let italicAngleFont = new Font({
                familyName: 'MyFont',
                styleName: 'Medium',
                unitsPerEm: 1000,
                ascender: 800,
                descender: 0,
                italicAngle: -13,
                fsSelection: false,
            });
            assert.equal(italicAngleFont.tables.os2.fsSelection, 1);
            const italicAngleHeadTable = italicAngleFont.toTables().tables.find(table => table.tableName === 'head');
            assert.equal(italicAngleHeadTable.macStyle, font.macStyleValues.ITALIC);
        });
        it('tables definition shall be serialized', function() {
            const os2 = font.toTables().tables.find(table => table.tableName === 'OS/2');
            assert.equal(os2.achVendID, 'TEST');
        });
    });

    describe('stringToGlyphIndexes', function() {
        it('must support standard ligatures', function() {
            assert.deepEqual(font.stringToGlyphIndexes('fi'), [fGlyph.index, iGlyph.index]);
            font.substitution.add('liga', { sub: [1, 1, 2], by: 5 });
            font.substitution.add('liga', { sub: [1, 1], by: 3 });
            font.substitution.add('liga', { sub: [1, 2], by: 4 });
            assert.deepEqual(font.stringToGlyphIndexes('ff'), [ffGlyph.index]);
            assert.deepEqual(font.stringToGlyphIndexes('fi'), [fiGlyph.index]);
            assert.deepEqual(font.stringToGlyphIndexes('ffi'), [ffiGlyph.index]);
            assert.deepEqual(font.stringToGlyphIndexes('fffiffif'),
                [ffGlyph.index, fiGlyph.index, ffiGlyph.index, fGlyph.index]);
        });
    });

    describe('updateFeatures', function() {
        it('enables and disables the features of every shaper, rvrn included in their defaults', function() {
            // the substitution features HarfBuzz 11.3.2 enables by default for every script (hb_ot_shape_collect_features:
            // rvrn, ccmp, locl, rlig, calt, clig, liga, rclt), the Arabic shaper adding the forms and mset
            // (collect_features_arabic), the Thai shaper none; not yet the direction features (ltra, ltrm, rtla), rand and
            // the stch of the Arabic shaper, which HarfBuzz also enables
            assert.deepStrictEqual(font.updateFeatures(), [
                { script: 'arab', tags: ['rvrn', 'ccmp', 'locl', 'isol', 'init', 'medi', 'fina', 'rlig', 'rclt', 'calt', 'liga', 'clig', 'mset'] },
                { script: 'latn', tags: ['rvrn', 'ccmp', 'locl', 'rlig', 'rclt', 'calt', 'liga', 'clig'] },
                { script: 'thai', tags: ['rvrn', 'ccmp', 'locl', 'rlig', 'rclt', 'calt', 'liga', 'clig'] }
            ]);
            assert.deepStrictEqual(font.updateFeatures({ ccmp: false, liga: false, ss01: true }), [
                { script: 'arab', tags: ['rvrn', 'locl', 'isol', 'init', 'medi', 'fina', 'rlig', 'rclt', 'calt', 'clig', 'mset', 'ss01'] },
                { script: 'latn', tags: ['rvrn', 'locl', 'rlig', 'rclt', 'calt', 'clig', 'ss01'] },
                { script: 'thai', tags: ['rvrn', 'locl', 'rlig', 'rclt', 'calt', 'clig', 'ss01'] }
            ]);
        });
    });

    describe('stringToGlyphs', function() {
        it('must support standard ligatures', function() {
            assert.deepEqual(font.stringToGlyphs('fi'), [fGlyph, iGlyph]);
            font.substitution.add('liga', { sub: [1, 1, 2], by: 5 });
            font.substitution.add('liga', { sub: [1, 1], by: 3 });
            font.substitution.add('liga', { sub: [1, 2], by: 4 });
            assert.deepEqual(font.stringToGlyphs('ff'), [ffGlyph]);
            assert.deepEqual(font.stringToGlyphs('fi'), [fiGlyph]);
            assert.deepEqual(font.stringToGlyphs('ffi'), [ffiGlyph]);
            assert.deepEqual(font.stringToGlyphs('fffiffif'), [ffGlyph, fiGlyph, ffiGlyph, fGlyph]);
        });

        it('works on fonts with coverage table format 2', function() {
            const vibur = loadSync('./test/fonts/Vibur.woff');
            const glyphs = vibur.stringToGlyphs('er');
            assert.equal(glyphs.length, 1);
            assert.equal(glyphs[0].name, 'er');
        });

        it('works on fonts with coverage table format 2 on low memory mode', function() {
            const vibur = loadSync('./test/fonts/Vibur.woff', {lowMemory: true});
            const glyphs = vibur.stringToGlyphs('er');
            assert.equal(glyphs.length, 1);
            assert.equal(glyphs[0].name, 'er');
        });

    });

    describe('hasChar', function() {
        it('returns correct results for non-CMAP fonts', function() {
            assert.equal(font.hasChar('i'), true);
            assert.equal(font.hasChar('x'), false);
        });

        it('returns correct results for CMAP fonts', function() {
            const cmapFont = loadSync('./test/fonts/TestCMAP14.otf');
            assert.equal(cmapFont.hasChar('a'), false);
            assert.equal(cmapFont.hasChar('≩'), true);
        });
    });

    describe('toTables', function() {
        it('returns an sfnt font table', function() {
            const tables = font.toTables();
            assert.ok(tables);
            assert.equal(tables.tableName, 'sfnt');
        });
    });

    describe('getKerningValue', function() {
        function getOrigins(kerningFont, text) {
            const origins = [];
            kerningFont.forEachGlyph(text, 0, 0, kerningFont.unitsPerEm, {}, (glyph, glyphX) => origins.push(glyphX));
            return origins;
        }

        it('accepts glyph objects with index 0', function() {
            font.kerningPairs = { '0,1': -50 };
            assert.equal(font.getKerningValue(font.glyphs.get(0), font.glyphs.get(1)), -50);
            assert.equal(font.getKerningValue(0, 1), -50);
        });

        it('applies the variation deltas of GPOS kerning (VariationIndex in GDEF)', function() {
            const variableFont = loadSync('./test/fonts/Changa-VariableFont_wght.ttf');
            const left = variableFont.charToGlyph('A');
            const right = variableFont.charToGlyph('V');
            // expected values from fontTools.varLib.instancer
            assert.equal(variableFont.getKerningValue(left, right, { wght: 200 }), -17);
            assert.equal(variableFont.getKerningValue(left, right, { wght: 500 }), -23);
            assert.equal(variableFont.getKerningValue(left, right, { wght: 800 }), -30);
            variableFont.variation.set({ wght: 800 });
            assert.equal(variableFont.getKerningValue(left, right), -30);
        });

        it('lays out a text with the variation deltas of the variation option, in a kern lookup with IgnoreMarks', function() {
            // the kern lookup of Changa-VariableFont_wght.ttf has the lookupFlag IgnoreMarks
            const variableFont = loadSync('./test/fonts/Changa-VariableFont_wght.ttf');
            // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=200 Changa-VariableFont_wght.ttf -u 41,56
            // [1=0+503|113=1+486]
            assert.equal(variableFont.getAdvanceWidth('AV', 1000, { variation: { wght: 200 } }), 503 + 486);
            // hb-shape --no-glyph-names --cluster-level=1 --variations=wght=800 Changa-VariableFont_wght.ttf -u 41,56
            // [1=0+611|113=1+621]
            assert.equal(variableFont.getAdvanceWidth('AV', 1000, { variation: { wght: 800 } }), 611 + 621);
        });

        // TestVariationPrecision.ttf, generated by test/generate-variation-precision-font.py: A V is 0 at wght 400
        // and -85 at wght 900, V A 100 and 15; at wght 650 the deltas are exactly -42.5
        it('rounds a variable kerning with a delta of exactly a half like HarfBuzz', function() {
            const variableFont = loadSync('./test/fonts/TestVariationPrecision.ttf');
            const glyphA = variableFont.charToGlyph('A');
            const glyphV = variableFont.charToGlyph('V');
            // hb-shape --no-glyph-names --variations=wght=650 TestVariationPrecision.ttf -u 0041,0056,0041
            // [6=0+558|7=1+658|6=2+600]
            assert.equal(variableFont.getKerningValue(glyphA, glyphV, { wght: 650 }), -42);
            assert.equal(variableFont.getKerningValue(glyphV, glyphA, { wght: 650 }), 58);
            // hb-shape --no-glyph-names --variations=wght=900 TestVariationPrecision.ttf -u 0041,0056,0041
            // [6=0+515|7=1+615|6=2+600]
            assert.equal(variableFont.getKerningValue(glyphA, glyphV, { wght: 900 }), -85);
            assert.equal(variableFont.getKerningValue(glyphV, glyphA, { wght: 900 }), 15);
        });

        it('gives no kerning for a font made with new Font whose GPOS has no kern feature', function() {
            const defaultLangSys = { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [0] };
            font.tables.gpos = {
                version: 1,
                scripts: [{ tag: 'DFLT', script: { defaultLangSys, langSysRecords: [] } }],
                features: [{ tag: 'mark', feature: { featureParams: 0, lookupListIndexes: [] } }],
                lookups: []
            };
            font.position.init();
            assert.equal(font.getKerningValue(1, 2), 0);
            assert.equal(font.getAdvanceWidth('fi', font.unitsPerEm), 2);
            assert.equal(font.getAdvanceWidth('fi', font.unitsPerEm, { script: 'hebr' }), 2);
        });

        it('uses the kern table when the GPOS table has no kern feature (#501)', function() {
            // GPOS of TestTracking3.ttf: latn with trak as its required feature and no kern feature
            const trackingFont = loadSync('./test/fonts/TestTracking3.ttf');
            const glyph = character => trackingFont.charToGlyph(character);
            // python -m fontTools.ttx -q -t kern -o - TestTracking3.ttf
            // <pair l="A" r="V" v="-152"/>, <pair l="T" r="o" v="-227"/>, no pair V T
            assert.equal(trackingFont.getKerningValue(glyph('A'), glyph('V')), -152);
            assert.equal(trackingFont.getKerningValue(glyph('T'), glyph('o')), -227);
            // HarfBuzz applies the kern table (hb-ot-shape.cc, apply_kern without a GPOS kern feature) and splits
            // each value between the two glyphs, the sum of the advances is the one of a kerning of the first glyph
            // hb-shape --no-glyph-names --cluster-level=1 TestTracking3.ttf -u 0041,0056,0054,006F
            // [36=0+1290|57=1@-76,0+1290|55=2+1137|82=3@-113,0+1026]
            // hb-shape --no-glyph-names --cluster-level=1 --features=-kern TestTracking3.ttf -u 0041,0056,0054,006F
            // [36=0+1366|57=1+1366|55=2+1251|82=3+1139]
            assert.equal(trackingFont.getAdvanceWidth('AVTo', trackingFont.unitsPerEm), 1290 + 1290 + 1137 + 1026);
            // the same line with a script the font has not (it falls back to latn) and a language:
            // hb-shape --no-glyph-names --cluster-level=1 --script=cyrl --language=tr TestTracking3.ttf -u 0041,0056,0054,006F
            assert.equal(trackingFont.getAdvanceWidth('AVTo', trackingFont.unitsPerEm, { script: 'cyrl', language: 'TRK ' }), 4743);
            assert.equal(trackingFont.getAdvanceWidth('AVTo', trackingFont.unitsPerEm, { kerning: false }), 1366 + 1366 + 1251 + 1139);
        });

        it('uses the kern table for a script whose GPOS has no kern feature, not when the kern feature has no pair adjustment lookup', function() {
            // checked with hb-shape on fonts built by fontTools with the same tables: a font whose kern feature
            // has a single adjustment lookup only is not kerned by its kern table
            const kernFeature = { tag: 'kern', feature: { featureParams: 0, lookupListIndexes: [0] } };
            const pairLookup = {
                lookupType: 2,
                lookupFlag: 0,
                subtables: [{
                    posFormat: 1,
                    coverage: { format: 1, glyphs: [1] },
                    valueFormat1: 4,
                    valueFormat2: 0,
                    pairSets: [[{ secondGlyph: 2, value1: { xAdvance: -30 }, value2: undefined }]]
                }]
            };
            const defaultLangSys = featureIndexes => ({ reserved: 0, reqFeatureIndex: 0xffff, featureIndexes });
            font.kerningPairs = { '1,2': -50 };
            font.tables.gpos = {
                version: 1,
                scripts: [
                    { tag: 'DFLT', script: { defaultLangSys: defaultLangSys([]), langSysRecords: [] } },
                    { tag: 'latn', script: { defaultLangSys: defaultLangSys([0]), langSysRecords: [] } }
                ],
                features: [kernFeature],
                lookups: [pairLookup]
            };
            font.position.init();
            replaceTextGlyphs(font, [1, 2]);
            assert.equal(font.getKerningValue(1, 2), -30);
            assert.equal(font.getAdvanceWidth('fi', font.unitsPerEm), 2 - 30);
            // cyrl falls back to DFLT, that has no kern feature
            assert.equal(font.getAdvanceWidth('fi', font.unitsPerEm, { script: 'cyrl' }), 2 - 50);
            pairLookup.lookupType = 1;
            font.position.init();
            assert.equal(font.getKerningValue(1, 2), 0);
            assert.equal(font.getAdvanceWidth('fi', font.unitsPerEm), 2);
        });

        it('kerns a text with the kern feature of the language option, the default language system without it', function() {
            const pairLookup = xAdvance => ({
                lookupType: 2,
                lookupFlag: 0,
                subtables: [{
                    posFormat: 1,
                    coverage: { format: 1, glyphs: [1] },
                    valueFormat1: 4,
                    valueFormat2: 0,
                    pairSets: [[{ secondGlyph: 2, value1: { xAdvance }, value2: undefined }]]
                }]
            });
            const langSys = featureIndexes => ({ reserved: 0, reqFeatureIndex: 0xffff, featureIndexes });
            font.tables.gpos = {
                version: 1,
                scripts: [{ tag: 'latn', script: { defaultLangSys: langSys([0]), langSysRecords: [{ tag: 'TRK ', langSys: langSys([1]) }] } }],
                features: [
                    { tag: 'kern', feature: { featureParams: 0, lookupListIndexes: [0] } },
                    { tag: 'kern', feature: { featureParams: 0, lookupListIndexes: [1] } }
                ],
                lookups: [pairLookup(-30), pairLookup(-40)]
            };
            font.position.init();
            replaceTextGlyphs(font, [1, 2]);
            assert.equal(font.getAdvanceWidth('fi', font.unitsPerEm, { language: 'TRK ' }), 2 - 40);
            assert.equal(font.getAdvanceWidth('fi', font.unitsPerEm, { language: 'ROM ' }), 2 - 30);
            assert.equal(font.getAdvanceWidth('fi', font.unitsPerEm), 2 - 30);
        });

        describe('the script runs of the kerning', function() {
            // TestScriptLanguage.ttf, generated by test/generate-script-language-font.py: kern one two -10 in DFLT, -30 in
            // latn and -20 in thai, chama chami -50 in cham only, two A -40 in thai only, A alpha -40 in latn only, a chama
            // -10 in latn and -50 in cham, kha kha -10 in DFLT and -50 in dev2; the GPOS table has no other script
            let scriptLanguageFont;
            const advancesOf = (text, options) => {
                const origins = [];
                const end = scriptLanguageFont.forEachGlyph(text, 0, 0, 1000, options, (glyph, glyphX) => origins.push(glyphX));
                return origins.map((origin, index) => (index + 1 < origins.length ? origins[index + 1] : end) - origin);
            };

            beforeEach(function() {
                scriptLanguageFont = loadSync('./test/fonts/TestScriptLanguage.ttf');
            });

            it('kerns the characters of no script with the script of the characters around them, like HarfBuzz', function() {
                // hb-shape --no-glyph-names --cluster-level=1 TestScriptLanguage.ttf -u 0031,0032: [2=0+490|3=1+500]
                assert.deepStrictEqual(advancesOf('12'), [490, 500]);
                // -u 0041,0031,0032: [4=0+500|2=1+470|3=2+500]
                assert.deepStrictEqual(advancesOf('A12'), [500, 470, 500]);
                // -u 0E01,0031,0032: [15=0+500|2=1+480|3=2+500]
                assert.deepStrictEqual(advancesOf('\u{E01}12'), [500, 480, 500]);
                // the characters of no script at the start of the text: -u 0031,0032,0E01: [2=0+480|3=1+500|15=2+500]
                assert.deepStrictEqual(advancesOf('12\u{E01}'), [480, 500, 500]);
            });

            it('kerns a script with its own script tag, outside of the scripts of the old kerning (Cham)', function() {
                // hb-shape --no-glyph-names --cluster-level=1 TestScriptLanguage.ttf -u AA00,AA01: [17=0+450|18=1+500]
                assert.deepStrictEqual(advancesOf('\u{AA00}\u{AA01}'), [450, 500]);
                const glyph = character => scriptLanguageFont.charToGlyph(character);
                assert.equal(scriptLanguageFont.getKerningValue(glyph('\u{AA00}'), glyph('\u{AA01}')), -50);
                // --script=latn -u AA00,AA01: [17=0+500|18=1+500]
                assert.deepStrictEqual(advancesOf('\u{AA00}\u{AA01}', { script: 'latn' }), [500, 500]);
            });

            it('does not kern the glyphs of two script runs together, like HarfBuzz shaping each run on its own', function() {
                // the digits after a Thai letter and before a Latin one are in the thai run, A is a run of its own:
                // -u 0E01,0031,0032 [15=0+500|2=1+480|3=2+500], -u 0041 [4=0+500] (as one thai run, two A is kerned:
                // -u 0E01,0031,0032,0041 [15=0+500|2=1+480|3=2+460|4=3+500])
                assert.deepStrictEqual(advancesOf('\u{E01}12A'), [500, 480, 500, 500]);
                // A and alpha: -u 0041 [4=0+500], -u 03B1 [23=0+500]
                assert.deepStrictEqual(advancesOf('A\u{3B1}'), [500, 500]);
            });

            it('kerns the glyphs of the whole text with the script option, as one script run, like HarfBuzz', function() {
                // --script=thai -u 0E01,0031,0032,0041 [15=0+500|2=1+480|3=2+460|4=3+500]
                assert.deepStrictEqual(advancesOf('\u{E01}12A', { script: 'thai' }), [500, 480, 460, 500]);
                // --script=latn -u 0041,03B1 [4=0+460|10=1+500]
                assert.deepStrictEqual(advancesOf('A\u{3B1}', { script: 'latn' }), [460, 500]);
            });

            it('kerns a Devanagari run with dev2, before deva and DFLT, like HarfBuzz', function() {
                // -u 0916,0916 [44=0+450|44=1+500]
                assert.deepStrictEqual(advancesOf('\u{916}\u{916}'), [450, 500]);
                const kha = scriptLanguageFont.charToGlyph('\u{916}');
                assert.equal(scriptLanguageFont.getKerningValue(kha, kha), -50);
            });

            it('picks the GPOS script of a Devanagari run among the GPOS scripts, not the GSUB ones, like HarfBuzz', function() {
                // TestScriptLanguage.ttf without the dev2 script of GSUB (fontTools): GSUB has deva, GPOS dev2,
                // -u 0916,0916 [44=0+450|44=1+500], the kha kha -50 of dev2, not the -10 of DFLT
                scriptLanguageFont.tables.gsub.scripts = scriptLanguageFont.tables.gsub.scripts.filter(scriptRecord => scriptRecord.tag !== 'dev2');
                assert.deepStrictEqual(advancesOf('\u{916}\u{916}'), [450, 500]);
            });

            it('kerns a pair of a Latin glyph and a glyph of another script with the other script, from getKerningValue', function() {
                // the pair takes Cham, the script of a chama that is not Latin: --script=cham -u 0061,AA00 [6=0+450|17=1+500],
                // with --script=latn [6=0+490|17=1+500]
                const glyph = character => scriptLanguageFont.charToGlyph(character);
                assert.equal(scriptLanguageFont.getKerningValue(glyph('a'), glyph('\u{AA00}')), -50);
            });
        });

        describe('the script of the kerning', function() {
            // GPOS of NotoSansThai-Medium-Testing-v1.ttf: the kern feature of DFLT and of thai has the same lookup,
            // latn has the language systems MOL and ROM only (no default language system, so no kern feature), no kern table
            let thaiFont;

            before(function() {
                thaiFont = loadSync('./test/fonts/NotoSansThai-Medium-Testing-v1.ttf');
            });

            it('kerns a Thai text with the thai script, a Latin text with latn, without the script option', function() {
                // hb-shape --no-glyph-names --cluster-level=1 NotoSansThai-Medium-Testing-v1.ttf -u e40,e02,e32
                // [376=0+291|318=1+560|366=2+415]
                // hb-shape --no-glyph-names --cluster-level=1 --features=-kern NotoSansThai-Medium-Testing-v1.ttf -u e40,e02,e32
                // [376=0+309|318=1+560|366=2+415]
                assert.equal(thaiFont.getAdvanceWidth('เขา', thaiFont.unitsPerEm), 291 + 560 + 415);
                assert.equal(thaiFont.getAdvanceWidth('เขา', thaiFont.unitsPerEm, { script: 'thai' }), 291 + 560 + 415);
                assert.equal(thaiFont.getAdvanceWidth('เขา', thaiFont.unitsPerEm, { kerning: false }), 309 + 560 + 415);
                // the latn kern feature is missing, so HarfBuzz does not kern the Latin text, with or without kern:
                // hb-shape --no-glyph-names --cluster-level=1 NotoSansThai-Medium-Testing-v1.ttf -u 41,56
                // [38=0+654|59=1+615]
                assert.equal(thaiFont.getAdvanceWidth('AV', thaiFont.unitsPerEm), 654 + 615);
                // the Latin pair, then the Thai pairs with the thai script: the reference is the two runs AV and เขา
                // above, shaped apart by script like a browser does; hb-shape on the whole text guesses the Latn script
                // and does not kern it (-u 41,56,e40,e02,e32 gives [38=0+654|59=1+615|376=2+309|318=3+560|366=4+415])
                assert.equal(thaiFont.getAdvanceWidth('AVเขา', thaiFont.unitsPerEm), 654 + 615 + 291 + 560 + 415);
            });

            it('gives the kerning of the script of the characters of the glyphs from getKerningValue and from the position API', function() {
                const left = thaiFont.charToGlyphIndex('เ');
                const right = thaiFont.charToGlyphIndex('ข');
                assert.equal(thaiFont.getKerningValue(thaiFont.charToGlyph('A'), thaiFont.charToGlyph('V')), 0);
                // the -18 of the hb-shape lines above, 309 - 291
                assert.equal(thaiFont.getKerningValue(left, right), 291 - 309);
                const thaiKerningTables = thaiFont.position.getKerningTables('thai');
                assert.equal(thaiFont.position.getKerningValue(thaiKerningTables, left, right), 291 - 309);
            });

            it('does not kern a Latin pair with the thai kern lookup across a Thai mark',
                function() {
                    // hb-shape --no-glyph-names --cluster-level=1 NotoSansThai-Medium-Testing-v1.ttf -u 41,e31,56
                    // [38=0+654|365=1+0|59=2+615]
                    assert.equal(getOrigins(thaiFont, 'A\u{E31}V')[1], 654);
                });

            it('kerns a Latin pair with the thai kern lookup across a Thai mark with the script option thai, as one script run', function() {
                // hb-shape --no-glyph-names --cluster-level=1 --script=thai NotoSansThai-Medium-Testing-v1.ttf -u 41,e31,56
                // [38=0+614|365=1+0|59=2+615]
                const origins = [];
                thaiFont.forEachGlyph('A\u{E31}V', 0, 0, thaiFont.unitsPerEm, { script: 'thai' }, (glyph, glyphX) => origins.push(glyphX));
                assert.deepStrictEqual(origins, [0, 614, 614]);
            });
        });

        it('kerns a Cyrillic and a Latin glyph of a real font with the script option, the text being one script run', function() {
            const robotoFont = loadSync('./test/fonts/Roboto-Black.ttf');
            // hb-shape --no-glyph-names --cluster-level=1 --script=Latn Roboto-Black.ttf -u 0423,0041 [222=0+1204|37=1+1395]
            assert.equal(robotoFont.getAdvanceWidth('УA', robotoFont.unitsPerEm, { script: 'latn' }), 1204 + 1395);
            // two script runs without it: -u 0423 [222=0+1295], -u 0041 [37=0+1395]
            assert.equal(robotoFont.getAdvanceWidth('УA', robotoFont.unitsPerEm), 1295 + 1395);
        });

        it('kerns glyph indexes of a font parsed with lowMemory, whose glyphs load on request', function() {
            const kerningOfIndexes = (path, leftCharacter, rightCharacter) => {
                const lowMemoryFont = loadSync(path, { lowMemory: true });
                return lowMemoryFont.getKerningValue(lowMemoryFont.charToGlyphIndex(leftCharacter), lowMemoryFont.charToGlyphIndex(rightCharacter));
            };
            // GPOS: hb-shape --no-glyph-names --cluster-level=1 Roboto-Black.ttf -u 41,56
            // [37=0+1318|58=1+1353], with --features=-kern [37=0+1395|58=1+1353]
            assert.equal(kerningOfIndexes('./test/fonts/Roboto-Black.ttf', 'A', 'V'), 1318 - 1395);
            // the kern table and the script of the characters, see the tests above
            assert.equal(kerningOfIndexes('./test/fonts/TestTracking3.ttf', 'A', 'V'), -152);
            assert.equal(kerningOfIndexes('./test/fonts/NotoSansThai-Medium-Testing-v1.ttf', 'เ', 'ข'), 291 - 309);
            const lowMemoryFont = loadSync('./test/fonts/Roboto-Black.ttf', { lowMemory: true });
            assert.equal(lowMemoryFont.getKerningValue(lowMemoryFont.numGlyphs, 1), 0, 'an index the font has not');
        });

        describe('the kerning of a right-to-left text', function() {
            // GPOS of Jomhuria-Regular.ttf: the kern feature has the pair adjustment lookups 82 and 84 in arab, 83 in
            // latn, none in DFLT; HarfBuzz looks the pairs up in the order of the text, stringToGlyphClusters gives
            // them in visual order
            let arabicFont;

            before(function() {
                arabicFont = loadSync('./test/fonts/Jomhuria-Regular.ttf');
            });

            it('kerns the pairs of an Arabic text in the order of the text, with the arab script', function() {
                const getAdvanceWidth = (text, options) => arabicFont.getAdvanceWidth(text, arabicFont.unitsPerEm, options);
                // the arab lookups kern the glyphs of this pair by -40 in visual order, by 0 in the order of the text:
                // hb-shape --no-glyph-names --cluster-level=1 Jomhuria-Regular.ttf -u 0628,0627
                // [1135=1+629|1204=0+517], the same with --features=-kern
                assert.equal(getAdvanceWidth('با'), 629 + 517);
                // hb-shape --no-glyph-names --cluster-level=1 Jomhuria-Regular.ttf -u 062A,0629
                // [1370=1+934|1210=0@30,0+547]
                // hb-shape --no-glyph-names --cluster-level=1 --features=-kern Jomhuria-Regular.ttf -u 062A,0629
                // [1370=1+934|1210=0+517]
                assert.equal(getAdvanceWidth('تة'), 934 + 547);
                assert.equal(getAdvanceWidth('تة', { script: 'arab' }), 934 + 547);
                assert.equal(getAdvanceWidth('تة', { kerning: false }), 934 + 517);
                // hb-shape --no-glyph-names --cluster-level=1 Jomhuria-Regular.ttf -u 0645,0631,062d,0628,0627,20,0628,0627,0644,0639,0627,0644,0645
                // [1448=12+1306|1437=11+575|1135=10@40,0+669|1164=9+988|1437=8+575|1135=7@40,0+669|1204=6+517|4=5+400|
                // 1135=4+629|1245=3+704|1333=2+1167|1482=1+848|1451=0+979], with --features=-kern 1135=10+629 and 1135=7+629
                assert.equal(getAdvanceWidth('مرحبا بالعالم'), 10026);
                assert.equal(getAdvanceWidth('مرحبا بالعالم', { kerning: false }), 10026 - 80);
            });

            it('kerns with arab a pair of Arabic characters outside the Arabic block ranges of isArabicChar', function() {
                const getAdvanceWidth = (text, options) => arabicFont.getAdvanceWidth(text, arabicFont.unitsPerEm, options);
                // hb-shape --no-glyph-names --cluster-level=1 Jomhuria-Regular.ttf -u 06EE,0757
                // [657=1+1380|632=0@-110,0+832], with --features=-kern [657=1+1380|632=0+942]
                assert.equal(getAdvanceWidth('ۮݗ'), 1380 + 832);
                assert.equal(getAdvanceWidth('ۮݗ', { kerning: false }), 1380 + 942);
            });

            it('places the Arabic digits of a left-to-right run of the arab script with the x placement of their pair', function() {
                // the extended Arabic-Indic digits are left-to-right: hb-shape --no-glyph-names --cluster-level=1
                // --direction=ltr --script=arab Jomhuria-Regular.ttf -u 06F6,06F6 [640=0@-120,0+1130|640=1+1250],
                // with --features=-kern [640=0+1250|640=1+1250]
                const shape = options => arabicFont.shape('۶۶', options).map(({ glyph, xAdvance, xOffset, yOffset }) => [glyph.index, xAdvance, xOffset, yOffset]);
                assert.deepStrictEqual(shape(), [[640, 1130, -120, 0], [640, 1250, 0, 0]]);
                assert.deepStrictEqual(shape({ kerning: false }), [[640, 1250, 0, 0], [640, 1250, 0, 0]]);
            });
        });

        describe('the kerning of synthetic fonts', function() {
            // Each font has a glyph of 500 units for each string of characters (the characters the cmap maps to the
            // glyph), at the indexes 1, 2... in the order given, and the GPOS or kern pairs of a font built by
            // fontTools (fontBuilder and feaLib) with the same glyphs for the hb-shape references:
            // hb-shape --no-glyph-names --cluster-level=1 <font> -u <code points>
            function createCharactersFont(glyphsCharacters) {
                const characterGlyphs = glyphsCharacters.map((characters, index) => new Glyph({
                    name: 'glyph' + (index + 1),
                    unicodes: Array.from(characters).map(character => character.codePointAt(0)),
                    path: new Path(),
                    advanceWidth: 500
                }));
                // glyphs no character maps to (the glyphs of a multiple substitution)
                const otherGlyphs = ['b', 'c'].map(name => new Glyph({ name, path: new Path(), advanceWidth: 500 }));
                const notdefGlyph = new Glyph({ name: '.notdef', path: new Path(), advanceWidth: 500 });
                const fontGlyphs = [notdefGlyph, ...characterGlyphs, ...otherGlyphs];
                for (let i = 0; i < fontGlyphs.length; i++) {
                    fontGlyphs[i].index = i;
                }
                return new Font({
                    familyName: 'Kerning',
                    styleName: 'Regular',
                    unitsPerEm: 1000,
                    ascender: 800,
                    descender: -200,
                    glyphs: fontGlyphs
                });
            }

            // a GPOS table whose kern feature has, in the default language system of each script of scriptLookups,
            // the lookups of its list of indexes; lookup i kerns the pair [leftIndex, rightIndex, xAdvance] of pairs[i]
            function createKerningGpos(scriptLookups, pairs) {
                const tags = Object.keys(scriptLookups).sort();
                return {
                    version: 1,
                    scripts: tags.map((tag, index) => ({
                        tag,
                        script: { defaultLangSys: { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [index] }, langSysRecords: [] }
                    })),
                    features: tags.map(tag => ({ tag: 'kern', feature: { featureParams: 0, lookupListIndexes: scriptLookups[tag] } })),
                    lookups: pairs.map(([leftIndex, rightIndex, xAdvance]) => ({
                        lookupType: 2,
                        lookupFlag: 0,
                        subtables: [{
                            posFormat: 1,
                            coverage: { format: 1, glyphs: [leftIndex] },
                            valueFormat1: 4,
                            valueFormat2: 0,
                            pairSets: [[{ secondGlyph: rightIndex, value1: { xAdvance }, value2: undefined }]]
                        }]
                    }))
                };
            }

            describe('per-script kern lookups', function() {
                // feaLib: kern_Dflt (A А -10) in DFLT, latn, cyrl and grek, then kern_Latn (A V -100) in latn,
                // kern_Cyrl (А У -80) in cyrl and kern_Grek (α ν -60) in grek; the pairs of two scripts: A У -30 and
                // У A -20 in cyrl only, У α -25 in cyrl and -35 in grek, α У -15 in cyrl and -45 in grek
                let scriptFont;

                beforeEach(function() {
                    scriptFont = createCharactersFont(['A', 'V', 'А', 'У', 'α', 'ν']);
                    scriptFont.tables.gpos = createKerningGpos(
                        { DFLT: [0], latn: [0, 1], cyrl: [0, 2, 4, 5, 6, 8], grek: [0, 3, 7, 9] },
                        [
                            [1, 3, -10], [1, 2, -100], [3, 4, -80], [5, 6, -60], [1, 4, -30],
                            [4, 1, -20], [4, 5, -25], [4, 5, -35], [5, 4, -15], [5, 4, -45]
                        ]
                    );
                    scriptFont.position.init();
                });

                it('kerns Cyrillic and Greek pairs with the cyrl and grek lookups, without the script option', function() {
                    // -u 0410,0423: [3=0+420|4=1+500]
                    assert.equal(scriptFont.getAdvanceWidth('АУ', 1000), 920);
                    // -u 03B1,03BD: [5=0+440|6=1+500]
                    assert.equal(scriptFont.getAdvanceWidth('αν', 1000), 940);
                    // -u 41,56: [1=0+400|2=1+500]
                    assert.equal(scriptFont.getAdvanceWidth('AV', 1000), 900);
                    // A and the Cyrillic А are two script runs, which HarfBuzz shapes on their own, without kerning
                    // between them: -u 41 [1=0+500], -u 0410 [3=0+500] (-u 41,0410 shapes them as one latn run:
                    // [1=0+490|3=1+500])
                    assert.equal(scriptFont.getAdvanceWidth('AА', 1000), 1000);
                });

                it('gives the kerning of the script of the characters of the glyphs from getKerningValue', function() {
                    const glyph = character => scriptFont.charToGlyph(character);
                    assert.equal(scriptFont.getKerningValue(glyph('А'), glyph('У')), -80);
                    assert.equal(scriptFont.getKerningValue(3, 4), -80);
                    assert.equal(scriptFont.getKerningValue(glyph('α'), glyph('ν')), -60);
                    assert.equal(scriptFont.getKerningValue(glyph('A'), glyph('V')), -100);
                    assert.equal(scriptFont.getKerningValue(1, 99), 0, 'an index the font has not');
                });

                it('kerns a pair of a Latin and a Cyrillic glyph with cyrl, in both orders, not the two script runs of a text', function() {
                    // in a text the two characters are two script runs, which HarfBuzz shapes on their own, without
                    // kerning between them: -u 41 [1=0+500], -u 0423 [4=0+500]
                    assert.equal(scriptFont.getAdvanceWidth('AУ', 1000), 1000);
                    assert.equal(scriptFont.getAdvanceWidth('УA', 1000), 1000);
                    // the documented choice of the script of a pair of glyphs: hb-shape without --script guesses latn, the
                    // script of the first character, for -u 41,0423 ([1=0+500|4=1+500])
                    // --script=cyrl -u 41,0423: [1=0+470|4=1+500], --script=cyrl -u 0423,41: [4=0+480|1=1+500]
                    const glyph = character => scriptFont.charToGlyph(character);
                    assert.equal(scriptFont.getKerningValue(glyph('A'), glyph('У')), -30);
                    assert.equal(scriptFont.getKerningValue(glyph('У'), glyph('A')), -20);
                });

                it('kerns a pair of a Latin and a Cyrillic character with the script option, the text being one script run', function() {
                    // --script=cyrl -u 41,0423: [1=0+470|4=1+500], --script=cyrl -u 0423,41: [4=0+480|1=1+500]
                    assert.equal(scriptFont.getAdvanceWidth('AУ', 1000, { script: 'cyrl' }), 970);
                    assert.equal(scriptFont.getAdvanceWidth('УA', 1000, { script: 'cyrl' }), 980);
                });

                it('kerns a pair of a Cyrillic and a Greek glyph with cyrl, that comes before grek, not the two script runs of a text', function() {
                    // two script runs, shaped on their own: -u 0423 [4=0+500], -u 03B1 [5=0+500]
                    assert.equal(scriptFont.getAdvanceWidth('Уα', 1000), 1000);
                    assert.equal(scriptFont.getAdvanceWidth('αУ', 1000), 1000);
                    // --script=cyrl -u 0423,03B1: [4=0+475|5=1+500], with --script=grek [4=0+465|5=1+500]
                    // --script=cyrl -u 03B1,0423: [5=0+485|4=1+500], with --script=grek [5=0+455|4=1+500]
                    const glyph = character => scriptFont.charToGlyph(character);
                    assert.equal(scriptFont.getKerningValue(glyph('У'), glyph('α')), -25);
                    assert.equal(scriptFont.getKerningValue(glyph('α'), glyph('У')), -15);
                });
            });

            it('kerns a pair of a Thai and an Arabic character with thai, that comes before arab', function() {
                // feaLib: ko beh -30 and beh ko -40 in thai, ko beh -50 and beh ko -60 in arab
                const thaiArabicFont = createCharactersFont(['ก', 'ب']);
                thaiArabicFont.tables.gpos = createKerningGpos({ thai: [0, 2], arab: [1, 3] }, [[1, 2, -30], [1, 2, -50], [2, 1, -40], [2, 1, -60]]);
                thaiArabicFont.position.init();
                // --script=thai -u 0E01,0628: [1=0+470|2=1+500], with --script=arab [2=1+500|1=0+450]; in a text the
                // two characters are a left-to-right run and a right-to-left run, which HarfBuzz shapes on their own,
                // without kerning between them: --script=thai -u 0E01: [1=0+500], --script=arab -u 0628: [2=0+500]
                assert.equal(thaiArabicFont.getAdvanceWidth('กب', 1000), 1000);
                const glyph = character => thaiArabicFont.charToGlyph(character);
                assert.equal(thaiArabicFont.getKerningValue(glyph('ก'), glyph('ب')), -30);
                // --script=thai -u 0628,0E01: [2=0+460|1=1+500]
                assert.equal(thaiArabicFont.getKerningValue(glyph('ب'), glyph('ก')), -40);
            });

            describe('a pair of a Hebrew glyph', function() {
                // feaLib: alef А -10, А alef -20, alef beh -50 and beh alef -60 in hebr, alef А -30 and А alef -40 in
                // cyrl, alef beh -70 and beh alef -80 in arab
                let hebrewFont;
                const glyph = character => hebrewFont.charToGlyph(character);

                beforeEach(function() {
                    hebrewFont = createCharactersFont(['א', 'А', 'ب']);
                    hebrewFont.tables.gpos = createKerningGpos(
                        { hebr: [0, 1, 4, 5], cyrl: [2, 3], arab: [6, 7] },
                        [[1, 2, -10], [2, 1, -20], [1, 2, -30], [2, 1, -40], [1, 3, -50], [3, 1, -60], [1, 3, -70], [3, 1, -80]]
                    );
                    hebrewFont.position.init();
                });

                it('kerns a pair of a Hebrew and a Cyrillic glyph with hebr, that comes before cyrl', function() {
                    // --script=hebr -u 05D0,0410: [2=1+500|1=0+490], with --script=cyrl [1=0+470|2=1+500]
                    assert.equal(hebrewFont.getKerningValue(glyph('א'), glyph('А')), -10);
                    // --script=hebr -u 0410,05D0: [1=1+500|2=0+480], with --script=cyrl [2=0+460|1=1+500]
                    assert.equal(hebrewFont.getKerningValue(glyph('А'), glyph('א')), -20);
                });

                it('kerns a pair of a Hebrew and an Arabic glyph with arab, that comes before hebr', function() {
                    // --script=arab -u 05D0,0628: [3=1+500|1=0+430], with --script=hebr [3=1+500|1=0+450]
                    assert.equal(hebrewFont.getKerningValue(glyph('א'), glyph('ب')), -70);
                    // --script=arab -u 0628,05D0: [1=1+500|3=0+420], with --script=hebr [1=1+500|3=0+440]
                    assert.equal(hebrewFont.getKerningValue(glyph('ب'), glyph('א')), -80);
                });
            });

            describe('a glyph shared by characters of several scripts', function() {
                // A is also the Cyrillic А, the micro sign (a character of no script) also the Greek mu, the Latin
                // schwa also the Cyrillic one, and the glyph cyrillic has the 32 code points of а to я.
                // feaLib: kern_Latn (A V -100, µ m -40, ə v -60, A cyrillic -15) in latn, kern_Cyrl (A В -50,
                // A cyrillic -35) in cyrl, kern_Grek (μ ν -70) in grek and kern_Dflt (A cyrillic -5) in DFLT
                let sharedFont;
                const glyph = character => sharedFont.charToGlyph(character);

                beforeEach(function() {
                    sharedFont = createCharactersFont(['AА', 'V', 'В', 'µμ', 'm', 'əә', 'v', 'ν', 'абвгдежзийклмнопрстуфхцчшщъыьэюя']);
                    sharedFont.tables.gpos = createKerningGpos(
                        { DFLT: [7], latn: [0, 1, 2, 3], cyrl: [4, 6], grek: [5] },
                        [[1, 2, -100], [4, 5, -40], [6, 7, -60], [1, 9, -15], [1, 3, -50], [4, 8, -70], [1, 9, -35], [1, 9, -5]]
                    );
                    sharedFont.position.init();
                });

                it('kerns the Latin pairs of a shared glyph with latn', function() {
                    // -u 41,56: [1=0+400|2=1+500]
                    assert.equal(sharedFont.getKerningValue(glyph('A'), glyph('V')), -100);
                    assert.equal(sharedFont.getKerningValue(1, 2), -100);
                    // -u B5,6D: [4=0+460|5=1+500]
                    assert.equal(sharedFont.getKerningValue(glyph('µ'), glyph('m')), -40);
                    // -u 259,76: [6=0+440|7=1+500]
                    assert.equal(sharedFont.getKerningValue(glyph('ə'), glyph('v')), -60);
                    assert.equal(sharedFont.getAdvanceWidth('AV', 1000), 900);
                    assert.equal(sharedFont.getAdvanceWidth('µm', 1000), 960);
                    assert.equal(sharedFont.getAdvanceWidth('əv', 1000), 940);
                });

                it('kerns a shared glyph with the script of the other glyph of the pair', function() {
                    // -u 410,412: [1=0+450|3=1+500]
                    assert.equal(sharedFont.getKerningValue(glyph('А'), glyph('В')), -50);
                    assert.equal(sharedFont.getAdvanceWidth('АВ', 1000), 950);
                    // -u 3BC,3BD: [4=0+430|8=1+500]
                    assert.equal(sharedFont.getKerningValue(glyph('μ'), glyph('ν')), -70);
                    assert.equal(sharedFont.getAdvanceWidth('μν', 1000), 930);
                    // a glyph of many code points: -u 410,430 [1=0+465|9=1+500]
                    assert.equal(sharedFont.getKerningValue(glyph('А'), glyph('а')), -35);
                    assert.equal(sharedFont.getAdvanceWidth('Аа', 1000), 965);
                });

                it('takes the code points a glyph has when it is kerned, also after Glyph.addUnicode', function() {
                    const cyrillicGlyph = glyph('а');
                    assert.equal(sharedFont.getKerningValue(glyph('A'), cyrillicGlyph), -35);
                    // the glyph cyrillic becomes a glyph of a Latin character too: two glyphs shared by several scripts,
                    // so the pair is kerned with latn, not DFLT: -u 41,430 [1=0+485|9=1+500]
                    cyrillicGlyph.addUnicode(0x61);
                    assert.equal(sharedFont.getKerningValue(glyph('A'), cyrillicGlyph), -15);
                });
            });

            describe('a text of characters of no script', function() {
                // feaLib: one two -10 in DFLT, -30 in latn
                let digitsFont;

                beforeEach(function() {
                    digitsFont = createCharactersFont(['1', '2', 'A']);
                    digitsFont.tables.gpos = createKerningGpos({ DFLT: [0], latn: [1] }, [[1, 2, -10], [1, 2, -30]]);
                    digitsFont.position.init();
                });

                it('kerns a text of characters of no script with DFLT, like HarfBuzz', function() {
                    // -u 31,32: [1=0+490|2=1+500]
                    assert.equal(digitsFont.getAdvanceWidth('12', 1000), 990);
                    assert.equal(digitsFont.getKerningValue(digitsFont.charToGlyph('1'), digitsFont.charToGlyph('2')), -10);
                });

                it('kerns the characters of no script of a Latin text with latn', function() {
                    // -u 41,31,32: [3=0+500|1=1+470|2=2+500]
                    assert.equal(digitsFont.getAdvanceWidth('A12', 1000), 1470);
                });
            });

            it('kerns a Hebrew pair with the hebr lookups, without the script option', function() {
                // feaLib: latn kerns vav alef by -40, hebr by -70
                // -u 05D5,05D0: [3=1+500|4=0+430]
                const hebrewFont = createCharactersFont(['א', 'ו']);
                hebrewFont.tables.gpos = createKerningGpos({ latn: [0], hebr: [1] }, [[2, 1, -40], [2, 1, -70]]);
                hebrewFont.position.init();
                assert.equal(hebrewFont.getAdvanceWidth('וא', 1000), 930);
            });

            describe('characters of the Arabic script outside the Arabic block ranges of isArabicChar', function() {
                // the Extended Arabic-Indic digits one and two, the Arabic-Indic digits one and two, ae, beh and space;
                // feaLib: one two -100, Arabic-Indic one two -80 and ae ae -60 in arab, one two -10 in latn
                let arabicDigitsFont;
                const glyph = character => arabicDigitsFont.charToGlyph(character);

                beforeEach(function() {
                    arabicDigitsFont = createCharactersFont(['۱', '۲', '١', '٢', 'ە', 'ب', ' ']);
                    arabicDigitsFont.tables.gpos = createKerningGpos(
                        { arab: [0, 1, 2], latn: [3] },
                        [[1, 2, -100], [3, 4, -80], [5, 5, -60], [1, 2, -10]]
                    );
                    arabicDigitsFont.position.init();
                });

                it('kerns them with arab, without the script option', function() {
                    // -u 06F1,06F2: [2=1+500|1=0+400]
                    assert.equal(arabicDigitsFont.getAdvanceWidth('۱۲', 1000), 900);
                    // -u 0628,0020,06F1,06F2: [2=3+500|1=2+400|7=1+500|6=0+500]
                    assert.equal(arabicDigitsFont.getAdvanceWidth('ب ۱۲', 1000), 1900);
                    // -u 0661,0662: [4=1+500|3=0+420]
                    assert.equal(arabicDigitsFont.getAdvanceWidth('١٢', 1000), 920);
                    // -u 06D5,06D5: [5=1+500|5=0+440]
                    assert.equal(arabicDigitsFont.getAdvanceWidth('ەە', 1000), 940);
                });

                it('gives their kerning with arab from getKerningValue', function() {
                    assert.equal(arabicDigitsFont.getKerningValue(glyph('۱'), glyph('۲')), -100);
                    assert.equal(arabicDigitsFont.getKerningValue(glyph('١'), glyph('٢')), -80);
                    assert.equal(arabicDigitsFont.getKerningValue(glyph('ە'), glyph('ە')), -60);
                });
            });

            describe('a font made with new Font', function() {
                // feaLib: A V -100 in latn, -80 in cyrl
                let latinCyrillicFont;

                beforeEach(function() {
                    latinCyrillicFont = createCharactersFont(['A', 'V']);
                    latinCyrillicFont.tables.gpos = createKerningGpos({ latn: [0], cyrl: [1] }, [[1, 2, -100], [1, 2, -80]]);
                });

                it('kerns with the GPOS table assigned to it, without Position.init', function() {
                    // -u 41,56: [1=0+400|2=1+500]
                    assert.equal(latinCyrillicFont.getKerningValue(1, 2), -100);
                    assert.equal(latinCyrillicFont.getAdvanceWidth('AV', 1000), 900);
                });

                it('takes the code points a glyph has when it is kerned, also after glyph.unicodes is replaced', function() {
                    latinCyrillicFont.position.init();
                    assert.equal(latinCyrillicFont.getKerningValue(1, 2), -100);
                    // the same font with A mapped to U+0410 instead: -u 0410,56 [1=0+420|2=1+500]
                    latinCyrillicFont.glyphs.get(1).unicodes = [0x410];
                    assert.equal(latinCyrillicFont.getKerningValue(1, 2), -80);
                    // the text is two script runs, the Cyrillic А and the Latin V, shaped on their own: -u 0410 [1=0+500],
                    // -u 56 [2=0+500]
                    assert.equal(latinCyrillicFont.getAdvanceWidth('АV', 1000), 1000);
                });
            });

            describe('the kern table of a right-to-left text', function() {
                // the kern table has no direction: HarfBuzz looks its pairs up in visual order, the GPOS pairs in
                // the order of the text. No GPOS table, kern table alef reh -100 and reh alef -50.
                let arabicFont;

                beforeEach(function() {
                    arabicFont = createCharactersFont(['ا', 'ر', 'د']);
                    arabicFont.kerningPairs = { '1,2': -100, '2,1': -50 };
                });

                it('looks the pairs of the kern table up in visual order', function() {
                    // -u 0631,0627: [1=1+450|2=0@-50,0+450]
                    assert.equal(arabicFont.getAdvanceWidth('را', 1000), 900);
                    assert.equal(arabicFont.getAdvanceWidth('را', 1000, { script: 'arab' }), 900);
                    // -u 0627,0631: [2=1+475|1=0@-25,0+475]
                    assert.equal(arabicFont.getAdvanceWidth('ار', 1000), 950);
                });

                it('does not kern a left-to-right run with a right-to-left run with the kern table', function() {
                    // kern table b reh -60 and reh b -70; HarfBuzz shapes each direction run on its own:
                    // -u 0062: [1=0+500], -u 0631: [2=0+500], not the b reh -60 of the two characters shaped together,
                    // -u 0062,0631: [1=0+470|2=1@-30,0+470]
                    const mixedFont = createCharactersFont(['b', 'ر']);
                    mixedFont.kerningPairs = { '1,2': -60, '2,1': -70 };
                    assert.equal(mixedFont.getAdvanceWidth('bر', 1000), 1000);
                    assert.equal(mixedFont.getAdvanceWidth('رb', 1000), 1000);
                    assert.equal(mixedFont.getAdvanceWidth('bرb', 1000), 1500);
                });

                itFailsUntilFixed('looks the pairs of the kern table of a Hebrew text up in visual order',
                    'reverseArabicSentences (src/bidi.mjs): only an Arabic text is reordered right to left, a Hebrew text keeps the order of the text',
                    function() {
                        // kern table alef vav -100 and vav alef -50, -u 05D5,05D0: [1=1+450|2=0@-50,0+450]
                        const hebrewFont = createCharactersFont(['א', 'ו']);
                        hebrewFont.kerningPairs = { '1,2': -100, '2,1': -50 };
                        assert.equal(hebrewFont.getAdvanceWidth('וא', 1000), 900);
                    });
            });

            describe('a multiple substitution', function() {
                // feaLib: ccmp sub glyph1 by b c, kern b c -50 and c b -20, plus otherPairs; b and c are the glyphs
                // after the glyphs of the characters. The fork reads the ccmp of an Arabic text in DFLT.
                function createMultipleSubstitutionFont(characters, script, otherPairs = []) {
                    const multipleFont = createCharactersFont(characters);
                    const glyphB = characters.length + 1;
                    const glyphC = characters.length + 2;
                    const pairs = [[glyphB, glyphC, -50], [glyphC, glyphB, -20], ...otherPairs];
                    multipleFont.substitution.addMultiple('ccmp', { sub: 1, by: [glyphB, glyphC] }, script);
                    multipleFont.tables.gpos = createKerningGpos({ [script]: pairs.map((pair, index) => index) }, pairs);
                    multipleFont.position.init();
                    return multipleFont;
                }

                it('kerns the glyphs of one cluster in the order of the substitution', function() {
                    const multipleFont = createMultipleSubstitutionFont(['a'], 'latn');
                    // -u 61: [2=0+450|3=0+500]
                    assert.equal(multipleFont.getAdvanceWidth('a', 1000), 950);
                    // -u 61,61: [2=0+450|3=0+480|2=1+450|3=1+500]
                    assert.equal(multipleFont.getAdvanceWidth('aa', 1000), 1880);
                });

                it('kerns the glyphs of one cluster of a right-to-left text in the order of the substitution', function() {
                    // ccmp and kern in DFLT: the pairs in the order of the text are b c, c b, b c
                    const multipleFont = createMultipleSubstitutionFont(['ا'], 'DFLT');
                    // -u 0627,0627: [3=1+500|2=1+450|3=0+480|2=0+450]
                    assert.equal(multipleFont.getAdvanceWidth('اا', 1000), 1880);
                });

                it('kerns a right-to-left multiple substitution with the glyph of another cluster in the order of the text', function() {
                    // ccmp sub alef by b c and kern in DFLT, with c beh -7, beh b -3, b beh -11 and beh c -13:
                    // in the order of the text, b c beh for alef beh and beh b c for beh alef
                    const multipleFont = createMultipleSubstitutionFont(['ا', 'ب'], 'DFLT', [[4, 2, -7], [2, 3, -3], [3, 2, -11], [2, 4, -13]]);
                    // -u 0627,0628: [2=1+500|4=0+493|3=0+450]
                    assert.equal(multipleFont.getAdvanceWidth('اب', 1000), 1443);
                    // -u 0628,0627: [4=1+500|3=1+450|2=0+497]
                    assert.equal(multipleFont.getAdvanceWidth('با', 1000), 1447);
                });
            });

            describe('the lookupFlag of the kern lookups', function() {
                // the font of test/lookup-flags-font.mjs with its kern feature (feaLib), in latn (the fallback of the
                // other scripts) or in arab:
                //   lookup KERN_IGNORE_MARKS { lookupflag IgnoreMarks; pos a b -50; pos a acute -40; pos acute b -30;
                //       pos b reh -60; pos reh b -70; pos reh alef <-100 0 -100 0>; pos dal.alt waw <-40 0 -40 0>;
                //       pos waw dal.alt <-30 0 -30 0>; pos a_b c -25; }
                //   lookup KERN_NO_FLAG { pos a acute -20; pos lam_alef fatha <-40 0 -40 0>; pos lam_alef waw <-100 0 -100 0>;
                //       pos waw lam_alef <-50 0 -50 0>; }
                // hb-shape --no-glyph-names --cluster-level=1 LookupFlags.ttf -u <code points>
                const { a: glyphA, b: glyphB, c: glyphC, acute, alef, reh, fatha, dal, waw, lam } = glyphIndexes;
                const dalAlternate = glyphIndexes['dal.alt'];
                const lamAlef = glyphIndexes.lam_alef;
                // gsub: the GSUB table of the font, if any
                function createFlagsKerningFont(scriptTag, gsub) {
                    const pairSubtable = (leftIndex, rightIndex, value1) => ({
                        posFormat: 1,
                        coverage: { format: 1, glyphs: [leftIndex] },
                        valueFormat1: value1.xPlacement ? 5 : 4,
                        valueFormat2: 0,
                        pairSets: [[{ secondGlyph: rightIndex, value1, value2: undefined }]]
                    });
                    const lookups = [
                        {
                            lookupType: 2,
                            lookupFlag: 0x0008,
                            subtables: [
                                pairSubtable(glyphA, glyphB, { xAdvance: -50 }),
                                pairSubtable(glyphA, acute, { xAdvance: -40 }),
                                pairSubtable(acute, glyphB, { xAdvance: -30 }),
                                pairSubtable(glyphB, reh, { xAdvance: -60 }),
                                pairSubtable(reh, glyphB, { xAdvance: -70 }),
                                pairSubtable(reh, alef, { xPlacement: -100, xAdvance: -100 }),
                                pairSubtable(dalAlternate, waw, { xPlacement: -40, xAdvance: -40 }),
                                pairSubtable(waw, dalAlternate, { xPlacement: -30, xAdvance: -30 }),
                                pairSubtable(glyphIndexes.a_b, glyphC, { xAdvance: -25 })
                            ]
                        },
                        {
                            lookupType: 2,
                            lookupFlag: 0,
                            subtables: [
                                pairSubtable(glyphA, acute, { xAdvance: -20 }),
                                pairSubtable(lamAlef, fatha, { xPlacement: -40, xAdvance: -40 }),
                                pairSubtable(lamAlef, waw, { xPlacement: -100, xAdvance: -100 }),
                                pairSubtable(waw, lamAlef, { xPlacement: -50, xAdvance: -50 })
                            ]
                        }
                    ];
                    return createLookupFlagsFont({ gsub, gpos: createLayoutTable(scriptTag, 'kern', [0, 1], lookups) });
                }

                it('kerns a glyph with the next glyph that each kern lookup does not ignore, across the marks', function() {
                    // -u 0061,0301,0062: [1=0+430|5=1+0|2=2+500], the -50 of a b across the mark and the -20 of a acute,
                    // not the -30 of acute b
                    const flagsFont = createFlagsKerningFont('latn');
                    assert.deepStrictEqual(getOrigins(flagsFont, 'a\u{301}b'), [0, 430, 430]);
                    assert.equal(flagsFont.getAdvanceWidth('a\u{301}b', 1000), 930);
                    // -u 0061,0301: [1=0+480|5=1+0], -u 0061,0062: [1=0+450|2=1+500], -u 0301,0062: [5=0+0|2=1+500]
                    assert.equal(flagsFont.getKerningValue(glyphA, acute), -20);
                    assert.equal(flagsFont.getKerningValue(glyphA, glyphB), -50);
                    assert.equal(flagsFont.getKerningValue(acute, glyphB), 0);
                    assert.equal(flagsFont.getAdvanceWidth('', 1000), 0);
                });

                itFailsUntilFixed('kerns across the nonspacing marks of a font without the glyph classes of GDEF, like HarfBuzz',
                    'isGlyphIgnoredByLookup (src/layout.mjs): without the GlyphClassDef of GDEF no glyph is ignored, HarfBuzz synthesizes the ' +
                    'classes from the Unicode general category (hb_synthesize_glyph_classes): a acute b gives 910, the a acute -40 and -20 and the acute b -30',
                    function() {
                        // hb-shape --no-glyph-names --cluster-level=1 LookupFlagsNoGDEF.ttf -u 0061,0301,0062: [1=0+430|5=1+0|2=2+500]
                        const flagsFont = createFlagsKerningFont('latn');
                        flagsFont.tables.gdef = undefined;
                        assert.equal(flagsFont.getAdvanceWidth('a\u{301}b', 1000), 930);
                    });

                it('kerns a right-to-left pair across a mark, in the order of the text', function() {
                    // reh, fatha, alef: -u 0631,064E,0627: [12=2+500|14=1+0|13=0@-100,0+400], alef at 0, fatha at 500, reh at 400
                    const flagsFont = createFlagsKerningFont('arab');
                    assert.deepStrictEqual(getOrigins(flagsFont, '\u{631}\u{64E}\u{627}'), [0, 500, 400]);
                    assert.equal(flagsFont.getAdvanceWidth('\u{631}\u{64E}\u{627}', 1000), 900);
                });

                it('does not kern across the end of a direction run', function() {
                    // b, then the right-to-left run reh fatha, in visual order b fatha reh. HarfBuzz shapes each direction
                    // run on its own: -u 0062: [2=0+500], -u 0631,064E: [14=1+0|13=0+500]. Neither the b reh -60 of b with
                    // the reh after the fatha, nor the reh b -70 of reh, the last base of its run, with the b before the run:
                    // -u 0062,0631: [2=0+440|13=1+500], -u 0631,0062: [2=1+500|13=0+430]
                    const flagsFont = createFlagsKerningFont('latn');
                    assert.deepStrictEqual(getOrigins(flagsFont, 'b\u{631}\u{64E}'), [0, 500, 500]);
                    assert.equal(flagsFont.getAdvanceWidth('b\u{631}\u{64E}', 1000), 1000);
                });

                it('does not kern across the mark at the end of a left-to-right run with the right-to-left run after it', function() {
                    // b acute, then the right-to-left run reh: -u 0062,0301: [2=0+500|5=1+0], -u 0631: [13=0+500], not
                    // the b reh -60 across the acute of -u 0062,0301,0631: [2=0+440|5=1+0|13=2+500]
                    const flagsFont = createFlagsKerningFont('latn');
                    assert.deepStrictEqual(getOrigins(flagsFont, 'b\u{301}\u{631}'), [0, 500, 500]);
                    assert.equal(flagsFont.getAdvanceWidth('b\u{301}\u{631}', 1000), 1000);
                    // the right-to-left run reh, then acute b, a left-to-right run in the fork: -u 0062: [2=0+500], with
                    // the acute in the run of reh -u 0631,0301: [5=1+0|13=0+500], not the reh b -70 across the acute
                    assert.equal(flagsFont.getAdvanceWidth('\u{631}\u{301}b', 1000), 1000);
                });

                it('does not kern a right-to-left run of one glyph with the glyphs around it', function() {
                    // -u 0062: [2=0+500], -u 0631: [13=0+500], not the b reh -60 and the reh b -70 of
                    // -u 0062,0631: [2=0+440|13=1+500] and -u 0631,0062: [2=1+500|13=0+430]
                    const flagsFont = createFlagsKerningFont('latn');
                    assert.deepStrictEqual(getOrigins(flagsFont, 'b\u{631}'), [0, 500]);
                    assert.equal(flagsFont.getAdvanceWidth('b\u{631}', 1000), 1000);
                    assert.deepStrictEqual(getOrigins(flagsFont, 'b\u{631}b'), [0, 500, 1000]);
                    assert.equal(flagsFont.getAdvanceWidth('b\u{631}b', 1000), 1500);
                });

                it('kerns each right-to-left run of a text in visual order', function() {
                    // the right-to-left runs reh alef around the left-to-right b, which HarfBuzz shapes on their own:
                    // -u 0631,0627: [12=1+500|13=0@-100,0+400] (900), -u 0062: [2=0+500], so 900 + 500 + 900
                    const flagsFont = createFlagsKerningFont('arab');
                    const text = '\u{631}\u{627}b\u{631}\u{627}';
                    assert.equal(flagsFont.getAdvanceWidth(text, 1000), 2300);
                    assert.deepStrictEqual(getOrigins(flagsFont, text), [0, 400, 900, 1400, 1800]);
                });

                it('kerns a ligature of several characters with the glyph after it', function() {
                    // ss10 (here calt): sub a b by a_b; --features=+ss10 -u 0061,0062,0063: [9=0+475|3=2+500]
                    const ligatureLookup = {
                        lookupType: 4,
                        lookupFlag: 0,
                        subtables: [{
                            substFormat: 1,
                            coverage: { format: 1, glyphs: [glyphA] },
                            ligatureSets: [[{ ligGlyph: glyphIndexes.a_b, components: [glyphB] }]]
                        }]
                    };
                    const flagsFont = createFlagsKerningFont('latn', createLayoutTable('latn', 'calt', [0], [ligatureLookup]));
                    assert.deepStrictEqual(getOrigins(flagsFont, 'abc'), [0, 475]);
                    assert.equal(flagsFont.getAdvanceWidth('abc', 1000), 975);
                });

                it('kerns a right-to-left multiple substitution into a base and a mark across the mark', function() {
                    // ccmp: sub dal by dal.alt fatha; (in DFLT, where the fork looks the ccmp of an arabic text up), the
                    // glyphs of the cluster of dal share its start
                    const flagsFont = createFlagsKerningFont('arab');
                    flagsFont.substitution.addMultiple('ccmp', { sub: dal, by: [dalAlternate, fatha] }, 'DFLT');
                    // waw, dal: -u 0648,062F: [14=1+0|17=1+500|16=0@-30,0+470], the waw dal.alt -30 only, waw at 470
                    assert.equal(flagsFont.getAdvanceWidth('\u{648}\u{62F}', 1000), 970);
                    assert.equal(getOrigins(flagsFont, '\u{648}\u{62F}')[2], 470);
                    // dal, waw: -u 062F,0648: [16=1+500|14=0+0|17=0@-40,0+460], the dal.alt waw -40 across the fatha
                    assert.equal(flagsFont.getAdvanceWidth('\u{62F}\u{648}', 1000), 960);
                });

                it('kerns a right-to-left ligature and the mark in its cluster in the order of the text', function() {
                    // rlig: lookupflag IgnoreMarks; sub lam alef by lam_alef; merges the fatha between lam and alef into the
                    // cluster of the ligature, the fatha comes after the ligature in the order of the text
                    const ligatureLookup = {
                        lookupType: 4,
                        lookupFlag: 0x0008,
                        subtables: [{ substFormat: 1, coverage: { format: 1, glyphs: [lam] }, ligatureSets: [[{ ligGlyph: lamAlef, components: [alef] }]] }]
                    };
                    const flagsFont = createFlagsKerningFont('arab', createLayoutTable('arab', 'rlig', [0], [ligatureLookup]));
                    // lam, fatha, alef, waw: -u 0644,064E,0627,0648: [16=3+500|14=0+0|19=0@-40,0+460], the lam_alef fatha -40,
                    // not the lam_alef waw -100 across the fatha: waw at 0, fatha at 500, lam_alef at 460
                    assert.deepStrictEqual(getOrigins(flagsFont, '\u{644}\u{64E}\u{627}\u{648}'), [0, 500, 460]);
                    assert.equal(flagsFont.getAdvanceWidth('\u{644}\u{64E}\u{627}\u{648}', 1000), 960);
                    // waw, lam, fatha, alef: -u 0648,0644,064E,0627: [14=1+0|19=1@-40,0+460|16=0@-50,0+450], the waw lam_alef -50
                    // and the lam_alef fatha -40: fatha at 0, lam_alef at -40, waw at 410
                    assert.deepStrictEqual(getOrigins(flagsFont, '\u{648}\u{644}\u{64E}\u{627}'), [0, -40, 410]);
                    assert.equal(flagsFont.getAdvanceWidth('\u{648}\u{644}\u{64E}\u{627}', 1000), 910);
                });
            });

            it('adds the x advance of a right-to-left GPOS pair to the first glyph of the text', function() {
                // feaLib: arab, pos reh alef <0 0 -100 0> (ValueFormat1 4)
                // -u 062F,0631,0627: [1=2+500|2=1+400|3=0+500], alef at 0, reh at 500, dal at 900
                const arabicFont = createCharactersFont(['ا', 'ر', 'د']);
                arabicFont.tables.gpos = createKerningGpos({ arab: [0] }, [[2, 1, -100]]);
                arabicFont.position.init();
                assert.deepStrictEqual(getOrigins(arabicFont, 'درا'), [0, 500, 900]);
            });
        });
    });

    // TestPairPositioning.ttf, built by test/generate-pair-positioning-font.py, and the kern table of LookupFlagsKernTable.ttf
    // (test/generate-lookup-flags-font.py): hb-shape --no-glyph-names --cluster-level=1 <font> -u <code points>
    describe('shape', function() {
        let pairFont;

        // a shaped text in the format of hb-shape: glyph=cluster@x,y+advance, the offsets when one is not 0
        function formatShape(glyphPositions) {
            return '[' + glyphPositions.map(({ glyph, start, xAdvance, xOffset, yOffset }) =>
                `${glyph.index}=${start}${xOffset || yOffset ? `@${xOffset},${yOffset}` : ''}+${xAdvance}`
            ).join('|') + ']';
        }

        before(function() {
            pairFont = loadSync('./test/fonts/TestPairPositioning.ttf');
        });

        it('gives each glyph its cluster, its advances and its offsets in font units', function() {
            // -u 0041,0056: [2=0@10,20+570|4=1@-5,15+575], pos A <10 20 -30 40> V <-5 15 -25 35>; the y advances are
            // for vertical text
            const [glyphA, glyphV] = [pairFont.charToGlyph('A'), pairFont.charToGlyph('V')];
            assert.deepStrictEqual(pairFont.shape('AV'), [
                { glyph: glyphA, start: 0, end: 1, xAdvance: 570, yAdvance: 0, xOffset: 10, yOffset: 20 },
                { glyph: glyphV, start: 1, end: 2, xAdvance: 575, yAdvance: 0, xOffset: -5, yOffset: 15 }
            ]);
            assert.deepStrictEqual(pairFont.shape(''), []);
        });

        it('gives the clusters of hb-shape, the ones of stringToGlyphClusters', function() {
            // -u 0054,0301,006F,1F600: [3=0+460|10=1+0|9=2@15,-10+500|0=3+500], the end 5 of the surrogate pair in UTF-16
            const text = 'T\u{301}o\u{1F600}';
            const glyphPositions = pairFont.shape(text);
            assert.deepStrictEqual(glyphPositions.map(({ glyph, start, end }) => [glyph.index, start, end]), [[3, 0, 1], [10, 1, 2], [9, 2, 3], [0, 3, 5]]);
            assert.deepStrictEqual(glyphPositions.map(({ glyph, start, end }) => ({ glyph, start, end })), pairFont.stringToGlyphClusters(text));
        });

        it('shapes a font parsed with lowMemory, whose glyphs load on request, like the font parsed at once', function() {
            const lowMemoryFont = loadSync('./test/fonts/TestPairPositioning.ttf', { lowMemory: true });
            // -u 0041,0056: [2=0@10,20+570|4=1@-5,15+575], -u 0054,0301,006F: [3=0+460|10=1+0|9=2@15,-10+500],
            // -u 0061,0062,0063,0064: [5=0+450|6=1+480|7=2+460|8=3+500], -u 062F,0631,0627: [11=2@0,30+240|13=1@-100,0+300|12=0+500],
            // --variations=wght=300 -u 0054,0061: [3=0@15,10+470|5=1@-2,5+497]
            assert.strictEqual(formatShape(lowMemoryFont.shape('AV')), '[2=0@10,20+570|4=1@-5,15+575]');
            assert.strictEqual(formatShape(lowMemoryFont.shape('T\u{301}o')), '[3=0+460|10=1+0|9=2@15,-10+500]');
            assert.strictEqual(formatShape(lowMemoryFont.shape('abcd')), '[5=0+450|6=1+480|7=2+460|8=3+500]');
            assert.strictEqual(formatShape(lowMemoryFont.shape('درا')), '[11=2@0,30+240|13=1@-100,0+300|12=0+500]');
            assert.strictEqual(formatShape(lowMemoryFont.shape('Ta', { variation: { wght: 300 } })), '[3=0@15,10+470|5=1@-2,5+497]');
        });

        it('gives no advance to a glyph without advance width, so that the pen does not move', function() {
            const glyphs = [
                new Glyph({ index: 0, name: '.notdef', path: new Path() }),
                new Glyph({ index: 1, name: 'A', unicode: 0x41, path: new Path() })
            ];
            const font = new Font({ familyName: 'NoAdvance', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
            assert.deepStrictEqual(font.shape('AA').map(({ xAdvance }) => xAdvance), [0, 0]);
            assert.strictEqual(font.getAdvanceWidth('AA', 1000), 0);
            const glyphXs = [];
            font.forEachGlyph('AA', 0, 0, 1000, {}, (glyph, glyphX) => glyphXs.push(glyphX));
            assert.deepStrictEqual(glyphXs, [0, 0]);
        });

        it('applies the pairs of the kern feature across the marks a lookup ignores, and goes on after a second value record', function() {
            // -u 0054,0301,006F: [3=0+460|10=1+0|9=2@15,-10+500], the class pair T o of a lookup with IgnoreMarks
            assert.strictEqual(formatShape(pairFont.shape('T\u{301}o')), '[3=0+460|10=1+0|9=2@15,-10+500]');
            // -u 0061,0062,0063,0064: [5=0+450|6=1+480|7=2+460|8=3+500], a b with a second value record: b c is skipped
            assert.strictEqual(formatShape(pairFont.shape('abcd')), '[5=0+450|6=1+480|7=2+460|8=3+500]');
            // -u 006F,0063: [9=0@5,0+485|7=1+495], an extension lookup
            assert.strictEqual(formatShape(pairFont.shape('oc')), '[9=0@5,0+485|7=1+495]');
        });

        it('applies the variation deltas of every field of a pair at the variation of the options or of the font', function() {
            // --variations=wght=300 -u 0054,0061: [3=0@15,10+470|5=1@-2,5+497], the delta -2.5 of the second x placement
            // rounded to -2
            assert.strictEqual(formatShape(pairFont.shape('Ta', { variation: { wght: 300 } })), '[3=0@15,10+470|5=1@-2,5+497]');
            // --variations=wght=900 -u 0054,0061: [3=0@30,40+440|5=1@-10,20+488]
            const variableFont = loadSync('./test/fonts/TestPairPositioning.ttf');
            variableFont.variation.set({ wght: 900 });
            assert.strictEqual(formatShape(variableFont.shape('Ta')), '[3=0@30,40+440|5=1@-10,20+488]');
            // -u 0054,0061: [3=0@10,0+480|5=1+500]
            assert.strictEqual(formatShape(variableFont.shape('Ta', { variation: { wght: 100 } })), '[3=0@10,0+480|5=1+500]');
        });

        it('applies a right-to-left pair in the order of the text, its glyphs in visual order', function() {
            // -u 062F,0631,0627: [11=2@0,30+240|13=1@-100,0+300|12=0+500], pos reh <-100 0 -100 0> alef <0 30 -60 0>;
            assert.strictEqual(formatShape(pairFont.shape('درا')), '[11=2@0,30+240|13=1@-100,0+300|12=0+500]');
        });

        it('applies the GPOS features of HarfBuzz by default and the features option, kern with the kerning option', function() {
            // dist and kern both have d a -70, which applies once: -u 0064,0061: [8=0+430|5=1+500], the same with
            // --features=-kern and with --features=-dist, and with --features=-dist,-kern [8=0+500|5=1+500]
            assert.strictEqual(formatShape(pairFont.shape('da')), '[8=0+430|5=1+500]');
            assert.strictEqual(formatShape(pairFont.shape('da', { kerning: false })), '[8=0+430|5=1+500]');
            assert.strictEqual(formatShape(pairFont.shape('da', { features: { dist: false } })), '[8=0+430|5=1+500]');
            assert.strictEqual(formatShape(pairFont.shape('da', { kerning: false, features: { dist: false } })), '[8=0+500|5=1+500]');
            // the d o -80 of ss01: -u 0064,006F: [8=0+500|9=1+500], with --features=+ss01 [8=0+420|9=1+500]
            assert.strictEqual(formatShape(pairFont.shape('do')), '[8=0+500|9=1+500]');
            assert.strictEqual(formatShape(pairFont.shape('do', { features: { ss01: true } })), '[8=0+420|9=1+500]');
            // --features=-kern -u 0041,0056: [2=0+600|4=1+600]
            assert.strictEqual(formatShape(pairFont.shape('AV', { features: { kern: false } })), '[2=0+600|4=1+600]');
            // the b a -60 of abvm: -u 0062,0061 [6=0+440|5=1+500], with --features=-abvm [6=0+500|5=1+500]
            assert.strictEqual(formatShape(pairFont.shape('ba')), '[6=0+440|5=1+500]');
            assert.strictEqual(formatShape(pairFont.shape('ba', { features: { abvm: false } })), '[6=0+500|5=1+500]');
            // the c a -90 of blwm: -u 0063,0061 [7=0+410|5=1+500], with --features=-blwm [7=0+500|5=1+500]
            assert.strictEqual(formatShape(pairFont.shape('ca')), '[7=0+410|5=1+500]');
            assert.strictEqual(formatShape(pairFont.shape('ca', { features: { blwm: false } })), '[7=0+500|5=1+500]');
        });

        it('applies the single adjustments of the features, the y advance of their value records for vertical text only', function() {
            // TestSingleAdjustment.ttf, --features=case -u 0048: [5=0@10,20+570], pos H <10 20 -30 40>;, --features=vpal
            // -u 0056: [7=0@0,50+600], pos V <0 50 0 -100>;, the y advances 0
            const singleFont = loadSync('./test/fonts/TestSingleAdjustment.ttf');
            assert.deepStrictEqual(singleFont.shape('H', { features: { case: true } }), [
                { glyph: singleFont.charToGlyph('H'), start: 0, end: 1, xAdvance: 570, yAdvance: 0, xOffset: 10, yOffset: 20 }
            ]);
            assert.deepStrictEqual(singleFont.shape('V', { features: { vpal: true } }), [
                { glyph: singleFont.charToGlyph('V'), start: 0, end: 1, xAdvance: 600, yAdvance: 0, xOffset: 0, yOffset: 50 }
            ]);
        });

        it('applies the single adjustments of the kern feature with the kerning option, which getKerningValue leaves out', function() {
            // TestSingleAdjustment.ttf, -u 0062,0063,0064: [9=0+485|10=1+490|11=2+460], --features=-kern
            // [9=0+500|10=1+500|11=2+500]
            const singleFont = loadSync('./test/fonts/TestSingleAdjustment.ttf');
            assert.strictEqual(formatShape(singleFont.shape('bcd')), '[9=0+485|10=1+490|11=2+460]');
            assert.strictEqual(formatShape(singleFont.shape('bcd', { kerning: false })), '[9=0+500|10=1+500|11=2+500]');
            assert.strictEqual(singleFont.getAdvanceWidth('bcd', 1000), 1435);
            assert.strictEqual(singleFont.getAdvanceWidth('bcd', 1000, { kerning: false }), 1500);
            // the b -15 of the extension lookup 5, the c -10 of the plain lookup 6, the alef +10 -20 of the format 2
            // lookup 7 of hebr
            const glyph = character => singleFont.charToGlyph(character);
            assert.strictEqual(singleFont.getKerningValue(glyph('b'), glyph('c')), 0);
            assert.strictEqual(singleFont.getKerningValue(glyph('c'), glyph('d')), 0);
            assert.strictEqual(singleFont.getKerningValue(glyph('\u{5D0}'), glyph('\u{5D1}')), 0);
        });

        it('applies the single adjustments of a right-to-left run of a text in the order of the text, its glyphs in visual order', function() {
            // TestPairPositioning.ttf with a single adjustment lookup (format 2) in kern, pos b <0 0 -25 0>; alef
            // <10 0 -20 0>; dal <-5 0 30 0>; reh <0 15 -10 0>; (fontTools), saved as kern-single.ttf: the left-to-right
            // run b, -u 0062: [6=0+475], then the right-to-left run dal reh alef, -u 062F,0631,0627:
            // [11=2@10,30+220|13=1@-100,15+290|12=0@-5,0+530], with the pairs reh alef and dal reh of kern
            const singleFont = loadSync('./test/fonts/TestPairPositioning.ttf');
            const gpos = singleFont.tables.gpos;
            const glyphIndex = character => singleFont.charToGlyphIndex(character);
            gpos.lookups.push({
                lookupType: 1,
                lookupFlag: 0,
                subtables: [{
                    posFormat: 2,
                    coverage: { format: 1, glyphs: [glyphIndex('b'), glyphIndex('ا'), glyphIndex('د'), glyphIndex('ر')] },
                    values: [
                        { xPlacement: 0, yPlacement: 0, xAdvance: -25 },
                        { xPlacement: 10, yPlacement: 0, xAdvance: -20 },
                        { xPlacement: -5, yPlacement: 0, xAdvance: 30 },
                        { xPlacement: 0, yPlacement: 15, xAdvance: -10 }
                    ]
                }]
            });
            gpos.features.find(({ tag }) => tag === 'kern').feature.lookupListIndexes.push(gpos.lookups.length - 1);
            assert.strictEqual(formatShape(singleFont.shape('bدرا')), '[6=0+475|11=3@10,30+220|13=2@-100,15+290|12=1@-5,0+530]');
        });

        it('applies the GPOS lookups of mset to the Arabic runs only, a default GSUB feature of the Arabic shaper', function() {
            // pos beh alef -30; pos a c -30; in mset: -u 0628,0627 [11=1+300|18=0+470], with --features=-mset
            // [11=1+300|18=0+500]
            assert.strictEqual(formatShape(pairFont.shape('با')), '[11=1+300|18=0+470]');
            assert.strictEqual(formatShape(pairFont.shape('با', { features: { mset: false } })), '[11=1+300|18=0+500]');
            // -u 0061,0063 [5=0+500|7=1+500], not in the features of a Latin run; with --features=+mset [5=0+470|7=1+500]
            assert.strictEqual(formatShape(pairFont.shape('ac')), '[5=0+500|7=1+500]');
            assert.strictEqual(formatShape(pairFont.shape('ac', { features: { mset: true } })), '[5=0+470|7=1+500]');
        });

        it('takes the GPOS features of each script run from its own shaper in a mixed text', function() {
            // HarfBuzz shapes each run on its own (one hb-shape call on the mixed text is one script): -u 0061,0063
            // [5=0+500|7=1+500] and -u 0628,0627 [11=1+300|18=0+470], the clusters shifted by the start of the run
            assert.strictEqual(formatShape(pairFont.shape('acبا')), '[5=0+500|7=1+500|11=3+300|18=2+470]');
            assert.strictEqual(formatShape(pairFont.shape('باac')), '[11=1+300|18=0+470|5=2+500|7=3+500]');
        });

        it('takes the GPOS features of the shaper of the script option for the whole text, like HarfBuzz', function() {
            // --script=arab -u 0061,0063,0628,0627 [11=3+300|18=2+470|7=1+500|5=0+470]: the mset pair a c -30 applies
            // to the Latin pair too; the same glyph positions, HarfBuzz lays the whole buffer out right to left, the
            // fork each direction run in its own direction
            assert.strictEqual(formatShape(pairFont.shape('acبا', { script: 'arab' })), '[5=0+470|7=1+500|11=3+300|18=2+470]');
        });

        it('takes a features list, the old per-script form of the features option, as the default GPOS features', function() {
            // the GSUB features of updateFeatures are the defaults then, the GPOS ones too: -u 0064,0061 [8=0+430|5=1+500],
            // -u 0065,0066,0067,0068,0065 [14=0+450|15=1+400|16=2+430|17=3+500|14=4+500]
            assert.strictEqual(formatShape(pairFont.shape('da', { features: [] })), '[8=0+430|5=1+500]');
            assert.strictEqual(formatShape(pairFont.shape('efghe', { features: [{ script: 'latn', tags: [] }] })), '[14=0+450|15=1+400|16=2+430|17=3+500|14=4+500]');
        });

        describe('the direction features and rand', function() {
            // TestPairPositioning.ttf with the tag of ss01 (pos d o -80) or of init (pos beh beh -100) changed (fontTools),
            // saved as <tag>.ttf: hb-shape --no-glyph-names --cluster-level=1 <tag>.ttf -u <code points>
            const retaggedFonts = {};

            function loadRetaggedFont(featureTag, newFeatureTag) {
                const font = loadSync('./test/fonts/TestPairPositioning.ttf');
                font.tables.gpos.features.find(featureRecord => featureRecord.tag === featureTag).tag = newFeatureTag;
                return font;
            }

            before(function() {
                for (const tag of ['ltra', 'ltrm', 'rand']) {
                    retaggedFonts[tag] = loadRetaggedFont('ss01', tag);
                }
                for (const tag of ['rtla', 'rtlm']) {
                    retaggedFonts[tag] = loadRetaggedFont('init', tag);
                }
            });

            itFailsUntilFixed('applies the GPOS lookups of the direction features and of rand by default, like HarfBuzz',
                'getPositioningFeatureTags (src/font.mjs): the GPOS features of a run are the default GSUB features of its ' +
                'shaper and DEFAULT_POSITIONING_FEATURES, without ltra and ltrm (left-to-right runs), rtla and rtlm ' +
                '(right-to-left runs) and rand, which HarfBuzz enables by default (hb-ot-shape.cc)',
                function() {
                    // -u 0064,006F: [8=0+420|9=1+500] with ltra, ltrm and rand; -u 0628,0628,0628: [18=2+500|18=1+400|18=0+400]
                    // with rtla and rtlm
                    assert.deepStrictEqual(
                        [
                            formatShape(retaggedFonts.ltra.shape('do')),
                            formatShape(retaggedFonts.ltrm.shape('do')),
                            formatShape(retaggedFonts.rand.shape('do')),
                            formatShape(retaggedFonts.rtla.shape('ببب')),
                            formatShape(retaggedFonts.rtlm.shape('ببب'))
                        ],
                        [
                            '[8=0+420|9=1+500]', '[8=0+420|9=1+500]', '[8=0+420|9=1+500]',
                            '[18=2+500|18=1+400|18=0+400]', '[18=2+500|18=1+400|18=0+400]'
                        ]
                    );
                });
        });

        itFailsUntilFixed('applies the GPOS feature variations at the variation of the options, like HarfBuzz',
            'getPositioningLookupTables and getRequiredFeatureTable (src/position.mjs): the feature tables of the GPOS ' +
            'FeatureVariations (tables.gpos.variations) are never substituted, Layout.getFeatureTable gives the one of the ' +
            'FeatureList at every variation; FeatureQuery.getFeatureVariationSubstitutions selects them for GSUB only',
            function() {
                // the dist of TestPairPositioning.ttf has V A -200 from wght 600 to 900:
                // --variations=wght=100 -u 0056,0041: [4=0+600|2=1+600], --variations=wght=700: [4=0+400|2=1+600]
                assert.deepStrictEqual(
                    [
                        formatShape(pairFont.shape('VA', { variation: { wght: 100 } })),
                        formatShape(pairFont.shape('VA', { variation: { wght: 700 } })),
                        pairFont.getAdvanceWidth('VA', 1000, { variation: { wght: 700 } })
                    ],
                    ['[4=0+600|2=1+600]', '[4=0+400|2=1+600]', 400 + 600]
                );
            });

        it('applies the GPOS lookups of the default GSUB features of the run, like HarfBuzz', function() {
            // HarfBuzz looks each feature of its map up in GSUB and in GPOS: -u 0065,0066,0067,0068,0065
            // [14=0+450|15=1+400|16=2+430|17=3+500|14=4+500], the e f -50 of rvrn, f g -100 of calt, g h -70 of liga
            assert.strictEqual(formatShape(pairFont.shape('efghe')), '[14=0+450|15=1+400|16=2+430|17=3+500|14=4+500]');
            // the h e -40 of the locl of latn ROM: --language=ro [14=0+450|15=1+400|16=2+430|17=3+460|14=4+500]
            assert.strictEqual(formatShape(pairFont.shape('efghe', { language: 'ROM' })), '[14=0+450|15=1+400|16=2+430|17=3+460|14=4+500]');
            // the features option turns off the GSUB and the GPOS lookups of a feature: --features=-rvrn -u 0065,0066
            // [14=0+500|15=1+500], --features=-calt -u 0066,0067 [15=0+500|16=1+500], --features=-liga -u 0067,0068
            // [16=0+500|17=1+500], --language=ro --features=-locl -u 0068,0065 [17=0+500|14=1+500]
            assert.strictEqual(formatShape(pairFont.shape('ef', { features: { rvrn: false } })), '[14=0+500|15=1+500]');
            assert.strictEqual(formatShape(pairFont.shape('fg', { features: { calt: false } })), '[15=0+500|16=1+500]');
            assert.strictEqual(formatShape(pairFont.shape('gh', { features: { liga: false } })), '[16=0+500|17=1+500]');
            assert.strictEqual(formatShape(pairFont.shape('he', { language: 'ROM', features: { locl: false } })), '[17=0+500|14=1+500]');
        });

        describe('the GSUB lookups of the default GPOS features', function() {
            // TestPairPositioning.ttf with a GSUB of DFLT and latn (feaLib): feature dist { sub a by b; } dist;
            // feature kern { sub c by d; } kern;
            let gsubDefaultsFont;

            before(function() {
                gsubDefaultsFont = loadSync('./test/fonts/TestPairPositioning.ttf');
                const [glyphA, glyphB, glyphC, glyphD] = ['a', 'b', 'c', 'd'].map(character => gsubDefaultsFont.charToGlyphIndex(character));
                gsubDefaultsFont.tables.gsub = createScriptsLayoutTable(
                    { DFLT: [['dist', [0]], ['kern', [1]]], latn: [['dist', [0]], ['kern', [1]]] },
                    [createSingleLookup([glyphA], [glyphB]), createSingleLookup([glyphC], [glyphD])]
                );
            });

            itFailsUntilFixed('applies the GSUB lookups of dist and kern by default, like HarfBuzz',
                'Font.updateFeatures (src/font.mjs): the GSUB features of a run are the ones of defaultRenderOptions.features, ' +
                'without abvm, blwm, curs, dist, kern, mark and mkmk, which HarfBuzz enables by default and looks up in GSUB ' +
                'too (hb_ot_shape_collect_features); getPositioningFeatureTags adds them to the GPOS features only',
                function() {
                    // -u 0061,0063 [6=0+500|8=1+500], with --features=-kern [6=0+500|7=1+500]
                    assert.strictEqual(formatShape(gsubDefaultsFont.shape('ac')), '[6=0+500|8=1+500]');
                });
        });

        it('applies the GPOS lookups of an Arabic form only when the features option enables it, at every glyph', function() {
            // pos beh beh -100 in init: -u 0628,0628,0628 [18=2+500|18=1+500|18=0+500], HarfBuzz applies it at the
            // initial beh only, whose second glyph is not initial; with --features=+init, at every glyph
            // [18=2+500|18=1+400|18=0+400]
            assert.strictEqual(formatShape(pairFont.shape('ببب')), '[18=2+500|18=1+500|18=0+500]');
            assert.strictEqual(formatShape(pairFont.shape('ببب', { features: { init: true } })), '[18=2+500|18=1+400|18=0+400]');
        });

        it('ignores a feature index past the FeatureList of a language system, like HarfBuzz', function() {
            // TestPairPositioning.ttf with the FeatureIndex 99 after the others in each DefaultLangSys (fontTools):
            // -u 0041,0056: [2=0@10,20+570|4=1@-5,15+575]
            const featureIndexFont = loadSync('./test/fonts/TestPairPositioning.ttf');
            for (const scriptRecord of featureIndexFont.tables.gpos.scripts) {
                scriptRecord.script.defaultLangSys.featureIndexes.push(99);
            }
            assert.strictEqual(formatShape(featureIndexFont.shape('AV')), '[2=0@10,20+570|4=1@-5,15+575]');
            assert.strictEqual(featureIndexFont.getAdvanceWidth('AV', 1000), 570 + 575);
        });

        it('ignores a lookup index past the LookupList in a feature, like HarfBuzz', function() {
            // TestPairPositioning.ttf with the LookupListIndex 999 after the others in kern and in dist (fontTools):
            // -u 0041,0056: [2=0@10,20+570|4=1@-5,15+575], -u 0064,0061: [8=0+430|5=1+500]
            const lookupIndexFont = loadSync('./test/fonts/TestPairPositioning.ttf');
            for (const featureRecord of lookupIndexFont.tables.gpos.features) {
                if (featureRecord.tag === 'kern' || featureRecord.tag === 'dist') {
                    featureRecord.feature.lookupListIndexes.push(999);
                }
            }
            assert.strictEqual(formatShape(lookupIndexFont.shape('AV')), '[2=0@10,20+570|4=1@-5,15+575]');
            assert.strictEqual(formatShape(lookupIndexFont.shape('da')), '[8=0+430|5=1+500]');
            assert.strictEqual(lookupIndexFont.getAdvanceWidth('AV', 1000), 570 + 575);
        });

        it('applies the first feature of a tag in the FeatureIndex of the language system, like HarfBuzz', function() {
            // TestPairPositioning.ttf with a second kern feature, with the lookups of ss01 (pos d o -80), in each
            // DefaultLangSys (fontTools): before the other features, -u 0064,006F: [8=0+420|9=1+500] and -u 0041,0056:
            // [2=0+600|4=1+600]; after them, -u 0064,006F: [8=0+500|9=1+500] and -u 0041,0056: [2=0@10,20+570|4=1@-5,15+575]
            function loadDuplicateKernFont(isFirst) {
                const font = loadSync('./test/fonts/TestPairPositioning.ttf');
                const features = font.tables.gpos.features;
                const ss01Feature = features.find(featureRecord => featureRecord.tag === 'ss01').feature;
                features.push({ tag: 'kern', feature: { featureParams: 0, lookupListIndexes: ss01Feature.lookupListIndexes.slice() } });
                for (const scriptRecord of font.tables.gpos.scripts) {
                    const featureIndexes = scriptRecord.script.defaultLangSys.featureIndexes;
                    if (isFirst) {
                        featureIndexes.unshift(features.length - 1);
                    } else {
                        featureIndexes.push(features.length - 1);
                    }
                }
                return font;
            }
            const firstKernFont = loadDuplicateKernFont(true);
            assert.strictEqual(formatShape(firstKernFont.shape('do')), '[8=0+420|9=1+500]');
            assert.strictEqual(formatShape(firstKernFont.shape('AV')), '[2=0+600|4=1+600]');
            const lastKernFont = loadDuplicateKernFont(false);
            assert.strictEqual(formatShape(lastKernFont.shape('do')), '[8=0+500|9=1+500]');
            assert.strictEqual(formatShape(lastKernFont.shape('AV')), '[2=0@10,20+570|4=1@-5,15+575]');
        });

        itFailsUntilFixed('applies a GPOS pair across a default ignorable, hidden with an advance of 0, like HarfBuzz',
            'Font.shape (src/font.mjs) and findNextNotIgnoredGlyphPosition (src/layout.mjs): the zero width joiner U+200D, ' +
            'which the font has not, is drawn as .notdef with its advance, and the pair A V skips only the glyphs the GDEF ' +
            'classes and the lookupFlag ignore; HarfBuzz skips the default ignorables in the GPOS pairs (ignore_zwj) and ' +
            'hides them with the space glyph and an advance of 0 (hb_ot_hide_default_ignorables)',
            function() {
                // -u 0041,200D,0056: [2=0@10,20+570|1=1+0|4=2@-5,15+575], the same with U+00AD, U+200C, U+034F and U+2060
                assert.strictEqual(formatShape(pairFont.shape('A\u{200D}V')), '[2=0@10,20+570|1=1+0|4=2@-5,15+575]');
            });

        describe('a GDEF mark with an advance width', function() {
            // TestPairPositioning.ttf with an advance of 100 for acutecomb, a GDEF mark, in hmtx (fontTools)
            let markAdvanceFont;
            // the same font with a GSUB of the scripts DFLT and latn only (feaLib: sub .notdef by .notdef; in ccmp)
            let latinGsubMarkAdvanceFont;

            before(function() {
                markAdvanceFont = loadSync('./test/fonts/TestPairPositioning.ttf');
                markAdvanceFont.charToGlyph('\u{301}').advanceWidth = 100;
                latinGsubMarkAdvanceFont = loadSync('./test/fonts/TestPairPositioning.ttf');
                latinGsubMarkAdvanceFont.charToGlyph('\u{301}').advanceWidth = 100;
                latinGsubMarkAdvanceFont.tables.gsub = createScriptsLayoutTable(
                    { DFLT: [['ccmp', [0]]], latn: [['ccmp', [0]]] },
                    [createSingleLookup([0], [0])]
                );
            });

            it('sets the advance of a GDEF mark to 0 after GPOS in a Latin text, like HarfBuzz', function() {
                // -u 0054,0301,006F [3=0+460|10=1+0|9=2@15,-10+500], the same with --features=-mark
                assert.strictEqual(formatShape(markAdvanceFont.shape('T\u{301}o')), '[3=0+460|10=1+0|9=2@15,-10+500]');
            });

            it('keeps the advance of a GDEF mark in the Indic and Khmer scripts, like HarfBuzz', function() {
                // the Indic and Khmer shapers of HarfBuzz do not zero the advances of the marks (HB_OT_SHAPE_ZERO_WIDTH_MARKS_NONE):
                // --script=deva --features=-mark -u 0061,0301,0062 [5=0+500|10=1+100|6=2+500], the same with --script=khmr.
                // HarfBuzz takes its Indic shaper for deva because the font has no GSUB: with a GSUB script DFLT or latn it
                // takes its default shaper (see the test below)
                for (const script of ['deva', 'khmr']) {
                    assert.strictEqual(formatShape(markAdvanceFont.shape('a\u{301}b', { script, features: { mark: false } })), '[5=0+500|10=1+100|6=2+500]', script);
                }
            });

            it('sets the advance of a GDEF mark to 0 before GPOS in a USE script whose GSUB script is its own, like HarfBuzz', function() {
                // TestMarkAttachment.ttf (a dot below of 100 units, ss01 adds 40 to it): --script=Gonm --features=+ss01
                // -u 0061,0323,0301 [2=0+500|12=1@-300,30+0|10=2@-250,20+0], the default shaper for the GSUB script DFLT;
                // with the script record DFLT of GSUB renamed gonm (fontTools) [2=0+500|12=1@-300,30+40|10=2@-290,20+0],
                // the USE shaper, which sets the advance of the marks to 0 before GPOS
                const markFont = loadSync('./test/fonts/TestMarkAttachment.ttf');
                const options = { script: 'gonm', features: { ss01: true } };
                assert.strictEqual(formatShape(markFont.shape('a\u{323}\u{301}', options)), '[2=0+500|12=1@-300,30+0|10=2@-250,20+0]');
                const scripts = markFont.tables.gsub.scripts;
                scripts.find(scriptRecord => scriptRecord.tag === 'DFLT').tag = 'gonm';
                scripts.sort((scriptA, scriptB) => scriptA.tag < scriptB.tag ? -1 : 1);
                assert.strictEqual(formatShape(markFont.shape('a\u{323}\u{301}', options)), '[2=0+500|12=1@-300,30+40|10=2@-290,20+0]');
            });

            it('sets the advance of a GDEF mark to 0 in an Indic script whose GSUB script is DFLT or latn, like HarfBuzz', function() {
                // --script=deva --features=-mark -u 0061,0301,0062 [5=0+500|10=1+0|6=2+500]
                assert.strictEqual(
                    formatShape(latinGsubMarkAdvanceFont.shape('a\u{301}b', { script: 'deva', features: { mark: false } })),
                    '[5=0+500|10=1+0|6=2+500]'
                );
            });
        });

        describe('the kern table', function() {
            // the kern table of LookupFlagsKernTable.ttf (test/generate-lookup-flags-font.py): no GPOS table, the pairs
            // a acute -15, a b -60, acute b -40 and A V -100
            let kernTableFont;

            // the glyph, the x advance and the offsets of each glyph of a shaped text
            function shapeKernTableText(text, options) {
                return kernTableFont.shape(text, options).map(({ glyph, xAdvance, xOffset, yOffset }) => [glyph.index, xAdvance, xOffset, yOffset]);
            }

            beforeEach(function() {
                kernTableFont = createLookupFlagsFont();
                kernTableFont.kerningPairs = {
                    [`${glyphIndexes.a},${glyphIndexes.acute}`]: -15,
                    [`${glyphIndexes.a},${glyphIndexes.b}`]: -60,
                    [`${glyphIndexes.acute},${glyphIndexes.b}`]: -40,
                    [`${glyphIndexes.A},${glyphIndexes.V}`]: -100
                };
            });

            it('splits the value of a pair between its two glyphs, across the marks, like HarfBuzz', function() {
                // -u 0061,0062: [1=0+470|2=1@-30,0+470]
                assert.deepStrictEqual(shapeKernTableText('ab'), [[glyphIndexes.a, 470, 0, 0], [glyphIndexes.b, 470, -30, 0]]);
                // -u 0061,0301,0062: [1=0+470|5=1@-470,562+0|2=2@-30,0+470], the a b -60 across the acute, which starts no
                // pair after a: not the acute b -40. Only a and b: the acute is placed by the fallback mark positioning of
                // HarfBuzz (see the expected failure below)
                const [glyphA, , glyphB] = shapeKernTableText('a\u{301}b');
                assert.deepStrictEqual([glyphA, glyphB], [[glyphIndexes.a, 470, 0, 0], [glyphIndexes.b, 470, -30, 0]]);
                // -u 0061,0301: [1=0+500|5=1@-500,562+0], no glyph after a that is not a mark: not the a acute -15
                assert.deepStrictEqual(shapeKernTableText('a\u{301}')[0], [glyphIndexes.a, 500, 0, 0]);
                // -u 0301,0062: [5=0@20,0+0|2=1@-20,0+480], a mark at the start of the text kerned with the next glyph;
                // only b: HarfBuzz also sets the advance of the acute to 0 (see the test below)
                assert.deepStrictEqual(shapeKernTableText('\u{301}b')[1], [glyphIndexes.b, 480, -20, 0]);
                // with a b -61: [1=0+469|2=1@-30,0+470], half of the value rounded down to the first glyph
                kernTableFont.kerningPairs[`${glyphIndexes.a},${glyphIndexes.b}`] = -61;
                assert.deepStrictEqual(shapeKernTableText('ab'), [[glyphIndexes.a, 469, 0, 0], [glyphIndexes.b, 470, -30, 0]]);
                // with a b +61: [1=0+530|2=1@31,0+531], half of the value rounded down to the first glyph
                kernTableFont.kerningPairs[`${glyphIndexes.a},${glyphIndexes.b}`] = 61;
                assert.deepStrictEqual(shapeKernTableText('ab'), [[glyphIndexes.a, 530, 0, 0], [glyphIndexes.b, 531, 31, 0]]);
            });

            it('applies the GPOS lookups of the features, then the kern table, when GPOS has no kern feature, like HarfBuzz', function() {
                // TestPairPositioning.ttf with kern out of the FeatureIndex of every language system and the kern table
                // d a -20, A V -100 (fontTools): -u 0064,0061 [8=0+420|5=1@-10,0+490], the d a -70 of dist and the d a -20
                // of the kern table; with --features=-dist [8=0+490|5=1@-10,0+490], with --features=-kern [8=0+430|5=1+500]
                const gposFont = loadSync('./test/fonts/TestPairPositioning.ttf');
                const kernFeatureIndex = gposFont.tables.gpos.features.findIndex(featureRecord => featureRecord.tag === 'kern');
                for (const scriptRecord of gposFont.tables.gpos.scripts) {
                    const langSystems = [scriptRecord.script.defaultLangSys, ...scriptRecord.script.langSysRecords.map(langSysRecord => langSysRecord.langSys)];
                    for (const langSystem of langSystems) {
                        langSystem.featureIndexes = langSystem.featureIndexes.filter(featureIndex => featureIndex !== kernFeatureIndex);
                    }
                }
                const [glyphA, glyphV, glyphD, glyphLowerA] = ['A', 'V', 'd', 'a'].map(character => gposFont.charToGlyphIndex(character));
                gposFont.kerningPairs = { [`${glyphD},${glyphLowerA}`]: -20, [`${glyphA},${glyphV}`]: -100 };
                assert.deepStrictEqual(
                    [{}, { features: { dist: false } }, { kerning: false }].map(options => formatShape(gposFont.shape('da', options))),
                    ['[8=0+420|5=1@-10,0+490]', '[8=0+490|5=1@-10,0+490]', '[8=0+430|5=1+500]']
                );
            });

            it('applies no pair of the kern table without kerning', function() {
                // --features=-kern -u 0061,0062: [1=0+500|2=1+500]
                assert.deepStrictEqual(shapeKernTableText('ab', { kerning: false }), [[glyphIndexes.a, 500, 0, 0], [glyphIndexes.b, 500, 0, 0]]);
                assert.deepStrictEqual(shapeKernTableText('ab', { features: { kern: false } }), [[glyphIndexes.a, 500, 0, 0], [glyphIndexes.b, 500, 0, 0]]);
            });

            it('sets the advance of a GDEF mark kerned at the start of the text to 0, its offset moved back, like HarfBuzz', function() {
                // -u 0301,0062: [5=0@20,0+0|2=1@-20,0+480]
                assert.deepStrictEqual(shapeKernTableText('\u{301}b'), [[glyphIndexes.acute, 0, 20, 0], [glyphIndexes.b, 480, -20, 0]]);
            });

            itFailsUntilFixed('places a mark of a font without GPOS like the fallback mark positioning of HarfBuzz',
                'Font.shape (src/font.mjs): a mark is drawn at the pen position, HarfBuzz places a mark of a font without a GPOS ' +
                'table over its base with the fallback mark positioning (hb-ot-shape-fallback, _hb_ot_shape_fallback_mark_position)',
                function() {
                    // -u 0061,0301,0062: [1=0+470|5=1@-470,562+0|2=2@-30,0+470]
                    assert.deepStrictEqual(shapeKernTableText('a\u{301}b'), [
                        [glyphIndexes.a, 470, 0, 0], [glyphIndexes.acute, 0, -470, 562], [glyphIndexes.b, 470, -30, 0]
                    ]);
                });

            itFailsUntilFixed('kerns the pairs of the kern table across the nonspacing marks of a font without the glyph classes of GDEF',
                'getKernTablePair (src/position.mjs) and isGlyphIgnoredByLookup (src/layout.mjs): without the GlyphClassDef of GDEF no ' +
                'glyph is a mark, HarfBuzz synthesizes the classes from the Unicode general category (hb_synthesize_glyph_classes): ' +
                'a acute b gets the a acute -15 and the acute b -40, not the a b -60 across the acute',
                function() {
                    // hb-shape --no-glyph-names --cluster-level=1 LookupFlagsKernTableNoGDEF.ttf -u 0061,0301,0062:
                    // [1=0+470|5=1@-470,562+0|2=2@-30,0+470], a and b only (see the expected failure above for the acute)
                    kernTableFont.tables.gdef = undefined;
                    const [glyphA, , glyphB] = shapeKernTableText('a\u{301}b');
                    assert.deepStrictEqual([glyphA, glyphB], [[glyphIndexes.a, 470, 0, 0], [glyphIndexes.b, 470, -30, 0]]);
                });

            itFailsUntilFixed('does not kern with the kern table the bases of a letter and a combining mark that HarfBuzz composes',
                '_createBidi (src/font.mjs): A and gravecomb are not composed into Agrave (the root cause of the known failure ' +
                'of the kern lookups with IgnoreMarks of LookupFlags.ttf), so getKernTablePair (src/position.mjs) kerns A V -100 ' +
                'across the gravecomb, a GDEF mark: 900',
                function() {
                    // -u 0041,0300,0056: [23=0+500|22=2+500], Agrave V, which has no pair
                    assert.strictEqual(kernTableFont.getAdvanceWidth('A\u{300}V', 1000), 1000);
                });

            itFailsUntilFixed('kerns a pair of the kern table across a default ignorable, which HarfBuzz deletes without a space glyph',
                'getKernTablePair (src/position.mjs) and Font.shape (src/font.mjs): the zero width joiner U+200D, which the font ' +
                'has not, is drawn as .notdef with its advance and ends the pair a b; HarfBuzz skips the default ignorables in ' +
                'the pairs of the kern table (hb_kern_machine_t) and deletes them in a font without a space glyph ' +
                '(hb_ot_hide_default_ignorables)',
                function() {
                    // -u 0061,200D,0062: [1=0+470|2=2@-30,0+470]
                    assert.deepStrictEqual(shapeKernTableText('a\u{200D}b'), [[glyphIndexes.a, 470, 0, 0], [glyphIndexes.b, 470, -30, 0]]);
                });

            it('splits the value of a pair of a right-to-left run in visual order, like HarfBuzz', function() {
                // TestPairPositioning.ttf without GPOS, with the kern table alef reh -101, reh alef -50 and reh dal -21
                // (fontTools), -u 062F,0631,0627: [11=2+249|13=1@-50,0+339|12=0@-10,0+490], the pairs of the visual order
                // alef reh and reh dal, not reh alef
                const arabicFont = loadSync('./test/fonts/TestPairPositioning.ttf');
                arabicFont.tables.gpos = undefined;
                const [alef, reh, dal] = ['ا', 'ر', 'د'].map(character => arabicFont.charToGlyphIndex(character));
                arabicFont.kerningPairs = { [`${alef},${reh}`]: -101, [`${reh},${alef}`]: -50, [`${reh},${dal}`]: -21 };
                assert.strictEqual(formatShape(arabicFont.shape('درا')), '[11=2+249|13=1@-50,0+339|12=0@-10,0+490]');
            });
        });

        it('applies the required feature of the GPOS language system whatever the features option, like HarfBuzz', function() {
            // TestPairPositioning.ttf with ss01 as the ReqFeatureIndex of the DefaultLangSys of each script, out of its
            // FeatureIndex (fontTools): -u 0064,006F: [8=0+420|9=1+500], the same with --features=-ss01
            const requiredFeatureFont = loadSync('./test/fonts/TestPairPositioning.ttf');
            const ss01FeatureIndex = requiredFeatureFont.tables.gpos.features.findIndex(featureRecord => featureRecord.tag === 'ss01');
            for (const scriptRecord of requiredFeatureFont.tables.gpos.scripts) {
                const defaultLangSys = scriptRecord.script.defaultLangSys;
                defaultLangSys.reqFeatureIndex = ss01FeatureIndex;
                defaultLangSys.featureIndexes = defaultLangSys.featureIndexes.filter(featureIndex => featureIndex !== ss01FeatureIndex);
            }
            assert.strictEqual(formatShape(requiredFeatureFont.shape('do')), '[8=0+420|9=1+500]');
            assert.strictEqual(formatShape(requiredFeatureFont.shape('do', { features: { ss01: false } })), '[8=0+420|9=1+500]');
        });

        it('skips the lookups of the types not implemented yet, with a warning once per font and lookup type', function() {
            // TestTracking3.ttf: its required feature trak has a chained context positioning lookup (type 8), skipped,
            // and single adjustment lookups; -u 0041,0056: [36=0+1290|57=1@-76,0+1290]
            const warnings = [];
            const consoleWarn = console.warn;
            console.warn = message => warnings.push(message);
            try {
                const trackingFont = loadSync('./test/fonts/TestTracking3.ttf');
                assert.strictEqual(formatShape(trackingFont.shape('AV')), '[36=0+1290|57=1@-76,0+1290]');
                trackingFont.shape('To');
                // a font parsed again is another font, which warns again
                loadSync('./test/fonts/TestTracking3.ttf').shape('AV');
            } finally {
                console.warn = consoleWarn;
            }
            const warning = '[opentype.js] GPOS lookupType: 8 is not yet supported, lookup skipped';
            assert.deepStrictEqual(warnings, [warning, warning]);
        });

        it('applies the cursive and mark attachment lookups without a warning', function() {
            // -u 0061,0301: [5=0+500|10=1@-150,0+0], the mark-to-base lookup of mark (type 4) of TestPairPositioning.ttf
            // places the acute; the default GPOS features of latn of Changa-Regular.ttf (fontTools): curs of type 3, mark
            // of the types 4 and 5, mkmk of type 6, kern of type 2
            const warnings = [];
            const consoleWarn = console.warn;
            console.warn = message => warnings.push(message);
            try {
                assert.strictEqual(formatShape(loadSync('./test/fonts/TestPairPositioning.ttf').shape('a\u{301}')), '[5=0+500|10=1@-150,0+0]');
                const changaFont = loadSync('./test/fonts/Changa-Regular.ttf');
                changaFont.shape('a\u{301}');
                changaFont.shape('\u{628}\u{64E}\u{628}');
            } finally {
                console.warn = consoleWarn;
            }
            assert.deepStrictEqual(warnings, []);
        });

        it('applies the single adjustment lookups without a warning', function() {
            // TestSingleAdjustment.ttf: single adjustment lookups only (lookup type 1, the lookup 5 in an extension
            // lookup), --features=case -u 0048: [5=0@10,20+570], -u 0062: [9=0+485]
            const warnings = [];
            const consoleWarn = console.warn;
            console.warn = message => warnings.push(message);
            try {
                const singleFont = loadSync('./test/fonts/TestSingleAdjustment.ttf');
                const features = { case: true, cpsp: true, palt: true, halt: true, vpal: true, lfbd: true, ss01: true };
                singleFont.shape('ABCHOVabcdo\u{301}\u{300}\u{5D1}\u{5D0}', { features });
                assert.strictEqual(formatShape(singleFont.shape('H', { features: { case: true } })), '[5=0@10,20+570]');
                assert.strictEqual(formatShape(singleFont.shape('b')), '[9=0+485]');
            } finally {
                console.warn = consoleWarn;
            }
            assert.deepStrictEqual(warnings, []);
        });
    });

    describe('forEachGlyph', function() {
        let pairFont;

        before(function() {
            pairFont = loadSync('./test/fonts/TestPairPositioning.ttf');
        });

        it('gives the callback the pen position plus the offsets of shape, scaled, and moves the pen by its advances', function() {
            // -u 0041,0056: [2=0@10,20+570|4=1@-5,15+575], at twice the em from (10, 50), the y axis going down
            const calls = [];
            const end = pairFont.forEachGlyph('AV', 10, 50, 2000, {}, (glyph, glyphX, glyphY, fontSize) => {
                calls.push([glyph.index, glyphX, glyphY, fontSize]);
            });
            assert.deepStrictEqual(calls, [[2, 10 + 20, 50 - 40, 2000], [4, 10 + 1140 - 10, 50 - 30, 2000]]);
            assert.strictEqual(end, 10 + 1140 + 1150);
            assert.strictEqual(pairFont.getAdvanceWidth('AV', 2000), 1140 + 1150);
            assert.strictEqual(pairFont.getAdvanceWidth('AV', 2000, { letterSpacing: 0.1 }), 1140 + 1150 + 2 * 200);
        });

        it('draws the glyphs of getPath at their offsets', function() {
            // -u 0054,006F: [3=0+460|9=1@15,-10+500], o drawn at 460 + 15 and 10 units below the baseline
            const fontSize = pairFont.unitsPerEm;
            const expectedPath = new Path();
            expectedPath.extend(pairFont.charToGlyph('T').getPath(0, 0, fontSize, {}, pairFont));
            expectedPath.extend(pairFont.charToGlyph('o').getPath(475, 10, fontSize, {}, pairFont));
            assert.deepStrictEqual(pairFont.getPath('To', 0, 0, fontSize).commands, expectedPath.commands);
        });
    });

    describe('LookupFlags.ttf, the reference font of the lookupFlag tests', function() {
        // built by test/generate-lookup-flags-font.py, the font of the hb-shape outputs the lookupFlag tests quote:
        // hb-shape --no-glyph-names --cluster-level=1 LookupFlags.ttf -u <code points>
        let lookupFlagsFont;

        before(function() {
            lookupFlagsFont = loadSync('./test/fonts/LookupFlags.ttf');
        });

        it('has the glyphs and the GDEF table of the synthetic font of test/lookup-flags-font.mjs', function() {
            const syntheticGdef = createLookupFlagsGdef();
            const parsedGdef = lookupFlagsFont.tables.gdef;
            const layout = lookupFlagsFont.substitution;
            const describeGlyph = (gdef, glyphIndex) => [
                layout.getGlyphClass(gdef.classDef, glyphIndex),
                layout.getGlyphClass(gdef.markAttachClassDef, glyphIndex),
                layout.getCoverageIndex(gdef.markGlyphSets[0], glyphIndex)
            ];
            assert.equal(lookupFlagsFont.glyphs.length, Object.keys(glyphIndexes).length);
            for (const [glyphName, glyphIndex] of Object.entries(glyphIndexes)) {
                assert.equal(lookupFlagsFont.glyphs.get(glyphIndex).name, glyphName);
                assert.deepStrictEqual(describeGlyph(parsedGdef, glyphIndex), describeGlyph(syntheticGdef, glyphIndex), glyphName);
            }
        });

        it('applies the GSUB lookups of the tests with their lookupFlag, like HarfBuzz', function() {
            const shape = (text, featureTag) => lookupFlagsFont.stringToGlyphIndexes(text, { features: { [featureTag]: true } });
            // --features=-kern,+ss01 -u 0061,0301,0062: [1=0+500|5=1+0|8=2+500]
            assert.deepStrictEqual(shape('a\u{301}b', 'ss01'), [1, 5, 8]);
            // --features=-kern,+ss03 -u 0061,0301,0062: [7=0+500|5=1+0|2=2+500]
            assert.deepStrictEqual(shape('a\u{301}b', 'ss03'), [7, 5, 2]);
            // --features=-kern,+ss04 -u 0061,0301,0062: [9=0+500|5=0+0]
            assert.deepStrictEqual(shape('a\u{301}b', 'ss04'), [9, 5]);
            // --features=-kern,+ss05 -u 0301,0061,0323: [11=0+0|1=1+500|6=2+0]
            assert.deepStrictEqual(shape('\u{301}a\u{323}', 'ss05'), [11, 1, 6]);
            // --features=-kern,+ss14 -u 0062,0063: [8=0+500|1=1+500|5=1+0]
            assert.deepStrictEqual(shape('bc', 'ss14'), [8, 1, 5]);
            // --features=-kern,+ss19 -u 0063,0062: [1=0+500|5=0+0|2=1+500]
            assert.deepStrictEqual(shape('cb', 'ss19'), [1, 5, 2]);
            // --features=-kern,+ss21 -u 0063,0062: [1=0+500|5=0+0|8=1+500]
            assert.deepStrictEqual(shape('cb', 'ss21'), [1, 5, 8]);
            // --features=-kern -u 0644,064E,0627 (rlig is on by default): [14=0+0|19=0+500]
            assert.deepStrictEqual(lookupFlagsFont.stringToGlyphIndexes('\u{644}\u{64E}\u{627}'), [14, 19]);
        });

        it('gives the glyph and the characters of each cluster of stringToGlyphClusters, without the direction of its run', function() {
            // -u 0062: [2=0+500], -u 0631: [13=0+500]
            const clusters = lookupFlagsFont.stringToGlyphClusters('b\u{631}');
            assert.deepStrictEqual(clusters.map(cluster => Object.keys(cluster)), [['glyph', 'start', 'end'], ['glyph', 'start', 'end']]);
            assert.deepStrictEqual(clusters.map(({ glyph, start, end }) => [glyph.index, start, end]), [[2, 0, 1], [13, 1, 2]]);
        });

        it('gives no glyph and no cluster for an empty text', function() {
            assert.deepStrictEqual(lookupFlagsFont.stringToGlyphIndexes(''), []);
            assert.deepStrictEqual(lookupFlagsFont.stringToGlyphClusters(''), []);
        });

        it('applies the kern lookups with their lookupFlag, like HarfBuzz', function() {
            // -u 0061,0301,0062: [1=0+430|5=1+0|2=2+500]
            assert.equal(lookupFlagsFont.getAdvanceWidth('a\u{301}b', 1000), 930);
            // -u 0041,0056: [21=0+400|22=1+500]
            assert.equal(lookupFlagsFont.getAdvanceWidth('AV', 1000), 900);
        });

        it('applies the GSUB and kern lookups with their lookupFlag in a font parsed with lowMemory', function() {
            // the hb-shape outputs of the two tests above
            const lowMemoryFont = loadSync('./test/fonts/LookupFlags.ttf', { lowMemory: true });
            assert.deepStrictEqual(lowMemoryFont.stringToGlyphIndexes('a\u{301}b', { features: { ss03: true } }), [7, 5, 2]);
            assert.equal(lowMemoryFont.getAdvanceWidth('a\u{301}b', 1000), 930);
            assert.equal(lowMemoryFont.getAdvanceWidth('AV', 1000), 900);
        });

        it('applies the GSUB lookups of the script and language options in a font parsed with lowMemory', function() {
            // TestScriptLanguage.ttf, generated by test/generate-script-language-font.py
            const lowMemoryFont = loadSync('./test/fonts/TestScriptLanguage.ttf', { lowMemory: true });
            // hb-shape --no-glyph-names --cluster-level=1 --language=tr TestScriptLanguage.ttf -u 0069 [20=0+500] (i.TRK)
            assert.deepStrictEqual(lowMemoryFont.stringToGlyphIndexes('i', { language: 'TRK' }), [20]);
            // hb-shape --no-glyph-names --cluster-level=1 TestScriptLanguage.ttf -u 0069 [8=0+500]
            assert.deepStrictEqual(lowMemoryFont.stringToGlyphIndexes('i'), [8]);
            // --script=arab --language=ur -u 0033,0034 [31=1+500|48=0+500], the fork lays the digits out from left to right
            assert.deepStrictEqual(lowMemoryFont.stringToGlyphIndexes('34', { script: 'arab', language: 'URD' }), [48, 31]);
        });

        it('keeps the other glyphs of a multiple substitution when a contextual lookup substitutes the first one', function() {
            // ss20: sub c by a acute; then sub a' lookup SUB_A;
            // --features=-kern,+ss20 -u 0063,0062: [7=0+500|5=0+0|2=1+500]
            assert.deepStrictEqual(lookupFlagsFont.stringToGlyphIndexes('cb', { features: { ss20: true } }), [7, 5, 2]);
        });

        it('forms a ligature at the first glyph of a multiple substitution', function() {
            // ss22: sub c by a acute; then lookupflag IgnoreMarks; sub a b by a_b;
            // --features=-kern,+ss22 -u 0063,0062: [9=0+500|5=0+0]
            assert.deepStrictEqual(lookupFlagsFont.stringToGlyphIndexes('cb', { features: { ss22: true } }), [9, 5]);
        });

        it('applies the following lookups and lookup records to each glyph of a multiple substitution, like HarfBuzz', function() {
            // each glyph with the start of its cluster (of hb-shape) and its end, the start of the next cluster of the text
            const shapeClusters = (text, featureTag) => lookupFlagsFont.stringToGlyphClusters(text, { features: { [featureTag]: true } })
                .map(({ glyph, start, end }) => [glyph.index, start, end]);
            // ss23: sub c' lookup MULTIPLE_C b' lookup SUB_ACUTE_B; (the second record at the acute of the glyphs of c)
            // --features=-kern,+ss23 -u 0063,0062: [1=0+500|11=0+0|2=1+500]
            assert.deepStrictEqual(shapeClusters('cb', 'ss23'), [[1, 0, 1], [11, 0, 1], [2, 1, 2]]);
            // ss24: lookupflag IgnoreMarks; sub c' lookup MULTIPLE_C b' lookup SUB_ACUTE_B c;
            // --features=-kern,+ss24 -u 0063,0062,0063: [1=0+500|11=0+0|2=1+500|3=2+500]
            assert.deepStrictEqual(shapeClusters('cbc', 'ss24'), [[1, 0, 1], [11, 0, 1], [2, 1, 2], [3, 2, 3]]);
            // ss25: sub c by a b; then sub a b by a_b;
            // --features=-kern,+ss25 -u 0063,0062: [9=0+500|2=1+500]
            assert.deepStrictEqual(shapeClusters('cb', 'ss25'), [[9, 0, 1], [2, 1, 2]]);
            // ss26: sub c by b a; then sub a b by a_b; (the ligature merges the whole cluster of c with the one of b)
            // --features=-kern,+ss26 -u 0063,0062: [2=0+500|9=0+500]
            assert.deepStrictEqual(shapeClusters('cb', 'ss26'), [[2, 0, 2], [9, 0, 2]]);
            // ss27: sub a b by a_b; then sub a_b by a.alt b.alt;
            // --features=-kern,+ss27 -u 0061,0062,0063: [7=0+500|8=0+500|3=2+500]
            assert.deepStrictEqual(shapeClusters('abc', 'ss27'), [[7, 0, 2], [8, 0, 2], [3, 2, 3]]);
            // ss29: sub c' lookup MULTIPLE_C_A_C; (with sub c by a c;)
            // --features=-kern,+ss29 -u 0063,0063: [1=0+500|3=0+500|1=1+500|3=1+500]
            assert.deepStrictEqual(shapeClusters('cc', 'ss29'), [[1, 0, 1], [3, 0, 1], [1, 1, 2], [3, 1, 2]]);
            // ss30: sub c by a acute; then sub acute by acute.alt; sub b by b.alt;
            // --features=-kern,+ss30 -u 0063,0062: [1=0+500|11=0+0|8=1+500]
            assert.deepStrictEqual(shapeClusters('cb', 'ss30'), [[1, 0, 1], [11, 0, 1], [8, 1, 2]]);
            // ss31: lookupflag IgnoreMarks; sub a b by a_b; then sub c a_b by a_b_c; (the acute in the merged cluster)
            // --features=-kern,+ss31 -u 0063,0061,0301,0062: [10=0+500|5=0+0]
            assert.deepStrictEqual(shapeClusters('ca\u{301}b', 'ss31'), [[10, 0, 4], [5, 0, 4]]);
            // ss32: sub c by a acute; sub acute by acute.alt; (the acute of the substitution is not substituted again)
            // --features=-kern,+ss32 -u 0063,0301: [1=0+500|5=0+0|11=1+0]
            assert.deepStrictEqual(shapeClusters('c\u{301}', 'ss32'), [[1, 0, 1], [5, 0, 1], [11, 1, 2]]);
            // ss33: sub [c acute]' lookup MULTIPLE_C_THEN_ACUTE; --features=-kern,+ss33 -u 0063,0301: [1=0+500|5=0+0|11=1+0]
            assert.deepStrictEqual(shapeClusters('c\u{301}', 'ss33'), [[1, 0, 1], [5, 0, 1], [11, 1, 2]]);
        });

        it('kerns a right-to-left ligature and the mark in its cluster in the order of the text, like HarfBuzz', function() {
            // rlig: lookupflag IgnoreMarks; sub lam alef by lam_alef; kern: pos lam_alef fatha <-40 0 -40 0>; pos waw lam_alef
            // <-50 0 -50 0>; (KERN_NO_FLAG) -u 0644,064E,0627,0648: [16=3+500|14=0+0|19=0@-40,0+460]
            assert.equal(lookupFlagsFont.getAdvanceWidth('\u{644}\u{64E}\u{627}\u{648}', 1000), 960);
            // -u 0648,0644,064E,0627: [14=1+0|19=1@-40,0+460|16=0@-50,0+450]
            assert.equal(lookupFlagsFont.getAdvanceWidth('\u{648}\u{644}\u{64E}\u{627}', 1000), 910);
        });

        itFailsUntilFixed('does not kern the bases of a letter and a combining mark that HarfBuzz composes into the precomposed glyph',
            '_createBidi (src/font.mjs): A and gravecomb are not composed into Agrave (the root cause of the known failure ' +
            '"composes a letter and a combining mark into the precomposed glyph of the font" of playwriteCursive.spec.mjs), so the ' +
            'kern lookup with IgnoreMarks kerns A V -100 across the gravecomb: 900',
            function() {
                // KERN_BASES_IGNORE_MARKS: lookupflag IgnoreMarks; pos A V -100; (no Agrave V pair)
                // -u 0041,0300,0056: [23=0+500|22=2+500], Agrave V
                assert.equal(lookupFlagsFont.getAdvanceWidth('A\u{300}V', 1000), 1000);
            });
    });

    describe('glyph names', function() {
        // the post table of the CFF fonts has no glyph names (format 3): they are in the charset
        it('finds the glyphs of a CFF font by the names of its charset', function() {
            const cffFont = loadSync('./test/fonts/SourceSansPro-Regular.otf');
            assert.equal(cffFont.tables.post.version, 3);
            const index = cffFont.nameToGlyphIndex('A');
            assert.equal(cffFont.glyphs.get(index).name, 'A');
            assert.equal(cffFont.glyphIndexToName(index), 'A');
            assert.equal(cffFont.nameToGlyph('B').name, 'B');
            assert.equal(cffFont.nameToGlyphIndex('missing.glyph'), -1);
        });

        it('finds the glyphs of a CFF font by name with the low memory option', function() {
            const cffFont = loadSync('./test/fonts/SourceSansPro-Regular.otf', { lowMemory: true });
            assert.equal(cffFont.glyphs.get(cffFont.nameToGlyphIndex('A')).name, 'A');
        });

        it('keeps the names of the post table of a TrueType font', function() {
            const trueTypeFont = loadSync('./test/fonts/Changa-Regular.ttf');
            assert.equal(trueTypeFont.glyphs.get(trueTypeFont.nameToGlyphIndex('A')).name, 'A');
        });
    });
});

describe('glyphset.mjs', function() {
    let font;

    const fGlyph = new Glyph({name: 'f', unicode: 102, path: new Path(), advanceWidth: 1});
    const iGlyph = new Glyph({name: 'i', unicode: 105, path: new Path(), advanceWidth: 1});
    const ffGlyph = new Glyph({name: 'f_f', unicode: 0xfb01, path: new Path(), advanceWidth: 1});
    const fiGlyph = new Glyph({name: 'f_i', unicode: 0xfb02, path: new Path(), advanceWidth: 1});
    const ffiGlyph = new Glyph({name: 'f_f_i', unicode: 0xfb03, path: new Path(), advanceWidth: 1});

    const glyphs = [
        new Glyph({name: '.notdef', unicode: 0, path: new Path(), advanceWidth: 1}),
        fGlyph, iGlyph, ffGlyph, fiGlyph, ffiGlyph
    ];

    beforeEach(function() {
        font = new Font({
            familyName: 'MyFont',
            styleName: 'Medium',
            unitsPerEm: 1000,
            ascender: 800,
            descender: 0,
            fsSelection: 42,
            tables: {os2: {achVendID: 'TEST'}},
            glyphs: glyphs
        });
    });

    describe('GlyphSet iterable', function() {
        it('must be iterable', function() {
            assert.ok(font.glyphs instanceof glyphset.GlyphSet);
            assert.equal(typeof font.glyphs[Symbol.iterator], 'function');
        });

        it('must iterate over glyphs', function() {
            for (const glyph of font.glyphs) {
                assert.ok(glyph instanceof Glyph);
            }
        });

        it('must iterate over glyphs in order', function() {
            let i = 0;
            for (const glyph of glyphs) {
                assert.equal(glyph.name, glyphs[i].name);
                i++;
            }
        });
    });

    
    describe('drawing', function() {
        const emojiFont = loadSync('./test/fonts/OpenMojiCOLRv0-subset.otf');
        
        it('draws layers', function() {
            let contextLogs = [];
            const ctx = createMockObject(contextLogs);
            emojiFont.getPath('🌈🔳', 0, 0, 12).draw(ctx);
            const expectedColors = [
                'rgba(234, 90, 71, 1)',
                'rgba(244, 170, 65, 1)',
                'rgba(252, 234, 43, 1)',
                'rgba(177, 204, 51, 1)',
                'rgba(146, 211, 245, 1)',
                'rgba(179, 153, 200, 1)',
                'rgba(0, 0, 0, 1)',
                'rgba(0, 0, 0, 1)',
                'rgba(0, 0, 0, 1)',
                'rgba(0, 0, 0, 1)',
                'rgba(0, 0, 0, 1)',
                'rgba(0, 0, 0, 1)',
                'rgba(0, 0, 0, 1)',
                'rgba(255, 255, 255, 1)',
                'rgba(63, 63, 63, 1)',
                'rgba(0, 0, 0, 1)',
                'rgba(0, 0, 0, 1)'
            ];
            const fillLogs = contextLogs
                .filter(log => log.property === 'fillStyle')
                .map(log => log.value);
            assert.deepEqual(fillLogs, expectedColors);
        });
    });
});