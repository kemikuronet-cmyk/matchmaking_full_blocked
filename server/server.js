const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.static(path.join(__dirname, "../client/dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const PORT = process.env.PORT || 4000;

// --- データ管理 ---
let users = [];
let matches = {}; // deskNum -> [userId1, userId2]
let matchEnabled = false;
let lotteryWinners = []; // 当選者の sessionId リスト

// 卓番号割り当て（空き番号を優先）
function assignDeskNum() {
  let deskNum = 1;
  while (matches[deskNum]) deskNum++;
  return deskNum;
}

// --- 接続 ---
io.on("connection", (socket) => {
  console.log("新しいクライアント接続:", socket.id);
  socket.emit("match_status", { enabled: matchEnabled });

  // --- ログイン ---
  socket.on("login", ({ name, sessionId }) => {
    if (!name || !name.trim()) return;

    let user;
    const now = new Date();

    // 既存セッション復元
    if (sessionId) {
      user = users.find(u => u.sessionId === sessionId);
      if (user) user.id = socket.id;
    }

    // 新規ユーザー作成
    if (!user) {
      user = {
        id: socket.id,
        name,
        sessionId: uuidv4(),
        history: [],
        recentOpponents: [],
        loginTime: now,
        status: "idle",
        opponentId: null,
        deskNum: null,
      };
      users.push(user);
    }

    // 復元用情報
    let currentOpponent = null;
    if (user.opponentId) {
      const opponent = users.find(u => u.id === user.opponentId);
      if (opponent) currentOpponent = { id: opponent.id, name: opponent.name };
    }

    // 当選者情報
    const winnerNames = users
      .filter(u => lotteryWinners.includes(u.sessionId))
      .map(u => u.name);
    const isWinner = lotteryWinners.includes(user.sessionId);

    socket.emit("login_ok", {
      ...user,
      currentOpponent,
      deskNum: user.deskNum,
      lotteryWinner: isWinner,
      lotteryWinnersList: winnerNames
    });

    console.log(`${name} がログイン（${user.sessionId}）`);
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

  // --- マッチング開始／停止 ---
  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  // --- 対戦相手検索 ---
  socket.on("find_opponent", () => {
    if (!matchEnabled) return;
    const user = users.find(u => u.id === socket.id);
    if (!user) return;

    user.status = "searching";
    user.opponentId = null;
    user.deskNum = null;

    const available = users.filter(u =>
      u.id !== socket.id &&
      u.status === "searching" &&
      !Object.values(matches).some(m => m.includes(u.id)) &&
      !user.recentOpponents.includes(u.id)
    );

    if (available.length > 0) {
      const opponent = available[0];
      const deskNum = assignDeskNum();

      matches[deskNum] = [socket.id, opponent.id];

      user.recentOpponents.push(opponent.id);
      opponent.recentOpponents.push(user.id);

      user.status = "matched";
      opponent.status = "matched";
      user.opponentId = opponent.id;
      opponent.opponentId = user.id;
      user.deskNum = deskNum;
      opponent.deskNum = deskNum;

      io.to(socket.id).emit("matched", { opponent: { id: opponent.id, name: opponent.name }, deskNum });
      io.to(opponent.id).emit("matched", { opponent: { id: user.id, name: user.name }, deskNum });
    }
  });

  socket.on("cancel_find", () => {
    const user = users.find(u => u.id === socket.id);
    if (user) {
      user.status = "idle";
      user.opponentId = null;
      user.deskNum = null;
    }
  });

  // --- 勝利報告 ---
  socket.on("report_win", () => {
    const user = users.find(u => u.id === socket.id);
    if (!user || !user.opponentId || !user.deskNum) return;

    const opponent = users.find(u => u.id === user.opponentId);
    if (!opponent) return;

    const now = new Date();
    user.history.push({ opponent: opponent.name, result: "win", startTime: now, endTime: now });
    opponent.history.push({ opponent: user.name, result: "lose", startTime: now, endTime: now });

    const deskNum = user.deskNum;

    // 状態リセット
    user.status = "idle";
    user.opponentId = null;
    user.deskNum = null;
    opponent.status = "idle";
    opponent.opponentId = null;
    opponent.deskNum = null;

    if (matches[deskNum]) delete matches[deskNum];

    socket.emit("return_to_menu_battle");
    io.to(opponent.id).emit("return_to_menu_battle");
  });

  // --- 管理者：ユーザー一覧 ---
  socket.on("admin_view_users", () => {
    const list = users.map(u => ({
      id: u.id,
      name: u.name,
      history: u.history,
      loginTime: u.loginTime || null,
      status: u.status
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

    const shuffled = candidates.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, Math.min(count, candidates.length));
    lotteryWinners = winners.map(u => u.sessionId);

    socket.emit("admin_draw_result", winners.map(u => ({ name: u.name })));

    // 当選者に通知
    winners.forEach(u => {
      const s = users.find(us => us.sessionId === u.sessionId);
      if (s) io.to(s.id).emit("lottery_winner");
    });

    // 全ユーザーに最新リスト通知
    const winnerNames = users.filter(u => lotteryWinners.includes(u.sessionId)).map(u => u.name);
    users.forEach(u => {
      io.to(u.id).emit("lottery_winners_list", { winners: winnerNames, lotteryWinner: lotteryWinners.includes(u.sessionId) });
    });
  });

  // --- 管理者：全ユーザー強制ログアウト ---
  socket.on("admin_logout_all", () => {
    users.forEach(u => io.to(u.id).emit("force_logout"));
    users = [];
    matches = {};
    lotteryWinners = [];
  });

  // --- 対戦履歴 ---
  socket.on("request_history", () => {
    const user = users.find(u => u.id === socket.id);
    if (!user) return;
    socket.emit("history", user.history || []);
  });

  // --- ログアウト ---
  socket.on("logout", () => {
    const userIndex = users.findIndex(u => u.id === socket.id);
    if (userIndex !== -1) users.splice(userIndex, 1);

    const deskNum = Object.keys(matches).find(d => matches[d].includes(socket.id));
    if (deskNum) delete matches[deskNum];

    socket.emit("force_logout");
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
