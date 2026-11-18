/**
 * City Rumble: simulation engine and browser application.
 *
 * File map
 * --------
 * 1. Engine IIFE: geometry, configuration resolution, Round, and shared helpers.
 *    Exported as window.CityRumble in browsers or module.exports under Node.js.
 * 2. Browser IIFE: resource bootstrap and startGame(), which owns the DOM,
 *    rendering, input, audio, navigation, score reporting, and debug controls.
 *
 * The engine has no DOM, image, audio, or network dependencies. Its fixed-step
 * state is consumed by the browser shell rather than mixed with rendering.
 * Keep gameplay changes in the engine and presentation changes in the shell.
 *
 * Coordinate and time conventions
 * -------------------------------
 * World coordinates are pixels of the original scene image: x grows right,
 * y grows down. Figure x/y identify the standing point, not the sprite corner.
 * H-dependent dimensions use the scene height, never the viewport height.
 * Simulation time advances in integer ticks of DT seconds; UI score animation
 * and round-duration scoring use performance.now() instead. Rendering may run
 * at a different frequency.
 *
 * Configuration lives in assets/config/game.js. UI translations live in
 * assets/lang/<code>.js. Information pages own their separate HTML/CSS.
 * This is a classic script so local file:// play needs no module loader/build.
 *
 * Maintenance invariants
 * ----------------------
 * - Resolve all existing projectile contacts before deciding a round result.
 * - Spawn queued throws only after that decision, if the round continues.
 * - Preserve world/screen conversion symmetry when changing the renderer.
 * - Preserve ordered Start/level/name POSTs and the per-page client identity.
 * - The browser UI is HTML over a canvas, all contained within #stage.
 */
