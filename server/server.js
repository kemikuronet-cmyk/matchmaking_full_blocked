// Server.js — バックグラウンド復帰で勝利報告ボタン保持版
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// React ビルド配信
const CLIENT_DIST = path.join(__dirname, "../client/dist");
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get("*", (req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));
} else {
  app.get("/", (req, res) => res.send("Client dist not found. Please build client."));
}

// 永続データ
const DATA_FILE = path.join(__dirname, "server_data.json");

// 設定
const RECONNECT_GRACE_MS = 60 * 60 * 1000; // 1時間
const MAX_LOTTERY_HISTORY = 200;

let users = [];
let desks = {};
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234";
let autoLogoutHours = 12;
let lotteryHistory = [];
let currentLotteryList = [];

function nowISO() { return new Date().toISOString(); }

function saveData() {
  try {
    const data = {
      users: users.map(u => ({
        id: u.id,
        sessionId: u.sessionId,
        name: u.name,
        status: u.status,
        loginTime: u.loginTime,
        history: u.history || [],
        recentOpponents: u.recentOpponents || []
      })),
      desks: Object.fromEntries(Object.entries(desks).map(([k, d]) => [k, {
        p1: { sessionId: d.p1?.sessionId, name: d.p1?.name },
        p2: { sessionId: d.p2?.sessionId, name: d.p2?.name },
        reported: d.reported || null
      }])),
      lotteryHistory,
      currentLotteryList,
      matchEnabled,
      autoLogoutHours
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("❌ saveData error:", e);
  }
}

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    if (data.users) users = data.users.map(u => ({
      ...u,
      recentOpponents: u.recentOpponents || [],
      disconnectedAt: null
    }));
    if (data.desks) {
      desks = Object.fromEntries(Object.entries(data.desks).map(([k, d]) => [k, {
        p1: { sessionId: d.p1?.sessionId || null, id: null, name: d.p1?.name || null },
        p2: { sessionId: d.p2?.sessionId || null, id: null, name: d.p2?.name || null },
        reported: d.reported || null
      }]));
    }
    if (Array.isArray(data.lotteryHistory)) lotteryHistory = data.lotteryHistory;
    if (Array.isArray(data.currentLotteryList)) currentLotteryList = data.currentLotteryList;
    if (typeof data.matchEnabled === 'boolean') matchEnabled = data.matchEnabled;
    if (typeof data.autoLogoutHours === 'number') autoLogoutHours = data.autoLogoutHours;
  } catch (e) {
    console.error("❌ loadData error:", e);
  }
}

function assignDeskSequential() {
  let i = 1;
  while (desks[i]) i++;
  return i.toString();
}

function findUserBySocket(socketId) {
  return users.find(u => u.id === socketId);
}
function findUserBySession(sessionId) {
  return users.find(u => u.sessionId === sessionId);
}

function calculateWinsLosses(user) {
  user.history = user.history || [];
  user.wins = user.history.filter(h => h.result === "WIN").length;
  user.losses = user.history.filter(h => h.result === "LOSE").length;
  user.totalBattles = user.history.length;
}

function compactUserForAdmin(u) {
  return {
    id: u.id,
    name: u.name,
    sessionId: u.sessionId,
    status: u.status,
    loginTime: u.loginTime,
    history: u.history || []
  };
}

function sendUserListTo(socket = null) {
  const payload = users.map(u => compactUserForAdmin(u));
  if (socket && typeof socket.emit === "function") socket.emit("admin_user_list", payload);
  if (adminSocket && adminSocket.id !== socket?.id) adminSocket.emit("admin_user_list", payload);
}

function broadcastActiveMatchesToAdmin() {
  const active = Object.keys(desks).map(deskNum => {
    const d = desks[deskNum];
    return {
      deskNum,
      player1: d.p1?.name || (d.p1?.sessionId || "不明"),
      player2: d.p2?.name || (d.p2?.sessionId || "不明"),
      player1SessionId: d.p1?.sessionId,
      player2SessionId: d.p2?.sessionId
    };
  });
  if (adminSocket) adminSocket.emit("admin_active_matches", active);
}

