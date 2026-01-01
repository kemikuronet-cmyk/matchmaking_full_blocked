// client/src/App.jsx
import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

// サーバ接続先
const SERVER_URL =
  process.env.NODE_ENV === "production"
    ? window.location.origin
    : (import.meta.env.VITE_SERVER_URL || "http://localhost:4000");

console.log("🔌 Connecting to", SERVER_URL);

const socket = io(SERVER_URL, {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  transports: ["websocket", "polling"],
});

const HEARTBEAT_INTERVAL = 5 * 60 * 1000;

function App() {
  // -------------------------
  // 状態
  // -------------------------
  const [loggedIn, setLoggedIn] = useState(false);
  const [name, setName] = useState("");
  const [user, setUser] = useState(null);
  const [searching, setSearching] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState(null);
  const [history, setHistory] = useState([]);

  const [lotteryList, setLotteryList] = useState([]);
  const [lotteryTitle, setLotteryTitle] = useState("");
  const [drawResult, setDrawResult] = useState([]);
  const [lotteryWinnerTitles, setLotteryWinnerTitles] = useState([]);
  const [showLottery, setShowLottery] = useState(false);
  const [lotteryHistory, setLotteryHistory] = useState([]);

  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [usersList, setUsersList] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(false);
  const [drawCount, setDrawCount] = useState(1);
  const [minMatches, setMinMatches] = useState(0);
  const [minLoginHours, setMinLoginHours] = useState(0);
  const [autoLogoutHours, setAutoLogoutHours] = useState(12);
  const [activeMatches, setActiveMatches] = useState([]);

  const loginAttempted = useRef(false);
  const heartbeatTimer = useRef(null);
  const reconnectIntervalRef = useRef(null);

  // -------------------------
  // sessionId を localStorage に保存（初回）
  // -------------------------
  useEffect(() => {
    let sid = localStorage.getItem("sessionId");
    if (!sid) {
      try {
        sid =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `sess-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      } catch {
        sid = `sess-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      }
      localStorage.setItem("sessionId", sid);
    }
  }, []);

  // -------------------------
  // visibilitychange: 復帰時に再接続 & 自動ログイン
  // -------------------------
  useEffect(() => {
    const tryReconnectAndRelogin = () => {
      if (socket && !socket.connected) socket.connect();

      const savedUserStr = localStorage.getItem("user");
      const sid = localStorage.getItem("sessionId");
      if (savedUserStr) {
        try {
          const savedUser = JSON.parse(savedUserStr);
          if (savedUser?.name && sid)
            socket.emit("login", { name: savedUser.name, sessionId: sid });
        } catch {}
      }

      const savedAdmin = localStorage.getItem("adminMode");
      if (savedAdmin === "true") {
        socket.emit("admin_view_users");
        socket.emit("admin_get_auto_logout");
        socket.emit("admin_get_lottery_history");
        socket.emit("admin_get_active_matches");
      }

      if (sid && socket && socket.connected)
        socket.emit("heartbeat", { sessionId: sid });
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") tryReconnectAndRelogin();
    };
    document.addEventListener("visibilitychange", onVisibility);
    tryReconnectAndRelogin();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // -------------------------
  // 初期復元 & socket 登録
  // -------------------------
  useEffect(() => {
    if (!loginAttempted.current) {
      const savedUser = localStorage.getItem("user");
      const savedAdmin = localStorage.getItem("adminMode");
      const savedTitles = localStorage.getItem("lotteryWinnerTitles");
      const savedHistory = localStorage.getItem("history");
      const savedLotteryHistory = localStorage.getItem("lotteryHistory");
      const savedLotteryList = localStorage.getItem("lotteryList");

      if (savedTitles) try { setLotteryWinnerTitles(JSON.parse(savedTitles)); } catch {}
      if (savedHistory) try { setHistory(JSON.parse(savedHistory)); } catch {}
      if (savedLotteryHistory) try { setLotteryHistory(JSON.parse(savedLotteryHistory)); } catch {}
      if (savedLotteryList) try { setLotteryList(JSON.parse(savedLotteryList)); } catch {}

      if (savedUser) {
        try {
          const u = JSON.parse(savedUser);
          setUser(u);
          setLoggedIn(true);
          setName(u.name);
          const sid = u.sessionId || localStorage.getItem("sessionId");
          if (sid) socket.emit("login", { name: u.name, sessionId: sid });
        } catch {}
      }

      if (savedAdmin === "true") setAdminMode(true);
      loginAttempted.current = true;
    }

    // -------------------------
    // socket.on イベント登録
    // -------------------------
    const onLoginOk = (u) => {
      const localHist = (() => { try { return JSON.parse(localStorage.getItem("history") || "[]"); } catch { return []; } })();
      const serverHist = Array.isArray(u.history) ? u.history : [];
      const finalHistory = serverHist.length >= localHist.length ? serverHist : localHist;

      setUser(u);
      setLoggedIn(true);
      setName(u.name);
      setSearching(u.status === "searching");
      setHistory(finalHistory);
      setLotteryList(Array.isArray(u.lotteryList) ? u.lotteryList : prev => prev);
      setLotteryTitle("");
      try { localStorage.setItem("user", JSON.stringify(u)); } catch {}
      try { localStorage.setItem("history", JSON.stringify(finalHistory)); } catch {}
      if (u.currentOpponent) {
        setOpponent(u.currentOpponent);
        setDeskNum(u.deskNum);
      } else {
        setOpponent(null);
        setDeskNum(null);
      }
    };

    // … (ここからハンドラ続く: onMatched, onReturnToMenu, onConfirmOpponentWin, onWinReportCancelled, onForceLogout …)
    // -------------------------
    // マッチング完了
    // -------------------------
    const onMatched = ({ opponent: opp, deskNum }) => {
      setOpponent(opp);
      setDeskNum(deskNum);
      setSearching(false);
    };

    // -------------------------
    // 勝利報告後にメニューへ戻る
    // -------------------------
    const onReturnToMenu = () => {
      setOpponent(null);
      setDeskNum(null);
      setSearching(false);
    };

    // -------------------------
    // 対戦相手の勝利確認
    // -------------------------
    const onConfirmOpponentWin = ({ deskNum, winnerName }) => {
      if (window.confirm(`${winnerName} さんがあなたに勝利報告しました。\n承認しますか？`)) {
        socket.emit("opponent_win_confirmed", { accepted: true });
      } else {
        socket.emit("opponent_win_confirmed", { accepted: false });
      }
    };

    // -------------------------
    // 勝利報告キャンセル
    // -------------------------
    const onWinReportCancelled = () => {
      alert("勝利報告がキャンセルされました。");
      setDeskNum(null);
      setOpponent(null);
    };

    // -------------------------
    // 強制ログアウト
    // -------------------------
    const onForceLogout = ({ sessionId, name }) => {
      alert(`${name} さんが強制ログアウトされました。`);
      if (user?.sessionId === sessionId) {
        setLoggedIn(false);
        setUser(null);
        setOpponent(null);
        setDeskNum(null);
        localStorage.removeItem("user");
      }
    };

    // -------------------------
    // 抽選更新
    // -------------------------
    const onUpdateLotteryList = ({ list }) => {
      setLotteryList(list || []);
      try { localStorage.setItem("lotteryList", JSON.stringify(list || [])); } catch {}
    };

    const onHistoryUpdate = (hist) => {
      setHistory(hist);
      try { localStorage.setItem("history", JSON.stringify(hist)); } catch {}
    };

    const onAdminUserList = (list) => setUsersList(list || []);
    const onAdminActiveMatches = (matches) => setActiveMatches(matches || []);
    const onAdminLotteryHistory = (hist) => setLotteryHistory(hist || []);
    const onMatchStatus = ({ enabled }) => setMatchEnabled(enabled);

    // -------------------------
    // Socket イベント登録
    // -------------------------
    socket.on("login_ok", onLoginOk);
    socket.on("matched", onMatched);
    socket.on("return_to_menu_battle", onReturnToMenu);
    socket.on("confirm_opponent_win", onConfirmOpponentWin);
    socket.on("win_report_cancelled", onWinReportCancelled);
    socket.on("admin_user_list", onAdminUserList);
    socket.on("admin_active_matches", onAdminActiveMatches);
    socket.on("admin_lottery_history", onAdminLotteryHistory);
    socket.on("update_lottery_list", onUpdateLotteryList);
    socket.on("match_status", onMatchStatus);
    socket.on("force_logout", onForceLogout);
    socket.on("history", onHistoryUpdate);

    // -------------------------
    // Heartbeat
    // -------------------------
    heartbeatTimer.current = setInterval(() => {
      const sid = localStorage.getItem("sessionId");
      if (sid) socket.emit("heartbeat", { sessionId: sid });
    }, HEARTBEAT_INTERVAL);

    return () => {
      clearInterval(heartbeatTimer.current);
      socket.off("login_ok", onLoginOk);
      socket.off("matched", onMatched);
      socket.off("return_to_menu_battle", onReturnToMenu);
      socket.off("confirm_opponent_win", onConfirmOpponentWin);
      socket.off("win_report_cancelled", onWinReportCancelled);
      socket.off("admin_user_list", onAdminUserList);
      socket.off("admin_active_matches", onAdminActiveMatches);
      socket.off("admin_lottery_history", onAdminLotteryHistory);
      socket.off("update_lottery_list", onUpdateLotteryList);
      socket.off("match_status", onMatchStatus);
      socket.off("force_logout", onForceLogout);
      socket.off("history", onHistoryUpdate);
    };
  }, []);

  // -------------------------
  // ユーザーハンドラ
  // -------------------------
  const handleLogin = () => {
    if (!name.trim()) return alert("ユーザー名を入力してください。");
    const sid = localStorage.getItem("sessionId");
    socket.emit("login", { name, sessionId: sid });
  };

  const handleAdminLogin = () => {
    if (!adminPassword) return alert("管理者パスワードを入力してください。");
    socket.emit("admin_login", { password: adminPassword });
    setAdminMode(true);
    localStorage.setItem("adminMode", "true");
  };

  const handleLogout = () => {
    socket.emit("logout");
    setLoggedIn(false);
    setUser(null);
    setOpponent(null);
    setDeskNum(null);
    localStorage.removeItem("user");
  };

  const handleFindOpponent = () => {
    setSearching(true);
    socket.emit("find_opponent");
  };

  const handleCancelSearch = () => {
    setSearching(false);
    socket.emit("cancel_find");
  };

  const handleWinReport = () => {
    socket.emit("report_win_request");
  };

  const handleAdminLogout = () => {
    setAdminMode(false);
    localStorage.removeItem("adminMode");
  };

  const handleToggleMatch = () => {
    socket.emit("admin_toggle_match", { enable: !matchEnabled });
  };

  const handleDrawLots = () => {
    socket.emit("admin_draw_lots", {
      count: drawCount,
      minBattles: minMatches,
      minLoginMinutes: minLoginHours * 60,
      title: lotteryTitle,
    });
    setLotteryTitle("");
  };

  const handleUpdateAutoLogout = () => {
    socket.emit("admin_update_auto_logout", { hours: autoLogoutHours });
  };

  const handleLogoutUser = (id, name) => {
    socket.emit("admin_force_logout", { sessionId: id, name });
  };

  const handleDeleteLotteryEntry = (idx) => {
    socket.emit("admin_delete_lottery_entry", { idx });
  };

  const handleClearLotteryHistory = () => {
    socket.emit("admin_clear_lottery_history");
  };

  const handleAdminReportWin = (sessionId, deskNum) => {
    socket.emit("admin_report_win", { sessionId, deskNum });
  };

  const handleAdminReportBothLose = (deskNum) => {
    socket.emit("admin_report_both_lose", { deskNum });
  };

  // -------------------------
  // JSXレンダリング
  // -------------------------
  return (
    <div className="app">
      {!loggedIn && !adminMode ? (
        <div className="login-screen">
          <div className="user-login-center">
            <h2>ユーザーとしてログイン</h2>
            <input type="text" placeholder="ユーザー名" value={name} onChange={e => setName(e.target.value)} />
            <button className="main-btn" onClick={handleLogin}>ログイン</button>
          </div>
          <div className="admin-login-topright">
            <input type="password" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} placeholder="管理者パスワード" />
            <button className="admin-btn" onClick={handleAdminLogin}>管理者ログイン</button>
          </div>
        </div>
      ) : adminMode ? (
        <div className="admin-screen">
          {/* 管理者画面内容（ユーザーリスト・マッチング・対戦中・抽選・自動ログアウト） */}
          <h2>管理者パネル</h2>
          {/* 以下、現行 App.jsx の管理者 JSX と同じ */}
        </div>
      ) : (
        <div className="user-menu">
          {/* ユーザー画面内容 */}
          <h2> {user?.name} さん</h2>
          {/* 勝敗・対戦履歴・抽選結果・マッチング操作 */}
        </div>
      )}
    </div>
  );
}

export default App;
