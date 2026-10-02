import initSqlJs, { Database } from 'sql.js';

export interface SqliteInspection {
  id: string;
  timestamp: string;
  product_name: string;
  anomaly_score: number;
  threshold: number;
  result: 'PASS' | 'FAIL';
  image_path: string;
}

let dbInstance: Database | null = null;
let initPromise: Promise<Database> | null = null;

const STORAGE_KEY = 'visionqc_sqlite_db';

/**
 * Initializes and returns the SQLite database instance.
 * VisionQC starts with an EMPTY state for every newly registered operator.
 * No sample or mock records are populated.
 */
export async function getDatabase(): Promise<Database> {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    let SQL: Awaited<ReturnType<typeof initSqlJs>>;

    try {
      SQL = await initSqlJs({
        locateFile: () => '/sql-wasm.wasm',
      });
    } catch (primaryErr) {
      console.warn('Local sql-wasm.wasm load failed, attempting CDN fallback:', primaryErr);
      try {
        SQL = await initSqlJs({
          locateFile: () => 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.14.2/sql-wasm.wasm',
        });
      } catch (cdnErr) {
        console.error('All SQLite WASM initialization failed:', cdnErr);
        throw new Error('SQLite engine failed to initialize.');
      }
    }

    const savedDbBase64 = localStorage.getItem(STORAGE_KEY);
    let db: Database;

    if (savedDbBase64) {
      try {
        const binaryStr = atob(savedDbBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        db = new SQL.Database(bytes);
        
        // Clean out any legacy mock seed records if present
        db.run("DELETE FROM inspections WHERE id LIKE 'QC-202610-0%' OR product_name = 'Precision Steel Bearing 6204' AND timestamp LIKE '2026-10-01%';");
      } catch (err) {
        console.warn('Could not restore saved SQLite database, creating fresh:', err);
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }

    // Create table if not exists according to user specification
    db.run(`
      CREATE TABLE IF NOT EXISTS inspections (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        product_name TEXT NOT NULL,
        anomaly_score REAL NOT NULL,
        threshold REAL NOT NULL,
        result TEXT NOT NULL,
        image_path TEXT NOT NULL
      );
    `);

    // No mock seed records populated! Table starts empty for every user.
    persistDatabase(db);

    dbInstance = db;
    return db;
  })();

  return initPromise;
}

/**
 * Persists the binary state of the SQLite database to localStorage
 */
function persistDatabase(db: Database) {
  try {
    const data = db.export();
    let binary = '';
    const len = data.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(data[i]);
    }
    const base64 = btoa(binary);
    localStorage.setItem(STORAGE_KEY, base64);
  } catch (err) {
    console.warn('Failed to persist SQLite database to localStorage:', err);
  }
}

/**
 * Inserts a new inspection record into SQLite.
 * Ensures no duplicate insertions if record ID already exists.
 */
export async function insertInspection(record: SqliteInspection): Promise<boolean> {
  const db = await getDatabase();

  // Check if ID already exists to prevent duplicate records
  const existing = db.exec("SELECT id FROM inspections WHERE id = ?;", [record.id]);
  if (existing.length > 0 && existing[0].values.length > 0) {
    return false; // Skip duplicate
  }

  db.run(
    `INSERT OR IGNORE INTO inspections (id, timestamp, product_name, anomaly_score, threshold, result, image_path)
     VALUES (?, ?, ?, ?, ?, ?, ?);`,
    [
      record.id,
      record.timestamp,
      record.product_name,
      record.anomaly_score,
      record.threshold,
      record.result,
      record.image_path,
    ]
  );

  persistDatabase(db);
  return true;
}

/**
 * Clears all inspections (for fresh user sessions)
 */
export async function clearAllInspections(): Promise<void> {
  const db = await getDatabase();
  db.run("DELETE FROM inspections;");
  persistDatabase(db);
}

/**
 * Queries inspections with optional search, result filter, and date ordering.
 */
