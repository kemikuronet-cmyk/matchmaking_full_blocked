const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();

// クライアント配信
app.use(express.static(path.join(__dirname, "../client/dist")));

// ルートアクセスは index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

// サーバー + Socket.IO
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 4000;

// データ管理
let users = [];
let matches = [];
let matchEnabled = false;

io.on("connection", (socket) => {
  console.log("新しいクライアント接続:", socket.id);

  socket.emit("match_status", { enabled: matchEnabled });

  // ログイン
  socket.on("login", ({ name }) => {
    const now = new Date();
    const user = { id: socket.id, name, history: [], recentOpponents: [], loginTime: now };
    users.push(user);
    socket.emit("login_ok", user);
    console.log(`${name} がログイン`);
  });

  // 管理者ログイン
  socket.on("admin_login", ({ password }) => {
    if (password === "admin123") {
      socket.emit("admin_ok"); // サーバから返す
      console.log("管理者ログイン成功");
    } else {
      socket.emit("admin_fail"); // 任意で失敗通知
      console.log("管理者ログイン失敗");
    }
  });

  // 管理者用ユーザー一覧
  socket.on("admin_view_users", () => {
    const list = users.map(u => ({
      id: u.id,
      name: u.name,
      history: u.history,
      loginTime: u.loginTime || null
    }));
    socket.emit("admin_user_list", list);
  });

  // 他の既存の処理もそのまま…
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
