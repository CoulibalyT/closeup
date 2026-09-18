import { blob, circle, ellipse, group, line, path, polar, rect, rng, svg, wedge } from './svg.js';

/** Original illustrations, drawn in code: no third-party image anywhere in the seed. */

export function orange(): string {
  const rand = rng(7);
  const parts = [
    circle(500, 500, 455, { fill: '#e8761c' }),
    circle(500, 500, 425, { fill: '#f9ead0' }),
  ];
  for (let i = 0; i < 10; i++) {
    const from = i * 36 + 3;
    const to = i * 36 + 33;
    const [x0, y0] = polar(500, 500, 40, i * 36 + 18);
    const [x1, y1] = polar(500, 500, 395, from);
    const [x2, y2] = polar(500, 500, 395, to);
    parts.push(
      path(`M${x0} ${y0}L${x1} ${y1}A395 395 0 0 1 ${x2} ${y2}Z`, {
        fill: '#f7a531',
        stroke: '#f9ead0',
        'stroke-width': 8,
        'stroke-linejoin': 'round',
      }),
    );
    for (let k = 0; k < 46; k++) {
      const deg = from + 4 + rand() * (to - from - 8);
      const [cx, cy] = polar(500, 500, 85 + rand() * 290, deg);
      parts.push(
        ellipse(cx, cy, 12 + rand() * 18, 4 + rand() * 3.5, {
          transform: `rotate(${deg} ${cx} ${cy})`,
          fill: rand() > 0.5 ? '#ffc25a' : '#ee8f1f',
          opacity: 0.85,
        }),
      );
    }
  }
  parts.push(circle(500, 500, 28, { fill: '#f9ead0' }));
  return svg('#2f6f73', parts);
}

export function kiwi(): string {
  const rand = rng(11);
  const parts = [
    circle(500, 500, 450, { fill: '#7a5a34' }),
    circle(500, 500, 425, { fill: '#8bbf3f' }),
  ];
  for (let i = 0; i < 90; i++) {
    const deg = i * 4 + rand() * 3;
    const [x1, y1] = polar(500, 500, 120 + rand() * 30, deg);
    const [x2, y2] = polar(500, 500, 330 + rand() * 80, deg);
    parts.push(
      line(x1, y1, x2, y2, { stroke: '#b5dd62', 'stroke-width': 3 + rand() * 4, opacity: 0.7 }),
    );
  }
  parts.push(blob(500, 500, 120, 14, 5, { fill: '#eef3cf' }));
  for (let i = 0; i < 44; i++) {
    const deg = i * (360 / 44) + rand() * 4;
    const [cx, cy] = polar(500, 500, 165 + rand() * 45, deg);
    parts.push(
      ellipse(cx, cy, 15, 7.5, { transform: `rotate(${deg} ${cx} ${cy})`, fill: '#1f1a12' }),
      ellipse(cx - 3, cy - 2, 4, 2, { transform: `rotate(${deg} ${cx} ${cy})`, fill: '#6b6250' }),
    );
  }
  for (let i = 0; i < 160; i++) {
    const [x, y] = polar(500, 500, 430 + rand() * 18, rand() * 360);
    parts.push(
      line(x, y, x + rand() * 8 - 4, y + rand() * 8 - 4, { stroke: '#a88655', 'stroke-width': 2 }),
    );
  }
  return svg('#d9c7a3', parts);
}

