import React, { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";

const socket = io("/");

function App() {
  // -------------------------
  // State
  // -------------------------
  const [name, setName] = useState("");
  const [user, setUser] = useState(null);
  const [adminPassword, setAdminPassword] = useState("");
  const [adminMode, setAdminMode] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [deskNum, setDeskNum] = useState(null);
  const [searching, setSearching] = useState(false);
  const [history, setHistory] = useState([]);
  const [lotteryHistory, setLotteryHistory] = useState([]);
  const [lotteryTitle, setLotteryTitle] = useState("");
  const [lotteryCount, setLotteryCount] = useState(1);
  const [desks, setDesks] = useState([]);
  const heartbeatTimer = useRef(null);
  const reconnectIntervalRef = useRef(null);

  // -------------------------
  // Socket.io イベント受信
  // -------------------------
  useEffect(() => {
    // ユーザー関連
    socket.on("login_ok", (userData) => {
      setUser(userData);
      setName(userData.name || "");
      console.log("ログイン成功", userData);
    });

    socket.on("matched", ({ opponent, deskNum }) => {
      setOpponent(opponent);
      setDeskNum(deskNum);
      setSearching(false);
      console.log("マッチング成功", opponent, deskNum);
    });

    socket.on("return_to_menu_battle", () => {
      setOpponent(null);
      setDeskNum(null);
      console.log("対戦終了、メニューに戻る");
    });

    socket.on("confirm_opponent_win", ({ deskNum }) => {
      alert(`相手が勝利を報告しました 卓番号: ${deskNum}`);
    });

    socket.on("win_report_cancelled", () => {
      alert("勝利報告はキャンセルされました");
    });

    socket.on("force_logout", () => {
      alert("強制ログアウトされました");
      setUser(null);
      setOpponent(null);
      setDeskNum(null);
    });

    socket.on("history", (hist) => {
      setHistory(hist);
    });

    socket.on("match_status", ({ searching }) => {
      setSearching(searching);
    });

    // 管理者関連
    socket.on("admin_ok", () => setAdminMode(true));
    socket.on("admin_fail", () => alert("管理者パスワードが間違っています"));
    socket.on("admin_user_list", (list) => console.log("管理者ユーザー一覧", list));
    socket.on("admin_active_matches", (activeDesks) => setDesks(activeDesks));

    socket.on("admin_draw_result", ({ title, winners }) => {
      setLotteryHistory(prev => [...prev, { title, winners }]);
    });

    socket.on("lottery_winner", ({ title, winners }) => {
      setLotteryHistory(prev => [...prev, { title, winners }]);
    });

    socket.on("admin_lottery_history", (historyList) => setLotteryHistory(historyList));

    socket.on("admin_current_auto_logout", (hours) => console.log("自動ログアウト時間", hours));
    socket.on("admin_set_auto_logout_ok", () => alert("自動ログアウト設定完了"));
    socket.on("admin_set_lottery_title_ok", () => alert("抽選タイトル設定完了"));

    // Cleanup
    return () => {
      socket.off("login_ok");
      socket.off("matched");
      socket.off("return_to_menu_battle");
      socket.off("confirm_opponent_win");
      socket.off("win_report_cancelled");
      socket.off("force_logout");
      socket.off("history");
      socket.off("match_status");
      socket.off("admin_ok");
      socket.off("admin_fail");
      socket.off("admin_user_list");
      socket.off("admin_active_matches");
      socket.off("admin_draw_result");
      socket.off("lottery_winner");
      socket.off("admin_lottery_history");
      socket.off("admin_current_auto_logout");
      socket.off("admin_set_auto_logout_ok");
      socket.off("admin_set_lottery_title_ok");
    };
  }, []);

  // -------------------------
  // ハンドラ関数
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
    setOpponent(null);
    setDeskNum(null);
    setName("");
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
    if (!window.confirm("あなたの勝ちで登録します。よろしいですか？")) return;
    socket.emit("report_win_request");
  };

  const handleAdminWin = (desk) => {
    if (!window.confirm("この卓の勝者を登録しますか？")) return;
    socket.emit("admin_report_win", { deskNum: desk });
  };

  const handleForceClearDesk = (desk) => {
    if (!window.confirm("この卓を削除しますか？")) return;
    socket.emit("admin_force_clear", { deskNum: desk });
  };

  const handleRunLottery = () => {
    if (!lotteryTitle.trim()) return alert("タイトルを入力してください");
    socket.emit("admin_draw_lots", { title: lotteryTitle, count: lotteryCount });
  };

  const handleLogoutAdmin = () => {
    setAdminMode(false);
    setAdminPassword("");
  };

  // -------------------------
  // 集計
  // -------------------------
  const userWins = (history || []).filter(h => h.result === "WIN").length;
  const userLosses = (history || []).filter(h => h.result === "LOSE").length;
  const userMatches = (history || []).length;

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
            placeholder="管理者パスワード"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
          <button onClick={handleAdminLogin}>管理者</button>
        </div>
      )}

      {/* ユーザーログイン中央 */}
      {!user && !adminMode && (
        <div className="user-login-center">
          <h2>ユーザーログイン</h2>
          <input
            type="text"
            placeholder="ユーザー名"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button onClick={handleLogin}>ログイン</button>
        </div>
      )}

      {/* 管理者画面 */}
      {adminMode && (
        <div className="admin-panel">
          <h2>管理者メニュー</h2>

          <div className="desk-section">
            <h3>対戦卓一覧</h3>
            {desks.length === 0 ? <p>稼働中の卓はありません</p> :
              <ul>{desks.map((d,i)=>(
                <li key={i}>
                  卓 {d.deskNum}: {d.players?.map(p=>p.name).join(" vs ")}
                  <button onClick={()=>handleAdminWin(d.deskNum)}>勝者登録</button>
                  <button onClick={()=>handleForceClearDesk(d.deskNum)}>卓削除</button>
                </li>
              ))}</ul>
            }
          </div>

          <div className="lottery-section">
            <h3>抽選</h3>
            <input type="text" placeholder="タイトル" value={lotteryTitle} onChange={e=>setLotteryTitle(e.target.value)} />
            <input type="number" value={lotteryCount} onChange={e=>setLotteryCount(Number(e.target.value))} />
            <button onClick={handleRunLottery}>抽選実行</button>

            <h4>抽選履歴</h4>
            <ul>
              {lotteryHistory.map((lot,i)=>(
                <li key={i}>{lot.title}: {lot.winners?.map(w=>w.name).join(", ")}</li>
              ))}
            </ul>
          </div>

          <button onClick={handleLogoutAdmin}>ログアウト</button>
        </div>
      )}

      {/* ユーザー画面 */}
      {user && !adminMode && (
        <div className="user-menu">
          <h2>ようこそ {user?.name} さん</h2>
          <p>勝ち: {user?.wins ?? userWins}</p>
          <p>負け: {user?.losses ?? userLosses}</p>
          <p>対戦数: {user?.totalBattles ?? userMatches}</p>

          {!opponent && !deskNum ? (
            <div>{!searching ?
              <button onClick={handleFindOpponent}>マッチング開始</button> :
              <button onClick={handleCancelSearch}>キャンセル</button>
            }</div>
          ) : (
            <div>
              <h3>対戦相手: {opponent?.name}</h3>
              <p>卓番号: {deskNum}</p>
              <button onClick={handleWinReport}>勝利報告</button>
            </div>
          )}

          <h3>対戦履歴</h3>
          <ul>
            {history.map((h,i)=><li key={i}>{h.opponent}: {h.result}</li>)}
          </ul>

          <h3>抽選結果</h3>
          <ul>
            {lotteryHistory.map((lot,i)=><li key={i}>{lot.title}: {lot.winners?.map(w=>w.name).join(", ")}</li>)}
          </ul>

          <button onClick={handleLogout}>ログアウト</button>
        </div>
      )}
    </div>
  );
}

export default App;
