import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css"; // 背景画像やボタンなどのCSSを含む

const SERVER_URL = "/"; // 本番環境では適宜調整
const AUTO_RECONNECT_INTERVAL = 30000; // 30秒ごとに再接続チェック

function App() {
  const [socket, setSocket] = useState(null);
  const [user, setUser] = useState(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [name, setName] = useState("");
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [matchEnabled, setMatchEnabled] = useState(false);
  const [searching, setSearching] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState(null);
  const [history, setHistory] = useState([]);
  const [usersList, setUsersList] = useState([]);
  const [desks, setDesks] = useState([]);
  const [lotteryTitle, setLotteryTitle] = useState("");
  const [lotteryCount, setLotteryCount] = useState(1);
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [lotteryResults, setLotteryResults] = useState([]);

  const heartbeatTimer = useRef(null);
  const reconnectIntervalRef = useRef(null);

  // ------------------- Socket.io接続 -------------------
  useEffect(() => {
    const s = io(SERVER_URL);
    setSocket(s);

    s.on("connect", () => console.log("✅ Connected:", s.id));

    // ユーザーログイン成功
    s.on("login_ok", (data) => {
      setUser(data);
      setName(data.name || "");
      setHistory(data.history || []);
      setLoggedIn(true);
    });

    // 管理者ログイン成功
    s.on("admin_ok", () => setAdminMode(true));
    s.on("admin_fail", () => alert("管理者パスワードが間違っています"));

    // マッチングステータス
    s.on("match_status", ({ enabled }) => setMatchEnabled(enabled));

    // マッチング成立
    s.on("matched", ({ opponent: opp, deskNum }) => {
      setOpponent(opp);
      setDeskNum(deskNum);
      setSearching(false);
    });

    // 勝利報告フロー
    s.on("confirm_opponent_win", ({ deskNum, winnerName }) => {
      if (window.confirm(`${winnerName}が勝利報告しました。結果を受け入れますか？`)) {
        s.emit("opponent_win_confirmed", { accepted: true });
      } else {
        s.emit("opponent_win_confirmed", { accepted: false });
      }
    });

    s.on("win_report_cancelled", () => alert("勝利報告がキャンセルされました"));
    s.on("return_to_menu_battle", () => {
      setOpponent(null);
      setDeskNum(null);
    });

    s.on("history", (hist) => setHistory(hist || []));

    // 管理者用データ
    s.on("admin_user_list", (list) => setUsersList(list || []));
    s.on("admin_active_matches", (list) => setDesks(list || []));
    s.on("admin_lottery_history", (hist) => setLotteryHistory(hist || []));
    s.on("admin_draw_result", ({ title, winners }) => setLotteryResults([{ title, winners }]));

    // 抽選結果
    s.on("lottery_winner", ({ title }) => alert(`抽選「${title}」で当選しました！`));

    // 背景のWebSocket心拍
    heartbeatTimer.current = setInterval(() => {
      if (user?.sessionId) s.emit("heartbeat", { sessionId: user.sessionId });
    }, 30000);

    return () => {
      s.disconnect();
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
      clearInterval(reconnectIntervalRef.current);
      reconnectIntervalRef.current = null;
    };
  }, []);

  // ------------------- ハンドラ -------------------
  const handleLogin = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return alert("ユーザー名を入力してください");

    const saved = (() => { try { return JSON.parse(localStorage.getItem("user") || "{}"); } catch { return {}; } })();
    const sessionId = saved?.sessionId || localStorage.getItem("sessionId");
    const recentOpponents = saved?.recentOpponents || [];

    socket.emit("login", { name: trimmedName, sessionId, recentOpponents, history });
  };

  const handleAdminLogin = () => {
    if (!adminPassword) return alert("パスワードを入力してください");
    socket.emit("admin_login", { password: adminPassword });
  };

  const handleLogout = () => {
    if (!window.confirm("ログアウトしますか？")) return;
    socket.emit("logout");
    localStorage.clear();
    setUser(null);
    setLoggedIn(false);
    setOpponent(null);
    setDeskNum(null);
    setHistory([]);
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
    socket.emit("report_win_request");
  };

  const handleAdminToggleMatch = () => socket.emit("admin_toggle_match", { enable: !matchEnabled });
  const handleAdminLogoutUser = (userId) => { if (window.confirm("このユーザーをログアウトしますか？")) socket.emit("admin_logout_user", { userId }); };
  const handleAdminWin = (deskNum) => { if (window.confirm("この卓の勝者を登録しますか？")) socket.emit("admin_report_win", { winnerSessionId: null, deskNum }); };

  const drawLottery = (count, minBattles, minLoginMinutes, title) => socket.emit("admin_draw_lots", { count, minBattles, minLoginMinutes, title });

  // ------------------- JSX -------------------
  return (
    <div className="app">
      {/* 管理者ログイン */}
      {!adminMode && (
        <div className="admin-login-topright">
          <input type="password" placeholder="管理者パスワード" value={adminPassword} onChange={e => setAdminPassword(e.target.value)} />
          <button onClick={handleAdminLogin}>Admin</button>
        </div>
      )}

      {/* ユーザー画面 */}
      {!adminMode && !loggedIn && (
        <div className="user-login-center">
          <h2>ユーザー名でログイン</h2>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="名前" />
          <button onClick={handleLogin} className="main-btn">ログイン</button>
        </div>
      )}

      {!adminMode && loggedIn && (
        <div className="user-menu">
          <h2>{user?.name} さん</h2>

          <div className="user-stats">
            <p>勝ち：{user?.wins ?? 0}</p>
            <p>負け：{user?.losses ?? 0}</p>
            <p>対戦数：{user?.totalBattles ?? 0}</p>
          </div>

          {!opponent && !deskNum && (
            <div className="match-controls">
              {!searching ? (
                <button className="main-btn" onClick={handleFindOpponent}>マッチング開始</button>
              ) : (
                <button className="cancel-btn" onClick={handleCancelSearch}>キャンセル</button>
              )}
            </div>
          )}

          {opponent && (
            <div className="battle-info">
              <h3>対戦相手：{opponent?.name}</h3>
              <p>卓番号：{deskNum}</p>
              <button className="main-btn" onClick={handleWinReport}>勝利報告</button>
            </div>
          )}

          {/* 対戦履歴 */}
          <details>
            <summary>対戦履歴</summary>
            <ul className="history-list">
              {history.map((h, i) => (
                <li key={i}><strong>{h.opponent}</strong>：{h.result}</li>
              ))}
            </ul>
          </details>

          {/* 抽選結果 */}
          <details>
            <summary>抽選履歴</summary>
            <ul className="lottery-user-history">
              {lotteryHistory.map((entry, idx) => (
                <li key={idx}>
                  <strong>{entry.title}</strong>
                  <ul>
                    {entry.winners?.map((w, i) => (
                      <li key={i} style={w.id === user?.id ? { color: "red", fontWeight: "bold" } : {}}>
                        {w.name} {w.id === user?.id && "（当選）"}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </details>

          <button className="main-btn" onClick={handleLogout}>ログアウト</button>
        </div>
      )}

      {/* 管理者画面 */}
      {adminMode && (
        <div className="admin-panel">
          <h2>管理者メニュー</h2>

          <div className="admin-controls">
            <button onClick={handleAdminToggleMatch} className="admin-btn">{matchEnabled ? "マッチング停止" : "マッチング開始"}</button>
          </div>

          <div className="desk-section">
            <h3>対戦卓一覧</h3>
            {desks.length === 0 ? <p>現在、稼働中の卓はありません</p> : (
              <ul>
                {desks.map((d, i) => (
                  <li key={i}>
                    卓 {d.deskNum}：{d.player1} vs {d.player2}
                    <button onClick={() => handleAdminWin(d.deskNum)}>勝利登録</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="users-section">
            <h3>ログインユーザー一覧</h3>
            {usersList.length === 0 ? <p>ユーザーなし</p> : (
              <ul>
                {usersList.map(u => (
                  <li key={u.id}>
                    {u.name} ({u.status})
                    <button onClick={() => handleAdminLogoutUser(u.id)}>ログアウト</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="lottery-admin-section">
            <h3>抽選履歴</h3>
            <ul>
              {lotteryHistory.map((rec, i) => (
                <li key={i}>{rec.title} ({new Date(rec.time).toLocaleString()}): {rec.winners.map(w => w.name).join(", ")}</li>
              ))}
            </ul>
            <input type="text" value={lotteryTitle} onChange={e => setLotteryTitle(e.target.value)} placeholder="抽選タイトル"/>
            <input type="number" value={lotteryCount} onChange={e => setLotteryCount(Number(e.target.value))} placeholder="当選人数"/>
            <button onClick={() => drawLottery(lotteryCount, 0, 0, lotteryTitle)}>抽選実行</button>
          </div>

          <button onClick={() => { if(window.confirm("管理者ログアウトしますか？")) setAdminMode(false); }}>ログアウト</button>
        </div>
      )}
    </div>
  );
}

export default App;
