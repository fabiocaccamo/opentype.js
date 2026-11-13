import { getPath, transformPoints } from './tables/glyf.mjs';
import { copyPoint, copyComponent, getGlyphVariationPointCount, getTuplePointNumbers } from './util.mjs';
import Glyph from './glyph.mjs';

// 1 in the 16.16 fixed-point format of the normalization of the OpenType coordinates
const FIXED_ONE = 65536;

/**
 * Converts a number to the 16.16 fixed-point format, rounded half up.
 * @param {number} value
 * @returns {number} The integer value of the 16.16 number.
 */
function toFixed16Dot16(value) {
    return Math.round(value * FIXED_ONE);
}

/**
 * Default normalization of a user coordinate of an axis to -1..0..1 in 16.16, steps 1 to 3
 * of the OpenType precision and rounding requirements (Coordinate scales and normalization):
 * the user coordinate in 16.16, clamped to the range of the axis, then normalized.
 * @param {number} userValue
 * @param {Object} axis - fvar axis: minValue, defaultValue, maxValue
 * @returns {number} The integer value of the 16.16 normalized coordinate.
 */
function normalizeAxisValue(userValue, axis) {
    const value = Math.min(Math.max(toFixed16Dot16(userValue) / FIXED_ONE, axis.minValue), axis.maxValue);
    if (value < axis.defaultValue) {
        return toFixed16Dot16((value - axis.defaultValue) / (axis.defaultValue - axis.minValue));
    }
    if (value > axis.defaultValue) {
        return toFixed16Dot16((value - axis.defaultValue) / (axis.maxValue - axis.defaultValue));
    }
    return 0;
}

/**
 * Maps a 16.16 normalized coordinate through the segment map of its axis in the avar table,
 * in 16.16 (step 4 of the OpenType precision and rounding requirements). A value out of the
 * map moves with its first or last segment, and the result is not clamped, like HarfBuzz and
 * fontTools varLib.models.piecewiseLinearMap: a map lacking -1 or 1 is out of the spec.
 * @param {number} value - The integer value of the 16.16 normalized coordinate.
 * @param {Array<{fromCoordinate: number, toCoordinate: number}>} axisValueMaps - sorted by fromCoordinate
 * @returns {number} The integer value of the 16.16 mapped coordinate.
 */
function mapAxisSegment(value, axisValueMaps) {
    if (!axisValueMaps.length) {
        return value;
    }
    const first = axisValueMaps[0];
    const last = axisValueMaps[axisValueMaps.length - 1];
    if (value <= toFixed16Dot16(first.fromCoordinate)) {
        return value + toFixed16Dot16(first.toCoordinate) - toFixed16Dot16(first.fromCoordinate);
    }
    if (value >= toFixed16Dot16(last.fromCoordinate)) {
        return value + toFixed16Dot16(last.toCoordinate) - toFixed16Dot16(last.fromCoordinate);
    }
    const endIndex = axisValueMaps.findIndex(map => toFixed16Dot16(map.fromCoordinate) >= value);
    const startFrom = toFixed16Dot16(axisValueMaps[endIndex - 1].fromCoordinate);
    const startTo = toFixed16Dot16(axisValueMaps[endIndex - 1].toCoordinate);
    const endFrom = toFixed16Dot16(axisValueMaps[endIndex].fromCoordinate);
    const endTo = toFixed16Dot16(axisValueMaps[endIndex].toCoordinate);
    return Math.round(startTo + (endTo - startTo) * (value - startFrom) / (endFrom - startFrom));
}

/**
 * Converts a 16.16 normalized coordinate to F2Dot14 like step 5 of the OpenType precision and
 * rounding requirements: add 2, then an arithmetic shift right by 2.
 * @param {number} value - The integer value of the 16.16 normalized coordinate.
 * @returns {number} The normalized coordinate, a multiple of 1/16384.
 */
function fixedToF2Dot14(value) {
    return ((value + 2) >> 2) / 16384;
}

/**
 * Scalar of one axis of a tuple or of a region at a normalized coordinate, like fontTools
 * varLib.models.supportScalar: 1 when the axis does not take part (peak 0, invalid range,
 * a range across 0), 0 out of the range, linear between start, peak and end.
 * @param {number} coordinate
 * @param {number} start
 * @param {number} peak
 * @param {number} end
 * @returns {number}
 */
