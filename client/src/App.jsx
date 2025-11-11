// client/src/App.jsx（抽選履歴 永続化・再表示完全対応版）
import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const socket = io(
  process.env.NODE_ENV === "production"
    ? window.location.origin
    : "http://localhost:4000"
);

function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [name, setName] = useState("");
  const [user, setUser] = useState(null);
  const [searching, setSearching] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState(null);
  const [history, setHistory] = useState([]);
  const [lotteryList, setLotteryList] = useState([]);
  const [lotteryTitle, setLotteryTitle] = useState("");
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [usersList, setUsersList] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(false);
  const [drawCount, setDrawCount] = useState(1);
  const [minMatches, setMinMatches] = useState(0);
  const [minLoginHours, setMinLoginHours] = useState(0);
  const [drawResult, setDrawResult] = useState([]);
  const [lotteryWinnerTitles, setLotteryWinnerTitles] = useState([]);
  const [showLottery, setShowLottery] = useState(false);
  const [autoLogoutHours, setAutoLogoutHours] = useState(12);
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [activeMatches, setActiveMatches] = useState([]);

  const loginAttempted = useRef(false);

  useEffect(() => {
    if (!loginAttempted.current) {
      // 🔹 ローカルデータの復元
      const savedUser = localStorage.getItem("user");
      const savedAdmin = localStorage.getItem("adminMode");
      const savedTitles = localStorage.getItem("lotteryWinnerTitles");
      const savedHistory = localStorage.getItem("history");
      const savedLotteryHistory = localStorage.getItem("lotteryHistory");

      if (savedTitles) setLotteryWinnerTitles(JSON.parse(savedTitles));
      if (savedHistory) setHistory(JSON.parse(savedHistory));

      // ✅ 抽選履歴も確実に復元
      if (savedLotteryHistory) {
        try {
          const parsed = JSON.parse(savedLotteryHistory);
          if (Array.isArray(parsed)) setLotteryHistory(parsed);
        } catch (e) {
          console.error("Failed to parse lotteryHistory from localStorage", e);
        }
      }

      if (savedUser) {
        const u = JSON.parse(savedUser);
        setUser(u);
        setLoggedIn(true);
        setName(u.name);
        socket.emit("login", { name: u.name, sessionId: u.sessionId });
      }

      if (savedAdmin === "true") setAdminMode(true);
      loginAttempted.current = true;
    }

    // --- Socket.io イベント ---
    socket.on("login_ok", (u) => {
      const localHist = (() => {
        try { return JSON.parse(localStorage.getItem("history") || "[]"); } 
        catch (e) { return []; }
      })();
      const serverHist = Array.isArray(u.history) ? u.history : [];
      const finalHistory = serverHist.length >= localHist.length ? serverHist : localHist;

      const outUser = { ...u };
      setUser(outUser);
      setLoggedIn(true);
      setName(u.name);
      setSearching(u.status === "searching");
      setHistory(finalHistory);
      setLotteryList(Array.isArray(u.lotteryList) ? u.lotteryList : []);
      setLotteryTitle("");

      try { localStorage.setItem("user", JSON.stringify(outUser)); } catch (e) {}
      try { localStorage.setItem("history", JSON.stringify(finalHistory)); } catch (e) {}

      if (u.currentOpponent) {
        setOpponent(u.currentOpponent);
        setDeskNum(u.deskNum);
      } else {
        setOpponent(null);
        setDeskNum(null);
      }
    });

    socket.on("matched", ({ opponent, deskNum }) => {
      setOpponent(opponent);
      setDeskNum(deskNum);
      setSearching(false);
    });

    socket.on("return_to_menu_battle", () => {
      setOpponent(null);
      setDeskNum(null);
      setSearching(false);
    });

    socket.on("force_logout", ({ reason }) => {
      if (reason === "auto") alert("一定時間が経過したため、自動ログアウトされました");
      localStorage.removeItem("user");
      localStorage.removeItem("adminMode");
      localStorage.removeItem("lotteryWinnerTitles");
      localStorage.removeItem("lotteryHistory");
      localStorage.removeItem("history");
      setLoggedIn(false);
      setAdminMode(false);
      setUser(null);
      setSearching(false);
      setOpponent(null);
      setDeskNum(null);
      setLotteryWinnerTitles([]);
      setLotteryHistory([]);
      setHistory([]);
      setName("");
    });

    socket.on("history", (hist) => {
      const h = Array.isArray(hist) ? hist : [];
      setHistory(h);
      try { localStorage.setItem("history", JSON.stringify(h)); } catch (e) {}
    });

    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));

    socket.on("admin_ok", () => {
      setAdminMode(true);
      localStorage.setItem("adminMode", "true");

      // ✅ 管理者ログイン時に即座に履歴・状態を再取得
      socket.emit("admin_view_users");
      socket.emit("admin_get_auto_logout");
      socket.emit("admin_get_lottery_history");
      socket.emit("admin_get_active_matches");
    });

    socket.on("admin_fail", () => alert("パスワードが間違っています"));

    socket.on("admin_user_list", (list) => setUsersList(list));

    socket.on("admin_draw_result", (res) => {
      if (res && res.title) setLotteryTitle(res.title);
      setDrawResult(res?.winners || []);
      socket.emit("admin_get_lottery_history");
    });

    socket.on("admin_current_auto_logout", ({ hours }) => setAutoLogoutHours(hours));
    socket.on("admin_set_auto_logout_ok", ({ hours }) => { setAutoLogoutHours(hours); alert(`自動ログアウト時間を ${hours} 時間に設定しました`); });
    socket.on("admin_set_lottery_title_ok", ({ title }) => { if (title) setLotteryTitle(title); });

    socket.on("lottery_winner", ({ title }) => {
      setLotteryWinnerTitles((prev) => prev.includes(title) ? prev : [...prev, title]);
    });

    socket.on("update_lottery_list", ({ list }) => {
      if (!list || !Array.isArray(list)) return;
      setLotteryList(list);
      setShowLottery(true);
    });

    // ✅ 抽選履歴の受信時処理（localStorage にも保存）
    socket.on("admin_lottery_history", (list) => {
      if (Array.isArray(list)) {
        setLotteryHistory(list);
        try {
          localStorage.setItem("lotteryHistory", JSON.stringify(list));
        } catch (e) {
          console.error("Failed to save lotteryHistory:", e);
        }
      }
    });

    socket.on("admin_active_matches", (list) => setActiveMatches(list));

    socket.on("confirm_opponent_win", ({ deskNum: dn, winnerName } = {}) => {
      const confirmLose = window.confirm(
        (winnerName ? `${winnerName} の勝ちで` : "対戦相手の勝ちで") + "登録します。よろしいですか？"
      );
      socket.emit("opponent_win_confirmed", { accepted: confirmLose });
      alert(confirmLose ? "勝敗が登録されました" : "勝敗登録がキャンセルされました");
    });

    socket.on("win_report_cancelled", () => {
      alert("対戦相手がキャンセルしたため、勝利登録は中止されました");
      setOpponent(null);
      setDeskNum(null);
      setSearching(false);
    });

    return () => socket.off();
  }, [user]);

  // --- 永続化 ---
  useEffect(() => {
    try { localStorage.setItem("history", JSON.stringify(history)); } catch(e) {}
    try {
      const sessionId = user?.sessionId || JSON.parse(localStorage.getItem("user") || "{}").sessionId;
      socket.emit("history_update", { sessionId, history });
    } catch(e) {}
  }, [history]);

  useEffect(() => { try { localStorage.setItem("lotteryWinnerTitles", JSON.stringify(lotteryWinnerTitles)); } catch(e) {} }, [lotteryWinnerTitles]);
  useEffect(() => { try { localStorage.setItem("lotteryHistory", JSON.stringify(lotteryHistory)); } catch(e) {} }, [lotteryHistory]);

  useEffect(() => {
    if (!adminMode) return;
    const interval = setInterval(() => {
      socket.emit("admin_view_users");
      socket.emit("admin_get_lottery_history");
      socket.emit("admin_get_active_matches");
    }, 3000);
    return () => clearInterval(interval);
  }, [adminMode]);

  // --- 各種ハンドラ（既存のまま保持） ---
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
    setUser(null);
    setLoggedIn(false);
    setSearching(false);
    setOpponent(null);
    setDeskNum(null);
    setLotteryWinnerTitles([]);
    setLotteryHistory([]);
    setHistory([]);
    setName("");
  };

  const handleToggleMatch = () => socket.emit("admin_toggle_match", { enable: !matchEnabled });
  const handleDrawLots = () => socket.emit("admin_draw_lots", { count: drawCount, minBattles: minMatches, minLoginMinutes: minLoginHours * 60, title: lotteryTitle });
  const handleAdminLogoutAll = () => socket.emit("admin_logout_all");
  const handleUpdateAutoLogout = () => { if (autoLogoutHours <= 0.01) return alert("1時間以上を指定してください"); socket.emit("admin_set_auto_logout", { hours: autoLogoutHours }); };
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
    try { localStorage.removeItem("lotteryHistory"); } catch(e) {}
    socket.emit("admin_clear_lottery_history");
  };



  const displayHistory = history || [];

  // --- JSX 全部 ---
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
          <div className="header">管理者画面</div>

          {/* --- マッチング --- */}
          <div className="admin-section">
            <button className="main-btn" onClick={handleToggleMatch}>
              {matchEnabled ? "マッチング中" : "マッチング開始"}
            </button>
          </div>

          {/* --- 抽選 --- */}
          <div className="admin-section">
            <h3>抽選</h3>
            <label>
              抽選名:
              <input type="text" value={lotteryTitle} onChange={e => setLotteryTitle(e.target.value)} />
              <button className="main-btn" onClick={() => socket.emit("admin_set_lottery_title", { title: lotteryTitle })}>設定</button>
            </label>
            <label>
              抽選人数:
              <input type="number" min="1" value={drawCount} onChange={e => setDrawCount(Number(e.target.value))} />
            </label>
            <label>
              対戦数以上:
              <input type="number" min="0" value={minMatches} onChange={e => setMinMatches(Number(e.target.value))} />
            </label>
            <label>
              ログイン時間以上(時間):
              <input type="number" min="0" value={minLoginHours} onChange={e => setMinLoginHours(Number(e.target.value))} />
            </label>
            <button className="main-btn" onClick={handleDrawLots}>抽選する</button>
            <ul>
              {Array.isArray(drawResult) && drawResult.map((u, i) => <li key={i}>{u.name}</li>)}
            </ul>
          </div>

          {/* --- 抽選履歴 --- */}
          <div className="admin-section">
            <h3>抽選履歴</h3>
            {lotteryHistory.length === 0 ? (
              <p style={{ color: "lightgray" }}>まだ抽選履歴はありません</p>
            ) : (
              <>
                <table style={{ color: "white", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th>抽選名</th>
                      <th>当選者</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotteryHistory.map((l, idx) => (
                      <tr key={idx}>
                        <td>{l.title}</td>
                        <td>
                          {(Array.isArray(l.winners) ? l.winners : []).map((w, i) => (
                            <span key={i}>{w.name}{i < l.winners.length - 1 ? ", " : ""}</span>
                          ))}
                          <button className="main-btn" style={{ marginLeft: "8px" }} onClick={() => handleDeleteLotteryEntry(idx)}>削除</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: "10px" }}>
                  <button className="main-btn" onClick={handleClearLotteryHistory}>抽選履歴をすべて削除</button>
                </div>
              </>
            )}
          </div>

          {/* --- 自動ログアウト設定 --- */}
          <div className="admin-section">
            <h3>自動ログアウト設定</h3>
            <label>
              ログインからの時間(時間):
              <input type="number" min="1" value={autoLogoutHours} onChange={e => setAutoLogoutHours(Number(e.target.value))} />
            </label>
            <button className="main-btn" onClick={handleUpdateAutoLogout}>更新</button>
          </div>

          {/* --- ログイン中ユーザー --- */}
          <div className="admin-section">
            <h3>ログイン中のユーザー</h3>
            <table style={{ color: "white", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th>番号</th>
                  <th>名前</th>
                  <th>対戦数</th>
                  <th>勝</th>
                  <th>敗</th>
                  <th>ログイン時間</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {usersList.map((u, index) => {
                  const win = u.history ? u.history.filter(h => h.result === "WIN").length : 0;
                  const lose = u.history ? u.history.filter(h => h.result === "LOSE").length : 0;
                  const loginTime = u.loginTime ? new Date(u.loginTime).toLocaleString() : "未ログイン";
                  return (
                    <tr key={u.id}>
                      <td>{index + 1}</td>
                      <td>{u.name}</td>
                      <td>{u.history?.length || 0}</td>
                      <td>{win}</td>
                      <td>{lose}</td>
                      <td>{loginTime}</td>
                      <td>
                        <button className="main-btn" onClick={() => handleLogoutUser(u.id, u.name)}>ログアウト</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button className="main-btn" onClick={handleAdminLogoutAll}>全ユーザーをログアウト</button>
          </div>

          {/* --- 対戦中部屋一覧 --- */}
          <div className="admin-section">
            <h3>対戦中の部屋一覧</h3>
            {activeMatches.length === 0 ? (
              <p style={{ color: "lightgray" }}>現在対戦中の部屋はありません</p>
            ) : (
              <table style={{ color: "white", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th>卓番号</th>
                    <th>プレイヤー1</th>
                    <th>プレイヤー2</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {activeMatches.map((m, i) => (
                    <tr key={i}>
                      <td>{m.deskNum}</td>
                      <td>{m.player1}</td>
                      <td>{m.player2}</td>
                      <td>
                        <button className="main-btn" onClick={() => handleAdminReportWin(m.player1SessionId, m.deskNum)}>プレイヤー1勝利</button>
                        <button className="main-btn" onClick={() => handleAdminReportWin(m.player2SessionId, m.deskNum)}>プレイヤー2勝利</button>
                        <button className="main-btn" onClick={() => handleAdminReportBothLose(m.deskNum)}>両者敗北</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="admin-section">
            <button className="main-btn" onClick={handleAdminLogout}>管理者画面からログアウト</button>
          </div>
        </div>
      ) : opponent ? (
        <div className="battle-screen">
          <h3>対戦相手: {opponent.name}</h3>
          <div>卓番号: {deskNum}</div>
          <button className="main-btn" onClick={handleWinReport}>勝利報告</button>
        </div>
      ) : (
        <div className="menu-screen">
          <div className="header">{user?.name}</div>
          {!searching && matchEnabled && <button className="main-btn" onClick={handleFindOpponent}>対戦相手を探す</button>}
          {searching && <button className="main-btn" onClick={handleCancelSearch}>対戦相手を探しています…</button>}
          {!matchEnabled && <div className="match-disabled">マッチング時間外です</div>}

          {lotteryList && Array.isArray(lotteryList) && (
            <div style={{ marginTop: "15px", textAlign: "center" }}>
              <button className="main-btn" onClick={() => setShowLottery(!showLottery)}>
                {showLottery ? "抽選結果を閉じる" : "抽選結果"}
              </button>
              {showLottery && (
                <div style={{ marginTop: "10px", color: "yellow" }}>
                  {lotteryList.length === 0 ? (
                    <p style={{ color: "lightgray" }}>発表されていません</p>
                  ) : (
                    <>
                      {lotteryWinnerTitles.slice().reverse().map((title, idx) => (
                        <p key={idx} style={{ color: "red", fontWeight: "bold" }}>「{title}」が当選しました！</p>
                      ))}
                      {lotteryList.slice().reverse().map((lottery, idx) => (
                        <div key={idx} style={{ marginBottom: "10px" }}>
                          <h4>{lottery?.title || "抽選"} 当選者一覧</h4>
                          <ul>
                            {(Array.isArray(lottery?.winners) ? lottery.winners : []).map((w, i) => (
                              <li key={i}>{w?.name || "未登録"}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: lotteryList.length > 0 ? "15px" : "0px" }}>
            <div className="history-list">
              <h4>対戦履歴</h4>
              <table>
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>対戦相手</th>
                    <th>結果</th>
                    <th>日時</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>{h.opponent}</td>
                      <td className={h.result === "WIN" ? "win" : h.result === "LOSE" ? "lose" : ""}>{h.result}</td>
                      <td>{h.endTime ? new Date(h.endTime).toLocaleString() : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ textAlign: "center", marginTop: "10px" }}>
              <button className="main-btn" onClick={handleLogout}>ログアウト</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
