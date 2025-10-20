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

// 静的ファイル（環境に合わせてパスを調整してください）
app.use(express.static(path.join(__dirname, "../client/dist")));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist", "index.html"));
});

const server = createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// -----------------
// in-memory state
// -----------------
let users = []; // { id, name, sessionId, status, loginTime, history:[], recentOpponents:[] }
let desks = {}; // deskNum -> { p1, p2, reported }
let matchEnabled = false;
let adminSocket = null;
let adminPassword = "admin1234";
let autoLogoutHours = 12;
let lotteryHistory = []; // { title, winners: [{id, sessionId, name}] }
let currentLotteryTitle = "";

// -----------------
// helpers
// -----------------
const now = () => new Date().toISOString();

// 最小の空き正整数デスク番号を返す（1,2,3,... 再利用可能）
function assignDeskSequential() {
  let i = 1;
  while (desks[i]) i++;
  return i;
}

const findUserBySocket = (socketId) => users.find((u) => u.id === socketId);
const findUserBySession = (sessionId) => users.find((u) => u.sessionId === sessionId);

// 管理者へユーザーリスト送信（adminSocket があればそちらに、かつ要求元 socket にも返す）
function sendUserListTo(socket = null) {
  const payload = users.map((u) => ({
    id: u.id,
    name: u.name,
    sessionId: u.sessionId,
    status: u.status,
    loginTime: u.loginTime,
    history: u.history || [],
  }));
  // 要求元へ
  if (socket && typeof socket.emit === "function") socket.emit("admin_user_list", payload);
  // 管理者に常に最新を送る（あるなら）
  if (adminSocket && adminSocket.id !== socket?.id) adminSocket.emit("admin_user_list", payload);
}

// 管理者へ対戦中リストを送信（adminSocket が存在すれば）
function broadcastActiveMatchesToAdmin() {
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
  if (adminSocket) adminSocket.emit("admin_active_matches", active);
}

// lotteryHistory をクライアント表示用に整形
function formatLotteryForClient(hist = []) {
  return hist.map((e) => ({
    title: e.title,
    winners: (Array.isArray(e.winners) ? e.winners : []).map((w) => ({ name: w.name })),
  }));
}

// 抽選履歴にいる sessionId をすべて列挙
function allLotteryWinnerSessionIds() {
  return lotteryHistory.flatMap((e) => (Array.isArray(e.winners) ? e.winners.map((w) => w.sessionId) : []));
}

