/**
 * The synthetic font of the lookupFlag tests: its glyphs and its GDEF table are those of LookupFlags.ttf, built
 * by test/generate-lookup-flags-font.py (fontTools fontBuilder and feaLib), whose hb-shape outputs (HarfBuzz 11.3.2)
 * are the references of the tests:
 *   python test/generate-lookup-flags-font.py <output directory>
 *   hb-shape --no-glyph-names --cluster-level=1 --features=<the feature of the lookup in the generator> LookupFlags.ttf -u <code points>
 * (or one of the variants of LookupFlags.ttf the generator lists, e.g. LookupFlagsNoGDEF.ttf).
 * Each test quotes its lookups in the feaLib syntax, the GDEF of the font is:
 *   GlyphClassDef [a b c a.alt b.alt alef reh dal waw dal.alt lam reh.alt A V Agrave lam.init kokai khokhai], [ff a_b a_b_c lam_alef kokai_maiek], [acute dotbelow acute.alt fatha gravecomb maiek maiek.alt], ;
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
    ['gravecomb', '\u{300}', 3],
    ['lam.init', null, 1],
    ['kokai', '\u{E01}', 1],
    ['khokhai', '\u{E02}', 1],
    ['maiek', '\u{E48}', 3],
    ['maiek.alt', null, 3],
    ['kokai_maiek', null, 2]
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

/**
 * A GSUB or GPOS table whose scripts have the given features in their default language system
 * @param {Object<string, Array<[string, number[]]>>} scriptFeatures - for each script tag, its features: a feature tag
 * and the indexes of its lookups in the lookup list
 * @param {Object[]} lookups - the lookup list
 * @returns {Object}
 */
function createScriptsLayoutTable(scriptFeatures, lookups) {
    const features = [];
    const scripts = Object.entries(scriptFeatures).map(([scriptTag, featureLookups]) => {
        const featureIndexes = featureLookups.map(([featureTag, lookupListIndexes]) => {
            features.push({ tag: featureTag, feature: { featureParams: 0, lookupListIndexes } });
            return features.length - 1;
        });
        return { tag: scriptTag, script: { defaultLangSys: { reserved: 0, reqFeatureIndex: 0xffff, featureIndexes }, langSysRecords: [] } };
    });
    return { version: 1, scripts, features, lookups };
}

/**
 * A coverage table of format 1
 * @param {number[]} glyphs - glyph indexes, in glyph index order
 * @returns {Object}
 */
function createCoverage(glyphs) {
    return { format: 1, glyphs };
}

/**
 * The coverage tables of a sequence of glyphs (e.g. the input of a contextual rule of format 3), one glyph each
 * @param {number[]} glyphs - glyph indexes, in the order of the sequence
 * @returns {Object[]}
 */
function createCoverages(glyphs) {
    return glyphs.map(glyph => createCoverage([glyph]));
}

/**
 * A lookup of one single substitution of format 2
 * @param {number[]} glyphs - the glyphs it substitutes, in glyph index order
 * @param {number[]} substitutes - the substitute of each glyph
 * @param {number} [lookupFlag=0]
 * @returns {Object}
 */
function createSingleLookup(glyphs, substitutes, lookupFlag = 0) {
    return { lookupType: 1, lookupFlag, subtables: [{ substFormat: 2, coverage: createCoverage(glyphs), substitute: substitutes }] };
}

/**
 * A lookup of one multiple substitution (format 1)
 * @param {number[]} glyphs - the glyphs it substitutes, in glyph index order
 * @param {number[][]} sequences - the glyphs that replace each glyph
 * @returns {Object}
 */
function createMultipleLookup(glyphs, sequences) {
    return { lookupType: 2, lookupFlag: 0, subtables: [{ substFormat: 1, coverage: createCoverage(glyphs), sequences }] };
}

/**
 * A lookup of one ligature substitution (format 1)
 * @param {number} firstGlyph - the first component
 * @param {number[]} components - the other components, in the order of the text
 * @param {number} ligatureGlyph - the glyph that replaces the components
 * @param {number} [lookupFlag=0]
 * @returns {Object}
 */
function createLigatureLookup(firstGlyph, components, ligatureGlyph, lookupFlag = 0) {
    return {
        lookupType: 4,
        lookupFlag,
        subtables: [{ substFormat: 1, coverage: createCoverage([firstGlyph]), ligatureSets: [[{ ligGlyph: ligatureGlyph, components }]] }]
    };
}

// MULTIPLE_C of LookupFlags.ttf: sub c by a acute;
const multipleCLookup = createMultipleLookup([glyphIndexes.c], [[glyphIndexes.a, glyphIndexes.acute]]);

// SUB_ACUTE_B of LookupFlags.ttf: sub acute by acute.alt; sub b by b.alt;
const subAcuteBLookup = createSingleLookup([glyphIndexes.b, glyphIndexes.acute], [glyphIndexes['b.alt'], glyphIndexes['acute.alt']]);

export {
    glyphIndexes,
    createLookupFlagsGdef,
    createLookupFlagsFont,
    createLayoutTable,
    createScriptsLayoutTable,
    createCoverage,
    createCoverages,
    createSingleLookup,
    createMultipleLookup,
    createLigatureLookup,
    multipleCLookup,
    subAcuteBLookup
};
