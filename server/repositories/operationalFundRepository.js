import { getDatabase, withTransaction } from '../db/database.js';

const toBoolean = value => Boolean(value);

const hydrateFund = (db, row) => {
  if (!row) return null;
  const categoryIds = db.prepare(
    'SELECT category_id FROM operational_fund_categories WHERE fund_id = ? ORDER BY category_id'
  ).all(row.id).map(category => Number(category.category_id));
  const excludedTransactionIds = db.prepare(
    'SELECT transaction_id FROM operational_fund_exclusions WHERE fund_id = ? ORDER BY created_at'
  ).all(row.id).map(exclusion => String(exclusion.transaction_id));

  return {
    id: Number(row.id),
    parentId: row.parent_id == null ? null : Number(row.parent_id),
    occasionDate: row.occasion_date,
    purchasedOn: row.purchased_on,
    adjustments: db.prepare('SELECT id, date, amount_cents AS amountCents, note FROM operational_fund_adjustments WHERE fund_id = ? ORDER BY date, id').all(row.id),
    accountKey: row.account_key,
    name: row.name,
    fundType: row.fund_type,
    allocationMode: row.allocation_mode,
    allocationCents: Number(row.allocation_cents),
    initialBalanceCents: Number(row.initial_balance_cents),
    periodType: row.period_type,
    weeklyStartDay: row.weekly_start_day == null ? null : Number(row.weekly_start_day),
    anchorMonth: row.anchor_month == null ? null : Number(row.anchor_month),
    anchorDay: row.anchor_day == null ? null : Number(row.anchor_day),
    rolloverMode: row.rollover_mode,
    rolloverCapCents: row.rollover_cap_cents == null ? null : Number(row.rollover_cap_cents),
    targetCents: row.target_cents == null ? null : Number(row.target_cents),
    householdVisible: toBoolean(row.household_visible),
    active: toBoolean(row.active),
    createdOn: row.created_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    categoryIds,
    excludedTransactionIds,
  };
};

const findCategoryConflict = (db, accountKey, categoryIds, excludedFundId = null) => {
  if (categoryIds.length === 0) return null;
  const placeholders = categoryIds.map(() => '?').join(', ');
  const parameters = [accountKey, ...categoryIds];
  let excludedClause = '';
  if (excludedFundId != null) {
    excludedClause = 'AND f.id != ?';
    parameters.push(excludedFundId);
  }

  return db.prepare(`
    SELECT f.id AS fund_id, f.name AS fund_name, c.category_id
    FROM operational_fund_categories c
    JOIN operational_funds f ON f.id = c.fund_id
    WHERE f.account_key = ?
      AND f.active = 1
      AND c.category_id IN (${placeholders})
      ${excludedClause}
    LIMIT 1
  `).get(...parameters) || null;
};

const replaceCategories = (db, fundId, categoryIds) => {
  db.prepare('DELETE FROM operational_fund_categories WHERE fund_id = ?').run(fundId);
  const insert = db.prepare(
    'INSERT INTO operational_fund_categories (fund_id, category_id) VALUES (?, ?)'
  );
  for (const categoryId of categoryIds) insert.run(fundId, categoryId);
};

const normalizeInput = input => {
  const fundType = input.fundType || (input.periodType === 'all-time' ? 'reserved' : 'operating');
  const allocationMode = fundType === 'reserved' ? 'manual' : (input.allocationMode || 'scheduled');
  const periodType = fundType === 'reserved' || (fundType === 'sinking' && allocationMode === 'manual')
    ? 'all-time'
    : input.periodType;
  const rolloverMode = fundType === 'sinking'
    ? 'full'
    : periodType === 'all-time' ? 'none' : (input.rolloverMode || 'none');

  return {
    accountKey: String(input.accountKey),
    name: String(input.name).trim(),
    fundType,
    allocationMode,
    allocationCents: Number(input.allocationCents ?? 0),
    initialBalanceCents: fundType === 'sinking' ? Number(input.initialBalanceCents ?? 0) : 0,
    periodType,
    weeklyStartDay: periodType === 'weekly' ? Number(input.weeklyStartDay ?? 1) : null,
    anchorMonth: ['quarterly', 'yearly'].includes(periodType) ? Number(input.anchorMonth ?? 1) : null,
    anchorDay: ['monthly', 'quarterly', 'yearly'].includes(periodType) ? Number(input.anchorDay ?? 1) : null,
    rolloverMode,
    rolloverCapCents: rolloverMode === 'capped' ? Number(input.rolloverCapCents ?? 0) : null,
    targetCents: input.targetCents == null || input.targetCents === '' ? null : Number(input.targetCents),
    householdVisible: input.householdVisible ? 1 : 0,
    active: input.active === false ? 0 : 1,
    createdOn: input.createdOn || input.createdAt?.slice(0, 10) || new Date().toISOString().slice(0, 10),
    categoryIds: [...new Set((input.categoryIds || []).map(Number))],
  };
};

