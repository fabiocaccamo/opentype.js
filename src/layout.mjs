// The Layout object is the prototype of Substitution objects, and provides
// utility methods to manipulate common layout tables (GPOS, GSUB, GDEF...)

import check from './check.mjs';
import { DEFAULT_IGNORABLE_TYPES } from './char.mjs';
import { arraysEqual } from './util.mjs';

function searchTag(arr, tag) {
    /* jshint bitwise: false */
    let imin = 0;
    let imax = arr.length - 1;
    while (imin <= imax) {
        const imid = (imin + imax) >>> 1;
        const val = arr[imid].tag;
        if (val === tag) {
            return imid;
        } else if (val < tag) {
            imin = imid + 1;
        } else { imax = imid - 1; }
    }
    // Not found: return -1-insertion point
    return -imin - 1;
}

function binSearch(arr, value) {
    /* jshint bitwise: false */
    let imin = 0;
    let imax = arr.length - 1;
    while (imin <= imax) {
        const imid = (imin + imax) >>> 1;
        const val = arr[imid];
        if (val === value) {
            return imid;
        } else if (val < value) {
            imin = imid + 1;
        } else { imax = imid - 1; }
    }
    // Not found: return -1-insertion point
    return -imin - 1;
}

// the scripts tried, in this order, for a script the table has not (hb_ot_layout_table_select_script of HarfBuzz):
// DFLT, then dflt (a tag that fonts use by mistake), then latn (where old fonts put features for other scripts)
const FALLBACK_SCRIPT_TAGS = ['DFLT', 'dflt', 'latn'];

/**
 * The script table of the first fallback script that a sorted list of script records has.
 * @param {Array<{tag: string, script: Object}>} scripts
 * @return {Object|undefined}
 */
function getFallbackScriptTable(scripts) {
    for (const tag of FALLBACK_SCRIPT_TAGS) {
        const index = searchTag(scripts, tag);
        if (index >= 0) {
            return scripts[index].script;
        }
    }
}

// the OpenType script tags that are not the ISO 15924 code in lowercase (hb_ot_old_tag_from_script of HarfBuzz)
const OLD_SCRIPT_TAGS = { Hira: 'kana', Laoo: 'lao ', Nkoo: 'nko ', Vaii: 'vai ', Yiii: 'yi  ' };
// the second version of the OpenType script tags of the Indic scripts and of Myanmar (hb_ot_new_tag_from_script)
const NEW_SCRIPT_TAGS = {
    Beng: 'bng2', Deva: 'dev2', Gujr: 'gjr2', Guru: 'gur2', Knda: 'knd2',
    Mlym: 'mlm2', Mymr: 'mym2', Orya: 'ory2', Taml: 'tml2', Telu: 'tel2'
};

/**
 * The OpenType script tags of a Unicode script, in the order HarfBuzz tries them (hb_ot_all_tags_from_script): for the
 * Indic scripts the third and the second version of the tag before the first one (e.g. dev3, dev2, deva), for Myanmar
 * mym2 before mymr, otherwise the one tag of the script (kana for Hiragana and Katakana); DFLT for a text of no script.
 * @param {string|undefined} script - the ISO 15924 code of the script (see getCharScript), undefined for no script
 * @return {string[]}
 */
function getOpenTypeScriptTags(script) {
    if (script === undefined) {
        return ['DFLT'];
    }
    const tags = [];
    const newTag = NEW_SCRIPT_TAGS[script];
    if (newTag) {
        if (newTag !== 'mym2') {
            tags.push(newTag.slice(0, 3) + '3');
        }
        tags.push(newTag);
    }
    tags.push(OLD_SCRIPT_TAGS[script] || script.toLowerCase());
    return tags;
}

// the OpenType script tags of the scripts that HarfBuzz lays out from right to left (hb_script_get_horizontal_direction)
const RIGHT_TO_LEFT_SCRIPT_TAGS = [
    'adlm', 'arab', 'armi', 'avst', 'chrs', 'cprt', 'elym', 'gara', 'hatr', 'hebr', 'khar', 'lydi', 'mand', 'mani',
    'mend', 'merc', 'mero', 'narb', 'nbat', 'nko ', 'orkh', 'ougr', 'palm', 'phli', 'phlp', 'phnx', 'prti', 'rohg',
    'samr', 'sarb', 'sogd', 'sogo', 'syrc', 'thaa', 'yezi'
];

/**
 * Whether the script of a run is a right-to-left script, like the horizontal direction HarfBuzz gives the script of
 * a buffer (hb_script_get_horizontal_direction): Arabic, Hebrew, Syriac, Thaana, NKo... The other scripts, and a
 * text of no script (DFLT), are left to right.
 * @param {string[]} scriptTags - the OpenType script tags of the run (see getOpenTypeScriptTags)
 * @return {boolean}
 */
function isRightToLeftScript(scriptTags) {
    return scriptTags.some(tag => RIGHT_TO_LEFT_SCRIPT_TAGS.includes(tag));
}

/**
 * The script tag HarfBuzz chooses in a layout table for a list of script tags (hb_ot_layout_table_select_script): the
 * first one the table has, otherwise the first of the fallback scripts DFLT, dflt and latn that it has.
 * @param {Layout} layout - a GSUB or GPOS layout (font.substitution, font.position)
 * @param {string[]} scriptTags - see getOpenTypeScriptTags
 * @return {string|undefined} undefined when the table has none of them, or without a table
 */
function getChosenScriptTag(layout, scriptTags) {
    const scriptNames = layout.getScriptNames();
    return scriptTags.concat(FALLBACK_SCRIPT_TAGS).find(tag => scriptNames.includes(tag));
}

/**
 * The shapers of HarfBuzz (hb_ot_shaper_t), see getHarfBuzzShaper
 * @readonly
 * @enum {string}
 */
const HarfBuzzShaper = Object.freeze({
    DEFAULT: 'default',
    ARABIC: 'arabic',
    HANGUL: 'hangul',
    HEBREW: 'hebrew',
    INDIC: 'indic',
    KHMER: 'khmer',
    MYANMAR: 'myanmar',
    THAI: 'thai',
    USE: 'use'
});

// the ISO 15924 codes of the scripts of the Indic shaper of HarfBuzz and of its Universal Shaping Engine (USE)
const INDIC_SCRIPTS = ['Beng', 'Deva', 'Gujr', 'Guru', 'Knda', 'Mlym', 'Orya', 'Taml', 'Telu'];
const UNIVERSAL_SHAPING_ENGINE_SCRIPTS = [
    'Adlm', 'Ahom', 'Bali', 'Batk', 'Bhks', 'Brah', 'Bugi', 'Buhd', 'Cakm', 'Cham', 'Chrs', 'Cpmn', 'Diak', 'Dogr',
    'Dupl', 'Egyp', 'Elym', 'Gara', 'Gong', 'Gonm', 'Gran', 'Gukh', 'Hano', 'Hmng', 'Hmnp', 'Java', 'Kali', 'Kawi',
    'Khar', 'Khoj', 'Kits', 'Krai', 'Kthi', 'Lana', 'Lepc', 'Limb', 'Mahj', 'Maka', 'Mand', 'Mani', 'Marc', 'Medf',
    'Modi', 'Mong', 'Mtei', 'Mult', 'Nagm', 'Nand', 'Newa', 'Nkoo', 'Onao', 'Ougr', 'Phag', 'Phlp', 'Plrd', 'Rjng',
    'Rohg', 'Saur', 'Shrd', 'Sidd', 'Sind', 'Sinh', 'Sogd', 'Sogo', 'Soyo', 'Sund', 'Sunu', 'Sylo', 'Tagb', 'Takr',
    'Tale', 'Tavt', 'Tfng', 'Tglg', 'Tibt', 'Tirh', 'Tnsa', 'Todr', 'Toto', 'Tutg', 'Vith', 'Wcho', 'Yezi', 'Zanb'
];
const INDIC_SCRIPT_TAGS = INDIC_SCRIPTS.flatMap(getOpenTypeScriptTags);
const UNIVERSAL_SHAPING_ENGINE_SCRIPT_TAGS = UNIVERSAL_SHAPING_ENGINE_SCRIPTS.flatMap(getOpenTypeScriptTags);
const MYANMAR_SCRIPT_TAGS = getOpenTypeScriptTags('Mymr');
const THAI_SHAPER_SCRIPT_TAGS = ['thai', 'lao '];
// the GSUB scripts that make an Indic, Myanmar or USE run take the default shaper of HarfBuzz
const DEFAULT_SHAPER_GSUB_SCRIPT_TAGS = ['DFLT', 'latn'];

