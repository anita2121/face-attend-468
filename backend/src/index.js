
const ALLOWED_ORIGINS = [
  "https://anita2121.github.io"
]; 

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8"
};

const MAX_BODY_SIZE = 3 * 1024 * 1024;
const EMBEDDING_LENGTH = 1404;

// =====================================================
// CORS
// =====================================================

function getCorsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = new Headers();

  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, DELETE, OPTIONS"
  );

  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");

  return headers;
}

function addCors(response, request) {
  const headers = new Headers(response.headers);
  const cors = getCorsHeaders(request);

  for (const [key, value] of cors.entries()) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

// =====================================================
// RESPONSE
// =====================================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

function success(data = null, message = "Berhasil.") {
  return json({
    success: true,
    message,
    ...(data !== null ? { data } : {})
  });
}

function error(message, status = 400, extra = {}) {
  return json({
    success: false,
    message,
    ...extra
  }, status);
}

// =====================================================
// HELPER
// =====================================================

async function readJson(request) {
  const contentLength = Number(
    request.headers.get("Content-Length") || 0
  );

  if (contentLength > MAX_BODY_SIZE) {
    throw new Error("Ukuran data terlalu besar.");
  }

  const text = await request.text();

  if (!text) {
    throw new Error("Request body kosong.");
  }

  if (new TextEncoder().encode(text).length > MAX_BODY_SIZE) {
    throw new Error("Ukuran data terlalu besar.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Format JSON tidak valid.");
  }
}

function parseEmbedding(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  return null;
}

function mapUser(row) {
  return {
    id: row.id,
    name: row.name,
    nik: row.nik,
    division: row.division,
    embedding: parseEmbedding(row.embedding),
    photo: row.photo || null,
    createdAt: row.created_at
  };
}

function mapAttendance(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    nik: row.nik,
    division: row.division,
    type: row.type,
    similarity: row.similarity,
    timestamp: row.timestamp,
    dateStr: row.date_str,
    timeStr: row.time_str,
    photo: row.photo || null
  };
}

function jakartaDateTime() {
  const now = new Date();

  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);

  const timeStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(now);

  return {
    timestamp: now.toISOString(),
    dateStr,
    timeStr
  };
}

function validText(value, maxLength = 255) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength
  );
}

function validEmbedding(embedding) {
  return (
    Array.isArray(embedding) &&
    embedding.length === EMBEDDING_LENGTH &&
    embedding.every(
      value => typeof value === "number" && Number.isFinite(value)
    )
  );
}

// =====================================================
// DATABASE CHECK
// =====================================================

async function checkDatabase(db) {
  await db.prepare("SELECT id FROM users LIMIT 1").all();
  await db.prepare("SELECT id FROM attendance_logs LIMIT 1").all();

  return {
    users: true,
    attendance_logs: true
  };
}

