import { describe, expect, it } from 'vitest';
import { answerFromFileName } from './fileName.js';

describe('answerFromFileName', () => {
  it.each([
    ['mickey.png', 'Mickey'],
    ['winnie-l-ourson.jpg', 'Winnie l ourson'],
    ["winnie l'ourson.jpg", "Winnie l'ourson"],
    ['tour_eiffel (2).jpeg', 'Tour eiffel'],
    ['tour-eiffel-2.webp', 'Tour eiffel'],
    ['IMG_0042.JPG', 'IMG 0042'],
    ['  chat .png', 'Chat'],
    ['éléphant.png', 'Éléphant'],
  ])('%s → %s', (file, answer) => {
    expect(answerFromFileName(file)).toBe(answer);
  });
});
