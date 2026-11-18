ALTER TABLE operational_funds ADD COLUMN include_prior_spending INTEGER NOT NULL DEFAULT 0
  CHECK (include_prior_spending IN (0, 1));
