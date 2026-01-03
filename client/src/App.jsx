// client/src/App.jsx
import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

/*
  現行機能保持版
  - visibilitychange 復帰時に再接続 & 自動ログイン
  - heartbeat / reconnect
  - localStorage で状態保持
  - ユーザー・管理者機能すべて統合
*/

const SERVER_URL =
  process.env.NODE_ENV === "production"
    ? window.location.origin
    : (import.meta.env.VITE_SERVER_URL || "http://localhost:4000");

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
  // state
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
  // sessionId 初回生成
  // -------------------------
  useEffect(() => {
    let sid = localStorage.getItem("sessionId");
    if (!sid) {
      sid = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `sess-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
      localStorage.setItem("sessionId", sid);
    }
  }, []);

  // -------------------------
  // visibilitychange 復帰時再接続
  // -------------------------
  useEffect(() => {
    const tryReconnectAndRelogin = () => {
      if (socket && !socket.connected) socket.connect();
      const savedUserStr = localStorage.getItem("user");
      const sid = localStorage.getItem("sessionId");
      if (savedUserStr && sid) {
        try {
          const savedUser = JSON.parse(savedUserStr);
          if (savedUser?.name) socket.emit("login", { name: savedUser.name, sessionId: sid });
        } catch {}
      }

      const savedAdmin = localStorage.getItem("adminMode");
      if (savedAdmin === "true") {
        socket.emit("admin_view_users");
        socket.emit("admin_get_auto_logout");
        socket.emit("admin_get_lottery_history");
        socket.emit("admin_get_active_matches");
      }

      if (sid && socket && socket.connected) socket.emit("heartbeat", { sessionId: sid });
    };

    const onVisibility = () => { if (document.visibilityState === "visible") tryReconnectAndRelogin(); };
    document.addEventListener("visibilitychange", onVisibility);
    tryReconnectAndRelogin();
    return () => document.removeEventListener("visibilitychange", onVisibility);
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
          setUser(u); setLoggedIn(true); setName(u.name);
          const sid = u.sessionId || localStorage.getItem("sessionId");
          if (sid) socket.emit("login", { name: u.name, sessionId: sid });
        } catch {}
      }

      if (savedAdmin === "true") setAdminMode(true);
      loginAttempted.current = true;
    }

    // socket.on 登録（省略不可）
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

    const onMatched = ({ opponent, deskNum }) => { setOpponent(opponent); setDeskNum(deskNum); setSearching(false); };
    const onReturnToMenu = () => { setOpponent(null); setDeskNum(null); setSearching(false); };
    const onConfirmOpponentWin = ({ deskNum: dn, winnerName } = {}) => {
      const msg = (winnerName ? `${winnerName} の勝ちで` : "対戦相手の勝ちで") + "登録します。よろしいですか？";
      const accept = window.confirm(msg);
      socket.emit("opponent_win_confirmed", { accepted: accept });
      alert(accept ? "勝敗が登録されました" : "勝敗登録がキャンセルされました");
    };
    const onWinReportCancelled = () => { alert("対戦相手がキャンセルしたため、勝利登録は中止されました"); setOpponent(null); setDeskNum(null); setSearching(false); };
    const onForceLogout = ({ reason }) => {
      if (reason === "auto") alert("一定時間が経過したため、自動ログアウトされました");
      localStorage.clear();
      setLoggedIn(false); setAdminMode(false); setUser(null);
      setSearching(false); setOpponent(null); setDeskNum(null);
      setLotteryWinnerTitles([]); setLotteryHistory([]); setLotteryList([]); setHistory([]);
      setName("");
    };
    const onHistory = (hist) => { setHistory(Array.isArray(hist) ? hist : []); try { localStorage.setItem("history", JSON.stringify(hist)); } catch {} };
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
    const onLotteryWinner = ({ title }) => { setLotteryWinnerTitles(prev => prev.includes(title) ? prev : [...prev, title]); };
    const onUpdateLotteryList = ({ list }) => {
      if (!list || !Array.isArray(list)) return;
      let normalized = [];
      const looksLikeHistory = list.every(item => item && (item.title || item.winners));
      normalized = looksLikeHistory ? list : [{ title: lotteryTitle || "抽選", winners: list.map(w => typeof w === "string" ? { name: w } : (w || {})) }];
      setLotteryList(normalized);
      try { localStorage.setItem("lotteryList", JSON.stringify(normalized)); } catch {}
      setShowLottery(true);
    };
    const onAdminLotteryHistory = (list) => { setLotteryHistory(Array.isArray(list) ? list : []); try { localStorage.setItem("lotteryHistory", JSON.stringify(list)); } catch {} };
    const onAdminActiveMatches = (list) => setActiveMatches(Array.isArray(list) ? list : []);

    // socket.on 登録
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

    // heartbeat
    if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    heartbeatTimer.current = setInterval(() => {
      const sid = localStorage.getItem("sessionId") || (user && user.sessionId);
      if (sid && socket && socket.connected) socket.emit("heartbeat", { sessionId: sid });
    }, HEARTBEAT_INTERVAL);

    // reconnect guard
    reconnectIntervalRef.current = setInterval(() => { if (!socket.connected) socket.connect(); }, 30000);

    return () => {
      // cleanup
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

      if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
      if (reconnectIntervalRef.current) { clearInterval(reconnectIntervalRef.current); reconnectIntervalRef.current = null; }
    };
  }, [user, lotteryTitle]);

  // -------------------------
  // ハンドラ関数（省略不可）
  // -------------------------
  const handleLogin = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return alert("ユーザー名を入力してください");
    const saved = (() => { try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; } })();
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
    setLotteryHistory(prev => {
      const next = [...prev];
      next.splice(index, 1);
      try { localStorage.setItem("lotteryHistory", JSON.stringify(next)); } catch {}
      return next;
    });
    socket.emit("admin_delete_lottery_history", { title: entry.title, index });
  };

  const handleClearLotteryHistory = () => {
    if (!window.confirm("抽選履歴をすべて削除しますか？")) return;
    setLotteryHistory([]);
    try { localStorage.removeItem("lotteryHistory"); } catch {}
    socket.emit("admin_clear_lottery_history");
  };

  // -------------------------
  // ユーザー集計
  // -------------------------
  const userWins = (history || []).filter(h => h.result === "WIN").length;
  const userLosses = (history || []).filter(h => h.result === "LOSE").length;
  const userMatches = (history || []).length;
        {/* -------------------- メイン表示 -------------------- */}
                <div className="main-container">

          {/* ================== 管理者画面 ================== */}
          {adminMode && (
            <div className="admin-panel">
              <h2>管理者メニュー</h2>

              <div className="admin-controls">
                <button onClick={handleFetchDesks}>卓一覧を更新</button>
                <button onClick={handleFetchUsers}>ユーザー一覧を更新</button>
              </div>

              <div className="desk-section">
                <h3>対戦卓一覧</h3>

                {desks.length === 0 ? (
                  <p>現在、稼働中の卓はありません</p>
                ) : (
                  <ul className="desk-list">
                    {desks.map((d, i) => (
                      <li key={i}>
                        <strong>卓 {d.deskNum}</strong>：
                        {d.players?.map((p) => p.name).join(" vs ")}

                        <button
                          className="admin-win-btn"
                          onClick={() => handleAdminWin(d.deskNum)}
                        >
                          勝者登録
                        </button>

                        <button
                          className="admin-clear-btn"
                          onClick={() => handleForceClearDesk(d.deskNum)}
                        >
                          卓を削除
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="lottery-admin-section">
                <h3>抽選機能</h3>

                <div className="lottery-form">
                  <input
                    type="text"
                    placeholder="抽選タイトル"
                    value={lotteryTitle}
                    onChange={(e) => setLotteryTitle(e.target.value)}
                  />

                  <input
                    type="number"
                    placeholder="当選人数"
                    value={lotteryCount}
                    onChange={(e) => setLotteryCount(Number(e.target.value))}
                  />

                  <button onClick={handleRunLottery}>
                    抽選を実行
                  </button>
                </div>

                <div className="lottery-history">
                  <h4>抽選履歴</h4>

                  {lotteryResults.length === 0 ? (
                    <p>抽選履歴なし</p>
                  ) : (
                    <ul>
                      {lotteryResults.map((lot, idx) => (
                        <li key={idx}>
                          <strong>{lot.title}</strong>
                          <ul>
                            {lot.winners?.map((w, i) => (
                              <li key={i}>{w.name}</li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <button className="logout-btn" onClick={handleLogout}>
                ログアウト
              </button>
            </div>
          )}

          {/* ================== ユーザー画面 ================== */}
           {!adminMode && user && (
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

              {opponent && (
                <div className="battle-info">
                  <h3>対戦相手：{opponent?.name}</h3>
                  <p>卓番号：{deskNum}</p>

                  <button className="win-btn" onClick={handleWinReport}>
                    勝利報告
                  </button>
                </div>
              )}

              <div className="history-section">
                <h3>対戦履歴</h3>

                {history.length === 0 ? (
                  <p>対戦履歴がありません</p>
                ) : (
                  <ul className="history-list">
                    {history.map((h, i) => (
                      <li key={i}>
                        <strong>{h.opponent}</strong>：{h.result}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

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
                          {entry.winners?.map((w, i) => (
                            <li
                              key={i}
                              style={
                                w.id === user?.id
                                  ? { color: "red", fontWeight: "bold" }
                                  : {}
                              }
                            >
                              {w.name}
                              {w.id === user?.id && "（当選）"}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div style={{ textAlign: "center", marginTop: 10 }}>
                <button className="main-btn" onClick={handleLogout}>
                  ログアウト
                </button>
              </div>
            </div>
          )}
        </div>
  );
}

export default App;
