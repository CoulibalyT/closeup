/** Tiny SVG toolkit for the seed illustrations. Everything is drawn on a 1000 × 1000 canvas. */

export const SIZE = 1000;

type Attrs = Record<string, string | number | undefined>;

export function el(name: string, attrs: Attrs, children?: string): string {
  const list = Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}="${typeof value === 'number' ? round(value) : value}"`)
    .join(' ');
  return children === undefined ? `<${name} ${list}/>` : `<${name} ${list}>${children}</${name}>`;
}

export const round = (n: number) => Math.round(n * 100) / 100;

export const circle = (cx: number, cy: number, r: number, attrs: Attrs = {}) =>
  el('circle', { cx, cy, r, ...attrs });

export const ellipse = (cx: number, cy: number, rx: number, ry: number, attrs: Attrs = {}) =>
  el('ellipse', { cx, cy, rx, ry, ...attrs });

export const rect = (x: number, y: number, width: number, height: number, attrs: Attrs = {}) =>
  el('rect', { x, y, width, height, ...attrs });

export const line = (x1: number, y1: number, x2: number, y2: number, attrs: Attrs = {}) =>
  el('line', { x1, y1, x2, y2, ...attrs });

export const path = (d: string, attrs: Attrs = {}) => el('path', { d, ...attrs });

export const group = (attrs: Attrs, children: string[]) => el('g', attrs, children.join(''));

/** Point at `deg` degrees (0 = right, clockwise) and distance `r` from a centre. */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [round(cx + Math.cos(a) * r), round(cy + Math.sin(a) * r)];
}

/** Pie wedge between two radii. */
export function wedge(
  cx: number,
  cy: number,
  inner: number,
  outer: number,
  from: number,
  to: number,
  attrs: Attrs = {},
): string {
  const [x1, y1] = polar(cx, cy, outer, from);
  const [x2, y2] = polar(cx, cy, outer, to);
  const [x3, y3] = polar(cx, cy, inner, to);
  const [x4, y4] = polar(cx, cy, inner, from);
  const large = to - from > 180 ? 1 : 0;
  return path(
    `M${x1} ${y1}A${outer} ${outer} 0 ${large} 1 ${x2} ${y2}L${x3} ${y3}` +
      `A${inner} ${inner} 0 ${large} 0 ${x4} ${y4}Z`,
    attrs,
  );
}

/** Closed wobbly shape: a circle whose radius varies with a few sine waves. */
export function blob(
  cx: number,
  cy: number,
  r: number,
  wobble: number,
  lobes: number,
  attrs: Attrs = {},
  phase = 0,
): string {
  const points: string[] = [];
  for (let deg = 0; deg < 360; deg += 4) {
    const a = (deg * Math.PI) / 180;
    const radius =
      r + wobble * Math.sin(lobes * a + phase) + wobble * 0.4 * Math.sin(2.3 * lobes * a);
    points.push(polar(cx, cy, radius, deg).join(' '));
  }
  return path(`M${points.join('L')}Z`, attrs);
}

/** Deterministic random numbers, so the same seed always draws the same picture. */
export function rng(seed: number): () => number {
  let state = seed;
  return () => ((state = (state * 16807) % 2147483647) - 1) / 2147483646;
}

export function svg(background: string, children: string[]): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" ` +
    `width="${SIZE}" height="${SIZE}">` +
    rect(0, 0, SIZE, SIZE, { fill: background }) +
    children.join('') +
    '</svg>'
  );
}
