// client/src/App.jsx
import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const socket = io(
  process.env.NODE_ENV === "production"
    ? window.location.origin
    : "http://localhost:4000"
);

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
          socket.emit("login", { name: u.name, sessionId: u.sessionId });
        } catch {}
      }

      if (savedAdmin === "true") setAdminMode(true);
      loginAttempted.current = true;
    }

    // --- socket.on イベント ---
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
      // request updated info (server should respond)
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

    // register
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
    const sessionId = saved?.sessionId || undefined;
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
          <h2>管理者パネル</h2>

          {/* --- 管理者の基本情報 --- */}
          <div className="admin-section">
            <h3>ログイン中のユーザー一覧</h3>
            <ul className="admin-user-list">
              {Array.isArray(usersList) && usersList.length > 0 ? usersList.map((u) => (
                <li key={u.sessionId || u.id || Math.random()}>
                  {u.name}（{u.sessionId}）
                  <button
                    className="small-red-btn"
                    onClick={() => handleLogoutUser(u.id || u.sessionId, u.name)}
                  >
                    強制ログアウト
                  </button>
                </li>
              )) : <li style={{ color: "lightgray" }}>ログイン中のユーザーはありません</li>}
            </ul>
          </div>

          {/* --- マッチング機能 ON/OFF --- */}
          <div className="admin-section">
            <h3>マッチング機能</h3>
            <button className="admin-btn" onClick={handleToggleMatch}>
              {matchEnabled ? "マッチング停止" : "マッチング再開"}
            </button>
          </div>

          {/* --- 対戦中テーブル --- */}
          <div className="admin-section">
            <h3>対戦中の部屋</h3>

            {activeMatches.length === 0 ? (
              <p>現在、対戦中の部屋はありません。</p>
            ) : (
              <div className="active-matches">
                {activeMatches.map((room) => (
                  <div key={room.deskNum} className="battle-room-card">
                    <p>卓番号：{room.deskNum}</p>
                    <p>対戦者：{room.player1?.name} vs {room.player2?.name}</p>

                    <div className="battle-admin-buttons">
                      <button
                        className="win-btn"
                        onClick={() =>
                          handleAdminReportWin(room.player1?.sessionId, room.deskNum)
                        }
                      >
                        {room.player1?.name} 勝利
                      </button>

                      <button
                        className="win-btn"
                        onClick={() =>
                          handleAdminReportWin(room.player2?.sessionId, room.deskNum)
                        }
                      >
                        {room.player2?.name} 勝利
                      </button>

                      <button
                        className="lose-btn"
                        onClick={() =>
                          handleAdminReportBothLose(room.deskNum)
                        }
                      >
                        両者敗北
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* --- 抽選管理 --- */}
          <div className="admin-section">
            <h3>抽選管理</h3>

            <div className="lottery-controls">
              <label>抽選タイトル：</label>
              <input
                type="text"
                value={lotteryTitle}
                onChange={(e) => setLotteryTitle(e.target.value)}
                placeholder="例：大会抽選"
              />

              <label>当選人数：</label>
              <input
                type="number"
                min="1"
                value={drawCount}
                onChange={(e) => setDrawCount(parseInt(e.target.value || "1") || 1)}
              />

              <label>最小対戦数：</label>
              <input
                type="number"
                min="0"
                value={minMatches}
                onChange={(e) => setMinMatches(parseInt(e.target.value || "0") || 0)}
              />

              <label>最小ログイン時間（時）：</label>
              <input
                type="number"
                min="0"
                value={minLoginHours}
                onChange={(e) => setMinLoginHours(parseInt(e.target.value || "0") || 0)}
              />

              <button className="admin-btn" onClick={handleDrawLots}>
                抽選実行
              </button>
            </div>

            {/* --- 抽選履歴 --- */}
            <h3>抽選履歴</h3>

            {lotteryHistory.length === 0 ? (
              <p>抽選履歴がありません。</p>
            ) : (
              <ul className="lottery-history-list">
                {lotteryHistory.map((entry, idx) => (
                  <li key={idx} className="lottery-history-item">
                    <strong>{entry.title}</strong>
                    <ul>
                      {entry.winners?.map((w, i) => (
                        <li key={i}>{w.name}</li>
                      ))}
                    </ul>
                    <button
                      className="small-red-btn"
                      onClick={() => handleDeleteLotteryEntry(idx)}
                    >
                      削除
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button className="danger-btn" onClick={handleClearLotteryHistory}>
              抽選履歴を全削除
            </button>
          </div>

          {/* --- 自動ログアウト時間設定 --- */}
          <div className="admin-section">
            <h3>自動ログアウト時間設定</h3>
            <p>現在：{autoLogoutHours} 時間</p>
            <input
              type="number"
              min="1"
              step="0.5"
              value={autoLogoutHours}
              onChange={(e) => setAutoLogoutHours(parseFloat(e.target.value || "12") || 12)}
            />
            <button className="admin-btn" onClick={handleUpdateAutoLogout}>
              更新
            </button>
          </div>

          {/* --- 管理者ログアウト --- */}
          <div className="admin-section">
            <button className="main-btn" onClick={handleAdminLogout}>
              管理者ログアウト
            </button>
          </div>
        </div>
      ) : (
        /*─────────────── ここからユーザーメニュー ───────────────*/
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

          {/* --- 抽選結果確認 --- */}
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
                        <li key={i}>{w.name}</li>
                      ))}
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
