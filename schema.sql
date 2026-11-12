CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    nik TEXT NOT NULL UNIQUE,
    division TEXT NOT NULL,
    embedding TEXT NOT NULL,
    photo TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    nik TEXT NOT NULL,
    division TEXT,
    type TEXT NOT NULL,
    similarity REAL NOT NULL,
    timestamp TEXT NOT NULL,
    date_str TEXT NOT NULL,
    time_str TEXT NOT NULL,
    photo TEXT
);

CREATE INDEX IF NOT EXISTS idx_attendance_date
ON attendance_logs(date_str);

CREATE INDEX IF NOT EXISTS idx_attendance_user
ON attendance_logs(user_id);
