// Server.js — ES Modules対応版
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// __dirname の代替
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// distフォルダ参照（Viteビルド）
const distPathOptions = [
  path.join(__dirname, "../dist"),
  path.join(__dirname, "./dist"),
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

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// 静的ファイル配信（Viteビルド）
app.use(express.static(distPath));
app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));

// -------------------------
// マッチング & 抽選ロジック
// -------------------------
let users = [];
let desks = [];
let lotteryHistory = [];
let matchEnabled = false;

// Socket.io 接続
io.on("connection", (socket) => {
  console.log("✅ Client connected:", socket.id);

  // ログイン
  socket.on("login", (data) => {
    const existing = users.find((u) => u.sessionId === data.sessionId);
    if (existing) {
      existing.socketId = socket.id;
      existing.name = data.name;
    } else {
      users.push({ ...data, socketId: socket.id });
    }

    socket.emit("login_ok", {
      name: data.name,
      id: socket.id,
      sessionId: data.sessionId,
      history: data.history || [],
      deskNum: null,
      opponent: null,
      matchEnabled,
    });
  });

  // マッチング開始
  socket.on("find_opponent", () => {
    if (!matchEnabled) return;
    const user = users.find((u) => u.socketId === socket.id);
    if (!user || desks.some((d) => d.player1 === user.name || d.player2 === user.name)) return;

    const waiting = users.find(
      (u) =>
        u.socketId !== socket.id &&
        !desks.some((d) => d.player1 === u.name || d.player2 === u.name)
    );

    if (waiting) {
      const deskNum = desks.length > 0 ? Math.max(...desks.map((d) => d.deskNum)) + 1 : 1;
      const desk = {
        deskNum,
        player1: user.name,
        player1SessionId: user.sessionId,
        player2: waiting.name,
        player2SessionId: waiting.sessionId,
      };
      desks.push(desk);

      // 対戦開始通知
      [user.socketId, waiting.socketId].forEach((sid) => {
        io.to(sid).emit("matched", { opponent: sid === user.socketId ? waiting : user, deskNum });
      });
    }
  });

  socket.on("cancel_find", () => {});

  // 勝利報告
  socket.on("report_win_request", () => {
    const user = users.find((u) => u.socketId === socket.id);
    const desk = desks.find(
      (d) => d.player1SessionId === user.sessionId || d.player2SessionId === user.sessionId
    );
    if (!desk) return;

    // 卓を削除して両者に return
    desks = desks.filter((d) => d !== desk);

    [desk.player1SessionId, desk.player2SessionId].forEach((sid) => {
      const u = users.find((u) => u.sessionId === sid);
      if (!u) return;
      io.to(u.socketId).emit("return_to_menu_battle");
      if (!u.history) u.history = [];
      u.history.push({
        opponent: sid === desk.player1SessionId ? desk.player2 : desk.player1,
        result: sid === desk.player1SessionId ? "WIN" : "LOSE",
      });
    });
  });

  // 管理者ログイン
  socket.on("admin_login", ({ password }) => {
    if (password === "admin") {
      socket.emit("admin_ok");
      io.to(socket.id).emit("match_status_update", { enabled: matchEnabled, status: matchEnabled ? "マッチング中" : "停止中" });
      io.to(socket.id).emit("admin_lottery_history", lotteryHistory);
      io.to(socket.id).emit("admin_active_matches", desks);
    } else {
      socket.emit("admin_fail");
    }
  });

  socket.on("admin_enable_matching", () => {
    matchEnabled = true;
    io.emit("match_status_update", { enabled: true, status: "マッチング中" });
  });

  socket.on("admin_disable_matching", () => {
    matchEnabled = false;
    io.emit("match_status_update", { enabled: false, status: "停止中" });
  });

  socket.on("admin_run_lottery", ({ title, count }) => {
    const shuffled = [...users].sort(() => 0.5 - Math.random());
    const winners = shuffled.slice(0, count).map((u) => ({ name: u.name }));
    const record = { title, winners, time: Date.now() };
    lotteryHistory.push(record);
    io.emit("admin_lottery_result", record);
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
  });
});

// -------------------------
// サーバー起動
// -------------------------
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
