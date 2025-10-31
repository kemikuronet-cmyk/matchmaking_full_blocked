import React, { useState, useEffect } from "react";
import io from "socket.io-client";

const socket = io();

export default function App() {
  const [username, setUsername] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [opponent, setOpponent] = useState(null);
  const [users, setUsers] = useState([]);
  const [history, setHistory] = useState([]);
  const [inMatch, setInMatch] = useState(false);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [matches, setMatches] = useState(0);
  const [lotteryName, setLotteryName] = useState("");
  const [personalMessage, setPersonalMessage] = useState("");

  // --- 自動再同期 ---
  useEffect(() => {
    const storedName = localStorage.getItem("username");
    if (storedName) {
      fetch(`/getUserState/${storedName}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setUsername(data.name);
            setWins(data.wins);
            setLosses(data.losses);
            setMatches(data.matches);
            setInMatch(data.inMatch);
            setLoggedIn(true);
          }
        });
    }
  }, []);

  // --- ソケットイベント ---
  useEffect(() => {
    socket.on("updateUsers", setUsers);
    socket.on("updateHistory", setHistory);
    socket.on("matchFound", (opp) => {
      setOpponent(opp);
      setInMatch(true);
    });
    socket.on("noMatchFound", () => alert("対戦相手が見つかりません。"));
    socket.on("personalWin", (msg) => setPersonalMessage(msg));
    socket.on("lotteryNameUpdated", (name) => setLotteryName(name));
    socket.on("lotteryResult", (res) => {
      if (res.success) alert(`${res.name}：${res.winner}さんが当選しました！`);
      else alert(res.message);
    });
    return () => {
      socket.off();
    };
  }, []);

  // --- ログイン ---
  const handleLogin = () => {
    socket.emit("login", username, (res) => {
      if (res.success) {
        setLoggedIn(true);
        localStorage.setItem("username", username);
        setWins(res.user.wins);
        setLosses(res.user.losses);
        setMatches(res.user.matches);
      } else {
        alert(res.message);
      }
    });
  };

  // --- 対戦相手を探す ---
  const findMatch = () => {
    socket.emit("findMatch", username);
  };

  // --- 勝利報告 ---
  const reportWin = () => {
    if (!opponent) return;
    socket.emit("reportWin", username, opponent);
    setOpponent(null);
    setInMatch(false);
  };

  // --- ログアウト ---
  const logout = () => {
    socket.emit("logout", username);
    setLoggedIn(false);
    localStorage.removeItem("username");
  };

  return (
    <div style={{ padding: 20 }}>
      {!loggedIn ? (
        <div>
          <h2>ログイン</h2>
          <input
            placeholder="ユーザー名"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <button onClick={handleLogin}>ログイン</button>
        </div>
      ) : (
        <div>
          <h3>{username} さん</h3>
          <p>対戦数：{matches}　勝：{wins}　敗：{losses}</p>
          {inMatch ? (
            <div>
              <p>対戦相手：{opponent}</p>
              <button onClick={reportWin}>勝利報告</button>
            </div>
          ) : (
            <button onClick={findMatch}>対戦相手を探す</button>
          )}
          <button onClick={logout}>ログアウト</button>

          {personalMessage && (
            <p style={{ color: "green" }}>{personalMessage}</p>
          )}

          <h4>管理者メニュー</h4>
          <input
            placeholder="抽選名を入力"
            value={lotteryName}
            onChange={(e) => setLotteryName(e.target.value)}
          />
          <button onClick={() => socket.emit("setLotteryName", lotteryName)}>
            抽選名を設定
          </button>
          <button onClick={() => socket.emit("runLottery")}>抽選実行</button>

          <h4>ログイン中のユーザー</h4>
          <ul>
            {users.map((u) => (
              <li key={u.name}>
                {u.name}（勝：{u.wins} / 敗：{u.losses} / 対戦：{u.matches}）
              </li>
            ))}
          </ul>

          <h4>対戦履歴</h4>
          <ul>
            {history.map((h) => (
              <li key={h.id}>
                {h.winner} が {h.loser} に勝利（{new Date(h.timestamp).toLocaleString()}）
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