/* City Rumble — deterministic 60 Hz rules, independent of browser/rendering. */
(function (root) {
  'use strict';
  /**
   * Geometry constants are fractions of scene height. FIGURE_STAND_RATIO
   * locates the feet within the image including its transparent lower padding.
   * These values are gameplay/presentation constants, not game.js options.
   */
  const FIGURE_HEIGHT_RATIO = 0.17,
    HIT_RADIUS_RATIO = 0.052;
  // The standing sprites have transparent padding below the visible feet.
  const FIGURE_STAND_RATIO = 0.76;
  const THROW_ANGLE = (10 * Math.PI) / 180;
  /**
   * EPS is the geometric comparison tolerance; DT is one simulation tick.
   * STATES also defines the required sprite filenames for each team.
   */
  const EPS = 1e-8,
    DT = 1 / 60,
    STATES = ['idle', 'aiming', 'throwing', 'hit', 'dead'];
  // Give the East player three seconds to position figures before West can throw.
  const WEST_THROW_DELAY_TICKS = Math.ceil(3 / DT);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const edges = (p) => p.map((a, i) => [a, p[(i + 1) % p.length]]);
  /**
   * Test whether p lies on the closed segment a–b, allowing EPS tolerance.
   */
  function onSegment(p, a, b) {
    return (
      Math.abs(cross(a, b, p)) < EPS &&
      p[0] >= Math.min(a[0], b[0]) - EPS &&
      p[0] <= Math.max(a[0], b[0]) + EPS &&
      p[1] >= Math.min(a[1], b[1]) - EPS &&
      p[1] <= Math.max(a[1], b[1]) + EPS
    );
  }
  /**
   * Point-in-polygon test with inclusive edges. An empty polygon contains no
   * points. valid() uses that same inclusion to make blocked edges forbidden.
   */
  function inside(p, polygon) {
    let yes = false;
    for (const [a, b] of edges(polygon)) {
      if (onSegment(p, a, b)) return true;
      if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) yes = !yes;
    }
    return yes;
  }
  /**
   * Return segment parameters t on a–b for intersections with c–d.
   * Collinear overlap returns its clipped endpoints; disjoint/degenerate cases
   * return an empty list. Values are clamped to the closed interval [0, 1].
   */
  function intersections(a, b, c, d) {
    const rx = b[0] - a[0],
      ry = b[1] - a[1],
      sx = d[0] - c[0],
      sy = d[1] - c[1];
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < EPS) {
      if (Math.abs(cross(a, b, c)) > EPS) return [];
      const n = rx * rx + ry * ry;
      if (n < EPS) return [];
      const ts = [c, d].map((p) => ((p[0] - a[0]) * rx + (p[1] - a[1]) * ry) / n).sort((x, y) => x - y);
      return ts[1] < 0 || ts[0] > 1 ? [] : [Math.max(0, ts[0]), Math.min(1, ts[1])];
    }
    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
    const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
    return t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS ? [Math.max(0, Math.min(1, t))] : [];
  }
  /**
   * Validate one simple polygon against the natural scene dimensions.
   * Return null on success or a short diagnostic string on failure. The empty
   * polygon is accepted only when empty=true, as used for the blocked area.
   * Reject duplicate points, overlapping edges, self intersections and zero area.
   */
  function polygonProblem(p, width, height, empty = false) {
    if (!Array.isArray(p)) return 'not an array';
    if (empty && !p.length) return null;
    if (p.length < 3) return 'fewer than three vertices';
    if (
      p.some(
        (a) =>
          !Array.isArray(a) ||
          a.length !== 2 ||
          !a.every(Number.isFinite) ||
          a[0] < 0 ||
          a[1] < 0 ||
          a[0] > width ||
          a[1] > height,
      )
    )
      return 'invalid coordinates';
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) if (distance(p[i], p[j]) < EPS) return 'duplicate vertices';
      const prev = p[(i + p.length - 1) % p.length],
        next = p[(i + 1) % p.length];
      if (Math.abs(cross(prev, p[i], next)) < EPS && (onSegment(next, prev, p[i]) || onSegment(prev, p[i], next)))
        return 'overlapping edges';
    }
    const es = edges(p);
    for (let i = 0; i < es.length; i++)
      for (let j = i + 1; j < es.length; j++) {
        if (j === i + 1 || (i === 0 && j === es.length - 1)) continue;
        if (intersections(...es[i], ...es[j]).length) return 'self intersection';
      }
    const area = es.reduce((n, [a, b]) => n + a[0] * b[1] - a[1] * b[0], 0);
    return Math.abs(area) < EPS ? 'zero area' : null;
  }
  /**
   * A figure standing point must be in its own walkable area and outside
   * blocked. Spawn is deliberately not a movement constraint.
   */
  function valid(p, level, team) {
    return inside(p, level.walkable[team]) && !inside(p, level.blocked);
  }
  // Exact segment sweep: check every polygon-edge crossing (no tunnelling).
  // Returns the furthest safe point and the first boundary contact, if any.
  /**
   * Sweep from a to b across every relevant edge rather than sampling a few
   * positions. Test the intervals between crossings to prevent tunnelling through
   * thin obstacles or concave boundaries. Return a safe point and the first
   * contact, or contact=null when the entire movement is permitted. A tiny
   * world-space offset keeps blocked boundary contacts on the allowed side.
   */
  function sweepMovement(a, b, level, team) {
    const length = distance(a, b);
    if (length < EPS) return { point: a.slice(), contact: null };
    const boundaries = [level.walkable[team], level.blocked];
    const ts = [0, 1, ...boundaries.flatMap((p) => edges(p).flatMap((e) => intersections(a, b, ...e)))].sort(
      (x, y) => x - y,
    );
    const unique = ts.filter((v, i) => !i || v - ts[i - 1] > EPS);
    for (let i = 0; i < unique.length - 1; i++) {
      const mid = mix(a, b, (unique[i] + unique[i + 1]) / 2);
      if (!valid(mid, level, team)) {
        const t = unique[i];
        const safe = mix(a, b, Math.max(0, t - 1e-4 / length));
        return { point: valid(safe, level, team) ? safe : a.slice(), contact: mix(a, b, t) };
      }
    }
    if (valid(b, level, team)) return { point: b.slice(), contact: null };
    const safe = mix(a, b, Math.max(0, 1 - 1e-4 / length));
    return { point: valid(safe, level, team) ? safe : a.slice(), contact: b.slice() };
  }
  // Sliding collision response: remove motion into a wall, keep motion along it.
  // Recheck every slide segment, including corners, so polygons remain solid.
  /**
   * Move toward b, retaining tangential motion when a boundary blocks a–b.
   * At corners, consider touching edges and choose safe progress closest to the
   * original target. Every candidate is swept again; at most five iterations
   * bound the work. This is local wall sliding, not navigation/pathfinding.
   * Both player dragging and AI movement use this function.
   */
  function moveWithin(a, b, level, team) {
    let position = a.slice(),
      destination = b.slice();
    const boundaries = [level.walkable[team], level.blocked];
    for (let iteration = 0; iteration < 5; iteration++) {
      const result = sweepMovement(position, destination, level, team);
      const before = position;
      position = result.point;
      if (!result.contact) return position;
      const remaining = [destination[0] - position[0], destination[1] - position[1]];
      if (Math.hypot(...remaining) < EPS) break;
      // At a vertex, multiple edges may touch; prefer whichever allows
      // the most motion toward the pointer without crossing another boundary.
      let best = null,
        bestDistance = Infinity;
      for (const polygon of boundaries)
        for (const [u, v] of edges(polygon)) {
          const ex = v[0] - u[0],
            ey = v[1] - u[1],
            length2 = ex * ex + ey * ey;
          const k = Math.max(
            0,
            Math.min(1, ((result.contact[0] - u[0]) * ex + (result.contact[1] - u[1]) * ey) / length2),
          );
          const proximity = Math.hypot(result.contact[0] - u[0] - k * ex, result.contact[1] - u[1] - k * ey);
          if (proximity > 1e-3) continue;
          const dot = (remaining[0] * ex + remaining[1] * ey) / length2;
          const candidate = [position[0] + dot * ex, position[1] + dot * ey];
          const attempt = sweepMovement(position, candidate, level, team).point;
          if (distance(position, attempt) < 1e-5) continue;
          const score = distance(attempt, b);
          if (score < bestDistance) {
            best = attempt;
            bestDistance = score;
          }
        }
      if (!best || distance(before, best) < 1e-5) break;
      // Continue from the slid point toward the original pointer, allowing
      // another wall or corner to be processed within this same input event.
      position = best;
      destination = b;
    }
    return position;
  }
  /**
   * Return the earliest contact parameter along a–b, including zero if the
   * start is already inside the polygon. Return null when there is no contact.
   */
  function polygonContact(a, b, p) {
    if (inside(a, p)) return 0;
    const ts = edges(p).flatMap((e) => intersections(a, b, ...e));
    return ts.length ? Math.min(...ts) : null;
  }
  /**
   * Intersect the swept point a–b with a target circle of center c and radius r.
   * Return the first parameter in [0, 1], or null. Projectiles have no collision
   * radius: their rendered image size does not participate in this calculation.
   */
  function circleContact(a, b, c, r) {
    const x = a[0] - c[0],
      y = a[1] - c[1],
      dx = b[0] - a[0],
      dy = b[1] - a[1];
    const q = x * x + y * y - r * r;
    if (q <= 0) return 0;
    const n = dx * dx + dy * dy,
      k = 2 * (x * dx + y * dy),
      disc = k * k - 4 * n * q;
    if (n < EPS || disc < 0) return null;
    const t = (-k - Math.sqrt(disc)) / (2 * n);
    return t >= 0 && t <= 1 ? t : null;
  }
  /**
   * Return a scalar unchanged or pick one member of a nonempty array.
   * Inject random for deterministic tests; production uses Math.random.
   */
  function pick(value, random = Math.random) {
    if (!Array.isArray(value)) return value;
    if (!value.length) throw Error('Empty choice array');
    return value[Math.floor(random() * value.length)];
  }
  /**
   * Validate optional decorative scene overlays. Coordinates use the original
   * background image's pixels; zoom is relative to that image's contain scale.
   * Normalizing once keeps browser rendering free of configuration decisions.
   */
  function resolveSceneOverlays(overlays) {
    if (overlays === undefined) return [];
    if (!Array.isArray(overlays)) throw Error('overlays: expected array');
    return overlays.map((overlay, index) => {
      if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay))
        throw Error('overlays[' + index + ']: expected object');
      const { image, x, y, zoom = 1 } = overlay;
      if (typeof image !== 'string' || !image.trim())
        throw Error('overlays[' + index + '].image: expected nonempty image path');
      if (!Number.isFinite(x) || !Number.isFinite(y))
        throw Error('overlays[' + index + ']: x/y must be finite numbers');
      if (!Number.isFinite(zoom) || zoom <= 0)
        throw Error('overlays[' + index + '].zoom: expected positive finite number');
      return { image, x, y, zoom };
    });
  }
  /**
   * Resolve one level without mutating the original configuration.
   * Enemies and projectile replace global values; character directories merge
   * per team and audio merges per field. Character/enemy arrays are sampled
   * once per level start; audio path arrays are sampled for each playback.
   * Projectile is a single path (not a random array).
   * This is not a generic recursive defaults merge.
   * Throw on invalid selected values or invalid audio settings.
   */
  function resolve(config, index, random = Math.random) {
    if (!config || config.meta?.version !== 1 || !Array.isArray(config.levels) || !config.levels.length)
      throw Error('Invalid configuration / version / level list');
    const base = config.assets || {},
      item = config.levels[index];
    if (!item) throw Error('Missing level');
    const chars = { ...base.characters, ...item.characters };
    const enemies = pick(item.enemies === undefined ? base.enemies : item.enemies, random);
    const projectile = item.projectile === undefined ? base.projectile : item.projectile;
    if (typeof projectile !== 'string' || !projectile.trim())
      throw Error('projectile: expected nonempty image path');
    if (!Number.isSafeInteger(enemies) || enemies < 1 || enemies > 1000)
      throw Error('enemies: expected integer 1…1000');
    const characters = { east: pick(chars.east, random), west: pick(chars.west, random) };
    if (Object.values(characters).some((v) => typeof v !== 'string' || !v)) throw Error('Missing character directory');
    if (typeof item.image !== 'string' || !item.image) throw Error('Missing scene image');
    const audio = { groan_chance: 1, pitch_variation: 0, ...base.audio, ...item.audio };
    for (const [key, value] of Object.entries(audio)) {
      if (key === 'groan_chance' || key === 'pitch_variation') {
        if (!Number.isFinite(value) || value < 0 || value > 1)
          throw Error('audio.' + key + ': expected finite number 0…1');
        continue;
      }
      const choices = Array.isArray(value) ? value : [value];
      if (!choices.length || choices.some((v) => typeof v !== 'string' || !v))
        throw Error('audio.' + key + ': expected path or nonempty path array');
    }
    // Scoring is global: levels cannot override the central scoring contract.
    const scoring = { ...config.scoring };
    for (const key of [
      'enemy_hit', 'enemy_defeat', 'level_complete',
      'remaining_health_exponent', 'remaining_health_factor',
      'round_duration_max', 'round_duration_exponent', 'round_duration_factor', 'round_duration_round',
    ]) {
      if (!Number.isFinite(scoring[key]) || scoring[key] < 0 ||
          (key === 'round_duration_round' && scoring[key] === 0))
        throw Error('scoring.' + key + ': expected finite nonnegative number (rounding must be positive)');
    }
    return { ...item, overlays: resolveSceneOverlays(item.overlays), enemies, projectile, characters, audio, scoring };
  }
  /**
   * Validate all five polygons after the actual scene dimensions are known.
   * blocked must exist as an array, but may be empty. Separate walkable and spawn
   * polygons are required for both teams; the old flat walkable form is unsupported.
   */
  function validateLevel(level, width, height) {
    if (!(width > 0 && height > 0)) throw Error('Invalid image size');
    for (const [key, p, optional] of [
      ['walkable.west', level.walkable?.west],
      ['walkable.east', level.walkable?.east],
      ['spawn.west', level.spawn?.west],
      ['spawn.east', level.spawn?.east],
      ['blocked', level.blocked, true],
    ]) {
      const problem = polygonProblem(p, width, height, optional);
      if (problem) throw Error(key + ': ' + problem);
    }
  }
  // Finds an interior witness even in a narrow valid intersection, after random attempts.
  /**
   * Find an interior point shared by spawn and walkable, excluding blocked.
   * Partition the polygon arrangement into x-slabs, then inspect y-intervals.
   * The witness both proves that spawning is possible and provides a fallback
   * when bounded random searches miss a very narrow valid region.
   */
  function witness(level, team) {
    const polys = [level.walkable[team], level.spawn[team], level.blocked],
      es = polys.flatMap(edges);
    const xs = polys.flatMap((p) => p.map((v) => v[0]));
    for (let i = 0; i < es.length; i++)
      for (let j = i + 1; j < es.length; j++)
        for (const t of intersections(...es[i], ...es[j])) xs.push(mix(...es[i], t)[0]);
    xs.sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] - xs[i - 1] < EPS) continue;
      const x = (xs[i] + xs[i - 1]) / 2;
      const ys = es
        .filter(([a, b]) => x > Math.min(a[0], b[0]) && x < Math.max(a[0], b[0]))
        .map(([a, b]) => a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]))
        .sort((a, b) => a - b);
      for (let j = 1; j < ys.length; j++) {
        const p = [x, (ys[j - 1] + ys[j]) / 2];
        if (ys[j] - ys[j - 1] > EPS && valid(p, level, team) && inside(p, level.spawn[team])) return p;
      }
    }
    throw Error('No valid spawn area: ' + team);
  }
  /**
   * One self-contained level simulation. Construct with already resolved level
   * settings and natural scene dimensions. Supplying a repeatable random source
   * makes rule tests reproducible; normal gameplay is not seeded.
   *
   * Mutable collections:
   * - figures: stable array indexed by figure id (West is created before East).
   * - balls: live projectiles with monotonically increasing per-round ids.
   * - inputs: browser commands waiting for the next tick.
   * - events: hit/end notifications replaced at the beginning of each tick.
   * - selection: one player figure, pointer id, and initial grab offset, or null.
   *
   * score is hit points during play and the full round score after completion.
   * result is null until the round ends, then a single immutable-in-practice
   * snapshot { won, hits, health, bonus, time, elapsedSeconds, score }; subsequent steps do nothing.
   */
  class Round {
    /**
     * Create fully healed teams and prove each team has a valid spawn region.
     * Asset loading and whole-game totals belong to the browser shell, not Round.
     */
    constructor(level, width, height, random = Math.random, now = () => performance.now()) {
      validateLevel(level, width, height);
      this.level = level;
      this.scoring = { ...level.scoring };
      this.now = now;
      this.width = width;
      this.height = height;
      this.random = random;
      this.tick = 0;
      this.figures = [];
      this.balls = [];
      this.events = [];
      this.inputs = [];
      this.selection = null;
      this.score = 0;
      this.result = null;
      this.ballId = 0;
      this.witnesses = { east: witness(level, 'east'), west: witness(level, 'west') };
      for (const team of ['west', 'east']) {
        const count = team === 'east' ? 3 : level.enemies;
        for (let i = 0; i < count; i++) {
          const p = this.spawn(team);
          this.figures.push({
            id: this.figures.length,
            team,
            x: p[0],
            y: p[1],
            hp: team === 'east' ? 2 : 3,
            state: 'idle',
            until: 0,
            think: this.delay(),
            aimStart: 0,
            power: 0,
            target: null,
          });
        }
      }
      // Assets have already loaded; begin timing only once the round is ready.
      // Use elapsed real time, including pauses, rather than simulation ticks.
      // The optional monotonic clock allows exact, repeatable scoring tests.
      this.startedAt = this.now();
    }
    /**
     * Schedule the next independent AI decision, 350–900 ms from the current
     * tick, rounded up to an integer number of simulation ticks.
     */
    delay() {
      return this.tick + Math.ceil((0.35 + this.random() * 0.55) * 60);
    }
    /**
     * Choose an AI destination anywhere in the team’s valid walkable area.
     * Limit random attempts and fall back to the precomputed spawn witness.
     */
    point(team) {
      const poly = this.level.walkable[team],
        xs = poly.map((p) => p[0]),
        ys = poly.map((p) => p[1]);
      const x = Math.min(...xs),
        y = Math.min(...ys),
        w = Math.max(...xs) - x,
        h = Math.max(...ys) - y;
      for (let i = 0; i < 500; i++) {
        const p = [x + this.random() * w, y + this.random() * h];
        if (valid(p, this.level, team)) return p;
      }
      return this.witnesses[team].slice();
    }
    /**
     * Choose a legal starting point in spawn ∩ walkable, outside blocked.
     * Unlike point(), this intentionally restricts placement to the spawn polygon.
     */
    spawnPoint(team) {
      const poly = this.level.spawn[team],
        xs = poly.map((p) => p[0]),
        ys = poly.map((p) => p[1]);
      const x = Math.min(...xs),
        y = Math.min(...ys),
        w = Math.max(...xs) - x,
        h = Math.max(...ys) - y;
      for (let i = 0; i < 500; i++) {
        const p = [x + this.random() * w, y + this.random() * h];
        if (valid(p, this.level, team) && inside(p, poly)) return p;
      }
      return this.witnesses[team].slice();
    }
    /**
     * Try to separate initial teammates by 0.055 × scene height. Gradually
     * relax spacing if necessary; spacing is not a collision rule after spawning.
     */
    spawn(team) {
      const others = this.figures.filter((f) => f.team === team);
      for (const factor of [1, 0.75, 0.5, 0.25, 0])
        for (let i = 0; i < 150; i++) {
          const p = this.spawnPoint(team);
          if (others.every((f) => distance(p, [f.x, f.y]) >= this.height * 0.055 * factor)) return p;
        }
      return this.witnesses[team].slice();
    }
    /**
     * Shared throwing origin and target-circle center, at 45% of the sprite
     * height measured from its top. f.x/f.y remain the standing point.
     */
    anchor(f) {
      return [f.x, f.y - FIGURE_HEIGHT_RATIO * this.height * (FIGURE_STAND_RATIO - 0.45)];
    }
    /**
     * Buffer a down/move/up/cancel command until the next simulation step.
     * Ignore commands after completion so a finished round cannot change.
     */
    queue(input) {
      if (!this.result) this.inputs.push(input);
    }
    /**
     * Abandon the active drag/charge and queued inputs without firing.
     * The browser calls this on pause, focus changes, dialogs and navigation.
     */
    cancel() {
      if (this.selection) {
        const f = this.figures[this.selection.id];
        if (f.state === 'aiming') {
          f.state = 'idle';
          f.power = 0;
        }
      }
      this.selection = null;
      this.inputs = [];
    }
    /**
     * Apply one already validated enemy contact. Collision resolution is
     * responsible for excluding dead/protected targets. A surviving victim becomes
     * invulnerable in hit for 27 ticks. A lethal hit becomes dead immediately.
     * Only West damage awards points from scoring; a kill replaces the hit award.
     * Godmode returns before damage/events; the contacting ball still ends outside
     * this function in the contact-resolution loop.
     */
    hit(f) {
      // Developer mode protects the East team without changing its health.
      if (f.team === 'east' && Round.godMode) return;
      f.hp--;
      f.state = f.hp ? 'hit' : 'dead';
      f.until = this.tick + 27;
      f.target = null;
      f.power = 0;
      if (this.selection?.id === f.id) this.selection = null;
      if (f.team === 'west') this.score += f.hp ? this.scoring.enemy_hit : this.scoring.enemy_defeat;
      this.events.push({ type: 'hit', id: f.id });
    }
    /**
     * Advance exactly one tick. Ordering is part of the gameplay contract:
     * 1. Expire states and update charging power.
     * 2. Apply queued player input and prepare, but do not emit, throws.
     * 3. Advance AI movement/decisions and prepare its throws.
     * 4. Resolve all contacts of already flying balls in global contact-time order.
     * 5. Decide the round after all hits; simultaneous elimination is a loss.
     * 6. If play continues, emit valid pending throws for the next tick.
     * A hit can therefore cancel a throw prepared earlier in this same tick.
     */
    step() {
      if (this.result) return;
      this.tick++;
      this.events = [];
      const pending = [];
      for (const f of this.figures) {
        if ((f.state === 'hit' || f.state === 'throwing') && this.tick >= f.until) {
          f.state = 'idle';
          f.think = this.delay();
        }
        if (f.state === 'aiming') f.power = Math.min(8, Math.floor((this.tick - f.aimStart) / 5));
      }
      for (const e of this.inputs.splice(0)) {
        if (e.type === 'down' && !this.selection) {
          const f = this.figures[e.id];
          if (
            f?.team === 'east' &&
            (f.state === 'idle' || f.state === 'throwing' || pending.some((shot) => shot.f === f)) &&
            f.hp
          ) {
            this.selection = { id: f.id, pointer: e.pointer, offset: [f.x - e.p[0], f.y - e.p[1]] };
            f.state = 'aiming';
            f.aimStart = this.tick;
            f.power = 0;
          }
        } else if (this.selection && e.pointer === this.selection.pointer) {
          const f = this.figures[this.selection.id];
          if ((e.type === 'move' || e.type === 'up') && e.p) {
            const p = moveWithin(
              [f.x, f.y],
              e.p.map((v, i) => v + this.selection.offset[i]),
              this.level,
              'east',
            );
            [f.x, f.y] = p;
          }
          if (e.type === 'up') {
            pending.push({ f, power: f.power, anchor: this.anchor(f) });
            this.selection = null;
          }
          if (e.type === 'cancel') {
            f.state = 'idle';
            f.power = 0;
            this.selection = null;
          }
        }
      }
      for (const f of this.figures.filter((f) => f.team === 'west' && f.hp)) {
        if (f.state === 'aiming') {
          // AI may move and charge during startup, but cannot fire before 3 s.
          if (f.power >= f.goal && this.tick >= WEST_THROW_DELAY_TICKS)
            pending.push({ f, power: f.goal });
        } else if (f.state === 'idle') {
          if (f.target) {
            const a = [f.x, f.y],
              dist = distance(a, f.target),
              amount = Math.min(1, (this.height * 0.25 * DT) / (dist || 1));
            const want = mix(a, f.target, amount),
              p = moveWithin(a, want, this.level, 'west');
            [f.x, f.y] = p;
            if (amount >= 1 || distance(want, p) > EPS || this.tick >= f.moveEnd) {
              f.target = null;
              f.think = this.delay();
            }
          } else if (this.tick >= f.think) {
            const action = this.random();
            if (action < 0.2) f.think = this.delay();
            else if (action < 0.6) {
              f.target = this.point('west');
              f.moveEnd = this.tick + 36;
            } else {
              f.state = 'aiming';
              f.aimStart = this.tick;
              f.power = 0;
              f.goal = 5 + Math.floor(this.random() * 4);
            }
          }
        }
      }
      // Gather all contacts first, then resolve globally by contact time / ball age.
      const contacts = [],
        movements = [],
        speed = this.height * 1.2 * DT;
      for (const ball of this.balls) {
        const length = Math.min(speed, ball.remaining),
          a = [ball.x, ball.y];
        const b = [a[0] + ball.dx * length, a[1] + ball.dy * length];
        movements.push({ ball, b, length });
        const obstacle = polygonContact(a, b, this.level.blocked);
        if (obstacle !== null) contacts.push({ ball, time: (obstacle * length) / speed, priority: 0 });
        // Stop at the image edge, even if the same step extends past it.
        let border = 1;
        for (const [v, d, max] of [
          [a[0], b[0] - a[0], this.width],
          [a[1], b[1] - a[1], this.height],
        ]) {
          if (v < 0 || v > max) border = 0;
          else if (d > 0 && v + d >= max) border = Math.min(border, (max - v) / d);
          else if (d < 0 && v + d <= 0) border = Math.min(border, -v / d);
        }
        if (border < 1 || length >= ball.remaining)
          contacts.push({ ball, time: (border * length) / speed, priority: 2 });
        for (const f of this.figures) {
          if (f.team === ball.team || !f.hp || f.state === 'hit') continue;
          const t = circleContact(a, b, this.anchor(f), HIT_RADIUS_RATIO * this.height);
          if (t !== null) contacts.push({ ball, time: (t * length) / speed, priority: 1, f });
        }
      }
      contacts.sort(
        (a, b) =>
          a.time - b.time || a.ball.id - b.ball.id || a.priority - b.priority || (a.f?.id ?? -1) - (b.f?.id ?? -1),
      );
      for (const c of contacts) {
        if (c.ball.ended) continue;
        if (c.f) {
          if (!c.f.hp || c.f.state === 'hit') continue;
          this.hit(c.f);
        }
        c.ball.ended = true;
      }
      for (const { ball, b, length } of movements) {
        [ball.x, ball.y] = b;
        ball.remaining -= length;
      }
      this.balls = this.balls.filter((b) => !b.ended && b.remaining > EPS);
      const east = this.figures.filter((f) => f.team === 'east' && f.hp),
        west = this.figures.filter((f) => f.team === 'west' && f.hp);
      if (!east.length || !west.length) {
        const won = east.length > 0,
          scoring = this.scoring,
          remainingHealth = east.reduce((n, f) => n + Math.max(0, f.hp), 0),
          health = remainingHealth > 0
            ? Math.pow(remainingHealth, scoring.remaining_health_exponent) * scoring.remaining_health_factor
            : 0,
          bonus = won ? scoring.level_complete : 0,
          elapsedSeconds = Math.max(0, this.now() - this.startedAt) / 1000,
          remainingTime = Math.max(0, scoring.round_duration_max - elapsedSeconds);
        // The duration limit only gates the bonus; it never ends a round.
        // Explicitly gate zero time even for an exponent of zero (0 ** 0 = 1).
        const rawTimeBonus = won && remainingTime > 0
          ? Math.pow(remainingTime, scoring.round_duration_exponent) * scoring.round_duration_factor
          : 0;
        const time = Math.max(0,
          Math.round(rawTimeBonus / scoring.round_duration_round) * scoring.round_duration_round);
        // Keep fractional exponents/factors and all intermediate precision. Round
        // the final level score once so totals, animation and POSTs stay integers.
        const score = Math.max(0, Math.round(this.score + health + bonus + time));
        this.result = { won, hits: this.score, health, bonus, time, elapsedSeconds, score };
        this.score = this.result.score;
        this.balls = [];
        this.cancel();
        this.events.push({ type: 'end', ...this.result });
        return;
      }
      for (const { f, power, anchor } of pending) {
        if (!f.hp || f.state === 'hit') continue;
        if (this.selection?.id !== f.id) {
          f.state = 'throwing';
          f.until = this.tick + 11;
          f.power = 0;
        }
        if (!power) continue;
        const [x, y] = anchor ?? this.anchor(f),
          sign = f.team === 'east' ? -1 : 1;
        this.balls.push({
          id: this.ballId++,
          team: f.team,
          x,
          y,
          dx: sign * Math.cos(THROW_ANGLE),
          dy: sign * Math.sin(THROW_ANGLE),
          remaining: power * 0.11 * this.height,
          power,
        });
      }
    }
  }
  Round.godMode = false; // Reset by a full page reload, not by a new round.

  /**
   * Sample the playback-rate variation around 1. Clamp to 0.01 so even
   * variation=1 never requests an unusable zero playback rate.
   */
  function audioRate(variation = 0, random = Math.random) {
    return Math.max(0.01, 1 + (random() * 2 - 1) * variation);
  }
  /**
   * Request a hit sound for each registered hit, plus an independently gated
   * groan. play() chooses the actual file and a separate pitch sample per sound.
   * Missing audio paths are intentionally handled as silence by the browser.
   */
  function hitAudio(audio, play, random = Math.random) {
    play(audio.sfx_hit, false, audio.pitch_variation ?? 0);
    if (random() < (audio.groan_chance ?? 1)) play(audio.sfx_groan, false, audio.pitch_variation ?? 0);
  }
  /**
   * Fit an image proportionally into a 24-world-pixel square. This affects
   * only drawing; collision still treats the projectile as a point.
   */
  function projectileSize(width, height) {
    const factor = 24 / Math.max(width, height);
    return [width * factor, height * factor];
  }
  /**
   * Public rule API shared by browser play and Node tests. Keep browser-only
   * objects out of this export so requiring the script does not need a DOM.
   */
  const api = {
    version: '1.0',
    audioRate,
    hitAudio,
    projectileSize,
    FIGURE_HEIGHT_RATIO,
    FIGURE_STAND_RATIO,
    HIT_RADIUS_RATIO,
    THROW_ANGLE,
    DT,
    STATES,
    inside,
    intersections,
    polygonProblem,
    polygonContact,
    circleContact,
    moveWithin,
    valid,
    pick,
    resolve,
    validateLevel,
    witness,
    Round,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CityRumble = api;
})(typeof window !== 'undefined' ? window : globalThis);