function getAxisScalar(coordinate, start, peak, end) {
    if (peak === 0 || start > peak || peak > end || (start < 0 && end > 0) || coordinate === peak) {
        return 1;
    }
    if (coordinate <= start || coordinate >= end) {
        return 0;
    }
    if (coordinate < peak) {
        return (coordinate - start) / (peak - start);
    }
    return (end - coordinate) / (end - peak);
}

/**
 * Copy of a glyph of the font with its varied outline. The code points are assigned after
 * the constructor, whose check is for new glyphs: the glyph of U+0000 of a font can have
 * any name, not only .null.
 * @param {Glyph} glyph
 * @param {Object} properties - path, points...
 * @returns {Glyph}
 */
function copyGlyph(glyph, properties) {
    const copy = new Glyph(Object.assign({}, glyph, properties, { unicode: undefined, unicodes: undefined }));
    copy.unicode = glyph.unicode;
    copy.unicodes = glyph.unicodes;
    return copy;
}

/**
 * Part of the code of this class was based on
 * https://github.com/foliojs/fontkit/blob/a5fe0a1834241dbc6eb02beea3b7414c118c5ac9/src/glyph/GlyphVariationProcessor.js
 * Copyright (c) 2014 Devon Govett
 * MIT License
 */

export class VariationProcessor {
    constructor(font) {
        this.font = font;
    }

    /**
     * Modifies a coords object to make sure that tags have a length of 4
     * @param {Object} coords - variation coordinates
     */
    normalizeCoordTags(coords) {
        for (const tag in coords) {
            if(tag.length < 4) {
                const padded = tag.padEnd(4, ' ');
                coords[padded] === undefined && (coords[padded] = coords[tag]);
                delete coords[tag];
            }
        }
    }

    /**
     * Normalizes the coordinates from the axis ranges to a range of -1 to 1 with the precision
     * and rounding requirements of OpenType (Coordinate scales and normalization), steps 1 to 5
     * on the user value as given: each value is converted to 16.16, clamped to the range of its
     * axis, normalized in 16.16, mapped through the avar table in 16.16 and converted once to
     * F2Dot14. Like HarfBuzz, the avar result is not clamped to -1..1 and a map lacking its -1, 0
     * or 1 entry is applied all the same (the spec clamps, and leaves such an axis unmapped): only
     * a malformed map gives a value out of -1..1. HarfBuzz also normalizes in 16.16 and converts
     * once to F2Dot14, but it reads the user value as a 32-bit float, so at some user values the
     * two differ by 1/16384.
     * @param {Object} coords - The coordinates object to normalize.
     * @returns {Array<number>} The normalized coordinates, in the order of the fvar axes
     */
    getNormalizedCoords(coords) {
        if(!coords) {
            coords = this.font.variation.get();
        }
        this.normalizeCoordTags(coords);
        const avar = this.avar();
        return this.fvar().axes.map((axis, axisIndex) => {
            const userValue = coords[axis.tag] === undefined ? axis.defaultValue : coords[axis.tag];
            let normalized = normalizeAxisValue(userValue, axis);
            const segmentMap = avar && avar.axisSegmentMaps[axisIndex];
            if (segmentMap) {
                normalized = mapAxisSegment(normalized, segmentMap.axisValueMaps);
            }
            return fixedToF2Dot14(normalized);
        });
    }

