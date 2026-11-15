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

        it('reads no substitution from an undefined subtable nor from a NULL coverage offset', function() {
            // an undefined subtable: a NULL subtable offset, or a subtable that failed to parse (see parseLookupList),
            // and a subtable whose coverage offset is NULL, an empty coverage like in HarfBuzz
            substitution.addLigature('liga', { sub: [4, 5], by: 17 });
            substitution.addSingle('ss01', { sub: 1, by: 2 });
            substitution.addMultiple('ss02', { sub: 3, by: [4, 5] });
            substitution.addAlternate('ss03', { sub: 6, by: [7, 8] });
            for (const lookup of font.tables.gsub.lookups) {
                lookup.subtables.unshift(undefined, { ...lookup.subtables[0], coverage: undefined });
            }
            assert.deepEqual(substitution.getLigatures('liga'), [{ sub: [4, 5], by: 17 }]);
            assert.deepEqual(substitution.getSingle('ss01'), [{ sub: 1, by: 2 }]);
            assert.deepEqual(substitution.getMultiple('ss02'), [{ sub: 3, by: [4, 5] }]);
            assert.deepEqual(substitution.getAlternates('ss03'), [{ sub: 6, by: [7, 8] }]);
        });

        it('reads no substitution from a NULL lookup offset of the LookupList, like the Null lookup of HarfBuzz', function() {
            // a NULL lookup offset is an undefined lookup (see parseLookupList), here the first lookup of liga
            substitution.addLigature('liga', { sub: [4, 5], by: 17 });
            font.tables.gsub.lookups.push(undefined);
            font.tables.gsub.features[0].feature.lookupListIndexes.unshift(1);
            assert.deepEqual(substitution.getLigatures('liga'), [{ sub: [4, 5], by: 17 }]);
            assert.deepEqual(substitution.getLookupTables('DFLT', 'dflt', 'liga', 4), [font.tables.gsub.lookups[0]]);
        });

        it('reads no substitution from a NULL Sequence, AlternateSet or LigatureSet offset', function() {
            // the sets of the first glyph of each subtable set to undefined, a NULL offset: like HarfBuzz, an empty set
            substitution.addLigature('liga', { sub: [4, 5], by: 17 });
            substitution.addLigature('liga', { sub: [12, 13], by: 18 });
            substitution.addMultiple('ss02', { sub: 3, by: [4, 5] });
            substitution.addMultiple('ss02', { sub: 9, by: [1, 2] });
            substitution.addAlternate('ss03', { sub: 6, by: [7, 8] });
            substitution.addAlternate('ss03', { sub: 10, by: [11] });
            const [ligatureSubtable, multipleSubtable, alternateSubtable] = font.tables.gsub.lookups.map(lookup => lookup.subtables[0]);
            multipleSubtable.sequences[0] = undefined;
            alternateSubtable.alternateSets[0] = undefined;
            ligatureSubtable.ligatureSets[0] = undefined;
            assert.deepEqual(substitution.getMultiple('ss02'), [{ sub: 9, by: [1, 2] }]);
            assert.deepEqual(substitution.getAlternates('ss03'), [{ sub: 10, by: [11] }]);
            assert.deepEqual(substitution.getLigatures('liga'), [{ sub: [12, 13], by: 18 }]);
        });

        it('reads no ligature from a NULL Ligature offset, and adds a ligature to its set', function() {
            // a LigatureSet whose first Ligature offset is NULL (undefined): like HarfBuzz, a ligature that matches nothing
            substitution.addLigature('liga', { sub: [4, 5], by: 17 });
            const ligatureSets = font.tables.gsub.lookups[0].subtables[0].ligatureSets;
            ligatureSets[0].unshift(undefined);
            assert.deepEqual(substitution.getLigatures('liga'), [{ sub: [4, 5], by: 17 }]);
            substitution.addLigature('liga', { sub: [4, 5], by: 17 });
            substitution.addLigature('liga', { sub: [4, 6], by: 18 });
            assert.strictEqual(ligatureSets[0].length, 3);
            assert.deepEqual(substitution.getLigatures('liga'), [{ sub: [4, 5], by: 17 }, { sub: [4, 6], by: 18 }]);
        });

        it('adds a substitution to a lookup with an undefined subtable', function() {
            substitution.addSingle('ss01', { sub: 1, by: 2 });
            font.tables.gsub.lookups[0].subtables.unshift(undefined);
            substitution.addSingle('ss01', { sub: 3, by: 4 });
            assert.strictEqual(font.tables.gsub.lookups[0].subtables.length, 2);
            assert.deepEqual(substitution.getSingle('ss01'), [{ sub: 1, by: 2 }, { sub: 3, by: 4 }]);
        });

        it('adds a subtable to a lookup whose subtables are all undefined, or of another format', function() {
            // the lookups of the single, multiple and alternate substitutions whose only subtable was skipped
            substitution.addSingle('ss01', { sub: 1, by: 2 });
            substitution.addMultiple('ss02', { sub: 3, by: [4, 5] });
            substitution.addAlternate('ss03', { sub: 6, by: [7, 8] });
            const lookups = font.tables.gsub.lookups;
            for (const lookup of lookups) {
                lookup.subtables = [undefined];
            }
            substitution.addSingle('ss01', { sub: 9, by: 10 });
            substitution.addMultiple('ss02', { sub: 11, by: [12, 13] });
            substitution.addAlternate('ss03', { sub: 14, by: [15, 16] });
            assert.deepEqual(lookups.map(lookup => lookup.subtables.length), [2, 2, 2]);
            assert.deepEqual(lookups.map(lookup => lookup.subtables[0]), [undefined, undefined, undefined]);
            assert.deepEqual(substitution.getSingle('ss01'), [{ sub: 9, by: 10 }]);
            assert.deepEqual(substitution.getMultiple('ss02'), [{ sub: 11, by: [12, 13] }]);
            assert.deepEqual(substitution.getAlternates('ss03'), [{ sub: 14, by: [15, 16] }]);
            // a single substitution lookup with a skipped subtable and a subtable of the format 1: addSingle adds a
            // subtable of the format 2
            lookups[0].subtables = [undefined, { substFormat: 1, coverage: { format: 1, glyphs: [17] }, deltaGlyphId: 1 }];
            substitution.addSingle('ss01', { sub: 19, by: 20 });
            assert.strictEqual(lookups[0].subtables.length, 3);
            assert.strictEqual(lookups[0].subtables[2].substFormat, 2);
            assert.deepEqual(substitution.getSingle('ss01'), [{ sub: 17, by: 18 }, { sub: 19, by: 20 }]);
        });
    });

    describe('the text layout after an edit', function() {
        // the glyph of each letter: a 1, b 2, ... z 26
        it('applies the substitutions added after a text was laid out, whose lookups are cached', function() {
            assert.deepStrictEqual(font.stringToGlyphIndexes('abc'), [1, 2, 3]);
            substitution.add('liga', { sub: [1, 2], by: 26 });
            assert.deepStrictEqual(font.stringToGlyphIndexes('abc'), [26, 3]);
            // a ligature added to the lookup the text layout has cached
            substitution.add('liga', { sub: [2, 3], by: 25 });
            assert.deepStrictEqual(font.stringToGlyphIndexes('bc'), [25]);
            // a feature added after a text was laid out with it
            assert.deepStrictEqual(font.stringToGlyphIndexes('a', { features: { salt: 2 } }), [1]);
            substitution.add('salt', { sub: 1, by: [24, 23] });
            assert.deepStrictEqual(font.stringToGlyphIndexes('a', { features: { salt: 2 } }), [23]);
            // a script added after a text was laid out with its fallback DFLT, whose liga it has not
            assert.deepStrictEqual(font.stringToGlyphIndexes('abc', { script: 'latn', features: { ss01: true } }), [26, 3]);
            substitution.addSingle('ss01', { sub: 3, by: 22 }, 'latn');
            assert.deepStrictEqual(font.stringToGlyphIndexes('abc', { script: 'latn', features: { ss01: true } }), [1, 2, 22]);
        });

        // a substitution of b added to the subtable of a substitution of a, after a text was laid out: b is not one of the
        // glyphs the subtable started at when the text layout cached its lookup
        it('applies a single substitution added to the subtable of a lookup the text layout has cached', function() {
            substitution.addSingle('liga', { sub: 1, by: 26 });
            assert.deepStrictEqual(font.stringToGlyphIndexes('ab'), [26, 2]);
            substitution.addSingle('liga', { sub: 2, by: 25 });
            assert.deepStrictEqual(font.stringToGlyphIndexes('ab'), [26, 25]);
        });

        it('applies a multiple substitution added to the subtable of a lookup the text layout has cached', function() {
            substitution.addMultiple('liga', { sub: 1, by: [26, 26] });
            assert.deepStrictEqual(font.stringToGlyphIndexes('ab'), [26, 26, 2]);
            substitution.addMultiple('liga', { sub: 2, by: [25, 25] });
            assert.deepStrictEqual(font.stringToGlyphIndexes('ab'), [26, 26, 25, 25]);
        });

        it('applies an alternate substitution added to the subtable of a lookup the text layout has cached', function() {
            // liga takes the first alternate, its value 1
            substitution.addAlternate('liga', { sub: 1, by: [26] });
            assert.deepStrictEqual(font.stringToGlyphIndexes('ab'), [26, 2]);
            substitution.addAlternate('liga', { sub: 2, by: [25] });
            assert.deepStrictEqual(font.stringToGlyphIndexes('ab'), [26, 25]);
        });
    });
});
