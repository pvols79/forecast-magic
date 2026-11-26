import { describe, expect, it } from 'vitest';
import { matchesFundSelectors } from './fundMatching';

describe('fund category/tag matching', () => {
  const both = { categoryId: 10, tagIds: [501, 502] };
  it('supports category-only, tag-only, OR, and AND with any selected tag', () => {
    expect(matchesFundSelectors({ categoryIds: [10] }, both)).toBe(true);
    expect(matchesFundSelectors({ tagIds: [501, 502] }, both)).toBe(true);
    expect(matchesFundSelectors({ categoryIds: [10], tagIds: [501], matchMode: 'any' }, { categoryId: 11, tagIds: [501] })).toBe(true);
    expect(matchesFundSelectors({ categoryIds: [10], tagIds: [501], matchMode: 'all' }, { categoryId: 11, tagIds: [501] })).toBe(false);
    expect(matchesFundSelectors({ categoryIds: [10], tagIds: [501, 502], matchMode: 'all' }, { categoryId: 10, tagIds: [502] })).toBe(true);
    expect(matchesFundSelectors({ categoryIds: [10], tagIds: [501], matchMode: 'all' }, { categoryId: 10, tagIds: [] })).toBe(false);
    expect(matchesFundSelectors({}, both)).toBe(false);
    expect(matchesFundSelectors({ tagIds: [501] }, { tagIds: ['501'] })).toBe(true);
  });
});