// -----------------
// socket.io handlers
// -----------------
io.on("connection", (socket) => {
  console.log("✅ Connected:", socket.id);

  // --- login ---
  // クライアントは { name, sessionId? } を送る
  socket.on("login", ({ name, sessionId } = {}) => {
    if (!name || !name.trim()) return;
    // sessionId が渡されていれば優先して既存ユーザーを復元（ページ更新ケース）
    let user = null;
    if (sessionId) user = findUserBySession(sessionId);
    // sessionId で見つからなければ名前で検索（後方互換）
    if (!user) user = users.find((u) => u.name === name);

    if (user) {
      // 再接続または既存ユーザーの socket 更新
      user.id = socket.id;
      user.sessionId = sessionId || user.sessionId || socket.id;
      user.status = user.status === "in_battle" ? user.status : "idle";
      user.loginTime = user.loginTime || now();
      user.history = user.history || [];
      user.recentOpponents = user.recentOpponents || [];
    } else {
      user = {
        id: socket.id,
        name,
        sessionId: sessionId || socket.id,
        status: "idle",
        loginTime: now(),
        history: [],
        recentOpponents: [],
      };
      users.push(user);
    }

    // 返却するオブジェクトはクライアント既存ハンドラに合わせる
    socket.emit("login_ok", {
      ...user,
      lotteryList: formatLotteryForClient(lotteryHistory),
    });

    // admin 側へ更新（要求元にも返す）
    sendUserListTo(socket);
    broadcastActiveMatchesToAdmin();
  });

  // --- logout ---
  socket.on("logout", () => {
    users = users.filter((u) => u.id !== socket.id);
    sendUserListTo();
    broadcastActiveMatchesToAdmin();
  });

  // --- find opponent ---
  socket.on("find_opponent", () => {
    const user = findUserBySocket(socket.id);
    if (!user || !matchEnabled) return;
    user.status = "searching";

    // 候補フィルタ：idle/searching、かつ recentOpponents に含まれない
    const candidate = users.find(
      (u) =>
        u.id !== user.id &&
        u.status === "searching" &&
        !(user.recentOpponents || []).includes(u.sessionId) &&
        !(u.recentOpponents || []).includes(user.sessionId)
    );

    if (candidate) {
      // マッチ確定
      const deskNum = assignDeskSequential();
      desks[deskNum] = { p1: user, p2: candidate, reported: null };
      user.status = "in_battle";
      candidate.status = "in_battle";

      // recentOpponents に追加（再マッチ防止）
      user.recentOpponents = user.recentOpponents || [];
      candidate.recentOpponents = candidate.recentOpponents || [];
      if (!user.recentOpponents.includes(candidate.sessionId)) user.recentOpponents.push(candidate.sessionId);
      if (!candidate.recentOpponents.includes(user.sessionId)) candidate.recentOpponents.push(user.sessionId);

      io.to(user.id).emit("matched", { opponent: { id: candidate.id, name: candidate.name }, deskNum });
      io.to(candidate.id).emit("matched", { opponent: { id: user.id, name: user.name }, deskNum });

      broadcastActiveMatchesToAdmin();
    }
    sendUserListTo();
  });

  socket.on("cancel_find", () => {
    const user = findUserBySocket(socket.id);
    if (user) user.status = "idle";
    sendUserListTo();
  });

  // --- report win request (二段階確認) ---
  socket.on("report_win_request", () => {
    const user = findUserBySocket(socket.id);
    if (!user) return;

    const deskNum = Object.keys(desks).find((d) => {
      const m = desks[d];
      return m && (m.p1.id === socket.id || m.p2.id === socket.id);
    });
    if (!deskNum) return;

    const match = desks[deskNum];
    const opponent = match.p1.id === socket.id ? match.p2 : match.p1;
    match.reported = user.id;

    // 敗者側に確認を促す（client の既存処理に合わせる）
    io.to(opponent.id).emit("confirm_opponent_win", { deskNum, winnerName: user.name });
  });

  // --- opponent confirms (受け側が accepted を送る) ---
  socket.on("opponent_win_confirmed", ({ accepted } = {}) => {
    const confirmer = findUserBySocket(socket.id);
    if (!confirmer) return;

    const deskNum = Object.keys(desks).find((d) => {
      const m = desks[d];
      return m && (m.p1.id === socket.id || m.p2.id === socket.id);
    });
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

    // 勝敗を反映し履歴を即送信
    reporter.history = reporter.history || [];
    loser.history = loser.history || [];
    const nowStamp = now();
    reporter.history.push({ opponent: loser.name, result: "WIN", endTime: nowStamp });
    loser.history.push({ opponent: reporter.name, result: "LOSE", endTime: nowStamp });

    io.to(reporter.id).emit("history", reporter.history);
    io.to(loser.id).emit("history", loser.history);

    io.to(reporter.id).emit("return_to_menu_battle");
    io.to(loser.id).emit("return_to_menu_battle");

    // マッチ終了 → デスク削除、admin 更新
    delete desks[deskNum];
    broadcastActiveMatchesToAdmin();
    sendUserListTo();
  });

  // --- admin login ---
  socket.on("admin_login", ({ password } = {}) => {
    if (password === adminPassword) {
      adminSocket = socket;
      socket.emit("admin_ok");
      // 管理者に必要な初期情報を送る
      socket.emit("match_status", { enabled: matchEnabled });
      socket.emit("admin_current_auto_logout", { hours: autoLogoutHours });
      socket.emit("admin_lottery_history", formatLotteryForClient(lotteryHistory));
      // ユーザー一覧 / active matches も送付
      sendUserListTo(socket);
      broadcastActiveMatchesToAdmin();
    } else {
      socket.emit("admin_fail");
    }
  });

  // --- admin_view_users: 要求元に返す（client が頻繁に呼ぶため） ---
  socket.on("admin_view_users", () => sendUserListTo(socket));

  socket.on("admin_toggle_match", ({ enable } = {}) => {
    matchEnabled = !!enable;
    io.emit("match_status", { enabled: matchEnabled });
  });

  // --- admin manual report win ---
  socket.on("admin_report_win", ({ winnerSessionId, deskNum } = {}) => {
    const match = desks[deskNum];
    if (!match) return;

    const winner = match.p1.sessionId === winnerSessionId ? match.p1 : match.p2;
    const loser = match.p1.sessionId === winnerSessionId ? match.p2 : match.p1;

    winner.history = winner.history || [];
    loser.history = loser.history || [];
    const nowStamp = now();
    winner.history.push({ opponent: loser.name, result: "WIN", endTime: nowStamp });
    loser.history.push({ opponent: winner.name, result: "LOSE", endTime: nowStamp });

    io.to(winner.id).emit("history", winner.history);
    io.to(loser.id).emit("history", loser.history);
    io.to(winner.id).emit("return_to_menu_battle");
    io.to(loser.id).emit("return_to_menu_battle");

    delete desks[deskNum];
    broadcastActiveMatchesToAdmin();
    sendUserListTo();
  });

  socket.on("admin_report_both_lose", ({ deskNum } = {}) => {
    const match = desks[deskNum];
    if (!match) return;
    const { p1, p2 } = match;
    p1.history = p1.history || [];
    p2.history = p2.history || [];
    const nowStamp = now();
    p1.history.push({ opponent: p2.name, result: "LOSE", endTime: nowStamp });
    p2.history.push({ opponent: p1.name, result: "LOSE", endTime: nowStamp });

    io.to(p1.id).emit("history", p1.history);
    io.to(p2.id).emit("history", p2.history);
    io.to(p1.id).emit("return_to_menu_battle");
    io.to(p2.id).emit("return_to_menu_battle");

    delete desks[deskNum];
    broadcastActiveMatchesToAdmin();
    sendUserListTo();
  });

  // --- admin_set_lottery_title ---
  socket.on("admin_set_lottery_title", ({ title } = {}) => {
    if (typeof title === "string" && title.trim()) {
      currentLotteryTitle = title.trim();
      socket.emit("admin_set_lottery_title_ok", { title: currentLotteryTitle });
    }
  });

  // --- admin_draw_lots ---
  socket.on("admin_draw_lots", ({ count = 1, minBattles = 0, minLoginMinutes = 0, title } = {}) => {
    const finalTitle = (typeof title === "string" && title.trim()) ? title.trim() : (currentLotteryTitle || `抽選${lotteryHistory.length + 1}`);

    // 既に当選歴にある sessionId は除外（重複当選禁止）
    const excludedSessionIds = new Set(allLotteryWinnerSessionIds());

    const eligible = users.filter((u) => {
      const battles = u.history?.length || 0;
      const loginMinutes = (Date.now() - new Date(u.loginTime).getTime()) / 60000;
      return battles >= minBattles && loginMinutes >= minLoginMinutes && !excludedSessionIds.has(u.sessionId);
    });

    if (eligible.length === 0) {
      socket.emit("admin_draw_result", { winners: [], title: finalTitle });
      return;
    }

    const shuffled = eligible.sort(() => Math.random() - 0.5);
    const winners = shuffled.slice(0, Math.min(count, shuffled.length));

    const winnersForHistory = winners.map((w) => ({ id: w.id, sessionId: w.sessionId, name: w.name }));
    const entry = { title: finalTitle, winners: winnersForHistory };
    lotteryHistory.push(entry);

    // 管理者へ結果（互換のため name の配列風に）
    socket.emit("admin_draw_result", { winners: winnersForHistory.map(w => ({ name: w.name })), title: finalTitle });

    // 当選者へ通知（クライアントは "lottery_winner" をリッスン）
    winners.forEach((w) => {
      io.to(w.id).emit("lottery_winner", { title: finalTitle });
    });

    // 全体に更新リストを配信
    io.emit("update_lottery_list", { list: formatLotteryForClient(lotteryHistory) });
    if (adminSocket) adminSocket.emit("admin_lottery_history", formatLotteryForClient(lotteryHistory));
  });

  socket.on("admin_get_lottery_history", () => {
    socket.emit("admin_lottery_history", formatLotteryForClient(lotteryHistory));
  });

  socket.on("admin_delete_lottery_history", ({ title } = {}) => {
    lotteryHistory = lotteryHistory.filter((l) => l.title !== title);
    if (adminSocket) adminSocket.emit("admin_lottery_history", formatLotteryForClient(lotteryHistory));
    io.emit("update_lottery_list", { list: formatLotteryForClient(lotteryHistory) });
  });

  socket.on("admin_clear_lottery_history", () => {
    lotteryHistory = [];
    if (adminSocket) adminSocket.emit("admin_lottery_history", formatLotteryForClient(lotteryHistory));
    io.emit("update_lottery_list", { list: formatLotteryForClient(lotteryHistory) });
  });

  // --- auto logout ---
  socket.on("admin_set_auto_logout", ({ hours } = {}) => {
    if (typeof hours === "number" && hours > 0) {
      autoLogoutHours = hours;
      socket.emit("admin_set_auto_logout_ok", { hours });
    }
  });

  socket.on("admin_get_auto_logout", () => {
    socket.emit("admin_current_auto_logout", { hours: autoLogoutHours });
  });

  // --- admin logout user / all ---
  socket.on("admin_logout_user", ({ userId } = {}) => {
    const target = users.find((u) => u.id === userId);
    if (target) io.to(userId).emit("force_logout", { reason: "admin" });
    users = users.filter((u) => u.id !== userId);
    sendUserListTo();
  });

  socket.on("admin_logout_all", () => {
    users.forEach((u) => io.to(u.id).emit("force_logout", { reason: "admin" }));
    users = [];
    sendUserListTo();
  });

  // --- disconnect ---
  socket.on("disconnect", () => {
    users = users.filter((u) => u.id !== socket.id);
    // マッチ中の desk をクリーン
    Object.keys(desks).forEach((d) => {
      const match = desks[d];
      if (match && (match.p1.id === socket.id || match.p2.id === socket.id)) delete desks[d];
    });
    if (adminSocket && adminSocket.id === socket.id) adminSocket = null;
    broadcastActiveMatchesToAdmin();
    sendUserListTo();
  });
});

// -----------------
// server start
// -----------------
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