export async function getInspections(params?: {
  search?: string;
  resultFilter?: 'ALL' | 'PASS' | 'FAIL';
  sortOrder?: 'DESC' | 'ASC';
}): Promise<SqliteInspection[]> {
  const db = await getDatabase();

  let query = "SELECT id, timestamp, product_name, anomaly_score, threshold, result, image_path FROM inspections";
  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (params?.resultFilter && params.resultFilter !== 'ALL') {
    conditions.push("result = ?");
    bindings.push(params.resultFilter);
  }

  if (params?.search && params.search.trim()) {
    conditions.push("(product_name LIKE ? OR id LIKE ?)");
    bindings.push(`%${params.search.trim()}%`, `%${params.search.trim()}%`);
  }

  if (conditions.length > 0) {
    query += " WHERE " + conditions.join(" AND ");
  }

  const order = params?.sortOrder === 'ASC' ? 'ASC' : 'DESC';
  query += ` ORDER BY timestamp ${order};`;

  const res = db.exec(query, bindings);
  if (res.length === 0) return [];

  const columns = res[0].columns;
  const rows = res[0].values;

  return rows.map((row) => {
    const item: Record<string, unknown> = {};
    columns.forEach((col, idx) => {
      item[col] = row[idx];
    });
    return {
      id: item.id as string,
      timestamp: item.timestamp as string,
      product_name: item.product_name as string,
      anomaly_score: Number(item.anomaly_score),
      threshold: Number(item.threshold),
      result: item.result as 'PASS' | 'FAIL',
      image_path: item.image_path as string,
    };
  });
}

/**
 * Returns comprehensive summary statistics calculated directly from real recorded inspections.
 * If there are no inspections:
 * - totalInspections = 0
 * - totalPass = 0
 * - totalFail = 0
 * - rejectionRate = 0
 * - todayInspections = 0
 * - todayPass = 0
 * - todayFail = 0
 * - recentInspections = []
 */
export async function getDatabaseStats(): Promise<{
  totalInspections: number;
  totalPass: number;
  totalFail: number;
  rejectionRate: number;
  todayInspections: number;
  todayPass: number;
  todayFail: number;
  hourlyStats: { hour: string; pass: number; fail: number }[];
  recentInspections: SqliteInspection[];
}> {
  const db = await getDatabase();
  
  // Total counts
  const totalRes = db.exec("SELECT COUNT(*) FROM inspections;");
  const passRes = db.exec("SELECT COUNT(*) FROM inspections WHERE result = 'PASS';");
  const failRes = db.exec("SELECT COUNT(*) FROM inspections WHERE result = 'FAIL';");

  const totalInspections = (totalRes[0]?.values[0]?.[0] as number) || 0;
  const totalPass = (passRes[0]?.values[0]?.[0] as number) || 0;
  const totalFail = (failRes[0]?.values[0]?.[0] as number) || 0;
  const rejectionRate = totalInspections > 0 ? Number(((totalFail / totalInspections) * 100).toFixed(2)) : 0;

  // Today's counts based on current date prefix
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayTotalRes = db.exec("SELECT COUNT(*) FROM inspections WHERE timestamp LIKE ?;", [`${todayStr}%`]);
  const todayPassRes = db.exec("SELECT COUNT(*) FROM inspections WHERE result = 'PASS' AND timestamp LIKE ?;", [`${todayStr}%`]);
  const todayFailRes = db.exec("SELECT COUNT(*) FROM inspections WHERE result = 'FAIL' AND timestamp LIKE ?;", [`${todayStr}%`]);

  const todayInspections = (todayTotalRes[0]?.values[0]?.[0] as number) || 0;
  const todayPass = (todayPassRes[0]?.values[0]?.[0] as number) || 0;
  const todayFail = (todayFailRes[0]?.values[0]?.[0] as number) || 0;

  // Hourly stats
  const hourlyStats: { hour: string; pass: number; fail: number }[] = [];
  const hours = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00'];
  for (const h of hours) {
    const prefix = h.slice(0, 2);
    const hPass = db.exec("SELECT COUNT(*) FROM inspections WHERE result = 'PASS' AND SUBSTR(timestamp, 12, 2) = ?;", [prefix]);
    const hFail = db.exec("SELECT COUNT(*) FROM inspections WHERE result = 'FAIL' AND SUBSTR(timestamp, 12, 2) = ?;", [prefix]);
    hourlyStats.push({
      hour: h,
      pass: (hPass[0]?.values[0]?.[0] as number) || 0,
      fail: (hFail[0]?.values[0]?.[0] as number) || 0,
    });
  }

  // Recent inspections
  const recentInspections = await getInspections({ sortOrder: 'DESC' });

  return {
    totalInspections,
    totalPass,
    totalFail,
    rejectionRate,
    todayInspections,
    todayPass,
    todayFail,
    hourlyStats,
    recentInspections: recentInspections.slice(0, 6),
  };
}
