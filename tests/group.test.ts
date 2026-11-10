// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { groupTree, type GroupedEntry, type GroupedNode } from '../src/components/CastResult';
import type { CastTreeNode } from '../src/engine/types';

function actionAt(id: string, deckIndex: number): CastTreeNode {
  return {
    kind: 'action',
    id,
    deckIndex,
    recursion: null,
    iteration: null,
    dontDraw: false,
    permanent: false,
    projectiles: [],
    children: [],
  };
}

function action(id: string, children: CastTreeNode[] = []): CastTreeNode {
  return {
    kind: 'action',
    id,
    deckIndex: null,
    recursion: null,
    iteration: null,
    dontDraw: false,
    permanent: false,
    projectiles: [],
    children,
  };
}

function card(id: string, child: CastTreeNode): CastTreeNode {
  return { kind: 'drawCard', spellId: id, ok: true, deckBefore: 1, deckAfter: 0, children: [child] };
}

function cast(children: CastTreeNode[]): CastTreeNode {
  return { kind: 'cast', children };
}

function single(entry: GroupedEntry): GroupedNode {
  if (entry.kind !== 'node') throw new Error('expected a single node');
  return entry.group;
}

describe('cast tree repeat folding', () => {
  it('folds identical consecutive nodes with a repeat count', () => {
    const grouped = groupTree(cast([action('DAMAGE'), action('DAMAGE'), action('DAMAGE')]), true);
    expect(grouped.children).toHaveLength(1);
    const entry = grouped.children[0];
    expect(entry.kind).toBe('node');
    if (entry.kind !== 'node') throw new Error('expected node');
    expect(entry.repeat).toBe(3);
  });

  it('folds repeated multi-line sequences (A,B,A,B → sequence of 2 repetitions)', () => {
    const tree = cast([card('A', action('A')), card('B', action('B')), card('A', action('A')), card('B', action('B'))]);
    const grouped = groupTree(tree, true);
    expect(grouped.children).toHaveLength(1);
    const entry = grouped.children[0];
    expect(entry.kind).toBe('sequence');
    if (entry.kind !== 'sequence') throw new Error('expected sequence');
    expect(entry.count).toBe(2);
    expect(entry.pattern).toHaveLength(2);
  });

  it('nests folding inside repeated patterns', () => {
    // action A's inner children repeat X,Y twice; A itself appears twice
    const inner = [card('X', action('X')), card('Y', action('Y')), card('X', action('X')), card('Y', action('Y'))];
    const tree = cast([action('A', inner), action('A', inner)]);
    const grouped = groupTree(tree, true);
    const top = grouped.children[0];
    expect(top.kind).toBe('node');
    if (top.kind !== 'node') throw new Error('expected node');
    expect(top.repeat).toBe(2);
    const aNode = single(top);
    expect(aNode.children).toHaveLength(1);
    expect(aNode.children[0].kind).toBe('sequence');
  });

  it('folds identical processes even when their internal copy counts differ', () => {
    const repeating = (copies: number) =>
      action('A', Array.from({ length: copies }, () => card('X', action('X'))));
    const grouped = groupTree(cast([repeating(1), repeating(3)]), true);
    expect(grouped.children).toHaveLength(1);
    const entry = grouped.children[0];
    expect(entry.kind).toBe('node');
    if (entry.kind === 'node') expect(entry.repeat).toBe(2);
  });

  it('keeps every concrete copy so expanding shows the real slot numbers', () => {
    const grouped = groupTree(
      cast([actionAt('A', 0), actionAt('A', 1), actionAt('A', 2)]),
      true,
    );
    expect(grouped.children).toHaveLength(1);
    const entry = grouped.children[0];
    expect(entry.kind).toBe('node');
    if (entry.kind !== 'node') throw new Error('expected node');
    expect(entry.repeat).toBe(3);
    expect(entry.copies).toHaveLength(3);
    const slots = entry.copies.map((copy) => (copy.node.kind === 'action' ? copy.node.deckIndex : null));
    expect(slots).toEqual([0, 1, 2]);
  });

  it('keeps non-adjacent identical nodes in their original order (no reordering)', () => {
    const grouped = groupTree(cast([action('A'), action('B'), action('A')]), true);
    // A and B differ, and the two A nodes are separated by B: folding them into one
    // node would reorder the cast, so they must stay as separate consecutive entries.
    expect(grouped.children).toHaveLength(3);
    const ids = grouped.children.map((entry) => {
      if (entry.kind !== 'node') return 'seq';
      const node = entry.group.node;
      return node.kind === 'action' ? node.id : '?';
    });
    expect(ids).toEqual(['A', 'B', 'A']);
  });

  it('keeps every node when folding is disabled', () => {
    const grouped = groupTree(cast([action('DAMAGE'), action('DAMAGE')]), false);
    expect(grouped.children).toHaveLength(2);
    grouped.children.forEach((entry) => {
      expect(entry.kind).toBe('node');
      if (entry.kind === 'node') expect(entry.repeat).toBe(1);
    });
  });
});
