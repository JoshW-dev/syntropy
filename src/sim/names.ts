// Names for lineages (fixed, matched to the ink palette) and for groups (lineage plus a number).

export const TRIBE_NAMES = ['Blue', 'Red', 'Gold', 'Green', 'Violet', 'Rose'] as const;

/**
 * A group is named for the lineage of its first leader and its turn among that lineage's groups:
 * "Blue 3" is the third group a Blue leader founded in this world. `counts` holds one tally per lineage.
 */
export function groupName(tribe: number, counts: number[]): string {
  counts[tribe] = (counts[tribe] ?? 0) + 1;
  return `${TRIBE_NAMES[tribe]} ${counts[tribe]}`;
}
