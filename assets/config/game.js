
// ============================================================
// ROTH RUMBLE - SPIELKONFIGURATION
// ============================================================
//
// CONFIGURATION RULES (global defaults vs. individual levels)
//
// Only global (not overridden by levels):
//   meta, languages, scoring, assets.menu_background, assets.fonts,
//   assets.audio.menu_music (menu / final-results music).
//
// Global defaults in assets; optionally overridden per level:
//   assets.projectile -> levels[].projectile
//     One image path (string) only. The selected image is used for every
//     throw in that level. If missing, the global projectile is used.
//   assets.enemies -> levels[].enemies
//     A positive integer or nonempty array of integers; one value is
//     randomly chosen ONCE PER LEVEL START (also when restarting).
//   assets.characters.east/west -> levels[].characters.east/west
//     A directory path or nonempty array of paths; one directory is
//     randomly chosen PER TEAM, ONCE PER LEVEL START. All figures on
//     the same team use that chosen directory. Teams override separately.
//   assets.audio.* -> levels[].audio.*
//     Audio fields override individually, not the whole audio object.
//     cue_start, cue_win, cue_lose, sfx_hit, sfx_groan accept a file
//     path or nonempty array of paths: one sound is randomly chosen
//     EACH TIME IT IS PLAYED (not once per level or playthrough).
//     groan_chance and pitch_variation are numbers from 0 to 1,
//     inherited / overridden per level; they are NOT random arrays.
//     menu_music is only read globally, even if specified in a level.
//
// Level-only (no inheritance from assets):
//   name, image (scene background), overlays (animated decorations),
//   spawn, walkable, blocked. overlays is a list of decorations, NOT
//   a random selection; levels is the ordered list of game levels.
//
// IMPORTANT: Arrays are random choices ONLY for enemies, character
// directories and audio file paths. There is no generic recursive
// inheritance, nor random selection for projectiles or scene images.
// Asset paths are relative to index.html.