/**
 * The shaper HarfBuzz picks for a horizontal run from its script and from the script it chose in GSUB
 * (hb_ot_shaper_categorize, hb-ot-shaper.hh of HarfBuzz 11.3.2): the Arabic shaper for Arabic, and for Syriac unless
 * its GSUB script is DFLT; the Thai, Hangul, Hebrew and Khmer shapers for their scripts; the Indic shaper for an
 * Indic script, the USE for the third version of its tags (e.g. dev3); the Myanmar shaper for Myanmar, unless its
 * GSUB script is mymr; the USE for the scripts of the USE; the default shaper for an Indic, Myanmar or USE script whose
 * GSUB script is DFLT or latn, and for the other scripts.
 * @param {string[]} scriptTags - the OpenType script tags of the run (see getOpenTypeScriptTags)
 * @param {string|undefined} gsubScriptTag - the script HarfBuzz chose in GSUB (see getChosenScriptTag), undefined
 * for none
 * @return {HarfBuzzShaper}
 */
function getHarfBuzzShaper(scriptTags, gsubScriptTag) {
    const hasScriptTag = tags => scriptTags.some(tag => tags.includes(tag));
    const isDefaultShaperGsubScript = DEFAULT_SHAPER_GSUB_SCRIPT_TAGS.includes(gsubScriptTag);
    if (scriptTags.includes('arab')) {
        return HarfBuzzShaper.ARABIC;
    }
    if (scriptTags.includes('syrc')) {
        return gsubScriptTag === 'DFLT' ? HarfBuzzShaper.DEFAULT : HarfBuzzShaper.ARABIC;
    }
    if (hasScriptTag(THAI_SHAPER_SCRIPT_TAGS)) {
        return HarfBuzzShaper.THAI;
    }
    if (scriptTags.includes('hang')) {
        return HarfBuzzShaper.HANGUL;
    }
    if (scriptTags.includes('hebr')) {
        return HarfBuzzShaper.HEBREW;
    }
    if (scriptTags.includes('khmr')) {
        return HarfBuzzShaper.KHMER;
    }
    if (hasScriptTag(INDIC_SCRIPT_TAGS)) {
        if (isDefaultShaperGsubScript) {
            return HarfBuzzShaper.DEFAULT;
        }
        return gsubScriptTag && gsubScriptTag.endsWith('3') ? HarfBuzzShaper.USE : HarfBuzzShaper.INDIC;
    }
    if (hasScriptTag(MYANMAR_SCRIPT_TAGS)) {
        return isDefaultShaperGsubScript || gsubScriptTag === 'mymr' ? HarfBuzzShaper.DEFAULT : HarfBuzzShaper.MYANMAR;
    }
    if (hasScriptTag(UNIVERSAL_SHAPING_ENGINE_SCRIPT_TAGS)) {
        return isDefaultShaperGsubScript ? HarfBuzzShaper.DEFAULT : HarfBuzzShaper.USE;
    }
    return HarfBuzzShaper.DEFAULT;
}

/**
 * A function of the script tags of a run that computes its value once for each set of script tags it is called with,
 * e.g. the shaper of the runs of a text, which alternates between a few scripts in many runs (a Japanese text)
 * @param {function(string[]): any} computeValue - a function of the script tags of a run (see getOpenTypeScriptTags)
 * @return {function(string[]): any}
 */
function memoizeByScriptTags(computeValue) {
    const values = new Map();
    return scriptTags => {
        const key = scriptTags.join(',');
        if (!values.has(key)) {
            values.set(key, computeValue(scriptTags));
        }
        return values.get(key);
    };
}

/**
 * The script tag a layout table uses for a list of script tags, like hb_ot_layout_table_select_script of HarfBuzz: the
 * first one the table has, otherwise the first one, which getScriptTable takes to the fallback scripts.
 * @param {Layout} layout - a GSUB or GPOS layout (font.substitution, font.position)
 * @param {string[]} scriptTags - see getOpenTypeScriptTags
 * @return {string}
 */
function selectScriptTag(layout, scriptTags) {
    const scriptNames = layout.getScriptNames();
    return scriptTags.find(tag => scriptNames.includes(tag)) || scriptTags[0];
}

/**
 * A language system tag of 4 characters: the tags of three letters end with a space ('TRK' is 'TRK ').
 * @param {string} language
 * @return {string}
 */
function getLanguageSystemTag(language) {
    return language.padEnd(4, ' ');
}

/**
 * The default language system of a script table, like hb_ot_layout_script_select_language of HarfBuzz:
 * the LangSysRecord tagged dflt (where some fonts put it by mistake), otherwise the DefaultLangSys.
 * @param {{defaultLangSys: Object, langSysRecords: Array<{tag: string, langSys: Object}>}} scriptTable
 * @return {Object|undefined}
 */
function getDefaultLangSysTable(scriptTable) {
    const index = searchTag(scriptTable.langSysRecords, 'dflt');
    return index >= 0 ? scriptTable.langSysRecords[index].langSys : scriptTable.defaultLangSys;
}

// binary search in a list of ranges (coverage, class definition)
function searchRange(ranges, value) {
    // jshint bitwise: false
    let range;
    let imin = 0;
    let imax = ranges.length - 1;
    while (imin <= imax) {
        const imid = (imin + imax) >>> 1;
        range = ranges[imid];
        const start = range.start;
        if (start === value) {
            return range;
        } else if (start < value) {
            imin = imid + 1;
        } else { imax = imid - 1; }
    }
    if (imin > 0) {
        range = ranges[imin - 1];
        if (value > range.end) return 0;
        return range;
    }
}

/**
 * Find a glyph in a class definition table
 * https://docs.microsoft.com/en-us/typography/opentype/spec/chapter2#class-definition-table
 * @param {object} classDefTable - an OpenType Layout class definition table
 * @param {number} glyphIndex - the index of the glyph to find
 * @returns {number} 0 if not found
 */
function getGlyphClass(classDefTable, glyphIndex) {
    switch (classDefTable.format) {
        case 1: {
            if (classDefTable.startGlyph <= glyphIndex && glyphIndex < classDefTable.startGlyph + classDefTable.classes.length) {
                return classDefTable.classes[glyphIndex - classDefTable.startGlyph];
            }
            return 0;
        }
        case 2: {
            const range = searchRange(classDefTable.ranges, glyphIndex);
            return range ? range.classId : 0;
        }
    }
}

/**
 * Find a glyph in a coverage table
 * https://docs.microsoft.com/en-us/typography/opentype/spec/chapter2#coverage-table
 * @param {object} coverageTable - an OpenType Layout coverage table
 * @param {number} glyphIndex - the index of the glyph to find
 * @returns {number} -1 if not found
 */
function getCoverageIndex(coverageTable, glyphIndex) {
    switch (coverageTable.format) {
        case 1: {
            const index = binSearch(coverageTable.glyphs, glyphIndex);
            return index >= 0 ? index : -1;
        }
        case 2: {
            const range = searchRange(coverageTable.ranges, glyphIndex);
            return range ? range.index + glyphIndex - range.start : -1;
        }
        default:
            return -1;
    }
}

// the shifts of the masks of a glyph digest (see GlyphDigest), each mask a bit for each run of 2^shift glyph indexes
const GLYPH_DIGEST_SHIFTS = [4, 0, 9];
const GLYPH_DIGEST_MASK_BITS = 32;

/**
 * A filter of a set of glyphs, like the hb_set_digest_t of HarfBuzz: one 32-bit mask for each of GLYPH_DIGEST_SHIFTS,
 * in which a glyph sets the bit of its index shifted right, modulo 32. A glyph whose bits are not all set is not in the
 * set; a glyph whose bits are all set may be in it.
 * @typedef GlyphDigest
 * @type number[]
 */

/**
 * Add a range of glyph indexes to a glyph digest
 * @param {GlyphDigest} glyphDigest - updated
 * @param {number} firstGlyphIndex
 * @param {number} lastGlyphIndex - included
 */
