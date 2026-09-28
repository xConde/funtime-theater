import { BeatKind, FilmGenre, PosterMotif } from './film.model';
import { pick, Rng } from './seeded-rng';

/**
 * Content banks for the film generator.
 *
 * Tone target: a B-movie house that takes itself completely seriously and is
 * wrong to. Titles should sound like a real poster you would walk past, look
 * back at, and read twice. House rule from the top: no em dashes anywhere in
 * generated copy.
 */

// ---------------------------------------------------------------------------
// Star and director names (fully fictional, pulp-era billing)
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'Rex',
  'Vera',
  'Buck',
  'Gloria',
  'Lance',
  'Dolores',
  'Chip',
  'Maxine',
  'Rod',
  'Ramona',
  'Sterling',
  'Bea',
  'Duke',
  'Fern',
  'Cliff',
  'Opal',
  'Ace',
  'Mavis',
] as const;

const LAST_NAMES = [
  'Granite',
  'Mortem',
  'Steele',
  'Vanderhuge',
  'Crawley',
  'Atomico',
  'Bouffant',
  'Quasar',
  'LaRue',
  'Thunderwood',
  'Pemberton',
  'Nightly',
  'Marvelous',
  'Drudge',
  'Calamity',
  'Sizzle',
] as const;

export function generateStarName(rng: Rng): string {
  return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
}

