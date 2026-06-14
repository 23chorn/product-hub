import { MongoClient, type Db, type Collection, ObjectId } from 'mongodb';
import Logger from '../utils/logger';

const logger = new Logger('MONGO-CLIENT');

const MONGO_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017';
const MONGO_DB  = process.env.MONGODB_DB  ?? 'product-agent';

export interface ArtifactDocument {
  _id?:          ObjectId;
  artifact_id:   number;        // SQLite artifacts.id — set after SQLite insert
  item_id:       string;        // parent initiative id
  session_id:    string;
  stage:         string;        // e.g. 'analyst', 'pm_prd', 'solution_architect'
  artifact_type: string;        // e.g. 'research', 'prd', 'architecture'
  content:       Record<string, unknown> | string;  // parsed JSON object or raw string
  created_at:    Date;
  updated_at:    Date;
}

// ── Singleton connection ──────────────────────────────────────────────────────

let _client:         MongoClient | null = null;
let _db:             Db | null = null;
let _connectPromise: Promise<Db | null> | null = null;
let _available       = true; // set false after first failed connect; reset on close

async function connect(): Promise<Db | null> {
  try {
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 3_000 });
    await client.connect();
    _client = client;
    _db = client.db(MONGO_DB);
    logger.info(`MongoDB connected: ${MONGO_URI} / db=${MONGO_DB}`);

    // Ensure indexes on first connection
    const col = _db.collection<ArtifactDocument>('artifacts');
    await col.createIndex({ artifact_id: 1 }, { unique: true, sparse: true });
    await col.createIndex({ item_id: 1 });
    await col.createIndex({ artifact_type: 1 });
    await col.createIndex({ session_id: 1 });

    return _db;
  } catch (err: any) {
    logger.warn(`MongoDB unavailable — artifact content will fall back to disk: ${err.message}`);
    _available = false;
    _connectPromise = null;
    return null;
  }
}

/** Returns the shared Db instance, or null if MongoDB is unreachable. */
export function getMongoDb(): Promise<Db | null> {
  if (!_available) return Promise.resolve(null);
  if (_db)         return Promise.resolve(_db);
  if (!_connectPromise) _connectPromise = connect();
  return _connectPromise;
}

export async function closeMongoDb(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = null;
    _db = null;
    _connectPromise = null;
    _available = true;
  }
}

// ── Collection accessor ───────────────────────────────────────────────────────

export async function getArtifactCollection(): Promise<Collection<ArtifactDocument> | null> {
  const db = await getMongoDb();
  return db ? db.collection<ArtifactDocument>('artifacts') : null;
}

// ── CRUD helpers ──────────────────────────────────────────────────────────────

/**
 * Insert a new artifact document. Returns the MongoDB ObjectId string, or null on failure.
 * The caller should then write artifact_id back via updateArtifactDocId().
 */
export async function insertArtifactDoc(
  doc: Omit<ArtifactDocument, '_id' | 'artifact_id'>
): Promise<string | null> {
  const col = await getArtifactCollection();
  if (!col) return null;
  try {
    const result = await col.insertOne({ ...doc } as ArtifactDocument);
    return result.insertedId.toString();
  } catch (err: any) {
    logger.warn(`MongoDB insertArtifactDoc failed: ${err.message}`);
    return null;
  }
}

/** Back-fill the SQLite artifact_id onto the MongoDB document. */
export async function updateArtifactDocId(mongoId: string, artifactId: number): Promise<void> {
  const col = await getArtifactCollection();
  if (!col) return;
  try {
    await col.updateOne({ _id: new ObjectId(mongoId) }, { $set: { artifact_id: artifactId } });
  } catch (err: any) {
    logger.warn(`MongoDB updateArtifactDocId failed: ${err.message}`);
  }
}

/** Read artifact content by MongoDB ObjectId string. Returns the stringified JSON or raw string. */
export async function readArtifactDoc(mongoId: string): Promise<string | null> {
  const col = await getArtifactCollection();
  if (!col) return null;
  try {
    const doc = await col.findOne({ _id: new ObjectId(mongoId) });
    if (!doc) return null;
    return typeof doc.content === 'string'
      ? doc.content
      : JSON.stringify(doc.content, null, 2);
  } catch (err: any) {
    logger.warn(`MongoDB readArtifactDoc(${mongoId}) failed: ${err.message}`);
    return null;
  }
}

/** Overwrite the content of an existing artifact document. */
export async function replaceArtifactDocContent(
  mongoId: string,
  content: Record<string, unknown> | string
): Promise<boolean> {
  const col = await getArtifactCollection();
  if (!col) return false;
  try {
    const result = await col.updateOne(
      { _id: new ObjectId(mongoId) },
      { $set: { content, updated_at: new Date() } }
    );
    return result.modifiedCount > 0;
  } catch (err: any) {
    logger.warn(`MongoDB replaceArtifactDocContent(${mongoId}) failed: ${err.message}`);
    return false;
  }
}

/** Parse a JSON string into a BSON-compatible object, or return the raw string if not valid JSON. */
export function parseContentForMongo(raw: string): Record<string, unknown> | string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
  } catch { /* not JSON — store as string */ }
  return raw;
}
