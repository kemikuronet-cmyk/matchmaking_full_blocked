import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";

const socket = io("/");

function App() {
  // -------------------------
  // ステート
  // -------------------------
  const [user, setUser] = useState(null);
  const [adminMode, setAdminMode] = useState(false);
  const [name, setName] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [searching, setSearching] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState(null);
  const [history, setHistory] = useState([]);
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [lotteryTitle, setLotteryTitle] = useState("");
  const [lotteryCount, setLotteryCount] = useState(1);
  const [desks, setDesks] = useState([]);
  const [lotteryResults, setLotteryResults] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(true);
  const [userWinsCount, setUserWinsCount] = useState(0);
  const [userLossesCount, setUserLossesCount] = useState(0);

  const heartbeatTimer = useRef(null);
  const reconnectIntervalRef = useRef(null);

  // -------------------------
  // Socket.io イベント
  // -------------------------
  useEffect(() => {
    // -------------------------
    // ユーザーイベント
    // -------------------------
    const onLoginOk = (data) => setUser(data.user);
    const onMatched = (data) => {
      setOpponent(data.opponent);
      setDeskNum(data.deskNum);
      setSearching(false);
    };
    const onReturnToMenu = () => {
      setOpponent(null);
      setDeskNum(null);
    };
    const onWinReportCancelled = () => alert("勝利報告がキャンセルされました");
    const onHistory = (data) => {
      setHistory(data);
      setUserWinsCount(data.filter(h => h.result === "WIN").length);
      setUserLossesCount(data.filter(h => h.result === "LOSE").length);
    };

    // -------------------------
    // 管理者イベント
    // -------------------------
    const onAdminOk = () => setAdminMode(true);
    const onAdminFail = () => alert("管理者ログイン失敗");
    const onAdminUserList = (data) => console.log("ユーザー一覧", data);
    const onAdminDrawResult = (data) => setLotteryResults(data);
    const onAdminActiveMatches = (data) => setDesks(data);
    const onAdminLotteryHistory = (data) => setLotteryHistory(data);

    // -------------------------
    // 抽選イベント
    // -------------------------
    const onLotteryWinner = (data) => {
      setLotteryHistory(prev => [...prev, data]);
      alert(`抽選「${data.title}」の当選者: ${data.winners.map(w => w.name).join(", ")}`);
    };

    // -------------------------
    // Socket.on
    // -------------------------
    socket.on("login_ok", onLoginOk);
    socket.on("matched", onMatched);
    socket.on("return_to_menu_battle", onReturnToMenu);
    socket.on("win_report_cancelled", onWinReportCancelled);
    socket.on("history", onHistory);

    socket.on("admin_ok", onAdminOk);
    socket.on("admin_fail", onAdminFail);
    socket.on("admin_user_list", onAdminUserList);
    socket.on("admin_draw_result", onAdminDrawResult);
    socket.on("admin_active_matches", onAdminActiveMatches);
    socket.on("admin_lottery_history", onAdminLotteryHistory);

    socket.on("lottery_winner", onLotteryWinner);

    // -------------------------
    // Heartbeat
    // -------------------------
    heartbeatTimer.current = setInterval(() => {
      socket.emit("heartbeat");
    }, 30000);

    // -------------------------
    // クリーンアップ
    // -------------------------
    return () => {
      socket.off("login_ok", onLoginOk);
      socket.off("matched", onMatched);
      socket.off("return_to_menu_battle", onReturnToMenu);
      socket.off("win_report_cancelled", onWinReportCancelled);
      socket.off("history", onHistory);
      socket.off("admin_ok", onAdminOk);
      socket.off("admin_fail", onAdminFail);
      socket.off("admin_user_list", onAdminUserList);
      socket.off("admin_draw_result", onAdminDrawResult);
      socket.off("admin_active_matches", onAdminActiveMatches);
      socket.off("admin_lottery_history", onAdminLotteryHistory);
      socket.off("lottery_winner", onLotteryWinner);

      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
      if (reconnectIntervalRef.current) clearInterval(reconnectIntervalRef.current);
    };
  }, []);

  // -------------------------
  // ハンドラ
  // -------------------------
  const handleLogin = () => {
    if (!name.trim()) return alert("ユーザー名を入力してください");
    socket.emit("login", { name: name.trim() });
  };

  const handleAdminLogin = () => {
    if (!adminPassword) return;
    socket.emit("admin_login", { password: adminPassword });
  };

  const handleLogout = () => {
    if (!window.confirm("ログアウトしますか？")) return;
    socket.emit("logout");
    setUser(null);
    setAdminMode(false);
    setOpponent(null);
    setDeskNum(null);
    setHistory([]);
    setLotteryHistory([]);
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

  const handleFetchDesks = () => socket.emit("fetch_desks");
  const handleFetchUsers = () => socket.emit("fetch_users");
  const handleRunLottery = () => {
    if (!lotteryTitle.trim() || lotteryCount <= 0) return alert("抽選タイトルと人数を正しく設定してください");
    socket.emit("run_lottery", { title: lotteryTitle, count: lotteryCount });
  };

  // -------------------------
  // JSX
  // -------------------------
  return (
    <div className="app">

      {/* 管理者ログイン右上 */}
      {!adminMode && !user && (
        <div className="admin-login-topright">
          <input
            type="password"
            placeholder="管理者パス"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
          <button onClick={handleAdminLogin}>ログイン</button>
        </div>
      )}

      {/* ログイン画面 */}
      {!user && (
        <div className="login-screen">
          <div className="user-login-center">
            <h2>ユーザーログイン</h2>
            <input
              type="text"
              placeholder="ユーザー名"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="main-btn" onClick={handleLogin}>ログイン</button>
          </div>
        </div>
      )}

      {/* 管理者画面 */}
      {adminMode && (
        <div className="admin-panel">
          <h2>管理者メニュー</h2>

          <div className="admin-controls">
            <button onClick={handleFetchDesks}>卓一覧更新</button>
            <button onClick={handleFetchUsers}>ユーザー一覧更新</button>
          </div>

          <div className="desk-section">
            <h3>対戦卓一覧</h3>
            {desks.length === 0 ? <p>現在、稼働中の卓はありません</p> : (
              <ul>
                {desks.map((d, i) => (
                  <li key={i}>
                    <strong>卓 {d.deskNum}</strong>：
                    {d.players?.map(p => p.name).join(" vs ")}
                    <button onClick={() => socket.emit("admin_report_win", { deskNum: d.deskNum })}>勝者登録</button>
                    <button onClick={() => socket.emit("admin_clear_desk", { deskNum: d.deskNum })}>卓削除</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="lottery-admin-section">
            <h3>抽選機能</h3>
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
            <button onClick={handleRunLottery}>抽選を実行</button>

            <h4>抽選履歴</h4>
            {lotteryResults.length === 0 ? <p>抽選履歴なし</p> : (
              <ul>
                {lotteryResults.map((lot, i) => (
                  <li key={i}>
                    <strong>{lot.title}</strong>
                    <ul>
                      {lot.winners?.map((w, j) => <li key={j}>{w.name}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <button className="main-btn" onClick={handleLogout}>ログアウト</button>
        </div>
      )}

      {/* ユーザー画面 */}
      {user && !adminMode && (
        <div className="user-menu">
          <h2>ようこそ {user.name} さん</h2>

          <div className="user-stats">
            <p>勝ち：{userWinsCount}</p>
            <p>負け：{userLossesCount}</p>
            <p>対戦数：{history.length}</p>
          </div>

          {!opponent && !deskNum && (
            <div className="match-controls">
              {!searching ? (
                <button className="main-btn" onClick={handleFindOpponent}>マッチング開始</button>
              ) : (
                <button className="main-btn" onClick={handleCancelSearch}>キャンセル</button>
              )}
            </div>
          )}

          {opponent && (
            <div className="battle-info">
              <h3>対戦相手：{opponent.name}</h3>
              <p>卓番号：{deskNum}</p>
              <button className="main-btn" onClick={handleWinReport}>勝利報告</button>
            </div>
          )}

          <div className="history-section">
            <h3>対戦履歴</h3>
            {history.length === 0 ? <p>対戦履歴がありません</p> : (
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
            {lotteryHistory.length === 0 ? <p>抽選履歴なし</p> : (
              <ul className="lottery-user-history">
                {lotteryHistory.map((entry, i) => (
                  <li key={i}>
                    <strong>{entry.title}</strong>
                    <ul>
                      {entry.winners?.map((w, j) => (
                        <li key={j} style={w.id === user.id ? { color: "red", fontWeight: "bold" } : {}}>
                          {w.name}{w.id === user.id && "（当選）"}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div style={{ textAlign: "center", marginTop: 10 }}>
            <button className="main-btn" onClick={handleLogout}>ログアウト</button>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
