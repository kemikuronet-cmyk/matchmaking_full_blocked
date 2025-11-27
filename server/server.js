// Server.js — 完全安定版（1時間の再接続猶予 + heartbeat）
// 再接続（画面更新）での対戦継続、履歴の永続化、卓の衝突防止、抽選の永続化と再送信

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

// React ビルド配信対応
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
const RECONNECT_GRACE_MS = 60 * 60 * 1000; // 切断後 1 時間待って再接続なければクリーンアップ（要件）
const MAX_LOTTERY_HISTORY = 200;

let users = [];
// desks は卓番号 -> { p1: { sessionId, id, name }, p2: { ... }, reported: sessionId|null }
let desks = {};
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234";
let autoLogoutHours = 12;
let lotteryHistory = [];
let currentLotteryList = []; // winners の簡易配列 (全クライアント向け)

function nowISO() { return new Date().toISOString(); }

function saveData() {
  try {
    const data = {
      users: users.map(u => ({
        // recentOpponents は配列で保存
        id: u.id,
        sessionId: u.sessionId,
        name: u.name,
        status: u.status,
        loginTime: u.loginTime,
        history: u.history || [],
        recentOpponents: u.recentOpponents || [],
        // disconnectedAt は一時情報なので保存しない
      })),
      // desks を sessionId ベースで保存（socket.id は再接続で変わるため）
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
    if (data.users) users = data.users.map(u => ({ ...u, recentOpponents: u.recentOpponents || [], // runtime fields
      // runtime-only fields
      id: u.id || null,
      disconnectedAt: null
    }));
    if (data.desks) {
      // 各卓は sessionId ベースで復元。id は接続時に更新される
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

// when a user (re)connects, reconcile desks by sessionId -> update socket.id references and notify clients
function reconcileDesksForSession(sessionId, socketId) {
  Object.keys(desks).forEach(dn => {
    const d = desks[dn];
    if (d.p1?.sessionId === sessionId) {
      d.p1.id = socketId;
    }
    if (d.p2?.sessionId === sessionId) {
      d.p2.id = socketId;
    }
  });
}

// Try to notify both players in a desk that someone reconnected (and keep the match state)
function notifyReconnected(sessionId, socket) {
  // find desk containing this sessionId
  const deskNum = Object.keys(desks).find(dn => {
    const d = desks[dn];
    return d && (d.p1?.sessionId === sessionId || d.p2?.sessionId === sessionId);
  });
  if (!deskNum) return;
  const match = desks[deskNum];
  // update ids if possible
  if (match.p1?.sessionId === sessionId) match.p1.id = socket.id;
  if (match.p2?.sessionId === sessionId) match.p2.id = socket.id;

  // if both sides have ids (connected), emit matched to both so UI shows the table
  if (match.p1?.id && match.p2?.id) {
    io.to(match.p1.id).emit("matched", { opponent: { id: match.p2.id, name: match.p2.name || match.p2.sessionId }, deskNum });
    io.to(match.p2.id).emit("matched", { opponent: { id: match.p1.id, name: match.p1.name || match.p1.sessionId }, deskNum });
  }
}

// clean-up routine for a disconnected user after grace period
function scheduleDisconnectCleanup(sessionId) {
  const u = findUserBySession(sessionId);
  if (!u) return;
  u.disconnectedAt = Date.now();
  setTimeout(() => {
    const still = findUserBySession(sessionId);
    if (!still) return; // already removed
    // if reconnected, disconnectedAt will be null
    if (still.disconnectedAt && (Date.now() - still.disconnectedAt) >= RECONNECT_GRACE_MS) {
      // remove user and any desks where both sides are gone
      users = users.filter(x => x.sessionId !== sessionId);

      // remove desks where either player sessionId === sessionId OR where both participants no longer have live sockets
      Object.keys(desks).forEach(dn => {
        const d = desks[dn];
        if (!d) return;
        if (d.p1?.sessionId === sessionId || d.p2?.sessionId === sessionId) {
          // if other player still connected (by socket id present), keep desk and mark opponent back to idle
          const otherSession = d.p1?.sessionId === sessionId ? d.p2?.sessionId : d.p1?.sessionId;
          const otherUser = findUserBySession(otherSession);
          if (otherUser) {
            // opponent still exists => set their status to idle so they can re-find opponent
            otherUser.status = "idle";
          }
          delete desks[dn];
        }
      });

      saveData();
      broadcastActiveMatchesToAdmin();
      sendUserListTo();
    }
  }, RECONNECT_GRACE_MS + 200);
}

// socket.io
io.on("connection", socket => {
  console.log("✅ Connected:", socket.id);

  // send current lottery summary on connect
  if (currentLotteryList && currentLotteryList.length > 0) {
    socket.emit("update_lottery_list", { list: currentLotteryList });
  }

  // ---- LOGIN ----
  socket.on("login", ({ name, sessionId, recentOpponents, history } = {}) => {
    if (!name || !name.trim()) return;
    // prefer sessionId based lookup to restore state across refreshes
    let user = sessionId ? findUserBySession(sessionId) : null;
    if (!user) user = users.find(u => u.name === name);

    if (user) {
      // restore connection
      const hoursDiff = user.loginTime ? (Date.now() - new Date(user.loginTime).getTime()) / 3600000 : 0;
      if (hoursDiff >= autoLogoutHours) {
        user.history = [];
        user.recentOpponents = [];
      }

      user.id = socket.id;
      user.status = user.status || "idle";
      user.disconnectedAt = null; // mark reconnected

      // update name in case user changed
      user.name = name;

    } else {
      // new user
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

    // Reconcile desks: if there is a desk referencing this sessionId, update its socket.id
    reconcileDesksForSession(user.sessionId, socket.id);

    // If user is part of an existing desk and the opponent is connected, notify both
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

  // ---- simple heartbeat from client (helps when mobile backgrounding) ----
  // client should periodically emit: socket.emit('heartbeat', { sessionId })
  socket.on("heartbeat", ({ sessionId } = {}) => {
    if (!sessionId) return;
    const u = findUserBySession(sessionId);
    if (!u) return;
    // touch the user so cleanup won't remove them
    u.disconnectedAt = null;
    // if this socket is different, update id and try to reconcile desks
    if (u.id !== socket.id) {
      u.id = socket.id;
      reconcileDesksForSession(sessionId, socket.id);
      notifyReconnected(sessionId, socket);
    }
    // optionally send minimal ack
    socket.emit("heartbeat_ok", { now: nowISO() });
  });

  // ---- LOGOUT (explicit) ----
  socket.on("logout", () => {
    const u = findUserBySocket(socket.id);
    if (u) {
      users = users.filter(x => x.sessionId !== u.sessionId);

      // remove desks where this user participates
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

  // ---- FIND OPPONENT ----
  socket.on("find_opponent", () => {
    const user = findUserBySocket(socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";

    // find candidate respecting recentOpponents and not same socket
    const candidate = users.find(u =>
      u.sessionId !== user.sessionId &&
      u.status === "searching" &&
      !(user.recentOpponents || []).includes(u.sessionId) &&
      !(u.recentOpponents || []).includes(user.sessionId)
    );

    if (candidate) {
      const deskNum = assignDeskSequential();
      // store desks by sessionId and name; id fields will be filled when client connects
      desks[deskNum] = {
        p1: { sessionId: user.sessionId, id: user.id, name: user.name },
        p2: { sessionId: candidate.sessionId, id: candidate.id, name: candidate.name },
        reported: null
      };

      user.status = candidate.status = "in_battle";

      user.recentOpponents = user.recentOpponents || [];
      candidate.recentOpponents = candidate.recentOpponents || [];
      user.recentOpponents.push(candidate.sessionId);
      candidate.recentOpponents.push(user.sessionId);

      // notify both clients (if connected)
      if (user.id) io.to(user.id).emit("matched", { opponent: { id: candidate.id, name: candidate.name }, deskNum });
      if (candidate.id) io.to(candidate.id).emit("matched", { opponent: { id: user.id, name: user.name }, deskNum });

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

  // ---- 勝利報告フロー ----
  socket.on("report_win_request", () => {
    const user = findUserBySocket(socket.id);
    if (!user) return;
    // find desk by socket id OR by sessionId
    const deskNum = Object.keys(desks).find(dn => {
      const m = desks[dn];
      return m && (m.p1?.id === socket.id || m.p2?.id === socket.id || m.p1?.sessionId === user.sessionId || m.p2?.sessionId === user.sessionId);
    });
    if (!deskNum) return;

    const match = desks[deskNum];
    const opponent = match.p1.sessionId === user.sessionId ? match.p2 : match.p1;
    match.reported = user.sessionId;

    // send confirm event to opponent if connected
    const opponentSocketId = opponent.id || (io.sockets.sockets.get(opponent.sessionId) ? opponent.sessionId : null);
    if (opponent.id) {
      io.to(opponent.id).emit("confirm_opponent_win", { deskNum, winnerName: user.name });
    } else {
      // opponent not connected: treat as auto-accept after short timeout
      setTimeout(() => {
        // if still reported and opponent not connected, auto-accept
        const stillMatch = desks[deskNum];
        if (stillMatch && stillMatch.reported === user.sessionId) {
          // resolve as win
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

    // find desk by confirmer socket/session
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

    // accepted -> commit
    const reporterUser = findUserBySession(reporter.sessionId);
    const loserUser = findUserBySession(loser.sessionId);
    if (reporterUser && loserUser) {
      reporterUser.history = reporterUser.history || [];
      loserUser.history = loserUser.history || [];
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

  // ---- 管理者関連 ----
  socket.on("admin_login", ({ password } = {}) => {
    if (password === adminPassword) {
      adminSocket = socket;
      console.log("Admin logged in:", socket.id);
      socket.emit("admin_ok");
      socket.emit("match_status", { enabled: matchEnabled });
      sendUserListTo(adminSocket);
      broadcastActiveMatchesToAdmin();
      socket.emit("admin_lottery_history", lotteryHistory);
      // 管理者に最新の抽選も送る
      if (currentLotteryList && currentLotteryList.length > 0) {
        socket.emit("update_lottery_list", { list: currentLotteryList });
      }
    } else socket.emit("admin_fail");
  });

  socket.on("admin_toggle_match", ({ enable } = {}) => {
    matchEnabled = !!enable;
    io.emit("match_status", { enabled: matchEnabled });
    saveData();
  });

  socket.on("admin_view_users", () => sendUserListTo());

  // ---- 抽選機能 ----
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

    // notify winners individually
    selected.forEach(u => {
      if (u.id) {
        io.to(u.id).emit("lottery_winner", { title });
      }
    });

    const record = { title, winners, time: new Date().toISOString() };
    lotteryHistory.push(record);
    if (lotteryHistory.length > MAX_LOTTERY_HISTORY) lotteryHistory.shift();

    adminSocket.emit("admin_draw_result", { title, winners });
    adminSocket.emit("admin_lottery_history", lotteryHistory);

    // currentLotteryList は簡易 winners 配列（clients は柔軟に対応）
    currentLotteryList = winners.map(w => ({ name: w.name || "未登録", sessionId: w.sessionId || null }));
    io.emit("update_lottery_list", { list: currentLotteryList });

    saveData();
  });

  // ---- disconnect ----
  socket.on("disconnect", () => {
    // mark user disconnected, but do not immediately delete — allow reconnect grace
    const user = findUserBySocket(socket.id);
    if (user) {
      user.disconnectedAt = Date.now();
      user.id = null; // socket.id invalid now
      // schedule cleanup if not reconnected
      scheduleDisconnectCleanup(user.sessionId);
    }

    // Also clean desks where both sides are gone: (but we leave desks intact until cleanup)
    saveData();
    broadcastActiveMatchesToAdmin();
    sendUserListTo();
  });

});

// 起動
loadData();
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
