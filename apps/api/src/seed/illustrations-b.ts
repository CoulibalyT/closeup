import { circle, ellipse, group, line, path, polar, rect, rng, svg } from './svg.js';

export function ladybug(): string {
  const spots: [number, number, number][] = [
    [400, 430, 42],
    [600, 430, 42],
    [350, 600, 50],
    [650, 600, 50],
    [430, 760, 38],
    [570, 760, 38],
    [500, 340, 30],
  ];
  const legs = [-1, 1].flatMap((side) =>
    [380, 560, 720].map((y, i) =>
      path(`M${500 + side * 250} ${y}q${side * 90} ${-30 + i * 30} ${side * 150} ${20 + i * 40}`, {
        fill: 'none',
        stroke: '#141416',
        'stroke-width': 16,
        'stroke-linecap': 'round',
      }),
    ),
  );
  return svg('#6fae4a', [
    ellipse(620, 360, 330, 120, { fill: '#5a9a3a', transform: 'rotate(-30 620 360)' }),
    ...legs,
    ellipse(500, 250, 150, 115, { fill: '#141416' }),
    ellipse(435, 215, 34, 26, { fill: '#f5f3ea' }),
    ellipse(565, 215, 34, 26, { fill: '#f5f3ea' }),
    path('M450 150q-40 -70 -95 -85', {
      fill: 'none',
      stroke: '#141416',
      'stroke-width': 10,
      'stroke-linecap': 'round',
    }),
    path('M550 150q40 -70 95 -85', {
      fill: 'none',
      stroke: '#141416',
      'stroke-width': 10,
      'stroke-linecap': 'round',
    }),
    ellipse(500, 570, 300, 340, { fill: '#d8231f' }),
    ellipse(410, 460, 110, 170, {
      fill: '#ef4a3f',
      opacity: 0.55,
      transform: 'rotate(18 410 460)',
    }),
    line(500, 235, 500, 908, { stroke: '#141416', 'stroke-width': 10 }),
    ...spots.map(([x, y, r]) => circle(x, y, r, { fill: '#141416' })),
  ]);
}

export function bee(): string {
  const stripes = [0, 1, 2, 3].map((i) =>
    path(`M${345 + i * 95} 395q45 105 0 210`, {
      fill: 'none',
      stroke: '#1a1a1d',
      'stroke-width': 52,
    }),
  );
  return svg('#f3d9e5', [
    ellipse(430, 320, 210, 95, {
      fill: '#ffffff',
      opacity: 0.75,
      stroke: '#9fb4c7',
      'stroke-width': 5,
      transform: 'rotate(-28 430 320)',
    }),
    ellipse(610, 300, 190, 85, {
      fill: '#ffffff',
      opacity: 0.75,
      stroke: '#9fb4c7',
      'stroke-width': 5,
      transform: 'rotate(22 610 300)',
    }),
    path('M760 500l90 0', { stroke: '#1a1a1d', 'stroke-width': 14, 'stroke-linecap': 'round' }),
    group({ 'clip-path': 'url(#beeBody)' }, [
      ellipse(500, 500, 270, 165, { fill: '#f7c531' }),
      ...stripes,
    ]),
    '<clipPath id="beeBody"><ellipse cx="500" cy="500" rx="270" ry="165"/></clipPath>',
    ellipse(500, 500, 270, 165, { fill: 'none', stroke: '#1a1a1d', 'stroke-width': 8 }),
    circle(215, 480, 105, { fill: '#1a1a1d' }),
    circle(180, 450, 26, { fill: '#ffffff' }),
    circle(174, 452, 12, { fill: '#1a1a1d' }),
    path('M160 395q-50 -90 -110 -95', {
      fill: 'none',
      stroke: '#1a1a1d',
      'stroke-width': 9,
      'stroke-linecap': 'round',
    }),
    path('M215 380q-10 -100 -60 -135', {
      fill: 'none',
      stroke: '#1a1a1d',
      'stroke-width': 9,
      'stroke-linecap': 'round',
    }),
    path('M150 520q30 25 60 5', {
      fill: 'none',
      stroke: '#f7c531',
      'stroke-width': 7,
      'stroke-linecap': 'round',
    }),
  ]);
}

