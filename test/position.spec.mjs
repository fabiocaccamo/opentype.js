import assert from 'assert';
import { Font, Glyph, Path } from '../src/opentype.mjs';

// a pair adjustment subtable (format 1) kerning leftGlyph + rightGlyph by xAdvance
function pairPosSubtable(leftGlyph, rightGlyph, xAdvance) {
    return {
        posFormat: 1,
        coverage: { format: 1, glyphs: [leftGlyph] },
        valueFormat1: 4,
        valueFormat2: 0,
        pairSets: [[{ secondGlyph: rightGlyph, value1: { xAdvance }, value2: undefined }]]
    };
}

function extensionLookup(subtables) {
    return {
        lookupType: 9,
        lookupFlag: 0,
        subtables: subtables.map(subtable => ({ posFormat: 1, lookupType: subtable.lookupType, extension: subtable.extension }))
    };
}

function createFont(lookups, lookupListIndexes) {
    const glyphs = [];
    for (let i = 0; i < 5; i++) {
        glyphs.push(new Glyph({ index: i, name: 'glyph' + i, advanceWidth: 500, path: new Path() }));
    }
    const font = new Font({
        familyName: 'KerningTest',
        styleName: 'Regular',
        unitsPerEm: 1000,
        ascender: 800,
        descender: -200,
        glyphs
    });
    font.tables.gpos = {
        version: 1,
        scripts: [{ tag: 'DFLT', script: { defaultLangSys: { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [0] }, langSysRecords: [] } }],
        features: [{ tag: 'kern', feature: { featureParams: 0, lookupListIndexes } }],
        lookups
    };
    font.position.init();
    return font;
}

describe('position.mjs', function() {
    describe('getKerningTables', function() {
        it('includes the pair adjustment subtables wrapped in extension lookups', function() {
            const font = createFont([
                extensionLookup([{ lookupType: 2, extension: pairPosSubtable(1, 2, -30) }])
            ], [0]);
            const kerningTables = font.position.getKerningTables('DFLT');
            assert.equal(kerningTables.length, 1);
            assert.equal(kerningTables[0].lookupType, 2);
            assert.equal(kerningTables[0].subtables[0].posFormat, 1);
            assert.equal(font.getKerningValue(1, 2), -30);
        });

        it('keeps the order of the feature lookups when mixing extension and plain lookups', function() {
            const font = createFont([
                { lookupType: 2, lookupFlag: 0, subtables: [pairPosSubtable(1, 2, -10), pairPosSubtable(3, 4, -40)] },
                extensionLookup([{ lookupType: 2, extension: pairPosSubtable(1, 2, -20) }])
            ], [1, 0]);
            // the extension lookup comes first in the feature, so its value wins for the 1 + 2 pair
            assert.equal(font.getKerningValue(1, 2), -20);
            assert.equal(font.getKerningValue(3, 4), -40);
        });

        it('ignores extension lookups wrapping other lookup types', function() {
            const font = createFont([
                extensionLookup([{ lookupType: 4, extension: { error: 'GPOS Lookup 4 not supported' } }]),
                { lookupType: 2, lookupFlag: 0, subtables: [pairPosSubtable(1, 2, -10)] }
            ], [0, 1]);
            assert.equal(font.position.getKerningTables('DFLT').length, 1);
            assert.equal(font.getKerningValue(1, 2), -10);
        });

        it('applies extension kerning in getAdvanceWidth', function() {
            const font = createFont([
                extensionLookup([{ lookupType: 2, extension: pairPosSubtable(1, 2, -100) }])
            ], [0]);
            // the font has no cmap: map the text to the kerned glyphs directly
            font.stringToGlyphs = () => [font.glyphs.get(1), font.glyphs.get(2)];
            assert.equal(font.getAdvanceWidth('AB', 1000), 900);
            assert.equal(font.getAdvanceWidth('AB', 1000, { kerning: false }), 1000);
        });
    });
});
