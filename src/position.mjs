// The Position object provides utility methods to manipulate
// the GPOS position table.

import Layout from './layout.mjs';

/**
 * @exports opentype.Position
 * @class
 * @extends opentype.Layout
 * @param {opentype.Font}
 * @constructor
 */
function Position(font) {
    Layout.call(this, font, 'gpos');
}

Position.prototype = Layout.prototype;

/**
 * Init some data for faster and easier access later.
 */
Position.prototype.init = function() {
    const script = this.getDefaultScriptName();
    this.defaultKerningTables = this.getKerningTables(script);
};

/**
 * Get the xAdvance of a value record, adding the variation delta of its
 * VariationIndex table when the font is variable.
 *
 * @param {object} valueRecord
 * @param {object} [variation] - variation coordinates, the current font variation if omitted
 * @returns {number}
 */
Position.prototype.getValueRecordXAdvance = function(valueRecord, variation) {
    if (!valueRecord) {
        return 0;
    }
    const xAdvance = valueRecord.xAdvance || 0;
    const device = valueRecord.xAdvDevice;
    const gdef = this.font.tables.gdef;
    if (!device || device.deltaFormat !== 0x8000 || !this.font.variation || !gdef || !gdef.itemVarStore) {
        return xAdvance;
    }
    const delta = this.font.variation.process.getDelta(
        gdef.itemVarStore, device.deltaSetOuterIndex, device.deltaSetInnerIndex,
        variation || this.font.variation.get()
    );
    return Math.round(xAdvance + delta);
};

/**
 * Find a glyph pair in a list of lookup tables of type 2 and retrieve the xAdvance kerning value.
 *
 * @param {integer} leftIndex - left glyph index
 * @param {integer} rightIndex - right glyph index
 * @param {object} [variation] - variation coordinates, the current font variation if omitted
 * @returns {integer}
 */
Position.prototype.getKerningValue = function(kerningLookups, leftIndex, rightIndex, variation) {
    for (let i = 0; i < kerningLookups.length; i++) {
        const subtables = kerningLookups[i].subtables;
        for (let j = 0; j < subtables.length; j++) {
            const subtable = subtables[j];
            const covIndex = this.getCoverageIndex(subtable.coverage, leftIndex);
            if (covIndex < 0) continue;
            switch (subtable.posFormat) {
                case 1: {
                    // Search Pair Adjustment Positioning Format 1
                    let pairSet = subtable.pairSets[covIndex];
                    for (let k = 0; k < pairSet.length; k++) {
                        let pair = pairSet[k];
                        if (pair.secondGlyph === rightIndex) {
                            return this.getValueRecordXAdvance(pair.value1, variation);
                        }
                    }
                    break;      // left glyph found, not right glyph - try next subtable
                }
                case 2: {
                    // Search Pair Adjustment Positioning Format 2
                    const class1 = this.getGlyphClass(subtable.classDef1, leftIndex);
                    const class2 = this.getGlyphClass(subtable.classDef2, rightIndex);
                    const pair = subtable.classRecords[class1][class2];
                    return this.getValueRecordXAdvance(pair.value1, variation);
                }
            }
        }
    }
    return 0;
};

/**
 * List all kerning lookup tables, including the pair adjustment subtables wrapped in extension lookups.
 *
 * @param {string} [script='DFLT'] - use font.position.getDefaultScriptName() for a better default value
 * @param {string} [language='dflt']
 * @return {object[]} The list of kerning lookup tables (may be empty), or undefined if there is no GPOS table (and we should use the kern table)
 */
Position.prototype.getKerningTables = function(script, language) {
    if (this.font.tables.gpos) {
        const kerningTables = [];
        const featureTable = this.getFeatureTable(script, language, 'kern');
        if (featureTable) {
            const allLookups = this.font.tables.gpos.lookups;
            for (let i = 0; i < featureTable.lookupListIndexes.length; i++) {
                const lookupTable = allLookups[featureTable.lookupListIndexes[i]];
                if (!lookupTable) continue;
                if (lookupTable.lookupType === 2) {
                    kerningTables.push(lookupTable);
                } else if (lookupTable.lookupType === 9) {
                    // Extension Positioning lookup (used by fonts whose kerning data exceeds the 16-bit offsets):
                    // expose its wrapped pair adjustment subtables as a lookup of type 2, keeping the lookup order.
                    const subtables = [];
                    for (let j = 0; j < lookupTable.subtables.length; j++) {
                        const subtable = lookupTable.subtables[j];
                        if (subtable.lookupType === 2) {
                            subtables.push(subtable.extension);
                        }
                    }
                    if (subtables.length) {
                        kerningTables.push({
                            lookupType: 2,
                            lookupFlag: lookupTable.lookupFlag,
                            subtables: subtables,
                            markFilteringSet: lookupTable.markFilteringSet
                        });
                    }
                }
            }
        }
        return kerningTables;
    }
};

export default Position;
