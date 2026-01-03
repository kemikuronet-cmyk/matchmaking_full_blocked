import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";

const socket = io("/");

function App() {
  // -------------------------
  // 状態管理
  // -------------------------
  const [name, setName] = useState("");
  const [user, setUser] = useState(null);
  const [adminMode, setAdminMode] = useState(false);
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
  const [autoLogoutHours, setAutoLogoutHours] = useState(1);
  const heartbeatTimer = useRef(null);
  const reconnectIntervalRef = useRef(null);

  // -------------------------
  // Socket イベント登録 / クリーンアップ
  // -------------------------
  useEffect(() => {
    const onLoginOk = (data) => setUser(data.user);
    const onAdminOk = () => setAdminMode(true);
    const onAdminFail = () => alert("管理者パスワードが違います");
    const onMatched = (data) => { setOpponent(data.opponent); setDeskNum(data.deskNum); };
    const onReturnToMenu = () => { setOpponent(null); setDeskNum(null); setSearching(false); };
    const onHistory = (data) => setHistory(data.history || []);
    const onUpdateLotteryList = (data) => setLotteryResults(data.list || []);

    socket.on("login_ok", onLoginOk);
    socket.on("matched", onMatched);
    socket.on("return_to_menu_battle", onReturnToMenu);
    socket.on("history", onHistory);
    socket.on("admin_ok", onAdminOk);
    socket.on("admin_fail", onAdminFail);
    socket.on("update_lottery_list", onUpdateLotteryList);

    return () => {
      socket.off("login_ok", onLoginOk);
      socket.off("matched", onMatched);
      socket.off("return_to_menu_battle", onReturnToMenu);
      socket.off("history", onHistory);
      socket.off("admin_ok", onAdminOk);
      socket.off("admin_fail", onAdminFail);
      socket.off("update_lottery_list", onUpdateLotteryList);

      if (heartbeatTimer.current) { clearInterval(heartbeatTimer.current); heartbeatTimer.current = null; }
      if (reconnectIntervalRef.current) { clearInterval(reconnectIntervalRef.current); reconnectIntervalRef.current = null; }
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
    if (!adminPassword) return alert("パスワードを入力してください");
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
    setName("");
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
    if (!window.confirm("あなたの勝ちで登録しますか？")) return;
    socket.emit("report_win_request");
  };

  // -------------------------
  // ユーザー集計
  // -------------------------
  const userWins = (history || []).filter(h => h.result === "WIN").length;
  const userLosses = (history || []).filter(h => h.result === "LOSE").length;
  const userMatches = (history || []).length;

  // -------------------------
  // JSX 描画
  // -------------------------
  return (
    <div className="app">
      {/* 管理者ログイン右上 */}
      {!adminMode && !user && (
        <div className="admin-login-topright">
          <input
            type="password"
            placeholder="管理者パスワード"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
          <button onClick={handleAdminLogin}>管理者ログイン</button>
        </div>
      )}

      {/* ログイン画面 */}
      {!user && !adminMode && (
        <div className="user-login-center">
          <h2>ユーザー名でログイン</h2>
          <input
            type="text"
            placeholder="ユーザー名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="main-btn" onClick={handleLogin}>ログイン</button>
        </div>
      )}

      {/* 管理者画面 */}
      {adminMode && (
        <div className="admin-panel">
          <h2>管理者メニュー</h2>

          <div className="admin-controls">
            <button className="admin-btn" onClick={() => alert("卓一覧更新")}>卓一覧を更新</button>
            <button className="admin-btn" onClick={() => alert("ユーザー一覧更新")}>ユーザー一覧を更新</button>
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
                    {d.players?.map(p => p.name).join(" vs ")}
                    <button className="admin-btn">勝者登録</button>
                    <button className="admin-btn">卓を削除</button>
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
              <button className="admin-btn">抽選を実行</button>
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

          <button className="main-btn" onClick={handleLogout}>ログアウト</button>
        </div>
      )}

      {/* ユーザー画面 */}
      {user && !adminMode && (
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

          <button className="main-btn" onClick={handleLogout}>ログアウト</button>
        </div>
      )}
    </div>
  );
}

export default App;
