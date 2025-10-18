// server.js（完全統合安定版）
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
let lotteryResults = []; // [{ title: 抽選名, winners: [sessionId,...] }]
let autoLogoutHours = 12;
let currentLotteryTitle = "";
let pendingWinConfirm = {}; // deskNum -> { requester: sessionId }

// --- 卓番号割り当て ---
function assignDeskNum() {
  let deskNum = 1;
  while (matches[deskNum]) deskNum++;
  return deskNum;
}

// --- sessionId→ユーザー名変換 ---
function winnerNamesFromSessionIds(sessionIds) {
  return sessionIds
    .map(sid => {
      const u = users.find(x => x.sessionId === sid);
      return u ? { name: u.name } : null;
    })
    .filter(Boolean);
}

// --- 自動ログアウト処理 ---
setInterval(() => {
  const now = new Date();
  users.forEach(u => {
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
  console.log("接続:", socket.id);
  socket.emit("match_status", { enabled: matchEnabled });

  // --- ログイン ---
  socket.on("login", ({ name, sessionId }) => {
    if (!name?.trim()) return;

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

    const wonTitles = lotteryResults
      .filter(l => l.winners.includes(user.sessionId))
      .map(l => l.title);

    const currentLotteryList = lotteryResults.map(l => ({
      title: l.title,
      winners: winnerNamesFromSessionIds(l.winners)
    }));

    socket.emit("login_ok", {
      ...user,
      currentOpponent,
      deskNum: user.deskNum,
      lotteryWinner: wonTitles.length > 0,
      history: user.history,
      lotteryList: currentLotteryList
    });

    io.emit("admin_user_list", users.map(u => ({
      id: u.id, name: u.name, status: u.status, deskNum: u.deskNum
    })));
  });

  // --- 管理者ログイン ---
  socket.on("admin_login", ({ password }) => {
    if (password === "admin123") {
      socket.emit("admin_ok");
      socket.emit("admin_user_list", users.map(u => ({
        id: u.id, name: u.name, status: u.status, deskNum: u.deskNum
      })));
    } else socket.emit("admin_fail");
  });

  socket.on("admin_set_auto_logout", ({ hours }) => {
    if (typeof hours === "number" && hours > 0) {
      autoLogoutHours = hours;
      socket.emit("admin_set_auto_logout_ok", { hours });
    }
  });

  // --- マッチング有効化 ---
  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  // --- 対戦検索 ---
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

  // --- 勝利報告要求 ---
  socket.on("report_win_request", () => {
    const user = users.find(u => u.id === socket.id);
    if (!user?.opponentSessionId || !user.deskNum) return;

    const deskNum = user.deskNum;
    const opponent = users.find(u => u.sessionId === user.opponentSessionId);
    if (!opponent) return;

    io.to(user.id).emit("waiting_for_confirmation");
    io.to(opponent.id).emit("confirm_opponent_win", { deskNum, winnerName: user.name });
    pendingWinConfirm[deskNum] = { requester: user.sessionId };
  });

  // --- 敗者の応答 ---
  socket.on("opponent_win_response", ({ deskNum, accepted }) => {
    const requesterSid = pendingWinConfirm[deskNum]?.requester;
    if (!requesterSid) return;

    const winner = users.find(u => u.sessionId === requesterSid);
    const loser = users.find(u => u.deskNum === deskNum && u.sessionId !== requesterSid);
    if (!winner || !loser) return;

    if (accepted) {
      const now = new Date();
      winner.history.push({ opponent: loser.name, result: "WIN", date: now });
      loser.history.push({ opponent: winner.name, result: "LOSE", date: now });

      delete matches[deskNum];
      delete pendingWinConfirm[deskNum];

      winner.status = "idle";
      loser.status = "idle";
      winner.opponentSessionId = null;
      loser.opponentSessionId = null;
      winner.deskNum = null;
      loser.deskNum = null;

      io.to(winner.id).emit("history", winner.history);
      io.to(loser.id).emit("history", loser.history);

      io.to(winner.id).emit("return_to_menu_battle");
      io.to(loser.id).emit("return_to_menu_battle");
    } else {
      delete pendingWinConfirm[deskNum];
      io.to(winner.id).emit("opponent_win_cancelled");
      io.to(loser.id).emit("opponent_win_cancelled");
    }
  });

  // --- 管理者: 現在の卓 ---
  socket.on("admin_get_active_matches", () => {
    const list = Object.entries(matches).map(([deskNum, sids]) => {
      const p1 = users.find(u => u.sessionId === sids[0]);
      const p2 = users.find(u => u.sessionId === sids[1]);
      return {
        deskNum,
        player1: p1?.name || "不明",
        player2: p2?.name || "不明",
        player1SessionId: sids[0],
        player2SessionId: sids[1]
      };
    });
    socket.emit("admin_active_matches", list);
  });

  // --- 管理者: 勝利登録 ---
  socket.on("admin_report_win", ({ winnerSessionId, deskNum }) => {
    const match = matches[deskNum];
    if (!match) return;
    const loserSid = match.find(sid => sid !== winnerSessionId);

    const winner = users.find(u => u.sessionId === winnerSessionId);
    const loser = users.find(u => u.sessionId === loserSid);
    if (!winner || !loser) return;

    const now = new Date();
    winner.history.push({ opponent: loser.name, result: "WIN", date: now });
    loser.history.push({ opponent: winner.name, result: "LOSE", date: now });

    delete matches[deskNum];

    winner.status = loser.status = "idle";
    winner.deskNum = loser.deskNum = null;
    winner.opponentSessionId = loser.opponentSessionId = null;

    io.to(winner.id).emit("history", winner.history);
    io.to(loser.id).emit("history", loser.history);
    io.to(winner.id).emit("return_to_menu_battle");
    io.to(loser.id).emit("return_to_menu_battle");
  });

  // --- 管理者: ユーザーリスト ---
  socket.on("admin_view_users", () => {
    socket.emit("admin_user_list", users.map(u => ({
      id: u.id, name: u.name, status: u.status, deskNum: u.deskNum
    })));
  });

  // --- 管理者: 強制ログアウト ---
  socket.on("admin_logout_user", ({ userId }) => {
    const target = users.find(u => u.id === userId);
    if (target) {
      io.to(target.id).emit("force_logout", { reason: "admin" });
      users = users.filter(u => u.id !== userId);
      if (matches[target.deskNum]) delete matches[target.deskNum];
      io.emit("admin_user_list", users.map(u => ({
        id: u.id, name: u.name, status: u.status, deskNum: u.deskNum
      })));
    }
  });

  // --- ログアウト処理 ---
  socket.on("logout", () => {
    const user = users.find(u => u.id === socket.id);
    if (user) {
      if (user.opponentSessionId) {
        const opp = users.find(u => u.sessionId === user.opponentSessionId);
        if (opp) {
          opp.status = "idle";
          opp.opponentSessionId = null;
          opp.deskNum = null;
          io.to(opp.id).emit("return_to_menu_battle");
        }
        if (matches[user.deskNum]) delete matches[user.deskNum];
      }
      users = users.filter(u => u.id !== socket.id);
    }
  });

  // --- 切断 ---
  socket.on("disconnect", () => {
    const user = users.find(u => u.id === socket.id);
    if (user) {
      if (user.opponentSessionId) {
        const opp = users.find(u => u.sessionId === user.opponentSessionId);
        if (opp) {
          opp.status = "idle";
          opp.opponentSessionId = null;
          opp.deskNum = null;
          io.to(opp.id).emit("return_to_menu_battle");
        }
        if (matches[user.deskNum]) delete matches[user.deskNum];
      }
      users = users.filter(u => u.id !== socket.id);
    }
    io.emit("admin_user_list", users.map(u => ({
      id: u.id, name: u.name, status: u.status, deskNum: u.deskNum
    })));
  });
});

server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
