// server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";

// --- path helpers for ESM ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// --- Serve React build (Vite -> client/dist) ---
const clientDistPath = path.join(__dirname, "client/dist");
app.use(express.static(clientDistPath));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// === In-memory data ===
// users: array of { id (socket.id), name, sessionId, status, loginTime, history: [], recentOpponents: [], opponentSessionId, deskNum }
let users = [];
// matches: deskNum -> [sessionId1, sessionId2]
let matches = {};
let matchEnabled = false;

// lotteryResults: persisted results (full data)
let lotteryResults = []; // [{ title, winners: [sessionId,...] }]
let currentLotteryTitle = "";
let autoLogoutHours = 12;

const ADMIN_PASSWORD = "admin1234";

// pending two-step confirmations: deskNum -> { requester: sessionId }
let pendingWinConfirm = {};

// --- utilities ---
function assignDeskNum() {
  let desk = 1;
  while (matches[desk]) desk++;
  return desk;
}

function winnerNamesFromSessionIds(sessionIds) {
  return sessionIds
    .map((sid) => {
      const u = users.find((x) => x.sessionId === sid);
      return u ? { name: u.name } : null;
    })
    .filter(Boolean);
}

function findUserBySocketId(socketId) {
  return users.find((u) => u.id === socketId);
}
function findUserBySessionId(sessionId) {
  return users.find((u) => u.sessionId === sessionId);
}

function buildLotteryListForClients() {
  return lotteryResults.map((l) => ({
    title: l.title,
    winners: winnerNamesFromSessionIds(l.winners),
  }));
}

function getActiveMatchesForAdmin() {
  return Object.entries(matches).map(([deskNum, sids]) => {
    const p1 = users.find((u) => u.sessionId === sids[0]);
    const p2 = users.find((u) => u.sessionId === sids[1]);
    return {
      deskNum,
      player1: p1 ? p1.name : "不明",
      player2: p2 ? p2.name : "不明",
      player1SessionId: sids[0],
      player2SessionId: sids[1],
    };
  });
}

function buildAdminUserList() {
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    sessionId: u.sessionId,
    status: u.status,
    loginTime: u.loginTime,
    history: u.history || [],
  }));
}

// --- auto-logout check every minute ---
setInterval(() => {
  const now = new Date();
  users.forEach((u) => {
    if (!u.loginTime) return;
    const login = new Date(u.loginTime);
    const hours = (now - login) / (1000 * 60 * 60);
    if (hours >= autoLogoutHours) {
      // emit force_logout to the socket id if connected
      if (u.id) io.to(u.id).emit("force_logout", { reason: "auto" });
    }
  });
  // prune offline/expired users
  users = users.filter((u) => {
    if (!u.loginTime) return true;
    const login = new Date(u.loginTime);
    const hours = (new Date() - login) / (1000 * 60 * 60);
    return hours < autoLogoutHours;
  });
}, 60 * 1000);