export function watermelon(): string {
  const rand = rng(19);
  const half = (r: number, fill: string) =>
    path(`M${500 - r} 300A${r} ${r} 0 0 0 ${500 + r} 300Z`, { fill });
  const parts = [
    half(450, '#1f6b35'),
    half(425, '#3fa053'),
    half(395, '#eef5d8'),
    half(372, '#e8364f'),
  ];
  for (let i = 0; i < 9; i++) {
    const [x, y] = polar(500, 300, 438, 12 + i * 19.5);
    parts.push(circle(x, y, 14, { fill: '#174f27', opacity: 0.6 }));
  }
  for (let i = 0; i < 34; i++) {
    const deg = 14 + rand() * 152;
    const [cx, cy] = polar(500, 300, 70 + rand() * 250, deg);
    parts.push(
      path(
        `M${cx} ${cy - 17}C${cx + 12} ${cy - 4} ${cx + 9} ${cy + 15} ${cx} ${cy + 17}C${cx - 9} ${cy + 15} ${cx - 12} ${cy - 4} ${cx} ${cy - 17}Z`,
        {
          fill: '#24140f',
          transform: `rotate(${deg - 90} ${cx} ${cy})`,
        },
      ),
    );
  }
  for (let i = 0; i < 60; i++) {
    const [cx, cy] = polar(500, 300, rand() * 350, 5 + rand() * 170);
    parts.push(circle(cx, cy, 3 + rand() * 4, { fill: '#f4697d', opacity: 0.7 }));
  }
  return svg('#f3e2b8', parts);
}

export function donut(): string {
  const rand = rng(23);
  const colours = ['#ffffff', '#ffd23f', '#3ec6e0', '#7c5cff', '#2fbf71', '#ff7a1a'];
  const parts = [
    circle(500, 520, 430, { fill: '#000000', opacity: 0.13 }),
    circle(500, 500, 430, { fill: '#d9a066' }),
    circle(500, 500, 430, { fill: 'none', stroke: '#c48a4f', 'stroke-width': 26 }),
    blob(500, 500, 365, 26, 7, { fill: '#ff8fb8' }),
    blob(500, 500, 352, 24, 7, { fill: '#ff6fa5' }, 0.5),
    blob(500, 500, 150, 14, 6, { fill: '#ff8fb8' }, 1.2),
    circle(500, 500, 122, { fill: '#c48a4f' }),
    circle(500, 500, 105, { fill: '#f6efe2' }),
  ];
  for (let i = 0; i < 95; i++) {
    const deg = rand() * 360;
    const [cx, cy] = polar(500, 500, 185 + rand() * 150, deg);
    parts.push(
      rect(cx - 17, cy - 5, 34, 10, {
        rx: 5,
        fill: colours[Math.floor(rand() * colours.length)],
        transform: `rotate(${rand() * 180} ${cx} ${cy})`,
      }),
    );
  }
  parts.push(
    path('M250 330A300 300 0 0 1 480 205', {
      fill: 'none',
      stroke: '#ffd0e2',
      'stroke-width': 18,
      'stroke-linecap': 'round',
      opacity: 0.8,
    }),
  );
  return svg('#f6efe2', parts);
}

export function pizza(): string {
  const rand = rng(31);
  const parts = [
    circle(500, 500, 460, { fill: '#c98b4a' }),
    circle(500, 500, 460, { fill: 'none', stroke: '#a96d33', 'stroke-width': 14 }),
    blob(500, 500, 400, 10, 9, { fill: '#c23b22' }),
    blob(500, 500, 382, 16, 11, { fill: '#f3c65a' }, 0.8),
  ];
  for (let i = 0; i < 40; i++) {
    const [cx, cy] = polar(500, 500, rand() * 360, rand() * 360);
    parts.push(blob(cx, cy, 16 + rand() * 22, 5, 4, { fill: '#f9dd8a', opacity: 0.7 }, rand() * 6));
  }
  for (let i = 0; i < 13; i++) {
    const [cx, cy] = polar(500, 500, 90 + rand() * 250, i * 27.7 + rand() * 12);
    parts.push(circle(cx, cy, 46, { fill: '#a3281c' }), circle(cx, cy, 40, { fill: '#c0392b' }));
    for (let k = 0; k < 6; k++) {
      const [sx, sy] = polar(cx, cy, rand() * 28, rand() * 360);
      parts.push(circle(sx, sy, 4 + rand() * 3, { fill: '#8f2318' }));
    }
  }
  for (let i = 0; i < 9; i++) {
    const [cx, cy] = polar(500, 500, 110 + rand() * 230, i * 40 + 20);
    parts.push(circle(cx, cy, 20, { fill: 'none', stroke: '#2b2a20', 'stroke-width': 11 }));
  }
  for (let i = 0; i < 8; i++) {
    const [cx, cy] = polar(500, 500, 80 + rand() * 260, i * 45 + rand() * 20);
    const turn = rand() * 360;
    parts.push(
      ellipse(cx, cy, 34, 17, { fill: '#2e8b3d', transform: `rotate(${turn} ${cx} ${cy})` }),
      line(cx - 30, cy, cx + 30, cy, {
        stroke: '#1d6a2b',
        'stroke-width': 3,
        transform: `rotate(${turn} ${cx} ${cy})`,
      }),
    );
  }
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = polar(500, 500, 455, i * 45);
    const [x2, y2] = polar(500, 500, 455, i * 45 + 180);
    parts.push(line(x1, y1, x2, y2, { stroke: '#8a5a2b', 'stroke-width': 5, opacity: 0.55 }));
  }
  return svg('#e9e1d2', parts);
}

