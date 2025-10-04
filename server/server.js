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
let autoLogoutHours = 12; // 初期値: 12時間

// --- 卓番号割り当て ---
function assignDeskNum() {
  let deskNum = 1;
  while (matches[deskNum]) deskNum++;
  return deskNum;
}

// ヘルパー: sessionId 配列 -> { name } 配列
function winnerNamesFromSessionIds(sessionIds) {
  return sessionIds
    .map(sid => {
      const u = users.find(x => x.sessionId === sid);
      return u ? { name: u.name } : null;
    })
    .filter(Boolean);
}

// --- 自動ログアウトチェック ---
setInterval(() => {
  const now = new Date();
  users.forEach((u) => {
    const loginTime = new Date(u.loginTime);
    const hoursElapsed = (now - loginTime) / (1000 * 60 * 60);
    if (hoursElapsed >= autoLogoutHours) {
      io.to(u.id).emit("force_logout", { reason: "auto" });
      console.log(`自動ログアウト: ${u.name}`);
    }
  });
  users = users.filter(u => {
    const loginTime = new Date(u.loginTime);
    const hoursElapsed = (now - loginTime) / (1000 * 60 * 60);
    return hoursElapsed < autoLogoutHours;
  });
}, 60 * 1000);

// --- 接続 ---
io.on("connection", (socket) => {
  console.log("新しいクライアント接続:", socket.id);
  socket.emit("match_status", { enabled: matchEnabled });

  // --- ログイン ---
  socket.on("login", ({ name, sessionId }) => {
    if (!name || !name.trim()) return;

    let user = users.find(u => u.sessionId === sessionId);
    if (user) user.id = socket.id;

    if (!user) {
      user = {
        id: socket.id,
        name,
        sessionId: uuidv4(),
        history: [],
        recentOpponents: [],
        loginTime: new Date(),
        status: "idle",
        opponentSessionId: null,
        deskNum: null
      };
      users.push(user);
    }

    const currentOpponent = user.opponentSessionId
      ? users.find(u => u.sessionId === user.opponentSessionId)
      : null;

    const isWinner = lotteryWinners.includes(user.sessionId);
    const currentLotteryList = winnerNamesFromSessionIds(lotteryWinners);

    socket.emit("login_ok", {
      ...user,
      currentOpponent,
      deskNum: user.deskNum,
      lotteryWinner: isWinner,
      history: user.history || [],
      lotteryList: currentLotteryList
    });
  });

  // --- 管理者ログイン ---
  socket.on("admin_login", ({ password }) => {
    if (password === "admin123") socket.emit("admin_ok");
    else socket.emit("admin_fail");
  });

  // --- 管理者：自動ログアウト設定 ---
  socket.on("admin_set_auto_logout", ({ hours }) => {
    if (typeof hours === "number" && hours > 0) {
      autoLogoutHours = hours;
      console.log(`自動ログアウト時間を変更: ${hours} 時間`);
      socket.emit("admin_set_auto_logout_ok", { hours });
    }
  });

  socket.on("admin_get_auto_logout", () => {
    socket.emit("admin_current_auto_logout", { hours: autoLogoutHours });
  });

  // --- マッチング ---
  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

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
    user.history.push({ opponent: opponent.name, result: "WIN", startTime: now, endTime: now });
    opponent.history.push({ opponent: user.name, result: "LOSE", startTime: now, endTime: now });

    const deskNum = user.deskNum;

    user.status = "idle"; user.opponentSessionId = null; user.deskNum = null;
    opponent.status = "idle"; opponent.opponentSessionId = null; opponent.deskNum = null;
    if (matches[deskNum]) delete matches[deskNum];

    io.to(user.id).emit("history", user.history);
    io.to(opponent.id).emit("history", opponent.history);

    socket.emit("return_to_menu_battle");
    io.to(opponent.id).emit("return_to_menu_battle");
  });

  // --- 管理者：ユーザー一覧 ---
  socket.on("admin_view_users", () => {
    const list = users.map(u => ({
      id: u.id, name: u.name, history: u.history, loginTime: u.loginTime || null, status: u.status
    }));
    socket.emit("admin_user_list", list);
  });

  // --- 管理者：抽選 ---
  socket.on("admin_draw_lots", ({ count, minBattles = 0, minLoginMinutes = 0 }) => {
    const now = new Date();
    const candidates = users.filter(u => {
      const loginMinutes = (now - new Date(u.loginTime)) / 60000;
      const battles = u.history?.length || 0;
      return battles >= minBattles && loginMinutes >= minLoginMinutes;
    });

    if (candidates.length === 0) return socket.emit("admin_draw_result", []);

    const shuffled = candidates.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, Math.min(count, candidates.length));
    lotteryWinners = winners.map(u => u.sessionId);

    const winnerNames = winners.map(u => ({ name: u.name }));
    users.forEach(u => io.to(u.id).emit("update_lottery_list", winnerNames));
    winners.forEach(u => {
      const s = users.find(us => us.sessionId === u.sessionId);
      if (s) io.to(s.id).emit("lottery_winner");
    });

    socket.emit("admin_draw_result", winnerNames);
  });

  // --- 管理者：全ユーザー強制ログアウト ---
  socket.on("admin_logout_all", () => {
    users.forEach(u => io.to(u.id).emit("force_logout", { reason: "manual" }));
    users = [];
    matches = {};
    lotteryWinners = [];
  });

  // --- 新規：管理者による特定ユーザー強制ログアウト ---
  socket.on("admin_logout_user", ({ userId }) => {
    const target = users.find(u => u.id === userId);
    if (target) {
      io.to(target.id).emit("force_logout", { reason: "admin" });

      // マッチング中なら相手も解除
      if (target.opponentSessionId) {
        const opponent = users.find(u => u.sessionId === target.opponentSessionId);
        if (opponent) {
          opponent.status = "idle";
          opponent.opponentSessionId = null;
          opponent.deskNum = null;
          io.to(opponent.id).emit("return_to_menu_battle");
        }
        if (matches[target.deskNum]) delete matches[target.deskNum];
      }

      // ユーザー削除
      users = users.filter(u => u.id !== userId);
    }
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
    const deskNum = Object.keys(matches).find(d => matches[d].includes(userIndex));
    if (deskNum) delete matches[deskNum];
    socket.emit("force_logout", { reason: "manual" });
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
