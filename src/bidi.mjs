/**
 * Infer bidirectional properties for a given text and apply
 * the corresponding layout rules.
 */

import Tokenizer from './tokenizer.mjs';
import FeatureQuery from './features/featureQuery.mjs';
import { getTokenGlyphIndexes, getGlyphSequence } from './features/applySubstitution.mjs';
import arabicWordCheck from './features/arab/contextCheck/arabicWord.mjs';
import arabicSentenceCheck from './features/arab/contextCheck/arabicSentence.mjs';
import arabicPresentationForms from './features/arab/arabicPresentationForms.mjs';
import arabicRequiredLigatures from './features/arab/arabicRequiredLigatures.mjs';
import ccmpReplacementCheck from './features/ccmp/contextCheck/ccmpReplacement.mjs';
import ccmpReplacement from './features/ccmp/ccmpReplacementLigatures.mjs';
import latinFeatures from './features/latn/latinFeatures.mjs';
import thaiWordCheck from './features/thai/contextCheck/thaiWord.mjs';
import thaiFeatures from './features/thai/thaiFeatures.mjs';
import unicodeVariationSequenceCheck from './features/unicode/contextCheck/variationSequenceCheck.mjs';
import unicodeVariationSequences from './features/unicode/variationSequences.mjs';

/**
 * Create Bidi. features
 * @param {string} baseDir text base direction. value either 'ltr' or 'rtl'
 */
function Bidi(baseDir) {
    this.baseDir = baseDir || 'ltr';
    this.tokenizer = new Tokenizer();
    this.featuresTags = {};
    // the tokens of the runs laid out from right to left (see reverseArabicSentences)
    this.rightToLeftTokens = new Set();
}

/**
 * Sets Bidi text
 * @param {string} text a text input
 */
Bidi.prototype.setText = function (text) {
    this.text = text;
};

/**
 * Store essential context checks:
 * arabic word check for applying gsub features
 * arabic sentence check for adjusting arabic layout
 */
Bidi.prototype.contextChecks = ({
    ccmpReplacementCheck,
    arabicWordCheck,
    arabicSentenceCheck,
    thaiWordCheck,
    unicodeVariationSequenceCheck
});

/**
 * Register arabic word check
 */
function registerContextChecker(checkId) {
    const check = this.contextChecks[`${checkId}Check`];
    return this.tokenizer.registerContextChecker(
        checkId, check.startCheck, check.endCheck
    );
}

/**
 * Perform pre tokenization procedure then
 * tokenize text input
 */
function tokenizeText() {
    registerContextChecker.call(this, 'ccmpReplacement');
    registerContextChecker.call(this, 'arabicWord');
    registerContextChecker.call(this, 'arabicSentence');
    registerContextChecker.call(this, 'thaiWord');
    registerContextChecker.call(this, 'unicodeVariationSequence');
    return this.tokenizer.tokenize(this.text);
}

/**
 * Reverse arabic sentence layout
 * TODO: check base dir before applying adjustments - priority low
 */
function reverseArabicSentences() {
    const ranges = this.tokenizer.getContextRanges('arabicSentence');
    this.rightToLeftTokens = new Set();
    for(let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        let rangeTokens = this.tokenizer.getRangeTokens(range);
        for (const token of rangeTokens) {
            this.rightToLeftTokens.add(token);
        }
        this.tokenizer.replaceRange(
            range.startIndex,
            range.endOffset,
            rangeTokens.reverse()
        );
    }
}

/**
 * Register supported features tags
 * @param {script} script script tag
 * @param {Array} tags features tags list
 */
Bidi.prototype.registerFeatures = function (script, tags) {
    const supportedTags = tags.filter(
        tag => this.query.supports({script, tag})
    );
    if (!Object.prototype.hasOwnProperty.call(this.featuresTags, script)) {
        this.featuresTags[script] = supportedTags;
    } else {
        this.featuresTags[script] =
        this.featuresTags[script].concat(supportedTags);
    }
};

/**
 * Apply GSUB features
 * @param {Array} tagsList a list of features tags
 * @param {string} script a script tag
 * @param {Font} font opentype font instance
 */
Bidi.prototype.applyFeatures = function (font, features) {
    if (!font) throw new Error(
        'No valid font was provided to apply features'
    );
    if (!this.query) this.query = new FeatureQuery(font);
    for (let f = 0; f < features.length; f++) {
        const feature = features[f];
        if (!this.query.supports({script: feature.script})) continue;
        this.registerFeatures(feature.script, feature.tags);
    }
};

/**
 * Register a state modifier
 * @param {string} modifierId state modifier id
 * @param {function} condition a predicate function that returns true or false
 * @param {function} modifier a modifier function to set token state
 */
Bidi.prototype.registerModifier = function (modifierId, condition, modifier) {
    this.tokenizer.registerModifier(modifierId, condition, modifier);
};

/**
 * Check if 'glyphIndex' is registered
 */
function checkGlyphIndexStatus() {
    if (this.tokenizer.registeredModifiers.indexOf('glyphIndex') === -1) {
        throw new Error(
            'glyphIndex modifier is required to apply ' +
            'arabic presentation features.'
        );
    }
}

/**
 * Apply arabic presentation forms features
 */
function applyArabicPresentationForms() {
    const script = 'arab';
    if (!Object.prototype.hasOwnProperty.call(this.featuresTags, script)) return;
    checkGlyphIndexStatus.call(this);
    const ranges = this.tokenizer.getContextRanges('arabicWord');
    for(let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        arabicPresentationForms.call(this, range);
    }
}

