const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8"
};

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS
  });
}

function parseUser(row) {
  return {
    id: row.id,
    name: row.name,
    nik: row.nik,
    division: row.division,
    embedding: JSON.parse(row.embedding),
    photo: row.photo,
    createdAt: row.created_at
  };
}

function parseLog(row) {
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
    photo: row.photo
  };
}

async function readBody(request) {
  const text = await request.text();

  if (text.length > 3_000_000) {
    throw new Error("Ukuran data terlalu besar");
  }

  return JSON.parse(text);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method;

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // Tes koneksi API dan database
      if (path === "/api/health" && method === "GET") {
        await env.DB.prepare("SELECT 1").first();

        return response({
          success: true,
          message: "FaceAttend 468 API aktif",
          database: "connected"
        });
      }

      // =========================================
      // DATA PENGGUNA
      // =========================================

      // Ambil semua pengguna
      if (path === "/api/users" && method === "GET") {
        const result = await env.DB
          .prepare("SELECT * FROM users ORDER BY id DESC")
          .all();

        return response({
          success: true,
          data: result.results.map(parseUser)
        });
      }

      // Tambah pengguna
      if (path === "/api/users" && method === "POST") {
        const body = await readBody(request);

        const name = String(body.name || "").trim();
        const nik = String(body.nik || "").trim();
        const division = String(body.division || "").trim();
        const photo = String(body.photo || "");
        const embedding = body.embedding;

        if (!name  !nik  !division) {
          return response({
            success: false,
            message: "Nama, NIK, dan divisi wajib diisi"
          }, 400);
        }

        if (!Array.isArray(embedding) || embedding.length === 0) {
          return response({
            success: false,
            message: "Data embedding wajah tidak valid"
          }, 400);
        }

        const createdAt = body.createdAt || new Date().toISOString();

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

          return response({
            success: true,
            message: "Pengguna berhasil didaftarkan",
            id: result.meta.last_row_id
          }, 201);
        } catch (error) {
          if (String(error.message).toLowerCase().includes("unique")) {
            return response({
              success: false,
              message: "NIK sudah terdaftar"
            }, 409);
          }
          throw error;
        }
      }

      // Hapus pengguna berdasarkan ID
      const userDelete = path.match(/^\/api\/users\/(\d+)$/);

      if (userDelete && method === "DELETE") {
        const id = Number(userDelete[1]);
        await env.DB.batch([
          env.DB.prepare("DELETE FROM attendance_logs WHERE user_id = ?").bind(id),
          env.DB.prepare("DELETE FROM users WHERE id = ?").bind(id)
        ]);

        return response({
          success: true,
          message: "Pengguna berhasil dihapus"
        });
      }

      // =========================================
      // RIWAYAT PRESENSI
      // =========================================

      // Ambil semua riwayat presensi
      if (path === "/api/attendance" && method === "GET") {
        const result = await env.DB
          .prepare("SELECT * FROM attendance_logs ORDER BY timestamp DESC")
          .all();

        return response({
          success: true,
          data: result.results.map(parseLog)
        });
      }

      // Tambah riwayat presensi
      if (path === "/api/attendance" && method === "POST") {
        const body = await readBody(request);

        const userId = Number(body.userId);
        const name = String(body.name || "").trim();
        const nik = String(body.nik || "").trim();
        const division = String(body.division || "").trim();
        const type = String(body.type || "").toUpperCase();
        const similarity = Number(body.similarity);
        const timestamp = body.timestamp || new Date().toISOString();
        const dateStr = String(body.dateStr || "");
        const timeStr = String(body.timeStr || "");
        const photo = String(body.photo || "");

        if (
          !Number.isInteger(userId) ||
          userId <= 0 ||
          !name ||
          !nik ||
          !["MASUK", "PULANG"].includes(type) ||
          !Number.isFinite(similarity) ||
          similarity < 0 ||
          similarity > 100
        ) {
          return response({
            success: false,
            message: "Data presensi tidak valid"
          }, 400);
        }

        const result = await env.DB.prepare(`
          INSERT INTO attendance_logs
            (user_id, name, nik, division, type, similarity,
             timestamp, date_str, time_str, photo)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          userId,
          name,
          nik,
          division,
          type,
          similarity,
          timestamp,
          dateStr,
          timeStr,
          photo
        ).run();

        return response({
          success: true,
          message: "Presensi berhasil disimpan",
          id: result.meta.last_row_id
        }, 201);
      }

      // Hapus semua riwayat presensi
      if (path === "/api/attendance" && method === "DELETE") {
        await env.DB.prepare("DELETE FROM attendance_logs").run();

        return response({
          success: true,
          message: "Semua riwayat presensi berhasil dihapus"
        });
      }

      // Hapus seluruh database aplikasi
      if (path === "/api/database/reset" && method === "DELETE") {
        await env.DB.batch([
          env.DB.prepare("DELETE FROM attendance_logs"),
          env.DB.prepare("DELETE FROM users")
        ]);

        return response({
          success: true,
          message: "Seluruh data berhasil dihapus"
        });
      }

      return response({
        success: false,
        message: "Endpoint tidak ditemukan"
      }, 404);

    } catch (error) {
      console.error("API Error:", error);

      return response({
        success: false,
        message: "Terjadi kesalahan pada server",
        error: error.message
      }, 500);
    }
  }
};