    /**
     * Interpolates points within a glyph if deltas are not provided for all points.
     * @param {Array<Object>} points - The points to be interpolated.
     * @param {Array<Object>} glyphPoints - Reference points from the glyph.
     * @param {Object} deltaMap - A map indicating which points have deltas.
     */
    interpolatePoints(points, glyphPoints, deltaMap) {
        if (points.length === 0) {
            return;
        }
    
        let pointIndex = 0;
        while (pointIndex < points.length) {
            let firstPoint = pointIndex;
    
            // find the end point of the contour
            let endPoint = pointIndex;
            let point = points[endPoint];
            while (!point.lastPointOfContour) {
                point = points[++endPoint];
            }
    
            // find the first point that has a delta
            while (pointIndex <= endPoint && !deltaMap[pointIndex]) {
                pointIndex++;
            }
    
            if (pointIndex > endPoint) {
                continue;
            }
    
            let firstDelta = pointIndex;
            let curDelta = pointIndex;
            pointIndex++;
    
            while (pointIndex <= endPoint) {
                // find the next point with a delta, and interpolate intermediate points
                if (deltaMap[pointIndex]) {
                    this.deltaInterpolate(curDelta + 1, pointIndex - 1, curDelta, pointIndex, glyphPoints, points);
                    curDelta = pointIndex;
                }
        
                pointIndex++;
            }
    
            // shift contour if we only have a single delta
            if (curDelta === firstDelta) {
                this.deltaShift(firstPoint, endPoint, curDelta, glyphPoints, points);
            } else {
                // otherwise, handle the remaining points at the end and beginning of the contour
                this.deltaInterpolate(curDelta + 1, endPoint, curDelta, firstDelta, glyphPoints, points);
        
                if (firstDelta > 0) {
                    this.deltaInterpolate(firstPoint, firstDelta - 1, curDelta, firstDelta, glyphPoints, points);
                }
            }
    
            pointIndex = endPoint + 1;
        }
    }

    /**
     * Interpolates delta values between two points.
     * @param {number} p1 - Start point index for interpolation.
     * @param {number} p2 - End point index for interpolation.
     * @param {number} ref1 - Reference point index for the start delta.
     * @param {number} ref2 - Reference point index for the end delta.
     * @param {Array<Object>} glyphPoints - Reference points from the glyph.
     * @param {Array<Object>} points - The points to be adjusted.
     */
    deltaInterpolate(p1, p2, ref1, ref2, glyphPoints, points) {
        if (p1 > p2) {
            return;
        }

        let iterable = ['x', 'y'];
        for (let i = 0; i < iterable.length; i++) {
            let k = iterable[i];
            // swap per axis: swapping ref1/ref2 in place would leak the x order into y
            let r1 = ref1;
            let r2 = ref2;
            if (glyphPoints[r1][k] > glyphPoints[r2][k]) {
                r1 = ref2;
                r2 = ref1;
            }

            let in1 = glyphPoints[r1][k];
            let in2 = glyphPoints[r2][k];
            let out1 = points[r1][k];
            let out2 = points[r2][k];

            // If the reference points have the same coordinate but different
            // delta, inferred delta is zero.  Otherwise interpolate.
            if (in1 !== in2 || out1 === out2) {
                let scale = in1 === in2 ? 0 : (out2 - out1) / (in2 - in1);

                for (let p = p1; p <= p2; p++) {
                    let out = glyphPoints[p][k];

                    if (out <= in1) {
                        out += out1 - in1;
                    } else if (out >= in2) {
                        out += out2 - in2;
                    } else {
                        out = out1 + (out - in1) * scale;
                    }

                    points[p][k] = out;
                }
            }
        }
    }

    /**
     * Applies a delta shift to a range of points based on a reference point.
     * @param {number} p1 - Start point index for shifting.
     * @param {number} p2 - End point index for shifting.
     * @param {number} ref - Reference point index.
     * @param {Array<Object>} glyphPoints - Reference points from the glyph.
     * @param {Array<Object>} points - The points to be shifted.
     */
    deltaShift(p1, p2, ref, glyphPoints, points) {
        let deltaX = points[ref].x - glyphPoints[ref].x;
        let deltaY = points[ref].y - glyphPoints[ref].y;

        if (deltaX === 0 && deltaY === 0) {
            return;
        }

        for (let p = p1; p <= p2; p++) {
            if (p !== ref) {
                points[p].x += deltaX;
                points[p].y += deltaY;
            }
        }
    }

    /**
     * Adds the scaled deltas of a tuple to the accumulated deltas of the points it lists
     * (of the components of a composite glyph, of the values of the cvt table), the other
     * points keep theirs. The deltas of the phantom points are left to getPhantomPointDeltas.
     * @param {{x: Array<number>, y: Array<number>}} deltaSums - Accumulated deltas, one per point.
     * @param {Array<number>} tuplePoints - Point numbers of the tuple, empty for all the points.
     * @param {Object} header - Tuple variation header.
     * @param {number} factor - The scalar of the tuple.
     */
    accumulateExplicitDeltas(deltaSums, tuplePoints, header, factor) {
        const isAllPoints = tuplePoints.length === 0;
        const pointCount = deltaSums.x.length;
        const deltaCount = isAllPoints ? pointCount : tuplePoints.length;
        for (let i = 0; i < deltaCount; i++) {
            const pointIndex = isAllPoints ? i : tuplePoints[i];
            if (pointIndex < pointCount) {
                deltaSums.x[pointIndex] += header.deltas[i] * factor;
                if (header.deltasY) {
                    deltaSums.y[pointIndex] += header.deltasY[i] * factor;
                }
            }
        }
    }

