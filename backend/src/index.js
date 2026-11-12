
const ALLOWED_ORIGINS = [
  "https://anita2121.github.io"
];

function corsHeaders(request) {
  const origin = request.headers.get("Origin");
  const headers = new Headers();

  if (ALLOWED_ORIGINS.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }

  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");

  return headers;
}

function json(data, status = 200, request) {
  const headers = corsHeaders(request);
  headers.set("Content-Type", "application/json; charset=utf-8");

  return new Response(JSON.stringify(data), {
    status,
    headers
  });
}

function parseUser(row) {
  let embedding = [];

  try {
    embedding = JSON.parse(row.embedding);
  } catch {}

  return {
    id: row.id,
    name: row.name,
    nik: row.nik,
    division: row.division,
    embedding,
    photo: row.photo || "",
    createdAt: row.created_at
  };
}

function parseAttendance(row) {
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
    photo: row.photo || ""
  };
}

async function readBody(request) {
  const text = await request.text();

  if (!text || text.length > 3000000) {
    throw new Error("Request body kosong atau terlalu besar.");
  }

  return JSON.parse(text);
}

function jakartaDateTime() {
  const now = new Date();

  return {
    timestamp: now.toISOString(),
    dateStr: new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jakarta",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now),
    timeStr: new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jakarta",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(now)
  };
}

async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = request.method.toUpperCase();

  if (!env.DB) {
    return json({
      success: false,
      message: "Binding D1 DB tidak ditemukan."
    }, 500, request);
  }

  const db = env.DB;

  // HEALTH
  if (path === "/api/health" && method === "GET") {
    const users = await db.prepare(
      "SELECT COUNT(*) AS total FROM users"
    ).first();

    const logs = await db.prepare(
      "SELECT COUNT(*) AS total FROM attendance_logs"
    ).first();

    return json({
      success: true,
      message: "FaceAttend 468 API aktif",
      database: "connected",
      tables: {
        users: true,
        attendance_logs: true
      },
      totalUsers: users.total,
      totalAttendance: logs.total
    }, 200, request);
  }

  // GET USERS
  if (path === "/api/users" && method === "GET") {
    const result = await db.prepare(
      "SELECT * FROM users ORDER BY id DESC"
    ).all();

    return json({
      success: true,
      data: result.results.map(parseUser)
    }, 200, request);
  }

  // REGISTER USER
  if (path === "/api/users" && method === "POST") {
    const body = await readBody(request);

    const name = String(body.name || "").trim();
    const nik = String(body.nik || "").trim();
    const division = String(body.division || "").trim();
    const embedding = body.embedding;
    const photo = body.photo || "";

    if (!name || !nik || !division) {
      return json({
        success: false,
        message: "Nama, NIK, dan divisi wajib diisi."
      }, 400, request);
    }

    if (
      !Array.isArray(embedding) ||
      embedding.length !== 1404 ||
      !embedding.every(Number.isFinite)
    ) {
      return json({
        success: false,
        message: "Embedding harus berisi 1404 angka valid."
      }, 400, request);
    }

    try {
      const result = await db.prepare(`
        INSERT INTO users
        (name, nik, division, embedding, photo, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(
        name,
        nik,
        division,
        JSON.stringify(embedding),
        photo,
        new Date().toISOString()
      ).run();

      return json({
        success: true,
        message: "Registrasi berhasil disimpan ke D1.",
        id: result.meta.last_row_id
      }, 201, request);

    } catch (error) {
      if (String(error.message).toLowerCase().includes("unique")) {
        return json({
          success: false,
          message: "NIK sudah terdaftar."
        }, 409, request);
      }

      throw error;
    }
  }

  // DELETE USER
  const deleteMatch = path.match(/^\/api\/users\/(\d+)$/);

  if (deleteMatch && method === "DELETE") {
    const id = Number(deleteMatch[1]);

    await db.batch([
      db.prepare(
        "DELETE FROM attendance_logs WHERE user_id = ?"
      ).bind(id),
      db.prepare(
        "DELETE FROM users WHERE id = ?"
      ).bind(id)
    ]);

    return json({
      success: true,
      message: "Pengguna berhasil dihapus."
    }, 200, request);
  }

  // GET ATTENDANCE
  if (path === "/api/attendance" && method === "GET") {
    const result = await db.prepare(
      "SELECT * FROM attendance_logs ORDER BY timestamp DESC"
    ).all();

    return json({
      success: true,
      data: result.results.map(parseAttendance)
    }, 200, request);
  }

  // POST ATTENDANCE
  if (path === "/api/attendance" && method === "POST") {
    const body = await readBody(request);

    const userId = Number(body.userId);
    const type = String(body.type || "").toUpperCase();
    const similarity = Number(body.similarity);

    if (
      !Number.isInteger(userId) ||
      userId <= 0 ||
      !["MASUK", "PULANG"].includes(type) ||
      !Number.isFinite(similarity) ||
      similarity < 0 ||
      similarity > 100
    ) {
      return json({
        success: false,
        message: "Data presensi tidak valid."
      }, 400, request);
    }

    const user = await db.prepare(
      "SELECT * FROM users WHERE id = ?"
    ).bind(userId).first();

    if (!user) {
      return json({
        success: false,
        message: "Pengguna tidak ditemukan."
      }, 404, request);
    }

    const date = jakartaDateTime();

    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(body.dateStr || "")
      ? body.dateStr
      : date.dateStr;

    const timeStr = /^\d{2}:\d{2}(:\d{2})?$/.test(body.timeStr || "")
      ? body.timeStr
      : date.timeStr;

    const existing = await db.prepare(`
      SELECT id FROM attendance_logs
      WHERE user_id = ? AND type = ? AND date_str = ?
    `).bind(userId, type, dateStr).first();

    if (existing) {
      return json({
        success: false,
        message: "Presensi jenis ini sudah tercatat hari ini."
      }, 409, request);
    }

    const result = await db.prepare(`
      INSERT INTO attendance_logs
      (user_id, name, nik, division, type, similarity,
       timestamp, date_str, time_str, photo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      user.id,
      user.name,
      user.nik,
      user.division,
      type,
      similarity,
      date.timestamp,
      dateStr,
      timeStr,
      body.photo || null
    ).run();

    return json({
      success: true,
      message: "Presensi berhasil disimpan.",
      id: result.meta.last_row_id
    }, 201, request);
  }

  // DELETE ALL ATTENDANCE
  if (path === "/api/attendance" && method === "DELETE") {
    await db.prepare(
      "DELETE FROM attendance_logs"
    ).run();

    return json({
      success: true,
      message: "Riwayat presensi berhasil dihapus."
    }, 200, request);
  }

  // RESET DATABASE
  if (path === "/api/database/reset" && method === "DELETE") {
    await db.batch([
      db.prepare("DELETE FROM attendance_logs"),
      db.prepare("DELETE FROM users")
    ]);

    return json({
      success: true,
      message: "Database berhasil direset."
    }, 200, request);
  }

  return json({
    success: false,
    message: "Endpoint tidak ditemukan."
  }, 404, request);
}

export default {
  async fetch(request, env) {
    // PREFLIGHT CORS
    if (request.method.toUpperCase() === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request)
      });
    }

    try {
      return await handle(request, env);
    } catch (error) {
      console.error("FaceAttend Worker:", error);

      return json({
        success: false,
        message: "Terjadi kesalahan pada server.",
        debug: error.message
      }, 500, request);
    }
  }
};
