// Implements: 23_Complexity_Guarantees.md §1 + §5 — a Red-Black Tree, the
// data structure that proves the O(log N) bound SQLite's B-tree also achieves.
//
// A Red-Black tree is a self-balancing binary search tree. Its invariants
// (the 5 RB properties, listed below) guarantee height ≤ 2·log(N+1), so
// search/insert/delete are O(log N) in the worst case (not just expected).
//
// SQLite uses a B-tree (not an RB-tree) for its indexes, but the asymptotic
// bound is the same: O(log N) per operation. This file demonstrates the bound
// concretely — a TypeScript RB-tree you can run and measure. It's a planning
// artefact; the app uses SQLite's B-tree (via Prisma) for real storage.
//
// The 5 RB invariants:
//   1. Every node is either RED or BLACK.
//   2. The root is BLACK.
//   3. Every NIL leaf is BLACK (we use a sentinel).
//   4. If a node is RED, both its children are BLACK (no two consecutive reds).
//   5. Every path from a node to a descendant NIL has the same number of
//      BLACK nodes (the "black-height").
//
// Invariant 5 is what gives the O(log N) bound: the longest path (alternating
// red/black) is at most twice the shortest path (all black), so the tree's
// height is ≤ 2·log(N+1).

/**
 * The colour of an RB-tree node.
 */
const RED = true as const;
const BLACK = false as const;
type Colour = typeof RED | typeof BLACK;

/**
 * A node in the RB-tree. `left`/`right`/`parent` are never `null` for interior
 * nodes — they point to the NIL sentinel for missing children. This eliminates
 * null-checks in the rotation code (a common source of bugs).
 */
interface RBNode<K, V> {
  key: K;
  value: V;
  colour: Colour;
  left: RBNode<K, V>;
  right: RBNode<K, V>;
  parent: RBNode<K, V>;
}

/**
 * A Red-Black Tree mapping `K` → `V`, keyed by a total order on `K`.
 *
 * Usage:
 *   const t = new RBTree<number, string>((a, b) => a - b);
 *   t.insert(5, 'five');
 *   t.insert(3, 'three');
 *   const r = t.range(2, 6);  // → [{key:3, value:'three'}, {key:5, value:'five'}]
 */
export class RBTree<K, V> {
  private readonly compare: (a: K, b: K) => number;
  /** The NIL sentinel. All "null" children point here. */
  private readonly nil: RBNode<K, V>;
  /** The root. Initially the NIL sentinel (empty tree). */
  private root: RBNode<K, V>;
  private count = 0;

  constructor(compare: (a: K, b: K) => number = defaultCompare as (a: K, b: K) => number) {
    this.compare = compare;
    // The NIL sentinel is its own parent (avoids infinite loops in rotations).
    this.nil = {
      key: undefined as unknown as K,
      value: undefined as unknown as V,
      colour: BLACK,
      left: undefined as unknown as RBNode<K, V>,
      right: undefined as unknown as RBNode<K, V>,
      parent: undefined as unknown as RBNode<K, V>,
    };
    this.nil.left = this.nil;
    this.nil.right = this.nil;
    this.nil.parent = this.nil;
    this.root = this.nil;
  }

  /**
   * The number of keys in the tree.
   *
   * @complexity O(1).
   */
  get size(): number {
    return this.count;
  }

  /**
   * Insert (or update) a key-value pair. If the key exists, its value is
   * replaced.
   *
   * @complexity O(log N).
   */
  insert(key: K, value: V): void {
    // Standard BST insert.
    let y: RBNode<K, V> = this.nil;
    let x: RBNode<K, V> = this.root;
    while (x !== this.nil) {
      y = x;
      const c = this.compare(key, x.key);
      if (c === 0) {
        // Key exists — update value, no structural change.
        x.value = value;
        return;
      }
      x = c < 0 ? x.left : x.right;
    }
    const z: RBNode<K, V> = {
      key,
      value,
      colour: RED,
      left: this.nil,
      right: this.nil,
      parent: y,
    };
    if (y === this.nil) {
      this.root = z;
    } else if (this.compare(key, y.key) < 0) {
      y.left = z;
    } else {
      y.right = z;
    }
    this.count++;
    // Re-balance: fix the red-red violation.
    this.insertFixup(z);
  }