    /**
     * Adds the scaled deltas of a tuple with point numbers to the accumulated deltas of the
     * points of a simple glyph, the deltas of the points it does not list interpolated (IUP)
     * from the default outline.
     * @param {{x: Array<number>, y: Array<number>}} deltaSums - Accumulated deltas, one per point.
     * @param {Array<Object>} points - The default points of the glyph.
     * @param {Array<number>} tuplePoints - Point numbers of the tuple.
     * @param {Object} header - Tuple variation header.
     * @param {number} factor - The scalar of the tuple.
     */
    accumulateInterpolatedDeltas(deltaSums, points, tuplePoints, header, factor) {
        const interpolatedPoints = points.map(copyPoint);
        const deltaMap = Array(points.length).fill(false);
        for (let i = 0; i < tuplePoints.length; i++) {
            const pointIndex = tuplePoints[i];
            if (pointIndex < points.length) {
                deltaMap[pointIndex] = true;
                interpolatedPoints[pointIndex].x += header.deltas[i];
                interpolatedPoints[pointIndex].y += header.deltasY[i];
            }
        }
        this.interpolatePoints(interpolatedPoints, points, deltaMap);
        for (let i = 0; i < points.length; i++) {
            deltaSums.x[i] += (interpolatedPoints[i].x - points[i].x) * factor;
            deltaSums.y[i] += (interpolatedPoints[i].y - points[i].y) * factor;
        }
    }

    /**
     * Transforms glyph components based on variation data.
     * @param {Glyph} glyph - The composite glyph to transform.
     * @param {Array<Object>} transformedPoints - Points that are already transformed.
     * @param {Object} coords - Variation coordinates.
     * @param {{x: Array<number>, y: Array<number>}} componentDeltas - Offset deltas of all the active tuples, one per component.
     */
    transformComponents(glyph, transformedPoints, coords, componentDeltas) {
        let pointsIndex = 0;
        for(let c = 0; c < glyph.components.length; c++) {
            const component = glyph.components[c];
            const componentGlyph = this.font.glyphs.get(component.glyphIndex);
            const componentTransform = copyComponent(component);
            componentTransform.dx += Math.round(componentDeltas.x[c]);
            componentTransform.dy += Math.round(componentDeltas.y[c]);
            // the outline of the component only: its varied metrics are not used
            const componentPoints = this.getVariedPoints(componentGlyph, coords) || componentGlyph.points;
            const transformedComponentPoints = transformPoints(componentPoints, componentTransform);
            transformedPoints.splice(pointsIndex, transformedComponentPoints.length, ...transformedComponentPoints);
            pointsIndex += componentGlyph.points.length;
        }
    }

    /**
     * Calculates the scalar of a tuple variation header at the given normalized coordinates.
     * @param {Object} header - Tuple variation header.
     * @param {Array<number>} normalizedCoords - Normalized variation coordinates.
     * @param {number} axisCount - Number of variation axes.
     * @param {string} flavor - 'gvar' or 'cvar'.
     * @returns {number} The scalar, 0 when the tuple is not active.
     */
    getTupleScalar(header, normalizedCoords, axisCount, flavor) {
        const peakTuple = flavor === 'gvar' && !header.peakTuple ?
            this.gvar().sharedTuples[header.sharedTupleRecordsIndex] : header.peakTuple;
        let scalar = 1;
        for (let axisIndex = 0; axisIndex < axisCount && scalar !== 0; axisIndex++) {
            const peak = peakTuple[axisIndex];
            // without an intermediate region the tuple goes from 0 to its peak
            const start = header.intermediateStartTuple ? header.intermediateStartTuple[axisIndex] : Math.min(0, peak);
            const end = header.intermediateEndTuple ? header.intermediateEndTuple[axisIndex] : Math.max(0, peak);
            scalar *= getAxisScalar(normalizedCoords[axisIndex], start, peak, end);
        }
        return scalar;
    }