// Reconcile desks for a sessionId (update socket.id)
function reconcileDesksForSession(sessionId, socketId) {
  Object.keys(desks).forEach(dn => {
    const d = desks[dn];
    if (d.p1?.sessionId === sessionId) d.p1.id = socketId;
    if (d.p2?.sessionId === sessionId) d.p2.id = socketId;
  });
}

// Notify both players of current match (for reconnection / background recovery)
function notifyReconnected(sessionId, socket) {
  const deskNum = Object.keys(desks).find(dn => {
    const d = desks[dn];
    return d && (d.p1?.sessionId === sessionId || d.p2?.sessionId === sessionId);
  });
  if (!deskNum) return;
  const match = desks[deskNum];
  if (match.p1?.sessionId === sessionId) match.p1.id = socket.id;
  if (match.p2?.sessionId === sessionId) match.p2.id = socket.id;

  // Emit to both players if connected
  if (match.p1?.id && match.p2?.id) {
    io.to(match.p1.id).emit("matched", {
      opponent: { id: match.p2.id, name: match.p2.name || match.p2.sessionId },
      deskNum
    });
    io.to(match.p2.id).emit("matched", {
      opponent: { id: match.p1.id, name: match.p1.name || match.p1.sessionId },
      deskNum
    });
  }
}

// Cleanup after disconnect
function scheduleDisconnectCleanup(sessionId) {
  const u = findUserBySession(sessionId);
  if (!u) return;
  u.disconnectedAt = Date.now();
  setTimeout(() => {
    const still = findUserBySession(sessionId);
    if (!still) return;
    if (still.disconnectedAt && (Date.now() - still.disconnectedAt) >= RECONNECT_GRACE_MS) {
      users = users.filter(x => x.sessionId !== sessionId);
      Object.keys(desks).forEach(dn => {
        const d = desks[dn];
        if (!d) return;
        if (d.p1?.sessionId === sessionId || d.p2?.sessionId === sessionId) {
          const otherSession = d.p1?.sessionId === sessionId ? d.p2?.sessionId : d.p1?.sessionId;
          const otherUser = findUserBySession(otherSession);
          if (otherUser) otherUser.status = "idle";
          delete desks[dn];
        }
      });
      saveData();
      broadcastActiveMatchesToAdmin();
      sendUserListTo();
    }
  }, RECONNECT_GRACE_MS + 200);
}

