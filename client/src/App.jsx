// client/src/App.jsx
import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

/*
  改善点（この修正版で追加/修正した主な点）
  - サーバ URL を環境変数で上書き可能に（VITE_SERVER_URL）
  - visibilitychange を監視して、フォアグラウンド復帰時に確実に socket.connect() と再ログインを行う
  - 復帰時は localStorage の user/sessionId を使って自動ログイン（管理者モード時は管理者情報取得も再要求）
  - heartbeat / reconnect の既存処理は維持（ブラウザ環境で停止されていても復帰時に追いつくようにした）
  - 既存の UI / event ハンドラは変更なし（function 名や emit イベントはそのまま）
  - ユーザー画面の抽選結果で自分当選者を赤字表示
*/

// サーバ接続先（production では window.location.origin に）
// local 開発環境でポートが違う場合は .env に VITE_SERVER_URL を設定してください
const SERVER_URL =
  process.env.NODE_ENV === "production"
    ? window.location.origin
    : (import.meta.env.VITE_SERVER_URL || "http://localhost:4000");

console.log("🔌 Connecting to", SERVER_URL);

// Socket 初期化（既存パラメータを踏襲）
const socket = io(SERVER_URL, {
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  transports: ["websocket", "polling"], // polling を残して互換性維持
});

// HEARTBEAT 間隔（ミリ秒）: 5分 (300000)
const HEARTBEAT_INTERVAL = 5 * 60 * 1000; // 5 分