export function fish(): string {
  const rand = rng(53);
  const scales: string[] = [];
  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 11; col++) {
      const x = 270 + col * 46 + (row % 2) * 23;
      const y = 350 + row * 36;
      scales.push(
        path(`M${x - 24} ${y}a24 24 0 0 0 48 0`, {
          fill: 'none',
          stroke: '#c9541a',
          'stroke-width': 5,
        }),
      );
    }
  }
  const bubbles = [0, 1, 2, 3, 4, 5].map(() =>
    circle(60 + rand() * 880, 40 + rand() * 250, 10 + rand() * 22, {
      fill: 'none',
      stroke: '#d8f1ff',
      'stroke-width': 5,
      opacity: 0.8,
    }),
  );
  return svg('#2f86c5', [
    ...bubbles,
    path('M760 500L960 330Q900 500 960 670Z', { fill: '#f0842c' }),
    path('M440 330Q520 190 640 300Z', { fill: '#f0842c' }),
    path('M470 665Q540 780 610 660Z', { fill: '#f0842c' }),
    '<clipPath id="fishBody"><ellipse cx="500" cy="500" rx="300" ry="185"/></clipPath>',
    group({ 'clip-path': 'url(#fishBody)' }, [
      ellipse(500, 500, 300, 185, { fill: '#f7a14a' }),
      ...scales,
      rect(200, 315, 165, 370, { fill: '#f7a14a' }),
      path('M365 320q40 180 0 360', { fill: 'none', stroke: '#ffffff', 'stroke-width': 26 }),
      path('M560 318q45 182 0 364', {
        fill: 'none',
        stroke: '#ffffff',
        'stroke-width': 22,
        opacity: 0.9,
      }),
    ]),
    circle(285, 455, 40, { fill: '#ffffff' }),
    circle(278, 458, 20, { fill: '#16161a' }),
    circle(272, 451, 6, { fill: '#ffffff' }),
    path('M210 540q35 25 70 5', {
      fill: 'none',
      stroke: '#9b3d10',
      'stroke-width': 7,
      'stroke-linecap': 'round',
    }),
  ]);
}

export function owl(): string {
  const feathers: string[] = [];
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 7 - (row % 2); col++) {
      const x = 330 + col * 58 + (row % 2) * 29;
      const y = 590 + row * 46;
      feathers.push(
        path(`M${x - 27} ${y}a27 27 0 0 0 54 0`, {
          fill: '#c89a63',
          stroke: '#8a5f33',
          'stroke-width': 4,
        }),
      );
    }
  }
  const eye = (cx: number) => [
    circle(cx, 400, 125, { fill: '#f3e3c3' }),
    circle(cx, 400, 125, { fill: 'none', stroke: '#8a5f33', 'stroke-width': 8 }),
    circle(cx, 400, 82, { fill: '#f2a20c' }),
    circle(cx, 400, 46, { fill: '#141416' }),
    circle(cx - 16, 382, 15, { fill: '#ffffff' }),
  ];
  return svg('#1d2b4a', [
    circle(820, 170, 70, { fill: '#f5ecc8' }),
    rect(0, 905, 1000, 40, { rx: 20, fill: '#5a3a22' }),
    ellipse(500, 560, 300, 370, { fill: '#9a6b3c' }),
    path('M250 330L225 120L390 250Z', { fill: '#9a6b3c' }),
    path('M750 330L775 120L610 250Z', { fill: '#9a6b3c' }),
    '<clipPath id="owlBelly"><ellipse cx="500" cy="700" rx="200" ry="215"/></clipPath>',
    group({ 'clip-path': 'url(#owlBelly)' }, [
      ellipse(500, 700, 200, 215, { fill: '#d9b282' }),
      ...feathers,
    ]),
    ...eye(375),
    ...eye(625),
    path('M500 440L455 520L500 585L545 520Z', {
      fill: '#e08a1e',
      stroke: '#a85f10',
      'stroke-width': 5,
    }),
    path('M410 905l0 -40M450 905l0 -40M550 905l0 -40M590 905l0 -40', {
      stroke: '#e08a1e',
      'stroke-width': 16,
      'stroke-linecap': 'round',
    }),
  ]);
}

