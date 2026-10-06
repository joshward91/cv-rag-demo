/**
 * HNSW (hierarchical navigable small world) approximate nearest-neighbour
 * index, after Malkov and Yashunin (2018). Plain JavaScript, no dependencies,
 * so the same code builds the index in Node and queries it in the browser.
 *
 * Vectors must be L2-normalised; distance is 1 - dot product (cosine).
 *
 * The graph is built once at build time (scripts/embed-articles.mjs) and
 * shipped as data, the way a vector database's index is built ahead of
 * queries. Building is seeded, so the same vectors always give the same graph.
 *
 * With 292 passages a flat scan is already instant; the index is here to show
 * the pattern that scales. eval/scale/bench.mjs measures both at 100,000.
 */

export const HNSW_DEFAULTS = { M: 16, efConstruction: 200, efSearch: 64, seed: 42 };

/** Small seeded PRNG (mulberry32), so builds are reproducible. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Binary heap of [distance, id]; `max` puts the largest distance on top. */
class Heap {
  constructor(max) {
    this.items = [];
    this.before = max ? (a, b) => a[0] > b[0] : (a, b) => a[0] < b[0];
  }
  get size() {
    return this.items.length;
  }
  peek() {
    return this.items[0];
  }
  push(item) {
    const h = this.items;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.before(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }
  pop() {
    const h = this.items;
    const top = h[0];
    const last = h.pop();
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.before(h[l], h[m])) m = l;
        if (r < h.length && this.before(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}

export class HnswIndex {
  /**
   * @param {number} dim
   * @param {Partial<typeof HNSW_DEFAULTS>} [options]
   */
  constructor(dim, options = {}) {
    this.dim = dim;
    this.options = { ...HNSW_DEFAULTS, ...options };
    this.random = rng(this.options.seed);
    this.data = new Float32Array(0);
    this.count = 0;
    /** links[node][layer] = neighbour ids */
    this.links = [];
    /** node id -> ids of identical vectors that were not inserted */
    this.duplicates = new Map();
    this.entry = -1;
    this.maxLevel = -1;
    this.visited = new Uint32Array(0);
    this.stamp = 0;
  }

  /** Builds an index over many vectors at once. */
  /**
   * Builds an index over many vectors at once. Exact duplicates (the same
   * step, such as "Select Save changes.", in dozens of articles) are not
   * inserted as nodes: they would link only to each other and form a closed
   * clique a search can walk into and never leave. Each is attached to its
   * first occurrence and returned with it.
   */
  static build(vectors, options) {
    const index = new HnswIndex(vectors[0].length, options);
    index.reserve(vectors.length);
    const first = new Map();
    for (const v of vectors) {
      const key = Array.from(v, (x) => Math.round(x * 1e4)).join();
      if (first.has(key)) index.#addDuplicate(v, first.get(key));
      else first.set(key, index.add(v));
    }
    return index;
  }

  #addDuplicate(vector, of) {
    const id = this.count;
    this.data.set(vector, id * this.dim);
    this.count += 1;
    this.links[id] = [];
    this.duplicates.set(of, [...(this.duplicates.get(of) ?? []), id]);
  }

  reserve(n) {
    if (n * this.dim <= this.data.length) return;
    const data = new Float32Array(n * this.dim);
    data.set(this.data);
    this.data = data;
    this.visited = new Uint32Array(n);
  }

  vector(id) {
    return this.data.subarray(id * this.dim, (id + 1) * this.dim);
  }

  distance(q, id) {
    const d = this.data;
    const dim = this.dim;
    let dot = 0;
    for (let i = 0, o = id * dim; i < dim; i += 1) dot += q[i] * d[o + i];
    return 1 - dot;
  }

  /** Distance between two stored vectors, without copying either. */
  between(a, b) {
    const d = this.data;
    const dim = this.dim;
    let dot = 0;
    for (let i = 0, oa = a * dim, ob = b * dim; i < dim; i += 1) dot += d[oa + i] * d[ob + i];
    return 1 - dot;
  }

  /** Adds one vector; returns its id (insertion order). */
  add(vector) {
    const id = this.count;
    if ((id + 1) * this.dim > this.data.length) this.reserve(Math.max(16, id * 2));
    this.data.set(vector, id * this.dim);
    this.count += 1;
    const { M, efConstruction } = this.options;
    const level = Math.floor(-Math.log(this.random() || 1e-12) / Math.log(M));
    this.links[id] = Array.from({ length: level + 1 }, () => []);

    if (this.entry === -1) {
      this.entry = id;
      this.maxLevel = level;
      return id;
    }

    const q = this.vector(id);
    let ep = this.entry;
    for (let l = this.maxLevel; l > level; l -= 1) ep = this.#greedy(q, ep, l);
    for (let l = Math.min(level, this.maxLevel); l >= 0; l -= 1) {
      const candidates = this.#searchLayer(q, [ep], efConstruction, l);
      const neighbours = this.#select(candidates, M);
      this.links[id][l] = neighbours.map(([, n]) => n);
      const cap = l === 0 ? 2 * M : M;
      for (const [, n] of neighbours) {
        const theirs = this.links[n][l];
        theirs.push(id);
        if (theirs.length > cap) {
          // Over capacity: re-run the heuristic. Keeping only the closest is
          // cheaper but closes dense clusters off from the rest of the graph,
          // which a filtered search (one product out of six) cannot escape.
          this.links[n][l] = this.#select(theirs.map((x) => [this.between(n, x), x]), cap).map(([, x]) => x);
        }
      }
      ep = candidates[0][1];
    }
    if (level > this.maxLevel) {
      this.maxLevel = level;
      this.entry = id;
    }
    return id;
  }

  /**
   * The k nearest vectors to q, nearest first, as { id, similarity }.
   * Larger ef finds more of the true neighbours at more cost.
   *
   * With `allow`, only ids it accepts are returned, but the walk still passes
   * through the others. Filtering afterwards instead fails when the allowed
   * set is small: the nearest few dozen vectors may all be disallowed.
   */
  search(q, k, ef = this.options.efSearch, allow = null) {
    if (this.entry === -1) return [];
    let ep = this.entry;
    for (let l = this.maxLevel; l > 0; l -= 1) ep = this.#greedy(q, ep, l);
    const members = (id) => [id, ...(this.duplicates.get(id) ?? [])];
    const nodeAllowed = allow && ((id) => members(id).some(allow));
    return this.#searchLayer(q, [ep], Math.max(ef, k), 0, nodeAllowed)
      .flatMap(([d, id]) => members(id).filter((m) => !allow || allow(m)).map((m) => ({ id: m, similarity: 1 - d })))
      .slice(0, k);
  }

  /** Walks downhill on one layer from ep to the closest node it can reach. */
  #greedy(q, ep, layer) {
    let best = ep;
    let bestD = this.distance(q, ep);
    for (let changed = true; changed; ) {
      changed = false;
      for (const n of this.links[best][layer] ?? []) {
        const d = this.distance(q, n);
        if (d < bestD) {
          bestD = d;
          best = n;
          changed = true;
        }
      }
    }
    return best;
  }

  /** Best-first search of one layer; returns up to ef [distance, id], nearest first. */
  #searchLayer(q, entries, ef, layer, allow = null) {
    this.stamp += 1;
    if (this.stamp === 0xffffffff) {
      this.visited.fill(0);
      this.stamp = 1;
    }
    const candidates = new Heap(false);
    const found = new Heap(true);
    for (const e of entries) {
      const d = this.distance(q, e);
      this.visited[e] = this.stamp;
      candidates.push([d, e]);
      if (!allow || allow(e)) found.push([d, e]);
    }
    while (candidates.size) {
      const [d, c] = candidates.pop();
      if (found.size >= ef && d > found.peek()[0]) break;
      for (const n of this.links[c][layer] ?? []) {
        if (this.visited[n] === this.stamp) continue;
        this.visited[n] = this.stamp;
        const dn = this.distance(q, n);
        if (found.size < ef || dn < found.peek()[0]) {
          candidates.push([dn, n]);
          if (allow && !allow(n)) continue;
          found.push([dn, n]);
          if (found.size > ef) found.pop();
        }
      }
    }
    return found.items.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }

