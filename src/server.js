const express = require("express");
const cors = require("cors");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const app = express();
const isVercel = process.env.VERCEL === "1";
const PORT = Number(process.env.PORT) || 4000;

app.use(cors({ origin: true }));
app.use(express.json());

const sendSuccess = (res, data, status = 200) => {
  return res.status(status).json({ success: true, data });
};

const sendError = (res, error, status = 400) => {
  return res.status(status).json({ success: false, error: String(error || "Unknown error") });
};

const parseId = (idParam) => Number(idParam);

const validatePostInput = (body) => {
  const title = String(body?.title || "").trim();
  const content = String(body?.content || "").trim();

  if (!title) {
    return { ok: false, error: "title은 필수입니다." };
  }
  if (!content) {
    return { ok: false, error: "content는 필수입니다." };
  }
  return { ok: true, value: { title, content } };
};

const dataRootDirectory = isVercel ? "/tmp" : path.join(__dirname, "..");
const dbDirectory = path.join(dataRootDirectory, "data");
const dbPath = path.join(dbDirectory, "app.db");
fs.mkdirSync(dbDirectory, { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const postCount = db.prepare("SELECT COUNT(*) AS count FROM posts").get().count;
if (postCount === 0) {
  const now = new Date().toISOString();
  const seedStatement = db.prepare(
    "INSERT INTO posts (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)"
  );
  seedStatement.run("첫 번째 글", "CRUD 예시를 위한 샘플 데이터입니다.", now, now);
  seedStatement.run("두 번째 글", "목록/상세/쓰기/수정/삭제 라우트를 확인해보세요.", now, now);
  seedStatement.run("세 번째 글", "SQLite 저장소라 서버 재시작 후에도 데이터가 유지됩니다.", now, now);
}

app.get("/api/health", (req, res) => {
  return sendSuccess(res, {
    service: "vue-sample-backend",
    sqlite: dbPath,
    now: new Date().toISOString()
  });
});

app.get("/api/posts", (req, res) => {
  try {
    const rows = db
      .prepare(
        "SELECT id, title, content, created_at AS createdAt, updated_at AS updatedAt FROM posts ORDER BY id DESC"
      )
      .all();
    return sendSuccess(res, rows);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
});

app.get("/api/posts/:id", (req, res) => {
  const id = parseId(req.params.id);

  if (!Number.isInteger(id)) {
    return sendError(res, "유효한 id가 아닙니다.", 422);
  }

  try {
    const post = db
      .prepare(
        "SELECT id, title, content, created_at AS createdAt, updated_at AS updatedAt FROM posts WHERE id = ?"
      )
      .get(id);

    if (!post) {
      return sendError(res, "게시글을 찾을 수 없습니다.", 404);
    }

    return sendSuccess(res, post);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
});

app.post("/api/posts", (req, res) => {
  const validation = validatePostInput(req.body);
  if (!validation.ok) {
    return sendError(res, validation.error, 422);
  }

  try {
    const now = new Date().toISOString();
    const result = db
      .prepare("INSERT INTO posts (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(validation.value.title, validation.value.content, now, now);

    const createdPost = db
      .prepare(
        "SELECT id, title, content, created_at AS createdAt, updated_at AS updatedAt FROM posts WHERE id = ?"
      )
      .get(result.lastInsertRowid);

    return sendSuccess(res, createdPost, 201);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
});

app.put("/api/posts/:id", (req, res) => {
  const id = parseId(req.params.id);
  if (!Number.isInteger(id)) {
    return sendError(res, "유효한 id가 아닙니다.", 422);
  }

  const validation = validatePostInput(req.body);
  if (!validation.ok) {
    return sendError(res, validation.error, 422);
  }

  try {
    const now = new Date().toISOString();
    const result = db
      .prepare("UPDATE posts SET title = ?, content = ?, updated_at = ? WHERE id = ?")
      .run(validation.value.title, validation.value.content, now, id);

    if (result.changes === 0) {
      return sendError(res, "게시글을 찾을 수 없습니다.", 404);
    }

    const updatedPost = db
      .prepare(
        "SELECT id, title, content, created_at AS createdAt, updated_at AS updatedAt FROM posts WHERE id = ?"
      )
      .get(id);

    return sendSuccess(res, updatedPost);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
});

app.delete("/api/posts/:id", (req, res) => {
  const id = parseId(req.params.id);
  if (!Number.isInteger(id)) {
    return sendError(res, "유효한 id가 아닙니다.", 422);
  }

  try {
    const result = db.prepare("DELETE FROM posts WHERE id = ?").run(id);
    if (result.changes === 0) {
      return sendError(res, "게시글을 찾을 수 없습니다.", 404);
    }
    return sendSuccess(res, { id });
  } catch (error) {
    return sendError(res, error.message, 500);
  }
});

app.get("/api/greeting", (req, res) => {
  const name = String(req.query.name || "").trim() || "Guest";
  return sendSuccess(res, {
    message: `Hello, ${name}!`,
    createdAt: new Date().toISOString()
  });
});

app.post("/api/sum", (req, res) => {
  const a = Number(req.body?.a);
  const b = Number(req.body?.b);

  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return sendError(res, "a, b는 숫자여야 합니다.", 422);
  }

  return sendSuccess(res, {
    a,
    b,
    result: a + b
  });
});

app.get("/api/fail", (req, res) => {
  return sendError(res, "의도적으로 실패를 반환하는 API입니다.", 500);
});

app.use((req, res) => {
  return sendError(res, "존재하지 않는 API 경로입니다.", 404);
});

const startServer = (port, retriesLeft = 10) => {
  const server = app.listen(port, () => {
    console.log(`[backend] sqlite: ${dbPath}`);
    console.log(`[backend] listening on http://localhost:${port}`);
  });

  server.on("error", (error) => {
    if (error.code === "EADDRINUSE" && retriesLeft > 0 && !process.env.PORT) {
      const nextPort = port + 1;
      console.warn(`[backend] port ${port} is in use, retrying on ${nextPort}`);
      startServer(nextPort, retriesLeft - 1);
      return;
    }

    if (error.code === "EADDRINUSE") {
      console.error(
        `[backend] port ${port} is already in use. Try: set PORT=5000 && npm run dev`
      );
      process.exit(1);
    }

    throw error;
  });
};

if (require.main === module) {
  startServer(PORT);
}

module.exports = app;