  /**
   * Delete a key. Returns true if the key was present, false otherwise.
   *
   * @complexity O(log N).
   */
  delete(key: K): boolean {
    const z = this.findNode(key);
    if (z === this.nil) return false;
    // Standard RB-delete (CLRS 3rd ed., §13.4).
    let y = z;
    let yOriginalColour = y.colour;
    let x: RBNode<K, V>;
    if (z.left === this.nil) {
      x = z.right;
      this.transplant(z, z.right);
    } else if (z.right === this.nil) {
      x = z.left;
      this.transplant(z, z.left);
    } else {
      y = this.minimum(z.right);
      yOriginalColour = y.colour;
      x = y.right;
      if (y.parent === z) {
        x.parent = y;
      } else {
        this.transplant(y, y.right);
        y.right = z.right;
        y.right.parent = y;
      }
      this.transplant(z, y);
      y.left = z.left;
      y.left.parent = y;
      y.colour = z.colour;
    }
    if (yOriginalColour === BLACK) {
      this.deleteFixup(x);
    }
    this.count--;
    return true;
  }

  /**
   * Look up a key's value. Returns `null` if absent.
   *
   * @complexity O(log N).
   */
  search(key: K): V | null {
    const n = this.findNode(key);
    return n === this.nil ? null : n.value;
  }

  /**
   * Return all entries with key in `[lower, upper]`, in ascending key order.
   *
   * @complexity O(log N + K) where K = number of results (an in-order walk
   *   of the matching subtree).
   */
  range(lower: K, upper: K): Array<{ key: K; value: V }> {
    const results: Array<{ key: K; value: V }> = [];
    this.rangeWalk(this.root, lower, upper, results);
    return results;
  }

  /**
   * Verify all 5 RB invariants. Throws on violation. Used by the self-test
   * and (optionally) by an admin diagnostic endpoint.
   *
   * @complexity O(N).
   */
  verifyInvariants(): void {
    // Invariant 2: root is BLACK.
    if (this.root.colour !== BLACK) throw new Error('RB invariant 2: root must be BLACK');
    // Invariant 1: every node is RED or BLACK (enforced by the type).
    // Invariant 3: NIL is BLACK (enforced at construction).
    // Invariant 4: no two consecutive reds.
    // Invariant 5: equal black-height.
    this.checkNode(this.root);
  }

  // -------------------------------------------------------------------------
  // Internal helpers.
  // -------------------------------------------------------------------------

  /**
   * Walk the subtree rooted at `n`, collecting keys in `[lower, upper]` via
   * in-order traversal.
   *
   * @complexity O(log N + K) — prunes branches outside the range.
   */
  private rangeWalk(
    n: RBNode<K, V>,
    lower: K,
    upper: K,
    out: Array<{ key: K; value: V }>,
  ): void {
    if (n === this.nil) return;
    const cmpLower = this.compare(n.key, lower);
    const cmpUpper = this.compare(n.key, upper);
    if (cmpLower > 0) this.rangeWalk(n.left, lower, upper, out);
    if (cmpLower >= 0 && cmpUpper <= 0) {
      out.push({ key: n.key, value: n.value });
    }
    if (cmpUpper < 0) this.rangeWalk(n.right, lower, upper, out);
  }

  /**
   * Find the node with the given key, or NIL.
   *
   * @complexity O(log N).
   */
  private findNode(key: K): RBNode<K, V> {
    let x = this.root;
    while (x !== this.nil) {
      const c = this.compare(key, x.key);
      if (c === 0) return x;
      x = c < 0 ? x.left : x.right;
    }
    return this.nil;
  }

  /**
   * The minimum node in the subtree rooted at `n` (leftmost descendant).
   *
   * @complexity O(log N).
   */
  private minimum(n: RBNode<K, V>): RBNode<K, V> {
    while (n.left !== this.nil) n = n.left;
    return n;
  }

  /**
   * Replace subtree `u` with subtree `v` (CLRS `RB-TRANSPLANT`).
   *
   * @complexity O(1).
   */
  private transplant(u: RBNode<K, V>, v: RBNode<K, V>): void {
    if (u.parent === this.nil) {
      this.root = v;
    } else if (u === u.parent.left) {
      u.parent.left = v;
    } else {
      u.parent.right = v;
    }
    v.parent = u.parent;
  }

  /**
   * Left-rotate around `x`. Preserves the BST property.
   *
   * @complexity O(1).
   */
  private leftRotate(x: RBNode<K, V>): void {
    const y = x.right;
    x.right = y.left;
    if (y.left !== this.nil) y.left.parent = x;
    y.parent = x.parent;
    if (x.parent === this.nil) {
      this.root = y;
    } else if (x === x.parent.left) {
      x.parent.left = y;
    } else {
      x.parent.right = y;
    }
    y.left = x;
    x.parent = y;
  }