  /**
   * Neighbour selection heuristic: keep a candidate only if it is closer to
   * the new node than to any neighbour already kept, so links spread across
   * clusters instead of all pointing into one. Pruned ones fill any space left.
   */
  #select(candidates, m) {
    const sorted = [...candidates].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const kept = [];
    const pruned = [];
    for (const c of sorted) {
      if (kept.length >= m) break;
      if (kept.every(([, k]) => this.between(c[1], k) > c[0])) kept.push(c);
      else pruned.push(c);
    }
    for (const c of pruned) {
      if (kept.length >= m) break;
      kept.push(c);
    }
    return kept;
  }

  /** The graph only; vectors are stored separately (they already ship with the page). */
  toJSON() {
    const { M, efConstruction, efSearch } = this.options;
    return { M, efConstruction, efSearch, entry: this.entry, maxLevel: this.maxLevel, links: this.links, duplicates: Object.fromEntries(this.duplicates) };
  }

  /** Rebuilds a searchable index from vectors plus a graph made by toJSON. */
  static fromJSON(graph, vectors) {
    const index = new HnswIndex(vectors[0].length, { M: graph.M, efConstruction: graph.efConstruction, efSearch: graph.efSearch });
    index.reserve(vectors.length);
    vectors.forEach((v, i) => index.data.set(v, i * index.dim));
    index.count = vectors.length;
    index.links = graph.links;
    index.entry = graph.entry;
    index.maxLevel = graph.maxLevel;
    index.duplicates = new Map(Object.entries(graph.duplicates ?? {}).map(([k, v]) => [Number(k), v]));
    return index;
  }
}