    /**
     * Calculates the horizontal deltas of the left and right phantom points of a glyph
     * (the origin and the advance width end) from the gvar table. Phantom points
     * follow the outline points (or the components of a composite glyph) and are
     * never inferred: a tuple that does not reference them leaves them untouched.
     * @param {Glyph} glyph
     * @param {Object} [coords] - Variation coordinates, the current variation if omitted.
     * @returns {{left: number, right: number}}
     */
    getPhantomPointDeltas(glyph, coords) {
        const deltas = { left: 0, right: 0 };
        const variationData = this.gvar() && this.gvar().glyphVariations[glyph.index];
        if (!variationData) {
            return deltas;
        }
        const normalizedCoords = this.getNormalizedCoords(coords || this.font.variation.get());
        const axisCount = this.fvar().axes.length;
        const pointCount = getGlyphVariationPointCount(glyph);
        const leftIndex = pointCount;
        const rightIndex = pointCount + 1;
        const { headers, sharedPoints } = variationData;
        for (let h = 0; h < headers.length; h++) {
            const header = headers[h];
            const factor = this.getTupleScalar(header, normalizedCoords, axisCount, 'gvar');
            if (factor === 0) {
                continue;
            }
            const tuplePoints = getTuplePointNumbers(header, sharedPoints);
            const allPoints = tuplePoints.length === 0;
            const leftDeltaIndex = allPoints ? leftIndex : tuplePoints.indexOf(leftIndex);
            const rightDeltaIndex = allPoints ? rightIndex : tuplePoints.indexOf(rightIndex);
            if (leftDeltaIndex > -1 && header.deltas[leftDeltaIndex] !== undefined) {
                deltas.left += header.deltas[leftDeltaIndex] * factor;
            }
            if (rightDeltaIndex > -1 && header.deltas[rightDeltaIndex] !== undefined) {
                deltas.right += header.deltas[rightDeltaIndex] * factor;
            }
        }
        return deltas;
    }

    /**
     * Applies the tuple variation store of a glyph (gvar) or of the cvt table (cvar) at the
     * given coordinates. The scaled deltas of all the active tuples add up, with the points
     * a tuple does not list interpolated per tuple (IUP), and are rounded once, like fontTools
     * varLib.instancer and HarfBuzz.
     * @param {Object} variationData - headers and sharedPoints of the store.
     * @param {Array<Object>|Array<number>} points - The default points of the glyph, or the cvt values.
     * @param {Object} [coords] - Variation coordinates, the current variation if omitted.
     * @param {string} [flavor='gvar'] - 'gvar' or 'cvar'.
     * @param {Object} [args] - glyph: the glyph of the points (gvar).
     * @returns {Array<Object>|Array<number>} The varied points, or the varied cvt values.
     */
    applyTupleVariationStore(variationData, points, coords, flavor = 'gvar', args = {}) {
        if(!coords) {
            coords = this.font.variation.get();
        }
        const normalizedCoords = this.getNormalizedCoords(coords);
        const { headers, sharedPoints } = variationData;
        const axisCount = this.fvar().axes.length;

        // a composite glyph varies the offsets of its components, one delta each
        const isComposite = flavor === 'gvar' && args.glyph && args.glyph.isComposite;
        const deltaCount = isComposite ? args.glyph.components.length : points.length;
        const deltaSums = { x: Array(deltaCount).fill(0), y: Array(deltaCount).fill(0) };

        for(let h = 0; h < headers.length; h++) {
            const header = headers[h];
            const factor = this.getTupleScalar(header, normalizedCoords, axisCount, flavor);
            if (factor === 0) {
                continue;
            }
            const tuplePoints = getTuplePointNumbers(header, sharedPoints);
            if (flavor === 'gvar' && !isComposite && tuplePoints.length) {
                this.accumulateInterpolatedDeltas(deltaSums, points, tuplePoints, header, factor);
            } else {
                this.accumulateExplicitDeltas(deltaSums, tuplePoints, header, factor);
            }
        }

        if (flavor === 'cvar') {
            return points.map((value, index) => Math.round(value + deltaSums.x[index]));
        }
        if (isComposite) {
            // also with no active tuple: the components still apply their own variations
            const transformedPoints = points.map(copyPoint);
            this.transformComponents(args.glyph, transformedPoints, coords, deltaSums);
            return transformedPoints;
        }
        return points.map((point, index) => ({
            x: Math.round(point.x + deltaSums.x[index]),
            y: Math.round(point.y + deltaSums.y[index]),
            onCurve: point.onCurve,
            lastPointOfContour: point.lastPointOfContour
        }));
    }

