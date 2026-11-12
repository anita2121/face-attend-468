
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json; charset=utf-8"
};

const MAX_BODY_SIZE = 3_000_000;
const EMBEDDING_LENGTH = 1404;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS
  });
}

function getJakartaDateTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));

  return {
    dateStr: `${p.year}-${p.month}-${p.day}`,
    timeStr: `${p.hour}:${p.minute}:${p.second}`
  };
}

async function readBody(request) {
  const text = await request.text();

  if (!text || text.length > MAX_BODY_SIZE) {
    throw new Error("Body kosong atau melebihi batas 3 MB.");
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Format JSON tidak valid.");
  }
}

function parseUser(row) {
  let embedding = [];

  try {
    embedding = JSON.parse(row.embedding);
  } catch {
    embedding = [];
  }

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

function parseLog(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    nik: row.nik,
    division: row.division || "",
    type: row.type,
    similarity: row.similarity,
    timestamp: row.timestamp,
    dateStr: row.date_str,
    timeStr: row.time_str,
    photo: row.photo || ""
  };
}

function validEmbedding(value) {
  return (
    Array.isArray(value) &&
    value.length === EMBEDDING_LENGTH &&
    value.every(
      number =>
        typeof number === "number" &&
        Number.isFinite(number)
    )
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    try {
      // WAJIB: binding D1 menggunakan huruf besar DB.
      if (!env.DB) {
        return json({
          success: false,
          message: "Binding D1 env.DB tidak ditemukan."
        }, 500);
      }

      // =========================================
      // 1. HEALTH CHECK
      // =========================================

      if (path === "/api/health" && method === "GET") {
        await env.DB.prepare("SELECT 1").first();

        const tables = await env.DB.prepare(`
          SELECT name
          FROM sqlite_master
          WHERE type = 'table'
          AND name IN ('users', 'attendance_logs')
        `).all();

        const tableNames = tables.results.map(x => x.name);

        return json({
          success: true,
          message: "FaceAttend 468 API aktif",
          database: "connected",
          tables: {
            users: tableNames.includes("users"),
            attendance_logs: tableNames.includes("attendance_logs")
          }
        });
      }

      // =========================================
      // 2. GET USERS
      // =========================================

      if (path === "/api/users" && method === "GET") {
        const result = await env.DB.prepare(`
          SELECT id, name, nik, division, embedding, photo, created_at
          FROM users
          ORDER BY id DESC
        `).all();

        return json({
          success: true,
          data: result.results.map(parseUser)
        });
      }

      // =========================================
      // 3. REGISTER USER
      // =========================================

      if (path === "/api/users" && method === "POST") {
        const body = await readBody(request);

        const name = String(body.name || "").trim();
        const nik = String(body.nik || "").trim();
        const division = String(body.division || "").trim();
        const photo = String(body.photo || "");
        const embedding = body.embedding;

        if (!name || !nik || !division) {
          return json({
            success: false,
            message: "Nama, NIK, dan divisi wajib diisi."
          }, 400);
        }

        if (nik.length > 100 || name.length > 200 || division.length > 200) {
          return json({
            success: false,
            message: "Nama, NIK, atau divisi terlalu panjang."
          }, 400);
        }

        if (!validEmbedding(embedding)) {
          return json({
            success: false,
            message: "Embedding harus berisi tepat 1404 angka valid."
          }, 400);
        }

        if (photo && !photo.startsWith("data:image/")) {
          return json({
            success: false,
            message: "Format foto tidak valid."
          }, 400);
        }

        const createdAt = new Date().toISOString();

        try {
          const result = await env.DB.prepare(`
            INSERT INTO users
              (name, nik, division, embedding, photo, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).bind(
            name,
            nik,
            division,
            JSON.stringify(embedding),
            photo,
            createdAt
          ).run();

          if (!result.success || !result.meta.changes) {
            throw new Error("D1 tidak mengonfirmasi penyimpanan pengguna.");
          }

          // Verifikasi ulang data yang baru dimasukkan.
          const saved = await env.DB.prepare(`
            SELECT id, name, nik, division, created_at
            FROM users
            WHERE id = ?
          `).bind(result.meta.last_row_id).first();

          if (!saved) {
            throw new Error("Data pengguna tidak ditemukan setelah INSERT.");
          }

          return json({
            success: true,
            message: "Pengguna berhasil disimpan ke Cloudflare D1.",
            data: saved
          }, 201);

        } catch (error) {
          if (String(error.message).toLowerCase().includes("unique")) {
            return json({
              success: false,
              message: "NIK sudah terdaftar."
            }, 409);
          }

          throw error;
        }
      }

      // =========================================
      // 4. DELETE USER
      // =========================================

      const deleteUserMatch = path.match(/^\/api\/users\/(\d+)$/);

      if (deleteUserMatch && method === "DELETE") {
        const id = Number(deleteUserMatch[1]);

        if (!Number.isSafeInteger(id) || id <= 0) {
          return json({
            success: false,
            message: "ID pengguna tidak valid."
          }, 400);
        }

        const existing = await env.DB.prepare(
          "SELECT id FROM users WHERE id = ?"
        ).bind(id).first();

        if (!existing) {
          return json({
            success: false,
            message: "Pengguna tidak ditemukan."
          }, 404);
        }

        await env.DB.batch([
          env.DB.prepare(
            "DELETE FROM attendance_logs WHERE user_id = ?"
          ).bind(id),

          env.DB.prepare(
            "DELETE FROM users WHERE id = ?"
          ).bind(id)
        ]);

        return json({
          success: true,
          message: "Pengguna dan riwayat presensinya berhasil dihapus."
        });
      }

      // =========================================
      // 5. GET ATTENDANCE
      // =========================================

      if (path === "/api/attendance" && method === "GET") {
        const date = url.searchParams.get("date");

        let result;

        if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
          result = await env.DB.prepare(`
            SELECT *
            FROM attendance_logs
            WHERE date_str = ?
            ORDER BY timestamp DESC, id DESC
          `).bind(date).all();
        } else {
          result = await env.DB.prepare(`
            SELECT *
            FROM attendance_logs
            ORDER BY timestamp DESC, id DESC
          `).all();
        }

        return json({
          success: true,
          data: result.results.map(parseLog)
        });
      }

      // =========================================
      // 6. CREATE ATTENDANCE
      // =========================================

      if (path === "/api/attendance" && method === "POST") {
        const body = await readBody(request);

        const userId = Number(body.userId);
        const type = String(body.type || "").toUpperCase();
        const similarity = Number(body.similarity);

        if (
          !Number.isSafeInteger(userId) ||
          userId <= 0 ||
          !["MASUK", "PULANG"].includes(type) ||
          !Number.isFinite(similarity) ||
          similarity < 0 ||
          similarity > 100
        ) {
          return json({
            success: false,
            message: "Data presensi tidak valid."
          }, 400);
        }

        // Ambil identitas asli dari database.
        const user = await env.DB.prepare(`
          SELECT id, name, nik, division
          FROM users
          WHERE id = ?
        `).bind(userId).first();

        if (!user) {
          return json({
            success: false,
            message: "Pengguna tidak ditemukan."
          }, 404);
        }

        const now = new Date();
        const timestamp = now.toISOString();
        const { dateStr, timeStr } = getJakartaDateTime(now);
        const photo = String(body.photo || "");

        if (photo && !photo.startsWith("data:image/")) {
          return json({
            success: false,
            message: "Format foto presensi tidak valid."
          }, 400);
        }

        // Cegah pencatatan tipe presensi yang sama
        // berulang kali pada hari yang sama.
        const duplicate = await env.DB.prepare(`
          SELECT id
          FROM attendance_logs
          WHERE user_id = ?
            AND type = ?
            AND date_str = ?
          LIMIT 1
        `).bind(userId, type, dateStr).first();

        if (duplicate) {
          return json({
            success: false,
            message: `Presensi ${type} pengguna ini sudah tercatat hari ini.`,
            duplicate: true
          }, 409);
        }

        const result = await env.DB.prepare(`
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

        if (!result.success || !result.meta.changes) {
          throw new Error("D1 tidak mengonfirmasi penyimpanan presensi.");
        }

        const saved = await env.DB.prepare(`
          SELECT *
          FROM attendance_logs
          WHERE id = ?
        `).bind(result.meta.last_row_id).first();

        if (!saved) {
          throw new Error("Riwayat tidak ditemukan setelah INSERT.");
        }

        return json({
          success: true,
          message: `Presensi ${type} berhasil disimpan ke D1.`,
          data: parseLog(saved)
        }, 201);
      }

      // =========================================
      // 7. DELETE ALL ATTENDANCE
      // =========================================

      if (path === "/api/attendance" && method === "DELETE") {
        const result = await env.DB.prepare(
          "DELETE FROM attendance_logs"
        ).run();

        return json({
          success: true,
          message: "Seluruh riwayat presensi berhasil dihapus.",
          deleted: result.meta.changes || 0
        });
      }

      // =========================================
      // 8. RESET DATABASE
      // =========================================

      if (path === "/api/database/reset" && method === "DELETE") {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM attendance_logs"),
          env.DB.prepare("DELETE FROM users")
        ]);

        return json({
          success: true,
          message: "Seluruh database berhasil direset."
        });
      }

      // =========================================
      // 9. NOT FOUND
      // =========================================

      return json({
        success: false,
        message: "Endpoint tidak ditemukan.",
        path,
        method
      }, 404);

    } catch (error) {
      console.error("FaceAttend 468 API Error:", error);

      return json({
        success: false,
        message: "Terjadi kesalahan pada server.",
        error: error instanceof Error
          ? error.message
          : String(error)
      }, 500);
    }
  }
};
