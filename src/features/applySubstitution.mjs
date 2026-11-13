import { ContextParams } from '../tokenizer.mjs';
import { SubstitutionAction, getSubstitutionGlyphEdits } from './featureQuery.mjs';
import {
    getLayoutGdefTable, getGdefGlyphClass, getLigatureId, getLigatureComponent, BASE_GLYPH_CLASS, LIGATURE_GLYPH_CLASS,
    MARK_GLYPH_CLASS
} from '../layout.mjs';

/**
 * The glyph indexes of a token that is not deleted: its glyph, or the glyphs of the multiple substitutions that replaced it
 * @param {Token} token
 * @returns {number[]}
 */
function getTokenGlyphIndexes(token) {
    const value = token.activeState.value;
    return Array.isArray(value) ? value : [value];
}

/**
 * The ligature properties of each glyph of a token (see LigatureProperties in layout.mjs), in the order of its glyphs
 * (see getTokenGlyphIndexes), which the ligature substitutions set and replaceGlyph keeps with the glyphs
 * @param {Token} token
 * @returns {Array<LigatureProperties|undefined>}
 */
function getTokenLigatureProperties(token) {
    return token.ligatureProperties || [];
}

/**
 * The glyphs of a list of tokens, like the glyph buffer of HarfBuzz: each glyph of a multiple substitution
 * is a glyph of its own, a deleted token has none. applySubstitution updates the sequence with its tokens.
 * @typedef GlyphSequence
 * @type Object
 * @property {number[]} glyphIndexes glyph indexes, in the order of the tokens
 * @property {Token[]} glyphTokens the token of each glyph
 * @property {Object|undefined} gdef the GDEF table of the layout, whose glyph classes the ligature substitutions read
 */

/**
 * Get the glyph sequence of a list of tokens
 * @param {Token[]} tokens
 * @param {Object} [gdef] the GDEF table of the layout (see getLayoutGdefTable)
 * @returns {GlyphSequence}
 */
function getGlyphSequence(tokens, gdef) {
    const glyphSequence = { glyphIndexes: [], glyphTokens: [], gdef };
    for (const token of tokens) {
        if (token.state.deleted) {
            continue;
        }
        for (const glyphIndex of getTokenGlyphIndexes(token)) {
            glyphSequence.glyphIndexes.push(glyphIndex);
            glyphSequence.glyphTokens.push(token);
        }
    }
    return glyphSequence;
}

/**
 * The position of a glyph of a glyph sequence among the glyphs of its token
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number}
 */
function getPositionInToken(glyphSequence, position) {
    const token = glyphSequence.glyphTokens[position];
    let tokenFirstPosition = position;
    while (tokenFirstPosition > 0 && glyphSequence.glyphTokens[tokenFirstPosition - 1] === token) {
        tokenFirstPosition--;
    }
    return position - tokenFirstPosition;
}

/**
 * The ligature properties of a glyph of a glyph sequence (see getTokenLigatureProperties)
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {LigatureProperties|undefined}
 */
function getGlyphLigatureProperties(glyphSequence, position) {
    return getTokenLigatureProperties(glyphSequence.glyphTokens[position])[getPositionInToken(glyphSequence, position)];
}

/**
 * Set the ligature properties of a glyph of a glyph sequence in its token (see getTokenLigatureProperties)
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @param {LigatureProperties} ligatureProperties
 */
function setGlyphLigatureProperties(glyphSequence, position, ligatureProperties) {
    const token = glyphSequence.glyphTokens[position];
    if (!token.ligatureProperties) {
        token.ligatureProperties = getTokenGlyphIndexes(token).map(() => undefined);
    }
    token.ligatureProperties[getPositionInToken(glyphSequence, position)] = ligatureProperties;
}

/**
 * The ligature properties of the glyphs that replace a glyph, like the lig_props of HarfBuzz: each one keeps the
 * properties of the glyph, but the glyphs of a multiple substitution (two or more glyphs) of a glyph of no ligature
 * are numbered as the components of no ligature (Sequence::apply, _hb_glyph_info_set_lig_props_for_component), the
 * component a later ligature that skips one of them gives it (see getFollowingGlyphLigatureProperties)
 * @param {LigatureProperties|undefined} ligatureProperties the ligature properties of the glyph
 * @param {number} glyphCount the number of glyphs that replace it
 * @returns {Array<LigatureProperties|undefined>}
 */