function addGlyphRangeToDigest(glyphDigest, firstGlyphIndex, lastGlyphIndex) {
    for (let i = 0; i < GLYPH_DIGEST_SHIFTS.length; i++) {
        const firstBit = firstGlyphIndex >>> GLYPH_DIGEST_SHIFTS[i];
        const lastBit = lastGlyphIndex >>> GLYPH_DIGEST_SHIFTS[i];
        if (lastBit - firstBit >= GLYPH_DIGEST_MASK_BITS - 1) {
            glyphDigest[i] = -1;
            continue;
        }
        for (let bit = firstBit; bit <= lastBit; bit++) {
            glyphDigest[i] |= 1 << (bit % GLYPH_DIGEST_MASK_BITS);
        }
    }
}

/**
 * The glyph digest of the glyphs of coverage tables
 * @param {object[]} coverageTables - OpenType Layout coverage tables (see getCoverageIndex)
 * @returns {GlyphDigest}
 */
function getCoveragesGlyphDigest(coverageTables) {
    const glyphDigest = GLYPH_DIGEST_SHIFTS.map(() => 0);
    for (const coverageTable of coverageTables) {
        if (coverageTable.format === 1) {
            for (const glyphIndex of coverageTable.glyphs) {
                addGlyphRangeToDigest(glyphDigest, glyphIndex, glyphIndex);
            }
        } else if (coverageTable.format === 2) {
            for (const range of coverageTable.ranges) {
                addGlyphRangeToDigest(glyphDigest, range.start, range.end);
            }
        }
    }
    return glyphDigest;
}

/**
 * Whether a glyph may be in the set of glyphs of a glyph digest: false when it is not
 * @param {GlyphDigest} glyphDigest
 * @param {number} glyphIndex
 * @returns {boolean}
 */
function mayGlyphDigestHave(glyphDigest, glyphIndex) {
    for (let i = 0; i < GLYPH_DIGEST_SHIFTS.length; i++) {
        if (!(glyphDigest[i] & (1 << ((glyphIndex >>> GLYPH_DIGEST_SHIFTS[i]) % GLYPH_DIGEST_MASK_BITS)))) {
            return false;
        }
    }
    return true;
}

/**
 * The coverage table of the first glyph of a GSUB or GPOS subtable, the glyph it applies at: the coverage table of a
 * single, multiple, alternate, ligature, pair, cursive or reverse chaining subtable and of a contextual subtable of
 * format 1 or 2, the mark coverage of a mark attachment subtable, the first input coverage of a contextual subtable
 * of format 3. Not of an extension subtable: pass the subtable it wraps (see getLookupFirstGlyphSubtables in
 * features/applySubstitution.mjs and position.mjs)
 * @param {object} subtable
 * @returns {object|undefined} undefined for a subtable without one
 */
function getSubtableFirstGlyphCoverage(subtable) {
    return subtable.coverage || subtable.markCoverage || subtable.mark1Coverage ||
        (subtable.inputCoverage && subtable.inputCoverage[0]) || (subtable.coverages && subtable.coverages[0]);
}

/**
 * The coverage tables of the first glyph of subtables (see getSubtableFirstGlyphCoverage)
 * @param {Array<object|undefined>} subtables - GSUB or GPOS subtables, not extension subtables: undefined for the
 * missing subtable of a malformed extension subtable
 * @returns {object[]|null} null when a subtable has no coverage of its first glyph, and may apply at any glyph
 */
function getSubtablesFirstGlyphCoverages(subtables) {
    const coverageTables = subtables.map(subtable => subtable && getSubtableFirstGlyphCoverage(subtable));
    return coverageTables.every(Boolean) ? coverageTables : null;
}

/**
 * The glyph digest of the glyphs that subtables can apply at, the union of the coverage of their first glyph (see
 * getSubtablesFirstGlyphCoverages): a lookup of these subtables applies at no glyph the digest does not have
 * @param {Array<object|undefined>} subtables - GSUB or GPOS subtables, not extension subtables
 * @returns {GlyphDigest|null} null when a subtable has no coverage of its first glyph, and may apply at any glyph
 */
function getSubtablesFirstGlyphDigest(subtables) {
    const coverageTables = getSubtablesFirstGlyphCoverages(subtables);
    return coverageTables && getCoveragesGlyphDigest(coverageTables);
}

/**
 * The glyphs a GSUB or GPOS lookup can start at, the glyph digest of the coverage of the first glyph of its subtables,
 * with a copy of the subtables it was read from, the ones its extension subtables wrap (see getLookupFilterGlyphDigest)
 * @typedef LookupFirstGlyphFilter
 * @type Object
 * @property {GlyphDigest} glyphDigest
 * @property {Array<object|undefined>} subtables
 */

/**
 * The first glyph filter of a lookup the layout caches with the lookups of its features (see getCachedLayoutValue):
 * none for a lookup it does not cache, which applies once, so that reading its coverage tables would cost more than it
 * saves
 * @param {object} lookupTable
 * @param {boolean} isCached - whether the layout caches the lookup
 * @param {function(object): Array<object|undefined>} getFirstGlyphSubtables - the subtables of a lookup the digest is
 * read from, the subtables its extension subtables wrap
 * @param {function(object): (GlyphDigest|null)} getFirstGlyphDigest - the digest of a lookup, null when one of its
 * subtables may start at any glyph
 * @returns {LookupFirstGlyphFilter|null}
 */
function createLookupFirstGlyphFilter(lookupTable, isCached, getFirstGlyphSubtables, getFirstGlyphDigest) {
    if (!isCached) {
        return null;
    }
    const glyphDigest = getFirstGlyphDigest(lookupTable);
    return glyphDigest && { glyphDigest, subtables: getFirstGlyphSubtables(lookupTable).slice() };
}

/**
 * The glyph digest of the first glyph filter of a lookup while the lookup has the subtables the filter was read from:
 * none, so that the lookup is tried at every glyph, after a subtable was added to the lookup or replaced in it, or in
 * one of its extension subtables (e.g. in the subtables of a lookup of Layout.getLookupTables), which may start at
 * other glyphs
 * @param {LookupFirstGlyphFilter|null} firstGlyphFilter
 * @param {Array<object|undefined>} firstGlyphSubtables - the subtables the lookup has now, the ones its extension
 * subtables wrap (see createLookupFirstGlyphFilter)
 * @returns {GlyphDigest|null}
 */
function getLookupFilterGlyphDigest(firstGlyphFilter, firstGlyphSubtables) {
    if (!firstGlyphFilter || !arraysEqual(firstGlyphFilter.subtables, firstGlyphSubtables)) {
        return null;
    }
    return firstGlyphFilter.glyphDigest;
}

// the lookupFlag bits (OpenType Layout Common Table Formats, LookupFlag bit enumeration)
const RIGHT_TO_LEFT = 0x0001;
const IGNORE_BASE_GLYPHS = 0x0002;
const IGNORE_LIGATURES = 0x0004;
const IGNORE_MARKS = 0x0008;
const USE_MARK_FILTERING_SET = 0x0010;
const MARK_ATTACHMENT_TYPE = 0xFF00;
const IGNORING_FLAGS = IGNORE_BASE_GLYPHS | IGNORE_LIGATURES | IGNORE_MARKS | USE_MARK_FILTERING_SET | MARK_ATTACHMENT_TYPE;

// the ReqFeatureIndex of a language system without a required feature
const NO_REQUIRED_FEATURE_INDEX = 0xFFFF;

/**
 * The index of the required feature (ReqFeatureIndex) of a language system, in the FeatureList of its table.
 * @param {object|undefined} langSysTable - see Layout.getLangSysTable
 * @returns {number|undefined} undefined without a language system or a required feature
 */
function getRequiredFeatureIndex(langSysTable) {
    if (langSysTable && langSysTable.reqFeatureIndex !== NO_REQUIRED_FEATURE_INDEX) {
        return langSysTable.reqFeatureIndex;
    }
}

// the values computed from a GSUB or GPOS table, by table then by key (see getCachedLayoutValue)
const layoutCaches = new WeakMap();
// the number of values cached for a table, past which its cache starts again empty before a new value
const MAX_CACHED_LAYOUT_VALUES = 1024;