export function friedEgg(): string {
  const rand = rng(37);
  const parts = [
    circle(500, 500, 470, { fill: '#2b2b2e' }),
    circle(500, 500, 440, { fill: '#3a3a3f' }),
    blob(500, 510, 330, 42, 5, { fill: '#fbfaf5' }, 0.6),
    blob(500, 510, 300, 36, 5, { fill: '#ffffff' }, 0.9),
    blob(
      470,
      520,
      330,
      40,
      5,
      { fill: 'none', stroke: '#e7c58a', 'stroke-width': 10, opacity: 0.6 },
      0.6,
    ),
    circle(460, 480, 128, { fill: '#f2a20c' }),
    circle(460, 480, 116, { fill: '#ffb81f' }),
    ellipse(420, 435, 38, 22, { fill: '#ffe08a', transform: 'rotate(-35 420 435)' }),
  ];
  for (let i = 0; i < 70; i++) {
    const [x, y] = polar(500, 510, rand() * 300, rand() * 360);
    parts.push(circle(x, y, 2 + rand() * 3.5, { fill: '#2a2622', opacity: 0.85 }));
  }
  return svg('#c9c4bb', parts);
}

export function vinyl(): string {
  const parts = [circle(500, 500, 470, { fill: '#121214' })];
  for (let r = 175; r < 462; r += 6) {
    parts.push(
      circle(500, 500, r, {
        fill: 'none',
        stroke: r % 54 < 6 ? '#0a0a0b' : '#2c2c31',
        'stroke-width': r % 18 === 1 ? 3 : 1.5,
      }),
    );
  }
  parts.push(
    wedge(500, 500, 175, 465, -62, -34, { fill: '#ffffff', opacity: 0.13 }),
    wedge(500, 500, 175, 465, 118, 146, { fill: '#ffffff', opacity: 0.13 }),
    circle(500, 500, 165, { fill: '#e2452f' }),
    circle(500, 500, 165, { fill: 'none', stroke: '#b3301e', 'stroke-width': 6 }),
    circle(500, 500, 118, { fill: 'none', stroke: '#f7d7a8', 'stroke-width': 4 }),
    rect(400, 425, 200, 12, { rx: 6, fill: '#f7d7a8' }),
    rect(430, 450, 140, 8, { rx: 4, fill: '#f7d7a8', opacity: 0.7 }),
    rect(415, 560, 170, 8, { rx: 4, fill: '#f7d7a8', opacity: 0.7 }),
    rect(445, 580, 110, 8, { rx: 4, fill: '#f7d7a8', opacity: 0.5 }),
    circle(500, 500, 15, { fill: '#e9e4da' }),
  );
  return svg('#e9e4da', parts);
}