    /**
     * Returns the gvar varied points of a glyph that has points, without its metrics: the
     * outline of getTransform, also for the components of a composite glyph.
     * @param {Glyph} glyph
     * @param {Object} coords - Variation coordinates.
     * @returns {Array<Object>|null} The varied points, null when gvar does not vary the glyph.
     */
    getVariedPoints(glyph, coords) {
        const gvar = this.gvar();
        if (!gvar) {
            return null;
        }
        // the points first: reading them parses a lazy glyph, which sets isComposite
        const points = glyph.points;
        // a composite glyph without its own variations still has varied components
        const variationData = gvar.glyphVariations[glyph.index] ||
            (glyph.isComposite ? { headers: [], sharedPoints: [] } : null);
        if (!variationData) {
            return null;
        }
        return this.applyTupleVariationStore(variationData, points, coords, 'gvar', { glyph });
    }

    /**
     * Retrieves a transformed copy of a glyph based on the provided variation coordinates: its
     * varied outline and, in a font with HVAR or gvar, its varied advance width and left side
     * bearing (the same values as getAdvanceWidth and getLeftSideBearing). Returns the glyph
     * itself when the font varies neither its outline nor its metrics.
     * @param {opentype.Glyph|number} glyph - Glyph or index of glyph to transform.
     * @param {Object} coords - Variation coords object (will fall back to variation coords in the defaultRenderOptions)
     * @returns {opentype.Glyph} - The transformed glyph.
     */
    getTransform(glyph, coords) {
        if(Number.isInteger(glyph)) {
            glyph = this.font.glyphs.get(glyph);
        }
        const hasBlend = glyph.getBlendPath;
        const hasPoints = !!(glyph.points && glyph.points.length);
        let transformedGlyph = glyph;
        if (hasBlend || hasPoints) {
            if(!coords) {
                coords = this.font.variation.get();
            }
            if(hasPoints) {
                const transformedPoints = this.getVariedPoints(glyph, coords);
                if(transformedPoints) {
                    transformedGlyph = copyGlyph(glyph, {points: transformedPoints, path: getPath(transformedPoints)});
                }
            } else if (hasBlend) {
                const blendPath = glyph.getBlendPath(coords);
                transformedGlyph = copyGlyph(glyph, {path: blendPath});
            }
        }

        if (!this.hvar() && !this.gvar()) {
            return transformedGlyph;
        }
        // the varied metrics go on the transformed glyph only: the source glyph
        // is shared and must keep its default metrics
        if (transformedGlyph === glyph) {
            // a glyph not varied (no gvar data, no points): its outline as it is, the
            // points and the path are lazy properties Object.assign skips
            transformedGlyph = copyGlyph(glyph, {points: glyph.points, path: glyph.path});
        }
        transformedGlyph.advanceWidth = this.getAdvanceWidth(glyph, coords);
        transformedGlyph.leftSideBearing = this.gvar() && !this.hasLeftSideBearingMap() ?
            this.getLeftSideBearingFromPoints(glyph, transformedGlyph.points, coords) :
            this.getLeftSideBearing(glyph, coords);

        return transformedGlyph;
    }

    /**
     * Whether the HVAR table of the font maps the glyphs to left side bearing variations:
     * without that mapping HVAR has none, the left side bearing varies with the outline.
     * @returns {boolean}
     */
    hasLeftSideBearingMap() {
        const hvar = this.hvar();
        return !!(hvar && hvar.lsb && hvar.lsb.map && hvar.lsb.map.length);
    }