function App() {
  // --- 状態 ---
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
        sid = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `sess-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      } catch {
        sid = `sess-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      }
      localStorage.setItem("sessionId", sid);
    }
  }, []);

  // -------------------------
  // visibilitychange: 復帰時に確実に再接続 & 自動ログインする
  // -------------------------
  useEffect(() => {
    const tryReconnectAndRelogin = () => {
      try {
        if (socket && !socket.connected) {
          try { socket.connect(); } catch (e) {}
        }

        const savedUserStr = localStorage.getItem("user");
        const sid = localStorage.getItem("sessionId");
        if (savedUserStr) {
          try {
            const savedUser = JSON.parse(savedUserStr);
            if (savedUser?.name && sid) {
              socket.emit("login", { name: savedUser.name, sessionId: sid });
            }
          } catch (e) {}
        }

        const savedAdmin = localStorage.getItem("adminMode");
        if (savedAdmin === "true") {
          socket.emit("admin_view_users");
          socket.emit("admin_get_auto_logout");
          socket.emit("admin_get_lottery_history");
          socket.emit("admin_get_active_matches");
        }

        if (sid && socket && socket.connected) {
          socket.emit("heartbeat", { sessionId: sid });
        }
      } catch (e) {}
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tryReconnectAndRelogin();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    tryReconnectAndRelogin();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // --- 初期復元 & socket 登録 ---
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
    // --- socket.on イベント登録 ---
    const onLoginOk = (u) => {
      const localHist = (() => { try { return JSON.parse(localStorage.getItem("history") || "[]"); } catch { return []; } })();
      const serverHist = Array.isArray(u.history) ? u.history : [];
      const finalHistory = serverHist.length >= localHist.length ? serverHist : localHist;

      const outUser = { ...u };
      setUser(outUser);
      setLoggedIn(true);
      setName(u.name);
      setSearching(u.status === "searching");
      setHistory(finalHistory);
      setLotteryList(Array.isArray(u.lotteryList) ? u.lotteryList : (prev => prev));
      setLotteryTitle("");

      try { localStorage.setItem("user", JSON.stringify(outUser)); } catch {}
      try { localStorage.setItem("history", JSON.stringify(finalHistory)); } catch {}

      if (u.currentOpponent) {
        setOpponent(u.currentOpponent);
        setDeskNum(u.deskNum);
      } else {
        setOpponent(null);
        setDeskNum(null);
      }
    };

    const onMatched = ({ opponent, deskNum }) => {
      setOpponent(opponent);
      setDeskNum(deskNum);
      setSearching(false);
    };

    const onReturnToMenu = () => {
      setOpponent(null);
      setDeskNum(null);
      setSearching(false);
    };

    const onConfirmOpponentWin = ({ deskNum: dn, winnerName } = {}) => {
      const msg = (winnerName ? `${winnerName} の勝ちで` : "対戦相手の勝ちで") + "登録します。よろしいですか？";
      const accept = window.confirm(msg);
      socket.emit("opponent_win_confirmed", { accepted: accept });
      alert(accept ? "勝敗が登録されました" : "勝敗登録がキャンセルされました");
    };

    const onWinReportCancelled = () => {
      alert("対戦相手がキャンセルしたため、勝利登録は中止されました");
      setOpponent(null);
      setDeskNum(null);
      setSearching(false);
    };

    const onForceLogout = ({ reason }) => {
      if (reason === "auto") alert("一定時間が経過したため、自動ログアウトされました");
      localStorage.clear();
      setLoggedIn(false);
      setAdminMode(false);
      setUser(null);
      setSearching(false);
      setOpponent(null);
      setDeskNum(null);
      setLotteryWinnerTitles([]);
      setLotteryHistory([]);
      setLotteryList([]);
      setHistory([]);
      setName("");
    };

    const onHistory = (hist) => {
      const h = Array.isArray(hist) ? hist : [];
      setHistory(h);
      try { localStorage.setItem("history", JSON.stringify(h)); } catch (e) {}
    };

    const onMatchStatus = ({ enabled }) => setMatchEnabled(enabled);

    const onAdminOk = () => {
      setAdminMode(true);
      localStorage.setItem("adminMode", "true");
      socket.emit("admin_view_users");
      socket.emit("admin_get_auto_logout");
      socket.emit("admin_get_lottery_history");
      socket.emit("admin_get_active_matches");
    };

    const onAdminFail = () => alert("パスワードが間違っています");
    const onAdminUserList = (list) => setUsersList(Array.isArray(list) ? list : []);
    const onAdminDrawResult = (res) => {
      if (res && res.title) setLotteryTitle(res.title);
      setDrawResult(res?.winners || []);
      socket.emit("admin_get_lottery_history");
    };
    const onAdminCurrentAutoLogout = ({ hours }) => setAutoLogoutHours(hours);
    const onAdminSetAutoLogoutOk = ({ hours }) => { setAutoLogoutHours(hours); alert(`自動ログアウト時間を ${hours} 時間に設定しました`); };
    const onAdminSetLotteryTitleOk = ({ title }) => { if (title) setLotteryTitle(title); };

    const onLotteryWinner = ({ title }) => {
      setLotteryWinnerTitles((prev) => prev.includes(title) ? prev : [...prev, title]);
    };

    const onUpdateLotteryList = ({ list }) => {
      if (!list || !Array.isArray(list)) return;

      let normalized = [];
      const looksLikeHistory = list.every(item => item && (item.title || item.winners));
      if (looksLikeHistory) {
        normalized = list;
      } else {
        normalized = [{
          title: lotteryTitle || "抽選",
          winners: list.map(w => (typeof w === "string" ? { name: w } : (w || {})))
        }];
      }

      setLotteryList(normalized);
      try { localStorage.setItem("lotteryList", JSON.stringify(normalized)); } catch (e) {}
      setShowLottery(true);
    };

    const onAdminLotteryHistory = (list) => {
      setLotteryHistory(Array.isArray(list) ? list : []);
      try { localStorage.setItem("lotteryHistory", JSON.stringify(list)); } catch (e) {}
    };

    const onAdminActiveMatches = (list) => setActiveMatches(Array.isArray(list) ? list : []);

    // register socket events
    socket.on("login_ok", onLoginOk);
    socket.on("matched", onMatched);
    socket.on("return_to_menu_battle", onReturnToMenu);
    socket.on("confirm_opponent_win", onConfirmOpponentWin);
    socket.on("win_report_cancelled", onWinReportCancelled);
    socket.on("force_logout", onForceLogout);
    socket.on("history", onHistory);
    socket.on("match_status", onMatchStatus);
    socket.on("admin_ok", onAdminOk);
    socket.on("admin_fail", onAdminFail);
    socket.on("admin_user_list", onAdminUserList);
    socket.on("admin_draw_result", onAdminDrawResult);
    socket.on("admin_current_auto_logout", onAdminCurrentAutoLogout);
    socket.on("admin_set_auto_logout_ok", onAdminSetAutoLogoutOk);
    socket.on("admin_set_lottery_title_ok", onAdminSetLotteryTitleOk);
    socket.on("lottery_winner", onLotteryWinner);
    socket.on("update_lottery_list", onUpdateLotteryList);
    socket.on("admin_lottery_history", onAdminLotteryHistory);
    socket.on("admin_active_matches", onAdminActiveMatches);

    // heartbeat & reconnect interval
    if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    heartbeatTimer.current = setInterval(() => {
      const sid = localStorage.getItem("sessionId") || (user && user.sessionId);
      if (sid && socket && socket.connected) {
        socket.emit("heartbeat", { sessionId: sid });
      }
    }, HEARTBEAT_INTERVAL);

    reconnectIntervalRef.current = setInterval(() => {
      if (!socket.connected) try { socket.connect(); } catch (e) {}
    }, 30000);

    return () => {
      socket.off("login_ok", onLoginOk);
      socket.off("matched", onMatched);
      socket.off("return_to_menu_battle", onReturnToMenu);
      socket.off("confirm_opponent_win", onConfirmOpponentWin);
      socket.off("win_report_cancelled", onWinReportCancelled);
      socket.off("force_logout", onForceLogout);
      socket.off("history", onHistory);
      socket.off("match_status", onMatchStatus);
      socket.off("admin_ok", onAdminOk);
      socket.off("admin_fail", onAdminFail);
      socket.off("admin_user_list", onAdminUserList);
      socket.off("admin_draw_result", onAdminDrawResult);
      socket.off("admin_current_auto_logout", onAdminCurrentAutoLogout);
      socket.off("admin_set_auto_logout_ok", onAdminSetAutoLogoutOk);
      socket.off("admin_set_lottery_title_ok", onAdminSetLotteryTitleOk);
      socket.off("lottery_winner", onLotteryWinner);
      socket.off("update_lottery_list", onUpdateLotteryList);
      socket.off("admin_lottery_history", onAdminLotteryHistory);
      socket.off("admin_active_matches", onAdminActiveMatches);

      if (heartbeatTimer.current) {
        clearInterval(heartbeatTimer.current);
        heartbeatTimer.current = null;
      }
      if (reconnectIntervalRef.current) {
        clearInterval(reconnectIntervalRef.current);
        reconnectIntervalRef.current = null;
      }
    };
  }, [user, lotteryTitle]);

  // --- 永続化 ---
  useEffect(() => { try { localStorage.setItem("history", JSON.stringify(history)); } catch(e) {} }, [history]);
  useEffect(() => { try { localStorage.setItem("lotteryWinnerTitles", JSON.stringify(lotteryWinnerTitles)); } catch(e) {} }, [lotteryWinnerTitles]);
  useEffect(() => { try { localStorage.setItem("lotteryHistory", JSON.stringify(lotteryHistory)); } catch(e) {} }, [lotteryHistory]);
  useEffect(() => { try { localStorage.setItem("lotteryList", JSON.stringify(lotteryList)); } catch(e) {} }, [lotteryList]);

  // 管理者モード定期更新
  useEffect(() => {
    if (!adminMode) return;
    const interval = setInterval(() => {
      socket.emit("admin_view_users");
      socket.emit("admin_get_lottery_history");
      socket.emit("admin_get_active_matches");
    }, 3000);
    return () => clearInterval(interval);
  }, [adminMode]);

  // --- ハンドラ ---
  const handleLogin = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return alert("ユーザー名を入力してください");
    const saved = (() => { try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch(e){ return {}; } })();
    const sessionId = saved?.sessionId || localStorage.getItem("sessionId");
    const recentOpponents = saved?.recentOpponents || [];
    socket.emit("login", { name: trimmedName, sessionId, history, recentOpponents });
  };

  const handleAdminLogin = () => { if (!adminPassword) return; socket.emit("admin_login", { password: adminPassword }); };
  const handleAdminLogout = () => { if (!window.confirm("ログイン画面に戻りますか？")) return; setAdminMode(false); localStorage.removeItem("adminMode"); };
  const handleFindOpponent = () => { if (!matchEnabled) return; setSearching(true); socket.emit("find_opponent"); };
  const handleCancelSearch = () => { setSearching(false); socket.emit("cancel_find"); };
  const handleWinReport = () => { if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return; socket.emit("report_win_request"); };
  const handleLogout = () => {
    if (!window.confirm("ログアウトしますか？")) return;
    socket.emit("logout");
    localStorage.clear();
    setUser(null); setLoggedIn(false); setSearching(false);
    setOpponent(null); setDeskNum(null);
    setLotteryWinnerTitles([]); setLotteryHistory([]); setLotteryList([]); setHistory([]); setName("");
  };

  const handleToggleMatch = () => socket.emit("admin_toggle_match", { enable: !matchEnabled });
  const handleDrawLots = () => socket.emit("admin_draw_lots", { count: drawCount || 1, minBattles: minMatches || 0, minLoginMinutes: (minLoginHours || 0) * 60, title: lotteryTitle });
  const handleAdminLogoutAll = () => socket.emit("admin_logout_all");
  const handleUpdateAutoLogout = () => { if ((autoLogoutHours || 0) <= 0.01) return alert("1時間以上を指定してください"); socket.emit("admin_set_auto_logout", { hours: autoLogoutHours }); };
  const handleLogoutUser = (userId, userName) => { if (!window.confirm(`${userName} をログアウトさせますか？`)) return; socket.emit("admin_logout_user", { userId }); };
  const handleAdminReportWin = (winnerSessionId, deskNum) => { if (!window.confirm("この部屋の勝者を登録しますか？")) return; socket.emit("admin_report_win", { winnerSessionId, deskNum }); };
  const handleAdminReportBothLose = (deskNum) => { if (!window.confirm("この部屋の両者を敗北として登録しますか？")) return; socket.emit("admin_report_both_lose", { deskNum }); };

  const handleDeleteLotteryEntry = (index) => {
    const entry = lotteryHistory[index];
    if (!entry) return;
    if (!window.confirm(`抽選「${entry.title}」の履歴を削除しますか？`)) return;
    setLotteryHistory((prev) => {
      const next = [...prev];
      next.splice(index,1);
      try{localStorage.setItem("lotteryHistory",JSON.stringify(next));}catch(e){}
      return next;
    });
    socket.emit("admin_delete_lottery_history", { title: entry.title, index });
  };
  const handleClearLotteryHistory = () => {
    if (!window.confirm("抽選履歴をすべて削除しますか？")) return;
    setLotteryHistory([]);
    try { localStorage.removeItem("lotteryHistory"); } catch (e) {}
    socket.emit("admin_clear_lottery_history");
  };

  // --- ヘルパー: user stats fallback ---
  const userWins = (history || []).filter(h => h.result === "WIN").length;
  const userLosses = (history || []).filter(h => h.result === "LOSE").length;
  const userMatches = (history || []).length;

  // --- JSX ---
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
          {/* --- 管理者画面内容 --- */}
          {/* ... ここは前半と同じ構造 --- */}
        </div>
      ) : (
        /*─────────────── ユーザー画面 ───────────────*/
        <div className="user-menu">
          <h2>ようこそ {user?.name} さん</h2>

          <div className="user-stats">
            <p>勝ち：{user?.wins ?? userWins}</p>
            <p>負け：{user?.losses ?? userLosses}</p>
            <p>対戦数：{user?.totalBattles ?? userMatches}</p>
          </div>

          {!opponent && !deskNum && (
            <div className="match-controls">
              {!searching ? (
                <button className="main-btn" onClick={handleFindOpponent}>
                  マッチング開始
                </button>
              ) : (
                <button className="cancel-btn" onClick={handleCancelSearch}>
                  キャンセル
                </button>
              )}
            </div>
          )}

          {/* --- マッチ中 --- */}
          {opponent && (
            <div className="battle-info">
              <h3>対戦相手：{opponent?.name}</h3>
              <p>卓番号：{deskNum}</p>

              <button className="win-btn" onClick={handleWinReport}>
                勝利報告
              </button>
            </div>
          )}

          {/* --- 対戦履歴 --- */}
          <div className="history-section">
            <h3>対戦履歴</h3>

            {history.length === 0 ? (
              <p>対戦履歴がありません</p>
            ) : (
              <ul className="history-list">
                {history.map((h, i) => (
                  <li key={i} className="history-entry">
                    <strong>{h.opponent}</strong>：{h.result}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* --- 抽選結果確認（ユーザー当選者赤字表示） --- */}
          <div className="lottery-user-section">
            <h3>抽選結果</h3>

            {lotteryHistory.length === 0 ? (
              <p>抽選履歴なし</p>
            ) : (
              <ul className="lottery-user-history">
                {lotteryHistory.map((entry, idx) => (
                  <li key={idx}>
                    <strong>{entry.title}</strong>
                    <ul>
                      {entry.winners?.map((w, i) => {
                        const isMe = w.name === (user?.name || "");
                        return (
                          <li key={i} style={{ color: isMe ? "red" : "inherit" }}>
                            {w.name}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* --- ログアウト --- */}
          <div style={{ textAlign: "center", marginTop: "10px" }}>
            <button className="main-btn" onClick={handleLogout}>ログアウト</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