window.gameConfig = {

  // ============================================================
  // META INFORMATIONS
  // ============================================================

  meta: {
    version: 1,
    game: 'Roth Rumble',
    edition: 'Winter Edition',
    copyright: '(c) 2026 Michael Butschek',
  },


  // ============================================================
  // AVAILABLE LANGUAGES
  // ============================================================


  languages: {
    de: 'Deutsch',     // German
    en: 'English',     // English
    uk: 'Українська',  // Ukrainian
    fr: 'Français',    // French
    tr: 'Türkçe',      // Turkish
    pl: 'Polski',      // Polish
    ro: 'Română',      // Romanian
    sq: 'Shqip',       // Albanian
    ru: 'Русский',     // Russian
    ar: 'العربية',         // Arabic
  },


  // ============================================================
  // SCORING
  // ============================================================


  scoring: {
  
    // --------------------------------------------------
    // BASE SCORE
    // --------------------------------------------------
  
    enemy_hit: 10,              // Hit an enemy without defeating them
    enemy_defeat: 50,           // Defeat an enemy (replaces hit points)
    level_complete: 1000,       // Successfully complete a level
  
    // --------------------------------------------------
    // REMAINING HEALTH BONUS
    //
    // Formula:
    // remaining_health ^ exponent * factor
    //
    // All remaining health points of the player's
    // characters are added together.
    // --------------------------------------------------
  
    remaining_health_exponent: 2.0,
    remaining_health_factor: 75.0,
  
    // --------------------------------------------------
    // ROUND DURATION BONUS
    //
    // Formula:
    // (max_duration - actual_duration) ^ exponent * factor
    //
    // Only awarded when the level is completed.
    // No bonus if the maximum duration is exceeded.
    // --------------------------------------------------
  
    round_duration_max: 120,     // Maximum duration in seconds
    round_duration_exponent: 2.0,
    round_duration_factor: 0.1,
    round_duration_round: 5      // Round bonus to multiples of x
  },


  // ============================================================
  // GLOBAL ASSETS
  // ============================================================

  assets: {

    // background image for the main menu
    menu_background: 'assets/gfx/menu/background.webp',

    // game characters
    // (side note: 'assets/gfx/chars/pink' wasn't used because it looks too much like the red opponent)
    characters: {
      west: [ 'assets/gfx/chars/blue', 'assets/gfx/chars/cyan', 'assets/gfx/chars/green', 'assets/gfx/chars/lightblue',
              'assets/gfx/chars/magenta', 'assets/gfx/chars/mintgreen', 'assets/gfx/chars/orange',
              'assets/gfx/chars/violet', 'assets/gfx/chars/yellow', 'assets/gfx/chars/yellowgreen' ],
      east: [ 'assets/gfx/chars/red', ],
    },
    
    // Default projectile for every level. A level may override this
    // with its own projectile: 'path/to/image.webp' (one path, no array).
    projectile: 'assets/gfx/projectiles/snowball.webp',

    // numbers of default enemies
    enemies: 3,

    // music, sfx, voice
    audio: {

      // music to play in loop when main page is open
      menu_music: 'assets/audio/music/menu-music.webm',

      // round start
      cue_start: 'assets/audio/cue/round_start.webm',

      // round end (win/lose)
      cue_win: 'assets/audio/cue/round_win.webm',
      cue_lose: 'assets/audio/cue/round_lose.webm',

      // hit sound
      sfx_hit: [ 'assets/audio/sfx/hit1.webm', 'assets/audio/sfx/hit2.webm', 'assets/audio/sfx/hit3.webm',
                 'assets/audio/sfx/hit4.webm', 'assets/audio/sfx/hit5.webm', 'assets/audio/sfx/hit6.webm' ],

      // pain sound
      sfx_groan: [ 'assets/audio/voice/groan.webm', 'assets/audio/voice/groan2.webm', 'assets/audio/voice/groan3.webm',
                   'assets/audio/voice/groan4.webm', 'assets/audio/voice/groan5.webm', 'assets/audio/voice/ouch.webm' ],

      // chance of a groan sound [0-1]
      groan_chance: 0.6,
      
      // sound pitch variation (hit and groan) [0-1]
      pitch_variation: 0.15,
    },

    // fonts to be used
    fonts: {
      heading: 'assets/fonts/Bangers/Bangers-Regular.woff2',
      body: 'assets/fonts/Nunito/Nunito.woff2',
    },

  },


  // ============================================================
  // GAME-LEVELS
  // ============================================================

  levels: [

    // ----------------------------------------------------------
    // LEVEL 1 - KULTURFABRIK
    // ----------------------------------------------------------

    {
      name: 'Kulturfabrik',
      image: 'assets/gfx/scenes/kufa.webp',
      "spawn": {
        "west": [[487, 371], [907, 372], [906, 635], [489, 640]],
        "east": [[1791, 370], [1788, 796], [1399, 795], [1388, 376]]
      },
      "walkable": {
        "west": [[252, 353], [920, 361], [918, 647], [248, 650]],
        "east": [[928, 359], [1802, 355], [1803, 808], [918, 808]]
      },
      "blocked": [],
      enemies: 3,
    },


    // ----------------------------------------------------------
    // LEVEL 2 - INNENSTADT
    // ----------------------------------------------------------

    {
      name: 'Innenstadt',
      image: 'assets/gfx/scenes/innenstadt.webp',
      "spawn": {
        "west": [[422, 511], [855, 443], [812, 731], [408, 685]],
        "east": [[1309, 483], [1798, 529], [1781, 783], [1311, 775]]
      },
      "walkable": {
        "west": [[248, 513], [896, 417], [887, 755], [253, 681]],
        "east": [[924, 427], [1802, 520], [1805, 812], [920, 760]]
      },
      "blocked": [],
      enemies: 4,
    },


    // ----------------------------------------------------------
    // LEVEL 3 - KULTURFABRIK MIT BARRIERE
    // ----------------------------------------------------------

    {
      name: 'Kulturfabrik II',
      image: 'assets/gfx/scenes/kufa-wall.webp',
      "spawn": {
        "west": [[487, 371], [907, 372], [906, 635], [489, 640]],
        "east": [[1791, 370], [1788, 796], [1399, 795], [1388, 376]]
      },
      "walkable": {
        "west": [[252, 353], [920, 361], [918, 647], [248, 650]],
        "east": [[928, 359], [1802, 355], [1803, 808], [918, 808]]
      },
      "blocked": [[1122, 470], [1055, 436], [1123, 361], [1195, 378], [1173, 405], [1135, 393], [1102, 419], [1132, 439]],
      enemies: 5,
    },


    // ----------------------------------------------------------
    // LEVEL 4 - MARKTPLATZ
    // ----------------------------------------------------------

    {
      name: 'Marktplatz',
      image: 'assets/gfx/scenes/marktplatz.webp',
      overlays: [
        {
          image: 'assets/gfx/overlays/anim-fire-artist1.gif',
          x: 1040,
          y: 340,
          zoom: 0.25,
        },
      ],
      "spawn": {
        "west": [[503, 501], [911, 506], [769, 708], [485, 662]],
        "east": [[1306, 520], [1789, 525], [1790, 794], [1303, 794]]
      },
      "walkable": {
        "west": [[307, 480], [920, 486], [916, 746], [345, 652]],
        "east": [[930, 498], [1803, 509], [1802, 809], [931, 813]]
      },
      "blocked": [],
      enemies: 6,
    },


    // ----------------------------------------------------------
    // LEVEL 5 - INNENSTADT MIT BARRIERE
    // ----------------------------------------------------------

    {
      name: 'Innenstadt II',
      image: 'assets/gfx/scenes/innenstadt-wall.webp',
      "spawn": {
        "west": [[422, 511], [855, 443], [812, 731], [408, 685]],
        "east": [[1309, 483], [1798, 529], [1781, 783], [1311, 775]]
      },
      "walkable": {
        "west": [[248, 513], [896, 417], [887, 755], [253, 681]],
        "east": [[924, 427], [1802, 520], [1805, 812], [920, 760]]
      },
      "blocked": [[934, 660], [897, 639], [948, 569], [1025, 575]],
      enemies: 7,
    },


    // ----------------------------------------------------------
    // LEVEL 6 - MARKTPLATZ MIT BARRIERE
    // ----------------------------------------------------------

    {
      name: 'Marktplatz II',
      image: 'assets/gfx/scenes/marktplatz-wall.webp',
      overlays: [
        {
          image: 'assets/gfx/overlays/anim-fire-artist2.gif',
          x: 1040,
          y: 340,
          zoom: 0.25,
        },
      ],
      "spawn": {
        "west": [[503, 501], [911, 506], [769, 708], [485, 662]],
        "east": [[1306, 520], [1789, 525], [1790, 794], [1303, 794]]
      },
      "walkable": {
        "west": [[307, 480], [920, 486], [916, 746], [345, 652]],
        "east": [[930, 498], [1803, 509], [1802, 809], [931, 813]]
      },
      "blocked": [[826, 681], [878, 685], [904, 644], [880, 625], [893, 608], [952, 636], [931, 688], [894, 720], [837, 722]],
      enemies: 9,
      audio: {
        cue_start: 'assets/audio/voice/letsgo.webm',
      },
    },


    // ----------------------------------------------------------
    // END OF LEVELS
    // ----------------------------------------------------------

  ],
};