function getReplacementLigatureProperties(ligatureProperties, glyphCount) {
    if (glyphCount < 2 || getLigatureId(ligatureProperties)) {
        return Array(glyphCount).fill(ligatureProperties);
    }
    const componentProperties = [undefined];
    for (let i = 1; i < glyphCount; i++) {
        componentProperties.push({ ligatureId: undefined, ligatureComponent: i });
    }
    return componentProperties;
}

/**
 * Replace the glyph at a position of a glyph sequence with a sequence of glyphs, in the glyph sequence and in its token:
 * the token holds one glyph, several glyphs, or none and is deleted. The glyphs that replace it take their ligature
 * properties from it (see getReplacementLigatureProperties).
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @param {number[]} glyphIndexes the glyphs that replace the glyph, none deletes it
 * @param {string} tag feature tag set as the state of the token
 */
function replaceGlyph(glyphSequence, position, glyphIndexes, tag) {
    const token = glyphSequence.glyphTokens[position];
    const positionInToken = getPositionInToken(glyphSequence, position);
    const tokenGlyphIndexes = getTokenGlyphIndexes(token).slice();
    tokenGlyphIndexes.splice(positionInToken, 1, ...glyphIndexes);
    const replacementProperties = getReplacementLigatureProperties(
        getGlyphLigatureProperties(glyphSequence, position), glyphIndexes.length
    );
    if (token.ligatureProperties || replacementProperties.some(Boolean)) {
        token.ligatureProperties = token.ligatureProperties || getTokenGlyphIndexes(token).map(() => undefined);
        token.ligatureProperties.splice(positionInToken, 1, ...replacementProperties);
    }
    if (!tokenGlyphIndexes.length) {
        token.setState('deleted', true);
    } else {
        token.setState(tag, tokenGlyphIndexes.length === 1 ? tokenGlyphIndexes[0] : tokenGlyphIndexes);
    }
    glyphSequence.glyphIndexes.splice(position, 1, ...glyphIndexes);
    glyphSequence.glyphTokens.splice(position, 1, ...glyphIndexes.map(() => token));
}

/**
 * Replace the glyphs of a single, multiple or ligature substitution (see getSubstitutionGlyphEdits)
 * @param {SubstitutionAction} action
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 */
function replaceSubstitutedGlyphs(action, glyphSequence, position) {
    for (const glyphEdit of getSubstitutionGlyphEdits(action)) {
        replaceGlyph(glyphSequence, position + glyphEdit.offset, glyphEdit.glyphIndexes, action.tag);
    }
}

/**
 * Apply single substitution format 1 and 2
 * @param {SubstitutionAction} action
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number} the number of glyphs that replaced the glyph at the position
 */
function singleSubstitution(action, glyphSequence, position) {
    replaceSubstitutedGlyphs(action, glyphSequence, position);
    return 1;
}

/**
 * Apply contextual substitutions (context and chaining context, all formats): the substitutions of their nested
 * lookups (single, multiple, ligature), in order, each one at its glyph and like the substitution of its type at the
 * top level, with the feature tag of the contextual lookup
 * @param {SubstitutionAction} action its substitution is a ContextualMatch (see FeatureQuery)
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number} the number of glyphs from the glyph at the position to the last input glyph, after the
 * substitutions: like HarfBuzz, the lookup goes on after the input of the rule, which never ends before the glyph a
 * nested lookup applied at, so after a nested ligature that takes glyphs past the input it goes on at the ligature glyph
 */
function contextualSubstitution(action, glyphSequence, position) {
    for (const { offset, id, substitution } of action.substitution.substitutions) {
        applySubstitution(new SubstitutionAction({ id, tag: action.tag, substitution }), glyphSequence, position + offset);
    }
    return action.substitution.inputLength;
}

/**
 * Apply multiple substitution format 1: the glyph becomes a sequence of glyphs, each one a glyph of its own
 * for the following lookups, an empty sequence deletes it
 * @param {SubstitutionAction} action
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number} the number of glyphs that replaced the glyph at the position
 */
function multipleSubstitutionFormat1(action, glyphSequence, position) {
    replaceSubstitutedGlyphs(action, glyphSequence, position);
    return action.substitution.length;
}