/**
 * A value computed from the GSUB or GPOS table of a font (e.g. the lookups of a set of features), computed once for
 * the table and a key: the methods of Layout that add a script, a language system, a feature or a lookup to the table,
 * and the methods of Substitution that add a substitution to a lookup, clear its values (see clearLayoutCache), a table
 * that replaces it has values of its own. The value is computed at every call for a font without the table or whose
 * layout cache is off (font.isLayoutCacheEnabled, see the layoutCache option of parse in opentype.mjs).
 * @param {Font} font
 * @param {string} tableName - 'gsub' or 'gpos'
 * @param {string} key - what the value depends on besides the table
 * @param {function(boolean): any} computeValue - given whether the value it computes is cached
 * @returns {any}
 */
function getCachedLayoutValue(font, tableName, key, computeValue) {
    const table = font.tables[tableName];
    if (!table || !font.isLayoutCacheEnabled) {
        return computeValue(false);
    }
    let cache = layoutCaches.get(table);
    if (!cache) {
        cache = new Map();
        layoutCaches.set(table, cache);
    }
    if (!cache.has(key)) {
        if (cache.size >= MAX_CACHED_LAYOUT_VALUES) {
            cache.clear();
        }
        cache.set(key, computeValue(true));
    }
    return cache.get(key);
}

/**
 * Clear the values computed from a GSUB or GPOS table (see getCachedLayoutValue), after a change of its scripts,
 * language systems, features, lookups or subtables.
 * @param {object} table
 */
function clearLayoutCache(table) {
    layoutCaches.delete(table);
}

// the glyph classes of the GDEF GlyphClassDef
const BASE_GLYPH_CLASS = 1;
const LIGATURE_GLYPH_CLASS = 2;
const MARK_GLYPH_CLASS = 3;

/**
 * The GDEF table the layout uses: none for one of the broken GDEF tables HarfBuzz ignores (font.isGdefIgnoredByLayout),
 * which font.tables.gdef still holds.
 * @param {opentype.Font} font
 * @returns {object|undefined}
 */
function getLayoutGdefTable(font) {
    return font.isGdefIgnoredByLayout ? undefined : font.tables.gdef;
}

/**
 * The class of a glyph in the GlyphClassDef of GDEF (1 base, 2 ligature, 3 mark, 4 component).
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {number} glyphIndex
 * @returns {number} 0 for no class, and without a GlyphClassDef
 */
function getGdefGlyphClass(gdef, glyphIndex) {
    return gdef && gdef.classDef ? getGlyphClass(gdef.classDef, glyphIndex) : 0;
}

/**
 * Whether a glyph is a mark in the GlyphClassDef of GDEF: without it no glyph is a mark, unlike HarfBuzz, which then
 * synthesizes the classes from the Unicode general category (a nonspacing mark is a mark).
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {number} glyphIndex
 * @returns {boolean}
 */
function isMarkGlyph(gdef, glyphIndex) {
    return getGdefGlyphClass(gdef, glyphIndex) === MARK_GLYPH_CLASS;
}

/**
 * What a ligature substitution records about a glyph, like the lig_props of HarfBuzz: a ligature has its own
 * ligatureId and the number of its components (ligatureComponentCount), a glyph after one of its components (a mark
 * the substitution skipped, or a mark after a component that was itself a ligature) has the ligatureId of the ligature
 * and the component it follows (ligatureComponent, from 1). The glyphs of a multiple substitution of a glyph of no
 * ligature have no ligatureId and their index in the substitution (ligatureComponent, none for the first one). Other
 * glyphs have none.
 * @typedef LigatureProperties
 * @type Object
 * @property {symbol|undefined} ligatureId - unique to each ligature substitution, undefined when the substitution is
 * not a ligature for HarfBuzz (a base and marks, or marks only)
 * @property {number} [ligatureComponent]
 * @property {number} [ligatureComponentCount]
 */

/**
 * The ligatureId of the ligature properties of a glyph (see LigatureProperties).
 * @param {LigatureProperties|undefined} ligatureProperties
 * @returns {symbol|undefined}
 */
function getLigatureId(ligatureProperties) {
    return ligatureProperties && ligatureProperties.ligatureId;
}

/**
 * The ligature component of the ligature properties of a glyph (see LigatureProperties), like _hb_glyph_info_get_lig_comp
 * of HarfBuzz.
 * @param {LigatureProperties|undefined} ligatureProperties
 * @returns {number} 0 for a ligature and for a glyph without ligature properties
 */
function getLigatureComponent(ligatureProperties) {
    return (ligatureProperties && ligatureProperties.ligatureComponent) || 0;
}

/**
 * Whether a lookup ignores a mark, like HarfBuzz (check_glyph_property and match_properties_mark): with IgnoreMarks,
 * every mark, otherwise with UseMarkFilteringSet, a mark the mark glyph set of the lookup does not cover (all the
 * marks when the GDEF table has no such set), otherwise with a MarkAttachmentType, a mark of another mark attachment class.
 * @param {object} gdef - the GDEF table
 * @param {{lookupFlag: number, markFilteringSet: number}} lookupTable
 * @param {number} glyphIndex - the index of a glyph of the mark class
 * @returns {boolean}
 */
function isMarkIgnoredByLookup(gdef, lookupTable, glyphIndex) {
    const lookupFlag = lookupTable.lookupFlag;
    if (lookupFlag & IGNORE_MARKS) {
        return true;
    }
    if (lookupFlag & USE_MARK_FILTERING_SET) {
        const markGlyphSet = gdef.markGlyphSets && gdef.markGlyphSets[lookupTable.markFilteringSet];
        return !markGlyphSet || getCoverageIndex(markGlyphSet, glyphIndex) < 0;
    }
    const markAttachmentType = (lookupFlag & MARK_ATTACHMENT_TYPE) >> 8;
    if (markAttachmentType) {
        const markAttachmentClass = gdef.markAttachClassDef ? getGlyphClass(gdef.markAttachClassDef, glyphIndex) : 0;
        return markAttachmentClass !== markAttachmentType;
    }
    return false;
}

/**
 * Whether a lookup ignores a glyph of a font without glyph classes (no GlyphClassDef in the GDEF table of the layout,
 * see getLayoutGdefTable), taking it as a mark of no mark attachment class: with IgnoreMarks, with UseMarkFilteringSet
 * when the mark glyph set of the lookup does not cover it, and with a MarkAttachmentType (see isMarkIgnoredByLookup).
 * For a mark attachment lookup, which applies only at the glyphs its subtables cover as marks, like HarfBuzz with the
 * classes it then synthesizes for the glyphs of the nonspacing marks of Unicode (Mn); not yet like HarfBuzz for the
 * glyph of a spacing character (e.g. U+00B4), a base glyph for HarfBuzz, which no such lookupFlag ignores.
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {{lookupFlag: number, markFilteringSet: number}} lookupTable
 * @param {number} glyphIndex
 * @returns {boolean} false with a GlyphClassDef, whose classes isGlyphIgnoredByLookup reads
 */
function isMarkIgnoredWithoutGlyphClasses(gdef, lookupTable, glyphIndex) {
    if (gdef && gdef.classDef) {
        return false;
    }
    return isMarkIgnoredByLookup({ markGlyphSets: gdef && gdef.markGlyphSets }, lookupTable, glyphIndex);
}

/**
 * Whether a lookup ignores a glyph, from the lookupFlag of the lookup and the GDEF class of the glyph: a base glyph
 * with IgnoreBaseGlyphs, a ligature with IgnoreLigatures, a mark with IgnoreMarks, a mark outside of the mark
 * filtering set with UseMarkFilteringSet or of another mark attachment class with a MarkAttachmentType.
 * An ignored glyph is skipped when a lookup matches its glyphs (input, backtrack and lookahead sequences, ligature
 * components, pairs), and the lookup does not apply at it. Without the GlyphClassDef of GDEF no glyph is ignored,
 * unlike HarfBuzz, which then synthesizes the classes from the Unicode general category (a nonspacing mark is a mark).
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {{lookupFlag: number, markFilteringSet: number}} lookupTable - a GSUB or GPOS lookup table
 * @param {number} glyphIndex
 * @returns {boolean}
 */
