return (
  <div className="app-wrapper">
    
    {/* 管理者右上 */}
    {!adminMode && (
      <div className="admin-login-badge">
        <input
          type="password"
          placeholder="Admin Pass"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
        />
        <div className="admin-login-panel">
          <button onClick={handleAdminLogin}>管理者ログイン</button>
        </div>
      </div>
    )}

    {/* ログイン画面 */}
    {!loggedIn && !adminMode && (
      <div className="container">
        <h2>ログイン</h2>

        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ユーザー名"
        />

        <div className="button-row">
          <button onClick={handleLogin}>ログイン</button>
        </div>
      </div>
    )}

    {/* ユーザー画面 */}
    {loggedIn && !adminMode && user && (
      <div className="container">

        <div className="user-welcome">
          {user.name} さん
        </div>

        {!opponent && !deskNum && (
          <div className="button-row">
            {!searching ? (
              <button onClick={handleFindOpponent}>マッチング開始</button>
            ) : (
              <button onClick={handleCancelSearch}>キャンセル</button>
            )}
          </div>
        )}

        {opponent && (
          <div className="section-box">
            <h3>対戦中</h3>
            <p><strong>対戦相手：</strong>{opponent.name}</p>
            <p><strong>卓番号：</strong>{deskNum}</p>

            <div className="button-row">
              <button onClick={handleWinReport}>勝利報告</button>
            </div>
          </div>
        )}

        <div className="button-row">
          <button onClick={handleLogout}>ログアウト</button>
        </div>

        <div className="section-box">
          <div className="section-header">
            <span>対戦履歴</span>
          </div>

          {history.length === 0 ? (
            <p>対戦履歴なし</p>
          ) : (
            <ul>
              {history.map((h, i) => (
                <li key={i}>
                  <strong>{h.opponent}</strong>：{h.result}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="section-box">
          <div className="section-header">
            <span>抽選履歴</span>
          </div>

          {lotteryHistory.length === 0 ? (
            <p>抽選履歴なし</p>
          ) : (
            <ul>
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
      </div>
    )}

    {/* 管理者画面 */}
    {adminMode && (
      <div className="container">
        <h2>管理者メニュー</h2>

        <div className="button-row">
          <button onClick={() => setAdminMode(false)}>ログアウト</button>
        </div>

        <h3>対戦卓一覧</h3>

        {desks.length === 0 ? (
          <p>現在稼働中の卓はありません</p>
        ) : (
          <div className="table-list">
            {desks.map((d, i) => (
              <div key={i} className="table-item">
                <strong>卓 {d.deskNum}</strong>
                ：{d.player1} vs {d.player2}

                <div className="table-actions">
                  <button
                    onClick={() =>
                      socketRef.current.emit("admin_report_win", {
                        winnerSessionId: d.player1SessionId,
                        deskNum: d.deskNum,
                      })
                    }
                  >
                    勝者登録
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="section-box">
          <h3>抽選履歴</h3>
          <ul>
            {lotteryHistory.map((rec, i) => (
              <li key={i}>
                {rec.title}（{new Date(rec.time).toLocaleString()}）：
                {rec.winners.map((w) => w.name).join(", ")}
              </li>
            ))}
          </ul>
        </div>
      </div>
    )}
  </div>
);
