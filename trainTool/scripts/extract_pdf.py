"""Extract plain text from a PDF. Prints the text to stdout, nothing else."""
import argparse
import sys

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', required=True)
    args = ap.parse_args()

    from pypdf import PdfReader
    reader = PdfReader(args.file)
    parts = []
    for page in reader.pages:
        text = page.extract_text() or ''
        if text.strip():
            parts.append(text)
    sys.stdout.write('\n\n'.join(parts))


if __name__ == '__main__':
    main()