    /**
     * Returns the advance width of a glyph at the given variation coordinates,
     * without modifying the glyph: a varied advance width is never below 0, like HarfBuzz and the instancer of fontTools.
     * @param {Glyph|number} glyph - Glyph or glyph index.
     * @param {Object} [coords] - Variation coordinates, the current variation if omitted.
     * @returns {number} Advance width in font units.
     */
    getAdvanceWidth(glyph, coords) {
        if(Number.isInteger(glyph)) {
            glyph = this.font.glyphs.get(glyph);
        }
        let variedAdvanceWidth;
        if(this.font.tables.hvar) {
            variedAdvanceWidth = glyph.advanceWidth + this.getVariableAdjustment(glyph.index, 'hvar', 'advanceWidth', coords);
        } else if(this.gvar()) {
            // without HVAR the advance width varies through the gvar phantom points
            const phantomDeltas = this.getPhantomPointDeltas(glyph, coords);
            variedAdvanceWidth = glyph.advanceWidth + phantomDeltas.right - phantomDeltas.left;
        } else {
            return glyph.advanceWidth;
        }
        return Math.max(0, Math.round(variedAdvanceWidth));
    }

    /**
     * Calculates the left side bearing of a gvar varied glyph from its varied points
     * and its varied left phantom point.
     * @param {Glyph} glyph - The source glyph.
     * @param {Array<Object>} transformedPoints - The varied points of the glyph.
     * @param {Object} [coords] - Variation coordinates, the current variation if omitted.
     * @returns {number} Left side bearing in font units.
     */
    getLeftSideBearingFromPoints(glyph, transformedPoints, coords) {
        if (!transformedPoints || !transformedPoints.length || glyph.xMin === undefined) {
            return glyph.leftSideBearing;
        }
        const variedXMin = Math.min(...transformedPoints.map(point => point.x));
        const variedOrigin = glyph.xMin - glyph.leftSideBearing + this.getPhantomPointDeltas(glyph, coords).left;
        return Math.round(variedXMin - variedOrigin);
    }

    /**
     * Returns the left side bearing of a glyph at the given variation coordinates,
     * without modifying the glyph: from the LSB map of HVAR when it has one, otherwise
     * in a gvar font from the varied outline and the varied left phantom point, otherwise
     * the one of hmtx.
     * @param {Glyph|number} glyph - Glyph or glyph index.
     * @param {Object} [coords] - Variation coordinates, the current variation if omitted.
     * @returns {number} Left side bearing in font units.
     */
    getLeftSideBearing(glyph, coords) {
        if(Number.isInteger(glyph)) {
            glyph = this.font.glyphs.get(glyph);
        }
        // the implicit glyph id mapping only applies to advance widths: without
        // an LSB mapping HVAR carries no left side bearing variations
        if(this.hasLeftSideBearingMap()) {
            return Math.round(glyph.leftSideBearing + this.getVariableAdjustment(glyph.index, 'hvar', 'lsb', coords));
        }
        if(this.gvar()) {
            // getTransform() derives it from the varied points and phantom points
            return this.getTransform(glyph, coords).leftSideBearing;
        }
        return glyph.leftSideBearing;
    }

    getCvarTransform(coords) {
        const cvt = this.font.tables.cvt;
        const variationData = this.cvar();
        if(!cvt || !cvt.length || !variationData || !variationData.headers.length) return cvt;
        return this.applyTupleVariationStore(variationData, cvt, coords, 'cvar');
    }

    /**
     * Calculates the variable adjustment for a glyph property from variation data.
     * @param {number} gid - Glyph ID.
     * @param {string} tableName - The name of the variation data table.
     * @param {string} parameter - The property to adjust.
     * @param {Object} coords - Variation coordinates.
     * @returns {number} - The calculated adjustment.
     */
    getVariableAdjustment(gid, tableName, parameter, coords) {
        coords = coords || this.font.variation.get();

        let outerIndex, innerIndex;
        
        const table = this.font.tables[tableName];
        if(!table) {
            throw Error(`trying to get variation adjustment from non-existent table "${table}"`);
        }
        if(!table.itemVariationStore) {
            throw Error(`trying to get variation adjustment from table "${table}" which does not have an itemVariationStore`);
        }
        const mapSize = table[parameter] && table[parameter].map.length;
        if (mapSize) {
            let i = gid;
            if (i >= mapSize) {
                i = mapSize - 1;
            }
            
            ({outerIndex, innerIndex} = table[parameter].map[i]);
        } else {
            outerIndex = 0;
            innerIndex = gid;
        }
    
        return this.getDelta(table.itemVariationStore, outerIndex, innerIndex, coords);

    }

