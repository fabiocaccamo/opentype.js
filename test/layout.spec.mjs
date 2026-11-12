import assert  from 'assert';
import { Font, Path, Glyph } from '../src/opentype.mjs';
import Layout, { getLayoutGdefTable, isGlyphIgnoredByLookup, findNextNotIgnoredGlyphPosition, getNotIgnoredGlyphPositions } from '../src/layout.mjs';
import { glyphIndexes, createLookupFlagsGdef } from './lookup-flags-font.mjs';

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

    describe('findNextNotIgnoredGlyphPosition and getNotIgnoredGlyphPositions', function() {
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

        it('lists the positions of the glyphs that the lookup does not ignore, at most the count given', function() {
            const glyphs = [glyphA, acute, glyphB, dotbelow, glyphC, acute];
            assert.deepStrictEqual(getNotIgnoredGlyphPositions(gdef, ignoreMarks, glyphs, 0, 1, 2), [2, 4]);
            assert.deepStrictEqual(getNotIgnoredGlyphPositions(gdef, ignoreMarks, glyphs, 0, 1, 3), [2, 4]);
            assert.deepStrictEqual(getNotIgnoredGlyphPositions(gdef, ignoreMarks, glyphs, 4, -1, 2), [2, 0]);
            assert.deepStrictEqual(getNotIgnoredGlyphPositions(gdef, ignoreMarks, glyphs, 0, 1, 0), []);
        });
    });
});
