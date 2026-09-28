import { FEATURED_FILM_SEEDS, featuredFilms, tonightsPremiereIndex } from './featured-films';
import { generateFilm } from './film-generator';

describe('Featured films catalog', () => {
  it('locks every published title against generator drift', () => {
    const slate = featuredFilms().map((f) => `${f.genre} | ${f.title} (${f.year}) starring ${f.starring}`);
    expect(slate).toEqual([
      'horror | Whatever You Do, Avoid the Balcony (1978) starring Vera LaRue',
      'horror | The Hungry House (1971) starring Ramona Bouffant',
      'kaiju | Attack of the Regrettably Large Houseplant (1959) starring Bea Sizzle',
      'noir | The Long Refund (1964) starring Cliff Vanderhuge',
      'scifi | Planet of the Lizard Accountants (1979) starring Mavis Crawley',
      'western | A Fistful of Popcorn (1962) starring Rod Thunderwood',
      'romance | Love in the Time of Previews (1972) starring Bea Quasar',
    ]);
  });

  it('covers six genres with no duplicate seeds', () => {
    const genres = new Set(featuredFilms().map((f) => f.genre));
    expect(genres.size).toBe(6);
    expect(new Set(FEATURED_FILM_SEEDS).size).toBe(FEATURED_FILM_SEEDS.length);
  });

  it('rotates the premiere daily and stays in range', () => {
    const a = tonightsPremiereIndex(new Date(2026, 5, 12));
    const b = tonightsPremiereIndex(new Date(2026, 5, 13));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(FEATURED_FILM_SEEDS.length);
    expect((a + 1) % FEATURED_FILM_SEEDS.length).toBe(b);
  });

  it('titles always open with an uppercase character (catalog and beyond)', () => {
    for (let seed = 1; seed < 300; seed++) {
      const title = generateFilm(seed).title;
      expect(title.charAt(0)).toBe(title.charAt(0).toUpperCase());
    }
  });

  describe('palette contrast guardrail', () => {
    function luminance(hex: string): number {
      const channel = (i: number): number => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    }

    it('keeps primary and accent legible against every background', () => {
      // Scenes paint primary shapes directly on the background; when the
      // luminance gap collapses the film dissolves into the dark (caught
      // live on the kaiju and horror palettes).
      for (let seed = 1; seed < 200; seed++) {
        const [bg, primary, accent] = generateFilm(seed).poster.palette;
        expect(Math.abs(luminance(primary) - luminance(bg)))
          .withContext(`primary ${primary} on ${bg} (seed ${seed})`)
          .toBeGreaterThanOrEqual(0.09);
        expect(Math.abs(luminance(accent) - luminance(bg)))
          .withContext(`accent ${accent} on ${bg} (seed ${seed})`)
          .toBeGreaterThanOrEqual(0.25);
      }
    });
  });
});