export function dartboard(): string {
  const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  const parts = [circle(500, 500, 470, { fill: '#17171a' })];
  for (const i of order) {
    const from = i * 18 - 99;
    const to = from + 18;
    const dark = i % 2 === 0;
    const base = dark ? '#1c1c1f' : '#efe3c4';
    const ring = dark ? '#c8261d' : '#1f8a4c';
    parts.push(
      wedge(500, 500, 40, 395, from, to, { fill: base }),
      wedge(500, 500, 370, 395, from, to, { fill: ring }),
      wedge(500, 500, 215, 240, from, to, { fill: ring }),
    );
  }
  for (let i = 0; i < 20; i++) {
    const [x1, y1] = polar(500, 500, 40, i * 18 - 99);
    const [x2, y2] = polar(500, 500, 400, i * 18 - 99);
    parts.push(line(x1, y1, x2, y2, { stroke: '#c9c9c9', 'stroke-width': 3 }));
  }
  for (const r of [395, 370, 240, 215, 40, 17]) {
    parts.push(circle(500, 500, r, { fill: 'none', stroke: '#c9c9c9', 'stroke-width': 3 }));
  }
  parts.push(circle(500, 500, 38, { fill: '#1f8a4c' }), circle(500, 500, 16, { fill: '#c8261d' }));
  for (let i = 0; i < 20; i++) {
    const [x, y] = polar(500, 500, 432, i * 18 - 90);
    parts.push(
      rect(x - 5, y - 16, 10, 32, {
        rx: 4,
        fill: '#e9e4da',
        transform: `rotate(${i * 18} ${x} ${y})`,
      }),
    );
  }
  return svg('#8a6a4a', parts);
}

export function clock(): string {
  const parts = [
    circle(500, 500, 468, { fill: '#c9a227' }),
    circle(500, 500, 440, { fill: '#a88418' }),
    circle(500, 500, 425, { fill: '#fdfbf4' }),
  ];
  for (let i = 0; i < 60; i++) {
    const hour = i % 5 === 0;
    const [x1, y1] = polar(500, 500, hour ? 350 : 385, i * 6 - 90);
    const [x2, y2] = polar(500, 500, 405, i * 6 - 90);
    parts.push(
      line(x1, y1, x2, y2, {
        stroke: '#22222a',
        'stroke-width': hour ? 14 : 5,
        'stroke-linecap': 'round',
      }),
    );
  }
  const hand = (deg: number, length: number, width: number, fill: string) => {
    const [x, y] = polar(500, 500, length, deg - 90);
    const [bx, by] = polar(500, 500, -50, deg - 90);
    return line(bx, by, x, y, { stroke: fill, 'stroke-width': width, 'stroke-linecap': 'round' });
  };
  parts.push(
    hand(305, 215, 22, '#22222a'),
    hand(50, 315, 14, '#22222a'),
    hand(200, 345, 5, '#d0342c'),
    circle(500, 500, 24, { fill: '#22222a' }),
    circle(500, 500, 9, { fill: '#d0342c' }),
  );
  return svg('#5b7c99', parts);
}

export function button(): string {
  const parts: string[] = [];
  for (let i = 0; i < 50; i++) {
    parts.push(
      line(0, i * 20, 1000, i * 20, { stroke: '#3c5a8a', 'stroke-width': 9, opacity: 0.5 }),
    );
    parts.push(
      line(i * 20, 0, i * 20, 1000, { stroke: '#22406e', 'stroke-width': 6, opacity: 0.45 }),
    );
  }
  parts.push(
    circle(500, 516, 392, { fill: '#000000', opacity: 0.2 }),
    circle(500, 500, 390, { fill: '#e8c26a' }),
    circle(500, 500, 390, { fill: 'none', stroke: '#c79a3c', 'stroke-width': 18 }),
    circle(500, 500, 300, { fill: '#dcb257' }),
    circle(500, 500, 300, { fill: 'none', stroke: '#c79a3c', 'stroke-width': 8 }),
  );
  const holes: [number, number][] = [
    [430, 430],
    [570, 430],
    [430, 570],
    [570, 570],
  ];
  for (const [x, y] of holes) parts.push(circle(x, y, 40, { fill: '#2a2a2f' }));
  for (const [a, b] of [
    [0, 3],
    [1, 2],
  ] as const) {
    for (const offset of [-9, 0, 9]) {
      parts.push(
        line(holes[a]![0] + offset, holes[a]![1], holes[b]![0] + offset, holes[b]![1], {
          stroke: '#f4f1e8',
          'stroke-width': 8,
          'stroke-linecap': 'round',
        }),
      );
    }
  }
  return svg('#2f4f80', parts);
}

