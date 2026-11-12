/**
 * The synthetic font of the lookupFlag tests: its glyphs and its GDEF table are those of LookupFlags.ttf, built
 * by test/generate-lookup-flags-font.py (fontTools fontBuilder and feaLib), whose hb-shape outputs (HarfBuzz 11.3.2)
 * are the references of the tests:
 *   python test/generate-lookup-flags-font.py <output directory>
 *   hb-shape --no-glyph-names --cluster-level=1 --features=<the feature of the lookup in the generator> LookupFlags.ttf -u <code points>
 * (or one of the variants of LookupFlags.ttf the generator lists, e.g. LookupFlagsNoGDEF.ttf).
 * Each test quotes its lookups in the feaLib syntax, the GDEF of the font is:
 *   GlyphClassDef [a b c a.alt b.alt alef reh dal waw dal.alt lam reh.alt A V Agrave], [ff a_b a_b_c lam_alef], [acute dotbelow acute.alt fatha gravecomb], ;
 *   lookupflag MarkAttachmentType @ACUTES (class 1 of MarkAttachClassDef), with @ACUTES = [acute acute.alt]
 *   lookupflag MarkAttachmentType @DOTS (class 2), lookupflag UseMarkFilteringSet @DOTS (set 0), with @DOTS = [dotbelow]
 * The bases and the ligatures are 500 units wide, the marks 0.
 */

import { Font, Glyph, Path } from '../src/opentype.mjs';

// name, character, GDEF glyph class (1 base, 2 ligature, 3 mark)
const glyphDefinitions = [
    ['.notdef', null, 0],
    ['a', 'a', 1],
    ['b', 'b', 1],
    ['c', 'c', 1],
    ['ff', '\u{FB00}', 2],
    ['acute', '\u{301}', 3],
    ['dotbelow', '\u{323}', 3],
    ['a.alt', null, 1],
    ['b.alt', null, 1],
    ['a_b', null, 2],
    ['a_b_c', null, 2],
    ['acute.alt', null, 3],
    ['alef', '\u{627}', 1],
    ['reh', '\u{631}', 1],
    ['fatha', '\u{64E}', 3],
    ['dal', '\u{62F}', 1],
    ['waw', '\u{648}', 1],
    ['dal.alt', null, 1],
    ['lam', '\u{644}', 1],
    ['lam_alef', null, 2],
    ['reh.alt', null, 1],
    ['A', 'A', 1],
    ['V', 'V', 1],
    ['Agrave', '\u{C0}', 1],
    ['gravecomb', '\u{300}', 3]
];

// the index of each glyph by name
const glyphIndexes = Object.fromEntries(glyphDefinitions.map(([name], index) => [name, index]));

/**
 * A class definition table of format 2 with one range by glyph
 * @param {Array<[number, number]>} glyphClasses - [glyph index, class] pairs, in glyph index order
 * @returns {Object}
 */
function createClassDef(glyphClasses) {
    return { format: 2, ranges: glyphClasses.map(([glyphIndex, classId]) => ({ start: glyphIndex, end: glyphIndex, classId })) };
}

/**
 * The GDEF table of the font, as src/tables/gdef.mjs parses it
 * @returns {Object}
 */
function createLookupFlagsGdef() {
    return {
        version: 1.2,
        classDef: createClassDef(glyphDefinitions.map(([, , glyphClass], index) => [index, glyphClass]).filter(([, glyphClass]) => glyphClass)),
        markAttachClassDef: createClassDef([[glyphIndexes.acute, 1], [glyphIndexes.dotbelow, 2], [glyphIndexes['acute.alt'], 1]]),
        markGlyphSets: [{ format: 1, glyphs: [glyphIndexes.dotbelow] }]
    };
}

/**
 * The font, with its GDEF table and the given GSUB and GPOS tables
 * @param {{gsub?: Object, gpos?: Object}} [tables]
 * @returns {opentype.Font}
 */
function createLookupFlagsFont(tables = {}) {
    const glyphs = glyphDefinitions.map(([name, character, glyphClass], index) => new Glyph({
        index,
        name,
        unicodes: character ? [character.codePointAt(0)] : [],
        advanceWidth: glyphClass === 3 ? 0 : 500,
        path: new Path()
    }));
    const font = new Font({ familyName: 'LookupFlags', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
    font.tables.gdef = createLookupFlagsGdef();
    if (tables.gsub) {
        font.tables.gsub = tables.gsub;
    }
    if (tables.gpos) {
        font.tables.gpos = tables.gpos;
        font.position.init();
    }
    return font;
}

/**
 * A GSUB or GPOS table whose feature, in the default language system of the script, has the given lookups of the lookup list
 * @param {string} scriptTag
 * @param {string} featureTag
 * @param {number[]} lookupListIndexes
 * @param {Object[]} lookups - the lookup list
 * @returns {Object}
 */
function createLayoutTable(scriptTag, featureTag, lookupListIndexes, lookups) {
    return {
        version: 1,
        scripts: [{ tag: scriptTag, script: { defaultLangSys: { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: [0] }, langSysRecords: [] } }],
        features: [{ tag: featureTag, feature: { featureParams: 0, lookupListIndexes } }],
        lookups
    };
}

export { glyphIndexes, createLookupFlagsGdef, createLookupFlagsFont, createLayoutTable };