/**
 * Merge the clusters of the glyphs of a range of a glyph sequence, like HarfBuzz (merge_clusters): every token
 * of the sequence in one of their clusters takes the smallest one, so that the whole clusters are merged. The clusters
 * are monotone while GSUB applies (in the logical order of the text, before the right-to-left runs are reversed), so the
 * smallest cluster is the one of the first glyph of the range, and the range only extends forward, to the glyphs after
 * it that share its last cluster (e.g. the other glyphs of a multiple substitution)
 * @param {GlyphSequence} glyphSequence
 * @param {number} startPosition
 * @param {number} endPosition the position after the last glyph of the range
 */
function mergeClusters(glyphSequence, startPosition, endPosition) {
    const glyphTokens = glyphSequence.glyphTokens;
    const clusters = new Set(glyphTokens.slice(startPosition, endPosition).map(token => token.cluster));
    const mergedCluster = Math.min(...clusters);
    let lastPosition = endPosition;
    while (lastPosition < glyphTokens.length && clusters.has(glyphTokens[lastPosition].cluster)) {
        lastPosition++;
    }
    for (let position = startPosition; position < lastPosition; position++) {
        glyphTokens[position].cluster = mergedCluster;
    }
}

/**
 * The number of components that a glyph brings to a ligature, like _hb_glyph_info_get_lig_num_comps of HarfBuzz: the
 * components of a ligature that a ligature substitution formed (see LigatureProperties) when GDEF has it in the
 * ligature class (a font without the GlyphClassDef of GDEF has the class of the substitution, a ligature), 1 otherwise
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number}
 */
function getLigatureComponentCount(glyphSequence, position) {
    const ligatureProperties = getGlyphLigatureProperties(glyphSequence, position);
    const componentCount = ligatureProperties && ligatureProperties.ligatureComponentCount;
    const gdef = glyphSequence.gdef;
    const isLigatureGlyph = !gdef || !gdef.classDef ||
        getGdefGlyphClass(gdef, glyphSequence.glyphIndexes[position]) === LIGATURE_GLYPH_CLASS;
    return componentCount && isLigatureGlyph ? componentCount : 1;
}

/**
 * The ligature properties of a glyph after a component of a ligature, like ligate_input of HarfBuzz: the component of
 * the ligature that the glyph follows, among the components counted so far, the last component counted its own
 * components when it is a ligature; the glyph takes the component it followed in that ligature (the last one when it
 * followed none)
 * @param {symbol|undefined} ligatureId the ligatureId of the ligature
 * @param {LigatureProperties|undefined} glyphProperties the ligature properties of the glyph
 * @param {number} componentsSoFar the number of components of the ligature up to the one the glyph follows
 * @param {number} lastComponentCount the number of components of the component the glyph follows
 * @returns {LigatureProperties}
 */
function getFollowingGlyphLigatureProperties(ligatureId, glyphProperties, componentsSoFar, lastComponentCount) {
    const component = getLigatureComponent(glyphProperties) || lastComponentCount;
    return { ligatureId, ligatureComponent: componentsSoFar - lastComponentCount + Math.min(component, lastComponentCount) };
}

/**
 * Set the ligature properties of the glyphs of a ligature substitution before it replaces its components, like
 * ligate_input of HarfBuzz: unless the components are a base glyph and marks or marks only (GDEF classes), the
 * ligature (its first component) gets a new ligatureId and its number of components, each component that is a
 * ligature counting its own components (see getLigatureComponentCount), and each glyph the substitution skipped the
 * component it follows (see getFollowingGlyphLigatureProperties); unless the components are marks only, the glyphs
 * after the last component that follow one of its components, when it is a ligature, take their component of the new
 * ligature
 * @param {GlyphSequence} glyphSequence
 * @param {number[]} componentPositions the positions of the components in the glyph sequence, the first one first
 */
