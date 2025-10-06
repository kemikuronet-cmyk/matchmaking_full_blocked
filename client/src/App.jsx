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
  const [confirmWinDialog, setConfirmWinDialog] = useState(null);
  const [waitingOpponentConfirm, setWaitingOpponentConfirm] = useState(false);

  const loginAttempted = useRef(false);

  useEffect(() => {
    if (!loginAttempted.current) {
      const savedUser = localStorage.getItem("user");
      const savedAdmin = localStorage.getItem("adminMode");
      const savedTitles = localStorage.getItem("lotteryWinnerTitles");

      if (savedTitles) setLotteryWinnerTitles(JSON.parse(savedTitles));
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

    // --- Socket.ioイベント ---
    socket.on("login_ok", (u) => {
      setUser(u);
      setLoggedIn(true);
      setName(u.name);
      localStorage.setItem("user", JSON.stringify(u));
      setSearching(u.status === "searching");
      setHistory(u.history || []);
      setLotteryList(Array.isArray(u.lotteryList) ? u.lotteryList : []);
      setLotteryTitle("");
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
      setWaitingOpponentConfirm(false);
    });

    socket.on("force_logout", ({ reason }) => {
      if (reason === "auto")
        alert("一定時間が経過したため、自動ログアウトされました。");
      localStorage.removeItem("user");
      localStorage.removeItem("adminMode");
      localStorage.removeItem("lotteryWinnerTitles");
      setLoggedIn(false);
      setAdminMode(false);
      setUser(null);
      setSearching(false);
      setOpponent(null);
      setDeskNum(null);
      setLotteryWinnerTitles([]);
      setName("");
    });

    socket.on("history", (hist) => setHistory(hist));
    socket.on("match_status", ({ enabled }) => setMatchEnabled(enabled));
    socket.on("admin_ok", () => {
      setAdminMode(true);
      localStorage.setItem("adminMode", "true");
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
    socket.on("admin_current_auto_logout", ({ hours }) =>
      setAutoLogoutHours(hours)
    );
    socket.on("admin_set_auto_logout_ok", ({ hours }) => {
      setAutoLogoutHours(hours);
      alert(`自動ログアウト時間を ${hours} 時間に設定しました`);
    });
    socket.on("lottery_winner", ({ title }) => {
      setLotteryWinnerTitles((prev) => {
        if (!prev.includes(title)) return [...prev, title];
        return prev;
      });
    });
    socket.on("update_lottery_list", ({ list }) => {
      if (!list || !Array.isArray(list)) return;
      setLotteryList(list);
      setShowLottery(true);
    });
    socket.on("admin_lottery_history", (list) => setLotteryHistory(list));
    socket.on("admin_active_matches", (list) => setActiveMatches(list));

    // --- 二段階勝利報告 ---
    socket.on("confirm_opponent_win", ({ deskNum, winnerName, winnerSessionId }) => {
      if (user?.sessionId === winnerSessionId) {
        // 勝利報告したユーザー
        setWaitingOpponentConfirm(true);
      } else {
        // 相手側に確認ダイアログ
        setConfirmWinDialog({ deskNum, winnerName, winnerSessionId });
      }
    });

    return () => socket.off();
  }, [user]);

  useEffect(() => {
    localStorage.setItem("lotteryWinnerTitles", JSON.stringify(lotteryWinnerTitles));
  }, [lotteryWinnerTitles]);

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
    socket.emit("login", { name: trimmedName });
  };

  const handleAdminLogin = () => {
    if (!adminPassword) return;
    socket.emit("admin_login", { password: adminPassword });
  };

  const handleAdminLogout = () => {
    if (!window.confirm("ログイン画面に戻りますか？")) return;
    setAdminMode(false);
    localStorage.removeItem("adminMode");
  };

  const handleFindOpponent = () => {
    if (!matchEnabled) return;
    setSearching(true);
    socket.emit("find_opponent");
  };

  const handleCancelSearch = () => {
    setSearching(false);
    socket.emit("cancel_find");
  };

  const handleWinReport = () => {
    if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return;
    if (deskNum) socket.emit("report_win");
  };

  const handleConfirmOpponentWin = (accepted) => {
    if (!confirmWinDialog) return;
    socket.emit("opponent_confirm", { deskNum: confirmWinDialog.deskNum, winnerSessionId: confirmWinDialog.winnerSessionId, accepted });
    setConfirmWinDialog(null);
    if (!accepted) alert("敗北登録はキャンセルされました");
  };

  const handleLogout = () => {
    if (!window.confirm("ログアウトしますか？")) return;
    socket.emit("logout");
    localStorage.removeItem("user");
    localStorage.removeItem("adminMode");
    localStorage.removeItem("lotteryWinnerTitles");
    setUser(null);
    setLoggedIn(false);
    setSearching(false);
    setOpponent(null);
    setDeskNum(null);
    setLotteryWinnerTitles([]);
    setName("");
  };

  const handleToggleMatch = () =>
    socket.emit("admin_toggle_match", { enable: !matchEnabled });
  const handleDrawLots = () => {
    socket.emit("admin_draw_lots", {
      count: drawCount,
      minBattles: minMatches,
      minLoginMinutes: minLoginHours * 60,
    });
  };
  const handleAdminLogoutAll = () => socket.emit("admin_logout_all");
  const handleUpdateAutoLogout = () => {
    if (autoLogoutHours <= 0.01) {
      alert("1時間以上を指定してください");
      return;
    }
    socket.emit("admin_set_auto_logout", { hours: autoLogoutHours });
  };
  const handleLogoutUser = (userId, userName) => {
    if (!window.confirm(`${userName} をログアウトさせますか？`)) return;
    socket.emit("admin_logout_user", { userId });
  };
  const handleAdminReportWin = (winnerSessionId, deskNum) => {
    if (!window.confirm("この部屋の勝者を登録しますか？")) return;
    socket.emit("admin_report_win", { winnerSessionId, deskNum });
  };
  const handleAdminReportBothLose = (deskNum) => {
    if (!window.confirm("この部屋の両者を敗北として登録しますか？")) return;
    socket.emit("admin_report_both_lose", { deskNum });
  };

  const displayHistory = history || [];

  return (
    <div className="app">
      {!loggedIn && !adminMode ? (
        <div className="login-screen">
          <div className="user-login-center">
            <h2>ユーザーとしてログイン</h2>
            <input
              type="text"
              placeholder="ユーザー名"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="main-btn" onClick={handleLogin}>
              ログイン
            </button>
          </div>
          <div className="admin-login-topright">
            <input
              type="password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="管理者パスワード"
            />
            <button className="admin-btn" onClick={handleAdminLogin}>
              管理者ログイン
            </button>
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
              <input
                type="text"
                value={lotteryTitle}
                onChange={(e) => setLotteryTitle(e.target.value)}
              />
              <button
                className="main-btn"
                onClick={() =>
                  socket.emit("admin_set_lottery_title", { title: lotteryTitle })
                }
              >
                設定
              </button>
            </label>
            <label>
              抽選人数:
              <input
                type="number"
                min="1"
                value={drawCount}
                onChange={(e) => setDrawCount(Number(e.target.value))}
              />
            </label>
            <label>
              対戦数以上:
              <input
                type="number"
                min="0"
                value={minMatches}
                onChange={(e) => setMinMatches(Number(e.target.value))}
              />
            </label>
            <label>
              ログイン時間以上(時間):
              <input
                type="number"
                min="0"
                value={minLoginHours}
                onChange={(e) => setMinLoginHours(Number(e.target.value))}
              />
            </label>
            <button className="main-btn" onClick={handleDrawLots}>
              抽選する
            </button>
            <ul>
              {Array.isArray(drawResult) &&
                drawResult.map((u, i) => <li key={i}>{u.name}</li>)}
            </ul>
          </div>

          {/* --- 抽選履歴 --- */}
          <div className="admin-section">
            <h3>抽選履歴</h3>
            {lotteryHistory.length === 0 ? (
              <p style={{ color: "lightgray" }}>まだ抽選履歴はありません</p>
            ) : (
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
                        {(Array.isArray(l.winners) ? l.winners : []).map(
                          (w, i) => (
                            <span key={i}>
                              {w.name}
                              {i < l.winners.length - 1 ? ", " : ""}
                            </span>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* --- 自動ログアウト設定 --- */}
          <div className="admin-section">
            <h3>自動ログアウト設定</h3>
            <label>
              ログインからの時間(時間):
              <input
                type="number"
                min="1"
                value={autoLogoutHours}
                onChange={(e) => setAutoLogoutHours(Number(e.target.value))}
              />
            </label>
            <button className="main-btn" onClick={handleUpdateAutoLogout}>
              更新
            </button>
          </div>

          {/* --- ログアウト --- */}
          <div className="admin-section">
            <button className="main-btn" onClick={handleAdminLogoutAll}>
              全ユーザー強制ログアウト
            </button>
          </div>

          {/* --- ユーザー一覧 --- */}
          <div className="admin-section">
            <h3>ユーザー一覧</h3>
            <ul>
              {Array.isArray(usersList) &&
                usersList.map((u) => (
                  <li key={u.id}>
                    {u.name} ({u.status})
                    <button
                      className="admin-btn"
                      onClick={() => handleLogoutUser(u.id, u.name)}
                    >
                      強制ログアウト
                    </button>
                  </li>
                ))}
            </ul>
          </div>

          {/* --- 対戦中部屋一覧 --- */}
          <div className="admin-section">
            <h3>対戦中部屋</h3>
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
                {activeMatches.map((m) => (
                  <tr key={m.deskNum}>
                    <td>{m.deskNum}</td>
                    <td>{m.player1}</td>
                    <td>{m.player2}</td>
                    <td>
                      <button
                        className="admin-btn"
                        onClick={() => handleAdminReportWin(m.player1SessionId, m.deskNum)}
                      >
                        {m.player1} 勝利登録
                      </button>
                      <button
                        className="admin-btn"
                        onClick={() => handleAdminReportWin(m.player2SessionId, m.deskNum)}
                      >
                        {m.player2} 勝利登録
                      </button>
                      <button
                        className="admin-btn"
                        onClick={() => handleAdminReportBothLose(m.deskNum)}
                      >
                        両者敗北
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button className="main-btn" onClick={handleAdminLogout}>
            管理者ログアウト
          </button>
        </div>
      ) : (
        <div className="menu-screen">
          <h2>ようこそ {user?.name}</h2>

          {opponent ? (
            <div>
              <h3>対戦中: {opponent.name}</h3>
              <p>卓番号: {deskNum}</p>
              {!waitingOpponentConfirm ? (
                <button className="main-btn" onClick={handleWinReport}>
                  勝利報告
                </button>
              ) : (
                <p>相手の確認を待っています...</p>
              )}
            </div>
          ) : searching ? (
            <div>
              <p>対戦相手を探しています...</p>
              <button className="main-btn" onClick={handleCancelSearch}>
                検索キャンセル
              </button>
            </div>
          ) : (
            <div>
              <button className="main-btn" onClick={handleFindOpponent}>
                対戦相手を探す
              </button>
              <h3>履歴</h3>
              {displayHistory.length === 0 ? (
                <p style={{ color: "lightgray" }}>履歴はありません</p>
              ) : (
                <ul>
                  {displayHistory.map((h, i) => (
                    <li key={i}>
                      {h.opponent}: {h.result}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <h3>抽選</h3>
          {showLottery && lotteryList.length > 0 && (
            <ul>
              {lotteryList.map((l, idx) => (
                <li key={idx}>
                  {l.title}:{" "}
                  {(Array.isArray(l.winners) ? l.winners : []).map((w, i) => (
                    <span key={i}>
                      {w.name}
                      {i < l.winners.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          )}

          {confirmWinDialog && (
            <div className="confirm-dialog">
              <p>
                {confirmWinDialog.winnerName} の勝利を登録しますか？
              </p>
              <button
                className="main-btn"
                onClick={() => handleConfirmOpponentWin(true)}
              >
                はい
              </button>
              <button
                className="main-btn"
                onClick={() => handleConfirmOpponentWin(false)}
              >
                いいえ
              </button>
            </div>
          )}

          <button className="main-btn" onClick={handleLogout}>
            ログアウト
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
