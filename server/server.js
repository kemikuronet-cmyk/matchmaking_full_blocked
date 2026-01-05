import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import fs from "fs";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// ================================
// 静的ファイル配信
// ================================
const distPathOptions = [
  path.join(__dirname, "../dist"), // server の一つ上に dist
  path.join(__dirname, "./dist"),  // server 内に dist
];

let distPath = null;
for (const p of distPathOptions) {
  if (fs.existsSync(p)) {
    distPath = p;
    break;
  }
}

if (!distPath) {
  console.error("❌ Build フォルダが見つかりません。npm run build を実行してください。");
  process.exit(1);
}

app.use(express.static(distPath));
app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));

// ================================
// データ管理
// ================================
let users = {}; // sessionId -> { name, socketId, recentOpponents: [], history: [] }
let desks = []; // { deskNum, player1, player2, player1SessionId, player2SessionId }
let lotteryHistory = [];
let matchEnabled = false;
let nextDeskNum = 1;

// ================================
// Socket.io ロジック
// ================================
io.on("connection", (socket) => {
  console.log("✅ Socket connected:", socket.id);

  // ---------- ユーザーログイン ----------
  socket.on("login", (data) => {
    const { name, sessionId, recentOpponents = [], history: hist = [] } = data;
    const sid = sessionId || socket.id;

    users[sid] = {
      name,
      socketId: socket.id,
      recentOpponents,
      history: hist,
    };

    // マッチング状況送信
    socket.emit("login_ok", {
      name,
      id: socket.id,
      sessionId: sid,
      history: users[sid].history,
      deskNum: null,
      opponent: null,
      matchEnabled,
      recentOpponents,
    });
  });

  // ---------- 対戦マッチング ----------
  socket.on("find_opponent", () => {
    const user = Object.values(users).find(u => u.socketId === socket.id);
    if (!matchEnabled || !user) return;

    // マッチング可能なユーザーを検索
    const candidates = Object.entries(users)
      .filter(([sid, u]) => u.socketId !== socket.id && !u.currentDesk)
      .filter(([sid, u]) => !user.recentOpponents.includes(u.name));

    if (candidates.length === 0) return;

    // 1人選ぶ（最初の候補）
    const [opponentSid, opponent] = candidates[0];

    // 卓番号割り当て
    const deskNum = nextDeskNum++;
    desks.push({
      deskNum,
      player1: user.name,
      player2: opponent.name,
      player1SessionId: user.socketId,
      player2SessionId: opponent.socketId,
    });

    // それぞれに対戦相手情報を送信
    socket.emit("matched", { opponent: { name: opponent.name }, deskNum });
    io.to(opponent.socketId).emit("matched", { opponent: { name: user.name }, deskNum });

    // ユーザー状態更新
    user.currentDesk = deskNum;
    opponent.currentDesk = deskNum;
    user.recentOpponents.push(opponent.name);
    opponent.recentOpponents.push(user.name);
  });

  socket.on("cancel_find", () => {
    // とくにサーバ側では処理なし
  });

  // ---------- 勝利報告 ----------
  socket.on("report_win_request", () => {
    const user = Object.values(users).find(u => u.socketId === socket.id);
    if (!user || !user.currentDesk) return;

    const desk = desks.find(d => d.deskNum === user.currentDesk);
    if (!desk) return;

    const opponentSocketId = desk.player1SessionId === socket.id ? desk.player2SessionId : desk.player1SessionId;
    const opponent = Object.values(users).find(u => u.socketId === opponentSocketId);

    // 結果登録
    user.history.push({ opponent: opponent.name, result: "WIN" });
    if (opponent) opponent.history.push({ opponent: user.name, result: "LOSE" });

    // 卓削除
    desks = desks.filter(d => d.deskNum !== desk.deskNum);
    delete user.currentDesk;
    if (opponent) delete opponent.currentDesk;

    // 更新通知
    socket.emit("return_to_menu_battle");
    if (opponent) io.to(opponent.socketId).emit("return_to_menu_battle");
    socket.emit("history", user.history);
    if (opponent) io.to(opponent.socketId).emit("history", opponent.history);
  });

  // ---------- 管理者 ----------
  socket.on("admin_login", ({ password }) => {
    if (password === "admin") {
      socket.emit("admin_ok");
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
    const allUsers = Object.values(users);
    const winners = [];

    // 適当に抽選
    const shuffled = allUsers.sort(() => 0.5 - Math.random());
    for (let i = 0; i < Math.min(count, allUsers.length); i++) {
      winners.push({ name: shuffled[i].name });
      io.to(shuffled[i].socketId).emit("lottery_winner", { title });
    }

    const entry = { title, winners, time: Date.now() };
    lotteryHistory.push(entry);

    io.emit("admin_lottery_result", entry);
  });

  // ---------- 切断 ----------
  socket.on("disconnect", () => {
    // 現在卓にいる場合は相手に戻す
    const user = Object.values(users).find(u => u.socketId === socket.id);
    if (user && user.currentDesk) {
      const desk = desks.find(d => d.deskNum === user.currentDesk);
      if (desk) {
        const opponentSocketId = desk.player1SessionId === socket.id ? desk.player2SessionId : desk.player1SessionId;
        const opponent = Object.values(users).find(u => u.socketId === opponentSocketId);
        if (opponent) {
          delete opponent.currentDesk;
          io.to(opponent.socketId).emit("return_to_menu_battle");
        }
        desks = desks.filter(d => d.deskNum !== desk.deskNum);
      }
      delete user.currentDesk;
    }

    // ユーザー削除
    for (const sid in users) {
      if (users[sid].socketId === socket.id) delete users[sid];
    }
  });
});

// ================================
// サーバ起動
// ================================
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🌐 Server running on http://localhost:${PORT}`);
});
