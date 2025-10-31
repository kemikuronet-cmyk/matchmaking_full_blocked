import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 10000;

app.use(express.static(path.join(__dirname, "../client/dist")));
app.use(express.json());

// -----------------------------
// 状態管理
// -----------------------------
let onlineUsers = [];
let matchHistory = [];
let activeMatches = [];
let lotteries = [];
let currentLotteryName = "";
let lastLoginTimes = {};

// 自動ログアウト判定用（12時間）
function isSessionExpired(username) {
  const lastLogin = lastLoginTimes[username];
  if (!lastLogin) return true;
  return (Date.now() - lastLogin) > 12 * 60 * 60 * 1000; // 12時間
}

// -----------------------------
// ユーザー状態取得API
// -----------------------------
app.get("/getUserState/:username", (req, res) => {
  const username = req.params.username;
  const user = onlineUsers.find(u => u.name === username);
  if (user) {
    res.json({
      success: true,
      name: user.name,
      wins: user.wins || 0,
      losses: user.losses || 0,
      matches: user.matches || 0,
      inMatch: user.inMatch || false,
      matchId: user.matchId || null
    });
  } else {
    res.json({ success: false });
  }
});

// -----------------------------
// ソケット通信
// -----------------------------
io.on("connection", (socket) => {

  // ログイン
  socket.on("login", (username, callback) => {
    const existingUser = onlineUsers.find(u => u.name === username);
    if (existingUser && !isSessionExpired(username)) {
      return callback({ success: false, message: "既にログイン中です。" });
    }

    lastLoginTimes[username] = Date.now();
    const user = {
      id: socket.id,
      name: username,
      wins: existingUser?.wins || 0,
      losses: existingUser?.losses || 0,
      matches: existingUser?.matches || 0,
      inMatch: false,
      matchId: null,
      pastOpponents: existingUser?.pastOpponents || []
    };

    onlineUsers = onlineUsers.filter(u => u.name !== username);
    onlineUsers.push(user);
    io.emit("updateUsers", onlineUsers);
    callback({ success: true, user });
  });

  // マッチングリクエスト
  socket.on("findMatch", (username) => {
    const user = onlineUsers.find(u => u.name === username);
    if (!user || user.inMatch) return;

    const opponent = onlineUsers.find(u =>
      !u.inMatch &&
      u.name !== username &&
      !user.pastOpponents.includes(u.name)
    );

    if (opponent) {
      const matchId = uuidv4();
      user.inMatch = opponent.inMatch = true;
      user.matchId = opponent.matchId = matchId;

      user.pastOpponents.push(opponent.name);
      opponent.pastOpponents.push(user.name);

      activeMatches.push({ id: matchId, players: [user.name, opponent.name] });

      io.to(user.id).emit("matchFound", opponent.name);
      io.to(opponent.id).emit("matchFound", user.name);
    } else {
      io.to(user.id).emit("noMatchFound");
    }
  });

  // 勝利報告
  socket.on("reportWin", (username, opponentName) => {
    const winner = onlineUsers.find(u => u.name === username);
    const loser = onlineUsers.find(u => u.name === opponentName);
    if (!winner || !loser) return;

    winner.wins++;
    loser.losses++;
    winner.matches++;
    loser.matches++;

    matchHistory.push({
      id: uuidv4(),
      winner: winner.name,
      loser: loser.name,
      timestamp: new Date().toISOString(),
    });

    winner.inMatch = false;
    loser.inMatch = false;
    winner.matchId = null;
    loser.matchId = null;

    io.emit("updateUsers", onlineUsers);
    io.emit("updateHistory", matchHistory);
  });

  // 抽選設定
  socket.on("setLotteryName", (name) => {
    currentLotteryName = name || `抽選${lotteries.length + 1}`;
    io.emit("lotteryNameUpdated", currentLotteryName);
  });

  // 抽選実行
  socket.on("runLottery", () => {
    const eligible = onlineUsers.filter(
      u => !lotteries.some(lot => lot.winner === u.name)
    );
    if (eligible.length === 0) {
      io.emit("lotteryResult", { success: false, message: "対象者がいません。" });
      return;
    }

    const winner = eligible[Math.floor(Math.random() * eligible.length)];
    lotteries.push({ name: currentLotteryName, winner: winner.name });

    io.emit("lotteryResult", { success: true, name: currentLotteryName, winner: winner.name });
    io.to(winner.id).emit("personalWin", `${currentLotteryName}に当選しました！`);
  });

  // 管理者からの取得要求
  socket.on("adminRequest", () => {
    socket.emit("updateUsers", onlineUsers);
    socket.emit("updateHistory", matchHistory);
  });

  // ログアウト処理
  socket.on("logout", (username) => {
    onlineUsers = onlineUsers.filter(u => u.name !== username);
    io.emit("updateUsers", onlineUsers);
  });

  // 切断
  socket.on("disconnect", () => {
    onlineUsers = onlineUsers.filter(u => u.id !== socket.id);
    io.emit("updateUsers", onlineUsers);
  });
});

// -----------------------------
// フロント配信
// -----------------------------
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist/index.html"));
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
