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
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 4000;

// --- データ管理 ---
let users = [];
let matches = [];
let matchEnabled = false;

io.on("connection", (socket) => {
  console.log("新しいクライアント接続:", socket.id);

  socket.emit("match_status", { enabled: matchEnabled });

  // --- ログイン ---
  socket.on("login", ({ name }) => {
    const now = new Date();
    const user = {
      id: socket.id,
      name,
      history: [],
      recentOpponents: [],
      loginTime: now,
      searching: false
    };
    users.push(user);
    socket.emit("login_ok", user);
    console.log(`${name} がログイン`);
  });

  // --- 管理者ログイン ---
  socket.on("admin_login", ({ password }) => {
    if (password === "admin123") {
      socket.emit("admin_ok");
      console.log("管理者ログイン成功");
    } else {
      socket.emit("admin_fail");
      console.log("管理者ログイン失敗");
    }
  });

  // --- 管理者マッチング開始／停止 ---
  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  // --- 対戦相手検索 ---
  socket.on("find_opponent", () => {
    if (!matchEnabled) return;
    const user = users.find(u => u.id === socket.id);
    if (!user) return;

    user.searching = true;

    const available = users.filter(u =>
      u.id !== socket.id &&
      u.searching &&
      !matches.some(m => m.includes(u.id)) &&
      !user.recentOpponents.includes(u.id)
    );

    if (available.length > 0) {
      const opponent = available[0];
      const match = [socket.id, opponent.id];
      matches.push(match);
      const deskNum = matches.length;

      user.recentOpponents.push(opponent.id);
      opponent.recentOpponents.push(user.id);

      user.searching = false;
      opponent.searching = false;

      io.to(socket.id).emit("matched", { opponent, deskNum });
      io.to(opponent.id).emit("matched", { opponent: user, deskNum });
    }
  });

  socket.on("cancel_find", () => {
    const user = users.find(u => u.id === socket.id);
    if (user) user.searching = false;
  });

  // --- 勝利報告 ---
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

      user.searching = false;
      opponent.searching = false;

      socket.emit("return_to_menu_battle");
      io.to(opponentId).emit("return_to_menu_battle");

      matches = matches.filter(m => m !== match);
    }
  });

  // --- 管理者：ユーザー一覧 ---
  socket.on("admin_view_users", () => {
    const list = users.map(u => ({
      id: u.id,
      name: u.name,
      history: u.history,
      loginTime: u.loginTime || null
    }));
    socket.emit("admin_user_list", list);
  });

  // --- 管理者：抽選 ---
  socket.on("admin_draw_lots", ({ count }) => {
    const now = new Date();
    const candidates = users.filter(u => {
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      return u.loginTime <= twoHoursAgo || (u.history?.length || 0) >= 5;
    });

    if (candidates.length === 0) return socket.emit("admin_draw_result", []);

    // ランダム抽選
    const shuffled = candidates.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, Math.min(count, candidates.length));

    socket.emit("admin_draw_result", winners.map(u => ({ id: u.id, name: u.name })));
  });

  // --- 管理者：全ユーザー強制ログアウト ---
  socket.on("admin_logout_all", () => {
    users.forEach(u => io.to(u.id).emit("force_logout"));
    users = [];
    matches = [];
  });

  // --- ユーザーメニュー：対戦履歴 ---
  socket.on("request_history", () => {
    const user = users.find(u => u.id === socket.id);
    if (!user) return;
    socket.emit("history", user.history || []);
  });

  // --- ログアウト ---
  socket.on("logout", () => {
    const userIndex = users.findIndex(u => u.id === socket.id);
    if (userIndex !== -1) users.splice(userIndex, 1);
    matches = matches.filter(m => !m.includes(socket.id));
    socket.emit("force_logout");
  });

});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
