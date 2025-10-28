import React, { useState, useEffect } from 'react';
import { Trophy, RotateCcw, Save, Users, Settings } from 'lucide-react';

const KendoBracket = () => {
  const [mode, setMode] = useState('prediction');
  const [predictions, setPredictions] = useState({});
  const [results, setResults] = useState({});
  const [userName, setUserName] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showConfig, setShowConfig] = useState(true);
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  
  const participants = [
    { name: 'Takahiro Sato', prefecture: 'Tokyo' },
    { name: 'Kenji Yamamoto', prefecture: 'Osaka' },
    { name: 'Hiroshi Tanaka', prefecture: 'Kyoto' },
    { name: 'Yuki Nakamura', prefecture: 'Hokkaido' },
    { name: 'Daiki Suzuki', prefecture: 'Fukuoka' },
    { name: 'Ryo Watanabe', prefecture: 'Nagoya' },
    { name: 'Shota Ito', prefecture: 'Sendai' },
    { name: 'Kazuki Kobayashi', prefecture: 'Hiroshima' },
    { name: 'Haruto Kato', prefecture: 'Sapporo' },
    { name: 'Sota Yoshida', prefecture: 'Kobe' },
    { name: 'Ren Yamada', prefecture: 'Chiba' },
    { name: 'Kaito Sasaki', prefecture: 'Yokohama' },
    { name: 'Hayato Matsumoto', prefecture: 'Kanagawa' },
    { name: 'Yuto Inoue', prefecture: 'Saitama' },
    { name: 'Kenta Kimura', prefecture: 'Shizuoka' },
    { name: 'Tsubasa Hayashi', prefecture: 'Niigata' },
    { name: 'Taichi Shimizu', prefecture: 'Okayama' },
    { name: 'Ryota Yamazaki', prefecture: 'Kumamoto' },
    { name: 'Shun Mori', prefecture: 'Kagoshima' },
    { name: 'Takumi Abe', prefecture: 'Nara' },
    { name: 'Kosuke Ikeda', prefecture: 'Wakayama' },
    { name: 'Masato Hashimoto', prefecture: 'Mie' },
    { name: 'Naoki Yamashita', prefecture: 'Gifu' },
    { name: 'Yuji Ishikawa', prefecture: 'Aichi' },
    { name: 'Shinji Murakami', prefecture: 'Ishikawa' },
    { name: 'Akira Saito', prefecture: 'Toyama' },
    { name: 'Tatsuya Kondo', prefecture: 'Fukui' },
    { name: 'Makoto Endo', prefecture: 'Yamanashi' },
    { name: 'Koji Aoki', prefecture: 'Nagano' },
    { name: 'Takeshi Fujita', prefecture: 'Gunma' },
    { name: 'Daisuke Okada', prefecture: 'Tochigi' },
    { name: 'Hideki Goto', prefecture: 'Ibaraki' },
    { name: 'Tomoya Sakamoto', prefecture: 'Miyagi' },
    { name: 'Yusuke Kaneko', prefecture: 'Fukushima' },
    { name: 'Masashi Fukuda', prefecture: 'Yamagata' },
    { name: 'Satoshi Ota', prefecture: 'Iwate' },
    { name: 'Kazuya Miura', prefecture: 'Akita' },
    { name: 'Toshiro Maeda', prefecture: 'Aomori' },
    { name: 'Akihiro Fujii', prefecture: 'Okinawa' },
    { name: 'Yoshihiro Ogawa', prefecture: 'Miyazaki' },
    { name: 'Noboru Kato', prefecture: 'Oita' },
    { name: 'Tetsuya Takeuchi', prefecture: 'Saga' },
    { name: 'Osamu Nakajima', prefecture: 'Nagasaki' },
    { name: 'Minoru Harada', prefecture: 'Yamaguchi' },
    { name: 'Ichiro Miyazaki', prefecture: 'Shimane' },
    { name: 'Jiro Okamoto', prefecture: 'Tottori' },
    { name: 'Saburo Morita', prefecture: 'Hyogo' },
    { name: 'Shiro Taniguchi', prefecture: 'Tokushima' },
    { name: 'Goro Sakurai', prefecture: 'Kagawa' },
    { name: 'Rokuro Imai', prefecture: 'Ehime' },
    { name: 'Hideo Fujimoto', prefecture: 'Kochi' },
    { name: 'Masao Takahashi', prefecture: 'Osaka' },
    { name: 'Isamu Kobayashi', prefecture: 'Tokyo' },
    { name: 'Tsuyoshi Koga', prefecture: 'Kyoto' },
    { name: 'Susumu Noguchi', prefecture: 'Hokkaido' },
    { name: 'Mamoru Ishii', prefecture: 'Fukuoka' },
    { name: 'Takao Hasegawa', prefecture: 'Nagoya' },
    { name: 'Yasuo Kudo', prefecture: 'Sendai' },
    { name: 'Hisashi Maki', prefecture: 'Hiroshima' },
    { name: 'Atsushi Yano', prefecture: 'Sapporo' },
    { name: 'Katsuya Sugiyama', prefecture: 'Kobe' },
    { name: 'Seiji Miyamoto', prefecture: 'Chiba' },
    { name: 'Kiyoshi Iwasaki', prefecture: 'Yokohama' },
    { name: 'Tatsuo Nishimura', prefecture: 'Kanagawa' }
  ];

  const rounds = ['Round of 64', 'Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Final', 'Champion'];

  useEffect(() => {
    if (supabaseUrl && supabaseKey) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [supabaseUrl, supabaseKey]);

  const supabaseFetch = async (endpoint, options = {}) => {
    const url = supabaseUrl + '/rest/v1/' + endpoint;
    const headers = {
      'apikey': supabaseKey,
      'Authorization': 'Bearer ' + supabaseKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...options.headers
    };

    const response = await fetch(url, { ...options, headers });
    if (!response.ok) {
      throw new Error('Supabase error: ' + response.statusText);
    }
    return response.json();
  };

  const loadData = async () => {
    try {
      await Promise.all([loadResults(), loadLeaderboard()]);
    } catch (error) {
      console.error('Error loading data:', error);
      alert('Error connecting to database. Please check your Supabase credentials.');
    }
    setLoading(false);
  };

  const loadResults = async () => {
    try {
      const data = await supabaseFetch('results?select=*&order=id.desc&limit=1');
      if (data && data.length > 0) {
        setResults(data[0].data || {});
      }
    } catch (error) {
      console.error('Error loading results:', error);
    }
  };

  const loadLeaderboard = async () => {
    try {
      const data = await supabaseFetch('brackets?select=*&order=submitted_at.desc');
      setLeaderboard(data || []);
    } catch (error) {
      console.error('Error loading leaderboard:', error);
    }
  };

  const getMatchId = (round, match) => round + '-' + match;

  const advanceWinner = (round, match, winner, isResult = false) => {
    const data = isResult ? results : predictions;
    const setData = isResult ? setResults : setPredictions;
    
    const newData = { ...data, [getMatchId(round, match)]: winner };

    if (round < 6) {
      const nextRound = round + 1;
      const nextMatch = Math.floor(match / 2);
      const nextMatchId = getMatchId(nextRound, nextMatch);
      
      if (newData[nextMatchId]) {
        clearFromRound(newData, nextRound, nextMatch);
      }
    }

    setData(newData);
  };

  const clearFromRound = (data, round, match) => {
    delete data[getMatchId(round, match)];
    if (round < 6) {
      const nextRound = round + 1;
      const nextMatch = Math.floor(match / 2);
      clearFromRound(data, nextRound, nextMatch);
    }
  };

  const getParticipant = (round, match, position, useResults = false, isBottomHalf = false) => {
    const data = useResults ? results : predictions;
    if (round === 0) {
      const index = isBottomHalf ? (match * 2 + position + 32) : (match * 2 + position);
      return participants[index] || { name: '---', prefecture: '' };
    }
    const prevRound = round - 1;
    const prevMatch1 = match * 2;
    const prevMatch2 = match * 2 + 1;
    
    const participant = position === 0 
      ? data[getMatchId(prevRound, prevMatch1)]
      : data[getMatchId(prevRound, prevMatch2)];
    
    return participant || { name: '---', prefecture: '' };
  };

  const calculateScore = (userPredictions, actualResults) => {
    let score = 0;
    let possible = 0;
    const points = [1, 2, 4, 8, 16, 32, 64];

    for (let round = 0; round < 7; round++) {
      const matches = round === 6 ? 1 : Math.pow(2, 5 - round);
      for (let match = 0; match < matches; match++) {
        const matchId = getMatchId(round, match);
        possible += points[round];
        if (userPredictions[matchId] && actualResults[matchId] && 
            userPredictions[matchId].name === actualResults[matchId].name) {
          score += points[round];
        }
      }
    }

    return { score, possible };
  };

  const submitBracket = async () => {
    if (!userName.trim()) {
      alert('Please enter your name!');
      return;
    }

    const bracketData = {
      name: userName.trim(),
      predictions: predictions
    };

    try {
      await supabaseFetch('brackets', {
        method: 'POST',
        body: JSON.stringify(bracketData)
      });
      setIsSubmitted(true);
      alert('Bracket submitted successfully!');
      await loadLeaderboard();
    } catch (error) {
      alert('Error submitting bracket. Please try again.');
      console.error(error);
    }
  };

  const saveResults = async () => {
    try {
      const existing = await supabaseFetch('results?select=id&order=id.desc&limit=1');
      
      if (existing && existing.length > 0) {
        await supabaseFetch('results?id=eq.' + existing[0].id, {
          method: 'PATCH',
          body: JSON.stringify({ data: results, updated_at: new Date().toISOString() })
        });
      } else {
        await supabaseFetch('results', {
          method: 'POST',
          body: JSON.stringify({ data: results })
        });
      }
      
      alert('Results saved successfully!');
      await loadLeaderboard();
    } catch (error) {
      alert('Error saving results. Please try again.');
      console.error(error);
    }
  };

  const checkAdminPassword = () => {
    const pwd = prompt('Enter admin password:');
    if (pwd === 'kendo2025') {
      setIsAdmin(true);
      setMode('results');
    } else if (pwd) {
      alert('Incorrect password');
    }
  };

  const resetBracket = () => {
    setPredictions({});
    setIsSubmitted(false);
  };

  const Match = ({ round, match, isResult, isBottomHalf }) => {
    const p1 = getParticipant(round, match, 0, isResult, isBottomHalf);
    const p2 = getParticipant(round, match, 1, isResult, isBottomHalf);
    const winner = isResult ? results[getMatchId(round, match)] : predictions[getMatchId(round, match)];

    return (
      <div className="bg-white rounded-lg shadow-md p-3 mb-3 min-w-[220px] border-2 border-gray-200">
        <div className="text-xs text-gray-500 mb-2 font-semibold">Match {match + 1}</div>
        <button
          onClick={() => advanceWinner(round, match, p1, isResult)}
          disabled={p1.name === '---' || (isSubmitted && !isResult) || (isResult && !isAdmin)}
          className={'w-full text-left px-3 py-2 rounded mb-1 text-sm transition-colors ' + 
            (winner && winner.name === p1.name ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200') + ' ' +
            (p1.name === '---' || (isSubmitted && !isResult) ? 'opacity-50 cursor-not-allowed' : '')}
        >
          <div className="font-semibold">{p1.name}</div>
          {p1.prefecture && <div className="text-xs opacity-75">{p1.prefecture}</div>}
        </button>
        <button
          onClick={() => advanceWinner(round, match, p2, isResult)}
          disabled={p2.name === '---' || (isSubmitted && !isResult) || (isResult && !isAdmin)}
          className={'w-full text-left px-3 py-2 rounded text-sm transition-colors ' +
            (winner && winner.name === p2.name ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200') + ' ' +
            (p2.name === '---' || (isSubmitted && !isResult) ? 'opacity-50 cursor-not-allowed' : '')}
        >
          <div className="font-semibold">{p2.name}</div>
          {p2.prefecture && <div className="text-xs opacity-75">{p2.prefecture}</div>}
        </button>
      </div>
    );
  };

  const sortedLeaderboard = leaderboard.map(entry => ({
    ...entry,
    ...calculateScore(entry.predictions, results)
  })).sort((a, b) => b.score - a.score);

  if (showConfig) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-blue-50 p-6 flex items-center justify-center">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-2xl w-full">
          <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
            <Settings size={28} />
            Configure Supabase
          </h2>
          <p className="text-gray-600 mb-6">
            Enter your Supabase credentials to connect to the database.
          </p>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">Supabase URL</label>
              <input
                type="text"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
                placeholder="https://xxxxx.supabase.co"
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-2">Supabase Anon Key</label>
              <input
                type="text"
                value={supabaseKey}
                onChange={(e) => setSupabaseKey(e.target.value)}
                placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
                className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg"
              />
            </div>
            <button
              onClick={() => {
                setShowConfig(false);
                setLoading(true);
                loadData();
              }}
              className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700"
            >
              Connect
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 to-blue-50 flex items-center justify-center">
        <div className="text-2xl text-gray-600">Loading...</div>
      </div>
    );
  }

  const BracketView = ({ isResultMode }) => (
    <div className="bg-white rounded-lg shadow-lg p-6 overflow-x-auto">
      <div className="flex justify-center gap-4">
        <div className="flex gap-6">
          {[0, 1, 2, 3, 4, 5].map((round) => (
            <div key={round} className="flex flex-col justify-around">
              <h3 className="text-sm font-bold mb-4 text-center text-gray-700">{rounds[round]}</h3>
              {Array.from({ length: Math.pow(2, 5 - round) / 2 }).map((_, match) => (
                <Match key={match} round={round} match={match} isResult={isResultMode} isBottomHalf={false} />
              ))}
            </div>
          ))}
        </div>
        <div className="flex flex-col justify-center">
          <h3 className="text-sm font-bold mb-4 text-center text-gray-700">{rounds[6]}</h3>
          <div className="bg-gradient-to-br from-yellow-100 to-yellow-200 rounded-lg shadow-lg p-6 min-w-[220px] border-4 border-yellow-400">
            <div className="text-center">
              <Trophy className="mx-auto text-yellow-600 mb-3" size={32} />
              <div className="text-sm text-gray-600 mb-2 font-semibold">CHAMPION</div>
              <div className="text-lg font-bold text-gray-800">
                {(isResultMode ? results : predictions)[getMatchId(6, 0)] ? (isResultMode ? results : predictions)[getMatchId(6, 0)].name : 'TBD'}
              </div>
              {(isResultMode ? results : predictions)[getMatchId(6, 0)] && (isResultMode ? results : predictions)[getMatchId(6, 0)].prefecture && (
                <div className="text-sm text-gray-600 mt-1">
                  {(isResultMode ? results : predictions)[getMatchId(6, 0)].prefecture}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-6">
          {[5, 4, 3, 2, 1, 0].map((round) => (
            <div key={round} className="flex flex-col justify-around">
              <h3 className="text-sm font-bold mb-4 text-center text-gray-700">{rounds[round]}</h3>
              {Array.from({ length: Math.pow(2, 5 - round) / 2 }).map((_, match) => {
                const actualMatch = match + Math.pow(2, 5 - round) / 2;
                return <Match key={match} round={round} match={actualMatch} isResult={isResultMode} isBottomHalf={true} />;
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-blue-50 p-6">
      <div className="max-w-[95vw] mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2 flex items-center justify-center gap-3">
            <Trophy className="text-yellow-500" size={40} />
            All Japan Kendo Championship 2025
          </h1>
          <p className="text-gray-600">Submit your bracket and compete with others!</p>
        </div>

        <div className="flex gap-4 justify-center mb-6 flex-wrap">
          <button
            onClick={() => setMode('prediction')}
            className={'px-6 py-2 rounded-lg font-semibold transition-colors ' +
              (mode === 'prediction' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100')}
          >
            My Bracket
          </button>
          <button
            onClick={() => setMode('leaderboard')}
            className={'px-6 py-2 rounded-lg font-semibold transition-colors flex items-center gap-2 ' +
              (mode === 'leaderboard' ? 'bg-purple-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100')}
          >
            <Users size={20} />
            Leaderboard ({leaderboard.length})
          </button>
          {!isAdmin && (
            <button
              onClick={checkAdminPassword}
              className="px-6 py-2 rounded-lg font-semibold bg-white text-gray-700 hover:bg-gray-100"
            >
              Admin Login
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => setMode('results')}
              className={'px-6 py-2 rounded-lg font-semibold transition-colors ' +
                (mode === 'results' ? 'bg-green-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100')}
            >
              Enter Results
            </button>
          )}
          <button
            onClick={() => setShowConfig(true)}
            className="px-6 py-2 rounded-lg font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 flex items-center gap-2"
          >
            <Settings size={20} />
          </button>
        </div>

        {mode === 'leaderboard' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-4 flex items-center gap-2">
              <Trophy className="text-yellow-500" />
              Leaderboard
            </h2>
            {sortedLeaderboard.length === 0 ? (
              <p className="text-gray-600 text-center py-8">No brackets submitted yet. Be the first!</p>
            ) : (
              <div className="space-y-2">
                {sortedLeaderboard.map((entry, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-4">
                      <div className={'text-2xl font-bold ' + (idx === 0 ? 'text-yellow-500' : idx === 1 ? 'text-gray-400' : idx === 2 ? 'text-orange-600' : 'text-gray-600')}>
                        #{idx + 1}
                      </div>
                      <div>
                        <div className="font-semibold text-lg">{entry.name}</div>
                        <div className="text-sm text-gray-500">
                          Submitted {new Date(entry.submitted_at).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold text-blue-600">{entry.score}</div>
                      <div className="text-sm text-gray-500">
                        {entry.possible > 0 ? Math.round((entry.score / entry.possible) * 100) + '%' : '0%'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === 'prediction' && (
          <>
            {!isSubmitted && (
              <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
                <div className="flex gap-4 items-center justify-center flex-wrap">
                  <input
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    placeholder="Enter your name"
                    className="px-4 py-2 border-2 border-gray-300 rounded-lg text-lg flex-1 max-w-md"
                  />
                  <button
                    onClick={submitBracket}
                    className="px-8 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 flex items-center gap-2"
                  >
                    <Save size={20} />
                    Submit Bracket
                  </button>
                  <button
                    onClick={resetBracket}
                    className="px-6 py-2 bg-red-100 text-red-700 rounded-lg font-semibold hover:bg-red-200 flex items-center gap-2"
                  >
                    <RotateCcw size={20} />
                    Reset
                  </button>
                </div>
              </div>
            )}

            {isSubmitted && (
              <div className="bg-green-100 border-2 border-green-500 rounded-lg p-4 mb-6 text-center">
                <p className="text-green-800 font-semibold text-lg">
                  ✓ Bracket submitted! Check the leaderboard to see how you're doing.
                </p>
              </div>
            )}

            <BracketView isResultMode={false} />
          </>
        )}

        {mode === 'results' && isAdmin && (
          <>
            <div className="bg-blue-100 border-2 border-blue-500 rounded-lg p-4 mb-6 text-center">
              <p className="text-blue-800 font-semibold">Admin Mode: Enter the actual results as matches complete</p>
              <button
                onClick={saveResults}
                className="mt-3 px-6 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 flex items-center gap-2 mx-auto"
              >
                <Save size={20} />
                Save Results
              </button>
            </div>

            <BracketView isResultMode={true} />
          </>
        )}
      </div>
    </div>
  );
};

export default KendoBracket;