// ✅ 完全統合版 Server.js（2025/11 修正版）
// 全機能保持＋管理者一覧同期＋再マッチ防止強化版

import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import path from "path";
import fs from "fs";

const app = express();
const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.static(path.resolve("dist")));
app.use(express.json());

// ------------------------------
// 永続データファイル
// ------------------------------
const DATA_FILE = "server_data.json";

// デフォルトデータ構造
const defaultData = {
  users: [],
  matchEnabled: true,
  nextTableNumber: 1,
  totalMatches: 0,
  lastReset: new Date().toISOString().split("T")[0],
};

// データ読み込み
let serverData;
try {
  serverData = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  console.log("✅ server_data.json loaded.");
} catch {
  serverData = { ...defaultData };
  console.log("⚠️ No server_data.json found. Using default.");
}

// データ保存関数
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(serverData, null, 2));
}

// ------------------------------
// 内部状態管理
// ------------------------------
let users = serverData.users || [];
let matchEnabled = serverData.matchEnabled;
let nextTableNumber = serverData.nextTableNumber;
let totalMatches = serverData.totalMatches;
let adminSocket = null;

// ------------------------------
// 自動リセット（毎日0時）
// ------------------------------
setInterval(() => {
  const today = new Date().toISOString().split("T")[0];
  if (serverData.lastReset !== today) {
    console.log("🕛 Daily reset executed.");
    users = [];
    nextTableNumber = 1;
    totalMatches = 0;
    matchEnabled = true;
    serverData = { ...defaultData, lastReset: today };
    saveData();
    io.emit("server_reset");
  }
}, 60 * 1000);

// ------------------------------
// 管理者同期関数
// ------------------------------
function sendUserListTo(target) {
  if (!target) return;
  target.emit(
    "admin_user_list",
    users.map((u) => ({
      name: u.name,
      status: u.status,
      wins: u.wins,
      losses: u.losses,
      table: u.table,
    }))
  );
}

function broadcastActiveMatchesToAdmin() {
  if (!adminSocket) return;
  const activeMatches = users.filter((u) => u.status === "in_match");
  adminSocket.emit("admin_active_matches", activeMatches);
}

// ------------------------------
// Socket.io 通信
// ------------------------------
io.on("connection", (socket) => {
  console.log(`🟢 User connected: ${socket.id}`);

  // --- ユーザーログイン ---
  socket.on("login", ({ name }) => {
    if (!name) return;

    let user = users.find((u) => u.name === name);
    if (!user) {
      user = {
        id: socket.id,
        name,
        status: "idle",
        wins: 0,
        losses: 0,
        table: null,
        recentOpponents: [],
        recentOpponentsNames: [],
        sessionId: socket.id,
      };
      users.push(user);
    } else {
      user.id = socket.id;
      user.status = "idle";
      user.table = null;
      user.sessionId = socket.id;
    }

    socket.emit("login_success", user);
    io.emit("update_user_list", users);
    sendUserListTo(adminSocket);
  });

  // --- 対戦相手を探す ---
  socket.on("find_opponent", () => {
    const user = users.find((u) => u.id === socket.id);
    if (!user || !matchEnabled) return;

    const candidate = users.find(
      (u) =>
        u.id !== user.id &&
        u.status === "searching" &&
        !(user.recentOpponents || []).includes(u.sessionId) &&
        !(u.recentOpponents || []).includes(user.sessionId) &&
        u.name !== user.name &&
        !(user.recentOpponentsNames || []).includes(u.name) &&
        !(u.recentOpponentsNames || []).includes(user.name)
    );

    if (candidate) {
      const table = nextTableNumber++;
      user.status = candidate.status = "in_match";
      user.table = candidate.table = table;
      totalMatches++;
      io.to(user.id).emit("match_found", { opponent: candidate.name, table });
      io.to(candidate.id).emit("match_found", { opponent: user.name, table });
      sendUserListTo(adminSocket);
    } else {
      user.status = "searching";
      socket.emit("searching");
    }

    io.emit("update_user_list", users);
    saveData();
  });

  // --- 勝利報告 ---
  socket.on("report_win", (opponentName) => {
    const reporter = users.find((u) => u.id === socket.id);
    const loser = users.find((u) => u.name === opponentName);
    if (!reporter || !loser) return;

    reporter.wins++;
    loser.losses++;
    reporter.status = loser.status = "idle";
    reporter.table = loser.table = null;

    // 再マッチ防止（ID＋名前）
    reporter.recentOpponents ??= [];
    loser.recentOpponents ??= [];
    reporter.recentOpponentsNames ??= [];
    loser.recentOpponentsNames ??= [];

    if (!reporter.recentOpponents.includes(loser.sessionId))
      reporter.recentOpponents.push(loser.sessionId);
    if (!loser.recentOpponents.includes(reporter.sessionId))
      loser.recentOpponents.push(reporter.sessionId);

    if (!reporter.recentOpponentsNames.includes(loser.name))
      reporter.recentOpponentsNames.push(loser.name);
    if (!loser.recentOpponentsNames.includes(reporter.name))
      loser.recentOpponentsNames.push(reporter.name);

    io.to(reporter.id).emit("win_confirmed");
    io.to(loser.id).emit("lose_confirmed");
    io.emit("update_user_list", users);

    sendUserListTo(adminSocket);
    saveData();
  });

  // --- ログアウト ---
  socket.on("logout", () => {
    users = users.filter((u) => u.id !== socket.id);
    io.emit("update_user_list", users);
    sendUserListTo(adminSocket);
    saveData();
  });

  // --- 管理者ログイン ---
  socket.on("admin_login", ({ password } = {}) => {
    const adminPassword = "admin1234"; // ←必要なら変更可
    if (password === adminPassword) {
      adminSocket = socket;
      socket.emit("admin_ok");
      socket.emit("match_status", { enabled: matchEnabled });
      sendUserListTo(adminSocket);
      broadcastActiveMatchesToAdmin();

      const adminSync = setInterval(() => {
        if (!adminSocket || adminSocket.disconnected) {
          clearInterval(adminSync);
        } else {
          sendUserListTo(adminSocket);
          broadcastActiveMatchesToAdmin();
        }
      }, 3000);
    } else {
      socket.emit("admin_fail");
    }
  });

  // --- 管理者：マッチング有効/無効 ---
  socket.on("toggle_match", () => {
    matchEnabled = !matchEnabled;
    io.emit("match_status", { enabled: matchEnabled });
    sendUserListTo(adminSocket);
    saveData();
  });

  // --- 切断時 ---
  socket.on("disconnect", () => {
    const user = users.find((u) => u.id === socket.id);
    if (user) {
      user.status = "offline";
      io.emit("update_user_list", users);
      sendUserListTo(adminSocket);
      saveData();
    }
    console.log(`🔴 Disconnected: ${socket.id}`);
  });
});

// ------------------------------
// サーバー起動
// ------------------------------
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`✅ Server is running on port ${PORT}`));

// ------------------------------
// Express fallback（Render用）
// ------------------------------
app.get("*", (req, res) => {
  res.sendFile(path.resolve("dist", "index.html"));
});