// -------------------- SOCKET.IO --------------------
io.on("connection", socket => {
  console.log("✅ Connected:", socket.id);

  if (currentLotteryList.length > 0) {
    socket.emit("update_lottery_list", { list: currentLotteryList });
  }

  socket.on("login", ({ name, sessionId, recentOpponents, history } = {}) => {
    if (!name || !name.trim()) return;
    let user = sessionId ? findUserBySession(sessionId) : null;
    if (!user) user = users.find(u => u.name === name);

    if (user) {
      const hoursDiff = user.loginTime ? (Date.now() - new Date(user.loginTime).getTime()) / 3600000 : 0;
      if (hoursDiff >= autoLogoutHours) {
        user.history = [];
        user.recentOpponents = [];
      }
      user.id = socket.id;
      user.status = user.status || "idle";
      user.disconnectedAt = null;
      user.name = name;
    } else {
      user = {
        id: socket.id,
        name,
        sessionId: sessionId || socket.id,
        status: "idle",
        loginTime: nowISO(),
        history: history || [],
        recentOpponents: recentOpponents || [],
        disconnectedAt: null
      };
      users.push(user);
    }

    // Reconnect desk & notify
    reconcileDesksForSession(user.sessionId, socket.id);
    notifyReconnected(user.sessionId, socket);

    calculateWinsLosses(user);
    saveData();

    socket.emit("match_status", { enabled: matchEnabled });
    socket.emit("login_ok", {
      ...user,
      history: user.history,
      wins: user.wins,
      losses: user.losses,
      totalBattles: user.totalBattles
    });

    sendUserListTo();
    broadcastActiveMatchesToAdmin();
  });

  // Heartbeat
  socket.on("heartbeat", ({ sessionId } = {}) => {
    if (!sessionId) return;
    const u = findUserBySession(sessionId);
    if (!u) return;
    u.disconnectedAt = null;
    if (u.id !== socket.id) {
      u.id = socket.id;
      reconcileDesksForSession(sessionId, socket.id);
      notifyReconnected(sessionId, socket);
    }
    socket.emit("heartbeat_ok", { now: nowISO() });
  });

  // logout
  socket.on("logout", () => {
    const u = findUserBySocket(socket.id);
    if (u) {
      users = users.filter(x => x.sessionId !== u.sessionId);
      Object.keys(desks).forEach(dn => {
        const d = desks[dn];
        if (!d) return;
        if (d.p1?.sessionId === u.sessionId || d.p2?.sessionId === u.sessionId) {
          const other = d.p1?.sessionId === u.sessionId ? d.p2 : d.p1;
          const otherUser = findUserBySession(other?.sessionId);
          if (otherUser) otherUser.status = "idle";
          delete desks[dn];
        }
      });
      saveData();
      sendUserListTo();
      broadcastActiveMatchesToAdmin();
    }
  });

  // find opponent
  socket.on("find_opponent", () => {
    const user = findUserBySocket(socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";
    const candidate = users.find(u =>
      u.sessionId !== user.sessionId &&
      u.status === "searching" &&
      !(user.recentOpponents || []).includes(u.sessionId) &&
      !(u.recentOpponents || []).includes(user.sessionId)
    );

    if (candidate) {
      const deskNum = assignDeskSequential();
      desks[deskNum] = {
        p1: { sessionId: user.sessionId, id: user.id, name: user.name },
        p2: { sessionId: candidate.sessionId, id: candidate.id, name: candidate.name },
        reported: null
      };

      user.status = candidate.status = "in_battle";
      user.recentOpponents.push(candidate.sessionId);
      candidate.recentOpponents.push(user.sessionId);

      io.to(user.id).emit("matched", { opponent: { id: candidate.id, name: candidate.name }, deskNum });
      io.to(candidate.id).emit("matched", { opponent: { id: user.id, name: user.name }, deskNum });

      broadcastActiveMatchesToAdmin();
      saveData();
    }

    sendUserListTo();
  });

  socket.on("cancel_find", () => {
    const user = findUserBySocket(socket.id);
    if (user && user.status !== "in_battle") user.status = "idle";
    saveData();
    sendUserListTo();
  });

  // 勝利報告フロー（以前と同じ）
  socket.on("report_win_request", () => {
    const user = findUserBySocket(socket.id);
    if (!user) return;
    const deskNum = Object.keys(desks).find(dn => {
      const m = desks[dn];
      return m && (m.p1?.id === socket.id || m.p2?.id === socket.id || m.p1?.sessionId === user.sessionId || m.p2?.sessionId === user.sessionId);
    });
    if (!deskNum) return;

    const match = desks[deskNum];
    const opponent = match.p1.sessionId === user.sessionId ? match.p2 : match.p1;
    match.reported = user.sessionId;

    const opponentSocketId = opponent.id || null;
    if (opponent.id) {
      io.to(opponent.id).emit("confirm_opponent_win", { deskNum, winnerName: user.name });
    } else {
      setTimeout(() => {
        const stillMatch = desks[deskNum];
        if (stillMatch && stillMatch.reported === user.sessionId) {
          const reporter = findUserBySession(user.sessionId);
          const loser = findUserBySession(opponent.sessionId);
          if (reporter && loser) {
            reporter.history = reporter.history || [];
            loser.history = loser.history || [];
            reporter.history.push({ opponent: loser.name, result: "WIN", endTime: nowISO() });
            loser.history.push({ opponent: reporter.name, result: "LOSE", endTime: nowISO() });
            calculateWinsLosses(reporter);
            calculateWinsLosses(loser);
            saveData();
            if (reporter.id) io.to(reporter.id).emit("history", reporter.history);
            if (loser.id) io.to(loser.id).emit("history", loser.history);
            if (reporter.id) io.to(reporter.id).emit("return_to_menu_battle");
            if (loser.id) io.to(loser.id).emit("return_to_menu_battle");
            delete desks[deskNum];
            broadcastActiveMatchesToAdmin();
            sendUserListTo();
          }
        }
      }, 2000);
    }
    sendUserListTo();
  });

  socket.on("opponent_win_confirmed", ({ accepted } = {}) => {
    const confirmer = findUserBySocket(socket.id);
    if (!confirmer) return;
    const deskNum = Object.keys(desks).find(dn => {
      const m = desks[dn];
      return m && (m.p1?.id === socket.id || m.p2?.id === socket.id || m.p1?.sessionId === confirmer.sessionId || m.p2?.sessionId === confirmer.sessionId);
    });
    if (!deskNum) return;
    const match = desks[deskNum];
    if (!match || !match.reported) return;

    const reporter = match.p1.sessionId === match.reported ? match.p1 : match.p2;
    const loser = match.p1.sessionId === match.reported ? match.p2 : match.p1;

    if (!accepted) {
      if (reporter.id) io.to(reporter.id).emit("win_report_cancelled");
      if (loser.id) io.to(loser.id).emit("win_report_cancelled");
      match.reported = null;
      return;
    }

    const reporterUser = findUserBySession(reporter.sessionId);
    const loserUser = findUserBySession(loser.sessionId);
    if (reporterUser && loserUser) {
      reporterUser.history.push({ opponent: loserUser.name, result: "WIN", endTime: nowISO() });
      loserUser.history.push({ opponent: reporterUser.name, result: "LOSE", endTime: nowISO() });
      calculateWinsLosses(reporterUser);
      calculateWinsLosses(loserUser);
      saveData();

      if (reporterUser.id) io.to(reporterUser.id).emit("history", reporterUser.history);
      if (loserUser.id) io.to(loserUser.id).emit("history", loserUser.history);
      if (reporterUser.id) io.to(reporterUser.id).emit("return_to_menu_battle");
      if (loserUser.id) io.to(loserUser.id).emit("return_to_menu_battle");
    }

    delete desks[deskNum];
    broadcastActiveMatchesToAdmin();
    sendUserListTo();
  });

  // 管理者・抽選は従来通り
  socket.on("admin_login", ({ password } = {}) => {
    if (password === adminPassword) {
      adminSocket = socket;
      socket.emit("admin_ok");
      socket.emit("match_status", { enabled: matchEnabled });
      sendUserListTo(adminSocket);
      broadcastActiveMatchesToAdmin();
      socket.emit("admin_lottery_history", lotteryHistory);
      if (currentLotteryList.length > 0) socket.emit("update_lottery_list", { list: currentLotteryList });
    } else socket.emit("admin_fail");
  });

  socket.on("admin_toggle_match", ({ enable } = {}) => {
    matchEnabled = !!enable;
    io.emit("match_status", { enabled: matchEnabled });
    saveData();
  });

  socket.on("admin_view_users", () => sendUserListTo());

  socket.on("admin_draw_lots", ({ count, minBattles, minLoginMinutes, title }) => {
    if (!adminSocket) return;
    const nowMs = Date.now();
    const candidates = users.filter(u => {
      const battleCount = u.history?.length || 0;
      const loginMinutes = u.loginTime ? (nowMs - new Date(u.loginTime).getTime()) / 60000 : 0;
      return battleCount >= (minBattles || 0) && loginMinutes >= (minLoginMinutes || 0);
    });
    if (candidates.length === 0) {
      adminSocket.emit("admin_draw_result", { title, winners: [] });
      return;
    }
    const shuffled = [...candidates].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, count);
    const winners = selected.map(u => ({ name: u.name, sessionId: u.sessionId, totalBattles: u.history?.length || 0, wins: u.wins || 0, losses: u.losses || 0 }));

    selected.forEach(u => { if (u.id) io.to(u.id).emit("lottery_winner", { title }); });

    const record = { title, winners, time: new Date().toISOString() };
    lotteryHistory.push(record);
    if (lotteryHistory.length > MAX_LOTTERY_HISTORY) lotteryHistory.shift();

    adminSocket.emit("admin_draw_result", { title, winners });
    adminSocket.emit("admin_lottery_history", lotteryHistory);

    currentLotteryList = winners.map(w => ({ name: w.name || "未登録", sessionId: w.sessionId || null }));
    io.emit("update_lottery_list", { list: currentLotteryList });

    saveData();
  });

  socket.on("disconnect", () => {
    const user = findUserBySocket(socket.id);
    if (user) {
      user.disconnectedAt = Date.now();
      user.id = null;
      scheduleDisconnectCleanup(user.sessionId);
    }
    saveData();
    broadcastActiveMatchesToAdmin();
    sendUserListTo();
  });

});

loadData();
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
