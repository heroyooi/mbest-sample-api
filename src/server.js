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
    return { ok: false, error: "title is required." };
  }
  if (!content) {
    return { ok: false, error: "content is required." };
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

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
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
  seedStatement.run("First post", "This is sample seed data for CRUD demo.", now, now);
  seedStatement.run("Second post", "Try list/detail/create/edit/delete flow.", now, now);
  seedStatement.run("Third post", "Data is persisted in SQLite database.", now, now);
}

const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
if (userCount === 0) {
  const now = new Date().toISOString();
  db.prepare(
    "INSERT INTO users (name, email, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
  ).run("Demo User", "demo@sample.com", "1234", now, now);
}

const mapUser = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  createdAt: row.createdAt
});

const createToken = (user) => {
  return Buffer.from(`${user.id}:${user.email}:${Date.now()}`).toString("base64url");
};

const parseToken = (token) => {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf8");
    const [idRaw, email] = decoded.split(":");
    const id = Number(idRaw);
    if (!Number.isInteger(id) || !email) {
      return null;
    }
    return { id, email };
  } catch {
    return null;
  }
};

const readBearerToken = (req) => {
  const header = String(req.headers.authorization || "");
  if (!header.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
};

app.get("/api/health", (req, res) => {
  return sendSuccess(res, {
    service: "sample-backend",
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
    return sendError(res, "Invalid id.", 422);
  }

  try {
    const post = db
      .prepare(
        "SELECT id, title, content, created_at AS createdAt, updated_at AS updatedAt FROM posts WHERE id = ?"
      )
      .get(id);

    if (!post) {
      return sendError(res, "Post not found.", 404);
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
    return sendError(res, "Invalid id.", 422);
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
      return sendError(res, "Post not found.", 404);
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
    return sendError(res, "Invalid id.", 422);
  }

  try {
    const result = db.prepare("DELETE FROM posts WHERE id = ?").run(id);
    if (result.changes === 0) {
      return sendError(res, "Post not found.", 404);
    }
    return sendSuccess(res, { id });
  } catch (error) {
    return sendError(res, error.message, 500);
  }
});

app.post("/api/auth/signup", (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "").trim();

  if (!name || !email || !password) {
    return sendError(res, "name, email, password are required.", 422);
  }

  try {
    const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (exists) {
      return sendError(res, "This email is already registered.", 409);
    }

    const now = new Date().toISOString();
    const created = db
      .prepare(
        "INSERT INTO users (name, email, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(name, email, password, now, now);

    const user = db
      .prepare("SELECT id, name, email, created_at AS createdAt FROM users WHERE id = ?")
      .get(created.lastInsertRowid);

    return sendSuccess(
      res,
      {
        token: createToken(user),
        user: mapUser(user)
      },
      201
    );
  } catch (error) {
    return sendError(res, error.message, 500);
  }
});

app.post("/api/auth/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "").trim();

  if (!email || !password) {
    return sendError(res, "email and password are required.", 422);
  }

  try {
    const user = db
      .prepare("SELECT id, name, email, password, created_at AS createdAt FROM users WHERE email = ?")
      .get(email);

    if (!user || user.password !== password) {
      return sendError(res, "Invalid email or password.", 401);
    }

    return sendSuccess(res, {
      token: createToken(user),
      user: mapUser(user)
    });
  } catch (error) {
    return sendError(res, error.message, 500);
  }
});

app.get("/api/auth/me", (req, res) => {
  const token = readBearerToken(req);
  if (!token) {
    return sendError(res, "Bearer token is required.", 401);
  }

  const claims = parseToken(token);
  if (!claims) {
    return sendError(res, "Invalid token.", 401);
  }

  try {
    const user = db
      .prepare("SELECT id, name, email, created_at AS createdAt FROM users WHERE id = ? AND email = ?")
      .get(claims.id, claims.email);

    if (!user) {
      return sendError(res, "Invalid token.", 401);
    }

    return sendSuccess(res, { user: mapUser(user) });
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
    return sendError(res, "a and b must be numbers.", 422);
  }

  return sendSuccess(res, {
    a,
    b,
    result: a + b
  });
});

app.get("/api/fail", (req, res) => {
  return sendError(res, "This endpoint always fails for demo.", 500);
});

app.use((req, res) => {
  return sendError(res, "API route not found.", 404);
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
      console.error(`[backend] port ${port} is already in use. Try: set PORT=5000 && npm run dev`);
      process.exit(1);
    }

    throw error;
  });
};

if (require.main === module) {
  startServer(PORT);
}

module.exports = app;