// --- Socket.io handlers ---
io.on("connection", (socket) => {
  console.log("New connection:", socket.id);

  // Immediately inform about match status
  socket.emit("match_status", { enabled: matchEnabled });

  // --- User login ---
  socket.on("login", ({ name, sessionId }) => {
    if (!name || !name.trim()) return;
    name = name.trim();

    // try to find existing by sessionId first
    let user = null;
    if (sessionId) user = users.find((u) => u.sessionId === sessionId);

    if (!user) {
      // if no sessionId match, try by name
      user = users.find((u) => u.name === name);
    }

    if (user) {
      user.id = socket.id;
      user.status = user.status || "idle";
      user.loginTime = new Date().toISOString();
      if (!user.sessionId) user.sessionId = sessionId || uuidv4();
    } else {
      user = {
        id: socket.id,
        name,
        sessionId: sessionId || uuidv4(),
        status: "idle",
        loginTime: new Date().toISOString(),
        history: [],
        recentOpponents: [],
        opponentSessionId: null,
        deskNum: null,
      };
      users.push(user);
    }

    // build currentOpponent info if any
    const currentOpponent = user.opponentSessionId
      ? users.find((u) => u.sessionId === user.opponentSessionId)
      : null;

    const wonTitles = lotteryResults
      .filter((l) => l.winners.includes(user.sessionId))
      .map((l) => l.title);

    const currentLotteryList = buildLotteryListForClients();

    socket.emit("login_ok", {
      ...user,
      currentOpponent: currentOpponent
        ? { id: currentOpponent.id, name: currentOpponent.name }
        : null,
      deskNum: user.deskNum,
      lotteryWinner: wonTitles.length > 0,
      history: user.history || [],
      lotteryList: currentLotteryList,
    });

    // if there's an admin connected, update their list
    io.emit("admin_user_list", buildAdminUserList());
  });

  // --- Admin login ---
  socket.on("admin_login", ({ password }) => {
    if (password === ADMIN_PASSWORD) {
      // mark this socket as admin (store pointer)
      socket.emit("admin_ok");
      // keep a list of admin sockets? We'll set this socket as adminSocket for targeted emits
      // (clients expect admin_get_* events immediately)
      socket.emit("match_status", { enabled: matchEnabled });
      socket.emit("admin_current_auto_logout", { hours: autoLogoutHours });
      socket.emit("admin_lottery_history", lotteryResults.map(l => ({ title: l.title, winners: winnerNamesFromSessionIds(l.winners) })));
      socket.emit("admin_active_matches", getActiveMatchesForAdmin());
      socket.emit("admin_user_list", buildAdminUserList());
    } else {
      socket.emit("admin_fail");
    }
  });

  // --- admin view users (periodic) ---
  socket.on("admin_view_users", () => {
    socket.emit("admin_user_list", buildAdminUserList());
  });

  // --- admin get active matches ---
  socket.on("admin_get_active_matches", () => {
    socket.emit("admin_active_matches", getActiveMatchesForAdmin());
  });

  // --- admin get lottery history ---
  socket.on("admin_get_lottery_history", () => {
    socket.emit(
      "admin_lottery_history",
      lotteryResults.map((l) => ({ title: l.title, winners: winnerNamesFromSessionIds(l.winners) }))
    );
  });

  // --- get lottery list for users ---
  socket.on("get_lottery_list", () => {
    socket.emit("update_lottery_list", {
      list: buildLotteryListForClients(),
      title: currentLotteryTitle,
    });
  });

  // --- set lottery title ---
  socket.on("admin_set_lottery_title", ({ title }) => {
    if (typeof title === "string" && title.trim()) {
      currentLotteryTitle = title.trim();
      socket.emit("admin_set_lottery_title_ok", { title: currentLotteryTitle });
    }
  });

  // --- Draw lots (admin) ---
  socket.on("admin_draw_lots", ({ count = 1, minBattles = 0, minLoginMinutes = 0 }) => {
    const title = currentLotteryTitle || `抽選${lotteryResults.length + 1}`;
    const nowDate = new Date();

    const candidates = users.filter((u) => {
      const loginMinutes = (nowDate - new Date(u.loginTime)) / 60000;
      const battles = (u.history || []).length;
      const alreadyWon = lotteryResults.some((l) => l.winners.includes(u.sessionId));
      return battles >= minBattles && loginMinutes >= minLoginMinutes && !alreadyWon;
    });

    if (candidates.length === 0) {
      socket.emit("admin_draw_result", { winners: [], title });
      return;
    }

    const shuffled = candidates.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, Math.min(count, candidates.length));

    // store winners by sessionId
    lotteryResults.push({ title, winners: winners.map((w) => w.sessionId) });

    // notify all users about update
    const listForUsers = buildLotteryListForClients();
    io.emit("update_lottery_list", { list: listForUsers, title });

    // notify winners individually
    winners.forEach((w) => {
      if (w.id) io.to(w.id).emit("lottery_winner", { title });
    });

    // send admin draw result with names
    const winnerNames = winners.map((w) => ({ name: w.name }));
    socket.emit("admin_draw_result", { winners: winnerNames, title });

    // also update admin history emit
    io.emit("admin_lottery_history", lotteryResults.map(l => ({ title: l.title, winners: winnerNamesFromSessionIds(l.winners) })));
  });

  // --- admin delete one lottery history entry ---
  socket.on("admin_delete_lottery_history", ({ title, index }) => {
    if (typeof index === "number") {
      if (index >= 0 && index < lotteryResults.length) {
        lotteryResults.splice(index, 1);
      }
    } else if (typeof title === "string") {
      lotteryResults = lotteryResults.filter((l) => l.title !== title);
    }
    io.emit("admin_lottery_history", lotteryResults.map(l => ({ title: l.title, winners: winnerNamesFromSessionIds(l.winners) })));
    io.emit("update_lottery_list", { list: buildLotteryListForClients() });
  });

  // --- admin clear lottery history ---
  socket.on("admin_clear_lottery_history", () => {
    lotteryResults = [];
    io.emit("admin_lottery_history", []);
    io.emit("update_lottery_list", { list: [] });
  });

  // --- toggle match enabled ---
  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = !!enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  // --- find opponent (user) ---
  socket.on("find_opponent", () => {
    const user = findUserBySocketId(socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";
    user.opponentSessionId = null;
    user.deskNum = null;

    // find available opponent
    const available = users.find((u) => u.sessionId !== user.sessionId && u.status === "searching" && !Object.values(matches).some((m) => m.includes(u.sessionId)) && !user.recentOpponents.includes(u.sessionId));
    if (available) {
      const deskNum = assignDeskNum();
      matches[deskNum] = [user.sessionId, available.sessionId];

      user.recentOpponents.push(available.sessionId);
      available.recentOpponents.push(user.sessionId);

      user.status = "matched";
      available.status = "matched";
      user.opponentSessionId = available.sessionId;
      available.opponentSessionId = user.sessionId;
      user.deskNum = deskNum;
      available.deskNum = deskNum;

      io.to(user.id).emit("matched", { opponent: { id: available.id, name: available.name }, deskNum });
      io.to(available.id).emit("matched", { opponent: { id: user.id, name: user.name }, deskNum });

      // notify admin of active matches
      io.emit("admin_active_matches", getActiveMatchesForAdmin());
    }
    // update admin users
    io.emit("admin_user_list", buildAdminUserList());
  });

  socket.on("cancel_find", () => {
    const user = findUserBySocketId(socket.id);
    if (user) {
      user.status = "idle";
      user.opponentSessionId = null;
      user.deskNum = null;
    }
    io.emit("admin_user_list", buildAdminUserList());
  });

  // --- report win request (two-step flow) ---
  socket.on("report_win_request", () => {
    const user = findUserBySocketId(socket.id);
    if (!user || !user.deskNum) return;
    const deskNum = user.deskNum;
    const otherSid = matches[deskNum] && matches[deskNum].find((sid) => sid !== user.sessionId);
    const opponent = otherSid ? findUserBySessionId(otherSid) : null;
    if (!opponent) return;

    // send waiting signal to reporter (client UI may show waiting)
    io.to(user.id).emit("waiting_for_confirmation");
    // notify opponent to confirm loser
    io.to(opponent.id).emit("confirm_opponent_win", { deskNum, winnerName: user.name });

    pendingWinConfirm[deskNum] = { requester: user.sessionId };
  });

  // --- opponent responds to confirmation ---
  socket.on("opponent_win_response", ({ deskNum, accepted }) => {
    const requesterSid = pendingWinConfirm[deskNum]?.requester;
    if (!requesterSid) return;

    const winner = findUserBySessionId(requesterSid);
    const loser = (matches[deskNum] || []).map(sid => findUserBySessionId(sid)).find(u => u && u.sessionId !== requesterSid);

    if (!winner || !loser) return;

    if (accepted) {
      // store history
      const nowIso = new Date().toISOString();
      winner.history.push({ opponent: loser.name, result: "WIN", startTime: nowIso, endTime: nowIso });
      loser.history.push({ opponent: winner.name, result: "LOSE", startTime: nowIso, endTime: nowIso });

      // clear match
      winner.status = "idle";
      winner.opponentSessionId = null;
      winner.deskNum = null;

      loser.status = "idle";
      loser.opponentSessionId = null;
      loser.deskNum = null;

      delete matches[deskNum];
      delete pendingWinConfirm[deskNum];

      // emit history to both
      if (winner.id) io.to(winner.id).emit("history", winner.history);
      if (loser.id) io.to(loser.id).emit("history", loser.history);

      // notify return to menu
      if (winner.id) io.to(winner.id).emit("return_to_menu_battle");
      if (loser.id) io.to(loser.id).emit("return_to_menu_battle");

      // update admin views
      io.emit("admin_active_matches", getActiveMatchesForAdmin());
      io.emit("admin_user_list", buildAdminUserList());
    } else {
      delete pendingWinConfirm[deskNum];
      // inform both parties that cancelled
      if (winner.id) io.to(winner.id).emit("opponent_win_cancelled");
      if (loser.id) io.to(loser.id).emit("opponent_win_cancelled");
    }
  });

  // --- admin manual report win ---
  socket.on("admin_report_win", ({ winnerSessionId, deskNum }) => {
    const sids = matches[deskNum];
    if (!sids || sids.length !== 2) return;
    const winnerSid = winnerSessionId;
    const loserSid = sids.find((sid) => sid !== winnerSid);
    const winner = findUserBySessionId(winnerSid);
    const loser = findUserBySessionId(loserSid);
    if (!winner || !loser) return;

    const nowIso = new Date().toISOString();
    winner.history.push({ opponent: loser.name, result: "WIN", startTime: nowIso, endTime: nowIso });
    loser.history.push({ opponent: winner.name, result: "LOSE", startTime: nowIso, endTime: nowIso });

    // clear match
    winner.status = "idle";
    winner.opponentSessionId = null;
    winner.deskNum = null;

    loser.status = "idle";
    loser.opponentSessionId = null;
    loser.deskNum = null;

    delete matches[deskNum];

    if (winner.id) io.to(winner.id).emit("history", winner.history);
    if (loser.id) io.to(loser.id).emit("history", loser.history);
    if (winner.id) io.to(winner.id).emit("return_to_menu_battle");
    if (loser.id) io.to(loser.id).emit("return_to_menu_battle");

    io.emit("admin_active_matches", getActiveMatchesForAdmin());
    io.emit("admin_user_list", buildAdminUserList());
  });

  // --- admin report both lose ---
  socket.on("admin_report_both_lose", ({ deskNum }) => {
    const sids = matches[deskNum];
    if (!sids || sids.length !== 2) return;
    const p1 = findUserBySessionId(sids[0]);
    const p2 = findUserBySessionId(sids[1]);
    if (!p1 || !p2) return;

    const nowIso = new Date().toISOString();
    p1.history.push({ opponent: p2.name, result: "LOSE", startTime: nowIso, endTime: nowIso });
    p2.history.push({ opponent: p1.name, result: "LOSE", startTime: nowIso, endTime: nowIso });

    p1.status = "idle"; p1.opponentSessionId = null; p1.deskNum = null;
    p2.status = "idle"; p2.opponentSessionId = null; p2.deskNum = null;

    delete matches[deskNum];

    if (p1.id) io.to(p1.id).emit("history", p1.history);
    if (p2.id) io.to(p2.id).emit("history", p2.history);
    if (p1.id) io.to(p1.id).emit("return_to_menu_battle");
    if (p2.id) io.to(p2.id).emit("return_to_menu_battle");

    io.emit("admin_active_matches", getActiveMatchesForAdmin());
    io.emit("admin_user_list", buildAdminUserList());
  });

  // --- admin get auto logout ---
  socket.on("admin_get_auto_logout", () => {
    socket.emit("admin_current_auto_logout", { hours: autoLogoutHours });
  });

  // --- admin set auto logout ---
  socket.on("admin_set_auto_logout", ({ hours }) => {
    if (typeof hours === "number" && hours > 0) {
      autoLogoutHours = hours;
      socket.emit("admin_set_auto_logout_ok", { hours: autoLogoutHours });
    }
  });

  // --- admin logout user ---
  socket.on("admin_logout_user", ({ userId }) => {
    const target = users.find((u) => u.id === userId);
    if (target) {
      io.to(target.id).emit("force_logout", { reason: "admin" });
      users = users.filter((u) => u.id !== userId);
    }
    io.emit("admin_user_list", buildAdminUserList());
  });

  // --- admin logout all ---
  socket.on("admin_logout_all", () => {
    users.forEach((u) => {
      if (u.id) io.to(u.id).emit("force_logout", { reason: "admin" });
    });
    users = [];
    matches = {};
    io.emit("admin_user_list", buildAdminUserList());
    io.emit("admin_active_matches", getActiveMatchesForAdmin());
  });

  // --- disconnect cleanup ---
  socket.on("disconnect", () => {
    // remove user
    users = users.filter((u) => u.id !== socket.id);

    // remove any matches containing socket
    Object.keys(matches).forEach((deskNum) => {
      const sids = matches[deskNum];
      const removed = sids.some((sid) => {
        const u = users.find((x) => x.sessionId === sid);
        // user is removed already; but we check based on socket.id
        return false;
      });
      // If match contains this disconnected socket, delete it
      const match = sids.map(sid => findUserBySessionId(sid)).find(m => m && m.id === socket.id);
      if (match) delete matches[deskNum];
    });

    io.emit("admin_user_list", buildAdminUserList());
    io.emit("admin_active_matches", getActiveMatchesForAdmin());
    console.log("disconnect:", socket.id);
  });
});

// --- start server ---
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
