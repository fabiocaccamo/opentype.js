/**
 * Infer bidirectional properties for a given text and apply
 * the corresponding layout rules.
 */

import Tokenizer from './tokenizer.mjs';
import FeatureQuery from './features/featureQuery.mjs';
import {
    getTokenGlyphIndexes,
    applyFeaturesToTokens,
    getRequiredFeatureStage,
    REQUIRED_VARIATION_ALTERNATES_TAG
} from './features/applySubstitution.mjs';
import { getScriptRuns } from './char.mjs';
import { getOpenTypeScriptTags, selectScriptTag } from './layout.mjs';
import arabicSentenceCheck from './features/arab/contextCheck/arabicSentence.mjs';
import arabicPresentationForms from './features/arab/arabicPresentationForms.mjs';
import latinFeatures from './features/latn/latinFeatures.mjs';
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
    // the script runs of the text (see getTokenScriptRuns), and the run of each token
    this.scriptRuns = [];
    this.tokenScriptRuns = new Map();
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
 * arabic sentence check for adjusting arabic layout
 * unicode variation sequence check for applying the variation sequences
 */
Bidi.prototype.contextChecks = ({
    arabicSentenceCheck,
    unicodeVariationSequenceCheck
});

/**
 * Register a context check
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
    registerContextChecker.call(this, 'arabicSentence');
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
 * Register the tags of the features of a shaper
 * @param {string} shaper the shaper of the features: arab for the arabic script runs, thai for the thai script runs,
 * latn for the other ones (see getScriptRunShaper)
 * @param {Array} tags features tags list
 */
Bidi.prototype.registerFeatures = function (shaper, tags) {
    if (!Object.prototype.hasOwnProperty.call(this.featuresTags, shaper)) {
        this.featuresTags[shaper] = tags;
    } else {
        this.featuresTags[shaper] = this.featuresTags[shaper].concat(tags);
    }
};

/**
 * Apply GSUB features
 * @param {Font} font opentype font instance
 * @param {Array<{script: string, tags: string[]}>} features the feature tags of each shaper (see registerFeatures)
 * @param {Object} [layoutOptions]
 * @param {string} [layoutOptions.script] the OpenType script tag of the whole text, shaped as one script run, the
 * script runs of the Unicode script of the text if omitted (see getTokenScriptRuns)
 * @param {string} [layoutOptions.language] the OpenType language tag of the features, the default language system
 * of the script if omitted
 * @param {Object} [layoutOptions.variation] the variation coordinates of the GSUB feature variations, the current
 * variation of the font if omitted
 */
