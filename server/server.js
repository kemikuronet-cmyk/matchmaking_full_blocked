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

// ポート設定
const PORT = process.env.PORT || 4000;

// データ管理
let users = [];
let matches = [];
let matchEnabled = false;

// --- Socket.IO ---
io.on("connection", (socket) => {
  console.log("新しいクライアント接続:", socket.id);

  // 新規ユーザーにマッチング状態を送信
  socket.emit("match_status", { enabled: matchEnabled });

  // ログイン
  socket.on("login", ({ name }) => {
    const user = { id: socket.id, name, history: [], recentOpponents: [] };
    users.push(user);
    socket.emit("login_ok", user);
    console.log(`${name} がログイン`);
  });

  // マッチング操作
  socket.on("find_opponent", () => {
    if (!matchEnabled) return;

    const user = users.find(u => u.id === socket.id);
    if (!user) return;

    // まだマッチしていないユーザーの中から、直近対戦相手以外を選ぶ
    const available = users.filter(u =>
      u.id !== socket.id &&
      !matches.some(m => m.includes(u.id)) &&
      !user.recentOpponents.includes(u.id)
    );

    if (available.length > 0) {
      const opponent = available[0];
      const match = [socket.id, opponent.id];
      matches.push(match);
      const deskNum = matches.length;

      // recentOpponents に記録
      user.recentOpponents.push(opponent.id);
      opponent.recentOpponents.push(user.id);

      io.to(socket.id).emit("matched", { opponent, deskNum });
      io.to(opponent.id).emit("matched", { opponent: user, deskNum });
    }
  });

  socket.on("cancel_find", () => {});

  // 勝利報告
  socket.on("report_win", () => {
    const match = matches.find(m => m.includes(socket.id));
    if (!match) return;

    const opponentId = match.find(id => id !== socket.id);
    const user = users.find(u => u.id === socket.id);
    const opponent = users.find(u => u.id === opponentId);

    if (user && opponent) {
      const now = new Date();
      user.history.push({ opponent: opponent.name, result: "win", startTime: now, endTime: now });
      opponent.history.push({ opponent: user.name, result: "lose", startTime: now, endTime: now });

      // 勝利報告後は対戦画面に戻るだけ
      socket.emit("return_to_menu_battle");
      io.to(opponentId).emit("return_to_menu_battle");

      // マッチ解消
      matches = matches.filter(m => m !== match);
    }
  });

  // 対戦履歴
  socket.on("request_history", () => {
    const user = users.find(u => u.id === socket.id);
    if (user) socket.emit("history", user.history);
  });

  // 管理者操作
  socket.on("admin_login", ({ password }) => {
    if (password === "adminpass") socket.emit("admin_ok");
  });

  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  socket.on("admin_view_users", () => {
    socket.emit("admin_user_list", users);
  });

  socket.on("admin_draw_lots", ({ count }) => {
    const shuffled = [...users].sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, count);
    socket.emit("admin_draw_result", winners);
  });

  // 管理者操作: 全ユーザーを強制ログアウト
  socket.on("admin_logout_all", () => {
    io.emit("force_logout"); // 変更
    users = [];
    matches = [];
    console.log("全ユーザーを強制ログアウトしました");
  });

  // ログアウト
  socket.on("logout", () => {
    users = users.filter(u => u.id !== socket.id);
    matches = matches.filter(m => !m.includes(socket.id));
  });

  // 切断
  socket.on("disconnect", () => {
    users = users.filter(u => u.id !== socket.id);
    matches = matches.filter(m => !m.includes(socket.id));
    console.log("クライアント切断:", socket.id);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
