import assert  from 'assert';
import { Font, Path, Glyph } from '../src/opentype.mjs';
import Layout, {
    getLayoutGdefTable,
    getGdefGlyphClass,
    isMarkGlyph,
    getLigatureId,
    getLigatureComponent,
    getChosenScriptTag,
    HarfBuzzShaper,
    getHarfBuzzShaper,
    memoizeByScriptTags,
    isMarkIgnoredWithoutGlyphClasses,
    isGlyphIgnoredByLookup,
    findNextNotIgnoredGlyphPosition,
    matchGlyphSequence,
    matchesGlyphIndex,
    createIgnorableMatching,
    AUTO_JOINER_FLAGS,
    matchSequenceContext,
    matchChainedSequenceContext,
    getRequiredFeatureIndex,
    getCachedLayoutValue,
    getOpenTypeScriptTags,
    isRightToLeftScript,
    selectScriptTag
} from '../src/layout.mjs';
import { glyphIndexes, createLookupFlagsGdef } from './lookup-flags-font.mjs';
import { DEFAULT_IGNORABLE_TYPES } from '../src/char.mjs';

describe('layout.mjs', function() {
    let font;
    let layout;
    const notdefGlyph = new Glyph({
        name: '.notdef',
        unicode: 0,
        path: new Path()
    });
    const defaultLayoutTable = {
        version: 1,
        scripts: [],
        features: [],
        lookups: []
    };

    const glyphs = [notdefGlyph].concat('abcdefghijklmnopqrstuvwxyz'.split('').map(function (c) {
        return new Glyph({
            name: c,
            unicode: c.charCodeAt(0),
            path: new Path()
        });
    }));

    beforeEach(function() {
        font = new Font({
            familyName: 'MyFont',
            styleName: 'Medium',
            unitsPerEm: 1000,
            ascender: 800,
            descender: -200,
            glyphs: glyphs
        });
        layout = new Layout(font, 'gsub');
        layout.createDefaultTable = function() { return defaultLayoutTable; };
    });

    describe('getTable', function() {
        it('must not always create an empty default layout table', function() {
            assert.equal(layout.getTable(), undefined);
            assert.equal(layout.getTable(false), undefined);
        });

        it('must create an empty default layout table on demand', function() {
            assert.equal(layout.getTable(true), defaultLayoutTable);
        });
    });

    describe('getScriptTable', function() {
        it('must not create a new script table if it does not exist', function() {
            assert.equal(layout.getScriptTable('DFLT'), undefined);
            assert.equal(layout.getScriptTable('DFLT', false), undefined);
        });

        it('must create an new script table only on demand and if it does not exist', function() {
            const scriptTable = layout.getScriptTable('DFLT', true);
            assert.notEqual(scriptTable, undefined);
            assert.notEqual(scriptTable.defaultLangSys, undefined);
            assert.equal(layout.getScriptTable('DFLT', true), scriptTable, 'must create only one instance for each tag');
        });

        // hb_ot_layout_table_select_script of HarfBuzz, checked with hb-shape --script=cyrl on fonts built by fontTools
        // with these scripts (the kern feature of DFLT applies, of dflt without DFLT, of latn without both)
        it('falls back to DFLT, then dflt, then latn for a script the table has not', function() {
            const scriptTables = {};
            for (const tag of ['DFLT', 'dflt', 'grek', 'latn']) {
                scriptTables[tag] = { defaultLangSys: { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [] }, langSysRecords: [] };
            }
            const setScripts = tags => {
                font.tables.gsub = { version: 1, scripts: tags.map(tag => ({ tag, script: scriptTables[tag] })), features: [], lookups: [] };
            };
            setScripts(['DFLT', 'dflt', 'grek', 'latn']);
            assert.equal(layout.getScriptTable('grek'), scriptTables.grek);
            assert.equal(layout.getScriptTable('cyrl'), scriptTables.DFLT);
            setScripts(['dflt', 'grek', 'latn']);
            assert.equal(layout.getScriptTable('cyrl'), scriptTables.dflt);
            assert.equal(layout.getScriptTable(), scriptTables.dflt);
            setScripts(['grek', 'latn']);
            assert.equal(layout.getScriptTable('cyrl'), scriptTables.latn);
            setScripts(['grek']);
            assert.equal(layout.getScriptTable('cyrl'), undefined);
        });

        it('creates a script the table has not instead of falling back', function() {
            const latinScriptTable = { defaultLangSys: { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [] }, langSysRecords: [] };
            font.tables.gsub = { version: 1, scripts: [{ tag: 'latn', script: latinScriptTable }], features: [], lookups: [] };
            const cyrillicScriptTable = layout.getScriptTable('cyrl', true);
            assert.notEqual(cyrillicScriptTable, latinScriptTable);
            assert.deepStrictEqual(font.tables.gsub.scripts.map(script => script.tag), ['cyrl', 'latn']);
        });
    });

    describe('getLangSysTable', function() {
        const defaultLangSys = { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [0] };
        const turkishLangSys = { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [1] };

        beforeEach(function() {
            font.tables.gsub = {
                version: 1,
                scripts: [{ tag: 'latn', script: { defaultLangSys, langSysRecords: [{ tag: 'TRK ', langSys: turkishLangSys }] } }],
                features: [],
                lookups: []
            };
        });

        it('returns the language system of a language, the default one without a language', function() {
            assert.equal(layout.getLangSysTable('latn', 'TRK '), turkishLangSys);
            assert.equal(layout.getLangSysTable('latn'), defaultLangSys);
            assert.equal(layout.getLangSysTable('latn', 'dflt'), defaultLangSys);
        });

        it('falls back to the default language system of the script for a language the script has not', function() {
            // the OpenType specification (Script table: the default LangSys table is used for a language the script
            // has no LangSys table for) and hb_ot_layout_script_select_language of HarfBuzz
            assert.equal(layout.getLangSysTable('latn', 'ROM '), defaultLangSys);
            assert.equal(layout.getLangSysTable('cyrl', 'ROM '), defaultLangSys, 'with the fallback of the script');
        });

        it('takes the language system tagged dflt as the default one, before the DefaultLangSys', function() {
            // hb_ot_layout_script_select_language of HarfBuzz: the language, then the LangSysRecord dflt, then the
            // DefaultLangSys. Fonts built by fontTools (feaLib, then the DefaultLangSys moved to a record dflt):
            // latn with the record dflt (kern A V -50 and dist T o -30) and TRK (dist), without a DefaultLangSys
            // or with a DefaultLangSys of dist only, give the same lines:
            // hb-shape --no-glyph-names --script=latn <font> -u 41,56,54,6f
            // [1=0+450|2=1+500|3=2+470|4=3+500], the same with --language=ro
            // hb-shape --no-glyph-names --script=latn --language=tr <font> -u 41,56,54,6f
            // [1=0+500|2=1+500|3=2+470|4=3+500]
            const recordLangSys = { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [0, 1] };
            const latinScriptTable = {
                defaultLangSys: undefined,
                langSysRecords: [{ tag: 'TRK ', langSys: turkishLangSys }, { tag: 'dflt', langSys: recordLangSys }]
            };
            font.tables.gsub.scripts[0].script = latinScriptTable;
            for (const latinDefaultLangSys of [undefined, defaultLangSys]) {
                latinScriptTable.defaultLangSys = latinDefaultLangSys;
                assert.equal(layout.getLangSysTable('latn'), recordLangSys);
                assert.equal(layout.getLangSysTable('latn', 'dflt'), recordLangSys);
                assert.equal(layout.getLangSysTable('latn', 'ROM '), recordLangSys);
                assert.equal(layout.getLangSysTable('latn', 'TRK '), turkishLangSys);
            }
            // the writers of the substitutions add to the language system the readers use
            assert.equal(layout.getLangSysTable('latn', 'dflt', true), recordLangSys);
            assert.equal(layout.getLangSysTable('latn', undefined, true), recordLangSys);
        });

        it('creates a language system the script has not instead of falling back', function() {
            const romanianLangSys = layout.getLangSysTable('latn', 'ROM ', true);
            assert.notEqual(romanianLangSys, defaultLangSys);
            assert.deepStrictEqual(romanianLangSys.featureIndexes, []);
            assert.deepStrictEqual(font.tables.gsub.scripts[0].script.langSysRecords.map(record => record.tag), ['ROM ', 'TRK ']);
        });

        it('takes a language tag of three letters as the tag with its trailing space', function() {
            assert.equal(layout.getLangSysTable('latn', 'TRK'), turkishLangSys);
            layout.getLangSysTable('latn', 'ROM', true);
            assert.deepStrictEqual(font.tables.gsub.scripts[0].script.langSysRecords.map(record => record.tag), ['ROM ', 'TRK ']);
        });
    });

    describe('getFeatureTable', function() {
        const kernFeature = { params: 0, lookupListIndexes: [0] };

        it('ignores a feature index past the FeatureList, like HarfBuzz', function() {
            // the FeatureIndex [kern, 99]: HarfBuzz still applies kern, see the hb-shape reference of the Font.shape test
            // with a GPOS feature index past the FeatureList (test/font.spec.mjs)
            font.tables.gsub = {
                version: 1,
                scripts: [{ tag: 'latn', script: { defaultLangSys: { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [0, 99] }, langSysRecords: [] } }],
                features: [{ tag: 'kern', feature: kernFeature }],
                lookups: []
            };
            assert.equal(layout.getFeatureTable('latn', 'dflt', 'kern'), kernFeature);
            assert.equal(layout.getFeatureTable('latn', 'dflt', 'mark'), undefined);
        });
    });

    describe('getCachedLayoutValue', function() {
        // a value computed from the table, counting its computations
        let computationCount;
        const computeScriptCount = () => {
            computationCount++;
            return font.tables.gsub.scripts.length;
        };

        beforeEach(function() {
            computationCount = 0;
            font.tables.gsub = { version: 1, scripts: [], features: [], lookups: [] };
        });

        it('computes a value once for a table and a key', function() {
            assert.equal(getCachedLayoutValue(font, 'gsub', 'scripts', computeScriptCount), 0);
            assert.equal(getCachedLayoutValue(font, 'gsub', 'scripts', computeScriptCount), 0);
            assert.equal(getCachedLayoutValue(font, 'gsub', 'other key', computeScriptCount), 0);
            assert.equal(computationCount, 2);
            // a table that replaces it
            font.tables.gsub = { version: 1, scripts: [{ tag: 'latn', script: { defaultLangSys: null, langSysRecords: [] } }], features: [], lookups: [] };
            assert.equal(getCachedLayoutValue(font, 'gsub', 'scripts', computeScriptCount), 1);
            assert.equal(computationCount, 3);
        });

        it('starts the values of a table again from none before a new key past 1024 values', function() {
            for (let i = 0; i < 1024; i++) {
                getCachedLayoutValue(font, 'gsub', `key ${i}`, computeScriptCount);
            }
            // a cached value of a full cache
            getCachedLayoutValue(font, 'gsub', 'key 0', computeScriptCount);
            assert.equal(computationCount, 1024);
            // a new key empties the cache, then the earlier keys compute their values again
            getCachedLayoutValue(font, 'gsub', 'key 1024', computeScriptCount);
            getCachedLayoutValue(font, 'gsub', 'key 0', computeScriptCount);
            getCachedLayoutValue(font, 'gsub', 'key 1024', computeScriptCount);
            assert.equal(computationCount, 1026);
        });

        it('computes the value at every call without a table', function() {
            const computeOne = () => {
                computationCount++;
                return 1;
            };
            assert.equal(getCachedLayoutValue(font, 'gpos', 'key', computeOne), 1);
            assert.equal(getCachedLayoutValue(font, 'gpos', 'key', computeOne), 1);
            assert.equal(computationCount, 2);
        });

        it('computes the value at every call for a font whose layout cache is off', function() {
            const uncachedFont = new Font({
                familyName: 'MyFont',
                styleName: 'Medium',
                unitsPerEm: 1000,
                ascender: 800,
                descender: -200,
                glyphs: glyphs
            });
            // as parse sets it with the layoutCache option false
            uncachedFont.isLayoutCacheEnabled = false;
            uncachedFont.tables.gsub = font.tables.gsub;
            const computeUncachedScriptCount = () => {
                computationCount++;
                return uncachedFont.tables.gsub.scripts.length;
            };
            assert.equal(getCachedLayoutValue(uncachedFont, 'gsub', 'scripts', computeUncachedScriptCount), 0);
            // a script added directly to the table
            uncachedFont.tables.gsub.scripts.push({ tag: 'latn', script: { defaultLangSys: null, langSysRecords: [] } });
            assert.equal(getCachedLayoutValue(uncachedFont, 'gsub', 'scripts', computeUncachedScriptCount), 1);
            assert.equal(computationCount, 2);
            // no value of the table was cached: a font with the cache on, sharing the table, computes it
            assert.equal(getCachedLayoutValue(font, 'gsub', 'scripts', computeScriptCount), 1);
            assert.equal(computationCount, 3);
        });

        it('computes the values again after a script, a language system, a feature or a lookup is added to the table', function() {
            const additions = [
                () => layout.getScriptTable('latn', true),
                () => layout.getLangSysTable('latn', 'TRK ', true),
                () => layout.getFeatureTable('latn', 'TRK ', 'liga', true),
                () => layout.getLookupTables('latn', 'TRK ', 'liga', 4, true)
            ];
            getCachedLayoutValue(font, 'gsub', 'scripts', computeScriptCount);
            for (const addition of additions) {
                addition();
                getCachedLayoutValue(font, 'gsub', 'scripts', computeScriptCount);
            }
            assert.equal(computationCount, 1 + additions.length);
            // reading the table, or an addition that finds what it would add, keeps the values
            layout.getLookupTables('latn', 'TRK ', 'liga', 4, true);
            layout.getFeatureTable('latn', 'dflt', 'liga');
            getCachedLayoutValue(font, 'gsub', 'scripts', computeScriptCount);
            assert.equal(computationCount, 1 + additions.length);
        });
    });

    describe('getRequiredFeatureIndex', function() {
        it('gives the ReqFeatureIndex of a language system, undefined without a required feature (0xFFFF)', function() {
            assert.equal(getRequiredFeatureIndex({ reserved: 0, reqFeatureIndex: 0, featureIndexes: [] }), 0);
            assert.equal(getRequiredFeatureIndex({ reserved: 0, reqFeatureIndex: 3, featureIndexes: [0] }), 3);
            assert.equal(getRequiredFeatureIndex({ reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [0] }), undefined);
            assert.equal(getRequiredFeatureIndex(undefined), undefined);
        });
    });

    describe('getOpenTypeScriptTags', function() {
        it('gives the ISO 15924 code in lowercase for most scripts', function() {
            assert.deepStrictEqual(getOpenTypeScriptTags('Latn'), ['latn']);
            assert.deepStrictEqual(getOpenTypeScriptTags('Cyrl'), ['cyrl']);
            assert.deepStrictEqual(getOpenTypeScriptTags('Cham'), ['cham']);
        });

        it('gives the old tags that are not the ISO 15924 code, like hb_ot_old_tag_from_script of HarfBuzz', function() {
            // Hiragana shares kana with Katakana, the tags of three letters or fewer end with spaces
            assert.deepStrictEqual(getOpenTypeScriptTags('Hira'), ['kana']);
            assert.deepStrictEqual(getOpenTypeScriptTags('Kana'), ['kana']);
            assert.deepStrictEqual(getOpenTypeScriptTags('Laoo'), ['lao ']);
            assert.deepStrictEqual(getOpenTypeScriptTags('Yiii'), ['yi  ']);
            assert.deepStrictEqual(getOpenTypeScriptTags('Nkoo'), ['nko ']);
            assert.deepStrictEqual(getOpenTypeScriptTags('Vaii'), ['vai ']);
        });

        it('gives the third and the second version of the Indic tags before the first one, mym2 before mymr', function() {
            // hb_ot_all_tags_from_script of HarfBuzz
            assert.deepStrictEqual(getOpenTypeScriptTags('Deva'), ['dev3', 'dev2', 'deva']);
            assert.deepStrictEqual(getOpenTypeScriptTags('Beng'), ['bng3', 'bng2', 'beng']);
            assert.deepStrictEqual(getOpenTypeScriptTags('Taml'), ['tml3', 'tml2', 'taml']);
            assert.deepStrictEqual(getOpenTypeScriptTags('Mymr'), ['mym2', 'mymr']);
        });

        it('gives DFLT for a text of no script', function() {
            assert.deepStrictEqual(getOpenTypeScriptTags(undefined), ['DFLT']);
        });
    });

    describe('isRightToLeftScript', function() {
        // the direction HarfBuzz gives a buffer of a script: hb-shape --no-glyph-names --script=<script>
        // TestAlternateSubstitution.ttf -u 0061,0062 gives [6=1+500|2=0+500] for a right-to-left script,
        // [2=0+500|6=1+500] for a left-to-right one
        it('tells the right-to-left scripts, like hb_script_get_horizontal_direction of HarfBuzz', function() {
            const rightToLeftScripts = [
                'Arab', 'Hebr', 'Syrc', 'Thaa', 'Cprt', 'Khar', 'Phnx', 'Nkoo', 'Lydi', 'Avst', 'Armi', 'Phli', 'Prti', 'Sarb',
                'Orkh', 'Samr', 'Mand', 'Merc', 'Mero', 'Mani', 'Mend', 'Nbat', 'Narb', 'Palm', 'Phlp', 'Hatr', 'Adlm', 'Rohg',
                'Sogo', 'Sogd', 'Elym', 'Chrs', 'Yezi', 'Ougr', 'Gara'
            ];
            for (const script of rightToLeftScripts) {
                assert.strictEqual(isRightToLeftScript(getOpenTypeScriptTags(script)), true, script);
            }
        });

        it('takes the other scripts and a text of no script as left to right', function() {
            // Old Hungarian, Old Italic, Runic and Tifinagh have no direction in HarfBuzz, whose buffer is then left to right
            const leftToRightScripts = ['Latn', 'Thai', 'Deva', 'Mymr', 'Mong', 'Hira', 'Hung', 'Ital', 'Runr', 'Tfng'];
            for (const script of leftToRightScripts) {
                assert.strictEqual(isRightToLeftScript(getOpenTypeScriptTags(script)), false, script);
            }
            assert.strictEqual(isRightToLeftScript(getOpenTypeScriptTags(undefined)), false);
        });
    });

    describe('selectScriptTag', function() {
        const langSys = { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [] };
        const createScripts = tags => tags.map(tag => ({ tag, script: { defaultLangSys: langSys, langSysRecords: [] } }));

        it('selects the first script tag the table has, like hb_ot_layout_table_select_script of HarfBuzz', function() {
            font.tables.gsub = { version: 1, scripts: createScripts(['DFLT', 'dev2', 'deva']), features: [], lookups: [] };
            assert.equal(selectScriptTag(layout, ['dev3', 'dev2', 'deva']), 'dev2');
            font.tables.gsub.scripts = createScripts(['DFLT', 'deva']);
            assert.equal(selectScriptTag(layout, ['dev3', 'dev2', 'deva']), 'deva');
        });

        it('selects the first script tag when the table has none of them, which getScriptTable takes to its fallbacks', function() {
            font.tables.gsub = { version: 1, scripts: createScripts(['DFLT', 'latn']), features: [], lookups: [] };
            assert.equal(selectScriptTag(layout, ['dev3', 'dev2', 'deva']), 'dev3');
            assert.equal(layout.getScriptTable(selectScriptTag(layout, ['cyrl'])), font.tables.gsub.scripts[0].script);
            delete font.tables.gsub;
            assert.equal(selectScriptTag(layout, ['cyrl']), 'cyrl');
        });
    });

    describe('getChosenScriptTag', function() {
        const langSys = { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [] };
        const createScripts = tags => tags.map(tag => ({ tag, script: { defaultLangSys: langSys, langSysRecords: [] } }));

        it('chooses the first script tag the table has, otherwise the first of DFLT, dflt and latn, like hb_ot_layout_table_select_script', function() {
            font.tables.gsub = { version: 1, scripts: createScripts(['DFLT', 'dev2', 'deva', 'latn']), features: [], lookups: [] };
            assert.strictEqual(getChosenScriptTag(layout, ['dev3', 'dev2', 'deva']), 'dev2');
            assert.strictEqual(getChosenScriptTag(layout, ['cyrl']), 'DFLT');
            font.tables.gsub.scripts = createScripts(['dflt', 'latn']);
            assert.strictEqual(getChosenScriptTag(layout, ['cyrl']), 'dflt');
            font.tables.gsub.scripts = createScripts(['cyrl', 'latn']);
            assert.strictEqual(getChosenScriptTag(layout, ['grek']), 'latn');
        });

        it('chooses no script tag when the table has none of them, nor without a table', function() {
            font.tables.gsub = { version: 1, scripts: createScripts(['cyrl']), features: [], lookups: [] };
            assert.strictEqual(getChosenScriptTag(layout, ['grek']), undefined);
            delete font.tables.gsub;
            assert.strictEqual(getChosenScriptTag(layout, ['grek']), undefined);
        });
    });

    describe('getHarfBuzzShaper', function() {
        // hb_ot_shaper_categorize (hb-ot-shaper.hh of HarfBuzz 11.3.2), horizontal text
        it('gives the Arabic, Thai, Hangul, Hebrew and Khmer shapers whatever the GSUB script', function() {
            for (const gsubScriptTag of [undefined, 'DFLT', 'latn']) {
                assert.strictEqual(getHarfBuzzShaper(['arab'], gsubScriptTag), HarfBuzzShaper.ARABIC);
                assert.strictEqual(getHarfBuzzShaper(['thai'], gsubScriptTag), HarfBuzzShaper.THAI);
                assert.strictEqual(getHarfBuzzShaper(['lao '], gsubScriptTag), HarfBuzzShaper.THAI);
                assert.strictEqual(getHarfBuzzShaper(['hang'], gsubScriptTag), HarfBuzzShaper.HANGUL);
                assert.strictEqual(getHarfBuzzShaper(['hebr'], gsubScriptTag), HarfBuzzShaper.HEBREW);
                assert.strictEqual(getHarfBuzzShaper(['khmr'], gsubScriptTag), HarfBuzzShaper.KHMER);
            }
        });

        it('gives the Arabic shaper to Syriac unless its GSUB script is DFLT', function() {
            assert.strictEqual(getHarfBuzzShaper(['syrc'], 'syrc'), HarfBuzzShaper.ARABIC);
            assert.strictEqual(getHarfBuzzShaper(['syrc'], undefined), HarfBuzzShaper.ARABIC);
            assert.strictEqual(getHarfBuzzShaper(['syrc'], 'latn'), HarfBuzzShaper.ARABIC);
            assert.strictEqual(getHarfBuzzShaper(['syrc'], 'DFLT'), HarfBuzzShaper.DEFAULT);
        });

        it('gives the Indic shaper to an Indic script, the USE for the tags of the third version', function() {
            const bengaliTags = getOpenTypeScriptTags('Beng');
            assert.strictEqual(getHarfBuzzShaper(bengaliTags, 'bng2'), HarfBuzzShaper.INDIC);
            assert.strictEqual(getHarfBuzzShaper(bengaliTags, 'beng'), HarfBuzzShaper.INDIC);
            assert.strictEqual(getHarfBuzzShaper(bengaliTags, 'dflt'), HarfBuzzShaper.INDIC);
            assert.strictEqual(getHarfBuzzShaper(bengaliTags, undefined), HarfBuzzShaper.INDIC);
            assert.strictEqual(getHarfBuzzShaper(bengaliTags, 'bng3'), HarfBuzzShaper.USE);
            assert.strictEqual(getHarfBuzzShaper(bengaliTags, 'DFLT'), HarfBuzzShaper.DEFAULT);
            assert.strictEqual(getHarfBuzzShaper(bengaliTags, 'latn'), HarfBuzzShaper.DEFAULT);
        });

        it('gives the Indic shaper to each script of the Indic shaper, the USE for the tags of the third version', function() {
            for (const script of ['Beng', 'Deva', 'Gujr', 'Guru', 'Knda', 'Mlym', 'Orya', 'Taml', 'Telu']) {
                const scriptTags = getOpenTypeScriptTags(script);
                const [thirdVersionTag, secondVersionTag, firstVersionTag] = scriptTags;
                assert.strictEqual(getHarfBuzzShaper(scriptTags, secondVersionTag), HarfBuzzShaper.INDIC, script);
                assert.strictEqual(getHarfBuzzShaper(scriptTags, firstVersionTag), HarfBuzzShaper.INDIC, script);
                assert.strictEqual(getHarfBuzzShaper(scriptTags, thirdVersionTag), HarfBuzzShaper.USE, script);
            }
        });

        it('gives the Myanmar shaper to Myanmar unless its GSUB script is DFLT, latn or mymr', function() {
            const myanmarTags = getOpenTypeScriptTags('Mymr');
            assert.strictEqual(getHarfBuzzShaper(myanmarTags, 'mym2'), HarfBuzzShaper.MYANMAR);
            assert.strictEqual(getHarfBuzzShaper(myanmarTags, undefined), HarfBuzzShaper.MYANMAR);
            for (const gsubScriptTag of ['DFLT', 'latn', 'mymr']) {
                assert.strictEqual(getHarfBuzzShaper(myanmarTags, gsubScriptTag), HarfBuzzShaper.DEFAULT);
            }
        });

        it('gives the USE to its scripts unless their GSUB script is DFLT or latn', function() {
            for (const script of ['Bali', 'Tibt', 'Sinh', 'Mong', 'Tutg']) {
                const scriptTags = getOpenTypeScriptTags(script);
                assert.strictEqual(getHarfBuzzShaper(scriptTags, scriptTags[0]), HarfBuzzShaper.USE, script);
                assert.strictEqual(getHarfBuzzShaper(scriptTags, undefined), HarfBuzzShaper.USE, script);
                assert.strictEqual(getHarfBuzzShaper(scriptTags, 'DFLT'), HarfBuzzShaper.DEFAULT, script);
                assert.strictEqual(getHarfBuzzShaper(scriptTags, 'latn'), HarfBuzzShaper.DEFAULT, script);
            }
        });

        it('gives the default shaper to the other scripts and to a text of no script', function() {
            for (const scriptTags of [['latn'], ['cyrl'], ['grek'], ['hani'], ['DFLT']]) {
                assert.strictEqual(getHarfBuzzShaper(scriptTags, undefined), HarfBuzzShaper.DEFAULT, scriptTags[0]);
                assert.strictEqual(getHarfBuzzShaper(scriptTags, scriptTags[0]), HarfBuzzShaper.DEFAULT, scriptTags[0]);
            }
        });
    });

    describe('memoizeByScriptTags', function() {
        it('computes the value of each set of script tags once', function() {
            const computedScriptTags = [];
            const getValue = memoizeByScriptTags(scriptTags => {
                computedScriptTags.push(scriptTags);
                return scriptTags[0].toUpperCase();
            });
            assert.strictEqual(getValue(['hani']), 'HANI');
            assert.strictEqual(getValue(['kana']), 'KANA');
            assert.strictEqual(getValue(['hani']), 'HANI');
            assert.strictEqual(getValue(['dev3', 'dev2', 'deva']), 'DEV3');
            assert.strictEqual(getValue(['dev3', 'dev2', 'deva']), 'DEV3');
            assert.deepStrictEqual(computedScriptTags, [['hani'], ['kana'], ['dev3', 'dev2', 'deva']]);
        });

        it('tells apart the sets of script tags of the same tags in another order', function() {
            const getValue = memoizeByScriptTags(scriptTags => scriptTags.join(' '));
            assert.strictEqual(getValue(['dev2', 'deva']), 'dev2 deva');
            assert.strictEqual(getValue(['deva', 'dev2']), 'deva dev2');
        });
    });

    describe('getGlyphClass', function() {
        const classDef1 = {
            format: 1,
            startGlyph: 0x32,
            classes: [
                0, 1, 0, 1, 0, 1, 2, 1, 0, 2, 1, 1, 0,
                0, 0, 2, 2, 0, 0, 1, 0, 0, 0, 0, 2, 1
            ]
        };

        const classDef2 = {
            format: 2,
            ranges: [
                { start: 0x46, end: 0x47, classId: 2 },
                { start: 0x49, end: 0x49, classId: 2 },
                { start: 0xd2, end: 0xd3, classId: 1 }
            ]
        };

        it('should find a glyph class in a format 1 class definition table', function() {
            assert.equal(layout.getGlyphClass(classDef1, 0x32), 0);
            assert.equal(layout.getGlyphClass(classDef1, 0x33), 1);
            assert.equal(layout.getGlyphClass(classDef1, 0x34), 0);
            assert.equal(layout.getGlyphClass(classDef1, 0x38), 2);
            assert.equal(layout.getGlyphClass(classDef1, 0x4a), 2);
            assert.equal(layout.getGlyphClass(classDef1, 0x4b), 1);

            // Any glyph not included in the range of covered glyph IDs automatically belongs to Class 0.
            assert.equal(layout.getGlyphClass(classDef1, 0x31), 0);
            assert.equal(layout.getGlyphClass(classDef1, 0x50), 0);
        });

        it('should find a glyph class in a format 2 class definition table', function() {
            assert.equal(layout.getGlyphClass(classDef2, 0x46), 2);
            assert.equal(layout.getGlyphClass(classDef2, 0x47), 2);
            assert.equal(layout.getGlyphClass(classDef2, 0x49), 2);
            assert.equal(layout.getGlyphClass(classDef2, 0xd2), 1);
            assert.equal(layout.getGlyphClass(classDef2, 0xd3), 1);

            // Any glyph not covered by a ClassRangeRecord is assumed to belong to Class 0.
            assert.equal(layout.getGlyphClass(classDef2, 0x45), 0);
            assert.equal(layout.getGlyphClass(classDef2, 0x48), 0);
            assert.equal(layout.getGlyphClass(classDef2, 0x4a), 0);
            assert.equal(layout.getGlyphClass(classDef2, 0xd4), 0);
        });
    });

    describe('getCoverageIndex', function() {
        const cov1 = {
            format: 1,
            glyphs: [0x4f, 0x125, 0x129]
        };

        const cov2 = {
            format: 2,
            ranges: [
                { start: 6, end: 6, index: 0 },
                { start: 11, end: 11, index: 1 },
                { start: 16, end: 16, index: 2 },
                { start: 18, end: 18, index: 3 },
                { start: 37, end: 41, index: 4 },
                { start: 44, end: 52, index: 9 },
                { start: 56, end: 62, index: 18 }
            ]
        };

        it('should find a glyph in a format 1 coverage table', function() {
            assert.equal(layout.getCoverageIndex(cov1, 0x4f), 0);
            assert.equal(layout.getCoverageIndex(cov1, 0x125), 1);
            assert.equal(layout.getCoverageIndex(cov1, 0x129), 2);

            assert.equal(layout.getCoverageIndex(cov1, 0x33), -1);
            assert.equal(layout.getCoverageIndex(cov1, 0x80), -1);
            assert.equal(layout.getCoverageIndex(cov1, 0x200), -1);
        });

        it('should find a glyph in a format 2 coverage table', function() {
            assert.equal(layout.getCoverageIndex(cov2, 6), 0);
            assert.equal(layout.getCoverageIndex(cov2, 11), 1);
            assert.equal(layout.getCoverageIndex(cov2, 37), 4);
            assert.equal(layout.getCoverageIndex(cov2, 38), 5);
            assert.equal(layout.getCoverageIndex(cov2, 56), 18);
            assert.equal(layout.getCoverageIndex(cov2, 62), 24);

            assert.equal(layout.getCoverageIndex(cov2, 5), -1);
            assert.equal(layout.getCoverageIndex(cov2, 8), -1);
            assert.equal(layout.getCoverageIndex(cov2, 55), -1);
            assert.equal(layout.getCoverageIndex(cov2, 70), -1);
        });

        it('finds no glyph in a coverage table of no valid format', function() {
            assert.strictEqual(layout.getCoverageIndex({ glyphs: [0x4f] }, 0x4f), -1);
            assert.strictEqual(layout.getCoverageIndex({ format: 3, glyphs: [0x4f] }, 0x4f), -1);
        });
    });

    describe('getGdefGlyphClass and isMarkGlyph', function() {
        it('gives the class of a glyph in the GlyphClassDef of GDEF, 0 without it', function() {
            const gdef = createLookupFlagsGdef();
            const { a: glyphA, ff, acute } = glyphIndexes;
            assert.deepStrictEqual([glyphA, ff, acute, 0].map(glyphIndex => getGdefGlyphClass(gdef, glyphIndex)), [1, 2, 3, 0]);
            assert.deepStrictEqual([glyphA, ff, acute].map(glyphIndex => isMarkGlyph(gdef, glyphIndex)), [false, false, true]);
            assert.strictEqual(getGdefGlyphClass(undefined, acute), 0);
            assert.strictEqual(isMarkGlyph({}, acute), false);
        });
    });

    describe('getLigatureId and getLigatureComponent', function() {
        it('read the ligature properties of a glyph, the component 0 for a ligature and for none', function() {
            const ligatureId = Symbol('ligature');
            assert.strictEqual(getLigatureId({ ligatureId, ligatureComponent: 2 }), ligatureId);
            assert.strictEqual(getLigatureComponent({ ligatureId, ligatureComponent: 2 }), 2);
            assert.strictEqual(getLigatureComponent({ ligatureId, ligatureComponentCount: 3 }), 0);
            assert.strictEqual(getLigatureId(undefined), undefined);
            assert.strictEqual(getLigatureComponent(undefined), 0);
        });
    });

    describe('getLayoutGdefTable', function() {
        it('gives the GDEF table of the font, none when the layout ignores it like HarfBuzz', function() {
            const gdef = createLookupFlagsGdef();
            font.tables.gdef = gdef;
            assert.strictEqual(getLayoutGdefTable(font), gdef);
            // a GDEF table of the blocklist of HarfBuzz (OT::GDEF::is_blocklisted), see opentype.spec.mjs
            font.isGdefIgnoredByLayout = true;
            assert.strictEqual(getLayoutGdefTable(font), undefined);
            assert.strictEqual(font.tables.gdef, gdef);
        });
    });

    // the glyphs and the GDEF table of test/lookup-flags-font.mjs; the lookups of the hb-shape lines are chaining
    // context rules with the flag under test (e.g. lookupflag IgnoreMarks; sub a' b by a.alt;), see latinFeatures.spec.mjs
    describe('isGlyphIgnoredByLookup', function() {
        const gdef = createLookupFlagsGdef();
        const { a: glyphA, ff, acute, dotbelow, fatha } = glyphIndexes;
        const isIgnored = (lookupFlag, glyphIndex, markFilteringSet) => isGlyphIgnoredByLookup(gdef, { lookupFlag, markFilteringSet }, glyphIndex);

        it('ignores the base glyphs with IgnoreBaseGlyphs (0x0002)', function() {
            // lookupflag IgnoreBaseGlyphs; sub a by a.alt; -u 0061: [1=0+500], the lookup does not apply at a
            assert.deepStrictEqual([glyphA, ff, acute].map(glyphIndex => isIgnored(0x0002, glyphIndex)), [true, false, false]);
        });

        it('ignores the ligatures with IgnoreLigatures (0x0004)', function() {
            // lookupflag IgnoreLigatures; sub a' b by a.alt; -u 0061,FB00,0062: [7=0+500|4=1+500|2=2+500]
            assert.deepStrictEqual([glyphA, ff, acute].map(glyphIndex => isIgnored(0x0004, glyphIndex)), [false, true, false]);
        });

        it('ignores the marks with IgnoreMarks (0x0008)', function() {
            // lookupflag IgnoreMarks; sub a' b by a.alt; -u 0061,0301,0062: [7=0+500|5=1+0|2=2+500]
            assert.deepStrictEqual([glyphA, ff, acute, dotbelow].map(glyphIndex => isIgnored(0x0008, glyphIndex)), [false, false, true, true]);
        });

        it('ignores the marks of another mark attachment class with MarkAttachmentType (high byte)', function() {
            // lookupflag MarkAttachmentType @ACUTES; sub a' b by a.alt; (class 1)
            // -u 0061,0323,0062: [7=0+500|6=1+0|2=2+500], -u 0061,0301,0062: [1=0+500|5=1+0|2=2+500]
            assert.deepStrictEqual([glyphA, ff, acute, dotbelow].map(glyphIndex => isIgnored(0x0100, glyphIndex)), [false, false, false, true]);
            // a mark of no mark attachment class (fatha, no MarkAttachClassDef entry) is ignored too, like HarfBuzz
            // (match_properties_mark): -u 0061,064E,0062: [7=0+500|14=1+0|2=2+500]
            assert.equal(isIgnored(0x0100, fatha), true);
            // lookupflag MarkAttachmentType @DOTS; sub b' a by b.alt; (class 2)
            // -u 0062,0301,0061: [8=0+500|5=1+0|1=2+500], -u 0062,0323,0061: [2=0+500|6=1+0|1=2+500]
            assert.deepStrictEqual([acute, dotbelow].map(glyphIndex => isIgnored(0x0200, glyphIndex)), [true, false]);
        });

        it('ignores the marks outside of the mark filtering set with UseMarkFilteringSet (0x0010)', function() {
            // lookupflag UseMarkFilteringSet @DOTS; sub a' b by a.alt; (set 0)
            // -u 0061,0301,0062: [7=0+500|5=1+0|2=2+500], -u 0061,0323,0062: [1=0+500|6=1+0|2=2+500]
            assert.deepStrictEqual([glyphA, ff, acute, dotbelow].map(glyphIndex => isIgnored(0x0010, glyphIndex, 0)), [false, false, true, false]);
            // a set the GDEF table has not covers no mark (mark_set_covers of HarfBuzz)
            assert.deepStrictEqual([glyphA, acute, dotbelow].map(glyphIndex => isIgnored(0x0010, glyphIndex, 1)), [false, true, true]);
        });

        it('takes the mark filtering set before the mark attachment type, and IgnoreMarks before both, like HarfBuzz', function() {
            // lookupflag MarkAttachmentType @ACUTES UseMarkFilteringSet @DOTS; sub a' b by a.alt; (0x0110, set 0)
            // -u 0061,0323,0062: [1=0+500|6=1+0|2=2+500], -u 0061,0301,0062: [7=0+500|5=1+0|2=2+500]
            assert.equal(isIgnored(0x0110, dotbelow, 0), false);
            assert.equal(isIgnored(0x0110, acute, 0), true);
            assert.equal(isIgnored(0x0018, dotbelow, 0), true);
        });

        it('ignores no glyph without a flag, nor a glyph without a class', function() {
            assert.deepStrictEqual([glyphA, ff, acute].map(glyphIndex => isIgnored(0, glyphIndex)), [false, false, false]);
            // .notdef has no class in this GDEF table, the component class (4) is never ignored
            assert.equal(isIgnored(0x000E, 0), false);
            const componentGdef = { classDef: { format: 2, ranges: [{ start: glyphA, end: glyphA, classId: 4 }] } };
            assert.equal(isGlyphIgnoredByLookup(componentGdef, { lookupFlag: 0x000E }, glyphA), false);
        });

        it('ignores no glyph without the GlyphClassDef of GDEF', function() {
            // the classes come from GDEF only (HarfBuzz synthesizes them from the Unicode general categories, not done here)
            assert.equal(isGlyphIgnoredByLookup(undefined, { lookupFlag: 0x0008 }, acute), false);
            assert.equal(isGlyphIgnoredByLookup({ version: 1 }, { lookupFlag: 0x0008 }, acute), false);
        });
    });

    // the classes HarfBuzz synthesizes without the GlyphClassDef of GDEF (hb_synthesize_glyph_classes) give a mark no
    // mark attachment class, while it still reads the mark glyph sets of GDEF (match_properties_mark); hb-shape references
    // in position.spec.mjs
    describe('isMarkIgnoredWithoutGlyphClasses', function() {
        const { acute, dotbelow } = glyphIndexes;
        const { markAttachClassDef, markGlyphSets } = createLookupFlagsGdef();
        const gdefWithoutClasses = { version: 1.2, markAttachClassDef, markGlyphSets };
        const isIgnored = (gdef, lookupFlag, glyphIndex, markFilteringSet) =>
            isMarkIgnoredWithoutGlyphClasses(gdef, { lookupFlag, markFilteringSet }, glyphIndex);

        it('ignores a mark with IgnoreMarks and with a MarkAttachmentType, whatever the MarkAttachClassDef of GDEF', function() {
            assert.deepStrictEqual([acute, dotbelow].map(glyphIndex => isIgnored(gdefWithoutClasses, 0x0008, glyphIndex)), [true, true]);
            assert.deepStrictEqual([acute, dotbelow].map(glyphIndex => isIgnored(gdefWithoutClasses, 0x0100, glyphIndex)), [true, true]);
            assert.deepStrictEqual([acute, dotbelow].map(glyphIndex => isIgnored(undefined, 0x0200, glyphIndex)), [true, true]);
        });

        it('ignores a mark that the mark glyph set of a lookup with UseMarkFilteringSet does not cover, all of them without GDEF', function() {
            assert.deepStrictEqual([acute, dotbelow].map(glyphIndex => isIgnored(gdefWithoutClasses, 0x0010, glyphIndex, 0)), [true, false]);
            assert.deepStrictEqual([acute, dotbelow].map(glyphIndex => isIgnored(undefined, 0x0010, glyphIndex, 0)), [true, true]);
        });

        it('ignores no mark without these flags, nor with the GlyphClassDef of GDEF, whose classes isGlyphIgnoredByLookup reads', function() {
            assert.deepStrictEqual([0, 0x0002, 0x0004].map(lookupFlag => isIgnored(gdefWithoutClasses, lookupFlag, acute)), [false, false, false]);
            assert.equal(isIgnored(createLookupFlagsGdef(), 0x0200, acute), false);
        });
    });

    describe('findNextNotIgnoredGlyphPosition and matchGlyphSequence', function() {
        const gdef = createLookupFlagsGdef();
        const { a: glyphA, b: glyphB, c: glyphC, acute, dotbelow } = glyphIndexes;
        const ignoreMarks = { lookupFlag: 0x0008 };

        it('finds the next and the previous glyph that the lookup does not ignore', function() {
            const glyphs = [glyphA, acute, dotbelow, glyphB];
            assert.equal(findNextNotIgnoredGlyphPosition(gdef, ignoreMarks, glyphs, 0, 1), 3);
            assert.equal(findNextNotIgnoredGlyphPosition(gdef, ignoreMarks, glyphs, 3, -1), 0);
            assert.equal(findNextNotIgnoredGlyphPosition(gdef, ignoreMarks, glyphs, 3, 1), -1);
            assert.equal(findNextNotIgnoredGlyphPosition(gdef, ignoreMarks, glyphs, 0, -1), -1);
            assert.equal(findNextNotIgnoredGlyphPosition(gdef, { lookupFlag: 0 }, glyphs, 0, 1), 1);
        });

        it('counts each glyph of a multiple substitution as a glyph of its own', function() {
            // a multiple substitution into acute b (or b acute) between a and c: the b is the next glyph either way
            assert.equal(findNextNotIgnoredGlyphPosition(gdef, ignoreMarks, [glyphA, acute, glyphB, glyphC], 0, 1), 2);
            assert.equal(findNextNotIgnoredGlyphPosition(gdef, ignoreMarks, [glyphA, glyphB, acute, glyphC], 0, 1), 1);
            assert.equal(findNextNotIgnoredGlyphPosition(gdef, ignoreMarks, [glyphA, glyphB, acute, glyphC], 1, 1), 3);
        });

        it('matches a sequence on the glyphs that the lookup does not ignore, null when the glyphs end before it', function() {
            const glyphs = [glyphA, acute, glyphB, dotbelow, glyphC, acute];
            const sequence = items => ({ items, matchesItem: matchesGlyphIndex });
            assert.deepStrictEqual(matchGlyphSequence(gdef, ignoreMarks, glyphs, 0, 1, sequence([glyphB, glyphC])), [2, 4]);
            assert.strictEqual(matchGlyphSequence(gdef, ignoreMarks, glyphs, 0, 1, sequence([glyphB, glyphC, glyphA])), null);
            assert.strictEqual(matchGlyphSequence(gdef, ignoreMarks, glyphs, 0, 1, sequence([glyphC])), null);
            assert.deepStrictEqual(matchGlyphSequence(gdef, ignoreMarks, glyphs, 4, -1, sequence([glyphB, glyphA])), [2, 0]);
            assert.deepStrictEqual(matchGlyphSequence(gdef, ignoreMarks, glyphs, 0, 1, sequence([])), []);
        });

        // the matcher_t of the skipping iterators of HarfBuzz 11.3.2 (hb-ot-layout-gsubgpos.hh): a default ignorable it
        // may skip (may_skip SKIP_MAYBE) is matched when it matches the item there (MATCH_YES), skipped otherwise
        it('skips a default ignorable the lookup may skip unless it matches the item there', function() {
            const glyphs = [glyphA, glyphC, glyphB];
            const isSkippedIgnorable = position => position === 1;
            const sequence = items => ({ items, matchesItem: matchesGlyphIndex });
            assert.deepStrictEqual(matchGlyphSequence(gdef, ignoreMarks, glyphs, 0, 1, sequence([glyphB]), isSkippedIgnorable), [2]);
            assert.deepStrictEqual(matchGlyphSequence(gdef, ignoreMarks, glyphs, 0, 1, sequence([glyphC, glyphB]), isSkippedIgnorable), [1, 2]);
            assert.strictEqual(matchGlyphSequence(gdef, ignoreMarks, glyphs, 0, 1, sequence([glyphB])), null);
            assert.equal(findNextNotIgnoredGlyphPosition(gdef, ignoreMarks, glyphs, 0, 1, isSkippedIgnorable), 2);
            assert.equal(findNextNotIgnoredGlyphPosition(gdef, ignoreMarks, glyphs, 2, -1, isSkippedIgnorable), 0);
        });
    });

    describe('createIgnorableMatching', function() {
        const {
            IGNORABLE, ZERO_WIDTH_NON_JOINER, ZERO_WIDTH_JOINER, HIDDEN, NOT_IGNORABLE
        } = DEFAULT_IGNORABLE_TYPES;
        const ignorableTypes = [NOT_IGNORABLE, IGNORABLE, ZERO_WIDTH_NON_JOINER, ZERO_WIDTH_JOINER, HIDDEN];
        const getSkippedPositions = isSkipped => ignorableTypes.map((ignorableType, position) => position).filter(isSkipped);
        const manualJoinerFlags = { autoZeroWidthNonJoiner: false, autoZeroWidthJoiner: false };

        // matcher_t::init of HarfBuzz 11.3.2: ignore_zwnj = table_index == 1 || (context_match && auto_zwnj),
        // ignore_zwj = context_match || auto_zwj, ignore_hidden = table_index == 1
        it('skips in the input of a GSUB lookup the default ignorables but the zero width non-joiner and the hidden ones, the zero width joiner with its flag', function() {
            assert.deepStrictEqual(getSkippedPositions(createIgnorableMatching(ignorableTypes, false, AUTO_JOINER_FLAGS).isSkippedInInput), [1, 3]);
            assert.deepStrictEqual(getSkippedPositions(createIgnorableMatching(ignorableTypes, false, manualJoinerFlags).isSkippedInInput), [1]);
        });

        it('skips in the context of a GSUB lookup the zero width joiner always, the zero width non-joiner with its flag, never the hidden ones', function() {
            assert.deepStrictEqual(getSkippedPositions(createIgnorableMatching(ignorableTypes, false, AUTO_JOINER_FLAGS).isSkippedInContext), [1, 2, 3]);
            assert.deepStrictEqual(getSkippedPositions(createIgnorableMatching(ignorableTypes, false, manualJoinerFlags).isSkippedInContext), [1, 3]);
        });

        it('skips in a GPOS lookup every default ignorable, but the zero width joiner of its input without its flag', function() {
            const autoMatching = createIgnorableMatching(ignorableTypes, true, AUTO_JOINER_FLAGS);
            const manualMatching = createIgnorableMatching(ignorableTypes, true, manualJoinerFlags);
            assert.deepStrictEqual(getSkippedPositions(autoMatching.isSkippedInInput), [1, 2, 3, 4]);
            assert.deepStrictEqual(getSkippedPositions(autoMatching.isSkippedInContext), [1, 2, 3, 4]);
            assert.deepStrictEqual(getSkippedPositions(manualMatching.isSkippedInInput), [1, 2, 4]);
            assert.deepStrictEqual(getSkippedPositions(manualMatching.isSkippedInContext), [1, 2, 3, 4]);
        });
    });

    describe('matchSequenceContext and matchChainedSequenceContext', function() {
        // the matching of the contextual subtables of GSUB (types 5 and 6) and GPOS (types 7 and 8), see
        // featureQuery.spec.mjs and position.spec.mjs for their references from hb-shape
        const gdef = createLookupFlagsGdef();
        const { a: glyphA, b: glyphB, c: glyphC, acute } = glyphIndexes;
        const noFlag = { lookupFlag: 0 };
        const ignoreMarks = { lookupFlag: 0x0008 };
        const coverage = glyphs => ({ format: 1, glyphs });
        const records = lookupListIndex => [{ sequenceIndex: 0, lookupListIndex }];

        it('matches the first rule of the rule set of the glyph (format 1), the input positions across the glyphs the lookup ignores', function() {
            const subtable = {
                coverage: coverage([glyphA]),
                ruleSets: [[{ input: [glyphC], lookupRecords: records(1) }, { input: [glyphB], lookupRecords: records(2) }, { input: [], lookupRecords: records(3) }]]
            };
            const glyphs = [glyphA, acute, glyphB];
            assert.deepStrictEqual(matchSequenceContext(gdef, ignoreMarks, subtable, 1, glyphs, 0), { inputPositions: [0, 2], lookupRecords: records(2) });
            assert.deepStrictEqual(matchSequenceContext(gdef, noFlag, subtable, 1, glyphs, 0), { inputPositions: [0], lookupRecords: records(3) });
            assert.strictEqual(matchSequenceContext(gdef, noFlag, subtable, 1, glyphs, 2), null);
        });

        it('matches the rules of the class of the glyph (format 2), class 0 for the glyphs out of the class definition', function() {
            const subtable = {
                coverage: coverage([glyphA, glyphB]),
                classDef: { format: 1, startGlyph: glyphA, classes: [1, 2] },
                classSets: [undefined, [{ classes: [0], lookupRecords: records(1) }], undefined]
            };
            assert.deepStrictEqual(matchSequenceContext(gdef, noFlag, subtable, 2, [glyphA, glyphC], 0), { inputPositions: [0, 1], lookupRecords: records(1) });
            assert.strictEqual(matchSequenceContext(gdef, noFlag, subtable, 2, [glyphA, glyphB], 0), null);
            assert.strictEqual(matchSequenceContext(gdef, noFlag, subtable, 2, [glyphB, glyphC], 0), null);
        });

        it('matches no rule at a glyph out of the coverage whose class has rules (format 2), like HarfBuzz', function() {
            // ContextFormat2 and ChainContextFormat2 of HarfBuzz: NOT_COVERED before the class of the glyph
            const classDef = { format: 1, startGlyph: glyphA, classes: [1, 1] };
            const subtable = { coverage: coverage([glyphA]), classDef, classSets: [undefined, [{ classes: [], lookupRecords: records(1) }]] };
            assert.deepStrictEqual(matchSequenceContext(gdef, noFlag, subtable, 2, [glyphA], 0), { inputPositions: [0], lookupRecords: records(1) });
            assert.strictEqual(matchSequenceContext(gdef, noFlag, subtable, 2, [glyphB], 0), null);
            const chainedSubtable = {
                coverage: coverage([glyphA]),
                inputClassDef: classDef,
                chainClassSet: [undefined, [{ backtrack: [], input: [], lookahead: [], lookupRecords: records(2) }]]
            };
            assert.deepStrictEqual(matchChainedSequenceContext(gdef, noFlag, chainedSubtable, 2, [glyphA], 0), { inputPositions: [0], lookupRecords: records(2) });
            assert.strictEqual(matchChainedSequenceContext(gdef, noFlag, chainedSubtable, 2, [glyphB], 0), null);
        });

        it('takes every glyph as class 0 without a class definition table (format 2), like the Null ClassDef of HarfBuzz', function() {
            const subtable = { coverage: coverage([glyphA]), classDef: undefined, classSets: [[{ classes: [0], lookupRecords: records(1) }]] };
            assert.deepStrictEqual(matchSequenceContext(gdef, noFlag, subtable, 2, [glyphA, glyphC], 0), { inputPositions: [0, 1], lookupRecords: records(1) });
            // a NULL backtrack and lookahead ClassDef: their glyphs in class 0
            const chainedSubtable = {
                coverage: coverage([glyphB]),
                backtrackClassDef: undefined,
                inputClassDef: { format: 1, startGlyph: glyphB, classes: [1] },
                lookaheadClassDef: undefined,
                chainClassSet: [undefined, [{ backtrack: [0], input: [], lookahead: [0], lookupRecords: records(2) }]]
            };
            assert.deepStrictEqual(matchChainedSequenceContext(gdef, noFlag, chainedSubtable, 2, [glyphA, glyphB, glyphC], 1), { inputPositions: [1], lookupRecords: records(2) });
        });

        it('looks a glyph up in a coverage table of format 1 by binary search, like HarfBuzz, so an unsorted one misses glyphs', function() {
            // CoverageFormat1::get_coverage of HarfBuzz (bsearch): the coverage table must list its glyphs in increasing
            // order, the glyph A before B is missed in [B, A]
            const subtable = { coverage: coverage([glyphB, glyphA]), ruleSets: [[{ input: [], lookupRecords: records(1) }], [{ input: [], lookupRecords: records(2) }]] };
            assert.deepStrictEqual(matchSequenceContext(gdef, noFlag, subtable, 1, [glyphB], 0), { inputPositions: [0], lookupRecords: records(1) });
            assert.strictEqual(matchSequenceContext(gdef, noFlag, subtable, 1, [glyphA], 0), null);
        });

        it('matches the coverage of each input glyph (format 3), and no rule without input glyphs, like HarfBuzz', function() {
            const subtable = { coverages: [coverage([glyphA, glyphB]), coverage([glyphC])], lookupRecords: records(4) };
            assert.deepStrictEqual(matchSequenceContext(gdef, noFlag, subtable, 3, [glyphB, glyphC], 0), { inputPositions: [0, 1], lookupRecords: records(4) });
            assert.strictEqual(matchSequenceContext(gdef, noFlag, subtable, 3, [glyphC, glyphC], 0), null);
            assert.strictEqual(matchSequenceContext(gdef, noFlag, { coverages: [], lookupRecords: records(4) }, 3, [glyphA], 0), null);
        });

        it('matches the backtrack from the glyph before backwards and the lookahead after the last input glyph', function() {
            const glyphRule = { backtrack: [glyphB, glyphA], input: [glyphC], lookahead: [glyphA], lookupRecords: records(5) };
            const subtable = { coverage: coverage([glyphC]), chainRuleSets: [[glyphRule]] };
            // a b c c a: the backtrack b a is matched from the glyph before the first c, the closest glyph first
            const glyphs = [glyphA, glyphB, glyphC, glyphC, glyphA];
            assert.deepStrictEqual(matchChainedSequenceContext(gdef, noFlag, subtable, 1, glyphs, 2), { inputPositions: [2, 3], lookupRecords: records(5) });
            assert.strictEqual(matchChainedSequenceContext(gdef, noFlag, subtable, 1, glyphs, 3), null);
            const coverageSubtable = {
                backtrackCoverage: [coverage([glyphB]), coverage([glyphA])],
                inputCoverage: [coverage([glyphC]), coverage([glyphC])],
                lookaheadCoverage: [coverage([glyphA])],
                lookupRecords: records(6)
            };
            const glyphsWithMarks = [glyphA, acute, glyphB, glyphC, acute, glyphC, glyphA];
            assert.deepStrictEqual(matchChainedSequenceContext(gdef, ignoreMarks, coverageSubtable, 3, glyphsWithMarks, 3), { inputPositions: [3, 5], lookupRecords: records(6) });
            assert.strictEqual(matchChainedSequenceContext(gdef, noFlag, coverageSubtable, 3, glyphsWithMarks, 3), null);
        });

        it('matches the classes of the backtrack, of the input and of the lookahead with their own class definitions (format 2)', function() {
            const subtable = {
                coverage: coverage([glyphB]),
                backtrackClassDef: { format: 1, startGlyph: glyphA, classes: [1] },
                inputClassDef: { format: 1, startGlyph: glyphB, classes: [1] },
                lookaheadClassDef: { format: 1, startGlyph: glyphC, classes: [3] },
                chainClassSet: [undefined, [{ backtrack: [1], input: [], lookahead: [3], lookupRecords: records(7) }]]
            };
            assert.deepStrictEqual(matchChainedSequenceContext(gdef, noFlag, subtable, 2, [glyphA, glyphB, glyphC], 1), { inputPositions: [1], lookupRecords: records(7) });
            assert.strictEqual(matchChainedSequenceContext(gdef, noFlag, subtable, 2, [glyphC, glyphB, glyphC], 1), null);
        });

        it('throws on an unknown format', function() {
            assert.throws(() => matchSequenceContext(gdef, noFlag, {}, 4, [glyphA], 0), /Unknown sequence context format: 4/);
            assert.throws(() => matchChainedSequenceContext(gdef, noFlag, {}, 4, [glyphA], 0), /Unknown chained sequence context format: 4/);
        });
    });
});
