// server/server.js
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

// =======================================================
// React build 配信設定
// =======================================================
const clientDistPath = path.join(__dirname, "../client/dist");
app.use(express.static(clientDistPath));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDistPath, "index.html"));
});

// =======================================================
// サーバー状態管理
// =======================================================
let users = {};       // sessionId -> { name, deskNum, opponent, socketId, history }
let desks = [];       // { deskNum, player1, player2, player1SessionId, player2SessionId }
let nextDeskNum = 1;

let matchEnabled = false;
let lotteryHistory = []; // { title, time, winners: [{ name }] }
const ADMIN_PASS = process.env.ADMIN_PASS || "admin123";

// =======================================================
// Socket.io 接続
// =======================================================
io.on("connection", (socket) => {
  console.log("✅ Socket connected:", socket.id);

  // ------------------------
  // ユーザー操作
  // ------------------------
  socket.on("login", ({ name, sessionId }) => {
    users[sessionId] = users[sessionId] || { name, deskNum: null, opponent: null, socketId: socket.id, history: [] };
    users[sessionId].name = name;
    users[sessionId].socketId = socket.id;

    // ログイン通知
    socket.emit("login_ok", {
      name,
      sessionId,
      deskNum: users[sessionId].deskNum,
      opponent: users[sessionId].opponent,
      matchEnabled,
      history: users[sessionId].history || [],
    });

    // 管理者向けデータも送信
    if (users[sessionId].isAdmin) {
      socket.emit("admin_active_matches", desks);
      socket.emit("admin_lottery_history", lotteryHistory);
    }
  });

  socket.on("find_opponent", () => {
    if (!matchEnabled) return;

    const mySessionId = Object.keys(users).find(id => users[id].socketId === socket.id);
    const myUser = users[mySessionId];
    if (!myUser || myUser.deskNum) return;

    const candidates = Object.entries(users)
      .filter(([id, u]) => !u.deskNum && id !== mySessionId);

    if (candidates.length === 0) return;

    const [oppSessionId, opponent] = candidates[0];

    const deskNum = nextDeskNum++;
    myUser.deskNum = deskNum;
    myUser.opponent = opponent.name;

    opponent.deskNum = deskNum;
    opponent.opponent = myUser.name;

    desks.push({
      deskNum,
      player1: myUser.name,
      player1SessionId: mySessionId,
      player2: opponent.name,
      player2SessionId: oppSessionId,
    });

    socket.emit("matched", { opponent, deskNum });
    io.to(opponent.socketId).emit("matched", { opponent: myUser, deskNum });
  });

  socket.on("report_win_request", () => {
    const mySessionId = Object.keys(users).find(id => users[id].socketId === socket.id);
    const myUser = users[mySessionId];
    if (!myUser || !myUser.deskNum) return;

    const desk = desks.find(d => d.deskNum === myUser.deskNum);
    if (!desk) return;

    const opponentName = myUser.opponent;
    const opponentEntry = Object.entries(users).find(([id, u]) => u.name === opponentName);

    // 勝利処理
    myUser.history.push({ opponent: opponentName, result: "WIN" });
    if (opponentEntry) opponentEntry[1].history.push({ opponent: myUser.name, result: "LOSE" });

    // 対戦卓解放
    desks = desks.filter(d => d.deskNum !== desk.deskNum);
    myUser.deskNum = null;
    myUser.opponent = null;

    if (opponentEntry) {
      opponentEntry[1].deskNum = null;
      opponentEntry[1].opponent = null;
      io.to(opponentEntry[1].socketId).emit("return_to_menu_battle");
    }

    socket.emit("return_to_menu_battle");
  });

  // ------------------------
  // 管理者操作
  // ------------------------
  socket.on("admin_login", ({ password }) => {
    if (password === ADMIN_PASS) {
      const sessionId = Object.keys(users).find(id => users[id].socketId === socket.id) || socket.id;
      users[sessionId] = users[sessionId] || {};
      users[sessionId].isAdmin = true;

      socket.emit("admin_ok");
      socket.emit("admin_active_matches", desks);
      socket.emit("admin_lottery_history", lotteryHistory);
    } else {
      socket.emit("admin_fail");
    }
  });

  socket.on("admin_enable_matching", () => {
    matchEnabled = true;
    io.emit("match_status_update", { enabled: matchEnabled, status: "マッチング中" });
  });

  socket.on("admin_disable_matching", () => {
    matchEnabled = false;
    io.emit("match_status_update", { enabled: matchEnabled, status: "停止中" });
  });

  socket.on("admin_run_lottery", ({ title, count }) => {
    const participants = Object.values(users).filter(u => !u.isAdmin);
    const shuffled = participants.sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, count).map(u => ({ name: u.name }));

    const record = { title, time: Date.now(), winners };
    lotteryHistory.push(record);

    socket.emit("admin_lottery_result", record);
    io.emit("update_lottery_list", { list: winners });
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

// =======================================================
// サーバー起動
// =======================================================
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
