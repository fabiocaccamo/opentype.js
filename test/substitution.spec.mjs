import assert from 'assert';
import { Font, Glyph, Path } from '../src/opentype.mjs';
import Substitution from '../src/substitution.mjs';

describe('substitution.mjs', function() {
    let font;
    let substitution;
    const notdefGlyph = new Glyph({
        name: '.notdef',
        unicode: 0,
        path: new Path()
    });

    const glyphs = [notdefGlyph].concat('abcdefghijklmnopqrstuvwxyz'.split('').map(function (c) {
        return new Glyph({
            name: c,
            unicode: c.charCodeAt(0),
            path: new Path()
        });
    }));

    const defaultScriptList = [{
        tag: 'DFLT',
        script: {
            defaultLangSys: {reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [0]},
            langSysRecords: []
        }
    }];

    beforeEach(function() {
        font = new Font({
            familyName: 'MyFont',
            styleName: 'Medium',
            unitsPerEm: 1000,
            ascender: 800,
            descender: -200,
            glyphs: glyphs
        });
        substitution = new Substitution(font);
    });

    describe('createDefaultTable', function() {
        it('must return an empty default GSUB table', function() {
            assert.deepEqual(substitution.createDefaultTable(), {
                version: 1,
                scripts: [{
                    tag: 'DFLT',
                    script: {
                        defaultLangSys: { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [] },
                        langSysRecords: []
                    }
                }],
                features: [],
                lookups: []
            });
        });
    });

    describe('add', function() {
        it('can add single substitutions (lookup type 1 format 2)', function() {
            substitution.add('salt', { sub: 4, by: 10 });
            substitution.add('salt', { sub: 5, by: 11 });
            assert.deepEqual(font.tables.gsub.scripts, defaultScriptList);
            assert.deepEqual(font.tables.gsub.features, [{
                tag: 'salt',
                feature: { params: 0, lookupListIndexes: [0] }
            }]);
            assert.deepEqual(font.tables.gsub.lookups, [{
                lookupFlag: 0,
                lookupType: 1,
                markFilteringSet: undefined,
                subtables: [{
                    substFormat: 2,
                    coverage: { format: 1, glyphs: [4, 5] },
                    substitute: [10, 11]
                }]
            }]);
        });

        it('can add multiple substitutions (lookup type 2)', function() {
            substitution.add('ccmp', { sub: 4, by: [5, 6, 7] });
            substitution.add('ccmp', { sub: 8, by: [9, 10] });
            assert.deepEqual(font.tables.gsub.scripts, defaultScriptList);
            assert.deepEqual(font.tables.gsub.features, [{
                tag: 'ccmp',
                feature: { params: 0, lookupListIndexes: [0] }
            }]);
            assert.deepEqual(font.tables.gsub.lookups, [{
                lookupFlag: 0,
                lookupType: 2,
                markFilteringSet: undefined,
                subtables: [{
                    substFormat: 1,
                    coverage: { format: 1, glyphs: [4, 8] },
                    sequences: [[5, 6, 7], [9, 10]]
                }]
            }]);
        });

        it('can add alternate substitutions (lookup type 3)', function() {
            substitution.add('aalt', { sub: 4, by: [5, 6, 7] });
            substitution.add('aalt', { sub: 8, by: [9, 10] });
            assert.deepEqual(font.tables.gsub.scripts, defaultScriptList);
            assert.deepEqual(font.tables.gsub.features, [{
                tag: 'aalt',
                feature: { params: 0, lookupListIndexes: [0] }
            }]);
            assert.deepEqual(font.tables.gsub.lookups, [{
                lookupFlag: 0,
                lookupType: 3,
                markFilteringSet: undefined,
                subtables: [{
                    substFormat: 1,
                    coverage: { format: 1, glyphs: [4, 8] },
                    alternateSets: [[5, 6, 7], [9, 10]]
                }]
            }]);
        });

        it('can add ligatures (lookup type 4)', function() {
            substitution.add('liga', { sub: [4, 5], by: 17 });
            substitution.add('liga', { sub: [4, 6], by: 18 });
            substitution.add('liga', { sub: [8, 1, 2], by: 19 });
            assert.deepEqual(font.tables.gsub.scripts, defaultScriptList);
            assert.deepEqual(font.tables.gsub.features, [{
                tag: 'liga',
                feature: { params: 0, lookupListIndexes: [0] }
            }]);
            assert.deepEqual(font.tables.gsub.lookups, [{
                lookupFlag: 0,
                lookupType: 4,
                markFilteringSet: undefined,
                subtables: [{
                    substFormat: 1,
                    coverage: { format: 1, glyphs: [4, 8] },
                    ligatureSets: [
                        [{ ligGlyph: 17, components: [5] }, { ligGlyph: 18, components: [6] }],
                        [{ ligGlyph: 19, components: [1, 2] }]
                    ]
                }]
            }]);
        });

        it('adds a substitution to a script the table has not by creating it, not to its fallback script', function() {
            substitution.add('liga', { sub: [4, 5], by: 17 });
            substitution.add('liga', { sub: [4, 6], by: 18 }, 'cyrl');
            assert.deepEqual(font.tables.gsub.scripts.map(script => script.tag), ['DFLT', 'cyrl']);
            assert.deepEqual(substitution.getLigatures('liga'), [{ sub: [4, 5], by: 17 }]);
            assert.deepEqual(substitution.getLigatures('liga', 'cyrl'), [{ sub: [4, 6], by: 18 }]);
        });
    });

    describe('getFeature', function() {
        // the fallbacks of Layout.getScriptTable and getLangSysTable (hb_ot_layout_table_select_script and
        // hb_ot_layout_script_select_language of HarfBuzz)
        it('reads the substitutions of the fallback script for a script the table has not', function() {
            substitution.add('liga', { sub: [4, 5], by: 17 });
            substitution.add('ss01', { sub: 1, by: 2 });
            assert.deepEqual(substitution.getFeature('liga', 'cyrl'), [{ sub: [4, 5], by: 17 }]);
            assert.deepEqual(substitution.getLigatures('liga', 'latn'), [{ sub: [4, 5], by: 17 }]);
            assert.deepEqual(substitution.getSingle('ss01', 'grek'), [{ sub: 1, by: 2 }]);
            assert.deepEqual(font.tables.gsub.scripts.map(script => script.tag), ['DFLT'], 'reading creates no script');
        });

        it('reads a substitution added without a language to a script whose default language system is a record dflt', function() {
            // the language system HarfBuzz uses (hb_ot_layout_script_select_language): the record dflt before the
            // DefaultLangSys
            const defaultLangSys = { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [] };
            const recordLangSys = { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [] };
            font.tables.gsub = {
                version: 1,
                scripts: [{ tag: 'latn', script: { defaultLangSys, langSysRecords: [{ tag: 'dflt', langSys: recordLangSys }] } }],
                features: [],
                lookups: []
            };
            substitution.addLigature('liga', { sub: [4, 5], by: 17 }, 'latn');
            substitution.addSingle('salt', { sub: 1, by: 2 }, 'latn');
            assert.deepEqual(substitution.getSingle('salt', 'latn'), [{ sub: 1, by: 2 }]);
            assert.deepEqual(substitution.getLigatures('liga', 'latn'), [{ sub: [4, 5], by: 17 }]);
            assert.deepEqual(recordLangSys.featureIndexes, [0, 1]);
            assert.deepEqual(defaultLangSys.featureIndexes, []);
        });

        it('reads the substitutions of the default language system for a language the script has not', function() {
            substitution.add('liga', { sub: [4, 5], by: 17 });
            assert.deepEqual(substitution.getFeature('liga', 'DFLT', 'TRK '), [{ sub: [4, 5], by: 17 }]);
            assert.deepEqual(font.tables.gsub.scripts[0].script.langSysRecords, [], 'reading creates no language system');
        });
    });
});