    /**
     * Calculates the variable adjustment of a font-wide metric from the MVAR table,
     * e.g. 'hcrs' and 'hcrn' (the caret slope rise and run of hhea), 'xhgt' (the
     * x-height of OS/2): the value to add to the value of the metric in its table.
     * @param {string} tag - The value tag of the metric.
     * @param {Object} coords - Variation coordinates.
     * @returns {number} - The calculated adjustment, 0 when the font does not vary the metric.
     */
    getMetricAdjustment(tag, coords) {
        const table = this.mvar();
        const record = table && table.itemVariationStore && table.valueRecords[tag];
        if (!record) {
            return 0;
        }
        return this.getDelta(table.itemVariationStore, record.outerIndex, record.innerIndex, coords || this.font.variation.get());
    }

    /**
     * Retrieves the delta value from a variation store.
     * @param {Object} itemStore - The item variation store.
     * @param {number} outerIndex - The outer index in the variation subtables.
     * @param {number} innerIndex - The inner index in the delta sets.
     * @param {Object} coords - Variation coordinates.
     * @returns {number} - The delta value.
     */
    getDelta(itemStore, outerIndex, innerIndex, coords) {
        if (outerIndex >= itemStore.itemVariationSubtables.length) {
            return 0;
        }
        
        let varData = itemStore.itemVariationSubtables[outerIndex];
        if (innerIndex >= varData.deltaSets.length) {
            return 0;
        }
        
        let deltaSet = varData.deltaSets[innerIndex];
        let blendVector = this.getBlendVector(itemStore, outerIndex, coords);
        let netAdjustment = 0;
    
        for (let master = 0; master < varData.regionIndexes.length; master++) {
            netAdjustment += deltaSet[master] * blendVector[master];
        }
    
        return netAdjustment;
    }

    /**
     * Calculates the blend vector for a set of variation coordinates.
     * @param {Object} itemStore - The item variation store.
     * @param {number} itemIndex - Index of the current item in the variation subtables.
     * @param {Object} coords - Variation coordinates.
     * @returns {Array<number>} - The blend vector for the given coordinates.
     */
    getBlendVector(itemStore, itemIndex, coords) {
        if(!coords) {
            coords = this.font.variation.get();
        }
        let varData = itemStore.itemVariationSubtables[itemIndex];

        const normalizedCoords = this.getNormalizedCoords(coords);
        let blendVector = [];
    
        // outer loop steps through master designs to be blended
        for (let master = 0; master < varData.regionIndexes.length; master++) {
            let scalar = 1;
            let regionIndex = varData.regionIndexes[master];
            let axes = itemStore.variationRegions[regionIndex].regionAxes;
    
            // the scalar of the region is the product of the scalars of its axes
            for (let axisIndex = 0; axisIndex < axes.length; axisIndex++) {
                const axis = axes[axisIndex];
                scalar *= getAxisScalar(normalizedCoords[axisIndex], axis.startCoord, axis.peakCoord, axis.endCoord);
            }
    
            blendVector[master] = scalar;
        }
    
        return blendVector;
    }

    /**
     * Helper method that returns the font's avar table if present
     * @returns {Object|undefined}
     */
    avar() {
        return this.font.tables.avar;
    }

    /**
     * Helper method that returns the font's cvar table if present
     * @returns {Object|undefined}
     */
    cvar() {
        return this.font.tables.cvar;
    }

    /**
     * Helper method that returns the font's fvar table if present
     * @returns {Object|undefined}
     */
    fvar() {
        return this.font.tables.fvar;
    }

    /**
     * Helper method that returns the font's gvar table if present
     * @returns {Object|undefined}
     */
    gvar() {
        return this.font.tables.gvar;
    }

    /**
     * Helper method that returns the font's hvar table if present
     * @returns {Object|undefined}
     */
    hvar() {
        return this.font.tables.hvar;
    }

    /**
     * Helper method that returns the font's mvar table if present
     * @returns {Object|undefined}
     */
    mvar() {
        return this.font.tables.mvar;
    }
}