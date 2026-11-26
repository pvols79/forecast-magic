// One boolean per transaction/fund, even when several selectors match. Selected
// tags match ANY tag; "all" joins the category group AND the tag group.
export const matchesFundSelectors = (fund, transaction) => {
  const categories = fund.categoryIds || [];
  const tags = fund.tagIds || [];
  const categoryMatch = categories.includes(Number(transaction.categoryId));
  const transactionTags = new Set((transaction.tagIds || []).map(Number));
  const tagMatch = tags.some(id => transactionTags.has(Number(id)));
  if (!categories.length) return tagMatch;
  if (!tags.length) return categoryMatch;
  return fund.matchMode === 'all' ? categoryMatch && tagMatch : categoryMatch || tagMatch;
};
