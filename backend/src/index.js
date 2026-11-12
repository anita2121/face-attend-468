if (
        path === "/api/attendance" &&
        method === "POST"
      ) {
        const body = await readBody(request);

        const userId = Number(body.userId);

        const name =
          String(body.name || "").trim();

        const nik =
          String(body.nik || "").trim();

        const division =
          String(body.division || "").trim();

        const type =
          String(body.type || "").toUpperCase();

        const similarity =
          Number(body.similarity);

        const timestamp =
          body.timestamp || new Date().toISOString();

        const dateStr =
          String(body.dateStr || "");

        const timeStr =
          String(body.timeStr || "");

        const photo =
          body.photo == null ? "" : String(body.photo);

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

        if (photo.length > 2_000_000) {
          return response({
            success: false,
            message: "Ukuran foto terlalu besar"
          }, 400);
        }

        // Periksa pengguna

        const user = await env.DB.prepare(
          "SELECT id FROM users WHERE id = ?"
        ).bind(userId).first();

        if (!user) {
          return response({
            success: false,
            message: "Pengguna tidak ditemukan"
          }, 404);
        }

        // Simpan presensi

        const result = await env.DB.prepare(`
          INSERT INTO attendance_logs
            (
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

      // DELETE ALL ATTENDANCE

      if (
        path === "/api/attendance" &&
        method === "DELETE"
      ) {
        await env.DB
          .prepare("DELETE FROM attendance_logs")
          .run();

        return response({
          success: true,
          message: "Semua riwayat presensi berhasil dihapus"
        });
      }

      // =====================================
      // ENDPOINT TIDAK DITEMUKAN
      // =====================================

      return response({
        success: false,
        message: "Endpoint tidak ditemukan"
      }, 404);

    } catch (error) {

      console.error("FaceAttend API Error:", error);

      return response({
        success: false,
        message: "Terjadi kesalahan pada server"
      }, 500);
    }
  }
};