(() => {
  'use strict';

  /* Browser startup: classic scripts also work when index.html is opened via file://. */
  /**
   * Load one classic script or stylesheet relative to document.baseURI.
   * Reject missing resources, matching script errors, or a 15-second timeout.
   * Only errors from this script URL belong to this loading operation.
   */
  function loadResource(type, path) {
    return new Promise((resolve, reject) => {
      const element = document.createElement(type);
      const url = new URL(path, document.baseURI).href;
      const script = type === 'script';
      const timeout = setTimeout(() => finish(new Error('Zeitüberschreitung: ' + path)), 15000);
      function finish(error) {
        clearTimeout(timeout);
        if (script) window.removeEventListener('error', scriptError);
        element.onload = element.onerror = null;
        if (error) reject(error);
        else resolve();
      }
      function scriptError(event) {
        if (event.filename === url) finish(new Error((event.message || 'JavaScript-Fehler') + ' (' + path + ')'));
      }
      element.onload = () => finish();
      element.onerror = () => finish(new Error('Datei nicht ladbar: ' + path));
      if (script) {
        window.addEventListener('error', scriptError);
        element.src = path;
      } else {
        element.rel = 'stylesheet';
        element.href = path;
      }
      document.head.append(element);
    });
  }

  /**
   * Load CSS, configuration and every declared language in order, then create
   * the game. German is mandatory as the text fallback. A missing language file
   * is a startup error even when that language is not initially selected.
   */
  async function boot() {
    await loadResource('link', 'assets/css/style.css');
    await loadResource('script', 'assets/config/game.js');
    const config = window.gameConfig;
    if (!config || typeof config !== 'object') throw new Error('Spielkonfiguration fehlt (assets/config/game.js)');
    const languages = config.languages;
    if (
      !languages ||
      typeof languages !== 'object' ||
      Array.isArray(languages) ||
      !Object.keys(languages).length ||
      !Object.hasOwn(languages, 'de')
    ) {
      throw new Error('Ungültige Sprachkonfiguration (Deutsch wird benötigt)');
    }
    window.CITY_RUMBLE_TEXTS = {};
    for (const [code, name] of Object.entries(languages)) {
      if (!/^[a-z]{2,8}$/.test(code) || typeof name !== 'string' || !name.trim()) {
        throw new Error('Ungültiger Spracheintrag: ' + code);
      }
      await loadResource('script', 'assets/lang/' + code + '.js');
      if (!window.CITY_RUMBLE_TEXTS[code] || typeof window.CITY_RUMBLE_TEXTS[code] !== 'object') {
        throw new Error('Sprachdaten fehlen: ' + code);
      }
    }
    startGame(config);
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    boot().catch((error) => {
      const message = document.createElement('p');
      message.setAttribute('role', 'alert');
      message.textContent = 'Das Spiel konnte nicht gestartet werden. / The game could not start. ' + error.message;
      document.body.replaceChildren(message);
    });
  }

  /* Browser shell: canvas, input, audio and highscore submission. */
  /**
   * Own the browser application for the lifetime of this page. The closures
   * below share navigation, rendering, audio and reporting state; Round owns
   * only the current simulation. Only the explicitly selected language is persisted locally.
   */
  function startGame(config) {
    const E = window.CityRumble,
      $ = (id) => document.getElementById(id);

    // All application DOM lives inside the stage.
    /**
     * Build all controls and overlays within the stage. Separate canvases draw
     * scene background and foreground figures around animated DOM GIF overlays.
     * Menus, status and information windows are DOM.
     */
    const stage = document.createElement('main');
    stage.id = 'stage';
    stage.innerHTML = `
      <canvas id="game" tabindex="0"></canvas>
      <div id="gamebar" class="game-hud" hidden>
        <div class="hud-level"><small id="roundlabel"></small><strong id="levelname"></strong></div>
      </div>
      <div id="game-controls">
        <select id="language" aria-label="Sprache / Language"></select>
        <button id="pause" type="button" class="quiet" hidden></button>
        <button id="fullscreen" type="button" class="icon-button" aria-label="Vollbild" title="Vollbild" aria-pressed="false">⛶</button>
        <button id="exitfullscreen" type="button" class="icon-button" hidden aria-label="Vollbild beenden" title="Vollbild beenden">×</button>
      </div>
      <div id="overlay"><section id="panel" role="region" aria-live="polite"></section></div>
      <div id="loading" role="status" hidden></div>
      <div id="info-window" role="dialog" aria-modal="true" aria-label="Informationen" hidden>
        <div id="info-box"><button id="info-close" type="button" aria-label="Schließen" title="Schließen">×</button>
          <iframe id="info-frame" title="Informationen" loading="eager"></iframe>
        </div>
      </div>`;
    document.body.append(stage);
    const canvas = $('game'),
      backgroundCtx = canvas.getContext('2d'),
      panel = $('panel');
    // Native animated GIFs cannot be animated via canvas drawImage().
    // Keep GIFs between a background canvas and a transparent foreground
    // canvas. Both upper layers ignore pointer input, preserving #game events.
    const sceneOverlays = document.createElement('div');
    sceneOverlays.id = 'scene-overlays';
    sceneOverlays.hidden = true;
    sceneOverlays.setAttribute('aria-hidden', 'true');
    Object.assign(sceneOverlays.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      transformOrigin: 'top left',
      zIndex: '1',
    });
    canvas.after(sceneOverlays);
    const foregroundCanvas = document.createElement('canvas');
    foregroundCanvas.id = 'scene-foreground';
    foregroundCanvas.setAttribute('aria-hidden', 'true');
    Object.assign(foregroundCanvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '2',
    });
    sceneOverlays.after(foregroundCanvas);
    const ctx = foregroundCanvas.getContext('2d');
    const infoWindow = $('info-window'),
      infoFrame = $('info-frame');
    for (const [code, name] of Object.entries(config.languages)) {
      const option = document.createElement('option');
      option.value = code;
      option.lang = code;
      option.dir = 'auto';
      option.textContent = name;
      $('language').append(option);
    }
    const icon = config.assets?.characters?.east;
    const iconDirectory = Array.isArray(icon) ? icon[0] : icon;
    if (typeof iconDirectory === 'string') {
      const favicon = document.createElement('link');
      favicon.rel = 'icon';
      favicon.href = iconDirectory + '/char_east_aiming.webp';
      document.head.append(favicon);
    }
    /**
     * Resource lifetimes are page-wide: image promises are cached by path,
     * audio elements are pooled by path, and tracks identifies active playback.
     * Scene entries are evicted on navigation so unique telemetry URLs do not
     * accumulate. Other images, including failed loads, stay cached.
     */
    const cache = new Map(),
      tracks = new Set(),
      audioPool = new Map();
    /**
     * Navigation modes: menu, orientation, loading, playing, result, error.
     * paused, infoOpen and immersive are independent flags rather than modes.
     * round/index represent the current level; total includes completed rounds only.
     * lastResult supplies the result UI and the optional final named submission.
     */
    // Persist only an explicitly selected, two-letter language code. The browser
    // preference is consulted when no usable choice has been saved.
    const languageStorageKey = 'city-rumble:language';
    function initialLanguage() {
      try {
        const saved = window.localStorage.getItem(languageStorageKey);
        if (saved && Object.hasOwn(config.languages, saved)) return saved;
      } catch {
        // Storage can be disabled, particularly for file:// pages.
      }
      const preferred = Array.isArray(navigator.languages) && navigator.languages.length
        ? navigator.languages
        : [navigator.language];
      for (const locale of preferred) {
        if (typeof locale !== 'string') continue;
        const code = locale.toLowerCase().split(/[-_]/)[0];
        if (Object.hasOwn(config.languages, code)) return code;
      }
      return 'de';
    }
    let lang = initialLanguage(),
      mode = 'menu',
      round = null,
      index = 0,
      total = 0,
      lastResult = null;
    let animatedScore = null;
    /**
     * token invalidates stale asynchronous UI/loading completions after a new
     * level or return home. It does not cancel already queued network requests.
     */
    let paused = false,
      immersive = false,
      music = null,
      token = 0,
      infoOpen = false;
    let projectile = null,
      menuBackground = null;
    let showPolygons = false; // Remains active between rounds and levels.
    let debugRun = false; // Do not submit scores after gameplay cheats.
    /**
     * Visual rotation metadata is per projectile and collectible when its ball
     * disappears. No additional timers or simulation fields are required.
     */
    const rotations = new WeakMap();
    let sceneImageURL = null,
      background = null,
      sprites = {},
      selectionPointer = null,
      saved = false,
      error = '';
    let cw = 1,
      ch = 1,
      scale = 1,
      ox = 0,
      oy = 0,
      previous = 0,
      accumulator = 0;
    // One identity per page visit, including all successive playthroughs.
    const clientId =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
            return (c === 'x' ? r : (r & 3) | 8).toString(16);
          });
    const online = location.protocol === 'http:' || location.protocol === 'https:';
    let reports = Promise.resolve(),
      reportStatus = '';
    /**
     * Queue an immutable snapshot of one score report. A per-page promise chain
     * preserves Start → level results → final name ordering, including failures.
     * HTTP(S) only; debugRun suppresses further reports until page reload.
     * Return a Promise<boolean>; network/HTTP failures never interrupt gameplay.
     * There is a 10-second timeout, but no retry or persistent offline queue.
     */
    function reportScore(level, score, name = '') {
      if (debugRun) return Promise.resolve(false);
      // Snapshot the payload now, and serialize requests so Start/levels/name stay ordered.
      const body = new URLSearchParams({ id: clientId, name, level, score: String(score) });
      const send = async () => {
        if (!online) return false;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch('api/highscores', { method: 'POST', body, signal: controller.signal, keepalive: true });
          return response.ok;
        } catch {
          return false;
        } finally {
          clearTimeout(timeout);
        }
      };
      const result = reports.then(send);
      reports = result.then(() => undefined);
      return result;
    }
    /**
     * Translate a stable key, falling back to German and then the key itself.
     * Replace named {placeholders}; leave a placeholder intact if no value exists.
     */
    function t(key, values = {}) {
      const text = window.CITY_RUMBLE_TEXTS[lang]?.[key] ?? window.CITY_RUMBLE_TEXTS.de?.[key] ?? key;
      return text.replace(/\{(\w+)\}/g, (m, k) => (values[k] === undefined ? m : String(values[k])));
    }
    const number = (n) => n.toLocaleString(lang);
    /**
     * Create UI text using textContent, not HTML interpolation. Translation
     * strings and user-facing data therefore do not become executable markup.
     */
    function node(tag, text, className) {
      const el = document.createElement(tag);
      if (text !== undefined) el.textContent = text;
      if (className) el.className = className;
      return el;
    }
    /**
     * Construct a translated non-submit button wired to one action.
     * The explicit type prevents accidental form submission when reused in forms.
     */
    function button(key, action, className = '') {
      const el = node('button', t(key), className);
      el.type = 'button';
      el.onclick = action;
      return el;
    }
    /**
     * Cache successful image loads by configured path for reuse across levels.
     * Failed loads and 15-second timeouts must be retried on the next request.
     * Only evict the failed promise itself: an older request must not delete a
     * newer cache entry (e.g. after discardSceneImage).
     */
    function loadImage(path) {
      if (!cache.has(path)) {
        const pending = new Promise((resolve, reject) => {
          const img = new Image();
          let finished = false;
          const finish = (err) => {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            img.onload = img.onerror = null;
            if (err) reject(err);
            else resolve(img);
          };
          const timeout = setTimeout(() => finish(Error('Image timeout: ' + path)), 15000);
          img.onload = () => finish();
          img.onerror = () => finish(Error('Image unavailable: ' + path));
          img.src = path;
        }).catch((err) => {
          if (cache.get(path) === pending) cache.delete(path);
          throw err;
        });
        cache.set(path, pending);
      }
      return cache.get(path);
    }
    // Remove the cache reference without changing the currently displayed image.
    function discardSceneImage() {
      if (sceneImageURL === null) return;
      cache.delete(sceneImageURL);
      sceneImageURL = null;
    }
    /**
     * Append display telemetry only to scene requests. Screen dimensions use
     * CSS pixels; the primary pointer determines the input category on hybrids.
     * A random value distinguishes requests without identifying a visitor.
     */
    function loadSceneImage(path) {
      const width = screen.width || window.innerWidth;
      const height = screen.height || window.innerHeight;
      const orientation = screen.orientation?.type?.startsWith('portrait')
        ? 'portrait'
        : screen.orientation?.type?.startsWith('landscape')
          ? 'landscape'
          : window.innerHeight > window.innerWidth ? 'portrait' : 'landscape';
      const input = window.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'pointer';
      const query = new URLSearchParams({
        width: String(width),
        height: String(height),
        orientation,
        input,
        lang,
        random: String(Math.floor(Math.random() * 1000000000)),
      });
      sceneImageURL = path + (path.includes('?') ? '&' : '?') + query.toString();
      return loadImage(sceneImageURL);
    }
    /**
     * Remove previous-level GIFs on navigation, including still-loading images.
     * GIF requests use their configured URLs directly, without scene telemetry.
     */
    function clearSceneOverlays() {
      sceneOverlays.replaceChildren();
      sceneOverlays.hidden = true;
    }
    /**
     * DOM images animate natively. Appending in configuration order preserves
     * overlap order. Each image is anchored at its upper-left world coordinate;
     * zoom acts before the common scene scale. A missing decoration is optional.
     */
    function configureSceneOverlays(overlays) {
      clearSceneOverlays();
      for (const overlay of overlays) {
        const img = document.createElement('img');
        img.alt = '';
        img.draggable = false;
        img.style.position = 'absolute';
        img.style.left = overlay.x + 'px';
        img.style.top = overlay.y + 'px';
        img.style.transformOrigin = 'top left';
        img.style.transform = `scale(${overlay.zoom})`;
        img.onerror = () => {
          img.remove();
          console.warn('Scene overlay unavailable: ' + overlay.image);
        };
        sceneOverlays.append(img);
        img.src = overlay.image;
      }
    }
    /**
     * Clip animated decorations to the sharp scene rectangle and reuse exactly
     * the canvas's centered contain transform, including fullscreen and resize.
     * Its children are sized in original image pixels, not viewport pixels.
     */
    function positionSceneOverlays() {
      const active = background && round && (mode === 'playing' || mode === 'result');
      sceneOverlays.hidden = !active;
      if (!active) return;
      sceneOverlays.style.left = ox + 'px';
      sceneOverlays.style.top = oy + 'px';
      sceneOverlays.style.width = background.naturalWidth + 'px';
      sceneOverlays.style.height = background.naturalHeight + 'px';
      sceneOverlays.style.transform = `scale(${scale})`;
    }
    /**
     * Local file URLs have no reliable cross-browser existence API. Try fetch
     * first, then a disposable iframe probe where local DOM access is allowed.
     * If neither probe can confirm the real file, use the bundled demo page.
     * HTTP(S) always uses the server-managed highscores.html unchanged.
     */
    async function highscorePage() {
      const primary = 'assets/info/highscores.html';
      if (location.protocol !== 'file:') return primary;
      try {
        const response = await fetch(primary);
        if (response.ok || (response.status === 0 && (await response.text()).length > 0)) return primary;
      } catch {
        // Most browsers block fetch() from file:// origins.
      }
      return new Promise((resolve) => {
        const probe = document.createElement('iframe');
        probe.hidden = true;
        probe.setAttribute('aria-hidden', 'true');
        let finished = false;
        let timeout;
        const finish = (exists) => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          probe.remove();
          resolve(exists ? primary : 'assets/info/highscores.dist.html');
        };
        probe.onload = () => {
          let exists = false;
          try {
            const doc = probe.contentDocument;
            exists = !!doc && doc.URL === new URL(primary, document.baseURI).href
              && doc.documentElement?.localName === 'html';
          } catch {
            // Local iframe documents may also have opaque origins.
          }
          finish(exists);
        };
        probe.onerror = () => finish(false);
        timeout = setTimeout(() => finish(false), 1200);
        probe.src = primary;
        document.body.append(probe);
      });
    }
    let infoLoadId = 0;
    /**
     * Open one allowed information page in the shared modal iframe.
     * Manual/license paths follow the selected language; scores always use the
     * static generated HTML. Pause simulation through infoOpen without resetting
     * the underlying mode or result. HTML pages own their own CSS and Markdown.
     */
    function openInfo(kind) {
      if (!['manual', 'license', 'scores'].includes(kind)) return;
      clearPointer();
      previous = 0;
      accumulator = 0;
      infoOpen = true;
      infoWindow.dir = kind !== 'scores' && lang === 'ar' ? 'rtl' : 'ltr';
      infoWindow.hidden = false;
      infoFrame.title = t(kind === 'manual' ? 'menu.manual' : kind === 'license' ? 'menu.license' : 'menu.scores');
      const loadId = ++infoLoadId;
      if (kind === 'scores' && location.protocol === 'file:') {
        infoFrame.removeAttribute('src');
        void highscorePage().then((path) => {
          if (infoOpen && loadId === infoLoadId) infoFrame.src = path;
        });
      } else {
        infoFrame.src = kind === 'scores' ? 'assets/info/highscores.html' : `assets/info/${kind}-${lang}.html`;
      }
      $('info-close').setAttribute('aria-label', t('info.close'));
      $('info-close').title = t('info.close');
      $('info-close').focus({ preventScroll: true });
    }
    /**
     * Unload the iframe and reset frame timing so time spent in the dialog is
     * not simulated on return. Restore canvas focus only for active, unpaused play.
     */
    function closeInfo() {
      if (!infoOpen) return;
      infoOpen = false;
      ++infoLoadId;
      infoWindow.hidden = true;
      infoFrame.removeAttribute('src');
      previous = 0;
      accumulator = 0;
      if (mode === 'playing' && !paused) canvas.focus({ preventScroll: true });
    }
    /**
     * Submit the optional name once for a final result. Remove control characters,
     * trim and cap at 24 UTF-16 code units. Empty input is a no-op. A fully won run
     * uses COMPLETED only for this named report; ordinary results use level names.
     * saved is set before awaiting the request, preventing duplicate submissions;
     * it also means a failed send has no retry form in the current implementation.
     */
    async function saveScore(name) {
      if (location.protocol === 'file:' || saved || mode !== 'result' || !lastResult?.final) return;
      name = name
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .trim()
        .slice(0, 24);
      if (!name) return;
      const own = token;
      saved = true;
      reportStatus = 'scores.sending';
      const level = lastResult.final && lastResult.won ? 'COMPLETED' : lastResult.level;
      const pending = reportScore(level, lastResult.total, name);
      renderUI();
      const ok = await pending;
      if (own !== token) return;
      reportStatus = ok ? 'scores.saved' : 'scores.failed';
      renderUI();
    }
    /**
     * Reuse an idle/ended audio element or allocate another for overlapping
     * playback of the same path. Completion/error removes it from active tracks,
     * while the pool retains it for a later sound.
     */
    function audioFor(path) {
      if (!audioPool.has(path)) audioPool.set(path, []);
      const pool = audioPool.get(path);
      const available = pool.find((audio) => audio.paused || audio.ended);
      if (available) return available;
      const audio = new Audio();
      audio.preload = 'auto';
      audio.src = path;
      audio.onended = () => tracks.delete(audio);
      audio.onerror = () => tracks.delete(audio);
      pool.push(audio);
      return audio;
    }
    /**
     * Warm all configured global/level audio paths. Numeric audio settings
     * are skipped. Preloading is best-effort and does not gate level startup.
     */
    function preloadAudio() {
      const groups = [config?.assets?.audio, ...(config?.levels ?? []).map((level) => level.audio)];
      for (const group of groups) {
        for (const path of Object.values(group ?? {}).flat()) {
          if (typeof path === 'string' && path && !audioPool.has(path)) audioFor(path).load();
        }
      }
    }
    /**
     * Choose a path per playback, reset pooled state and request audio.
     * Looping music uses volume 0.25; other sounds use 0.55. Pitch preservation
     * is disabled so playbackRate changes both duration and pitch. Rejected
     * autoplay is handled silently, allowing later user interaction to retry music.
     */
    function play(path, loop = false, variation = 0) {
      if (!path) return null;
      const selected = Array.isArray(path) && !path.length ? null : E.pick(path);
      if (typeof selected !== 'string' || !selected) return null;
      const audio = audioFor(selected);
      if (audio.currentTime) audio.currentTime = 0;
      audio.playbackRate = variation ? E.audioRate(variation) : 1;
      audio.preservesPitch = false;
      audio.mozPreservesPitch = false;
      audio.webkitPreservesPitch = false;
      audio.volume = loop ? 0.25 : 0.55;
      audio.loop = loop;
      tracks.add(audio);
      const promise = audio.play();
      if (promise)
        promise.catch(() => {
          if (audio.paused) {
            tracks.delete(audio);
            if (music === audio) music = null;
          }
        });
      return audio;
    }
    /**
     * Stop only the tracked music loop; other active sounds are independent.
     */
    function stopMusic() {
      if (music) {
        music.pause();
        tracks.delete(music);
        music = null;
      }
    }
    /**
     * Reconcile music with navigation: play in the main menu and final result,
     * stop elsewhere. Uses global menu_music, not a level-specific audio override.
     */
    function menuMusic() {
      if (mode === 'menu' || (mode === 'result' && lastResult.final)) {
        if (!music) music = play(config.assets?.audio?.menu_music, true);
      } else stopMusic();
    }
    /**
     * Cancel model input and release browser pointer capture together.
     * Use this before transitions so an old release cannot fire in a new context.
     */
    function clearPointer() {
      round?.cancel();
      if (selectionPointer !== null && canvas.hasPointerCapture(selectionPointer))
        canvas.releasePointerCapture(selectionPointer);
      selectionPointer = null;
    }
    /**
     * Pause or resume a playing round without resetting it. Cancel any drag and
     * reset timing in both directions. Pausing stops active non-music sounds;
     * resuming does not explicitly continue those interrupted sound effects.
     */
    function setPause(value) {
      if (mode !== 'playing') return;
      paused = value;
      clearPointer();
      accumulator = 0;
      previous = 0;
      if (value) for (const a of tracks) if (a !== music) a.pause();
      renderUI();
    }
    function loadMenuBackground() {
      const path = config.assets?.menu_background;
      if (!path || menuBackground) return;
      loadImage(path)
        .then((img) => {
          menuBackground = img;
          if (mode === 'menu' || mode === 'orientation') resize();
        })
        .catch(() => {
          // The menu works without its background. Try again on return.
        });
    }
    /**
     * Discard the current playthrough, close information/fullscreen and reset
     * score UI. Language, client identity, reusable assets, polygon display,
     * godmode and the sticky debugRun flag deliberately survive this transition.
     */
    function home() {
      closeInfo();
      exitFullscreen();
      token++;
      clearPointer();
      round = null;
      discardSceneImage();
      clearSceneOverlays();
      if (background && backdropImage === background) {
        backdropImage = null;
        blurredBackdrop = null;
      }
      background = null;
      mode = 'menu';
      paused = false;
      total = 0;
      lastResult = null;
      saved = false;
      reportStatus = '';
      renderUI();
      resize();
      loadMenuBackground();
    }
    /**
     * Use touch capability or a coarse pointer plus viewport orientation as
     * a heuristic for the optional landscape/fullscreen recommendation.
     */
    function portraitMobile() {
      return (navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches) && innerHeight > innerWidth;
    }
    /**
     * Show the mobile orientation recommendation when applicable; otherwise
     * start a fresh run immediately. The recommendation can be bypassed.
     */
    function requestStart() {
      if (portraitMobile()) {
        mode = 'orientation';
        renderUI();
        resize();
      } else startLevel(0, true);
    }
    /**
     * Synchronize immersive CSS, controls and timing independently of native
     * fullscreen support. This permits a viewport-filling fallback on browsers
     * that reject or do not expose the Fullscreen API.
     */
    function applyFullscreen(value) {
      immersive = value;
      document.body.classList.toggle('immersive', value);
      $('exitfullscreen').hidden = !value;
      $('fullscreen').hidden = value;
      clearPointer();
      previous = 0;
      accumulator = 0;
      requestAnimationFrame(resize);
    }
    /**
     * Apply the immersive layout first, then request native fullscreen if
     * available. A rejected request leaves the CSS fallback active.
     */
    async function enterFullscreen() {
      applyFullscreen(true);
      // Even without a native Fullscreen API, give the field the whole browser viewport.
      try {
        if (stage.requestFullscreen) await stage.requestFullscreen();
        else if (stage.webkitRequestFullscreen) await stage.webkitRequestFullscreen();
      } catch {
        /* Keep the viewport-filling layout when native fullscreen is unavailable. */
      }
    }
    /**
     * Restore normal controls/layout and leave native fullscreen if active.
     * Browser-provided exit controls may have already completed the native step.
     */
    async function exitFullscreen() {
      applyFullscreen(false);
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (document.webkitFullscreenElement) await document.webkitExitFullscreen();
      } catch {
        /* The browser may already have exited via its own controls. */
      }
    }
    /**
     * Reflect browser-initiated native fullscreen transitions in the local UI.
     */
    function fullscreenChanged() {
      applyFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
    }
    document.addEventListener('fullscreenchange', fullscreenChanged);
    document.addEventListener('webkitfullscreenchange', fullscreenChanged);
    /**
     * Start one resolved level, optionally resetting the whole playthrough.
     * Normal next-level requests are accepted only from result; fresh/debug calls
     * can enter through their explicit paths. Load all required graphics before
     * constructing Round. token prevents an older load from replacing a newer view.
     * Report Start only after successful creation of a fresh first round.
     */
    async function startLevel(next, fresh = false, debugOverride = false) {
      if (mode === 'loading' || (!fresh && !debugOverride && mode !== 'result')) return;
      const own = ++token;
      closeInfo();
      clearPointer();
      stopMusic();
      mode = 'loading';
      discardSceneImage();
      clearSceneOverlays();
      paused = false;
      if (fresh) {
        total = 0;
        saved = false;
        lastResult = null;
        reportStatus = '';
      }
      index = next;
      round = null;
      renderUI();
      try {
        const level = E.resolve(config, index);
        const ammo = await loadImage(level.projectile);
        if (own !== token) return;
        const bg = await loadSceneImage(level.image);
        if (own !== token) return;
        const images = {};
        for (const team of ['east', 'west'])
          images[team] = Object.fromEntries(
            await Promise.all(
              E.STATES.map(async (state) => [
                state,
                await loadImage(level.characters[team] + '/char_' + team + '_' + state + '.webp'),
              ]),
            ),
          );
        if (own !== token) return;
        const model = new E.Round(level, bg.naturalWidth, bg.naturalHeight);
        projectile = ammo;
        background = bg;
        sprites = images;
        round = model;
        configureSceneOverlays(level.overlays);
        mode = 'playing';
        if (fresh) reportScore('Start', 0);
        previous = 0;
        accumulator = 0;
        resize();
        renderUI();
        play(level.audio.cue_start);
        canvas.focus({ preventScroll: true });
      } catch (err) {
        if (own !== token) return;
        discardSceneImage();
        error = err.message;
        mode = 'error';
        renderUI();
      }
    }
    /**
     * Consume the model result exactly once while still in playing mode.
     * Add round points to the run total, snapshot the display animation, queue
     * the regular unnamed level report, and enter the result UI.
     */
    function endRound() {
      if (mode !== 'playing' || !round.result) return;
      clearPointer();
      const previousTotal = total;
      total += round.result.score;
      lastResult = {
        won: round.result.won,
        final: !round.result.won || index === config.levels.length - 1,
        level: round.level.name,
        previousTotal,
        total,
        startedAt: performance.now(),
      };
      mode = 'result';
      reportScore(lastResult.level, total);
      play(round.level.audio[round.result.won ? 'cue_win' : 'cue_lose']);
      renderUI();
    }
    /**
     * Show the previous total for 1000 ms, then interpolate to the new total
     * over 1000 ms. This display-only animation never changes stored scores and
     * does not delay navigation or submission.
     */
    function updateResultScore(now) {
      const { previousTotal, total, startedAt } = lastResult;
      const progress = Math.min(1, Math.max(0, (now - startedAt - 1000) / 1000));
      const points = previousTotal + Math.floor((total - previousTotal) * progress);
      const label = number(points);
      if (animatedScore.textContent !== label) animatedScore.textContent = label;
      if (points === total) animatedScore = null;
    }
    /**
     * Rebuild the HTML overlay for the current mode and update shared controls.
     * Preserve a draft name across rerenders; do not mutate simulation rules here.
     * Only round/level appear in the live HUD, not live scores or team counters.
     */
    function renderUI() {
      menuMusic();
      const nameInput = $('playername'),
        draft = nameInput?.value;
      document.documentElement.lang = lang;
      // Scope reading direction to UI elements so the stage keeps its
      // physical layout and the canvas keeps its existing coordinates.
      const direction = lang === 'ar' ? 'rtl' : 'ltr';
      panel.dir = direction;
      $('gamebar').dir = direction;
      $('language').dir = direction;
      $('pause').dir = direction;
      $('loading').dir = direction;
      document.title = `${config?.meta?.game || 'City Rumble'} · ${config?.meta?.edition || ''}`;
      $('pause').textContent = t(paused ? 'ui.resume' : 'ui.pause');
      $('pause').hidden = mode !== 'playing';
      $('fullscreen').setAttribute('aria-label', t('ui.fullscreen'));
      $('fullscreen').title = t('ui.fullscreen');
      $('fullscreen').setAttribute('aria-pressed', String(immersive));
      $('exitfullscreen').setAttribute('aria-label', t('ui.fullscreen.exit'));
      $('exitfullscreen').title = t('ui.fullscreen.exit');
      $('language').hidden = mode !== 'menu';
      $('language').value = lang;
      canvas.setAttribute('aria-label', t('game.canvas'));
      $('gamebar').hidden = !round || mode === 'menu' || mode === 'orientation';
      $('loading').hidden = mode !== 'loading';
      $('loading').textContent = t('ui.loading');
      $('overlay').hidden = mode === 'loading' || (mode === 'playing' && !paused);
      stage.classList.toggle('is-menu', mode === 'menu' || mode === 'orientation');
      animatedScore = null;
      panel.className = '';
      panel.replaceChildren();
      if (mode === 'menu') {
        panel.className = 'menu';
        const actions = node('div', undefined, 'menu-actions');
        actions.append(button('menu.start', requestStart, 'primary big'));
        const secondary = node('div', undefined, 'menu-secondary');
        secondary.append(
          button('menu.manual', () => openInfo('manual')),
          button('menu.scores', () => openInfo('scores')),
          button('menu.license', () => openInfo('license')),
        );
        actions.append(secondary);
        panel.append(actions);
      } else if (mode === 'orientation') {
        panel.append(node('h2', t('mobile.title')), node('p', t('mobile.advice'), 'subtitle'));
        const actions = node('div', undefined, 'actions');
        actions.append(
          button(
            'mobile.fullscreen',
            () => {
              enterFullscreen();
              startLevel(0, true);
            },
            'primary',
          ),
          button('mobile.continue', () => startLevel(0, true)),
          button('menu.back', home),
        );
        panel.append(actions);
      } else if (mode === 'playing' && paused) {
        panel.append(
          node('p', round.level.name, 'eyebrow'),
          node('h2', t('ui.paused')),
          node('p', t('ui.paused.desc'), 'subtitle'),
        );
        const actions = node('div', undefined, 'actions');
        actions.append(
          button('ui.resume', () => setPause(false), 'primary'),
          button('menu.home', home),
        );
        panel.append(actions);
      } else if (mode === 'result') {
        const r = lastResult,
          key = !r.won ? 'round.lose' : r.final ? 'round.complete' : 'round.win';
        panel.append(node('p', round.level.name, 'eyebrow'), node('h2', t(key)));
        if (r.final) panel.append(node('p', t(r.won ? 'round.complete.desc' : 'round.lose.desc'), 'subtitle'));
        animatedScore = node('div', undefined, 'resultscore');
        animatedScore.setAttribute('aria-live', 'off');
        panel.append(animatedScore);
        updateResultScore(performance.now());
        if (r.final && location.protocol === 'file:') {
          panel.append(node('p', t('scores.disabled'), 'smallnote'));
        } else if (r.final && !saved) {
          const form = node('form'),
            input = node('input');
          input.id = 'playername';
          input.dir = 'auto';
          input.maxLength = 24;
          input.autocomplete = 'off';
          input.setAttribute('aria-label', t('scores.name'));
          input.placeholder = t('scores.name');
          input.value = draft || '';
          const submit = node('button', t('scores.save'), 'primary');
          submit.type = 'submit';
          form.append(input, submit);
          form.onsubmit = (e) => {
            e.preventDefault();
            saveScore(input.value);
          };
          panel.append(form);
        } else if (saved) panel.append(node('p', t(reportStatus || 'scores.saved'), 'smallnote'));
        const actions = node('div', undefined, 'actions');
        if (r.final) actions.append(button('menu.home', home, 'primary'));
        else actions.append(button('round.next', () => startLevel(index + 1), 'primary'));
        panel.append(actions);
      } else if (mode === 'error') {
        panel.append(
          node('h2', t('ui.error')),
          node('p', t('ui.error.desc'), 'subtitle'),
          node('pre', error),
          button('menu.home', home),
        );
      }
      if (round) {
        $('roundlabel').textContent = t('round.label', { current: index + 1, total: config.levels.length });
        $('levelname').textContent = round.level.name;
      }
    }
    // Cache the enlarged, blurred backdrop. Rebuild only when the image or stage size changes.
    // The original menu/level image is always drawn separately and stays perfectly sharp.
    let blurredBackdrop = null,
      backdropImage = null,
      backdropWidth = 0,
      backdropHeight = 0;
    /**
     * Build a viewport-sized cover image with an 8-pixel blur to fill margins.
     * Bleed beyond the buffer edges avoids transparent blur borders. Cache by
     * image identity and viewport dimensions. draw() overlays the sharp contain
     * image afterward, so the playable scene itself is never blurred.
     */
    function getBlurredBackdrop(image) {
      const width = Math.ceil(cw),
        height = Math.ceil(ch);
      if (width < 1 || height < 1) return null;
      if (blurredBackdrop && backdropImage === image && backdropWidth === width && backdropHeight === height)
        return blurredBackdrop;

      const buffer = document.createElement('canvas');
      buffer.width = width;
      buffer.height = height;
      const bctx = buffer.getContext('2d');
      if (!bctx) return null;

      // Extend the image past the edges so blurring cannot create transparent borders.
      const blur = 8,
        bleed = blur * 3;
      const factor = Math.max((width + bleed * 2) / image.naturalWidth, (height + bleed * 2) / image.naturalHeight);
      const drawWidth = image.naturalWidth * factor,
        drawHeight = image.naturalHeight * factor;
      bctx.filter = `blur(${blur}px)`;
      bctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
      bctx.filter = 'none';

      blurredBackdrop = buffer;
      backdropImage = image;
      backdropWidth = width;
      backdropHeight = height;
      return buffer;
    }
    /**
     * Set canvas backing resolution (DPR capped at 2), then compute a single
     * contain scale and centered origin for the active image. world() uses the
     * inverse transform for pointer input. Geometry stays in original image pixels.
     */
    function resize() {
      const r = stage.getBoundingClientRect();
      cw = r.width;
      ch = r.height;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(cw * dpr);
      canvas.height = Math.round(ch * dpr);
      foregroundCanvas.width = canvas.width;
      foregroundCanvas.height = canvas.height;
      const image = mode === 'menu' || mode === 'orientation' ? menuBackground : background;
      if (image) {
        scale = Math.min(cw / image.naturalWidth, ch / image.naturalHeight);
        ox = (cw - image.naturalWidth * scale) / 2;
        oy = (ch - image.naturalHeight * scale) / 2;
      }
      positionSceneOverlays();
      draw();
    }
    /**
     * Overlay movement/blocked-area outlines for debugging. Spawn polygons are
     * not drawn. Stroke width is adjusted to remain constant on the screen.
     */
    function drawPolygons() {
      if (!showPolygons || !round) return;
      // World coordinates: canvas translation/scaling is already in effect.
      for (const [poly, color] of [
        [round.level.walkable.west, '#2878ff'],
        [round.level.walkable.east, '#ff3659'],
        [round.level.blocked, '#ffab20'],
      ]) {
        if (!Array.isArray(poly) || poly.length < 3) continue;
        ctx.beginPath();
        ctx.moveTo(poly[0][0], poly[0][1]);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i][0], poly[i][1]);
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 3 / scale;
        ctx.lineJoin = 'round';
        ctx.stroke();
      }
    }
    /**
     * Render blurred margins and the sharp scene on the lower canvas; animated
     * GIFs run between it and the transparent upper canvas with figures, balls,
     * health markers and debug polygons. Only projectiles freeze on game pause.
     */
    function draw() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      backgroundCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      backgroundCtx.clearRect(0, 0, cw, ch);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      const menu = mode === 'menu' || mode === 'orientation';
      const image = menu ? menuBackground : background;
      if (!image) return;
      // Background and blurred letterbox margins stay below the animated GIFs.
      const backdrop = getBlurredBackdrop(image);
      if (backdrop) backgroundCtx.drawImage(backdrop, 0, 0, cw, ch);
      backgroundCtx.save();
      backgroundCtx.translate(ox, oy);
      backgroundCtx.scale(scale, scale);
      backgroundCtx.drawImage(image, 0, 0);
      backgroundCtx.restore();
      if (menu || !round) return;
      // Foreground uses the same transform but stays transparent behind sprites.
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);
      const h = round.height,
        size = h * E.FIGURE_HEIGHT_RATIO;
      const selected = round.selection ? round.figures[round.selection.id] : null;
      for (const f of [...round.figures].sort((a, b) => a.y - b.y || a.id - b.id)) {
        const img = sprites[f.team]?.[f.state];
        if (!img) continue;
        const w = (size * img.naturalWidth) / img.naturalHeight;
        const top = f.y - size * E.FIGURE_STAND_RATIO;
        if (selected === f) {
          ctx.beginPath();
          ctx.ellipse(f.x, f.y + size * 0.025, size * 0.36, size * 0.12, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#d9364822';
          ctx.fill();
          ctx.strokeStyle = '#d93648';
          ctx.lineWidth = 2 / scale;
          ctx.stroke();
        }
        ctx.drawImage(img, f.x - w / 2, top, w, size);
        if (f.hp) {
          const max = f.team === 'east' ? 2 : 3;
          for (let i = 0; i < max; i++) {
            ctx.beginPath();
            ctx.arc(f.x + (i - (max - 1) / 2) * 24, top + size * 0.075, 8, 0, Math.PI * 2);
            ctx.fillStyle = i < f.hp ? (f.team === 'east' ? '#d93648' : '#2878ae') : '#ffffffaa';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
        if (f.state === 'aiming') {
          for (let i = 0; i < 8; i++) {
            ctx.fillStyle = i < f.power ? '#f7b635' : '#28496466';
            ctx.fillRect(f.x - 70 + i * 18, f.y + size * 0.17, 14, 14);
          }
        }
      }
      for (const b of round.balls) {
        let rotation = rotations.get(b);
        if (!rotation) {
          rotation = { tick: round.tick, direction: Math.random() < 0.5 ? -1 : 1 };
          rotations.set(b, rotation);
        }
        // One revolution per second of simulation time; pauses freeze the visual too.
        const angle = (round.tick - rotation.tick) * E.DT * Math.PI * 2 * rotation.direction;
        const [w, h] = E.projectileSize(projectile.naturalWidth, projectile.naturalHeight);
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(angle);
        ctx.drawImage(projectile, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
      drawPolygons();
      ctx.restore();
    }
    /**
     * Convert a client-space pointer to original scene pixels using the inverse
     * of the current contain transform; this also works outside the image bounds.
     */
    function world(e) {
      const r = canvas.getBoundingClientRect();
      return [(e.clientX - r.left - ox) / scale, (e.clientY - r.top - oy) / scale];
    }
    /**
     * Select an alive, grabbable East figure. Prefer a direct sprite-rectangle
     * hit in front-to-back order, then the nearest padded candidate. Touch/stylus
     * get larger screen-space targets. Selection geometry is intentionally
     * different from the circular projectile-hit geometry.
     */
    function selectable(p, pointerType) {
      const size = round.height * E.FIGURE_HEIGHT_RATIO,
        img = sprites.east.idle;
      const width = (size * img.naturalWidth) / img.naturalHeight;
      const centerOffset = size * (E.FIGURE_STAND_RATIO - 0.5);
      const touch = pointerType === 'touch' || pointerType === 'pen';
      const padding = (touch ? 12 : 6) / scale,
        minimum = (touch ? 56 : 32) / scale;
      const halfWidth = Math.max(width + padding * 2, minimum) / 2;
      const halfHeight = Math.max(size + padding * 2, minimum) / 2;
      const candidates = [...round.figures]
        .filter((f) => f.team === 'east' && (f.state === 'idle' || f.state === 'throwing') && f.hp)
        .sort((a, b) => b.y - a.y || b.id - a.id);
      // A direct sprite-rectangle hit takes precedence over a neighbour's padded area.
      const direct = candidates.find(
        (f) => Math.abs(p[0] - f.x) <= width / 2 && Math.abs(p[1] - (f.y - centerOffset)) <= size / 2,
      );
      if (direct) return direct;
      return candidates
        .filter((f) => Math.abs(p[0] - f.x) <= halfWidth && Math.abs(p[1] - (f.y - centerOffset)) <= halfHeight)
        .sort(
          (a, b) =>
            Math.hypot(p[0] - a.x, p[1] - (a.y - centerOffset)) - Math.hypot(p[0] - b.x, p[1] - (b.y - centerOffset)),
        )[0];
    }
    /**
     * Pointer lifecycle: one primary pointer owns one drag. Pointer capture keeps
     * moves/releases routed here outside the canvas. Commands are queued for the
     * next model tick, preserving input order independently of render frequency.
     * Cancellation/lost capture must not be interpreted as a throw.
     */
    canvas.addEventListener('pointerdown', (e) => {
      if (mode !== 'playing' || paused || infoOpen || e.button !== 0 || selectionPointer !== null) return;
      const p = world(e),
        f = selectable(p, e.pointerType);
      if (!f) return;
      e.preventDefault();
      selectionPointer = e.pointerId;
      canvas.setPointerCapture(e.pointerId);
      round.queue({ type: 'down', id: f.id, pointer: e.pointerId, p });
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== selectionPointer || mode !== 'playing' || paused || infoOpen) return;
      e.preventDefault();
      round.queue({ type: 'move', pointer: e.pointerId, p: world(e) });
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.pointerId !== selectionPointer) return;
      round?.queue({ type: 'up', pointer: e.pointerId, p: world(e) });
      selectionPointer = null;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    });
    for (const event of ['pointercancel', 'lostpointercapture'])
      canvas.addEventListener(event, (e) => {
        if (e.pointerId !== selectionPointer) return;
        round?.queue({ type: 'cancel', pointer: e.pointerId });
        selectionPointer = null;
      });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    /**
     * Browser interruptions cancel charging and pause the model. Reset accumulated
     * time on visibility changes so hidden time is never replayed. Returning to
     * the page does not automatically resume a paused round.
     */
    window.addEventListener('blur', () => {
      clearPointer();
      if (mode === 'playing') setPause(true);
    });
    document.addEventListener('visibilitychange', () => {
      clearPointer();
      previous = 0;
      accumulator = 0;
      if (document.hidden && mode === 'playing') setPause(true);
      else menuMusic();
    });
    /**
     * Escape precedence in the parent document: close information, exit immersive
     * mode, then toggle gameplay pause. Events inside a focused iframe do not
     * bubble into this handler automatically.
     */
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && infoOpen) {
        e.preventDefault();
        closeInfo();
        return;
      }
      if (e.key === 'Escape' && immersive) {
        e.preventDefault();
        exitFullscreen();
        return;
      }
      if (e.key === 'Escape' && mode === 'playing') {
        e.preventDefault();
        setPause(!paused);
      }
    });
    document.addEventListener(
      'pointerdown',
      () => {
        menuMusic();
      },
      { capture: true },
    );
    $('language').onchange = (e) => {
      if (!Object.hasOwn(config.languages, e.target.value)) return;
      lang = e.target.value;
      try {
        window.localStorage.setItem(languageStorageKey, lang);
      } catch {
        // Continue normally if storage is unavailable or blocked.
      }
      renderUI();
    };
    $('info-close').onclick = closeInfo;
    $('pause').onclick = () => setPause(!paused);
    $('fullscreen').onclick = enterFullscreen;
    $('exitfullscreen').onclick = exitFullscreen;
    new ResizeObserver(resize).observe(stage);
    /**
     * Render every animation frame, but advance rules only during active play.
     * Cap one frame’s elapsed contribution at 0.1 s to avoid a long catch-up spiral.
     * Consume hit events after each model tick; ending a round stops further
     * simulation steps in this frame. Result-score animation uses wall-clock time.
     */
    function frame(now) {
      if (previous && mode === 'playing' && !paused && !infoOpen && !document.hidden) {
        accumulator += Math.min((now - previous) / 1000, 0.1);
        while (accumulator + 1e-9 >= E.DT && mode === 'playing') {
          round.step();
          accumulator -= E.DT;
          for (const event of round.events) if (event.type === 'hit') E.hitAudio(round.level.audio, play);
          if (round.result) endRound();
        }
      }
      if (animatedScore) updateResultScore(now);
      previous = now;
      draw();
      requestAnimationFrame(frame);
    }
    preloadAudio();
    renderUI();
    requestAnimationFrame(frame);
    loadMenuBackground();
    // Configured font overrides, with built-in fallbacks if a font is unavailable.
    for (const [key, family] of [
      ['heading', 'Bangers'],
      ['body', 'Nunito'],
    ]) {
      const path = config?.assets?.fonts?.[key];
      if (typeof path === 'string' && typeof FontFace !== 'undefined')
        new FontFace(family, `url("${path.replace(/["\\]/g, '\\$&')}")`)
          .load()
          .then((font) => document.fonts.add(font))
          .catch(() => {});
    }
    // Console commands are always available; no ?debug URL parameter required.
    // These state variables are deliberately outside the round lifecycle.
    /**
     * Public convenience debug commands. Gameplay cheats make debugRun sticky
     * for the rest of this page visit; disabling godmode does not restore reports.
     * Polygon visualization alone does not mark the run as cheated. win() bypasses
     * normal hit scoring; restart() preserves already accumulated run points.
     */
    window.game = Object.freeze({
      godmode(enabled = true) {
        E.Round.godMode = !!enabled;
        if (E.Round.godMode) debugRun = true;
        return E.Round.godMode;
      },
      polygons(enabled = true) {
        showPolygons = !!enabled;
        draw();
        return showPolygons;
      },
      win() {
        if (mode !== 'playing' || !round || round.result) return false;
        debugRun = true;
        for (const f of round.figures) {
          if (f.team === 'west') {
            f.hp = 0;
            f.state = 'dead';
          }
        }
        round.step();
        if (round.result) endRound();
        draw();
        return !!round.result?.won;
      },
      nextLevel() {
        if (!round || index + 1 >= config.levels.length || !['playing', 'result'].includes(mode)) return false;
        debugRun = true;
        void startLevel(index + 1, false, true);
        return true;
      },
      restart() {
        if (!round || !['playing', 'result'].includes(mode)) return false;
        debugRun = true;
        void startLevel(index, false, true);
        return true;
      },
    });
    /**
     * Expose private shell operations only when the debug parameter exists.
     * This is a test/developer interface, not a stable gameplay API. Direct state
     * mutations here can bypass normal cheat detection; use a non-production test
     * context. step() intentionally allows explicit stepping while paused.
     */
    if (new URLSearchParams(location.search).has('debug'))
      window.CityRumbleApp = {
        get round() {
          return round;
        },
        get mode() {
          return mode;
        },
        get total() {
          return total;
        },
        get paused() {
          return paused;
        },
        get infoOpen() {
          return infoOpen;
        },
        startLevel,
        setPause,
        home,
        t,
        resize,
        renderUI,
        endRound,
        openInfo,
        closeInfo,
        step(n = 1) {
          for (let i = 0; i < n && mode === 'playing'; i++) {
            round.step();
            if (round.result) endRound();
          }
        },
        screen(x, y) {
          const r = canvas.getBoundingClientRect();
          return [r.left + ox + x * scale, r.top + oy + y * scale];
        },
      };
  }
})();