/**
 * Apply ccmp replacement
 */
function applyCcmpReplacement() {
    checkGlyphIndexStatus.call(this);
    const ranges = this.tokenizer.getContextRanges('ccmpReplacement');
    for(let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        ccmpReplacement.call(this, range);
    }
}

/**
 * Apply required arabic ligatures
 */
function applyArabicRequireLigatures() {
    if (!this.hasFeatureEnabled('arab', 'rlig')) return;
    checkGlyphIndexStatus.call(this);
    const ranges = this.tokenizer.getContextRanges('arabicWord');
    for(let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        arabicRequiredLigatures.call(this, range);
    }
}

/**
 * Apply the enabled latin features
 */
function applyLatinFeatures() {
    if (!(this.featuresTags.latn || []).length) return;
    checkGlyphIndexStatus.call(this);
    latinFeatures.call(this);
}

function applyUnicodeVariationSequences() {
    const ranges = this.tokenizer.getContextRanges('unicodeVariationSequence');
    for(let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        unicodeVariationSequences.call(this, range);
    }
}

/**
 * Apply the enabled thai features
 */
function applyThaiFeatures() {
    checkGlyphIndexStatus.call(this);
    thaiFeatures.call(this);
}

/**
 * Check if a context is registered
 * @param {string} contextId context id
 */
Bidi.prototype.checkContextReady = function (contextId) {
    return !!this.tokenizer.getContext(contextId);
};

/**
 * Apply features to registered contexts
 *
 * - A Glyph Composition (ccmp) feature should be always applied
 * https://learn.microsoft.com/en-us/typography/opentype/spec/features_ae#tag-ccmp
 */
Bidi.prototype.applyFeaturesToContexts = function () {
    if (this.checkContextReady('ccmpReplacement')) {
        applyCcmpReplacement.call(this);
    }
    if (this.checkContextReady('arabicWord')) {
        applyArabicPresentationForms.call(this);
        applyArabicRequireLigatures.call(this);
    }
    // the latin features apply to the runs of text that are not arabic or thai,
    // with their spaces, digits and punctuation, not only to the latin words
    applyLatinFeatures.call(this);
    if (this.checkContextReady('arabicSentence')) {
        reverseArabicSentences.call(this);
    }
    if (this.checkContextReady('thaiWord')) {
        applyThaiFeatures.call(this);
    }
    if (this.checkContextReady('unicodeVariationSequence')) {
        applyUnicodeVariationSequences.call(this);
    }
};

/**
 * Check whatever feature is successfully enabled for a script
 * @param {string} script
 * @param {string} tag feature name
 * @returns {boolean}
 */
Bidi.prototype.hasFeatureEnabled = function(script, tag) {
    return (this.featuresTags[script] || []).indexOf(tag) !== -1;
};

/**
 * process text input
 * @param {string} text an input text
 */
Bidi.prototype.processText = function(text) {
    if (!this.text || this.text !== text) {
        this.setText(text);
        tokenizeText.call(this);
        this.applyFeaturesToContexts();
    }
};

/**
 * Process a string of text to identify and adjust
 * bidirectional text entities.
 * @param {string} text input text
 */
Bidi.prototype.getBidiText = function (text) {
    this.processText(text);
    return this.tokenizer.getText();
};

/**
 * Get the glyph indexes of the text in glyph order: each glyph of a multiple substitution its own, none for a
 * deleted token
 * @param {string} text an input text
 * @returns {number[]}
 */
Bidi.prototype.getTextGlyphs = function (text) {
    this.processText(text);
    return getGlyphSequence(this.tokenizer.tokens).glyphIndexes;
};

/**
 * Get each glyph of the text, with the range of the characters it represents (its cluster), like the
 * monotone clusters of HarfBuzz: a cluster ends where the next cluster of the text
 * starts, so the characters of the deleted tokens (e.g. ligature components, variation selectors) belong to
 * the cluster before them in the text (the first cluster for the ones before it). The glyphs of a multiple
 * substitution have the cluster of their token, a ligature merges the clusters of its components and of the
 * glyphs between them.
 * @param {string} text an input text
 * @returns {Array<{index: number, start: number, end: number, rightToLeft: boolean, tokenOffset: number}>} glyph
 * indexes in the glyph order, with the UTF-16 range [start, end) of their characters in the text, whether their run
 * is laid out from right to left (the arabic sentences, in reverse order of the text), and the UTF-16 offset of the
 * character of their token in the text, shared by the glyphs of a multiple substitution only
 */
Bidi.prototype.getTextGlyphClusters = function (text) {
    this.processText(text);
    const glyphTokens = this.tokenizer.tokens.filter(token => !token.state.deleted);
    const clusterStarts = Array.from(new Set(glyphTokens.map(token => token.cluster))).sort((startA, startB) => startA - startB);
    const clusterRanges = new Map(clusterStarts.map((start, index) => [start, {
        start: index === 0 ? 0 : start,
        end: index + 1 < clusterStarts.length ? clusterStarts[index + 1] : text.length
    }]));
    const clusters = [];
    for (const token of glyphTokens) {
        const { start, end } = clusterRanges.get(token.cluster);
        const rightToLeft = this.rightToLeftTokens.has(token);
        for (const index of getTokenGlyphIndexes(token)) {
            clusters.push({ index, start, end, rightToLeft, tokenOffset: token.charOffset });
        }
    }
    return clusters;
};

export default Bidi;
