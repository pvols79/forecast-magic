import { getDatabase, withTransaction } from '../db/database.js';

const notFound = () => Object.assign(new Error('Reconciliation session or evidence was not found.'), { status: 404 });
const evidenceView = row => ({
  id: Number(row.id), sessionId: Number(row.session_id), kind: row.kind, filename: row.filename, mimeType: row.mime_type,
  sha256: row.content_sha256, byteLength: Number(row.byte_length), extractedText: row.extracted_text,
  extraction: JSON.parse(row.extraction_json), review: row.review_json ? JSON.parse(row.review_json) : null,
  reviewedAt: row.reviewed_at, uploadedAt: row.uploaded_at,
});
export class ReconciliationRepository {
  create(accountKey) {
    const result = getDatabase().prepare('INSERT INTO reconciliation_sessions (account_key,created_at) VALUES (?,?)').run(accountKey, new Date().toISOString());
    return this.getSession(Number(result.lastInsertRowid));
  }
  latest(accountKey) {
    const row = getDatabase().prepare('SELECT id FROM reconciliation_sessions WHERE account_key=? ORDER BY id DESC LIMIT 1').get(accountKey);
    return row ? this.getSession(Number(row.id)) : null;
  }
  getSession(id) {
    const row = getDatabase().prepare('SELECT * FROM reconciliation_sessions WHERE id=?').get(id);
    if (!row) throw notFound();
    const run = getDatabase().prepare('SELECT * FROM reconciliation_workflow_runs WHERE session_id=? ORDER BY id DESC LIMIT 1').get(id);
    return { id: Number(row.id), accountKey: row.account_key, createdAt: row.created_at, revision: Number(row.revision), decisions: JSON.parse(row.decisions_json),
      evidence: this.listEvidence(id), latestRun: run ? { id: Number(run.id), revision: Number(run.revision), completedAt: run.completed_at,
        stale: Number(run.revision) !== Number(row.revision), result: JSON.parse(run.result_json) } : null };
  }
  listEvidence(sessionId) {
    return getDatabase().prepare('SELECT *,length(content) AS byte_length FROM reconciliation_evidence WHERE session_id=? ORDER BY id').all(sessionId).map(evidenceView);
  }
  getEvidence(sessionId, id, withContent = false) {
    const row = getDatabase().prepare('SELECT *,length(content) AS byte_length FROM reconciliation_evidence WHERE session_id=? AND id=?').get(sessionId, id);
    if (!row) throw notFound();
    return { ...evidenceView(row), ...(withContent ? { content: Buffer.from(row.content) } : {}) };
  }
  saveEvidence(sessionId, evidence) {
    return withTransaction(db => {
      if (!db.prepare('SELECT id FROM reconciliation_sessions WHERE id=?').get(sessionId)) throw notFound();
      const existing = db.prepare('SELECT id FROM reconciliation_evidence WHERE session_id=? AND kind=? AND content_sha256=?').get(sessionId, evidence.kind, evidence.sha256);
      if (existing) return Number(existing.id);
      const totals = db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(length(content)),0) AS bytes FROM reconciliation_evidence WHERE session_id=?').get(sessionId);
      if (totals.count >= 25 || totals.bytes + evidence.content.length > 100 * 1024 * 1024) throw Object.assign(new Error('This session is limited to 25 files and 100 MB. Start a new session for more evidence.'), { status: 400 });
      const result = db.prepare(`INSERT INTO reconciliation_evidence
        (session_id,kind,filename,mime_type,content_sha256,content,extracted_text,extraction_json,uploaded_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(sessionId, evidence.kind, evidence.filename, evidence.mimeType, evidence.sha256,
        evidence.content, evidence.extractedText, JSON.stringify(evidence.extraction), new Date().toISOString());
      db.prepare('UPDATE reconciliation_sessions SET revision=revision+1 WHERE id=?').run(sessionId);
      return Number(result.lastInsertRowid);
    });
  }
  saveReview(sessionId, evidenceId, review) {
    return withTransaction(db => {
      const result = db.prepare('UPDATE reconciliation_evidence SET review_json=?,reviewed_at=? WHERE session_id=? AND id=?')
        .run(JSON.stringify(review), new Date().toISOString(), sessionId, evidenceId);
      if (!result.changes) throw notFound();
      db.prepare('UPDATE reconciliation_sessions SET revision=revision+1 WHERE id=?').run(sessionId);
    });
  }
  saveRun(sessionId, revision, result) {
    return withTransaction(db => {
      if (Number(db.prepare('SELECT revision FROM reconciliation_sessions WHERE id=?').get(sessionId)?.revision) !== revision) {
        throw Object.assign(new Error('Evidence changed while reconciliation was running. Run again using the reviewed files.'), { status: 409 });
      }
      const saved = db.prepare('INSERT INTO reconciliation_workflow_runs (session_id,revision,completed_at,result_json) VALUES (?,?,?,?)')
        .run(sessionId, revision, new Date().toISOString(), JSON.stringify(result));
      return Number(saved.lastInsertRowid);
    });
  }
  saveDecisions(sessionId, decisions) {
    getDatabase().prepare('UPDATE reconciliation_sessions SET decisions_json=?,revision=revision+1 WHERE id=?').run(JSON.stringify(decisions), sessionId);
  }
}
