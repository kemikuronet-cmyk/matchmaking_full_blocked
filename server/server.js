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
let autoLogoutHours = 12; // 初期値: 12時間
let currentLotteryTitle = ""; // 現在設定されている抽選名
let pendingWinConfirm = {}; // deskNum -> { requester: sessionId }

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
      history: user.history || [],
      lotteryList: currentLotteryList
    });
  });

  // --- 管理者ログイン ---
  socket.on("admin_login", ({ password }) => {
    if (password === "admin123") socket.emit("admin_ok");
    else socket.emit("admin_fail");
  });

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

  // --- 二段階勝利報告 ---
  socket.on("report_win_request", () => {
    const user = users.find(u => u.id === socket.id);
    if (!user || !user.opponentSessionId || !user.deskNum) return;

    const deskNum = user.deskNum;
    const opponent = users.find(u => u.sessionId === user.opponentSessionId);
    if (!opponent) return;

    io.to(user.id).emit("waiting_for_confirmation");
    io.to(opponent.id).emit("confirm_opponent_win", { deskNum, winnerName: user.name });
    pendingWinConfirm[deskNum] = { requester: user.sessionId };
  });

  socket.on("opponent_win_response", ({ deskNum, accepted }) => {
    const requesterSid = pendingWinConfirm[deskNum]?.requester;
    if (!requesterSid) return;

    const winner = users.find(u => u.sessionId === requesterSid);
    const loser = users.find(u => u.deskNum === deskNum && u.sessionId !== requesterSid);
    if (!winner || !loser) return;

    const now = new Date();
    if (accepted) {
      winner.history.push({ opponent: loser.name, result: "WIN", startTime: now, endTime: now });
      loser.history.push({ opponent: winner.name, result: "LOSE", startTime: now, endTime: now });

      winner.status = "idle"; winner.opponentSessionId = null; winner.deskNum = null;
      loser.status = "idle"; loser.opponentSessionId = null; loser.deskNum = null;
      delete matches[deskNum];
      delete pendingWinConfirm[deskNum];

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

  // --- 管理者・抽選・既存処理 ---
  socket.on("admin_get_active_matches", () => {
    const list = Object.entries(matches).map(([deskNum, sessionIds]) => {
      const player1 = users.find(u => u.sessionId === sessionIds[0])?.name || "不明";
      const player2 = users.find(u => u.sessionId === sessionIds[1])?.name || "不明";
      return { deskNum, player1, player2, player1SessionId: sessionIds[0], player2SessionId: sessionIds[1] };
    });
    socket.emit("admin_active_matches", list);
  });

  socket.on("admin_report_win", ({ winnerSessionId, deskNum }) => {
    const match = matches[deskNum];
    if (!match || match.length !== 2) return;

    const loserSessionId = match.find(sid => sid !== winnerSessionId);
    if (!loserSessionId) return;

    const winner = users.find(u => u.sessionId === winnerSessionId);
    const loser = users.find(u => u.sessionId === loserSessionId);
    if (!winner || !loser) return;

    const now = new Date();
    winner.history.push({ opponent: loser.name, result: "WIN", startTime: now, endTime: now });
    loser.history.push({ opponent: winner.name, result: "LOSE", startTime: now, endTime: now });

    winner.status = "idle"; winner.opponentSessionId = null; winner.deskNum = null;
    loser.status = "idle"; loser.opponentSessionId = null; loser.deskNum = null;

    delete matches[deskNum];

    io.to(winner.id).emit("history", winner.history);
    io.to(loser.id).emit("history", loser.history);

    io.to(winner.id).emit("return_to_menu_battle");
    io.to(loser.id).emit("return_to_menu_battle");

    io.emit("admin_active_matches", Object.entries(matches).map(([dn, sids]) => ({
      deskNum: dn,
      player1: users.find(u => u.sessionId === sids[0])?.name || "不明",
      player2: users.find(u => u.sessionId === sids[1])?.name || "不明",
      player1SessionId: sids[0],
      player2SessionId: sids[1]
    })));
  });

  socket.on("admin_report_both_lose", ({ deskNum }) => {
    const match = matches[deskNum];
    if (!match || match.length !== 2) return;

    const player1 = users.find(u => u.sessionId === match[0]);
    const player2 = users.find(u => u.sessionId === match[1]);
    if (!player1 || !player2) return;

    const now = new Date();
    player1.history.push({ opponent: player2.name, result: "LOSE", startTime: now, endTime: now });
    player2.history.push({ opponent: player1.name, result: "LOSE", startTime: now, endTime: now });

    player1.status = "idle"; player1.opponentSessionId = null; player1.deskNum = null;
    player2.status = "idle"; player2.opponentSessionId = null; player2.deskNum = null;

    delete matches[deskNum];

    io.to(player1.id).emit("history", player1.history);
    io.to(player2.id).emit("history", player2.history);

    io.to(player1.id).emit("return_to_menu_battle");
    io.to(player2.id).emit("return_to_menu_battle");

    io.emit("admin_active_matches", Object.entries(matches).map(([dn, sids]) => ({
      deskNum: dn,
      player1: users.find(u => u.sessionId === sids[0])?.name || "不明",
      player2: users.find(u => u.sessionId === sids[1])?.name || "不明",
      player1SessionId: sids[0],
      player2SessionId: sids[1]
    })));
  });

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

  socket.on("admin_draw_lots", ({ count = 1, minBattles = 0, minLoginMinutes = 0 }) => {
    const title = currentLotteryTitle || "抽選";
    const now = new Date();
    const candidates = users.filter(u => {
      const loginMinutes = (now - new Date(u.loginTime)) / 60000;
      const battles = u.history?.length || 0;
      const alreadyWon = lotteryResults.some(l => l.winners.includes(u.sessionId));
      return battles >= minBattles && loginMinutes >= minLoginMinutes && !alreadyWon;
    });

    if (candidates.length === 0) {
      return socket.emit("admin_draw_result", { winners: [], title });
    }

    const shuffled = candidates.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, Math.min(count, candidates.length));

    lotteryResults.push({ title, winners: winners.map(u => u.sessionId) });

    const listForUsers = lotteryResults.map(l => ({
      title: l.title,
      winners: winnerNamesFromSessionIds(l.winners)
    }));

    users.forEach(u => {
      io.to(u.id).emit("update_lottery_list", { list: listForUsers, title });
      if (winners.some(w => w.sessionId === u.sessionId)) {
        io.to(u.id).emit("lottery_winner", { title });
      }
    });

    const winnerNames = winners.map(u => ({ name: u.name }));
    socket.emit("admin_draw_result", { winners: winnerNames, title });
  });

  socket.on("admin_set_lottery_title", ({ title }) => {
    if (typeof title === "string" && title.trim()) {
      currentLotteryTitle = title.trim();
      console.log(`抽選名を変更: ${currentLotteryTitle}`);
      socket.emit("admin_set_lottery_title_ok", { title: currentLotteryTitle });
    }
  });

  socket.on("admin_get_lottery_history", () => {
    const listForAdmin = lotteryResults.map(l => ({ title: l.title, winners: winnerNamesFromSessionIds(l.winners) }));
    socket.emit("admin_lottery_history", listForAdmin);
  });

  socket.on("admin_logout_all", () => {
    users.forEach(u => io.to(u.id).emit("force_logout", { reason: "manual" }));
    users = [];
    matches = {};
    lotteryResults = [];
  });

  socket.on("admin_logout_user", ({ userId }) => {
    const target = users.find(u => u.id === userId);
    if (target) {
      io.to(target.id).emit("force_logout", { reason: "admin" });
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
      users = users.filter(u => u.id !== userId);
    }
  });

  socket.on("logout", () => {
    const user = users.find(u => u.id === socket.id);
    if (user) {
      if (user.opponentSessionId) {
        const opponent = users.find(u => u.sessionId === user.opponentSessionId);
        if (opponent) {
          opponent.status = "idle";
          opponent.opponentSessionId = null;
          opponent.deskNum = null;
          io.to(opponent.id).emit("return_to_menu_battle");
        }
        if (matches[user.deskNum]) delete matches[user.deskNum];
      }
      users = users.filter(u => u.id !== socket.id);
    }
  });

  socket.on("disconnect", () => {
    const user = users.find(u => u.id === socket.id);
    if (user) {
      if (user.opponentSessionId) {
        const opponent = users.find(u => u.sessionId === user.opponentSessionId);
        if (opponent) {
          opponent.status = "idle";
          opponent.opponentSessionId = null;
          opponent.deskNum = null;
          io.to(opponent.id).emit("return_to_menu_battle");
        }
        if (matches[user.deskNum]) delete matches[user.deskNum];
      }
      users = users.filter(u => u.id !== socket.id);
    }
    console.log("切断:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