export function dice(): string {
  const die = (
    x: number,
    y: number,
    size: number,
    turn: number,
    pips: [number, number][],
    fill: string,
  ) => {
    const unit = size / 4;
    return group({ transform: `rotate(${turn} ${x + size / 2} ${y + size / 2})` }, [
      rect(x + 10, y + 16, size, size, { rx: size * 0.16, fill: '#000000', opacity: 0.19 }),
      rect(x, y, size, size, { rx: size * 0.16, fill }),
      rect(x + 14, y + 14, size - 28, size - 28, {
        rx: size * 0.12,
        fill: 'none',
        stroke: '#ffffff',
        'stroke-width': 6,
        opacity: 0.5,
      }),
      ...pips.flatMap(([px, py]) => [
        circle(x + unit * px, y + unit * py, size * 0.085, { fill: '#1d1d22' }),
        circle(x + unit * px - 6, y + unit * py - 6, size * 0.025, { fill: '#6a6a72' }),
      ]),
    ]);
  };
  return svg('#1f7a4d', [
    die(
      130,
      330,
      430,
      -14,
      [
        [1, 1],
        [3, 1],
        [2, 2],
        [1, 3],
        [3, 3],
      ],
      '#f6f2e9',
    ),
    die(
      520,
      210,
      360,
      18,
      [
        [1, 1],
        [1, 2],
        [1, 3],
        [3, 1],
        [3, 2],
        [3, 3],
      ],
      '#d8342c',
    ),
  ]);
}

export function basketball(): string {
  const rand = rng(41);
  const parts = [circle(500, 500, 450, { fill: '#e2711d' })];
  for (let i = 0; i < 900; i++) {
    const [x, y] = polar(500, 500, Math.sqrt(rand()) * 440, rand() * 360);
    parts.push(circle(x, y, 3.2, { fill: '#c45f14', opacity: 0.8 }));
  }
  const seam = { fill: 'none', stroke: '#1c1c1f', 'stroke-width': 15 };
  parts.push(
    line(500, 50, 500, 950, seam),
    line(50, 500, 950, 500, seam),
    path('M190 175C400 380 400 620 190 825', seam),
    path('M810 175C600 380 600 620 810 825', seam),
    circle(500, 500, 450, { fill: 'none', stroke: '#1c1c1f', 'stroke-width': 12 }),
    ellipse(350, 300, 120, 70, {
      fill: '#ffffff',
      opacity: 0.12,
      transform: 'rotate(-35 350 300)',
    }),
  );
  return svg('#c9a66b', parts);
}

export function tennisBall(): string {
  const rand = rng(43);
  const parts = [
    circle(500, 520, 440, { fill: '#000000', opacity: 0.15 }),
    circle(500, 500, 440, { fill: '#cfe334' }),
  ];
  for (let i = 0; i < 700; i++) {
    const [x, y] = polar(500, 500, Math.sqrt(rand()) * 430, rand() * 360);
    const turn = rand() * 180;
    parts.push(
      line(x - 7, y, x + 7, y, {
        stroke: rand() > 0.5 ? '#e4f26a' : '#b5c922',
        'stroke-width': 2.5,
        transform: `rotate(${turn} ${x} ${y})`,
      }),
    );
  }
  const seam = { fill: 'none', stroke: '#f7f7ee', 'stroke-width': 26, 'stroke-linecap': 'round' };
  parts.push(
    path('M120 280C380 360 380 640 120 720', seam),
    path('M880 280C620 360 620 640 880 720', seam),
  );
  return svg('#2f7d5b', parts);
}