function isGlyphIgnoredByLookup(gdef, lookupTable, glyphIndex) {
    if (!gdef || !gdef.classDef || !(lookupTable.lookupFlag & IGNORING_FLAGS)) {
        return false;
    }
    switch (getGlyphClass(gdef.classDef, glyphIndex)) {
        case BASE_GLYPH_CLASS:
            return Boolean(lookupTable.lookupFlag & IGNORE_BASE_GLYPHS);
        case LIGATURE_GLYPH_CLASS:
            return Boolean(lookupTable.lookupFlag & IGNORE_LIGATURES);
        case MARK_GLYPH_CLASS:
            return isMarkIgnoredByLookup(gdef, lookupTable, glyphIndex);
        default:
            // no class, the component class and the values the specification does not define are never ignored
            return false;
    }
}

/**
 * How the lookups of a feature skip U+200C ZERO WIDTH NON-JOINER and U+200D ZERO WIDTH JOINER, like the auto_zwnj and
 * auto_zwj of a lookup of the map of HarfBuzz (see getLookupJoinerFlags in features/featureValues.mjs)
 * @typedef JoinerFlags
 * @type Object
 * @property {boolean} autoZeroWidthNonJoiner - whether a GSUB lookup skips the zero width non-joiners in the backtrack
 * and the lookahead of its rules
 * @property {boolean} autoZeroWidthJoiner - whether a lookup skips the zero width joiners in the input of its rules and
 * ligatures, and in the pairs and the attachments of GPOS
 */

// the joiner flags of the lookups of the features of HarfBuzz but a few (F_MANUAL_ZWNJ and F_MANUAL_ZWJ), and of the
// required feature: both joiners skipped
const AUTO_JOINER_FLAGS = Object.freeze({ autoZeroWidthNonJoiner: true, autoZeroWidthJoiner: true });

/**
 * Whether two joiner flags skip the same joiners
 * @param {JoinerFlags} joinerFlags
 * @param {JoinerFlags} otherJoinerFlags
 * @returns {boolean}
 */
function areJoinerFlagsEqual(joinerFlags, otherJoinerFlags) {
    return joinerFlags.autoZeroWidthNonJoiner === otherJoinerFlags.autoZeroWidthNonJoiner &&
        joinerFlags.autoZeroWidthJoiner === otherJoinerFlags.autoZeroWidthJoiner;
}

/**
 * The default ignorables a lookup skips when it matches glyphs, like the matcher_t of the skipping iterators of
 * HarfBuzz (hb-ot-layout-gsubgpos.hh of HarfBuzz 11.3.2), see createIgnorableMatching
 * @typedef IgnorableMatching
 * @type Object
 * @property {number[]} ignorableTypes - the kind of default ignorable of each glyph of the context (see
 * DEFAULT_IGNORABLE_TYPES in char.mjs), the ones of a substituted glyph NOT_IGNORABLE
 * @property {boolean} isPositioning - whether the lookup is a GPOS lookup
 * @property {JoinerFlags} joinerFlags - the joiner flags of the lookup
 * @property {function(number): boolean} isSkippedInInput - whether the lookup may skip the glyph at a position of the
 * context in the input of a rule or of a ligature, and as the second glyph of a pair, the glyph a mark or a cursive
 * attachment attaches to
 * @property {function(number): boolean} isSkippedInContext - whether the lookup may skip the glyph at a position of the
 * context in the backtrack and the lookahead of a rule
 */

/**
 * Whether a lookup may skip a glyph of a kind of default ignorable, like matcher_t::may_skip of HarfBuzz
 * @param {number|undefined} ignorableType - see DEFAULT_IGNORABLE_TYPES in char.mjs, undefined for no glyph
 * @param {{zeroWidthNonJoiner: boolean, zeroWidthJoiner: boolean, hidden: boolean}} skippedJoiners - whether the
 * lookup skips the zero width non-joiners, the zero width joiners and the hidden default ignorables
 * @returns {boolean}
 */
function isIgnorableTypeSkipped(ignorableType, skippedJoiners) {
    switch (ignorableType) {
        case DEFAULT_IGNORABLE_TYPES.IGNORABLE:
            return true;
        case DEFAULT_IGNORABLE_TYPES.ZERO_WIDTH_NON_JOINER:
            return skippedJoiners.zeroWidthNonJoiner;
        case DEFAULT_IGNORABLE_TYPES.ZERO_WIDTH_JOINER:
            return skippedJoiners.zeroWidthJoiner;
        case DEFAULT_IGNORABLE_TYPES.HIDDEN:
            return skippedJoiners.hidden;
        default:
            return false;
    }
}

/**
 * The default ignorables a lookup skips when it matches the glyphs of a context, like matcher_t::init of HarfBuzz: in
 * the input, the zero width non-joiners in GPOS only, the zero width joiners with the autoZeroWidthJoiner flag of the
 * lookup; in the backtrack and the lookahead, the zero width non-joiners in GPOS and with the autoZeroWidthNonJoiner
 * flag, the zero width joiners always; the hidden default ignorables in GPOS only; the other default ignorables
 * always. Like HarfBuzz, a default ignorable that the lookup may skip is matched when it matches the glyph of the rule
 * there (e.g. the zero width joiner that is a component of a ligature of emoji), skipped otherwise (see
 * findNextGlyphPosition).
 * @param {number[]} ignorableTypes - see IgnorableMatching
 * @param {boolean} isPositioning - whether the lookup is a GPOS lookup
 * @param {JoinerFlags} joinerFlags
 * @returns {IgnorableMatching}
 */
function createIgnorableMatching(ignorableTypes, isPositioning, joinerFlags) {
    const inputJoiners = {
        zeroWidthNonJoiner: isPositioning, zeroWidthJoiner: joinerFlags.autoZeroWidthJoiner, hidden: isPositioning
    };
    const contextJoiners = {
        zeroWidthNonJoiner: isPositioning || joinerFlags.autoZeroWidthNonJoiner, zeroWidthJoiner: true, hidden: isPositioning
    };
    return {
        ignorableTypes,
        isPositioning,
        joinerFlags,
        isSkippedInInput: position => isIgnorableTypeSkipped(ignorableTypes[position], inputJoiners),
        isSkippedInContext: position => isIgnorableTypeSkipped(ignorableTypes[position], contextJoiners)
    };
}

// the matching of a context without default ignorables
const NO_IGNORABLE_MATCHING = createIgnorableMatching([], false, AUTO_JOINER_FLAGS);

// the isSkippedIgnorable of a lookup that skips no default ignorable (see findNextGlyphPosition)
const isNeverSkipped = () => false;

/**
 * The position of the next glyph of a sequence that a lookup matches after a position (before it with a step of -1),
 * like the next and prev of the skipping iterators of HarfBuzz: a glyph the lookup ignores (see
 * isGlyphIgnoredByLookup) is skipped; a glyph that matches is the one; a default ignorable the lookup may skip is
 * skipped; any other glyph ends the search.
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {{lookupFlag: number, markFilteringSet: number}} lookupTable
 * @param {number[]} glyphs - glyph indexes, each glyph of a multiple substitution a glyph of its own
 * @param {number} position - the position the search starts from, excluded
 * @param {number} step - 1 for the next glyph, -1 for the previous one
 * @param {function(number): boolean} isSkippedIgnorable - whether the glyph at a position is a default ignorable the
 * lookup may skip (see IgnorableMatching)
 * @param {function(number, any): boolean} [matchesItem] - whether a glyph index matches the item (see RuleSequence),
 * the first glyph that is not skipped if omitted
 * @param {any} [item] - the item of a rule or of a ligature to match
 * @returns {number} -1 if there is none
 */
function findNextGlyphPosition(gdef, lookupTable, glyphs, position, step, isSkippedIgnorable, matchesItem, item) {
    for (let i = position + step; i >= 0 && i < glyphs.length; i += step) {
        if (isGlyphIgnoredByLookup(gdef, lookupTable, glyphs[i])) {
            continue;
        }
        if (matchesItem && matchesItem(glyphs[i], item)) {
            return i;
        }
        if (isSkippedIgnorable(i)) {
            continue;
        }
        return matchesItem ? -1 : i;
    }
    return -1;
}