export function generateDirectorName(rng: Rng): string {
  const initial = String.fromCharCode(65 + Math.floor(rng() * 26));
  return `${initial}. ${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
}

// ---------------------------------------------------------------------------
// Title grammars
// ---------------------------------------------------------------------------

type TitleTemplate = (rng: Rng) => string;

const HORROR_CREATURES = [
  'the Gravekeeper',
  'the Mannequins',
  'the Chattering Teeth',
  'the Long Fingers',
  'the Wallpaper People',
  'the Damp Choir',
  'the Smiling Neighbors',
  'the Second Shadow',
] as const;

const HORROR_PLACES = [
  'the Balcony',
  'the Projection Booth',
  'Lake Grimsby',
  'Cellar Nine',
  'the Last Pew',
  'Room 8',
  'the Coat Check',
] as const;

const HORROR_GERUNDS = [
  'Dripping',
  'Lurking',
  'Whispering',
  'Third Knock',
  'Wet Walls',
  'Unblinking',
  'Late Showing',
  'Hungry House',
] as const;

const KAIJU_MONSTERS = [
  'Colossarachne',
  'Gigantopus',
  'Mecha-Heron',
  'Crabthra',
  'Smogadon',
  'The Ohio Thing',
  'Magmurtle',
  'Pigeonzilla',
] as const;

const KAIJU_VICTIMS = [
  'Downtown Pomona',
  'Cleveland',
  'the Tri-County Area',
  'the World’s Largest Ball of Twine',
  'the Interstate',
  'Sheboygan',
] as const;

const KAIJU_SIZES = ['50-Foot', 'Two-Story', 'Regrettably Large', 'County-Sized', '40-Ton'] as const;

const KAIJU_THINGS = [
  'Intermission',
  'Paperboy',
  'Houseplant',
  'Mailman',
  'Lunch Special',
  'Substitute Teacher',
] as const;

const NOIR_NOUNS = [
  'Refund',
  'Matinee',
  'Cigarette Girl',
  'Last Reel',
  'Alibi',
  'Nickel',
  'Goodbye Kiss',
  'Wrong Hat',
] as const;

const NOIR_PLACES = ['Concession Stand', 'Union Station', 'Pier 13', 'the Mezzanine', 'Lot C'] as const;

const SCIFI_PLURALS = [
  'Chrome Men',
  'Ticket Stubs',
  'Magnet Women',
  'Lizard Accountants',
  'Polite Invaders',
  'Atomic Housewives',
  'Moon Clerks',
] as const;

const SCIFI_THINGS = ['Moon', 'Jukebox', 'Suburbs', 'Telephone', 'Weather', 'Mailbox'] as const;

const SCIFI_VERBS_PAST = ['Blinked', 'Unionized', 'Went Quiet', 'Asked Why', 'Stood Still', 'Called Collect'] as const;

const WESTERN_NOUNS = [
  'Popcorn',
  'Nickels',
  'Tumbleweeds',
  'Bad Directions',
  'Warm Sarsaparilla',
  'Borrowed Boots',
] as const;

const WESTERN_PLACES = ['the Bijou', 'Dry Gulch', 'Parking Lot C', 'Rattlesnake Flats', 'the Loading Dock'] as const;

const ROMANCE_NOUNS = [
  'Previews',
  'Inclement Weather',
  'the Double Feature',
  'Tax Season',
  'the Intermission',
  'Roadwork',
] as const;

const ROMANCE_PLACES = ['the Mezzanine', 'Gate 4', 'the Last Row', 'the Lost and Found', 'Niagara Falls'] as const;

const ROMANCE_DARLINGS = ['the Understudy', 'the Projectionist', 'Row J', 'the Night Manager', 'the Rival'] as const;

const TITLE_TEMPLATES: Record<FilmGenre, readonly TitleTemplate[]> = {
  horror: [
    (rng) => `The ${pick(rng, HORROR_GERUNDS)}`,
    (rng) => `Night of ${pick(rng, HORROR_CREATURES)}`,
    (rng) => `It Waits in ${pick(rng, HORROR_PLACES)}`,
    (rng) => `Beware ${pick(rng, HORROR_CREATURES)}`,
    (rng) => `Whatever You Do, Avoid ${pick(rng, HORROR_PLACES)}`,
  ],
  kaiju: [
    (rng) => `${pick(rng, KAIJU_MONSTERS)} vs. ${pick(rng, KAIJU_MONSTERS)}`,
    (rng) => `Attack of the ${pick(rng, KAIJU_SIZES)} ${pick(rng, KAIJU_THINGS)}`,
    (rng) => `${pick(rng, KAIJU_MONSTERS)} Destroys ${pick(rng, KAIJU_VICTIMS)}`,
    (rng) => `The Beast Beneath ${pick(rng, KAIJU_VICTIMS)}`,
  ],
  noir: [
    (rng) => `The Long ${pick(rng, NOIR_NOUNS)}`,
    (rng) => `Farewell, My ${pick(rng, NOIR_NOUNS)}`,
    (rng) => `${pick(rng, NOIR_PLACES)} Confidential`,
    (rng) => `Kiss the ${pick(rng, NOIR_NOUNS)} Goodnight`,
  ],
  scifi: [
    (rng) => `Planet of the ${pick(rng, SCIFI_PLURALS)}`,
    (rng) => `Invasion of the ${pick(rng, SCIFI_PLURALS)}`,
    (rng) => `The Day the ${pick(rng, SCIFI_THINGS)} ${pick(rng, SCIFI_VERBS_PAST)}`,
    (rng) => `${pickMillions(rng)} Million Miles to the ${pick(rng, SCIFI_THINGS)}`,
  ],
  western: [
    (rng) => `A Fistful of ${pick(rng, WESTERN_NOUNS)}`,
    (rng) => `High Noon at ${pick(rng, WESTERN_PLACES)}`,
    (rng) => `${generateStarName(rng)} Rides Again`,
    (rng) => `Showdown at ${pick(rng, WESTERN_PLACES)}`,
  ],
  romance: [
    (rng) => `Love in the Time of ${pick(rng, ROMANCE_NOUNS)}`,
    (rng) => `Kisses at ${pick(rng, ROMANCE_PLACES)}`,
    (rng) => `My Darling ${pick(rng, ROMANCE_DARLINGS)}`,
    (rng) => `Two Tickets to ${pick(rng, ROMANCE_PLACES)}`,
  ],
};

function pickMillions(rng: Rng): number {
  return pick(rng, [3, 7, 12, 40] as const);
}

export function generateTitle(rng: Rng, genre: FilmGenre): string {
  const raw = pick(rng, TITLE_TEMPLATES[genre])(rng);
  // Place banks carry mid-sentence articles ("the Mezzanine"); a title must
  // never open lowercase ("the Mezzanine Confidential").
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// ---------------------------------------------------------------------------
// Taglines
// ---------------------------------------------------------------------------

const TAGLINES: Record<FilmGenre, readonly string[]> = {
  horror: [
    'Whatever you do, stay for the credits.',
    'The balcony seats itself.',
    'It knows your seat number.',
    'Filmed on location. The location escaped.',
    'You will scream. Quietly, please.',
    'Some doors are exits. Not this one.',
  ],
  kaiju: [
    'Insurance will not cover this.',
    'He is not angry. He is just big.',
    'Step on the city. Skip the toll.',
    'Evacuate calmly. He can smell panic.',
    'The military has a plan. It is a bad one.',
    'Bigger than last summer. Hungrier, too.',
  ],
  noir: [
    'In this town, the popcorn is always stale.',
    'She walked in with trouble and no exact change.',
    'Every alibi has a matinee price.',
    'The rain never asks permission.',
    'Trust no one. Tip the usher.',
    'He had one rule. This is a film about the exception.',
  ],
  scifi: [
    'The future called. It wants a refund.',
    'Science went too far at 2:40 PM on a Tuesday.',
    'They come in peace. They leave in formation.',
    'Mankind asked for a sign. It was a form, actually.',
    'Space is cold. Bring a cardigan.',
    'The saucers land at midnight. Parking is limited.',
  ],
  western: [
    'Six seats. Five bullets.',
    'The fastest draw west of the lobby.',
    'A town too small for the both of them. Zoning issues, mostly.',
    'He rode in at dawn. The matinee started at noon. He waited.',
    'Justice wears spurs and asks for a receipt.',
    'Out here, the law is whoever brought rope.',
  ],
  romance: [
    'Two tickets. One armrest.',
    'Love means never having to share the popcorn.',
    'She said maybe. The orchestra heard yes.',
    'From the studio that believes in second chances and third acts.',
    'Some kisses last forever. This one lasts 92 minutes.',
    'He wrote letters. She wrote back. The mailman knows everything.',
  ],
};

export function generateTagline(rng: Rng, genre: FilmGenre): string {
  return pick(rng, TAGLINES[genre]);
}

// ---------------------------------------------------------------------------
// Beat labels: what is on screen during each beat, per genre.
// These feed the screen captions now and the morning review later, so they
// are written to be quotable ("lost a star when the mirror lied").
// ---------------------------------------------------------------------------

type LabeledKinds = Exclude<BeatKind, 'title-card' | 'credits'>;

const BEAT_LABELS: Record<FilmGenre, Record<LabeledKinds, readonly string[]>> = {
  horror: {
    calm: ['a too-quiet breakfast', 'the realtor swears the house is fine', 'someone says it was probably the wind'],
    build: ['the music stops', 'a hallway gets longer', 'the dog refuses the stairs'],
    spike: ['the mirror lies', 'the second knock', 'a face where no face should be'],
    chase: ['the run for the car', 'the keys, the keys, the keys', 'the woods do not end'],
    twist: ['the call is from inside', 'the photo was taken yesterday', 'the friend was never there'],
    climax: ['the final stand in the basement', 'dawn against the door', 'the last match is struck'],
  },
  kaiju: {
    calm: ['fishermen report nothing unusual', 'a seismograph hiccups', 'the mayor cuts a ribbon'],
    build: ['the tide goes out too far', 'birds leave the city', 'a scientist is laughed at'],
    spike: ['first full reveal, sirens', 'the bridge goes', 'he sees the power lines and chooses violence'],
    chase: ['the crowd run, hats everywhere', 'tanks reverse at speed', 'the bus almost makes it'],
    twist: ['there are two of them', 'he was protecting us all along', 'the army wakes something worse'],
    climax: ['the rooftop last stand', 'monster against monster, city pays', 'one good idea and a lot of cable'],
  },
  noir: {
    calm: ['rain on the office window', 'a slow pour of cheap coffee', 'the case nobody wanted'],
    build: ['a name comes up twice', 'the witness changes shoes', 'somebody is following the tail'],
    spike: ['a gunshot in the stairwell', 'the safe is already open', 'the lights cut out mid-sentence'],
    chase: ['headlights in the wet streets', 'a foot chase through the kitchen', 'the night bus pulls away'],
    twist: ['the client did it', 'the letter was never mailed', 'the detective is the alibi'],
    climax: ['the confession nobody asked for', 'the dock at midnight', 'the truth, at matinee prices'],
  },
  scifi: {
    calm: ['a quiet observatory shift', 'the suburbs water their lawns', 'mission control plays cards'],
    build: ['the signal repeats', 'static learns the weather report', 'the compass disagrees with itself'],
    spike: ['the saucer over the water tower', 'the beam takes the mailbox', 'first contact, wrong handshake'],
    chase: ['the pickup truck outruns a light beam', 'corridors of the mothership', 'the countdown nobody started'],
    twist: ['the invaders are us, later', 'the moon is a door', 'the professor reads the form upside down'],
    climax: ['the transmitter on the roof', 'one weakness, found in a diner', 'the sky argues back'],
  },
  western: {
    calm: ['a slow ride into town', 'the saloon goes quiet', 'beans, again'],
    build: ['a stranger asks two questions', 'the clock crawls to noon', 'somebody buys the good whiskey'],
    spike: ['the first draw', 'a chandelier comes down', 'the horses bolt'],
    chase: ['the canyon run', 'the stagecoach loses a wheel', 'dust and bad intentions'],
    twist: ['the sheriff sold the map', 'the gold was feed corn', 'the outlaw is the long-lost brother'],
    climax: ['high noon, one street', 'the standoff at the bijou', 'the last bullet is negotiated'],
  },
  romance: {
    calm: ['a meet at the lost and found', 'two umbrellas, one awning', 'letters read on a train'],
    build: [
      'the dance neither admits to wanting',
      'a borrowed coat returned slowly',
      'the long walk taken the long way',
    ],
    spike: ['the kiss interrupted by weather', 'the wrong name said out loud', 'the ring falls under the seats'],
    chase: ['the run to the station', 'a taxi negotiation at speed', 'the gate agent shows mercy'],
    twist: [
      'the rival is a decent person, complicating things',
      'the letters were never sent',
      'the job offer is in another city',
    ],
    climax: ['the speech in front of everyone', 'the platform at the last whistle', 'the armrest, finally shared'],
  },
};

export function generateBeatLabel(rng: Rng, genre: FilmGenre, kind: BeatKind): string {
  if (kind === 'title-card') return 'title card';
  if (kind === 'credits') return 'end credits';
  return pick(rng, BEAT_LABELS[genre][kind]);
}

// ---------------------------------------------------------------------------
// Poster palettes and motifs
// ---------------------------------------------------------------------------

export const POSTER_PALETTES: Record<FilmGenre, readonly (readonly [string, string, string])[]> = {
  horror: [
    // Primary lifted from #7a1f2b: dark red on near-black dissolved on screen.
    ['#0d0b14', '#a23847', '#e8d9a0'],
    ['#11151c', '#4d8563', '#d8c8e8'],
  ],
  kaiju: [
    ['#1a2632', '#d96c2c', '#f2e8c9'],
    ['#22311d', '#b8423a', '#e8e3d0'],
  ],
  noir: [
    ['#15151a', '#8a8d93', '#d9b23e'],
    ['#1b1820', '#5d6470', '#d9a13c'],
  ],
  scifi: [
    ['#101c2e', '#3fb8af', '#f2849e'],
    ['#1c1430', '#7ddf64', '#e0d8f0'],
  ],
  western: [
    ['#2e1f14', '#cf7f3e', '#e8d9b0'],
    ['#33261b', '#bf4a37', '#dfc998'],
  ],
  romance: [
    ['#2b1622', '#d96a8b', '#f2e3c9'],
    ['#241a2b', '#c94f6d', '#e8d4e0'],
  ],
};

export const GENRE_MOTIFS: Record<FilmGenre, readonly PosterMotif[]> = {
  horror: ['claw', 'staring-eye', 'crooked-house'],
  kaiju: ['monster-skyline'],
  noir: ['silhouette-hat'],
  scifi: ['flying-saucer', 'ringed-planet'],
  western: ['cactus-sunset'],
  romance: ['facing-profiles'],
};