export function piano(): string {
  const parts = [
    rect(0, 0, 1000, 1000, { fill: '#1a1a1d' }),
    rect(0, 0, 1000, 190, { fill: '#5a3a22' }),
  ];
  for (let i = 0; i < 10; i++)
    parts.push(rect(i * 100 + 3, 200, 94, 770, { rx: 8, fill: '#fbfaf5' }));
  for (let i = 0; i < 10; i++)
    parts.push(rect(i * 100 + 3, 900, 94, 70, { rx: 8, fill: '#ddd8cc' }));
  for (const i of [0, 1, 3, 4, 5, 7, 8]) {
    parts.push(
      rect(i * 100 + 68, 200, 64, 480, { rx: 6, fill: '#101013' }),
      rect(i * 100 + 76, 205, 48, 440, { rx: 5, fill: '#2a2a30' }),
    );
  }
  parts.push(
    rect(0, 185, 1000, 22, { fill: '#b3122d' }),
    rect(0, 60, 1000, 8, { fill: '#7a5230' }),
  );
  return svg('#1a1a1d', parts);
}

export function guitar(): string {
  const parts = [
    ellipse(500, 690, 330, 290, { fill: '#c9772e' }),
    ellipse(500, 330, 250, 230, { fill: '#c9772e' }),
    ellipse(500, 690, 300, 262, { fill: '#e0a15a' }),
    ellipse(500, 330, 222, 204, { fill: '#e0a15a' }),
    rect(300, 420, 400, 200, { fill: '#e0a15a' }),
    circle(500, 500, 118, { fill: '#2a1a10' }),
    rect(440, 0, 120, 400, { fill: '#3a2416' }),
    rect(360, 800, 280, 46, { rx: 8, fill: '#2a1a10' }),
  ];
  for (const r of [132, 146, 160]) {
    parts.push(
      circle(500, 500, r, {
        fill: 'none',
        stroke: r === 146 ? '#f4e3bd' : '#7a3f1a',
        'stroke-width': 6,
      }),
    );
  }
  for (let i = 0; i < 7; i++) parts.push(rect(440, 30 + i * 56, 120, 6, { fill: '#d9d9d9' }));
  for (let i = 0; i < 6; i++) {
    const x = 455 + i * 18;
    parts.push(
      line(x, 0, x, 823, {
        stroke: i < 3 ? '#f1e9d2' : '#d8c48a',
        'stroke-width': 2 + (5 - i) * 0.7,
      }),
    );
    parts.push(circle(x, 823, 7, { fill: '#f4e3bd' }));
  }
  return svg('#35506b', parts);
}

export function trafficLight(): string {
  const light = (y: number, on: string, glow: string) => [
    circle(500, y, 118, { fill: '#0e0e10' }),
    circle(500, y, 100, { fill: on }),
    circle(500, y, 100, { fill: 'none', stroke: glow, 'stroke-width': 10, opacity: 0.6 }),
    ellipse(465, y - 38, 34, 20, {
      fill: '#ffffff',
      opacity: 0.35,
      transform: `rotate(-30 465 ${y - 38})`,
    }),
    path(`M372 ${y - 50}A135 135 0 0 1 628 ${y - 50}L628 ${y - 84}A150 150 0 0 0 372 ${y - 84}Z`, {
      fill: '#19191c',
    }),
  ];
  return svg('#8ec5e8', [
    rect(470, 880, 60, 120, { fill: '#3b3b40' }),
    rect(330, 70, 340, 830, { rx: 60, fill: '#26262a' }),
    rect(350, 90, 300, 790, { rx: 46, fill: '#303036' }),
    ...light(235, '#e53935', '#ff8a80'),
    ...light(485, '#5a4a12', '#8a7420'),
    ...light(735, '#1f4d2b', '#2f7a44'),
  ]);
}