  /**
   * Right-rotate around `x`. Mirror of `leftRotate`.
   *
   * @complexity O(1).
   */
  private rightRotate(x: RBNode<K, V>): void {
    const y = x.left;
    x.left = y.right;
    if (y.right !== this.nil) y.right.parent = x;
    y.parent = x.parent;
    if (x.parent === this.nil) {
      this.root = y;
    } else if (x === x.parent.right) {
      x.parent.right = y;
    } else {
      x.parent.left = y;
    }
    y.right = x;
    x.parent = y;
  }

  /**
   * Restore RB invariants after an insert (CLRS `RB-INSERT-FIXUP`).
   *
   * @complexity O(log N) (at most 2 rotations + O(log N) colour flips).
   */
  private insertFixup(z: RBNode<K, V>): void {
    while (z.parent.colour === RED) {
      if (z.parent === z.parent.parent.left) {
        const y = z.parent.parent.right; // uncle
        if (y.colour === RED) {
          // Case 1: uncle is red — recolour and move up.
          z.parent.colour = BLACK;
          y.colour = BLACK;
          z.parent.parent.colour = RED;
          z = z.parent.parent;
        } else {
          if (z === z.parent.right) {
            // Case 2: z is the right child — left-rotate to make it left.
            z = z.parent;
            this.leftRotate(z);
          }
          // Case 3: recolour + right-rotate.
          z.parent.colour = BLACK;
          z.parent.parent.colour = RED;
          this.rightRotate(z.parent.parent);
        }
      } else {
        // Mirror image: parent is the right child.
        const y = z.parent.parent.left;
        if (y.colour === RED) {
          z.parent.colour = BLACK;
          y.colour = BLACK;
          z.parent.parent.colour = RED;
          z = z.parent.parent;
        } else {
          if (z === z.parent.left) {
            z = z.parent;
            this.rightRotate(z);
          }
          z.parent.colour = BLACK;
          z.parent.parent.colour = RED;
          this.leftRotate(z.parent.parent);
        }
      }
    }
    this.root.colour = BLACK;
  }

  /**
   * Restore RB invariants after a delete (CLRS `RB-DELETE-FIXUP`).
   *
   * @complexity O(log N).
   */
  private deleteFixup(x: RBNode<K, V>): void {
    while (x !== this.root && x.colour === BLACK) {
      if (x === x.parent.left) {
        let w = x.parent.right;
        if (w.colour === RED) {
          // Case 1: sibling is red — recolour + rotate to make sibling black.
          w.colour = BLACK;
          x.parent.colour = RED;
          this.leftRotate(x.parent);
          w = x.parent.right;
        }
        if (w.left.colour === BLACK && w.right.colour === BLACK) {
          // Case 2: both nieces black — recolour sibling, move up.
          w.colour = RED;
          x = x.parent;
        } else {
          if (w.right.colour === BLACK) {
            // Case 3: right niece black, left niece red — rotate to make right niece red.
            w.left.colour = BLACK;
            w.colour = RED;
            this.rightRotate(w);
            w = x.parent.right;
          }
          // Case 4: right niece red — recolour + rotate to fix.
          w.colour = x.parent.colour;
          x.parent.colour = BLACK;
          w.right.colour = BLACK;
          this.leftRotate(x.parent);
          x = this.root;
        }
      } else {
        // Mirror image.
        let w = x.parent.left;
        if (w.colour === RED) {
          w.colour = BLACK;
          x.parent.colour = RED;
          this.rightRotate(x.parent);
          w = x.parent.left;
        }
        if (w.right.colour === BLACK && w.left.colour === BLACK) {
          w.colour = RED;
          x = x.parent;
        } else {
          if (w.left.colour === BLACK) {
            w.right.colour = BLACK;
            w.colour = RED;
            this.leftRotate(w);
            w = x.parent.left;
          }
          w.colour = x.parent.colour;
          x.parent.colour = BLACK;
          w.left.colour = BLACK;
          this.rightRotate(x.parent);
          x = this.root;
        }
      }
    }
    x.colour = BLACK;
  }