/**
 * The position of the first glyph of a sequence after a position (before it with a step of -1) that a lookup does
 * not ignore (see isGlyphIgnoredByLookup), nor skip as a default ignorable (see findNextGlyphPosition).
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {{lookupFlag: number, markFilteringSet: number}} lookupTable
 * @param {number[]} glyphs - glyph indexes, each glyph of a multiple substitution a glyph of its own
 * @param {number} position - the position the search starts from, excluded
 * @param {number} step - 1 for the next glyph, -1 for the previous one
 * @param {function(number): boolean} [isSkippedIgnorable] - whether the glyph at a position is a default ignorable the
 * lookup may skip (see IgnorableMatching), none if omitted
 * @returns {number} -1 if there is none
 */
function findNextNotIgnoredGlyphPosition(gdef, lookupTable, glyphs, position, step, isSkippedIgnorable = isNeverSkipped) {
    return findNextGlyphPosition(gdef, lookupTable, glyphs, position, step, isSkippedIgnorable);
}

/**
 * A sequence of a contextual rule (its backtrack, its input or its lookahead), or the components of a ligature.
 * @typedef RuleSequence
 * @type Object
 * @property {Array} items - glyph indexes, glyph classes or coverage tables, in the order they are matched
 * @property {function(number, any): boolean} matchesItem - whether a glyph index matches an item
 */

const matchesGlyphIndex = (glyphIndex, expectedGlyphIndex) => glyphIndex === expectedGlyphIndex;
const matchesCoverage = (glyphIndex, coverage) => getCoverageIndex(coverage, glyphIndex) >= 0;
const EMPTY_SEQUENCE = { items: [], matchesItem: matchesGlyphIndex };

/**
 * Match a sequence of a rule or of a ligature from the glyph after a position (the glyph before it with a step of -1),
 * each item at the next glyph that the lookup matches there (see findNextGlyphPosition), like match_input,
 * match_backtrack and match_lookahead of HarfBuzz.
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {{lookupFlag: number, markFilteringSet: number}} lookupTable - the lookup of the rule
 * @param {number[]} glyphIndexes - the glyphs of the context
 * @param {number} position - the position the sequence starts after
 * @param {number} step - 1 for an input or a lookahead, -1 for a backtrack
 * @param {RuleSequence} sequence
 * @param {function(number): boolean} [isSkippedIgnorable] - whether the glyph at a position is a default ignorable the
 * lookup may skip (see IgnorableMatching), none if omitted
 * @returns {number[]|null} the positions of the matched glyphs, null if the sequence does not match
 */
function matchGlyphSequence(gdef, lookupTable, glyphIndexes, position, step, sequence, isSkippedIgnorable = isNeverSkipped) {
    const positions = [];
    let nextPosition = position;
    for (const item of sequence.items) {
        nextPosition = findNextGlyphPosition(
            gdef, lookupTable, glyphIndexes, nextPosition, step, isSkippedIgnorable, sequence.matchesItem, item
        );
        if (nextPosition < 0) {
            return null;
        }
        positions.push(nextPosition);
    }
    return positions;
}

/**
 * The class of a glyph in a class definition table of a contextual subtable.
 * @param {object|undefined} classDef
 * @param {number} glyphIndex
 * @returns {number} 0 for a glyph of no class, and without a class definition table
 */
function getContextGlyphClass(classDef, glyphIndex) {
    return (classDef && getGlyphClass(classDef, glyphIndex)) || 0;
}

/**
 * The matchesItem function of a sequence of glyph classes (see RuleSequence).
 * @param {object|undefined} classDef
 * @returns {function(number, number): boolean}
 */
function getGlyphClassMatcher(classDef) {
    return (glyphIndex, glyphClass) => getContextGlyphClass(classDef, glyphIndex) === glyphClass;
}

/**
 * Match a contextual rule at a glyph, on the glyphs that the lookup does not ignore, like HarfBuzz: the input glyphs
 * from the glyph after it, the lookahead from the glyph after the last input glyph, the backtrack from the glyph before
 * it, each sequence skipping the default ignorables of its kind (see createIgnorableMatching). The glyph itself, the
 * first glyph of the input, is matched by the caller.
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {{lookupFlag: number, markFilteringSet: number}} lookupTable - the lookup of the rule
 * @param {number[]} glyphIndexes - the glyphs of the context
 * @param {number} index - the position of the glyph
 * @param {{backtrack: RuleSequence, input: RuleSequence, lookahead: RuleSequence}} rule - the input without its first
 * glyph
 * @param {IgnorableMatching} ignorableMatching - the default ignorables of the context
 * @returns {number[]|null} the positions of the input glyphs, the glyph first, null if the rule does not match
 */
function matchContextRule(gdef, lookupTable, glyphIndexes, index, rule, ignorableMatching) {
    const { isSkippedInInput, isSkippedInContext } = ignorableMatching;
    const inputPositions = matchGlyphSequence(gdef, lookupTable, glyphIndexes, index, 1, rule.input, isSkippedInInput);
    if (!inputPositions) {
        return null;
    }
    inputPositions.unshift(index);
    const lastInputPosition = inputPositions[inputPositions.length - 1];
    if (!matchGlyphSequence(gdef, lookupTable, glyphIndexes, lastInputPosition, 1, rule.lookahead, isSkippedInContext)) {
        return null;
    }
    if (!matchGlyphSequence(gdef, lookupTable, glyphIndexes, index, -1, rule.backtrack, isSkippedInContext)) {
        return null;
    }
    return inputPositions;
}

/**
 * A contextual rule that matches at a glyph (see matchSequenceContext and matchChainedSequenceContext).
 * @typedef ContextRuleMatch
 * @type Object
 * @property {number[]} inputPositions - the positions of the input glyphs, the glyph first
 * @property {Array<{sequenceIndex: number, lookupListIndex: number}>} lookupRecords - the lookup records of the rule
 */

/**
 * Match the rules of a rule set at a glyph, the first rule that matches wins, like HarfBuzz.
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {{lookupFlag: number, markFilteringSet: number}} lookupTable - the lookup of the rules
 * @param {number[]} glyphIndexes - the glyphs of the context
 * @param {number} index - the position of the glyph
 * @param {object[]|undefined} ruleSet - the rules, none if undefined
 * @param {function(object): {backtrack: RuleSequence, input: RuleSequence, lookahead: RuleSequence}} getRuleSequences -
 * the sequences of a rule, its input without its first glyph
 * @param {IgnorableMatching} ignorableMatching - the default ignorables of the context
 * @returns {ContextRuleMatch|null}
 */
function matchRuleSet(gdef, lookupTable, glyphIndexes, index, ruleSet, getRuleSequences, ignorableMatching) {
    for (const rule of ruleSet || []) {
        const inputPositions = matchContextRule(gdef, lookupTable, glyphIndexes, index, getRuleSequences(rule), ignorableMatching);
        if (inputPositions) {
            return { inputPositions, lookupRecords: rule.lookupRecords };
        }
    }
    return null;
}

/**
 * Match the rule of a coverage-based subtable (format 3) at a glyph: a rule without input glyphs matches nothing, like
 * HarfBuzz.
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {{lookupFlag: number, markFilteringSet: number}} lookupTable - the lookup of the rule
 * @param {number[]} glyphIndexes - the glyphs of the context
 * @param {number} index - the position of the glyph
 * @param {{backtrack: object[], input: object[], lookahead: object[]}} coverages - the coverage tables of each sequence
 * @param {Array<{sequenceIndex: number, lookupListIndex: number}>} lookupRecords
 * @param {IgnorableMatching} ignorableMatching - the default ignorables of the context
 * @returns {ContextRuleMatch|null}
 */
function matchCoverageRule(gdef, lookupTable, glyphIndexes, index, coverages, lookupRecords, ignorableMatching) {
    if (!coverages.input.length || !matchesCoverage(glyphIndexes[index], coverages.input[0])) {
        return null;
    }
    const inputPositions = matchContextRule(gdef, lookupTable, glyphIndexes, index, {
        backtrack: { items: coverages.backtrack, matchesItem: matchesCoverage },
        input: { items: coverages.input.slice(1), matchesItem: matchesCoverage },
        lookahead: { items: coverages.lookahead, matchesItem: matchesCoverage }
    }, ignorableMatching);
    return inputPositions && { inputPositions, lookupRecords };
}

/**
 * The rule set of the coverage index of a glyph (format 1), undefined when the coverage table does not cover it.
 * @param {object} coverage
 * @param {Array<object[]|undefined>} ruleSets
 * @param {number} glyphIndex
 * @returns {object[]|undefined}
 */
