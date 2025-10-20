// server/server.js
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

// React ビルド出力のパス（環境に合わせて修正してください）
app.use(express.static(path.join(__dirname, "../client/dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist", "index.html"));
});

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- メモリ管理 ---
let users = []; // { id, name, sessionId, status, loginTime, history }
let desks = {}; // deskNum -> { p1, p2, reported }
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234";
let autoLogoutHours = 12;
let lotteryHistory = [];
let currentLotteryTitle = "";

// --- ユーティリティ ---
const now = () => new Date().toISOString();

// 最小の空き正整数を返す (1,2,3,... 再利用可能)
function assignDeskSequential() {
  let i = 1;
  while (desks[i]) i++;
  return i;
}

const findUserBySocket = (socketId) => users.find((u) => u.id === socketId);

// admin にユーザー一覧を送る（adminSocket が接続していれば）
const updateAdminUserList = () => {
  if (!adminSocket) return;
  const payload = users.map((u) => ({
    id: u.id,
    name: u.name,
    sessionId: u.sessionId,
    status: u.status,
    loginTime: u.loginTime,
    history: u.history || [],
  }));
  adminSocket.emit("admin_user_list", payload);
};

// 管理者へ対戦中リストを送信
const broadcastActiveMatches = () => {
  if (!adminSocket) return;
  const active = Object.keys(desks).map((deskNum) => {
    const d = desks[deskNum];
    return {
      deskNum,
      player1: d.p1?.name || "不明",
      player2: d.p2?.name || "不明",
      player1SessionId: d.p1?.sessionId,
      player2SessionId: d.p2?.sessionId,
    };
  });
  adminSocket.emit("admin_active_matches", active);
};

// クライアント向けに lotteryHistory を整形（winners は {name} を期待）
const formatLotteryForClient = (hist) =>
  hist.map((e) => ({
    title: e.title,
    winners: (Array.isArray(e.winners) ? e.winners : []).map((w) => ({ name: w.name })),
  }));