  /**
   * Recursively check invariants 4 (no two consecutive reds) and 5 (equal
   * black-height). Returns the black-height of `n`.
   *
   * @complexity O(N).
   */
  private checkNode(n: RBNode<K, V>): number {
    if (n === this.nil) return 1;
    // Invariant 4: red node's children must be black.
    if (n.colour === RED) {
      if (n.left.colour === RED || n.right.colour === RED) {
        throw new Error(`RB invariant 4 violated at key=${String(n.key)}: red node has red child`);
      }
    }
    const lh = this.checkNode(n.left);
    const rh = this.checkNode(n.right);
    // Invariant 5: equal black-height.
    if (lh !== rh) {
      throw new Error(`RB invariant 5 violated at key=${String(n.key)}: left bh=${lh}, right bh=${rh}`);
    }
    return lh + (n.colour === BLACK ? 1 : 0);
  }
}

/**
 * Default comparison for `number` and `string` keys. Other types require an
 * explicit comparator.
 *
 * @complexity O(1).
 */
function defaultCompare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Self-test — runs with `bun run <this-file>`.
// ---------------------------------------------------------------------------

if (import.meta.main) {
  console.log('=== RBTree self-test ===');
  const t = new RBTree<number, string>();

  // Insert.
  const data: Array<[number, string]> = [
    [5, 'five'], [3, 'three'], [10, 'ten'], [1, 'one'], [4, 'four'],
    [7, 'seven'], [12, 'twelve'], [2, 'two'], [6, 'six'], [9, 'nine'],
    [11, 'eleven'], [8, 'eight'],
  ];
  for (const [k, v] of data) t.insert(k, v);
  console.log(`  inserted ${data.length} keys; size = ${t.size}`);

  // Verify invariants after insert.
  t.verifyInvariants();
  console.log('  invariants verified after insert: OK');

  // Search.
  console.log('\n--- search ---');
  for (const k of [1, 5, 8, 12, 99]) {
    console.log(`  search(${k}) = ${t.search(k) ?? 'null'}`);
  }

  // Range.
  console.log('\n--- range [4, 9] ---');
  for (const r of t.range(4, 9)) console.log(`  ${r.key}: ${r.value}`);

  // Update (insert existing key).
  console.log('\n--- update key 5 ---');
  t.insert(5, 'FIVE');
  console.log(`  search(5) = ${t.search(5)}`);
  t.verifyInvariants();
  console.log('  invariants verified after update: OK');

  // Delete.
  console.log('\n--- delete 5, 3, 10 ---');
  for (const k of [5, 3, 10]) {
    const ok = t.delete(k);
    console.log(`  delete(${k}) = ${ok}`);
    t.verifyInvariants();
  }
  console.log(`  size after deletes: ${t.size}`);

  // Delete a missing key.
  console.log(`\n--- delete 999 (missing) ---`);
  console.log(`  delete(999) = ${t.delete(999)}`);

  // Complexity check: build a large tree, measure, verify invariants.
  console.log('\n=== complexity check (N=10000) ===');
  const big = new RBTree<number, number>();
  const keys: number[] = [];
  for (let i = 0; i < 10000; i++) keys.push(Math.floor(Math.random() * 1e9));
  const t0 = performance.now();
  for (const k of keys) big.insert(k, k * 2);
  const insertMs = performance.now() - t0;
  big.verifyInvariants();
  console.log(`  insert 10k: ${insertMs.toFixed(0)} ms  (${(insertMs / 10000).toFixed(3)} ms/op)`);

  const t1 = performance.now();
  for (const k of keys) {
    const v = big.search(k);
    if (v !== k * 2) throw new Error(`search mismatch for ${k}`);
  }
  const searchMs = performance.now() - t1;
  console.log(`  search 10k: ${searchMs.toFixed(0)} ms  (${(searchMs / 10000).toFixed(3)} ms/op)`);

  // Delete half, verify invariants still hold.
  const t2 = performance.now();
  for (let i = 0; i < 5000; i++) big.delete(keys[i]);
  const deleteMs = performance.now() - t2;
  big.verifyInvariants();
  console.log(`  delete 5k:  ${deleteMs.toFixed(0)} ms  (${(deleteMs / 5000).toFixed(3)} ms/op)`);
  console.log(`  size after deletes: ${big.size}  (expected 5000)`);

  // Range query timing.
  const t3 = performance.now();
  for (let i = 0; i < 100; i++) {
    const lo = Math.floor(Math.random() * 1e9);
    big.range(lo, lo + 1000);
  }
  const rangeMs = performance.now() - t3;
  console.log(`  range(±1000) ×100: ${rangeMs.toFixed(2)} ms  (${(rangeMs / 100).toFixed(3)} ms/op)`);
}
