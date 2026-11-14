"""Write the Canonical_Combining_Class of every code point of Unicode 16.0.0, from the unicodedata module of Python,
an implementation of the Unicode Character Database independent of bin/generate-unicode-normalization.mjs, for the
check of getModifiedCombiningClass (src/char.mjs) on the whole range of code points.

The output is a JSON list of the ranges of code points of the same class other than 0, each one [first, last, class].

    python -I test/generate-combining-classes.py test/combining-classes-16.0.0.json
"""

import argparse
import json
import sys
import unicodedata

UNICODE_VERSION = "16.0.0"


def get_combining_class_ranges():
    ranges = []
    for code_point in range(sys.maxunicode + 1):
        combining_class = unicodedata.combining(chr(code_point))
        if not combining_class:
            continue
        if ranges and ranges[-1][1] == code_point - 1 and ranges[-1][2] == combining_class:
            ranges[-1][1] = code_point
        else:
            ranges.append([code_point, code_point, combining_class])
    return ranges


def main():
    parser = argparse.ArgumentParser(description="Write the combining classes of Unicode as JSON ranges.")
    parser.add_argument("output_path", metavar="output.json", help="path of the JSON file to write")
    arguments = parser.parse_args()
    if unicodedata.unidata_version != UNICODE_VERSION:
        raise SystemExit(f"unicodedata is Unicode {unicodedata.unidata_version}, not {UNICODE_VERSION}")
    ranges = get_combining_class_ranges()
    with open(arguments.output_path, "w", encoding="utf-8") as output_file:
        output_file.write("[\n" + ",\n".join(json.dumps(combining_range) for combining_range in ranges) + "\n]\n")
    print(f"{arguments.output_path}: {len(ranges)} ranges, Unicode {unicodedata.unidata_version}, ok")


if __name__ == "__main__":
    main()