Bidi.prototype.applyFeatures = function (font, features, layoutOptions) {
    if (!font) throw new Error(
        'No valid font was provided to apply features'
    );
    const { script, language, variation } = layoutOptions || {};
    if (!this.query) {
        this.query = new FeatureQuery(font, variation);
    }
    this.script = script;
    this.language = language;
    for (const feature of features) {
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
 * Split the tokens of the text into its script runs, each one with its OpenType script tags: like HarfBuzz with the
 * script of a buffer, the whole text is one run with the script option if given, otherwise the runs of its Unicode
 * scripts (see getScriptRuns) take the tags of their script (see getOpenTypeScriptTags)
 * @returns {Array<{tokens: Token[], scriptTags: string[]}>}
 */
function getTokenScriptRuns() {
    const tokens = this.tokenizer.tokens;
    if (this.script) {
        return [{ tokens, scriptTags: [this.script] }];
    }
    return getScriptRuns(tokens.map(token => token.char)).map(({ start, end, script }) => ({
        tokens: tokens.slice(start, end),
        scriptTags: getOpenTypeScriptTags(script)
    }));
}

// the stages of the arabic features, like the Arabic shaper of HarfBuzz (collect_features_arabic): rvrn, then ccmp and
// locl, then each form in a stage of its own, in the order of HarfBuzz, then rlig, then calt (see
// getArabicStagesAfterForms), then the other features (liga, clig, mset, rclt...)
const ARABIC_STAGES_BEFORE_FORMS = [[REQUIRED_VARIATION_ALTERNATES_TAG], ['ccmp', 'locl']];
const ARABIC_FORM_TAGS = ['isol', 'fina', 'medi', 'init'];

/**
 * The stages of the arabic features after the forms, like collect_features_arabic of HarfBuzz: rlig, then calt in a
 * stage of its own, unless the language system of the run has rclt: calt then applies with the other features
 * (https://github.com/harfbuzz/harfbuzz/issues/1573). HarfBuzz also looks rclt up in GPOS, which has no such feature
 * @param {FeatureQuery} query
 * @param {string} script the script tag of the run in the GSUB table
 * @param {string|undefined} language the language tag of the features
 * @returns {string[][]}
 */
function getArabicStagesAfterForms(query, script, language) {
    if (query.getFeature({ tag: 'rclt', script, language })) {
        return [['rlig']];
    }
    return [['rlig'], ['calt']];
}

/**
 * Apply the enabled arabic features to an arabic script run, in the stages of the Arabic shaper of HarfBuzz: rvrn,
 * then ccmp and locl, then each presentation form of the letters of the run, then rlig, then calt, then the other
 * features (see getArabicStagesAfterForms), the lookups of the required feature of the language system in its stage
 * (see getRequiredFeatureStage), at every glyph of the run, merged with the lookups of the stage in lookup list order
 * @param {Token[]} tokens the tokens of the run
 * @param {string} script the script tag of the run in the GSUB table
 */
function applyArabicFeatures(tokens, script) {
    const tags = this.featuresTags.arab;
    const formStages = ARABIC_FORM_TAGS.map(tag => [tag]);
    const shaperStages = ARABIC_STAGES_BEFORE_FORMS.concat(formStages, getArabicStagesAfterForms(this.query, script, this.language));
    const stagedTags = shaperStages.flat();
    const stages = shaperStages
        .map(stageTags => tags.filter(tag => stageTags.includes(tag)))
        .concat([tags.filter(tag => !stagedTags.includes(tag))]);
    const firstFormStage = ARABIC_STAGES_BEFORE_FORMS.length;
    const requiredFeatureStage = getRequiredFeatureStage(stages, this.query.getRequiredFeature(script, this.language));
    for (let i = 0; i < stages.length; i++) {
        const isFormStage = i >= firstFormStage && i < firstFormStage + formStages.length;
        if (isFormStage) {
            // the required feature is in the stage of a form only when the form is enabled (see getRequiredFeatureStage)
            if (stages[i].length) {
                arabicPresentationForms.call(this, tokens, script, stages[i][0], i === requiredFeatureStage);
            }
        } else {
            applyFeaturesToTokens(this.query, stages[i], script, this.language, tokens, i === requiredFeatureStage);
        }
    }
}

/**
 * The shaper of the features of a script run, the key of its features in featuresTags, like HarfBuzz chooses its
 * shaper from the script of a buffer: arab for the arab script tag, thai for the thai script tag, latn for the other
 * script tags and for a text of no script
 * @param {string[]} scriptTags the OpenType script tags of the run (see getTokenScriptRuns)
 * @returns {string}
 */
function getScriptRunShaper(scriptTags) {
    if (scriptTags.includes('arab')) {
        return 'arab';
    }
    if (scriptTags.includes('thai')) {
        return 'thai';
    }
    return 'latn';
}

/**
 * Apply the enabled features of its shaper to a script run, with the script tag of the run that the GSUB table has
 * (see selectScriptTag) and the language of the features
 * @param {{tokens: Token[], scriptTags: string[]}} run
 */
function applyScriptRunFeatures(run) {
    const shaper = getScriptRunShaper(run.scriptTags);
    // a shaper with no registered features is skipped, an empty list of features still applies the required feature
    if (!this.featuresTags[shaper]) {
        return;
    }
    checkGlyphIndexStatus.call(this);
    const script = selectScriptTag(this.query.font.substitution, run.scriptTags);
    switch (shaper) {
        case 'arab':
            applyArabicFeatures.call(this, run.tokens, script);
            break;
        case 'thai':
            thaiFeatures.call(this, run.tokens, script);
            break;
        default:
            latinFeatures.call(this, run.tokens, script);
    }
}

function applyUnicodeVariationSequences() {
    const ranges = this.tokenizer.getContextRanges('unicodeVariationSequence');
    for(let i = 0; i < ranges.length; i++) {
        const range = ranges[i];
        unicodeVariationSequences.call(this, range);
    }
}

/**
 * Check if a context is registered
 * @param {string} contextId context id
 */
Bidi.prototype.checkContextReady = function (contextId) {
    return !!this.tokenizer.getContext(contextId);
};

/**
 * Apply the features to the script runs of the text, each run on its own like HarfBuzz, then lay the arabic sentences
 * out from right to left
 */
Bidi.prototype.applyFeaturesToContexts = function () {
    for (const run of this.scriptRuns) {
        applyScriptRunFeatures.call(this, run);
    }
    if (this.checkContextReady('arabicSentence')) {
        reverseArabicSentences.call(this);
    }
    if (this.checkContextReady('unicodeVariationSequence')) {
        applyUnicodeVariationSequences.call(this);
    }
};

/**
 * process text input
 * @param {string} text an input text
 */
Bidi.prototype.processText = function(text) {
    if (!this.text || this.text !== text) {
        this.setText(text);
        tokenizeText.call(this);
        this.scriptRuns = getTokenScriptRuns.call(this);
        this.tokenScriptRuns = new Map();
        for (const run of this.scriptRuns) {
            for (const token of run.tokens) {
                this.tokenScriptRuns.set(token, run);
            }
        }
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
 * The glyph indexes of a token that is not deleted in visual order: the order of its multiple substitution, reversed
 * for a token of a right-to-left run, whose tokens reverseArabicSentences reverses, like HarfBuzz reverses the glyphs of
 * a right-to-left run
 * @param {Token} token
 * @returns {number[]}
 */
function getTokenVisualGlyphIndexes(token) {
    const glyphIndexes = getTokenGlyphIndexes(token);
    return this.rightToLeftTokens.has(token) ? glyphIndexes.slice().reverse() : glyphIndexes;
}

/**
 * Get the glyph indexes of the text in visual order: each glyph of a multiple substitution its own (see
 * getTokenVisualGlyphIndexes), none for a deleted token
 * @param {string} text an input text
 * @returns {number[]}
 */
Bidi.prototype.getTextGlyphs = function (text) {
    this.processText(text);
    return this.tokenizer.tokens
        .filter(token => !token.state.deleted)
        .flatMap(token => getTokenVisualGlyphIndexes.call(this, token));
};

/**
 * Get each glyph of the text, with the range of the characters it represents (its cluster), like the
 * monotone clusters of HarfBuzz: a cluster ends where the next cluster of the text
 * starts, so the characters of the deleted tokens (e.g. ligature components, variation selectors) belong to
 * the cluster before them in the text (the first cluster for the ones before it). The glyphs of a multiple
 * substitution have the cluster of their token, a ligature merges the clusters of its components and of the
 * glyphs between them.
 * @param {string} text an input text
 * @returns {Array<{index: number, start: number, end: number, rightToLeft: boolean, scriptRun: Object}>}
 * glyph indexes in visual order (see getTextGlyphs), with the UTF-16 range [start, end) of their characters in the
 * text, whether their run is laid out from right to left (the arabic sentences, in reverse order of the text), and the
 * script run of their token, with its OpenType script tags (scriptRun.scriptTags, see getTokenScriptRuns)
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
        const scriptRun = this.tokenScriptRuns.get(token);
        for (const index of getTokenVisualGlyphIndexes.call(this, token)) {
            clusters.push({ index, start, end, rightToLeft, scriptRun });
        }
    }
    return clusters;
};

export default Bidi;
