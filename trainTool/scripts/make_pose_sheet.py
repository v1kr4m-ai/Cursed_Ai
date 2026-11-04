"""Draws an OpenPose character-sheet layout (front, three-quarter, side, back and a close-up head) on black, in the
standard OpenPose limb colours, for character-sheet workflows whose ControlNet follows a pose sheet.

Usage: python make_pose_sheet.py <out.png> [size]
"""
import sys
from PIL import Image, ImageDraw

# OpenPose COCO-18 limb pairs and their usual colours.
LIMBS = [(1, 2), (1, 5), (2, 3), (3, 4), (5, 6), (6, 7), (1, 8), (8, 9), (9, 10), (1, 11), (11, 12), (12, 13), (1, 0), (0, 14), (14, 16), (0, 15), (15, 17)]
COLORS = [(255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0), (170, 255, 0), (85, 255, 0), (0, 255, 0), (0, 255, 85), (0, 255, 170),
          (0, 255, 255), (0, 170, 255), (0, 85, 255), (0, 0, 255), (85, 0, 255), (170, 0, 255), (255, 0, 255), (255, 0, 170), (255, 0, 85)]


def figure(cx, top, h, turn):
    """Keypoints of a standing figure h tall, centred at cx; turn 0 = front, 0.5 = three-quarter, 1 = side, -1 = back."""
    u = h / 8.0
    w = 1.0 - abs(turn) * 0.75 if turn != -1 else 1.0  # how wide the shoulders look
    sh, hip = 1.1 * u * w, 0.6 * u * w
    neck = (cx, top + 1.3 * u)
    p = {1: neck, 0: (cx + turn * 0.25 * u if turn != -1 else cx, top + 0.6 * u)}
    p[2], p[5] = (cx - sh, top + 1.4 * u), (cx + sh, top + 1.4 * u)
    p[3], p[6] = (cx - sh * 1.15, top + 2.6 * u), (cx + sh * 1.15, top + 2.6 * u)
    p[4], p[7] = (cx - sh * 1.2, top + 3.7 * u), (cx + sh * 1.2, top + 3.7 * u)
    p[8], p[11] = (cx - hip, top + 4.0 * u), (cx + hip, top + 4.0 * u)
    p[9], p[12] = (cx - hip, top + 5.9 * u), (cx + hip, top + 5.9 * u)
    p[10], p[13] = (cx - hip, top + 7.8 * u), (cx + hip, top + 7.8 * u)
    if turn != -1:  # the face (eyes and ears) only shows from the front and side
        e = 0.18 * u * (1 - abs(turn) * 0.6)
        p[14], p[15] = (p[0][0] - e + turn * 0.1 * u, p[0][1] - 0.12 * u), (p[0][0] + e + turn * 0.1 * u, p[0][1] - 0.12 * u)
        if abs(turn) < 1:
            p[16] = (p[0][0] - 0.4 * u * w, p[0][1])
        p[17] = (p[0][0] + 0.4 * u * w, p[0][1])
    return p


def draw(img, p, width):
    d = ImageDraw.Draw(img)
    for (a, b), c in zip(LIMBS, COLORS):
        if a in p and b in p:
            d.line([p[a], p[b]], fill=tuple(int(v * 0.6) for v in c), width=width)
    for k, xy in p.items():
        r = width * 0.8
        d.ellipse([xy[0] - r, xy[1] - r, xy[0] + r, xy[1] + r], fill=COLORS[k % 18])


def main():
    out = sys.argv[1]
    size = int(sys.argv[2]) if len(sys.argv) > 2 else 1280
    img = Image.new("RGB", (size, size), (0, 0, 0))
    h = size * 0.46
    for i, turn in enumerate([0, 0.5, 1, -1]):  # top row: front, three-quarter, side, back
        draw(img, figure(size * (0.14 + i * 0.24), size * 0.03, h, turn), max(3, size // 220))
    for i, turn in enumerate([0, 0.5, 1]):      # bottom row: bigger half-body views for the face
        draw(img, figure(size * (0.2 + i * 0.3), size * 0.52, h * 1.6, turn), max(4, size // 160))
    img.save(out)
    print(out)


if __name__ == "__main__":
    main()