function getCoveredGlyphRuleSet(coverage, ruleSets, glyphIndex) {
    const coverageIndex = getCoverageIndex(coverage, glyphIndex);
    return coverageIndex < 0 ? undefined : ruleSets[coverageIndex];
}

/**
 * The rule set of the class of a glyph (format 2), undefined when the coverage table does not cover it.
 * @param {object} coverage
 * @param {object|undefined} classDef
 * @param {Array<object[]|undefined>} classSets
 * @param {number} glyphIndex
 * @returns {object[]|undefined}
 */
function getCoveredClassRuleSet(coverage, classDef, classSets, glyphIndex) {
    if (getCoverageIndex(coverage, glyphIndex) < 0) {
        return undefined;
    }
    return classSets[getContextGlyphClass(classDef, glyphIndex)];
}

/**
 * Match a sequence context subtable (GSUB lookup type 5, GPOS lookup type 7) at a glyph, like HarfBuzz: the first rule
 * of the rule set of the glyph (format 1) or of its class (format 2) that matches, or the rule of format 3, on the
 * glyphs that the lookup does not ignore (see matchContextRule).
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {{lookupFlag: number, markFilteringSet: number}} lookupTable - the lookup of the subtable
 * @param {object} subtable - see Parser.parseSequenceContext
 * @param {number} format - the format of the subtable (its substFormat or posFormat)
 * @param {number[]} glyphIndexes - the glyphs of the context
 * @param {number} index - the position of the glyph
 * @param {IgnorableMatching} [ignorableMatching] - the default ignorables of the context, none if omitted
 * @returns {ContextRuleMatch|null}
 */
function matchSequenceContext(gdef, lookupTable, subtable, format, glyphIndexes, index, ignorableMatching = NO_IGNORABLE_MATCHING) {
    const glyphIndex = glyphIndexes[index];
    switch (format) {
        case 1: {
            const ruleSet = getCoveredGlyphRuleSet(subtable.coverage, subtable.ruleSets, glyphIndex);
            return matchRuleSet(gdef, lookupTable, glyphIndexes, index, ruleSet, rule => ({
                backtrack: EMPTY_SEQUENCE,
                input: { items: rule.input, matchesItem: matchesGlyphIndex },
                lookahead: EMPTY_SEQUENCE
            }), ignorableMatching);
        }
        case 2: {
            const matchesClass = getGlyphClassMatcher(subtable.classDef);
            const ruleSet = getCoveredClassRuleSet(
                subtable.coverage, subtable.classDef, subtable.classSets, glyphIndex
            );
            return matchRuleSet(gdef, lookupTable, glyphIndexes, index, ruleSet, rule => ({
                backtrack: EMPTY_SEQUENCE,
                input: { items: rule.classes, matchesItem: matchesClass },
                lookahead: EMPTY_SEQUENCE
            }), ignorableMatching);
        }
        case 3:
            return matchCoverageRule(gdef, lookupTable, glyphIndexes, index,
                { backtrack: [], input: subtable.coverages, lookahead: [] }, subtable.lookupRecords, ignorableMatching);
        default:
            throw new Error(`Unknown sequence context format: ${format}`);
    }
}

/**
 * Match a chained sequence context subtable (GSUB lookup type 6, GPOS lookup type 8) at a glyph, like HarfBuzz: the
 * first rule of the rule set of the glyph (format 1) or of its input class (format 2) that matches, or the rule of
 * format 3, on the glyphs that the lookup does not ignore (see matchContextRule).
 * @param {object|undefined} gdef - the GDEF table of the font
 * @param {{lookupFlag: number, markFilteringSet: number}} lookupTable - the lookup of the subtable
 * @param {object} subtable - see Parser.parseChainedSequenceContext
 * @param {number} format - the format of the subtable (its substFormat or posFormat)
 * @param {number[]} glyphIndexes - the glyphs of the context
 * @param {number} index - the position of the glyph
 * @param {IgnorableMatching} [ignorableMatching] - the default ignorables of the context, none if omitted
 * @returns {ContextRuleMatch|null}
 */
function matchChainedSequenceContext(gdef, lookupTable, subtable, format, glyphIndexes, index, ignorableMatching = NO_IGNORABLE_MATCHING) {
    const glyphIndex = glyphIndexes[index];
    switch (format) {
        case 1: {
            const ruleSet = getCoveredGlyphRuleSet(subtable.coverage, subtable.chainRuleSets, glyphIndex);
            return matchRuleSet(gdef, lookupTable, glyphIndexes, index, ruleSet, rule => ({
                backtrack: { items: rule.backtrack, matchesItem: matchesGlyphIndex },
                input: { items: rule.input, matchesItem: matchesGlyphIndex },
                lookahead: { items: rule.lookahead, matchesItem: matchesGlyphIndex }
            }), ignorableMatching);
        }
        case 2: {
            const matchesBacktrackClass = getGlyphClassMatcher(subtable.backtrackClassDef);
            const matchesInputClass = getGlyphClassMatcher(subtable.inputClassDef);
            const matchesLookaheadClass = getGlyphClassMatcher(subtable.lookaheadClassDef);
            const ruleSet = getCoveredClassRuleSet(
                subtable.coverage, subtable.inputClassDef, subtable.chainClassSet, glyphIndex
            );
            return matchRuleSet(gdef, lookupTable, glyphIndexes, index, ruleSet, rule => ({
                backtrack: { items: rule.backtrack, matchesItem: matchesBacktrackClass },
                input: { items: rule.input, matchesItem: matchesInputClass },
                lookahead: { items: rule.lookahead, matchesItem: matchesLookaheadClass }
            }), ignorableMatching);
        }
        case 3:
            return matchCoverageRule(gdef, lookupTable, glyphIndexes, index, {
                backtrack: subtable.backtrackCoverage,
                input: subtable.inputCoverage,
                lookahead: subtable.lookaheadCoverage
            }, subtable.lookupRecords, ignorableMatching);
        default:
            throw new Error(`Unknown chained sequence context format: ${format}`);
    }
}

/**
 * @exports opentype.Layout
 * @class
 */
function Layout(font, tableName) {
    this.font = font;
    this.tableName = tableName;
}

