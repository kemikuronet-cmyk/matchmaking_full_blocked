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
let matches = {}; // deskNum -> [sessionId1, sessionId2]
let matchEnabled = false;
let lotteryWinners = []; // sessionId 配列

// --- 卓番号割り当て（空き番号優先） ---
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
    const now = new Date();

    let user;
    if (sessionId) {
      user = users.find(u => u.sessionId === sessionId);
      if (user) user.id = socket.id;
    }
    if (!user) {
      user = {
        id: socket.id,
        name,
        sessionId: uuidv4(),
        history: [],
        recentOpponents: [],
        loginTime: now,
        status: "idle",
        opponentSessionId: null,
        deskNum: null,
      };
      users.push(user);
    }

    let currentOpponent = null;
    if (user.opponentSessionId) {
      const opponent = users.find(u => u.sessionId === user.opponentSessionId);
      if (opponent) currentOpponent = { id: opponent.id, name: opponent.name };
    }

    const isWinner = lotteryWinners.includes(user.sessionId);
    socket.emit("login_ok", {
      ...user,
      currentOpponent,
      deskNum: user.deskNum,
      lotteryWinner: isWinner
    });

    console.log(`${user.name} がログイン（${user.sessionId}）`);
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
    user.opponentSessionId = null;
    user.deskNum = null;

    const available = users.filter(u =>
      u.sessionId !== user.sessionId &&
      u.status === "searching" &&
      !Object.values(matches).some(m => m.includes(u.sessionId)) &&
      !user.recentOpponents.includes(u.sessionId)
    );

    if (available.length > 0) {
      const opponent = available[0];
      const deskNum = assignDeskNum();

      matches[deskNum] = [user.sessionId, opponent.sessionId];

      user.recentOpponents.push(opponent.sessionId);
      opponent.recentOpponents.push(user.sessionId);

      user.status = "matched";
      opponent.status = "matched";
      user.opponentSessionId = opponent.sessionId;
      opponent.opponentSessionId = user.sessionId;
      user.deskNum = deskNum;
      opponent.deskNum = deskNum;

      io.to(user.id).emit("matched", { opponent: { id: opponent.id, name: opponent.name }, deskNum });
      io.to(opponent.id).emit("matched", { opponent: { id: user.id, name: user.name }, deskNum });
    }
  });

  socket.on("cancel_find", () => {
    const user = users.find(u => u.id === socket.id);
    if (user) {
      user.status = "idle";
      user.opponentSessionId = null;
      user.deskNum = null;
    }
  });

  // --- 勝利報告 ---
  socket.on("report_win", () => {
    const user = users.find(u => u.id === socket.id);
    if (!user || !user.opponentSessionId || !user.deskNum) return;

    const opponent = users.find(u => u.sessionId === user.opponentSessionId);
    if (!opponent) return;

    const now = new Date();
    user.history.push({ opponent: opponent.name, result: "win", startTime: now, endTime: now });
    opponent.history.push({ opponent: user.name, result: "lose", startTime: now, endTime: now });

    const deskNum = user.deskNum;

    user.status = "idle";
    user.opponentSessionId = null;
    user.deskNum = null;

    opponent.status = "idle";
    opponent.opponentSessionId = null;
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
      status: u.status,
      deskNum: u.deskNum
    }));
    socket.emit("admin_user_list", list);
  });

  // --- 管理者：強制マッチング解除（マッチング解除ボタン） ---
  socket.on("admin_force_unmatch", ({ userId }) => {
    const targetUser = users.find(u => u.id === userId);
    if (!targetUser) return;

    const opponent = targetUser.opponentSessionId
      ? users.find(u => u.sessionId === targetUser.opponentSessionId)
      : null;
    const deskNum = targetUser.deskNum;

    targetUser.status = "idle";
    targetUser.opponentSessionId = null;
    targetUser.deskNum = null;
    io.to(targetUser.id).emit("return_to_menu_battle");

    if (opponent) {
      opponent.status = "idle";
      opponent.opponentSessionId = null;
      opponent.deskNum = null;
      io.to(opponent.id).emit("return_to_menu_battle");
    }

    if (deskNum && matches[deskNum]) delete matches[deskNum];

    console.log(`管理者が ${targetUser.name} のマッチングを解除しました`);
  });

  // --- 管理者：抽選（条件付き） ---
  socket.on("admin_draw_lots", ({ count, minMatches, minLoginTime }) => {
    const now = new Date();
    const minMatchNum = minMatches ?? 0;
    const minLoginMinutes = minLoginTime ?? 0;

    const candidates = users.filter(u => {
      const loginOk =
        !minLoginMinutes ||
        (u.loginTime && (now - new Date(u.loginTime)) / (1000 * 60) >= minLoginMinutes);
      const matchOk =
        !minMatchNum || ((u.history?.length || 0) >= minMatchNum);
      return loginOk && matchOk;
    });

    if (candidates.length === 0) return socket.emit("admin_draw_result", []);

    const shuffled = candidates.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, Math.min(count, candidates.length));
    lotteryWinners = winners.map(u => u.sessionId);

    const winnerNames = winners.map(u => ({ name: u.name }));
    users.forEach(u => io.to(u.id).emit("update_lottery_list", winnerNames));
    winners.forEach(w => {
      const s = users.find(us => us.sessionId === w.sessionId);
      if (s) io.to(s.id).emit("lottery_winner");
    });
    socket.emit("admin_draw_result", winnerNames);
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
    // matchesからも抜く
    for (const d in matches) {
      matches[d] = matches[d].filter(sid => sid !== socket.id);
      if (matches[d].length === 0) delete matches[d];
    }
    socket.emit("force_logout");
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