export function butterfly(): string {
  const wing = (side: number) => {
    const flip = side < 0 ? 'translate(1000 0) scale(-1 1)' : undefined;
    return group({ transform: flip }, [
      path('M520 470C640 170 930 140 920 380C915 520 720 560 520 500Z', { fill: '#2a5bd7' }),
      path('M520 520C720 520 880 640 800 800C730 920 580 780 520 560Z', { fill: '#3f7bf0' }),
      path('M560 450C660 250 860 220 860 380C855 480 700 510 560 480Z', { fill: '#6fa3ff' }),
      circle(800, 330, 46, { fill: '#ffd23f' }),
      circle(800, 330, 22, { fill: '#16161a' }),
      circle(720, 700, 38, { fill: '#ffd23f' }),
      circle(720, 700, 17, { fill: '#16161a' }),
      ...[0, 1, 2, 3].map((i) =>
        line(530, 490, 880 - i * 60, 250 + i * 90, {
          stroke: '#16235a',
          'stroke-width': 4,
          opacity: 0.6,
        }),
      ),
      ...[0, 1, 2, 3, 4, 5, 6].map((i) =>
        circle(905 - i * 14, 300 + i * 28, 9, { fill: '#ffffff' }),
      ),
    ]);
  };
  return svg('#f4e9d0', [
    wing(1),
    wing(-1),
    ellipse(500, 520, 30, 190, { fill: '#16161a' }),
    circle(500, 310, 36, { fill: '#16161a' }),
    path('M488 285q-40 -110 -95 -130', {
      fill: 'none',
      stroke: '#16161a',
      'stroke-width': 7,
      'stroke-linecap': 'round',
    }),
    path('M512 285q40 -110 95 -130', {
      fill: 'none',
      stroke: '#16161a',
      'stroke-width': 7,
      'stroke-linecap': 'round',
    }),
    circle(391, 153, 10, { fill: '#16161a' }),
    circle(609, 153, 10, { fill: '#16161a' }),
  ]);
}

export function turtle(): string {
  const hexagon = (cx: number, cy: number, r: number, fill: string) => {
    const points = [0, 1, 2, 3, 4, 5].map((i) => polar(cx, cy, r, i * 60).join(' '));
    return path(`M${points.join('L')}Z`, {
      fill,
      stroke: '#2f4a1e',
      'stroke-width': 10,
      'stroke-linejoin': 'round',
    });
  };
  const scutes = [hexagon(500, 520, 95, '#7fae4a')];
  for (let i = 0; i < 6; i++) {
    const [x, y] = polar(500, 520, 172, i * 60 + 30);
    scutes.push(hexagon(x, y, 88, i % 2 ? '#6d9a3c' : '#86b852'));
  }
  const flipper = (x: number, y: number, turn: number) =>
    ellipse(x, y, 120, 58, {
      fill: '#8fbf5f',
      stroke: '#4d7a2a',
      'stroke-width': 8,
      transform: `rotate(${turn} ${x} ${y})`,
    });
  return svg('#e7d3a1', [
    flipper(225, 330, 40),
    flipper(775, 330, -40),
    flipper(245, 740, -35),
    flipper(755, 740, 35),
    path('M500 850l0 95', { stroke: '#8fbf5f', 'stroke-width': 34, 'stroke-linecap': 'round' }),
    ellipse(500, 165, 92, 108, { fill: '#8fbf5f', stroke: '#4d7a2a', 'stroke-width': 8 }),
    circle(462, 130, 13, { fill: '#16161a' }),
    circle(538, 130, 13, { fill: '#16161a' }),
    ellipse(500, 520, 320, 350, { fill: '#4d7a2a' }),
    '<clipPath id="shell"><ellipse cx="500" cy="520" rx="296" ry="326"/></clipPath>',
    group({ 'clip-path': 'url(#shell)' }, [
      ellipse(500, 520, 296, 326, { fill: '#5c8a33' }),
      ...scutes,
    ]),
    ellipse(500, 520, 296, 326, { fill: 'none', stroke: '#2f4a1e', 'stroke-width': 10 }),
  ]);
}