const validateInput = fund => {
  if (!fund.accountKey || !fund.name) throw new Error('Account and name are required.');
  if (!['operating', 'reserved', 'sinking'].includes(fund.fundType)) throw new Error('Unsupported Fund type.');
  if (!['manual', 'scheduled'].includes(fund.allocationMode)) throw new Error('Unsupported allocation mode.');
  if (!Number.isInteger(fund.allocationCents) || fund.allocationCents < 0) throw new Error('Allocation must be a non-negative amount.');
  if (!Number.isInteger(fund.initialBalanceCents) || fund.initialBalanceCents < 0) throw new Error('Initial balance must be a non-negative amount.');
  if (!['weekly', 'monthly', 'quarterly', 'yearly', 'all-time'].includes(fund.periodType)) throw new Error('Unsupported period type.');
  if (fund.fundType === 'operating' && fund.periodType === 'all-time') throw new Error('Operating Funds require a recurring period.');
  if (fund.fundType === 'reserved' && fund.periodType !== 'all-time') throw new Error('Reserved Funds must use an all-time period.');
  if (fund.fundType === 'sinking' && fund.allocationMode === 'scheduled' && fund.periodType === 'all-time') throw new Error('Automatic Sinking allocations require a recurring period.');
  if (!['none', 'full', 'capped'].includes(fund.rolloverMode)) throw new Error('Unsupported rollover mode.');
  if (fund.rolloverMode === 'capped' && (!Number.isInteger(fund.rolloverCapCents) || fund.rolloverCapCents < 0)) throw new Error('A non-negative rollover cap is required.');
  if (fund.targetCents != null && (!Number.isInteger(fund.targetCents) || fund.targetCents < 0)) throw new Error('Target must be a non-negative amount.');
  if (fund.categoryIds.some(id => !Number.isInteger(id))) throw new Error('Category IDs must be integers.');
};

