// server/Server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../client/build")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/build", "index.html"));
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

// --- データ ---
let users = [];
let activeMatches = [];
let nextDeskNum = 1;
let matchEnabled = false;
let lotteryHistory = [];
let autoLogoutHours = 12;

// --- ユーティリティ ---
function findUserById(id) { return users.find(u => u.id === id); }
function findUserBySession(sessionId) { return users.find(u => u.sessionId === sessionId); }
function sendMatchStatusToAll() { io.emit("match_status", { enabled: matchEnabled }); }
function autoLogoutCheck() {
  const now = Date.now();
  const msLimit = autoLogoutHours * 3600 * 1000;
  users.forEach(u => {
    if (now - u.loginTime >= msLimit) {
      io.to(u.id).emit("force_logout", { reason: "auto" });
    }
  });
}

// 自動ログアウト定期処理
setInterval(autoLogoutCheck, 60 * 1000);

// --- Socket.io ---
io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  // --- ログイン ---
  socket.on("login", ({ name, sessionId, history, recentOpponents }) => {
    let user = findUserBySession(sessionId);
    if (!user) {
      user = { id: socket.id, name, sessionId: sessionId || socket.id, status: "idle", history: history || [], recentOpponents: recentOpponents || [], currentOpponent: null, deskNum: null, loginTime: Date.now() };
      users.push(user);
    } else {
      user.id = socket.id;
      user.name = name;
      user.loginTime = Date.now();
      user.history = history || user.history;
      user.recentOpponents = recentOpponents || user.recentOpponents;
      if (user.status === "in_battle" && user.currentOpponent) {
        socket.emit("matched", { opponent: user.currentOpponent, deskNum: user.deskNum });
      }
    }
    socket.emit("login_ok", user);
    sendMatchStatusToAll();
  });

  // --- 対戦 ---
  socket.on("find_opponent", () => {
    const user = findUserById(socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";
    const waiting = users.filter(u => u.status === "searching" && u.id !== socket.id);
    if (waiting.length > 0) {
      const opponent = waiting[0];
      const deskNum = nextDeskNum++;
      user.status = "in_battle"; user.currentOpponent = { id: opponent.id, name: opponent.name }; user.deskNum = deskNum;
      opponent.status = "in_battle"; opponent.currentOpponent = { id: user.id, name: user.name }; opponent.deskNum = deskNum;
      activeMatches.push({ deskNum, player1Id: user.id, player2Id: opponent.id, player1: user.name, player2: opponent.name, player1SessionId: user.sessionId, player2SessionId: opponent.sessionId });
      io.to(user.id).emit("matched", { opponent, deskNum });
      io.to(opponent.id).emit("matched", { opponent: user, deskNum });
    } else {
      socket.emit("match_status", { enabled: matchEnabled });
    }
  });

  socket.on("cancel_find", () => {
    const user = findUserById(socket.id);
    if (user && user.status === "searching") { user.status = "idle"; socket.emit("return_to_menu_battle"); }
  });

  // --- 勝利報告 ---
  socket.on("report_win_request", () => {
    const user = findUserById(socket.id);
    if (!user || !user.currentOpponent) return;
    const opponent = findUserById(user.currentOpponent.id);
    if (!opponent) return;
    io.to(opponent.id).emit("confirm_opponent_win", { deskNum: user.deskNum, winnerName: user.name });
  });

  socket.on("opponent_win_confirmed", ({ accepted }) => {
    const user = findUserById(socket.id);
    if (!user || !user.currentOpponent) return;
    const opponent = findUserById(user.currentOpponent.id);
    if (!opponent) return;

    if (accepted) {
      const now = Date.now();
      user.history.push({ opponent: opponent.name, result: "WIN", endTime: now });
      opponent.history.push({ opponent: user.name, result: "LOSE", endTime: now });

      const deskNum = user.deskNum;
      user.status = "idle"; user.currentOpponent = null; user.deskNum = null;
      opponent.status = "idle"; opponent.currentOpponent = null; opponent.deskNum = null;
      activeMatches = activeMatches.filter(m => m.deskNum !== deskNum);

      io.to(user.id).emit("return_to_menu_battle"); io.to(opponent.id).emit("return_to_menu_battle");
      io.to(user.id).emit("history", user.history); io.to(opponent.id).emit("history", opponent.history);
    } else {
      io.to(user.id).emit("win_report_cancelled");
    }
  });

  socket.on("history_update", ({ sessionId, history }) => {
    const user = findUserBySession(sessionId); if (user) user.history = history || user.history;
  });

  socket.on("logout", () => {
    const leavingUser = findUserById(socket.id);
    if (leavingUser) { activeMatches = activeMatches.filter(m => m.player1Id !== socket.id && m.player2Id !== socket.id); users = users.filter(u => u.id !== socket.id); }
  });

  // --- 管理者 ---
  socket.on("admin_login", ({ password }) => { if (password === process.env.ADMIN_PASSWORD) socket.emit("admin_ok"); else socket.emit("admin_fail"); });
  socket.on("admin_view_users", () => { socket.emit("admin_user_list", users); });
  socket.on("admin_toggle_match", ({ enable }) => { matchEnabled = enable; sendMatchStatusToAll(); });
  socket.on("admin_logout_all", () => { users.forEach(u => io.to(u.id).emit("force_logout", { reason: "admin" })); users = []; activeMatches = []; });
  socket.on("admin_get_lottery_history", () => { socket.emit("admin_lottery_history", lotteryHistory); });
  socket.on("admin_delete_lottery_history", ({ index }) => { lotteryHistory.splice(index,1); io.emit("admin_lottery_history", lotteryHistory); });
  socket.on("admin_clear_lottery_history", () => { lotteryHistory=[]; io.emit("admin_lottery_history", lotteryHistory); });

  // --- 抽選 ---
  socket.on("admin_draw_lots", ({ count, minBattles, minLoginMinutes, title }) => {
    const candidates = users.filter(u => u.history.length >= minBattles && ((Date.now()-u.loginTime)/60000)>=minLoginMinutes);
    const shuffled = [...candidates].sort(()=>Math.random()-0.5);
    const winners = shuffled.slice(0, count);
    lotteryHistory.push({ title, winners });
    winners.forEach(w => io.to(w.id).emit("lottery_winner",{ title }));
    io.emit("update_lottery_list", { list: winners.map(w => ({ title, winners })) });
  });

  socket.on("admin_set_auto_logout", ({ hours }) => { autoLogoutHours = hours; io.emit("admin_current_auto_logout",{ hours }); });

  socket.on("disconnect", () => {
    const leavingUser = findUserById(socket.id);
    if (leavingUser) { activeMatches = activeMatches.filter(m => m.player1Id !== socket.id && m.player2Id !== socket.id); users = users.filter(u => u.id !== socket.id); }
  });
});

httpServer.listen(process.env.PORT || 4000, () => console.log("Server is running"));