// --- Socket.io ---
io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  // --- ユーザーログイン ---
  socket.on("login", ({ name, sessionId }) => {
    if (!name) return;
    let existing = users.find((u) => u.name === name);
    if (existing) {
      existing.id = socket.id;
      existing.sessionId = sessionId || existing.sessionId;
      existing.status = "idle";
      existing.loginTime = now();
    } else {
      existing = {
        id: socket.id,
        name,
        sessionId: sessionId || socket.id,
        status: "idle",
        loginTime: now(),
        history: [],
      };
      users.push(existing);
    }

    // ログイン成功を返す（クライアントの既存 login_ok ハンドラと互換）
    socket.emit("login_ok", {
      ...existing,
      lotteryList: formatLotteryForClient(lotteryHistory),
    });

    updateAdminUserList();
  });

  // --- ログアウト ---
  socket.on("logout", () => {
    users = users.filter((u) => u.id !== socket.id);
    updateAdminUserList();
  });

  // --- 対戦検索・マッチング ---
  socket.on("find_opponent", () => {
    const user = findUserBySocket(socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";

    const opponent = users.find((u) => u.status === "searching" && u.id !== socket.id);
    if (opponent) {
      const deskNum = assignDeskSequential();
      desks[deskNum] = { p1: user, p2: opponent, reported: null };
      user.status = "in_battle";
      opponent.status = "in_battle";

      // 送る opponent オブジェクトは既存クライアントの受け取りに合わせる（id,name）
      io.to(user.id).emit("matched", { opponent: { id: opponent.id, name: opponent.name }, deskNum });
      io.to(opponent.id).emit("matched", { opponent: { id: user.id, name: user.name }, deskNum });

      broadcastActiveMatches();
    }
    updateAdminUserList();
  });

  socket.on("cancel_find", () => {
    const user = findUserBySocket(socket.id);
    if (user) user.status = "idle";
    updateAdminUserList();
  });

  // --- 勝利報告（ダブルチェック） ---
  socket.on("report_win_request", () => {
    const user = findUserBySocket(socket.id);
    if (!user) return;
    const deskNum = Object.keys(desks).find((d) => desks[d].p1?.id === socket.id || desks[d].p2?.id === socket.id);
    if (!deskNum) return;
    const match = desks[deskNum];
    const opponent = match.p1.id === socket.id ? match.p2 : match.p1;

    match.reported = user.id;
    io.to(opponent.id).emit("confirm_opponent_win", { deskNum, winnerName: user.name });
  });

  // クライアントは { accepted } を送る
  socket.on("opponent_win_confirmed", ({ accepted }) => {
    const confirmer = findUserBySocket(socket.id);
    if (!confirmer) return;
    const deskNum = Object.keys(desks).find((d) => desks[d].p1?.id === socket.id || desks[d].p2?.id === socket.id);
    if (!deskNum) return;
    const match = desks[deskNum];
    if (!match || !match.reported) return;

    const reporter = match.p1.id === match.reported ? match.p1 : match.p2;
    const loser = match.p1.id === match.reported ? match.p2 : match.p1;

    if (!accepted) {
      // キャンセル
      io.to(reporter.id).emit("win_report_cancelled");
      io.to(loser.id).emit("win_report_cancelled");
      match.reported = null;
      return;
    }

    // 勝敗確定 → 履歴を更新して双方に送信
    const entryWin = { opponent: loser.name, result: "WIN", endTime: now() };
    const entryLose = { opponent: reporter.name, result: "LOSE", endTime: now() };

    reporter.history = reporter.history || [];
    loser.history = loser.history || [];
    reporter.history.push(entryWin);
    loser.history.push(entryLose);

    io.to(reporter.id).emit("history", reporter.history);
    io.to(loser.id).emit("history", loser.history);

    io.to(reporter.id).emit("return_to_menu_battle");
    io.to(loser.id).emit("return_to_menu_battle");

    // マッチを削除して admin に通知
    delete desks[deskNum];
    broadcastActiveMatches();
    updateAdminUserList();
  });

  // --- 管理者ログイン ---
  socket.on("admin_login", ({ password }) => {
    if (password === adminPassword) {
      adminSocket = socket;
      socket.emit("admin_ok");
      updateAdminUserList();
      socket.emit("match_status", { enabled: matchEnabled });
      socket.emit("admin_current_auto_logout", { hours: autoLogoutHours });
      socket.emit("admin_lottery_history", formatLotteryForClient(lotteryHistory));
      broadcastActiveMatches();
    } else {
      socket.emit("admin_fail");
    }
  });

  socket.on("admin_view_users", () => updateAdminUserList());

  socket.on("admin_toggle_match", ({ enable }) => {
    matchEnabled = enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  // --- 管理者による勝利登録（手動） ---
  socket.on("admin_report_win", ({ winnerSessionId, deskNum }) => {
    const match = desks[deskNum];
    if (!match) return;
    const winner = match.p1.sessionId === winnerSessionId ? match.p1 : match.p2;
    const loser = match.p1.sessionId === winnerSessionId ? match.p2 : match.p1;

    winner.history = winner.history || [];
    loser.history = loser.history || [];
    winner.history.push({ opponent: loser.name, result: "WIN", endTime: now() });
    loser.history.push({ opponent: winner.name, result: "LOSE", endTime: now() });

    io.to(winner.id).emit("history", winner.history);
    io.to(loser.id).emit("history", loser.history);

    io.to(winner.id).emit("return_to_menu_battle");
    io.to(loser.id).emit("return_to_menu_battle");

    delete desks[deskNum];
    broadcastActiveMatches();
    updateAdminUserList();
  });

  socket.on("admin_report_both_lose", ({ deskNum }) => {
    const match = desks[deskNum];
    if (!match) return;
    const { p1, p2 } = match;
    p1.history = p1.history || [];
    p2.history = p2.history || [];
    p1.history.push({ opponent: p2.name, result: "LOSE", endTime: now() });
    p2.history.push({ opponent: p1.name, result: "LOSE", endTime: now() });

    io.to(p1.id).emit("history", p1.history);
    io.to(p2.id).emit("history", p2.history);

    io.to(p1.id).emit("return_to_menu_battle");
    io.to(p2.id).emit("return_to_menu_battle");

    delete desks[deskNum];
    broadcastActiveMatches();
    updateAdminUserList();
  });

  // --- 抽選名を設定（管理者ボタンから送られる） ---
  socket.on("admin_set_lottery_title", ({ title }) => {
    if (typeof title === "string" && title.trim()) {
      currentLotteryTitle = title.trim();
      socket.emit("admin_set_lottery_title_ok", { title: currentLotteryTitle });
    }
  });

  // --- 抽選（管理者トリガー） ---
  // 既存クライアントとの互換のため、title が渡される場合は優先、なければ currentLotteryTitle を使う
  socket.on("admin_draw_lots", ({ count = 1, minBattles = 0, minLoginMinutes = 0, title } = {}) => {
    const finalTitle = title && title.trim() ? title.trim() : (currentLotteryTitle || `抽選${lotteryHistory.length + 1}`);

    const eligible = users.filter((u) => {
      const battles = u.history?.length || 0;
      const loginMinutes = (Date.now() - new Date(u.loginTime).getTime()) / 60000;
      return battles >= minBattles && loginMinutes >= minLoginMinutes;
    });

    if (eligible.length === 0) {
      socket.emit("admin_draw_result", { winners: [], title: finalTitle });
      return;
    }

    const shuffled = eligible.sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, Math.min(count, shuffled.length));
    // winners を保存する際は { id, sessionId, name } の形で保存（クライアントは w.name を参照）
    const winnersForHistory = winners.map((w) => ({ id: w.id, sessionId: w.sessionId, name: w.name }));
    const entry = { title: finalTitle, winners: winnersForHistory };
    lotteryHistory.push(entry);

    // 管理者にドロー結果（表示用の winners は {name} 配列）
    socket.emit("admin_draw_result", { winners: winnersForHistory.map(w => ({ name: w.name })), title: finalTitle });

    // 当選者へ通知（クライアントは "lottery_winner" をリッスンしているので互換を保つ）
    winners.forEach((w) => {
      io.to(w.id).emit("lottery_winner", { title: finalTitle });
    });

    // 全体に更新リストを配信（クライアントは update_lottery_list を期待）
    io.emit("update_lottery_list", { list: formatLotteryForClient(lotteryHistory) });
    // 管理画面の履歴も更新
    if (adminSocket) adminSocket.emit("admin_lottery_history", formatLotteryForClient(lotteryHistory));
  });

  socket.on("admin_get_lottery_history", () => {
    socket.emit("admin_lottery_history", formatLotteryForClient(lotteryHistory));
  });

  socket.on("admin_delete_lottery_history", ({ title }) => {
    lotteryHistory = lotteryHistory.filter((l) => l.title !== title);
    if (adminSocket) adminSocket.emit("admin_lottery_history", formatLotteryForClient(lotteryHistory));
    io.emit("update_lottery_list", { list: formatLotteryForClient(lotteryHistory) });
  });

  socket.on("admin_clear_lottery_history", () => {
    lotteryHistory = [];
    if (adminSocket) adminSocket.emit("admin_lottery_history", formatLotteryForClient(lotteryHistory));
    io.emit("update_lottery_list", { list: formatLotteryForClient(lotteryHistory) });
  });

  // --- 自動ログアウト設定 ---
  socket.on("admin_set_auto_logout", ({ hours }) => {
    if (typeof hours === "number" && hours > 0) {
      autoLogoutHours = hours;
      socket.emit("admin_set_auto_logout_ok", { hours });
    }
  });

  socket.on("admin_get_auto_logout", () => {
    socket.emit("admin_current_auto_logout", { hours: autoLogoutHours });
  });

  // --- 管理者による強制ログアウト ---
  socket.on("admin_logout_user", ({ userId }) => {
    const target = users.find((u) => u.id === userId);
    if (target) io.to(userId).emit("force_logout", { reason: "admin" });
    users = users.filter((u) => u.id !== userId);
    updateAdminUserList();
  });

  socket.on("admin_logout_all", () => {
    users.forEach((u) => io.to(u.id).emit("force_logout", { reason: "admin" }));
    users = [];
    updateAdminUserList();
  });

  // --- 切断処理 ---
  socket.on("disconnect", () => {
    users = users.filter((u) => u.id !== socket.id);
    Object.keys(desks).forEach((d) => {
      const match = desks[d];
      if (match && (match.p1.id === socket.id || match.p2.id === socket.id)) {
        delete desks[d];
      }
    });
    broadcastActiveMatches();
    updateAdminUserList();
    if (adminSocket && adminSocket.id === socket.id) adminSocket = null;
  });
});

// --- サーバ起動 ---
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
