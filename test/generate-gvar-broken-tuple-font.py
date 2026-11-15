"""Build a synthetic variable TrueType test font whose gvar table has a tuple with broken data.

Axes: wght 100..400..900 and wdth 50..100..200, no avar. Glyphs: .notdef and a (U+0061), a square of 4 points from
100 0 to 400 500, with an advance width of 500 and a left side bearing of 100. The variation data of a has two tuples:
- tuple 0, at wght max, with all the points (the shared point numbers): the top points (1 and 2) move by y +100 and
  the right phantom point by x +50;
- tuple 1, at wdth max, with private point numbers (the right points, 2 and 3): they move by x +200.
The end offset of the variation data of a (the last offset of the gvar table) is then lowered, so that its data end
inside the private point numbers of the tuple 1 (one byte after their start, rounded up to an even length): the
serialized data of the tuple 1 run past the end of the variation data of a, and its point numbers cannot be read.

HarfBuzz 11.3.2 reads the data of a tuple only where it is active (gvar::apply_deltas_to_points), and leaves the glyph
unvaried where an active tuple fails to read:
hb-shape --no-glyph-names --show-extents --variations=wght=900,wdth=100 <font> -u 0061 [1=0+550<100,600,300,-600>]
hb-shape --no-glyph-names --show-extents --variations=wght=900,wdth=200 <font> -u 0061 [1=0+500<100,500,300,-500>]

usage: generate-gvar-broken-tuple-font.py <output.ttf>
"""
import argparse
import io
import struct

from fontTools.fontBuilder import FontBuilder
from fontTools.misc.timeTools import timestampFromString
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.ttLib.tables.TupleVariation import TupleVariation

FIXED_TIMESTAMP = timestampFromString("Sun Nov  1 00:00:00 2026")

FAMILY_NAME = "Test GVAR Broken Tuple"

CONTOUR = [(100, 0), (100, 500), (400, 500), (400, 0)]

# deltas: one (x, y) per point, then the 4 phantom points (left, right, top, bottom); None for a point the tuple does
# not list
VARIATIONS = {
    ".notdef": [],
    "a": [
        TupleVariation({"wght": (0, 1, 1)}, [(0, 0), (0, 100), (0, 100), (0, 0), (0, 0), (50, 0), (0, 0), (0, 0)]),
        TupleVariation({"wdth": (0, 1, 1)}, [None, None, (200, 0), (200, 0), None, None, None, None]),
    ],
}

# GlyphVariationData: tupleVariationCount, dataOffset, then the tuple variation headers
TUPLE_VARIATION_HEADER_FIELDS_SIZE = 4
EMBEDDED_PEAK_TUPLE = 0x8000
INTERMEDIATE_REGION = 0x4000
PRIVATE_POINT_NUMBERS = 0x2000
SHARED_POINT_NUMBERS = 0x8000
COUNT_MASK = 0x0FFF
POINTS_ARE_WORDS = 0x80
POINT_RUN_COUNT_MASK = 0x7F


def draw_glyph(contour):
    pen = TTGlyphPen(None)
    pen.moveTo(contour[0])
    for point in contour[1:]:
        pen.lineTo(point)
    pen.closePath()
    return pen.glyph()


