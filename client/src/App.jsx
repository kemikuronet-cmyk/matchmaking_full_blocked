import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import "./App.css";

const socket = io("/"); // 本番サーバに接続

function App() {
  const [name, setName] = useState("");
  const [user, setUser] = useState(null);
  const [loggedIn, setLoggedIn] = useState(false);
  const [adminMode, setAdminMode] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [searching, setSearching] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState(null);
  const [history, setHistory] = useState([]);
  const [lotteryTitle, setLotteryTitle] = useState("");
  const [lotteryCount, setLotteryCount] = useState(1);
  const [lotteryResults, setLotteryResults] = useState([]);
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [matchEnabled, setMatchEnabled] = useState(true);
  const [desks, setDesks] = useState([]);
  const heartbeatTimer = useRef(null);
  const reconnectIntervalRef = useRef(null);

  // -------------------------
  // Socket.io イベント登録
  // -------------------------
  useEffect(() => {
    const onLoginOk = (data) => {
      setUser(data.user);
      setLoggedIn(true);
      setHistory(data.history || []);
      setLotteryHistory(data.lotteryHistory || []);
    };

    const onMatched = (data) => {
      setOpponent(data.opponent);
      setDeskNum(data.deskNum);
      setSearching(false);
    };

    const onReturnToMenu = () => {
      setOpponent(null);
      setDeskNum(null);
      setSearching(false);
    };

    const onHistory = (data) => setHistory(data || []);
    const onAdminActiveMatches = (data) => setDesks(data || []);
    const onAdminLotteryHistory = (data) => setLotteryHistory(data || []);
    const onLotteryWinner = (data) => setLotteryResults(prev => [data, ...prev]);

    // イベント登録
    socket.on("login_ok", onLoginOk);
    socket.on("matched", onMatched);
    socket.on("return_to_menu_battle", onReturnToMenu);
    socket.on("history", onHistory);
    socket.on("admin_active_matches", onAdminActiveMatches);
    socket.on("admin_lottery_history", onAdminLotteryHistory);
    socket.on("lottery_winner", onLotteryWinner);

    // クリーンアップ
    return () => {
      socket.off("login_ok", onLoginOk);
      socket.off("matched", onMatched);
      socket.off("return_to_menu_battle", onReturnToMenu);
      socket.off("history", onHistory);
      socket.off("admin_active_matches", onAdminActiveMatches);
      socket.off("admin_lottery_history", onAdminLotteryHistory);
      socket.off("lottery_winner", onLotteryWinner);
    };
  }, []);

  // -------------------------
  // ハンドラ関数
  // -------------------------
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
    setUser(null);
    setLoggedIn(false);
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

  const handleLogout = () => {
    if (!window.confirm("ログアウトしますか？")) return;
    socket.emit("logout");
    setUser(null);
    setLoggedIn(false);
    setOpponent(null);
    setDeskNum(null);
    setLotteryResults([]);
    setLotteryHistory([]);
    setHistory([]);
    setName("");
  };

  const handleDrawLots = () => {
    if (!lotteryTitle) return alert("タイトルを入力してください");
    socket.emit("admin_draw_lots", { title: lotteryTitle, count: lotteryCount });
  };

  // -------------------------
  // ユーザー集計
  // -------------------------
  const userWins = (history || []).filter(h => h.result === "WIN").length;
  const userLosses = (history || []).filter(h => h.result === "LOSE").length;
  const userMatches = (history || []).length;

  // -------------------------
  // JSX
  // -------------------------
  return (
    <div className="app">
      {!adminMode && !user && (
        <div className="admin-login-topright">
          <input
            type="password"
            placeholder="管理者パスワード"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
          <button onClick={handleAdminLogin}>管理者</button>
        </div>
      )}

      <div className="main-container">
        {!user && !adminMode && (
          <div className="user-login-center">
            <h2>ユーザーログイン</h2>
            <input type="text" placeholder="ユーザー名" value={name} onChange={e => setName(e.target.value)} />
            <button onClick={handleLogin}>ログイン</button>
          </div>
        )}

        {adminMode && (
          <div className="admin-panel">
            <h2>管理者メニュー</h2>

            <div className="desk-section">
              <h3>対戦卓一覧</h3>
              {desks.length === 0 ? <p>現在、稼働中の卓はありません</p> :
                <ul>{desks.map((d,i) => (
                  <li key={i}>
                    <strong>卓 {d.deskNum}</strong>：{d.players?.map(p => p.name).join(" vs ")}
                  </li>
                ))}</ul>
              }
            </div>

            <div className="lottery-admin-section">
              <h3>抽選機能</h3>
              <input type="text" placeholder="抽選タイトル" value={lotteryTitle} onChange={e => setLotteryTitle(e.target.value)} />
              <input type="number" placeholder="当選人数" value={lotteryCount} onChange={e => setLotteryCount(Number(e.target.value))} />
              <button onClick={handleDrawLots}>抽選を実行</button>

              <h4>抽選履歴</h4>
              {lotteryHistory.length === 0 ? <p>抽選履歴なし</p> :
                <ul>{lotteryHistory.map((lot,i) => <li key={i}>{lot.title}: {lot.winners?.map(w => w.name).join(", ")}</li>)}</ul>
              }
            </div>

            <button className="logout-btn" onClick={handleAdminLogout}>ログアウト</button>
          </div>
        )}

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
                  <button onClick={handleFindOpponent}>マッチング開始</button>
                ) : (
                  <button onClick={handleCancelSearch}>キャンセル</button>
                )}
              </div>
            )}

            {opponent && (
              <div className="battle-info">
                <h3>対戦相手：{opponent?.name}</h3>
                <p>卓番号：{deskNum}</p>
                <button onClick={handleWinReport}>勝利報告</button>
              </div>
            )}

            <div className="history-section">
              <h3>対戦履歴</h3>
              {history.length === 0 ? <p>対戦履歴がありません</p> :
                <ul className="history-list">{history.map((h,i) => <li key={i}><strong>{h.opponent}</strong>：{h.result}</li>)}</ul>
              }
            </div>

            <div className="lottery-user-section">
              <h3>抽選結果</h3>
              {lotteryHistory.length === 0 ? <p>抽選履歴なし</p> :
                <ul>{lotteryHistory.map((entry,i) => (
                  <li key={i}>
                    <strong>{entry.title}</strong>
                    <ul>{entry.winners?.map((w,j) => (
                      <li key={j} style={w.id === user?.id ? { color:"red", fontWeight:"bold"}:{}}>{w.name} {w.id===user?.id&&"（当選）"}</li>
                    ))}</ul>
                  </li>
                ))}</ul>
              }
            </div>

            <button className="main-btn" onClick={handleLogout}>ログアウト</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