Layout.prototype = {

    /**
     * Binary search an object by "tag" property
     * @instance
     * @function searchTag
     * @memberof opentype.Layout
     * @param  {Array} arr
     * @param  {string} tag
     * @return {number}
     */
    searchTag: searchTag,

    /**
     * Binary search in a list of numbers
     * @instance
     * @function binSearch
     * @memberof opentype.Layout
     * @param  {Array} arr
     * @param  {number} value
     * @return {number}
     */
    binSearch: binSearch,

    /**
     * Get or create the Layout table (GSUB, GPOS etc).
     * @param  {boolean} create - Whether to create a new one.
     * @return {Object} The GSUB or GPOS table.
     */
    getTable: function(create) {
        let layout = this.font.tables[this.tableName];
        if (!layout && create) {
            layout = this.font.tables[this.tableName] = this.createDefaultTable();
        }
        return layout;
    },

    /**
     * Returns all scripts in the substitution table.
     * @instance
     * @return {Array}
     */
    getScriptNames: function() {
        let layout = this.getTable();
        if (!layout) { return []; }
        return layout.scripts.map(function(script) {
            return script.tag;
        });
    },

    /**
     * Returns the best bet for a script name.
     * Returns 'DFLT' if it exists.
     * If not, returns 'latn' if it exists.
     * If neither exist, returns undefined.
     */
    getDefaultScriptName: function() {
        let layout = this.getTable();
        if (!layout) { return; }
        let hasLatn = false;
        for (let i = 0; i < layout.scripts.length; i++) {
            const name = layout.scripts[i].tag;
            if (name === 'DFLT') return name;
            if (name === 'latn') hasLatn = true;
        }
        if (hasLatn) return 'latn';
    },

    /**
     * Returns all LangSysRecords in the given script.
     * A script the table has not falls back, like HarfBuzz, to the first of DFLT, dflt and latn that
     * the table has, unless the script table is created.
     * @instance
     * @param {string} [script='DFLT']
     * @param {boolean} create - forces the creation of this script table if it doesn't exist.
     * @return {Object} An object with tag and script properties.
     */
    getScriptTable: function(script, create) {
        const layout = this.getTable(create);
        if (layout) {
            script = script || 'DFLT';
            const scripts = layout.scripts;
            const pos = searchTag(layout.scripts, script);
            if (pos >= 0) {
                return scripts[pos].script;
            } else if (create) {
                const scr = {
                    tag: script,
                    script: {
                        defaultLangSys: {reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: []},
                        langSysRecords: []
                    }
                };
                scripts.splice(-1 - pos, 0, scr);
                clearLayoutCache(layout);
                return scr.script;
            }
            return getFallbackScriptTable(scripts);
        }
    },

    /**
     * Returns a language system table.
     * A language the script has not falls back to the default language system of the script
     * (see getScriptTable for a script the table has not), unless the language system is created.
     * Like HarfBuzz, the default language system is the LangSysRecord tagged dflt if the script has one,
     * otherwise the DefaultLangSys, also with create (the writers add to the language system the readers use).
     * A language tag of three letters is the tag with its trailing space ('TRK' is 'TRK ').
     * @instance
     * @param {string} [script='DFLT']
     * @param {string} [language='dlft']
     * @param {boolean} create - forces the creation of this langSysTable if it doesn't exist.
     * @return {Object}
     */
    getLangSysTable: function(script, language, create) {
        const scriptTable = this.getScriptTable(script, create);
        if (scriptTable) {
            if (!language || language === 'dflt' || language === 'DFLT') {
                return getDefaultLangSysTable(scriptTable);
            }
            language = getLanguageSystemTag(language);
            const pos = searchTag(scriptTable.langSysRecords, language);
            if (pos >= 0) {
                return scriptTable.langSysRecords[pos].langSys;
            } else if (create) {
                const langSysRecord = {
                    tag: language,
                    langSys: {reserved: 0, reqFeatureIndex: 0xffff, featureIndexes: []}
                };
                scriptTable.langSysRecords.splice(-1 - pos, 0, langSysRecord);
                clearLayoutCache(this.getTable());
                return langSysRecord.langSys;
            }
            return getDefaultLangSysTable(scriptTable);
        }
    },

    /**
     * Get a specific feature table.
     * A script or a language the table has not falls back like in getScriptTable and getLangSysTable,
     * unless the feature table is created.
     * @instance
     * @param {string} [script='DFLT']
     * @param {string} [language='dlft']
     * @param {string} feature - One of the codes listed at https://www.microsoft.com/typography/OTSPEC/featurelist.htm
     * @param {boolean} create - forces the creation of the feature table if it doesn't exist.
     * @return {Object}
     */
    getFeatureTable: function(script, language, feature, create) {
        const langSysTable = this.getLangSysTable(script, language, create);
        if (langSysTable) {
            let featureRecord;
            const featIndexes = langSysTable.featureIndexes;
            const allFeatures = this.font.tables[this.tableName].features;
            // The FeatureIndex array of indices is in arbitrary order,
            // even if allFeatures is sorted alphabetically by feature tag.
            // Like HarfBuzz, a feature index past the FeatureList is ignored.
            for (let i = 0; i < featIndexes.length; i++) {
                featureRecord = allFeatures[featIndexes[i]];
                if (featureRecord && featureRecord.tag === feature) {
                    return featureRecord.feature;
                }
            }
            if (create) {
                const index = allFeatures.length;
                // Automatic ordering of features would require to shift feature indexes in the script list.
                check.assert(index === 0 || feature >= allFeatures[index - 1].tag, 'Features must be added in alphabetical order.');
                featureRecord = {
                    tag: feature,
                    feature: { params: 0, lookupListIndexes: [] }
                };
                allFeatures.push(featureRecord);
                featIndexes.push(index);
                clearLayoutCache(this.getTable());
                return featureRecord.feature;
            }
        }
    },

    /**
     * Get the lookup tables of a given type for a script/language/feature.
     * A script or a language the table has not falls back like in getScriptTable and getLangSysTable,
     * unless the lookup table is created.
     * @instance
     * @param {string} [script='DFLT']
     * @param {string} [language='dlft']
     * @param {string} feature - 4-letter feature code
     * @param {number} lookupType - 1 to 9
     * @param {boolean} create - forces the creation of the lookup table if it doesn't exist, with no subtables.
     * @return {Object[]}
     */
    getLookupTables: function(script, language, feature, lookupType, create) {
        const featureTable = this.getFeatureTable(script, language, feature, create);
        const tables = [];
        if (featureTable) {
            let lookupTable;
            const lookupListIndexes = featureTable.lookupListIndexes;
            const allLookups = this.font.tables[this.tableName].lookups;
            // lookupListIndexes are in no particular order, so use naive search.
            for (let i = 0; i < lookupListIndexes.length; i++) {
                lookupTable = allLookups[lookupListIndexes[i]];
                if (lookupTable.lookupType === lookupType) {
                    tables.push(lookupTable);
                }
            }
            if (tables.length === 0 && create) {
                lookupTable = {
                    lookupType: lookupType,
                    lookupFlag: 0,
                    subtables: [],
                    markFilteringSet: undefined
                };
                const index = allLookups.length;
                allLookups.push(lookupTable);
                lookupListIndexes.push(index);
                clearLayoutCache(this.getTable());
                return [lookupTable];
            }
        }
        return tables;
    },

    /**
     * Find a glyph in a class definition table
     * https://docs.microsoft.com/en-us/typography/opentype/spec/chapter2#class-definition-table
     * @instance
     * @function getGlyphClass
     * @memberof opentype.Layout
     * @param {object} classDefTable - an OpenType Layout class definition table
     * @param {number} glyphIndex - the index of the glyph to find
     * @returns {number} 0 if not found
     */
    getGlyphClass: getGlyphClass,

    /**
     * Find a glyph in a coverage table
     * https://docs.microsoft.com/en-us/typography/opentype/spec/chapter2#coverage-table
     * @instance
     * @function getCoverageIndex
     * @memberof opentype.Layout
     * @param {object} coverageTable - an OpenType Layout coverage table
     * @param {number} glyphIndex - the index of the glyph to find
     * @returns {number} -1 if not found
     */
    getCoverageIndex: getCoverageIndex,

    /**
     * Returns the list of glyph indexes of a coverage table.
     * Format 1: the list is stored raw
     * Format 2: compact list as range records.
     * @instance
     * @param  {Object} coverageTable
     * @return {Array}
     */
    expandCoverage: function(coverageTable) {
        if (coverageTable.format === 1) {
            return coverageTable.glyphs;
        } else {
            const glyphs = [];
            const ranges = coverageTable.ranges;
            for (let i = 0; i < ranges.length; i++) {
                const range = ranges[i];
                const start = range.start;
                const end = range.end;
                for (let j = start; j <= end; j++) {
                    glyphs.push(j);
                }
            }
            return glyphs;
        }
    }

};

export default Layout;
export {
    getCoverageIndex,
    getCoveragesGlyphDigest,
    mayGlyphDigestHave,
    getSubtablesFirstGlyphCoverages,
    getSubtablesFirstGlyphDigest,
    getSubtableFirstGlyphCoverage,
    createLookupFirstGlyphFilter,
    getLookupFilterGlyphDigest,
    getLayoutGdefTable,
    getGdefGlyphClass,
    isMarkGlyph,
    getLigatureId,
    getLigatureComponent,
    isMarkIgnoredWithoutGlyphClasses,
    isGlyphIgnoredByLookup,
    findNextNotIgnoredGlyphPosition,
    matchGlyphSequence,
    matchesGlyphIndex,
    AUTO_JOINER_FLAGS,
    areJoinerFlagsEqual,
    NO_IGNORABLE_MATCHING,
    createIgnorableMatching,
    matchSequenceContext,
    matchChainedSequenceContext,
    RIGHT_TO_LEFT,
    IGNORE_BASE_GLYPHS,
    IGNORE_LIGATURES,
    IGNORE_MARKS,
    BASE_GLYPH_CLASS,
    LIGATURE_GLYPH_CLASS,
    MARK_GLYPH_CLASS,
    getRequiredFeatureIndex,
    getCachedLayoutValue,
    clearLayoutCache,
    getOpenTypeScriptTags,
    isRightToLeftScript,
    getChosenScriptTag,
    HarfBuzzShaper,
    getHarfBuzzShaper,
    memoizeByScriptTags,
    selectScriptTag
};
