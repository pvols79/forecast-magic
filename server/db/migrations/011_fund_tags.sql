ALTER TABLE operational_funds ADD COLUMN match_mode TEXT NOT NULL DEFAULT 'any' CHECK (match_mode IN ('any', 'all'));
CREATE TABLE operational_fund_tags (
  fund_id INTEGER NOT NULL REFERENCES operational_funds(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL,
  PRIMARY KEY (fund_id, tag_id)
);
CREATE INDEX operational_fund_tags_tag_idx ON operational_fund_tags(tag_id);