// =====================================================
// ROUTES
// =====================================================

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = request.method.toUpperCase();

  if (!env.DB) {
    return error(
      "Database D1 belum terhubung. Periksa binding DB di Cloudflare.",
      500
    );
  }

  const db = env.DB;

  // ---------------------------------------------------
  // HEALTH CHECK
  // ---------------------------------------------------

  if (path === "/api/health" && method === "GET") {
    try {
      const tables = await checkDatabase(db);

      return success({
        status: "online",
        database: "connected",
        tables
      }, "FaceAttend 468 API aktif.");
    } catch (err) {
      console.error("Health check database error:", err);

      return error(
        "Worker aktif, tetapi database belum siap.",
        500,
        {
          database: "error",
          debug: err.message
        }
      );
    }
  }

  // ---------------------------------------------------
  // GET USERS
  // ---------------------------------------------------

  if (path === "/api/users" && method === "GET") {
    const result = await db.prepare(`
      SELECT
        id,
        name,
        nik,
        division,
        embedding,
        photo,
        created_at
      FROM users
      ORDER BY id DESC
    `).all();

    const users = (result.results || []).map(mapUser);

    return success(users, "Data pengguna berhasil dimuat.");
  }

  // ---------------------------------------------------
  // REGISTER USER
  // ---------------------------------------------------

  if (path === "/api/users" && method === "POST") {
    const body = await readJson(request);

    const name = body.name?.trim();
    const nik = body.nik?.trim();
    const division = body.division?.trim();
    const embedding = parseEmbedding(body.embedding);
    const photo = body.photo || null;

    if (!validText(name, 150)) {
      return error("Nama wajib diisi dan maksimal 150 karakter.");
    }

    if (!validText(nik, 50)) {
      return error("NIK wajib diisi dan maksimal 50 karakter.");
    }

    if (!validText(division, 150)) {
      return error("Divisi wajib diisi dan maksimal 150 karakter.");
    }

    if (!validEmbedding(embedding)) {
      return error(
        "Data wajah tidak valid. Embedding harus berisi 1404 angka."
      );
    }

    if (
      photo !== null &&
      (typeof photo !== "string" || photo.length > 2 * 1024 * 1024)
    ) {
      return error("Foto tidak valid atau ukurannya terlalu besar.");
    }

    const createdAt = new Date().toISOString();

    try {
      const result = await db.prepare(`
        INSERT INTO users (
          name,
          nik,
          division,
          embedding,
          photo,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        name,
        nik,
        division,
        JSON.stringify(embedding),
        photo,
        createdAt
      ).run();

      return success({
        id: result.meta.last_row_id
      }, "Registrasi pengguna berhasil.");
    } catch (err) {
      console.error("Register user error:", err);

      if (
        err.message &&
        err.message.toLowerCase().includes("unique")
      ) {
        return error("NIK sudah terdaftar.", 409);
      }

      throw err;
    }
  }

  // ---------------------------------------------------
  // DELETE USER
  // ---------------------------------------------------

  const deleteUserMatch = path.match(/^\/api\/users\/(\d+)$/);

  if (deleteUserMatch && method === "DELETE") {
    const userId = Number(deleteUserMatch[1]);

    const user = await db.prepare(`
      SELECT id FROM users WHERE id = ?
    `).bind(userId).first();

    if (!user) {
      return error("Pengguna tidak ditemukan.", 404);
    }

    await db.batch([
      db.prepare(`
        DELETE FROM attendance_logs WHERE user_id = ?
      `).bind(userId),

      db.prepare(`
        DELETE FROM users WHERE id = ?
      `).bind(userId)
    ]);

    return success({
      id: userId
    }, "Pengguna dan riwayat absensinya berhasil dihapus.");
  }

  // ---------------------------------------------------
  // GET ATTENDANCE
  // ---------------------------------------------------

  if (path === "/api/attendance" && method === "GET") {
    const result = await db.prepare(`
      SELECT
        id,
        user_id,
        name,
        nik,
        division,
        type,
        similarity,
        timestamp,
        date_str,
        time_str,
        photo
      FROM attendance_logs
      ORDER BY timestamp DESC, id DESC
    `).all();

    const logs = (result.results || []).map(mapAttendance);

    return success(logs, "Data absensi berhasil dimuat.");
  }

  // ---------------------------------------------------
  // CREATE ATTENDANCE
  // ---------------------------------------------------

  if (path === "/api/attendance" && method === "POST") {
    const body = await readJson(request);

    const userId = Number(body.userId);
    const type = String(body.type || "").toUpperCase();
    const similarity = Number(body.similarity);

    if (!Number.isInteger(userId) || userId <= 0) {
      return error("ID pengguna tidak valid.");
    }

    if (!["MASUK", "PULANG"].includes(type)) {
      return error("Jenis absensi harus MASUK atau PULANG.");
    }

    if (
      !Number.isFinite(similarity) ||
      similarity < 0 ||
      similarity > 100
    ) {
      return error("Nilai similarity tidak valid.");
    }

    const user = await db.prepare(`
      SELECT id, name, nik, division
      FROM users
      WHERE id = ?
    `).bind(userId).first();

    if (!user) {
      return error("Pengguna tidak ditemukan.", 404);
    }

    const current = jakartaDateTime();

    const timestamp =
      typeof body.timestamp === "string" && body.timestamp.length <= 100
        ? body.timestamp
        : current.timestamp;

    const dateStr =
      typeof body.dateStr === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.dateStr)
        ? body.dateStr
        : current.dateStr;

    const timeStr =
      typeof body.timeStr === "string" &&
      /^\d{2}:\d{2}(:\d{2})?$/.test(body.timeStr)
        ? body.timeStr
        : current.timeStr;

    const photo = body.photo || null;

    if (
      photo !== null &&
      (typeof photo !== "string" || photo.length > 2 * 1024 * 1024)
    ) {
      return error("Foto absensi tidak valid atau terlalu besar.");
    }

    // Cegah absensi ganda untuk jenis dan tanggal yang sama.
    const existing = await db.prepare(`
      SELECT id
      FROM attendance_logs
      WHERE user_id = ?
        AND type = ?
        AND date_str = ?
      LIMIT 1
    `).bind(userId, type, dateStr).first();

    if (existing) {
      return error(
        type === "MASUK"
          ? "Absensi masuk hari ini sudah tercatat."
          : "Absensi pulang hari ini sudah tercatat.",
        409
      );
    }

    const result = await db.prepare(`
      INSERT INTO attendance_logs (
        user_id,
        name,
        nik,
        division,
        type,
        similarity,
        timestamp,
        date_str,
        time_str,
        photo
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      user.id,
      user.name,
      user.nik,
      user.division,
      type,
      similarity,
      timestamp,
      dateStr,
      timeStr,
      photo
    ).run();

    return success({
      id: result.meta.last_row_id,
      timeStr,
      dateStr
    }, "Absensi berhasil dicatat.");
  }

  // ---------------------------------------------------
  // DELETE ALL ATTENDANCE
  // ---------------------------------------------------

  if (path === "/api/attendance" && method === "DELETE") {
    await db.prepare(`
      DELETE FROM attendance_logs
    `).run();

    return success(null, "Semua riwayat absensi berhasil dihapus.");
  }

  // ---------------------------------------------------
  // RESET DATABASE
  // ---------------------------------------------------

  if (path === "/api/database/reset" && method === "DELETE") {
    await db.batch([
      db.prepare("DELETE FROM attendance_logs"),
      db.prepare("DELETE FROM users")
    ]);

    return success(
      null,
      "Database berhasil direset. Semua pengguna dan riwayat absensi telah dihapus."
    );
  }

  // ---------------------------------------------------
  // NOT FOUND
  // ---------------------------------------------------

  return error("Endpoint tidak ditemukan.", 404);
}

// =====================================================
// MAIN WORKER
// =====================================================

export default {
  async fetch(request, env) {
    // Preflight harus ditangani sebelum routing dan database.
    if (request.method.toUpperCase() === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request)
      });
    }

    try {
      const response = await handleRequest(request, env);
      return addCors(response, request);
    } catch (err) {
      console.error("Worker API error:", err);

      const response = error(
        "Terjadi kesalahan pada server.",
        500,
        {
          debug: err instanceof Error
            ? err.message
            : String(err)
        }
      );

      return addCors(response, request);
    }
  }
};