def build_valid_font():
    glyph_order = [".notdef", "a"]
    builder = FontBuilder(unitsPerEm=1000, isTTF=True)
    builder.setupGlyphOrder(glyph_order)
    builder.setupCharacterMap({0x0061: "a"})
    builder.setupGlyf({glyph_name: draw_glyph(CONTOUR) for glyph_name in glyph_order})
    builder.setupHorizontalMetrics({glyph_name: (500, 100) for glyph_name in glyph_order})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable(
        {
            "copyright": "Generated with fontTools FontBuilder for the opentype.js test suite. Public domain (CC0 1.0 Universal).",
            "familyName": FAMILY_NAME,
            "styleName": "Regular",
            "fullName": f"{FAMILY_NAME} Regular",
            "psName": FAMILY_NAME.replace(" ", "") + "-Regular",
            "licenseDescription": "Public domain (CC0 1.0 Universal)",
            "licenseInfoURL": "https://creativecommons.org/publicdomain/zero/1.0/",
        }
    )
    # fsType 0: installable embedding, as the CC0 license allows
    builder.setupOS2(fsType=0, sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost()
    builder.setupFvar(axes=[("wght", 100, 400, 900, "Weight"), ("wdth", 50, 100, 200, "Width")], instances=[])
    builder.setupGvar(VARIATIONS)
    # fixed timestamps, so that the build is reproducible
    builder.font["head"].created = FIXED_TIMESTAMP
    builder.font["head"].modified = FIXED_TIMESTAMP
    builder.font.recalcTimestamp = False
    output = io.BytesIO()
    builder.save(output)
    return bytearray(output.getvalue())


def get_table_offset(font_bytes, tag):
    table_count = struct.unpack(">H", font_bytes[4:6])[0]
    for table_index in range(table_count):
        record_offset = 12 + 16 * table_index
        if font_bytes[record_offset:record_offset + 4] == tag:
            return struct.unpack(">I", font_bytes[record_offset + 8:record_offset + 12])[0]
    raise ValueError(f"no {tag} table")


def get_tuple_header_size(tuple_index_field, axis_count):
    size = TUPLE_VARIATION_HEADER_FIELDS_SIZE
    if tuple_index_field & EMBEDDED_PEAK_TUPLE:
        size += 2 * axis_count
    if tuple_index_field & INTERMEDIATE_REGION:
        size += 4 * axis_count
    return size


def get_packed_point_numbers_size(font_bytes, start):
    """The size in bytes of the packed point numbers at an offset."""
    point_count = font_bytes[start]
    offset = start + 1
    if point_count & POINTS_ARE_WORDS:
        point_count = ((point_count & POINT_RUN_COUNT_MASK) << 8) | font_bytes[offset]
        offset += 1
    read_count = 0
    while read_count < point_count:
        control = font_bytes[offset]
        run_count = (control & POINT_RUN_COUNT_MASK) + 1
        offset += 1 + run_count * (2 if control & POINTS_ARE_WORDS else 1)
        read_count += run_count
    return offset - start


def cut_private_points_of_last_tuple(font_bytes):
    """Lower the end offset of the variation data of the last glyph to the start of the private point numbers of its
    last tuple, plus one byte, rounded up to the short offsets (an even number of bytes)."""
    gvar_offset = get_table_offset(font_bytes, b"gvar")
    axis_count, _, _, glyph_count, flags, data_array_offset = struct.unpack(">HHIHHI", font_bytes[gvar_offset + 4:gvar_offset + 20])
    assert not flags & 1, "short offsets"
    offsets_start = gvar_offset + 20
    last_glyph_offset = 2 * struct.unpack(">H", font_bytes[offsets_start + 2 * (glyph_count - 1):offsets_start + 2 * glyph_count])[0]
    glyph_data_start = gvar_offset + data_array_offset + last_glyph_offset
    tuple_variation_count, data_offset = struct.unpack(">HH", font_bytes[glyph_data_start:glyph_data_start + 4])
    assert tuple_variation_count & COUNT_MASK == 2, "two tuples"
    header_start = glyph_data_start + 4
    tuple_data_start = glyph_data_start + data_offset
    if tuple_variation_count & SHARED_POINT_NUMBERS:
        tuple_data_start += get_packed_point_numbers_size(font_bytes, tuple_data_start)
    tuple_index_fields = []
    for _ in range(tuple_variation_count & COUNT_MASK):
        variation_data_size, tuple_index_field = struct.unpack(">HH", font_bytes[header_start:header_start + 4])
        tuple_index_fields.append(tuple_index_field)
        header_start += get_tuple_header_size(tuple_index_field, axis_count)
        last_tuple_data_start = tuple_data_start
        tuple_data_start += variation_data_size
    assert not tuple_index_fields[0] & PRIVATE_POINT_NUMBERS, "tuple 0 with the shared point numbers (all the points)"
    assert tuple_index_fields[1] & PRIVATE_POINT_NUMBERS, "tuple 1 with private point numbers"
    new_length = last_tuple_data_start + 1 - glyph_data_start
    new_length += new_length % 2
    end_offset_field = offsets_start + 2 * glyph_count
    font_bytes[end_offset_field:end_offset_field + 2] = struct.pack(">H", (last_glyph_offset + new_length) // 2)
    return font_bytes


def build_font(output_path):
    with open(output_path, "wb") as output_file:
        output_file.write(cut_private_points_of_last_tuple(build_valid_font()))


def verify_font(output_path):
    font = TTFont(output_path)
    assert [axis.axisTag for axis in font["fvar"].axes] == ["wght", "wdth"]
    try:
        font["gvar"].variations["a"]
    except Exception as error:
        print(f"{output_path}: wght and wdth, the data of the tuple 1 of a cut ({type(error).__name__}), ok")
        return
    raise AssertionError("the variation data of a should fail to decompile")


def main():
    parser = argparse.ArgumentParser(description="Build a variable TrueType test font whose gvar table has a tuple with broken data.")
    parser.add_argument("output_path", metavar="output.ttf", help="path of the font to write")
    arguments = parser.parse_args()
    build_font(arguments.output_path)
    verify_font(arguments.output_path)


if __name__ == "__main__":
    main()