export class OperationalFundRepository {
  listByAccount(accountKey, { includeDisabled = true } = {}) {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM operational_funds
      WHERE account_key = ? ${includeDisabled ? '' : 'AND active = 1'}
      ORDER BY active DESC, name COLLATE NOCASE
    `).all(accountKey);
    return rows.map(row => hydrateFund(db, row));
  }

  getById(id) {
    const db = getDatabase();
    return hydrateFund(db, db.prepare('SELECT * FROM operational_funds WHERE id = ?').get(id));
  }

  validateHierarchy(id, input) {
    const parentId = input.parentId == null || input.parentId === '' ? null : Number(input.parentId);
    if (parentId != null) {
      const parent = this.getById(parentId);
      if (!parent || parent.parentId != null || parent.id === Number(id) || parent.accountKey !== input.accountKey) {
        throw new Error('Choose a top-level parent Fund in the same account.');
      }
      if (id && this.listByAccount(input.accountKey).some(fund => fund.parentId === Number(id))) throw new Error('A Fund with sub-funds cannot become a sub-fund.');
    }
    for (const value of [input.occasionDate, input.purchasedOn]) {
      if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error('Enter a valid occasion or purchase date.');
    }
    return parentId;
  }

  create(input) {
    const fund = normalizeInput(input);
    validateInput(fund);
    const parentId = this.validateHierarchy(null, { ...input, accountKey: fund.accountKey });
    return withTransaction(db => {
      if (fund.active) {
        const conflict = findCategoryConflict(db, fund.accountKey, fund.categoryIds);
        if (conflict) {
          const error = new Error(`Category ${conflict.category_id} is already assigned to ${conflict.fund_name}.`);
          error.code = 'CATEGORY_CONFLICT';
          error.conflict = conflict;
          throw error;
        }
      }

      const now = new Date().toISOString();
      const result = db.prepare(`
        INSERT INTO operational_funds (
          account_key, name, fund_type, allocation_mode, allocation_cents,
          initial_balance_cents, period_type, weekly_start_day,
          anchor_month, anchor_day, rollover_mode, rollover_cap_cents,
          target_cents, household_visible, active, created_on, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        fund.accountKey, fund.name, fund.fundType, fund.allocationMode,
        fund.allocationCents, fund.initialBalanceCents, fund.periodType,
        fund.weeklyStartDay, fund.anchorMonth, fund.anchorDay, fund.rolloverMode,
        fund.rolloverCapCents, fund.targetCents, fund.householdVisible, fund.active, fund.createdOn,
        now, now
      );
      const id = Number(result.lastInsertRowid);
      db.prepare('UPDATE operational_funds SET parent_id = ?, occasion_date = ?, purchased_on = ? WHERE id = ?').run(parentId, input.occasionDate || null, input.purchasedOn || null, id);
      replaceCategories(db, id, fund.categoryIds);
      return hydrateFund(db, db.prepare('SELECT * FROM operational_funds WHERE id = ?').get(id));
    });
  }

  update(id, input) {
    const existing = this.getById(id);
    if (!existing) return null;
    const fund = normalizeInput({ ...existing, ...input });
    validateInput(fund);
    const metadata = { ...existing, ...input, accountKey: fund.accountKey };
    const parentId = this.validateHierarchy(id, metadata);
    const children = this.listByAccount(existing.accountKey).filter(child => child.parentId === Number(id));
    if (children.length && fund.accountKey !== existing.accountKey) throw new Error('Move sub-funds before changing the parent account.');

    return withTransaction(db => {
      if (fund.active) {
        const conflict = findCategoryConflict(db, fund.accountKey, fund.categoryIds, Number(id));
        if (conflict) {
          const error = new Error(`Category ${conflict.category_id} is already assigned to ${conflict.fund_name}.`);
          error.code = 'CATEGORY_CONFLICT';
          error.conflict = conflict;
          throw error;
        }
      }

      db.prepare(`
        UPDATE operational_funds SET
          account_key = ?, name = ?, fund_type = ?, allocation_mode = ?,
          allocation_cents = ?, initial_balance_cents = ?, period_type = ?,
          weekly_start_day = ?, anchor_month = ?, anchor_day = ?, rollover_mode = ?,
          rollover_cap_cents = ?, target_cents = ?, household_visible = ?, active = ?,
          created_on = ?, updated_at = ?
        WHERE id = ?
      `).run(
        fund.accountKey, fund.name, fund.fundType, fund.allocationMode,
        fund.allocationCents, fund.initialBalanceCents, fund.periodType,
        fund.weeklyStartDay, fund.anchorMonth, fund.anchorDay, fund.rolloverMode,
        fund.rolloverCapCents, fund.targetCents, fund.householdVisible, fund.active,
        fund.createdOn,
        new Date().toISOString(), id
      );
      db.prepare('UPDATE operational_funds SET parent_id = ?, occasion_date = ?, purchased_on = ? WHERE id = ?').run(parentId, metadata.occasionDate || null, metadata.purchasedOn || null, id);
      replaceCategories(db, Number(id), fund.categoryIds);
      const periodConfigurationChanged =
        existing.accountKey !== fund.accountKey ||
        existing.fundType !== fund.fundType ||
        existing.allocationMode !== fund.allocationMode ||
        existing.initialBalanceCents !== fund.initialBalanceCents ||
        existing.periodType !== fund.periodType ||
        existing.weeklyStartDay !== fund.weeklyStartDay ||
        existing.anchorMonth !== fund.anchorMonth ||
        existing.anchorDay !== fund.anchorDay;
      if (periodConfigurationChanged) {
        db.prepare('DELETE FROM operational_fund_current_state WHERE fund_id = ?').run(id);
      }
      return hydrateFund(db, db.prepare('SELECT * FROM operational_funds WHERE id = ?').get(id));
    });
  }

  delete(id) {
    if (getDatabase().prepare('SELECT id FROM operational_funds WHERE parent_id = ? LIMIT 1').get(id)) throw new Error('Move or delete sub-funds before deleting their parent.');
    return getDatabase().prepare('DELETE FROM operational_funds WHERE id = ?').run(id).changes > 0;
  }

  addAdjustment(fundId, input) {
    const fund = this.getById(fundId);
    if (!fund) return null;
    if (fund.fundType === 'operating') throw new Error('Balance adjustments are for Reserved and Sinking Funds.');
    const { date, amountCents, note } = input;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date < fund.createdOn) throw new Error('Adjustment date must be valid and on or after the Fund opening date.');
    if (!Number.isSafeInteger(amountCents) || amountCents === 0 || !String(note || '').trim()) throw new Error('A nonzero amount and a reason are required.');
    let target = null;
    if (input.transferToId != null) {
      target = this.getById(Number(input.transferToId));
      if (!target || target.id === fund.id || target.accountKey !== fund.accountKey || (target.parentId || target.id) !== (fund.parentId || fund.id) || target.fundType === 'operating' || !target.active || date < target.createdOn || amountCents >= 0) throw new Error('Moves require a negative amount and another active Reserved or Sinking Fund in the same family.');
    }
    return withTransaction(db => {
      if (target) {
        db.prepare('INSERT INTO operational_fund_adjustments (fund_id, date, amount_cents, note, created_at) VALUES (?, ?, ?, ?, ?)').run(target.id, date, -amountCents, `From ${fund.name}: ${String(note).trim()}`, new Date().toISOString());
        db.prepare('DELETE FROM operational_fund_current_state WHERE fund_id = ?').run(target.id);
      }
      db.prepare('INSERT INTO operational_fund_adjustments (fund_id, date, amount_cents, note, created_at) VALUES (?, ?, ?, ?, ?)').run(fundId, date, amountCents, String(note).trim(), new Date().toISOString());
      db.prepare('DELETE FROM operational_fund_current_state WHERE fund_id = ?').run(fundId);
      return this.getById(fundId);
    });
  }

  getCurrentState(fundId) {
    const row = getDatabase().prepare(
      'SELECT * FROM operational_fund_current_state WHERE fund_id = ?'
    ).get(fundId);
    if (!row) return null;
    return {
      fundId: Number(row.fund_id),
      periodStart: row.period_start,
      periodEnd: row.period_end,
      allocationCents: Number(row.allocation_cents),
      carryInCents: Number(row.carry_in_cents),
      remainingCents: Number(row.remaining_cents),
      calculatedThrough: row.calculated_through,
    };
  }

  saveCurrentState(state) {
    getDatabase().prepare(`
      INSERT INTO operational_fund_current_state (
        fund_id, period_start, period_end, allocation_cents, carry_in_cents,
        remaining_cents, calculated_through, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(fund_id) DO UPDATE SET
        period_start = excluded.period_start,
        period_end = excluded.period_end,
        allocation_cents = excluded.allocation_cents,
        carry_in_cents = excluded.carry_in_cents,
        remaining_cents = excluded.remaining_cents,
        calculated_through = excluded.calculated_through,
        updated_at = excluded.updated_at
    `).run(
      state.fundId, state.periodStart, state.periodEnd, state.allocationCents,
      state.carryInCents, state.remainingCents, state.calculatedThrough,
      new Date().toISOString()
    );
  }

  clearCurrentState(fundId) {
    getDatabase().prepare('DELETE FROM operational_fund_current_state WHERE fund_id = ?').run(fundId);
  }

  saveAllocationHistory(fundId, periods) {
    const fund = this.getById(fundId);
    if (!fund || fund.allocationMode !== 'scheduled' || fund.periodType === 'all-time') return;
    withTransaction(db => {
      const insert = db.prepare(`
        INSERT INTO operational_fund_allocation_history
          (fund_id, period_start, period_end, allocation_cents, carry_in_cents)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(fund_id, period_start) DO UPDATE SET
          period_end = excluded.period_end,
          allocation_cents = excluded.allocation_cents,
          carry_in_cents = excluded.carry_in_cents
      `);
      for (const period of periods) insert.run(
        fundId, period.periodStart, period.periodEnd, period.allocationCents, period.carryInCents
      );
    });
  }

  getAllocationHistory(fundId) {
    return getDatabase().prepare(`
      SELECT * FROM operational_fund_allocation_history
      WHERE fund_id = ? ORDER BY period_start DESC
    `).all(fundId).map(row => ({
      periodStart: row.period_start,
      periodEnd: row.period_end,
      allocationCents: Number(row.allocation_cents),
      carryInCents: Number(row.carry_in_cents),
    }));
  }

  addExclusion(fundId, transactionId) {
    if (transactionId == null || transactionId === '') throw new Error('Transaction ID is required.');
    getDatabase().prepare(`
      INSERT OR IGNORE INTO operational_fund_exclusions (fund_id, transaction_id, created_at)
      VALUES (?, ?, ?)
    `).run(fundId, String(transactionId), new Date().toISOString());
    return this.getById(fundId);
  }

  removeExclusion(fundId, transactionId) {
    getDatabase().prepare(`
      DELETE FROM operational_fund_exclusions WHERE fund_id = ? AND transaction_id = ?
    `).run(fundId, String(transactionId));
    return this.getById(fundId);
  }
}
