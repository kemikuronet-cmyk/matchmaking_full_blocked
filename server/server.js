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
  cors: { origin: "*" } // 必要に応じて制限可
});

// ポート設定
const PORT = process.env.PORT || 4000;

// データ管理（簡易版）
let users = [];
let matches = [];
let matchEnabled = false;

// --- Socket.IO ---
io.on("connection", (socket) => {
  console.log("新しいクライアント接続:", socket.id);

  // ログイン
  socket.on("login", ({ name }) => {
    const user = { id: socket.id, name, history: [] };
    users.push(user);
    socket.emit("login_ok", user);
    console.log(`${name} がログイン`);
  });

  // --- 対戦相手探す ---
  socket.on("find_opponent", () => {
    if (!matchEnabled) return;

    const user = users.find(u => u.id === socket.id);
    if (!user) return;

    // 一度でも対戦した相手IDリスト
    const playedOpponentIds = user.history.map(h => {
      const opponent = users.find(u => u.name === h.opponent);
      return opponent ? opponent.id : null;
    }).filter(Boolean);

    // マッチング候補は自分以外・過去に対戦なし・マッチ中でない
    const available = users.filter(u =>
      u.id !== socket.id &&
      !playedOpponentIds.includes(u.id) &&
      !matches.some(m => m.includes(u.id))
    );

    if (available.length === 0) return;

    const opponent = available[0];
    const match = [socket.id, opponent.id];
    matches.push(match);
    const deskNum = matches.length;

    io.to(socket.id).emit("matched", { opponent, deskNum });
    io.to(opponent.id).emit("matched", { opponent: user, deskNum });
  });

  socket.on("cancel_find", () => {
    // シンプルに何もしない
  });

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

      // 両者をメニュー画面へ戻す
      socket.emit("return_to_menu");
      io.to(opponentId).emit("return_to_menu");

      // マッチングリストから削除
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
    if (password === "adminpass") {
      socket.emit("admin_ok");
    }
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

  socket.on("admin_logout_all", () => {
    users.forEach(u => io.to(u.id).emit("return_to_menu"));
    users = [];
    matches = [];
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

// 0.0.0.0 にバインド
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