function setLigatureSubstitutionProperties(glyphSequence, componentPositions) {
    const componentClasses = componentPositions.map(position => getGdefGlyphClass(glyphSequence.gdef, glyphSequence.glyphIndexes[position]));
    const areOtherComponentsMarks = componentClasses.slice(1).every(glyphClass => glyphClass === MARK_GLYPH_CLASS);
    const isMarkLigature = areOtherComponentsMarks && componentClasses[0] === MARK_GLYPH_CLASS;
    const isLigature = !isMarkLigature && !(areOtherComponentsMarks && componentClasses[0] === BASE_GLYPH_CLASS);
    const componentCounts = componentPositions.map(position => getLigatureComponentCount(glyphSequence, position));
    const lastIndex = componentPositions.length - 1;
    const lastComponentLigatureId = getLigatureId(getGlyphLigatureProperties(glyphSequence, componentPositions[lastIndex]));
    const ligatureId = isLigature ? Symbol('ligature') : undefined;
    if (isLigature) {
        const ligatureComponentCount = componentCounts.reduce((count, componentCount) => count + componentCount, 0);
        setGlyphLigatureProperties(glyphSequence, componentPositions[0], { ligatureId, ligatureComponentCount });
    }
    let componentsSoFar = componentCounts[0];
    for (let i = 1; i <= lastIndex; i++) {
        if (isLigature) {
            for (let position = componentPositions[i - 1] + 1; position < componentPositions[i]; position++) {
                setGlyphLigatureProperties(glyphSequence, position, getFollowingGlyphLigatureProperties(
                    ligatureId, getGlyphLigatureProperties(glyphSequence, position), componentsSoFar, componentCounts[i - 1]
                ));
            }
        }
        componentsSoFar += componentCounts[i];
    }
    if (isMarkLigature || !lastComponentLigatureId) {
        return;
    }
    for (let position = componentPositions[lastIndex] + 1; position < glyphSequence.glyphIndexes.length; position++) {
        const glyphProperties = getGlyphLigatureProperties(glyphSequence, position);
        if (getLigatureId(glyphProperties) !== lastComponentLigatureId || !getLigatureComponent(glyphProperties)) {
            break;
        }
        setGlyphLigatureProperties(glyphSequence, position, getFollowingGlyphLigatureProperties(
            ligatureId, glyphProperties, componentsSoFar, componentCounts[lastIndex]
        ));
    }
}

/**
 * Apply ligature substitution format 1: the first component becomes the ligature glyph and the
 * other components are deleted, the glyphs the lookup skipped between them stay after the ligature,
 * in one cluster with it, with the component of the ligature they follow (see setLigatureSubstitutionProperties)
 * @param {SubstitutionAction} action
 * @param {GlyphSequence} glyphSequence
 * @param {number} position
 * @returns {number} the number of glyphs that replaced the glyph at the position
 */
function ligatureSubstitutionFormat1(action, glyphSequence, position) {
    const componentOffsets = action.substitution.componentOffsets;
    if (componentOffsets.length) {
        mergeClusters(glyphSequence, position, position + componentOffsets[componentOffsets.length - 1] + 1);
    }
    setLigatureSubstitutionProperties(glyphSequence, [position].concat(componentOffsets.map(offset => position + offset)));
    replaceSubstitutedGlyphs(action, glyphSequence, position);
    return 1;
}

/**
 * Supported substitutions
 */
const SUBSTITUTIONS = {
    11: singleSubstitution,
    12: singleSubstitution,
    21: multipleSubstitutionFormat1,
    41: ligatureSubstitutionFormat1,
    51: contextualSubstitution,
    52: contextualSubstitution,
    53: contextualSubstitution,
    61: contextualSubstitution,
    62: contextualSubstitution,
    63: contextualSubstitution
};

/**
 * Apply a substitution at a glyph of a glyph sequence, to the sequence and to its tokens
 * @param {SubstitutionAction|any} action the substitution, anything else substitutes nothing
 * @param {GlyphSequence} glyphSequence
 * @param {number} position the position of the current glyph of the substitution
 * @returns {number} the number of glyphs a lookup goes on after, from the current one: the glyphs that replaced
 * it (0 when deleted, 1 when nothing is substituted), or for a contextual rule its inputLength (see ContextualMatch
 * in featureQuery.mjs)
 */
function applySubstitution(action, glyphSequence, position) {
    if (action instanceof SubstitutionAction && SUBSTITUTIONS[action.id]) {
        return SUBSTITUTIONS[action.id](action, glyphSequence, position);
    }
    return 1;
}

/**
 * Get the coverage tables of the first glyph of the subtables of a lookup, or null
 * when a subtable has none (the lookup is then tried at every glyph)
 * @param {any} lookupTable
 * @returns {any[]|null}
 */
function getLookupFirstGlyphCoverages(lookupTable) {
    const coverages = [];
    for (let i = 0; i < lookupTable.subtables.length; i++) {
        const subtable = lookupTable.lookupType === 7 ? lookupTable.subtables[i].extension : lookupTable.subtables[i];
        const coverage = subtable && (subtable.coverage ||
            (subtable.inputCoverage && subtable.inputCoverage[0]) ||
            (subtable.coverages && subtable.coverages[0]));
        if (!coverage) {
            return null;
        }
        coverages.push(coverage);
    }
    return coverages;
}

/**
 * Apply a lookup (see FeatureQuery.lookupSubstitution) at each glyph of a list of tokens, from the first one: the glyphs
 * deleted by a ligature are not part of the context any more, each glyph of a multiple substitution is a glyph of its
 * own, and like HarfBuzz the lookup goes on after the glyphs that replaced a glyph, or after the input glyphs of a
 * contextual rule that matched (see applySubstitution)
 * @param {FeatureQuery} query
 * @param {any} lookupTable
 * @param {string} tag feature tag set as the state of the substituted tokens
 * @param {Token[]} tokens
 * @param {function(Token): boolean} [isTokenEnabled] whether a rule or a ligature of the lookup can start at the glyphs
 * of a token (e.g. the arabic form of the token), at every glyph if omitted; unlike the feature mask of HarfBuzz, the
 * later input glyphs of a rule and the components of a ligature are matched whatever their token
 */
function applyLookupToTokens(query, lookupTable, tag, tokens, isTokenEnabled = () => true) {
    const layout = query.font.substitution;
    const coverages = getLookupFirstGlyphCoverages(lookupTable);
    // a glyph no subtable covers cannot start a substitution: skip it without building its context
    const isCovered = glyphIndex => {
        if (!coverages) {
            return true;
        }
        return coverages.some(coverage => layout.getCoverageIndex(coverage, glyphIndex) >= 0);
    };
    // applySubstitution updates the glyphs of the sequence, the context of the lookup
    const glyphSequence = getGlyphSequence(tokens, getLayoutGdefTable(query.font));
    const contextParams = new ContextParams(glyphSequence.glyphIndexes, 0);
    for (let position = 0; position < glyphSequence.glyphIndexes.length; position++) {
        if (!isTokenEnabled(glyphSequence.glyphTokens[position]) || !isCovered(glyphSequence.glyphIndexes[position])) {
            continue;
        }
        contextParams.setCurrentIndex(position);
        const action = query.lookupSubstitution(lookupTable, contextParams, tag);
        if (action) {
            position += applySubstitution(action, glyphSequence, position) - 1;
        }
    }
}

/**
 * Get the lookups of features in lookup list order, like HarfBuzz: each lookup once, with the tag of the (first)
 * feature it belongs to, without the indexes past the lookup list
 * @param {FeatureQuery} query
 * @param {string[]} tags feature tags
 * @param {string} script script tag
 * @param {string} [language] language tag, the default language system of the script if omitted
 * @param {boolean} [withRequiredFeature=false] whether to add the lookups of the required feature of the language system
 * (see FeatureQuery.getRequiredFeature), whatever its tag
 * @returns {Array<{lookupTable: any, tag: string, isRequiredFeatureLookup: boolean}>} isRequiredFeatureLookup: whether the
 * required feature has the lookup, which then applies at every glyph like the global mask that HarfBuzz gives it
 */
function getFeaturesLookups(query, tags, script, language, withRequiredFeature = false) {
    const features = tags.map(tag => ({ tag, feature: query.getFeature({ tag, script, language }), isRequired: false }));
    const requiredFeature = withRequiredFeature && query.getRequiredFeature(script, language);
    if (requiredFeature) {
        features.push({ tag: requiredFeature.tag, feature: requiredFeature.feature, isRequired: true });
    }
    // the tag of the first feature of each lookup, and whether the required feature has it
    const lookupOrigins = new Map();
    for (const { tag, feature, isRequired } of features) {
        if (!feature || !feature.lookupListIndexes) {
            continue;
        }
        for (const lookupIndex of feature.lookupListIndexes) {
            const lookupOrigin = lookupOrigins.get(lookupIndex) || { tag, isRequiredFeatureLookup: false };
            lookupOrigin.isRequiredFeatureLookup = lookupOrigin.isRequiredFeatureLookup || isRequired;
            lookupOrigins.set(lookupIndex, lookupOrigin);
        }
    }
    const lookupIndexes = Array.from(lookupOrigins.keys()).sort((indexA, indexB) => indexA - indexB);
    const lookups = [];
    for (const lookupIndex of lookupIndexes) {
        const lookupTable = query.getLookupByIndex(lookupIndex);
        if (lookupTable) {
            const { tag, isRequiredFeatureLookup } = lookupOrigins.get(lookupIndex);
            lookups.push({ lookupTable, tag, isRequiredFeatureLookup });
        }
    }
    return lookups;
}

/**
 * Apply the lookups of features to a list of tokens like HarfBuzz: in lookup list order, each one once and at every
 * glyph (see applyLookupToTokens), with the tag of its first feature, so that a lookup sees the glyphs the previous ones
 * substituted, and not feature by feature
 * @param {FeatureQuery} query
 * @param {string[]} tags feature tags
 * @param {string} script script tag
 * @param {string|undefined} language language tag, the default language system of the script if undefined
 * @param {Token[]} tokens
 * @param {boolean} [withRequiredFeature=false] whether to add the lookups of the required feature of the language system
 * (see getRequiredFeatureStage)
 */
function applyFeaturesToTokens(query, tags, script, language, tokens, withRequiredFeature = false) {
    for (const { lookupTable, tag } of getFeaturesLookups(query, tags, script, language, withRequiredFeature)) {
        applyLookupToTokens(query, lookupTable, tag, tokens);
    }
}

/**
 * The stage whose lookups the lookups of the required feature of a language system join, like HarfBuzz
 * (hb_ot_map_builder_t::compile): the stage of its tag when a stage has its tag, otherwise the first stage
 * @param {string[][]} stages the enabled feature tags of each stage, in the order of the stages
 * @param {{tag: string}|null} requiredFeature see FeatureQuery.getRequiredFeature
 * @returns {number} the index of the stage, -1 without a required feature
 */
function getRequiredFeatureStage(stages, requiredFeature) {
    if (!requiredFeature) {
        return -1;
    }
    return Math.max(stages.findIndex(stageTags => stageTags.includes(requiredFeature.tag)), 0);
}

// the feature whose lookups HarfBuzz applies before the lookups of all the other features, in a stage of its own
// (hb_ot_shape_collect_features): the required variation alternates
const REQUIRED_VARIATION_ALTERNATES_TAG = 'rvrn';

/**
 * Apply features to a run of text in the stages of the shapers of HarfBuzz that add no stage of their own (the
 * default shaper, the Thai shaper): the lookups of rvrn first, then the lookups of the other features together
 * (see applyFeaturesToTokens), the lookups of the required feature of the language system in its stage (see
 * getRequiredFeatureStage)
 * @param {FeatureQuery} query
 * @param {string[]} tags feature tags
 * @param {string} script script tag
 * @param {string|undefined} language language tag, the default language system of the script if undefined
 * @param {Token[]} tokens
 */
function applyFeatureStagesToTokens(query, tags, script, language, tokens) {
    const stages = [
        tags.filter(tag => tag === REQUIRED_VARIATION_ALTERNATES_TAG),
        tags.filter(tag => tag !== REQUIRED_VARIATION_ALTERNATES_TAG)
    ];
    const requiredFeatureStage = getRequiredFeatureStage(stages, query.getRequiredFeature(script, language));
    for (let i = 0; i < stages.length; i++) {
        applyFeaturesToTokens(query, stages[i], script, language, tokens, i === requiredFeatureStage);
    }
}

export default applySubstitution;
export {
    getTokenGlyphIndexes,
    getTokenLigatureProperties,
    getGlyphSequence,
    applyLookupToTokens,
    getFeaturesLookups,
    applyFeaturesToTokens,
    getRequiredFeatureStage,
    applyFeatureStagesToTokens,
    REQUIRED_VARIATION_ALTERNATES_TAG
};
